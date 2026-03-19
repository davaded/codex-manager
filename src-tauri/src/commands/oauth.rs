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
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tokio::sync::{oneshot, Mutex};

use crate::commands::accounts;
use crate::models::{AuthJson, AuthTokens, OAuthResult, TokenResponse};

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

async fn callback_handler(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<CallbackState>>,
) -> Html<String> {
    let error = params.get("error").cloned();
    if let Some(err) = error {
        let mut tx = state.result_tx.lock().await;
        if let Some(sender) = tx.take() {
            let _ = sender.send(Err(format!("OAuth error: {}", err)));
        }
        let mut sd = state.shutdown_tx.lock().await;
        if let Some(s) = sd.take() {
            let _ = s.send(());
        }
        return Html("<h1>Authorization failed. You may close this window.</h1>".to_string());
    }

    let code = params.get("code").cloned().unwrap_or_default();
    let received_state = params.get("state").cloned().unwrap_or_default();

    if received_state != state.expected_state {
        let mut tx = state.result_tx.lock().await;
        if let Some(sender) = tx.take() {
            let _ = sender.send(Err("CSRF state mismatch".to_string()));
        }
        let mut sd = state.shutdown_tx.lock().await;
        if let Some(s) = sd.take() {
            let _ = s.send(());
        }
        return Html("<h1>Security error. You may close this window.</h1>".to_string());
    }

    let mut tx = state.result_tx.lock().await;
    if let Some(sender) = tx.take() {
        let _ = sender.send(Ok((code, received_state)));
    }
    let mut sd = state.shutdown_tx.lock().await;
    if let Some(s) = sd.take() {
        let _ = s.send(());
    }

    Html("<h1>Authorization complete! You may close this window.</h1>".to_string())
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async fn exchange_code(
    app: &AppHandle,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    let settings = accounts::load_settings(app.clone()).await?;
    let mut client_builder = reqwest::Client::builder();

    if !settings.proxy_url.trim().is_empty() {
        let proxy = reqwest::Proxy::all(settings.proxy_url.trim())
            .map_err(|e| format!("Invalid proxy URL: {}", e))?;
        client_builder = client_builder.proxy(proxy);
    }

    let client = client_builder.build().map_err(|e| e.to_string())?;
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
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    resp.json::<TokenResponse>()
        .await
        .map_err(|e| e.to_string())
}

// ─── Main OAuth command ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_oauth_flow(app: AppHandle) -> Result<OAuthResult, String> {
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
        .with_state(callback_state);

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT))
        .await
        .map_err(|e| format!("Port {} already in use: {}", CALLBACK_PORT, e))?;

    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    // Helper: send shutdown signal (idempotent)
    let shutdown = |state: &Arc<CallbackState>| {
        let state = state.clone();
        async move {
            let mut sd = state.shutdown_tx.lock().await;
            if let Some(tx) = sd.take() {
                let _ = tx.send(());
            }
        }
    };

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
    if let Err(e) = app.shell().open(&auth_url, None) {
        shutdown(&cleanup_state).await;
        let _ = server.await;
        return Err(format!("Failed to open browser: {}", e));
    }

    // Wait for callback (5-minute timeout)
    let callback_result =
        tokio::time::timeout(tokio::time::Duration::from_secs(300), result_rx).await;

    // Always shut down the server regardless of outcome
    shutdown(&cleanup_state).await;
    let _ = server.await;

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
