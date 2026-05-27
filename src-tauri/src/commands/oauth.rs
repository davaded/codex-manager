use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{oneshot, Mutex};

use crate::commands::accounts;
use crate::models::{AuthJson, AuthTokens, OAuthResult, TokenResponse};
use crate::net::build_http_client;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_ENDPOINT: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const CALLBACK_PORT: u16 = 1455;

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_code_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

fn generate_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

// ─── JWT claim extraction (no signature verification) ────────────────────────

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    serde_json::from_slice(&payload).ok()
}

fn extract_email(id_token: &str) -> Option<String> {
    decode_jwt_payload(id_token)?
        .get("email")?
        .as_str()
        .map(String::from)
}

fn extract_account_id(access_token: &str) -> Option<String> {
    decode_jwt_payload(access_token)?
        .get("chatgpt_account_id")?
        .as_str()
        .map(String::from)
}

// ─── Axum callback state ──────────────────────────────────────────────────────

struct CallbackState {
    result_tx: Mutex<Option<oneshot::Sender<Result<(String, String), String>>>>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    expected_state: String,
}

pub struct OAuthFlowManager(Mutex<Option<Arc<CallbackState>>>);

impl Default for OAuthFlowManager {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

async fn send_result(state: &Arc<CallbackState>, result: Result<(String, String), String>) {
    let mut tx = state.result_tx.lock().await;
    if let Some(sender) = tx.take() {
        let _ = sender.send(result);
    }
}

async fn shutdown_flow(state: &Arc<CallbackState>) {
    let mut sd = state.shutdown_tx.lock().await;
    if let Some(tx) = sd.take() {
        let _ = tx.send(());
    }
}

async fn finish_flow(state: &Arc<CallbackState>, result: Result<(String, String), String>) {
    send_result(state, result).await;
    shutdown_flow(state).await;
}

async fn set_active_flow(app: &AppHandle, state: Option<Arc<CallbackState>>) {
    let manager = app.state::<OAuthFlowManager>();
    let mut active = manager.0.lock().await;
    *active = state;
}

async fn clear_active_flow(app: &AppHandle, state: &Arc<CallbackState>) {
    let manager = app.state::<OAuthFlowManager>();
    let mut active = manager.0.lock().await;
    if active
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, state))
    {
        *active = None;
    }
}

async fn callback_handler(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<CallbackState>>,
) -> Html<String> {
    let error = params.get("error").cloned();
    if let Some(err) = error {
        finish_flow(&state, Err(format!("OAuth error: {}", err))).await;
        return Html("<h1>Authorization failed. You may close this window.</h1>".to_string());
    }

    let code = params.get("code").cloned().unwrap_or_default();
    let received_state = params.get("state").cloned().unwrap_or_default();

    if received_state != state.expected_state {
        finish_flow(&state, Err("CSRF state mismatch".to_string())).await;
        return Html("<h1>Security error. You may close this window.</h1>".to_string());
    }

    finish_flow(&state, Ok((code, received_state))).await;

    Html("<h1>Authorization complete! You may close this window.</h1>".to_string())
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async fn exchange_code(
    app: &AppHandle,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    let settings = accounts::load_settings(app.clone()).await?;
    let client = build_http_client(
        &settings,
        "codex-manager/1.0",
        std::time::Duration::from_secs(30),
    )?;
    let params = [
        ("grant_type", "authorization_code"),
        ("client_id", CLIENT_ID),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("code_verifier", verifier),
    ];

    let resp = client
        .post(TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if body.contains("unsupported_country_region_territory") {
            return Err(format!(
                "Token exchange failed ({status}): 当前网络被 OpenAI 判定为不支持的地区。请在设置中配置可用代理，或启用系统代理后重试。{body}"
            ));
        }
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    resp.json::<TokenResponse>()
        .await
        .map_err(|e| e.to_string())
}

// ─── Main OAuth command ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_oauth_flow(app: AppHandle) -> Result<OAuthResult, String> {
    {
        let manager = app.state::<OAuthFlowManager>();
        if manager.0.lock().await.is_some() {
            return Err("已有一个授权流程正在进行".to_string());
        }
    }

    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let state_token = generate_state();

    let (result_tx, result_rx) = oneshot::channel::<Result<(String, String), String>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let callback_state = Arc::new(CallbackState {
        result_tx: Mutex::new(Some(result_tx)),
        shutdown_tx: Mutex::new(Some(shutdown_tx)),
        expected_state: state_token.clone(),
    });
    // Keep a reference for guaranteed cleanup on all exit paths
    let cleanup_state = callback_state.clone();

    let router = Router::new()
        .route("/auth/callback", get(callback_handler))
        .with_state(callback_state.clone());

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT))
        .await
        .map_err(|e| format!("Port {} already in use: {}", CALLBACK_PORT, e))?;

    set_active_flow(&app, Some(callback_state.clone())).await;

    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    // Build authorization URL
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope=openid+profile+email+offline_access&code_challenge_method=S256&code_challenge={}&state={}&codex_cli_simplified_flow=true&originator=codex_cli_rs",
        AUTH_ENDPOINT,
        CLIENT_ID,
        urlencoding_simple(REDIRECT_URI),
        code_challenge,
        state_token,
    );

    // If browser fails to open, shut down the server immediately
    if let Err(e) = app.opener().open_url(&auth_url, None::<&str>) {
        shutdown_flow(&cleanup_state).await;
        let _ = server.await;
        clear_active_flow(&app, &cleanup_state).await;
        return Err(format!("Failed to open browser: {}", e));
    }

    // Wait for callback (5-minute timeout)
    let callback_result =
        tokio::time::timeout(tokio::time::Duration::from_secs(300), result_rx).await;

    // Always shut down the server regardless of outcome
    shutdown_flow(&cleanup_state).await;
    let _ = server.await;
    clear_active_flow(&app, &cleanup_state).await;

    let (code, _) = callback_result
        .map_err(|_| "OAuth timed out after 5 minutes".to_string())?
        .map_err(|_| "OAuth channel closed unexpectedly".to_string())??;

    if code.is_empty() {
        return Err("OAuth callback received empty authorization code".to_string());
    }

    // Exchange code for tokens
    let tokens = exchange_code(&app, &code, &code_verifier).await?;

    let email = tokens.id_token.as_deref().and_then(extract_email);
    let user_id = extract_account_id(&tokens.access_token);

    // Build auth.json
    let auth = AuthJson {
        auth_mode: "chatgpt".to_string(),
        tokens: Some(AuthTokens {
            access_token: Some(tokens.access_token),
            id_token: tokens.id_token,
            refresh_token: tokens.refresh_token,
        }),
        last_refresh: Some(chrono::Utc::now().timestamp_millis()),
    };
    let auth_json = serde_json::to_string_pretty(&auth).map_err(|e| e.to_string())?;

    Ok(OAuthResult {
        auth_json,
        email,
        user_id,
    })
}

#[tauri::command]
pub async fn cancel_oauth_flow(app: AppHandle) -> Result<(), String> {
    let active_flow = {
        let manager = app.state::<OAuthFlowManager>();
        let active = manager.0.lock().await.clone();
        active
    };

    let Some(flow) = active_flow else {
        return Ok(());
    };

    finish_flow(&flow, Err("OAuth flow cancelled by user".to_string())).await;
    Ok(())
}

/// Minimal percent-encoding for redirect_uri (replaces `:`, `/`, spaces)
fn urlencoding_simple(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            ':' => "%3A".chars().collect::<Vec<_>>(),
            '/' => "%2F".chars().collect::<Vec<_>>(),
            ' ' => "%20".chars().collect::<Vec<_>>(),
            _ => vec![c],
        })
        .collect()
}
