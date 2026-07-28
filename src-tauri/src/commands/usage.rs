use std::{collections::HashMap, error::Error as StdError, path::PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::fs;
use uuid::Uuid;

use crate::{
    atomic_io::write_text_atomic_async,
    commands::{accounts, paths::app_data_dir},
    models::{
        AccountPreheatStatus, AccountRateLimitStatus, AppSettings, AuthJson, CreditsSnapshot,
        GetAccountRateLimitsResponse, PreheatAccountResult, PreheatAccountsResponse,
        RateLimitSnapshot, RateLimitWindow, TokenResponse,
    },
};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_CHATGPT_BASE_URL: &str = "https://chatgpt.com";
const CODEX_USAGE_PATH: &str = "/api/codex/usage";
const WHAM_USAGE_PATH: &str = "/wham/usage";
const CODEX_RESPONSES_PATH: &str = "/codex/responses";
const BACKEND_API_PREFIX: &str = "/backend-api";
const PREHEAT_PROMPT: &str = "hello";
const PREHEAT_REQUEST_GAP_MS: u64 = 900;

fn validate_uuid(account_id: &str) -> Result<String, String> {
    Uuid::parse_str(account_id)
        .map(|value| value.to_string())
        .map_err(|_| format!("Invalid account_id: must be a UUID (got {:?})", account_id))
}

fn credentials_path(app: &AppHandle, account_id: &str) -> Result<PathBuf, String> {
    let id = validate_uuid(account_id)?;
    app_data_dir(app).map(|path| path.join("credentials").join(format!("{}.json", id)))
}

#[derive(Debug, Deserialize)]
struct UsageApiResponse {
    plan_type: Option<String>,
    rate_limit: Option<RateLimitDetails>,
    additional_rate_limits: Option<Vec<AdditionalRateLimitDetails>>,
    credits: Option<CreditDetails>,
}

#[derive(Debug, Deserialize)]
struct RateLimitDetails {
    primary_window: Option<UsageWindowRaw>,
    secondary_window: Option<UsageWindowRaw>,
}

#[derive(Debug, Deserialize)]
struct AdditionalRateLimitDetails {
    rate_limit: Option<RateLimitDetails>,
}

#[derive(Debug, Clone, Deserialize)]
struct UsageWindowRaw {
    used_percent: f64,
    limit_window_seconds: i64,
    reset_at: i64,
}

#[derive(Debug, Deserialize)]
struct CreditDetails {
    has_credits: bool,
    unlimited: bool,
    balance: Option<String>,
}

#[derive(Debug)]
struct UsageFetchError {
    message: String,
    should_refresh_auth: bool,
    invalid_account: bool,
}

#[derive(Debug)]
struct RefreshAuthError {
    message: String,
    invalid_account: bool,
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    serde_json::from_slice(&payload).ok()
}

fn extract_claim_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(ToString::to_string)
}

fn extract_nested_auth_claim(value: &Value, key: &str) -> Option<String> {
    value
        .get("https://api.openai.com/auth")?
        .get(key)?
        .as_str()
        .map(ToString::to_string)
}

fn extract_account_id(auth: &AuthJson) -> Option<String> {
    let access_claims = auth
        .tokens
        .as_ref()?
        .access_token
        .as_deref()
        .and_then(decode_jwt_payload);
    if let Some(claims) = access_claims.as_ref() {
        if let Some(id) = extract_claim_string(claims, "chatgpt_account_id") {
            return Some(id);
        }
        if let Some(id) = extract_nested_auth_claim(claims, "chatgpt_account_id") {
            return Some(id);
        }
    }

    let id_claims = auth
        .tokens
        .as_ref()?
        .id_token
        .as_deref()
        .and_then(decode_jwt_payload);
    if let Some(claims) = id_claims.as_ref() {
        if let Some(id) = extract_claim_string(claims, "chatgpt_account_id") {
            return Some(id);
        }
        if let Some(id) = extract_nested_auth_claim(claims, "chatgpt_account_id") {
            return Some(id);
        }
    }

    None
}

fn access_token(auth: &AuthJson) -> Result<&str, String> {
    auth.tokens
        .as_ref()
        .and_then(|tokens| tokens.access_token.as_deref())
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())
}

fn refresh_token(auth: &AuthJson) -> Result<&str, String> {
    auth.tokens
        .as_ref()
        .and_then(|tokens| tokens.refresh_token.as_deref())
        .ok_or_else(|| "auth.json 缺少 refresh_token".to_string())
}

fn resolve_chatgpt_base_origin() -> String {
    let base_url =
        read_chatgpt_base_url_from_config().unwrap_or_else(|| DEFAULT_CHATGPT_BASE_URL.to_string());
    base_url.trim_end_matches('/').to_string()
}

fn resolve_usage_urls() -> Vec<String> {
    let normalized = resolve_chatgpt_base_origin();
    let mut candidates = Vec::new();

    if let Some(origin) = normalized.strip_suffix(BACKEND_API_PREFIX) {
        candidates.push(format!("{normalized}{WHAM_USAGE_PATH}"));
        candidates.push(format!("{origin}{BACKEND_API_PREFIX}{WHAM_USAGE_PATH}"));
        candidates.push(format!("{origin}{CODEX_USAGE_PATH}"));
    } else {
        candidates.push(format!("{normalized}{BACKEND_API_PREFIX}{WHAM_USAGE_PATH}"));
        candidates.push(format!("{normalized}{WHAM_USAGE_PATH}"));
        candidates.push(format!("{normalized}{CODEX_USAGE_PATH}"));
    }

    candidates.push("https://chatgpt.com/backend-api/wham/usage".to_string());
    candidates.push(format!("https://chatgpt.com{CODEX_USAGE_PATH}"));

    let mut deduped = Vec::new();
    for url in candidates {
        if !deduped.iter().any(|existing| existing == &url) {
            deduped.push(url);
        }
    }
    deduped
}

fn resolve_responses_urls() -> Vec<String> {
    let normalized = resolve_chatgpt_base_origin();
    let mut candidates = Vec::new();

    if let Some(origin) = normalized.strip_suffix(BACKEND_API_PREFIX) {
        candidates.push(format!("{normalized}{CODEX_RESPONSES_PATH}"));
        candidates.push(format!("{origin}{BACKEND_API_PREFIX}{CODEX_RESPONSES_PATH}"));
    } else {
        candidates.push(format!("{normalized}{BACKEND_API_PREFIX}{CODEX_RESPONSES_PATH}"));
        candidates.push(format!("{normalized}{CODEX_RESPONSES_PATH}"));
    }

    candidates.push(format!(
        "https://chatgpt.com{BACKEND_API_PREFIX}{CODEX_RESPONSES_PATH}"
    ));

    let mut deduped = Vec::new();
    for url in candidates {
        if !deduped.iter().any(|existing| existing == &url) {
            deduped.push(url);
        }
    }
    deduped
}

fn read_chatgpt_base_url_from_config() -> Option<String> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".codex").join("config.toml");
    let contents = std::fs::read_to_string(config_path).ok()?;

    for line in contents.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("chatgpt_base_url") {
            continue;
        }
        let (_, value) = trimmed.split_once('=')?;
        let cleaned = value.trim().trim_matches('"').trim_matches('\'');
        if !cleaned.is_empty() {
            return Some(cleaned.to_string());
        }
    }

    None
}

fn read_model_from_config() -> Option<String> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".codex").join("config.toml");
    let contents = std::fs::read_to_string(config_path).ok()?;

    for line in contents.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("model") {
            continue;
        }
        let (_, value) = trimmed.split_once('=')?;
        let cleaned = value.trim().trim_matches('"').trim_matches('\'');
        if !cleaned.is_empty() {
            return Some(cleaned.to_string());
        }
    }

    None
}

fn resolve_preheat_models() -> Vec<String> {
    let mut models = Vec::new();

    if let Some(configured) = read_model_from_config() {
        models.push(configured);
    }

    models.push("gpt-5".to_string());
    models.push("gpt-5-codex".to_string());

    let mut deduped = Vec::new();
    for model in models {
        if !model.trim().is_empty() && !deduped.iter().any(|existing| existing == &model) {
            deduped.push(model);
        }
    }
    deduped
}

fn format_reqwest_error(err: &reqwest::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = err.source();
    while let Some(next) = source {
        let text = next.to_string();
        if !parts.iter().any(|item| item == &text) {
            parts.push(text);
        }
        source = next.source();
    }
    parts.join(" -> ")
}

fn truncate_for_error(body: &str, max_len: usize) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() <= max_len {
        compact
    } else {
        format!("{}...", &compact[..max_len])
    }
}

fn looks_like_invalid_account_text(text: &str) -> bool {
    let normalized = text.to_ascii_lowercase();
    [
        "invalid_grant",
        "deactivated",
        "disabled",
        "suspended",
        "banned",
        "revoked",
        "account_disabled",
        "account disabled",
        "account_not_found",
        "account not found",
        "user_not_found",
        "token revoked",
        "login expired",
        "forbidden",
        "unauthorized",
        "封禁",
        "失效",
        "停用",
        "禁用",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

fn invalid_account_reason(detail: impl Into<String>) -> String {
    format!("账号已失效或不可用，无法读取官方配额。{}", detail.into())
}

fn build_http_client(settings: &AppSettings) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("codex-manager/0.1")
        .timeout(std::time::Duration::from_secs(18));

    if !settings.proxy_url.trim().is_empty() {
        let proxy = reqwest::Proxy::all(settings.proxy_url.trim())
            .map_err(|e| format!("Invalid proxy URL: {e}"))?;
        builder = builder.proxy(proxy);
    }

    builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

async fn request_usage_payload(
    client: &reqwest::Client,
    access_token: &str,
    account_id: &str,
) -> Result<UsageApiResponse, UsageFetchError> {
    let usage_urls = resolve_usage_urls();
    let mut errors: Vec<String> = Vec::new();
    let mut should_refresh_auth = false;
    let mut invalid_account = false;

    for usage_url in usage_urls {
        let response = match client
            .get(&usage_url)
            .header("Authorization", format!("Bearer {access_token}"))
            .header("ChatGPT-Account-Id", account_id)
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                errors.push(format!("{usage_url} -> {}", format_reqwest_error(&err)));
                continue;
            }
        };

        let status = response.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            should_refresh_auth = true;
        }

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            invalid_account |= looks_like_invalid_account_text(&body);
            errors.push(format!(
                "{usage_url} -> {status}: {}",
                truncate_for_error(&body, 160)
            ));
            continue;
        }

        let payload: UsageApiResponse = match response.json().await {
            Ok(payload) => payload,
            Err(err) => {
                errors.push(format!("{usage_url} -> 解析返回失败: {err}"));
                continue;
            }
        };
        return Ok(payload);
    }

    let preview = if errors.is_empty() {
        "未命中任何候选地址".to_string()
    } else {
        errors.into_iter().take(2).collect::<Vec<_>>().join(" | ")
    };

    Err(UsageFetchError {
        message: format!("请求用量接口失败: {preview}"),
        should_refresh_auth,
        invalid_account,
    })
}

async fn request_preheat_payload(
    client: &reqwest::Client,
    access_token: &str,
    account_id: &str,
) -> Result<(), UsageFetchError> {
    let response_urls = resolve_responses_urls();
    let models = resolve_preheat_models();
    let mut errors: Vec<String> = Vec::new();
    let mut should_refresh_auth = false;
    let mut invalid_account = false;

    for response_url in response_urls {
        for model in &models {
            let payload = json!({
                "model": model,
                "input": PREHEAT_PROMPT,
                "store": false,
                "stream": false,
            });

            let response = match client
                .post(&response_url)
                .header("Authorization", format!("Bearer {access_token}"))
                .header("ChatGPT-Account-Id", account_id)
                .header("Accept", "application/json")
                .json(&payload)
                .send()
                .await
            {
                Ok(response) => response,
                Err(err) => {
                    errors.push(format!(
                        "{response_url} [{model}] -> {}",
                        format_reqwest_error(&err)
                    ));
                    continue;
                }
            };

            let status = response.status();
            if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                should_refresh_auth = true;
            }

            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                invalid_account |= looks_like_invalid_account_text(&body);
                errors.push(format!(
                    "{response_url} [{model}] -> {status}: {}",
                    truncate_for_error(&body, 160)
                ));
                continue;
            }

            return Ok(());
        }
    }

    let preview = if errors.is_empty() {
        "未命中任何候选地址".to_string()
    } else {
        errors.into_iter().take(2).collect::<Vec<_>>().join(" | ")
    };

    Err(UsageFetchError {
        message: format!("请求预热接口失败: {preview}"),
        should_refresh_auth,
        invalid_account,
    })
}

async fn refresh_auth_tokens(
    client: &reqwest::Client,
    auth: &mut AuthJson,
) -> Result<(), RefreshAuthError> {
    let refresh_token = refresh_token(auth)
        .map_err(|message| RefreshAuthError {
            message,
            invalid_account: true,
        })?
        .to_string();
    let token_url = auth
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.id_token.as_deref())
        .and_then(decode_jwt_payload)
        .and_then(|claims| {
            claims
                .get("iss")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "https://auth.openai.com".to_string());
    let token_endpoint = format!("{}/oauth/token", token_url.trim_end_matches('/'));

    let params = [
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token),
        ("client_id", CLIENT_ID.to_string()),
    ];

    let response = client
        .post(&token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|e| RefreshAuthError {
            message: format!("刷新登录令牌失败 {token_endpoint}: {e}"),
            invalid_account: false,
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(RefreshAuthError {
            message: format!(
                "刷新登录令牌失败 {token_endpoint} -> {status}: {}",
                truncate_for_error(&body, 160)
            ),
            invalid_account: matches!(
                status,
                StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
            ) || looks_like_invalid_account_text(&body),
        });
    }

    let refreshed: TokenResponse = response.json().await.map_err(|e| RefreshAuthError {
        message: format!("解析刷新令牌响应失败: {e}"),
        invalid_account: false,
    })?;

    let tokens = auth.tokens.as_mut().ok_or_else(|| RefreshAuthError {
        message: "auth.json 缺少 tokens".to_string(),
        invalid_account: true,
    })?;

    tokens.access_token = Some(refreshed.access_token);
    if let Some(id_token) = refreshed.id_token {
        tokens.id_token = Some(id_token);
    }
    if let Some(refresh_token) = refreshed.refresh_token {
        tokens.refresh_token = Some(refresh_token);
    }
    auth.last_refresh = Some(chrono::Utc::now().timestamp_millis());

    Ok(())
}

async fn persist_auth(credentials_path: &PathBuf, auth: &AuthJson) -> Result<(), String> {
    let serialized =
        serde_json::to_string_pretty(auth).map_err(|e| format!("auth.json 序列化失败: {e}"))?;
    write_text_atomic_async(credentials_path.clone(), serialized)
        .await
        .map_err(|e| format!("更新账号凭证失败: {e}"))
}

async fn load_account_auth(
    app: &AppHandle,
    account_id: &str,
) -> Result<(PathBuf, AuthJson), String> {
    let path = credentials_path(app, account_id)?;
    let auth_json = fs::read_to_string(&path)
        .await
        .map_err(|_| format!("Credentials not found for account {}", account_id))?;
    let auth: AuthJson =
        serde_json::from_str(&auth_json).map_err(|e| format!("auth.json 解析失败: {e}"))?;
    Ok((path, auth))
}

fn weekly_window_is_active(response: &GetAccountRateLimitsResponse) -> bool {
    matches!(
        classify_weekly_window(response, chrono::Utc::now().timestamp()),
        WeeklyWindowState::Active { .. }
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WeeklyWindowState {
    Active { used_percent: i32, resets_at: i64 },
    Inactive(WeeklyWindowInactiveReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WeeklyWindowInactiveReason {
    MissingWindow,
    MissingReset,
    ResetExpired,
    NoUsage,
}

fn classify_weekly_window(
    response: &GetAccountRateLimitsResponse,
    now_timestamp: i64,
) -> WeeklyWindowState {
    let Some(window) = response
        .rate_limits
        .as_ref()
        .and_then(|snapshot| snapshot.secondary.as_ref())
    else {
        return WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::MissingWindow);
    };

    let Some(resets_at) = window.resets_at else {
        return WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::MissingReset);
    };

    if resets_at <= now_timestamp {
        return WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::ResetExpired);
    }

    if window.used_percent <= 0 {
        return WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::NoUsage);
    }

    WeeklyWindowState::Active {
        used_percent: window.used_percent,
        resets_at,
    }
}

fn format_remaining_duration(target_timestamp: i64, now_timestamp: i64) -> String {
    let remaining_seconds = (target_timestamp - now_timestamp).max(0);
    let days = remaining_seconds / (24 * 60 * 60);
    let hours = (remaining_seconds % (24 * 60 * 60)) / (60 * 60);
    let minutes = (remaining_seconds % (60 * 60)) / 60;

    if days > 0 {
        format!("约 {} 天 {} 小时", days, hours)
    } else if hours > 0 {
        format!("约 {} 小时 {} 分钟", hours, minutes)
    } else {
        format!("约 {} 分钟", minutes.max(1))
    }
}

fn preheat_skip_message(response: &GetAccountRateLimitsResponse, now_timestamp: i64) -> String {
    match classify_weekly_window(response, now_timestamp) {
        WeeklyWindowState::Active {
            used_percent,
            resets_at,
        } => format!(
            "周限窗口已在倒计时中（已用 {}%，剩余{}），跳过预热",
            used_percent,
            format_remaining_duration(resets_at, now_timestamp)
        ),
        WeeklyWindowState::Inactive(_) => "当前周限窗口未激活，无法跳过预热".to_string(),
    }
}

fn preheat_success_message(
    final_rate_limit_result: &Result<GetAccountRateLimitsResponse, String>,
    now_timestamp: i64,
) -> String {
    match final_rate_limit_result {
        Ok(result) => match classify_weekly_window(result, now_timestamp) {
            WeeklyWindowState::Active {
                used_percent,
                resets_at,
            } => format!(
                "已发送轻量请求，周限倒计时已启动（当前 {}%，剩余{}）",
                used_percent,
                format_remaining_duration(resets_at, now_timestamp)
            ),
            WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::MissingWindow)
            | WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::MissingReset) => {
                "已发送轻量请求，但额度接口暂未返回完整周限信息".to_string()
            }
            WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::NoUsage) => {
                "已发送轻量请求，但周限暂未开始计时，请稍后刷新确认".to_string()
            }
            WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::ResetExpired) => {
                "已发送轻量请求，但返回的周限状态已过期，请稍后刷新确认".to_string()
            }
        },
        Err(_) => "已发送轻量请求，但回读额度失败，请稍后刷新确认".to_string(),
    }
}

async fn fetch_account_rate_limits_from_auth(
    client: &reqwest::Client,
    auth: &mut AuthJson,
    credentials_path: &PathBuf,
) -> Result<GetAccountRateLimitsResponse, String> {
    let mut resolved_account_id = match extract_account_id(auth) {
        Some(id) => id,
        None => {
            return Ok(invalid_account_response(invalid_account_reason(
                "凭证中缺少账号标识，请重新登录该账号。",
            )));
        }
    };

    let current_access_token = match access_token(auth) {
        Ok(token) => token.to_string(),
        Err(message) => {
            return Ok(invalid_account_response(invalid_account_reason(format!(
                "{message}，请重新登录该账号。"
            ))));
        }
    };

    match request_usage_payload(client, &current_access_token, &resolved_account_id).await {
        Ok(payload) => Ok(map_usage_payload(payload)),
        Err(err) if err.should_refresh_auth => {
            if let Err(refresh_err) = refresh_auth_tokens(client, auth).await {
                if refresh_err.invalid_account {
                    return Ok(invalid_account_response(invalid_account_reason(
                        refresh_err.message,
                    )));
                }
                return Err(refresh_err.message);
            }

            resolved_account_id = match extract_account_id(auth) {
                Some(id) => id,
                None => {
                    return Ok(invalid_account_response(invalid_account_reason(
                        "刷新后仍无法识别账号标识，请重新登录该账号。",
                    )));
                }
            };
            persist_auth(credentials_path, auth).await?;
            let refreshed_access_token = match access_token(auth) {
                Ok(token) => token.to_string(),
                Err(message) => {
                    return Ok(invalid_account_response(invalid_account_reason(format!(
                        "{message}，请重新登录该账号。"
                    ))));
                }
            };

            match request_usage_payload(client, &refreshed_access_token, &resolved_account_id).await
            {
                Ok(payload) => Ok(map_usage_payload(payload)),
                Err(refresh_err)
                    if refresh_err.should_refresh_auth || refresh_err.invalid_account =>
                {
                    Ok(invalid_account_response(invalid_account_reason(
                        refresh_err.message,
                    )))
                }
                Err(refresh_err) => Err(format!(
                    "{} | 刷新令牌后重试仍失败: {}",
                    err.message, refresh_err.message
                )),
            }
        }
        Err(err) if err.invalid_account => Ok(invalid_account_response(invalid_account_reason(
            err.message,
        ))),
        Err(err) => Err(err.message),
    }
}

fn pick_nearest_window(windows: &[UsageWindowRaw], target_seconds: i64) -> Option<UsageWindowRaw> {
    windows
        .iter()
        .min_by_key(|window| (window.limit_window_seconds - target_seconds).abs())
        .cloned()
}

fn to_usage_window(window: UsageWindowRaw) -> RateLimitWindow {
    RateLimitWindow {
        used_percent: window.used_percent.round() as i32,
        resets_at: Some(window.reset_at),
        window_duration_mins: Some(window.limit_window_seconds / 60),
    }
}

fn map_usage_payload(payload: UsageApiResponse) -> GetAccountRateLimitsResponse {
    let mut windows: Vec<UsageWindowRaw> = Vec::new();

    if let Some(rate_limit) = payload.rate_limit {
        if let Some(primary) = rate_limit.primary_window {
            windows.push(primary);
        }
        if let Some(secondary) = rate_limit.secondary_window {
            windows.push(secondary);
        }
    }

    if let Some(additional) = payload.additional_rate_limits {
        for limit in additional {
            if let Some(rate_limit) = limit.rate_limit {
                if let Some(primary) = rate_limit.primary_window {
                    windows.push(primary);
                }
                if let Some(secondary) = rate_limit.secondary_window {
                    windows.push(secondary);
                }
            }
        }
    }

    let snapshot = RateLimitSnapshot {
        limit_id: Some("codex".to_string()),
        limit_name: None,
        plan_type: payload.plan_type,
        credits: payload.credits.map(|credit| CreditsSnapshot {
            has_credits: Some(credit.has_credits),
            unlimited: Some(credit.unlimited),
            balance: credit.balance,
        }),
        primary: pick_nearest_window(&windows, 5 * 60 * 60).map(to_usage_window),
        secondary: pick_nearest_window(&windows, 7 * 24 * 60 * 60).map(to_usage_window),
    };

    let mut by_limit_id = HashMap::new();
    by_limit_id.insert("codex".to_string(), snapshot.clone());

    GetAccountRateLimitsResponse {
        rate_limits: Some(snapshot),
        rate_limits_by_limit_id: Some(by_limit_id),
        account_status: Some(AccountRateLimitStatus::Available),
        account_status_reason: None,
    }
}

fn invalid_account_response(reason: String) -> GetAccountRateLimitsResponse {
    GetAccountRateLimitsResponse {
        rate_limits: None,
        rate_limits_by_limit_id: None,
        account_status: Some(AccountRateLimitStatus::Invalid),
        account_status_reason: Some(reason),
    }
}

#[tauri::command]
pub async fn read_account_rate_limits(
    app: AppHandle,
    account_id: String,
) -> Result<GetAccountRateLimitsResponse, String> {
    let settings = accounts::load_settings(app.clone()).await?;
    let client = build_http_client(&settings)?;
    let (credentials_path, mut auth) = load_account_auth(&app, &account_id).await?;
    fetch_account_rate_limits_from_auth(&client, &mut auth, &credentials_path).await
}

fn preheat_result(
    account_id: String,
    outcome: AccountPreheatStatus,
    message: impl Into<String>,
    checked_at: String,
    rate_limit_result: Option<GetAccountRateLimitsResponse>,
) -> PreheatAccountResult {
    PreheatAccountResult {
        account_id,
        outcome,
        message: message.into(),
        checked_at,
        rate_limit_result,
    }
}

async fn preheat_single_account(
    app: &AppHandle,
    client: &reqwest::Client,
    account_id: String,
) -> PreheatAccountResult {
    let checked_at = chrono::Utc::now().to_rfc3339();
    let now_timestamp = chrono::Utc::now().timestamp();
    let (credentials_path, mut auth) = match load_account_auth(app, &account_id).await {
        Ok(value) => value,
        Err(message) => {
            return preheat_result(
                account_id,
                AccountPreheatStatus::Error,
                message,
                checked_at,
                None,
            );
        }
    };

    let initial_rate_limit_result =
        fetch_account_rate_limits_from_auth(client, &mut auth, &credentials_path).await;

    if let Ok(rate_limit_result) = initial_rate_limit_result.as_ref() {
        if rate_limit_result.account_status == Some(AccountRateLimitStatus::Invalid) {
            return preheat_result(
                account_id,
                AccountPreheatStatus::Error,
                rate_limit_result
                    .account_status_reason
                    .clone()
                    .unwrap_or_else(|| "账号已失效或不可用".to_string()),
                checked_at,
                Some(rate_limit_result.clone()),
            );
        }

        if weekly_window_is_active(rate_limit_result) {
            return preheat_result(
                account_id,
                AccountPreheatStatus::Skipped,
                preheat_skip_message(rate_limit_result, now_timestamp),
                checked_at,
                Some(rate_limit_result.clone()),
            );
        }
    }

    let resolved_account_id = match extract_account_id(&auth) {
        Some(id) => id,
        None => {
            return preheat_result(
                account_id,
                AccountPreheatStatus::Error,
                invalid_account_reason("凭证中缺少账号标识，请重新登录该账号。"),
                checked_at,
                initial_rate_limit_result.ok(),
            );
        }
    };

    let current_access_token = match access_token(&auth) {
        Ok(token) => token.to_string(),
        Err(message) => {
            return preheat_result(
                account_id,
                AccountPreheatStatus::Error,
                invalid_account_reason(format!("{message}，请重新登录该账号。")),
                checked_at,
                initial_rate_limit_result.ok(),
            );
        }
    };

    let request_result = match request_preheat_payload(client, &current_access_token, &resolved_account_id)
        .await
    {
        Ok(()) => Ok(()),
        Err(err) if err.should_refresh_auth => {
            if let Err(refresh_err) = refresh_auth_tokens(client, &mut auth).await {
                if refresh_err.invalid_account {
                    return preheat_result(
                        account_id,
                        AccountPreheatStatus::Error,
                        invalid_account_reason(refresh_err.message),
                        checked_at,
                        initial_rate_limit_result.ok(),
                    );
                }
                return preheat_result(
                    account_id,
                    AccountPreheatStatus::Error,
                    refresh_err.message,
                    checked_at,
                    initial_rate_limit_result.ok(),
                );
            }

            if let Err(message) = persist_auth(&credentials_path, &auth).await {
                return preheat_result(
                    account_id,
                    AccountPreheatStatus::Error,
                    message,
                    checked_at,
                    initial_rate_limit_result.ok(),
                );
            }

            let refreshed_access_token = match access_token(&auth) {
                Ok(token) => token.to_string(),
                Err(message) => {
                    return preheat_result(
                        account_id,
                        AccountPreheatStatus::Error,
                        invalid_account_reason(format!("{message}，请重新登录该账号。")),
                        checked_at,
                        initial_rate_limit_result.ok(),
                    );
                }
            };

            request_preheat_payload(client, &refreshed_access_token, &resolved_account_id)
                .await
                .map_err(|err| err.message)
        }
        Err(err) if err.invalid_account => {
            return preheat_result(
                account_id,
                AccountPreheatStatus::Error,
                invalid_account_reason(err.message),
                checked_at,
                initial_rate_limit_result.ok(),
            );
        }
        Err(err) => Err(err.message),
    };

    if let Err(message) = request_result {
        return preheat_result(
            account_id,
            AccountPreheatStatus::Error,
            message,
            checked_at,
            initial_rate_limit_result.ok(),
        );
    }

    let final_rate_limit_result =
        fetch_account_rate_limits_from_auth(client, &mut auth, &credentials_path).await;
    let message = preheat_success_message(&final_rate_limit_result, now_timestamp);

    preheat_result(
        account_id,
        AccountPreheatStatus::Success,
        message,
        checked_at,
        final_rate_limit_result.ok().or_else(|| initial_rate_limit_result.ok()),
    )
}

#[tauri::command]
pub async fn preheat_accounts(app: AppHandle) -> Result<PreheatAccountsResponse, String> {
    let store = accounts::load_accounts(app.clone()).await?;
    if store.accounts.is_empty() {
        return Ok(PreheatAccountsResponse {
            results: Vec::new(),
            success_count: 0,
            skipped_count: 0,
            error_count: 0,
        });
    }

    let settings = accounts::load_settings(app.clone()).await?;
    let client = build_http_client(&settings)?;
    let total_accounts = store.accounts.len();
    let mut results = Vec::with_capacity(total_accounts);

    for (index, account) in store.accounts.into_iter().enumerate() {
        results.push(preheat_single_account(&app, &client, account.id).await);
        if index + 1 < total_accounts {
            tokio::time::sleep(std::time::Duration::from_millis(PREHEAT_REQUEST_GAP_MS)).await;
        }
    }

    let success_count = results
        .iter()
        .filter(|item| item.outcome == AccountPreheatStatus::Success)
        .count();
    let skipped_count = results
        .iter()
        .filter(|item| item.outcome == AccountPreheatStatus::Skipped)
        .count();
    let error_count = results
        .iter()
        .filter(|item| item.outcome == AccountPreheatStatus::Error)
        .count();

    Ok(PreheatAccountsResponse {
        results,
        success_count,
        skipped_count,
        error_count,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        classify_weekly_window, preheat_skip_message, preheat_success_message,
        weekly_window_is_active, WeeklyWindowInactiveReason, WeeklyWindowState,
    };
    use crate::models::{GetAccountRateLimitsResponse, RateLimitSnapshot, RateLimitWindow};

    fn response_with_secondary(used_percent: i32, resets_at: Option<i64>) -> GetAccountRateLimitsResponse {
        GetAccountRateLimitsResponse {
            rate_limits: Some(RateLimitSnapshot {
                limit_id: Some("codex".to_string()),
                limit_name: None,
                plan_type: Some("plus".to_string()),
                credits: None,
                primary: None,
                secondary: Some(RateLimitWindow {
                    used_percent,
                    resets_at,
                    window_duration_mins: Some(7 * 24 * 60),
                }),
            }),
            rate_limits_by_limit_id: None,
            account_status: None,
            account_status_reason: None,
        }
    }

    #[test]
    fn weekly_window_requires_usage_and_future_reset() {
        let now = chrono::Utc::now().timestamp();

        assert!(!weekly_window_is_active(&response_with_secondary(0, Some(now + 3600))));
        assert!(!weekly_window_is_active(&response_with_secondary(12, Some(now - 60))));
        assert!(weekly_window_is_active(&response_with_secondary(12, Some(now + 3600))));
    }

    #[test]
    fn weekly_window_reports_inactive_reasons() {
        let now = chrono::Utc::now().timestamp();

        assert_eq!(
            classify_weekly_window(
                &GetAccountRateLimitsResponse {
                    rate_limits: None,
                    rate_limits_by_limit_id: None,
                    account_status: None,
                    account_status_reason: None,
                },
                now
            ),
            WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::MissingWindow)
        );
        assert_eq!(
            classify_weekly_window(&response_with_secondary(10, None), now),
            WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::MissingReset)
        );
        assert_eq!(
            classify_weekly_window(&response_with_secondary(0, Some(now + 600)), now),
            WeeklyWindowState::Inactive(WeeklyWindowInactiveReason::NoUsage)
        );
    }

    #[test]
    fn preheat_messages_explain_skip_and_unsynced_states() {
        let now = chrono::Utc::now().timestamp();

        let skipped = preheat_skip_message(&response_with_secondary(12, Some(now + 3600)), now);
        assert!(skipped.contains("已用 12%"));
        assert!(skipped.contains("跳过预热"));

        let pending = preheat_success_message(&Ok(response_with_secondary(0, Some(now + 3600))), now);
        assert!(pending.contains("暂未开始计时"));

        let failed_readback = preheat_success_message(&Err("boom".to_string()), now);
        assert!(failed_readback.contains("回读额度失败"));
    }
}
