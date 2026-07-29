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
use tokio::sync::{oneshot, watch, Mutex};

use crate::commands::accounts;
use crate::models::{AppSettings, AuthJson, AuthTokens, OAuthResult, TokenResponse};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_ENDPOINT: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const CALLBACK_PORT: u16 = 1455;

fn oauth_error(code: &str, message: impl Into<String>) -> String {
    format!("[oauth:{code}] {}", message.into())
}

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
    cancel_tx: watch::Sender<bool>,
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

fn cancelled_error() -> String {
    oauth_error("cancelled", "OAuth flow cancelled by user")
}

fn callback_state_matches(params: &HashMap<String, String>, expected_state: &str) -> bool {
    params
        .get("state")
        .is_some_and(|received_state| received_state == expected_state)
}

fn signal_cancellation(state: &CallbackState) {
    state.cancel_tx.send_replace(true);
}

fn cancellation_requested(cancel_rx: &watch::Receiver<bool>) -> bool {
    *cancel_rx.borrow()
}

fn flow_cancellation_requested(state: &CallbackState) -> bool {
    *state.cancel_tx.borrow()
}

async fn wait_for_cancellation(cancel_rx: &mut watch::Receiver<bool>) {
    if cancellation_requested(cancel_rx) {
        return;
    }

    while cancel_rx.changed().await.is_ok() {
        if cancellation_requested(cancel_rx) {
            return;
        }
    }
}

async fn set_active_flow(app: &AppHandle, state: Option<Arc<CallbackState>>) {
    let manager = app.state::<OAuthFlowManager>();
    let mut active = manager.0.lock().await;
    *active = state;
}

async fn clear_active_flow(app: &AppHandle, state: &Arc<CallbackState>) -> bool {
    let manager = app.state::<OAuthFlowManager>();
    let mut active = manager.0.lock().await;
    let was_cancelled = flow_cancellation_requested(state);
    if active
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, state))
    {
        *active = None;
    }
    was_cancelled
}

async fn callback_handler(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<CallbackState>>,
) -> Html<String> {
    if !callback_state_matches(&params, &state.expected_state) {
        return Html("<h1>Security error. You may close this window.</h1>".to_string());
    }

    let error = params.get("error").cloned();
    if let Some(err) = error {
        let error_description = params
            .get("error_description")
            .map(|value| value.replace('+', " "));
        let message = match error_description {
            Some(description) if !description.trim().is_empty() => format!(
                "浏览器授权未完成（{err}）。如果你刚刚取消了登录或拒绝了授权，重新开始一次即可。详情：{}",
                description.trim()
            ),
            _ => format!("浏览器授权未完成（{err}）。如果你刚刚取消了登录或拒绝了授权，重新开始一次即可。"),
        };
        finish_flow(&state, Err(oauth_error("browser_auth_error", message))).await;
        return Html("<h1>Authorization failed. You may close this window.</h1>".to_string());
    }

    let code = params.get("code").cloned().unwrap_or_default();
    let received_state = params.get("state").cloned().unwrap_or_default();

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
    let client = build_oauth_http_client(&settings)?;
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
        .map_err(|e| format_transport_error(&e, &settings))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format_token_exchange_error(status, &body, &settings));
    }

    resp.json::<TokenResponse>().await.map_err(|e| {
        oauth_error(
            "token_parse_failed",
            format!("解析 token exchange 响应失败：{e}"),
        )
    })
}

fn build_oauth_http_client(settings: &AppSettings) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("codex-manager/0.1")
        .timeout(std::time::Duration::from_secs(18));

    if !settings.proxy_url.trim().is_empty() {
        let proxy = reqwest::Proxy::all(settings.proxy_url.trim()).map_err(|_| {
            oauth_error(
                "proxy_config",
                "网络代理地址格式无效，请在设置 > 网络代理里检查协议、主机和端口后重试。",
            )
        })?;
        builder = builder.proxy(proxy);
    }

    builder.build().map_err(|e| {
        oauth_error(
            "client_build_failed",
            format!("创建 OAuth HTTP 客户端失败：{e}"),
        )
    })
}

fn compact_error_text(body: &str, max_len: usize) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= max_len {
        compact
    } else {
        format!("{}...", compact.chars().take(max_len).collect::<String>())
    }
}

fn extract_openai_error_details(body: &str) -> (Option<String>, Option<String>) {
    let parsed = match serde_json::from_str::<serde_json::Value>(body) {
        Ok(value) => value,
        Err(_) => return (None, None),
    };

    let nested_error = parsed.get("error");
    let error_code = nested_error
        .and_then(|value| value.get("code"))
        .and_then(|value| value.as_str())
        .or_else(|| parsed.get("code").and_then(|value| value.as_str()))
        .map(ToString::to_string);

    let error_message = nested_error
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .or_else(|| parsed.get("message").and_then(|value| value.as_str()))
        .or_else(|| {
            parsed
                .get("error_description")
                .and_then(|value| value.as_str())
        })
        .or_else(|| nested_error.and_then(|value| value.as_str()))
        .map(ToString::to_string);

    (error_code, error_message)
}

fn format_transport_error(error: &reqwest::Error, settings: &AppSettings) -> String {
    let proxy_hint = if settings.proxy_url.trim().is_empty() {
        "当前未配置应用内代理；如果你的网络环境访问 OpenAI 需要代理，请先到设置 > 网络代理填写后重试。"
    } else {
        "请检查设置 > 网络代理是否可用，并确认应用后端和浏览器走的是同一条网络出口。"
    };

    if error.is_timeout() {
        return oauth_error("network_timeout", format!("连接 OpenAI 超时。{proxy_hint}"));
    }

    if error.is_connect() || error.is_request() {
        return oauth_error(
            "network_connect",
            format!("应用无法连接 OpenAI 完成 token exchange。{proxy_hint} 原始错误：{error}"),
        );
    }

    oauth_error("network_error", format!("OAuth 请求失败：{error}"))
}

fn format_token_exchange_error(
    status: reqwest::StatusCode,
    body: &str,
    settings: &AppSettings,
) -> String {
    let (error_code, openai_error_message) = extract_openai_error_details(body);
    let error_message = openai_error_message.unwrap_or_else(|| compact_error_text(body, 180));

    if error_code.as_deref() == Some("unsupported_country_region_territory") {
        let proxy_hint = if settings.proxy_url.trim().is_empty() {
            "请在设置 > 网络代理里填写可用代理后重试。"
        } else {
            "请检查设置 > 网络代理是否可用，并确认应用后端和浏览器走的是同一条网络出口。"
        };

        return oauth_error(
            "region_restricted",
            format!(
                "Token exchange failed ({status})：当前网络出口不受支持。浏览器完成授权只代表已拿到 code，应用后端还需要继续向 OpenAI 换 token。{proxy_hint} OpenAI 返回：{error_message}"
            ),
        );
    }

    oauth_error(
        "token_exchange_failed",
        format!(
            "Token exchange failed ({status})：{}",
            compact_error_text(&error_message, 220)
        ),
    )
}

// ─── Main OAuth command ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_oauth_flow(app: AppHandle) -> Result<OAuthResult, String> {
    {
        let manager = app.state::<OAuthFlowManager>();
        if manager.0.lock().await.is_some() {
            return Err(oauth_error(
                "flow_active",
                "已有一个授权流程正在进行，请先完成或取消当前授权。",
            ));
        }
    }

    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let state_token = generate_state();

    let (result_tx, result_rx) = oneshot::channel::<Result<(String, String), String>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (cancel_tx, mut cancel_rx) = watch::channel(false);

    let callback_state = Arc::new(CallbackState {
        result_tx: Mutex::new(Some(result_tx)),
        shutdown_tx: Mutex::new(Some(shutdown_tx)),
        cancel_tx,
        expected_state: state_token.clone(),
    });
    // Keep a reference for guaranteed cleanup on all exit paths
    let cleanup_state = callback_state.clone();

    let router = Router::new()
        .route("/auth/callback", get(callback_handler))
        .with_state(callback_state.clone());

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT))
        .await
        .map_err(|e| {
            oauth_error(
                "callback_port_in_use",
                format!(
                    "本地回调端口 {} 已被占用，请关闭冲突进程后重试。详情：{}",
                    CALLBACK_PORT, e
                ),
            )
        })?;

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

    let callback_result = match app.opener().open_url(&auth_url, None::<&str>) {
        Err(error) => Err(oauth_error(
            "open_browser_failed",
            format!("无法自动打开浏览器，请检查系统默认浏览器设置后重试。详情：{error}"),
        )),
        Ok(()) => async {
            tokio::select! {
                biased;
                _ = wait_for_cancellation(&mut cancel_rx) => Err(cancelled_error()),
                result = tokio::time::timeout(
                    tokio::time::Duration::from_secs(300),
                    result_rx,
                ) => {
                    result
                        .map_err(|_| {
                            oauth_error(
                                "timeout",
                                "授权等待超时（5 分钟）。请重新开始，并在浏览器完成登录后尽快返回应用。",
                            )
                        })?
                        .map_err(|_| {
                            oauth_error("channel_closed", "授权流程异常中断，请重新开始一次。")
                        })?
                }
            }
        }
        .await,
    };

    // The callback server is no longer needed, but the flow stays active until
    // token exchange and result construction have both finished.
    shutdown_flow(&cleanup_state).await;
    let _ = server.await;

    let flow_result: Result<OAuthResult, String> = async {
        let (code, _) = callback_result?;

        if code.is_empty() {
            return Err(oauth_error(
                "empty_code",
                "浏览器已回调，但没有拿到有效授权码，请重新开始一次。",
            ));
        }

        let tokens = tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut cancel_rx) => return Err(cancelled_error()),
            result = exchange_code(&app, &code, &code_verifier) => result?,
        };

        if cancellation_requested(&cancel_rx) {
            return Err(cancelled_error());
        }

        let email = tokens.id_token.as_deref().and_then(extract_email);
        let user_id = extract_account_id(&tokens.access_token);
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
    .await;

    // cancel_oauth_flow signals while holding the manager lock. Checking the
    // sticky flag under the same lock makes cancellation win every race in
    // which the flow was still active when cancellation was requested.
    if clear_active_flow(&app, &cleanup_state).await {
        Err(cancelled_error())
    } else {
        flow_result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn callback_test_state(
        expected_state: &str,
    ) -> (
        Arc<CallbackState>,
        oneshot::Receiver<Result<(String, String), String>>,
        oneshot::Receiver<()>,
    ) {
        let (result_tx, result_rx) = oneshot::channel();
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (cancel_tx, _cancel_rx) = watch::channel(false);
        let state = Arc::new(CallbackState {
            result_tx: Mutex::new(Some(result_tx)),
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
            cancel_tx,
            expected_state: expected_state.to_string(),
        });

        (state, result_rx, shutdown_rx)
    }

    fn empty_settings() -> AppSettings {
        AppSettings {
            auto_refresh_interval: 0,
            auto_preheat_interval_hours: 0,
            auto_restart_codex_after_switch: false,
            theme: "system".to_string(),
            proxy_url: String::new(),
        }
    }

    #[test]
    fn formats_region_restricted_error_with_machine_code() {
        let message = format_token_exchange_error(
            reqwest::StatusCode::FORBIDDEN,
            r#"{"error":{"code":"unsupported_country_region_territory","message":"unsupported region"}}"#,
            &empty_settings(),
        );

        assert!(message.starts_with("[oauth:region_restricted]"));
        assert!(message.contains("网络出口不受支持"));
    }

    #[test]
    fn formats_proxy_config_error_with_machine_code() {
        let settings = AppSettings {
            proxy_url: "not a url".to_string(),
            ..empty_settings()
        };

        let message = build_oauth_http_client(&settings).unwrap_err();

        assert!(message.starts_with("[oauth:proxy_config]"));
        assert!(message.contains("网络代理地址格式无效"));
    }

    #[test]
    fn compact_error_text_truncates_long_chinese_text_safely() {
        let body = "授权失败".repeat(100);

        let compact = compact_error_text(&body, 40);

        assert_eq!(compact.chars().count(), 43);
        assert_eq!(
            compact,
            format!("{}...", body.chars().take(40).collect::<String>())
        );
    }

    #[test]
    fn proxy_config_error_does_not_expose_credentials() {
        let proxy_url = "http://oauth-user:super-secret@[invalid";
        let settings = AppSettings {
            proxy_url: proxy_url.to_string(),
            ..empty_settings()
        };

        let message = build_oauth_http_client(&settings).unwrap_err();

        assert!(message.starts_with("[oauth:proxy_config]"));
        assert!(!message.contains(proxy_url));
        assert!(!message.contains("oauth-user"));
        assert!(!message.contains("super-secret"));
    }

    #[test]
    fn callback_state_requires_an_exact_nonempty_match() {
        let expected_state = "expected-state";

        assert!(!callback_state_matches(&HashMap::new(), expected_state));
        assert!(!callback_state_matches(
            &HashMap::from([("state".to_string(), String::new())]),
            expected_state,
        ));
        assert!(!callback_state_matches(
            &HashMap::from([("state".to_string(), "wrong-state".to_string())]),
            expected_state,
        ));
        assert!(callback_state_matches(
            &HashMap::from([("state".to_string(), expected_state.to_string())]),
            expected_state,
        ));
    }

    #[tokio::test]
    async fn invalid_callback_state_does_not_consume_the_legitimate_flow() {
        let expected_state = "expected-state";
        let (state, mut result_rx, mut shutdown_rx) = callback_test_state(expected_state);
        let forged_params = HashMap::from([
            ("state".to_string(), "wrong-state".to_string()),
            ("error".to_string(), "access_denied".to_string()),
        ]);

        let response = callback_handler(Query(forged_params), State(state.clone())).await;

        assert!(response.0.contains("Security error"));
        assert!(matches!(
            result_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        assert!(matches!(
            shutdown_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));

        let legitimate_params = HashMap::from([
            ("state".to_string(), expected_state.to_string()),
            ("error".to_string(), "access_denied".to_string()),
        ]);
        let _ = callback_handler(Query(legitimate_params), State(state)).await;

        let error = result_rx.await.unwrap().unwrap_err();
        assert!(error.starts_with("[oauth:browser_auth_error]"));
        assert!(shutdown_rx.await.is_ok());
    }

    #[tokio::test]
    async fn cancellation_signal_is_sticky_for_current_and_future_waiters() {
        let (state, _result_rx, _shutdown_rx) = callback_test_state("expected-state");
        let mut current_waiter = state.cancel_tx.subscribe();

        assert!(!flow_cancellation_requested(&state));
        signal_cancellation(&state);
        assert!(flow_cancellation_requested(&state));
        tokio::time::timeout(
            tokio::time::Duration::from_millis(100),
            wait_for_cancellation(&mut current_waiter),
        )
        .await
        .unwrap();

        let mut future_waiter = state.cancel_tx.subscribe();
        tokio::time::timeout(
            tokio::time::Duration::from_millis(100),
            wait_for_cancellation(&mut future_waiter),
        )
        .await
        .unwrap();
        assert!(cancelled_error().starts_with("[oauth:cancelled]"));
    }
}

#[tauri::command]
pub async fn cancel_oauth_flow(app: AppHandle) -> Result<(), String> {
    let active_flow = {
        let manager = app.state::<OAuthFlowManager>();
        let active = manager.0.lock().await;
        let Some(flow) = active.as_ref() else {
            return Ok(());
        };
        signal_cancellation(flow);
        flow.clone()
    };

    shutdown_flow(&active_flow).await;
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
