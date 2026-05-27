use std::{collections::HashMap, error::Error as StdError, path::PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;
use tokio::fs;
use uuid::Uuid;

use crate::{
    atomic_io::write_text_atomic_async,
    commands::{accounts, paths::app_data_dir},
    models::{
        AccountRateLimitStatus, AuthJson, CreditsSnapshot, DailyWorkspaceUsageResponse,
        GetAccountRateLimitsResponse, RateLimitSnapshot, RateLimitWindow, TokenResponse,
    },
    net::build_http_client,
};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_CHATGPT_BASE_URL: &str = "https://chatgpt.com";
const CODEX_USAGE_PATH: &str = "/api/codex/usage";
const WHAM_USAGE_PATH: &str = "/wham/usage";
const DAILY_WORKSPACE_USAGE_PATH: &str = "/wham/analytics/daily-workspace-usage-counts";
const BACKEND_API_PREFIX: &str = "/backend-api";

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

fn resolve_daily_workspace_usage_urls(start_date: &str, end_date: &str) -> Vec<String> {
    let normalized = resolve_chatgpt_base_origin();
    let query = format!("start_date={start_date}&end_date={end_date}&group_by=day");
    let mut candidates = Vec::new();

    if let Some(origin) = normalized.strip_suffix(BACKEND_API_PREFIX) {
        candidates.push(format!("{normalized}{DAILY_WORKSPACE_USAGE_PATH}?{query}"));
        candidates.push(format!(
            "{origin}{BACKEND_API_PREFIX}{DAILY_WORKSPACE_USAGE_PATH}?{query}"
        ));
    } else {
        candidates.push(format!(
            "{normalized}{BACKEND_API_PREFIX}{DAILY_WORKSPACE_USAGE_PATH}?{query}"
        ));
        candidates.push(format!("{normalized}{DAILY_WORKSPACE_USAGE_PATH}?{query}"));
    }

    candidates.push(format!(
        "https://chatgpt.com{BACKEND_API_PREFIX}{DAILY_WORKSPACE_USAGE_PATH}?{query}"
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

async fn request_daily_workspace_usage_payload(
    client: &reqwest::Client,
    access_token: &str,
    account_id: &str,
    start_date: &str,
    end_date: &str,
) -> Result<DailyWorkspaceUsageResponse, UsageFetchError> {
    let urls = resolve_daily_workspace_usage_urls(start_date, end_date);
    let mut errors: Vec<String> = Vec::new();
    let mut should_refresh_auth = false;
    let mut invalid_account = false;

    for url in urls {
        let response = match client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .header("ChatGPT-Account-Id", account_id)
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                errors.push(format!("{url} -> {}", format_reqwest_error(&err)));
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
                "{url} -> {status}: {}",
                truncate_for_error(&body, 160)
            ));
            continue;
        }

        let mut payload: DailyWorkspaceUsageResponse = match response.json().await {
            Ok(payload) => payload,
            Err(err) => {
                errors.push(format!("{url} -> 解析返回失败: {err}"));
                continue;
            }
        };
        payload.start_date = start_date.to_string();
        payload.end_date = end_date.to_string();
        return Ok(payload);
    }

    let preview = if errors.is_empty() {
        "未命中任何候选地址".to_string()
    } else {
        errors.into_iter().take(2).collect::<Vec<_>>().join(" | ")
    };

    Err(UsageFetchError {
        message: format!("请求每日用量接口失败: {preview}"),
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

fn pick_nearest_window(
    windows: &[UsageWindowRaw],
    target_seconds: i64,
    max_delta_seconds: i64,
) -> Option<UsageWindowRaw> {
    windows
        .iter()
        .filter(|window| (window.limit_window_seconds - target_seconds).abs() <= max_delta_seconds)
        .min_by_key(|window| (window.limit_window_seconds - target_seconds).abs())
        .cloned()
}

fn to_usage_window(window: UsageWindowRaw) -> RateLimitWindow {
    let remaining_percent = (100.0 - window.used_percent).clamp(0.0, 100.0).round() as i32;

    RateLimitWindow {
        remaining_percent,
        used_percent: Some(window.used_percent),
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
        primary: pick_nearest_window(&windows, 5 * 60 * 60, 60 * 60).map(to_usage_window),
        secondary: pick_nearest_window(&windows, 7 * 24 * 60 * 60, 24 * 60 * 60)
            .map(to_usage_window),
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
    let credentials_path = credentials_path(&app, &account_id)?;
    let auth_json = fs::read_to_string(&credentials_path)
        .await
        .map_err(|_| format!("Credentials not found for account {}", account_id))?;
    let mut auth: AuthJson =
        serde_json::from_str(&auth_json).map_err(|e| format!("auth.json 解析失败: {e}"))?;

    let settings = accounts::load_settings(app.clone()).await?;
    let client = build_http_client(
        &settings,
        "codex-manager/1.0",
        std::time::Duration::from_secs(18),
    )?;

    let mut resolved_account_id = match extract_account_id(&auth) {
        Some(id) => id,
        None => {
            return Ok(invalid_account_response(invalid_account_reason(
                "凭证中缺少账号标识，请重新登录该账号。",
            )));
        }
    };

    let current_access_token = match access_token(&auth) {
        Ok(token) => token.to_string(),
        Err(message) => {
            return Ok(invalid_account_response(invalid_account_reason(format!(
                "{message}，请重新登录该账号。"
            ))));
        }
    };

    match request_usage_payload(&client, &current_access_token, &resolved_account_id).await {
        Ok(payload) => Ok(map_usage_payload(payload)),
        Err(err) if err.should_refresh_auth => {
            if let Err(refresh_err) = refresh_auth_tokens(&client, &mut auth).await {
                if refresh_err.invalid_account {
                    return Ok(invalid_account_response(invalid_account_reason(
                        refresh_err.message,
                    )));
                }
                return Err(refresh_err.message);
            }

            resolved_account_id = match extract_account_id(&auth) {
                Some(id) => id,
                None => {
                    return Ok(invalid_account_response(invalid_account_reason(
                        "刷新后仍无法识别账号标识，请重新登录该账号。",
                    )));
                }
            };
            let serialized = serde_json::to_string_pretty(&auth)
                .map_err(|e| format!("auth.json 序列化失败: {e}"))?;
            write_text_atomic_async(credentials_path.clone(), serialized)
                .await
                .map_err(|e| format!("更新账号凭证失败: {e}"))?;
            let refreshed_access_token = match access_token(&auth) {
                Ok(token) => token.to_string(),
                Err(message) => {
                    return Ok(invalid_account_response(invalid_account_reason(format!(
                        "{message}，请重新登录该账号。"
                    ))));
                }
            };

            match request_usage_payload(&client, &refreshed_access_token, &resolved_account_id)
                .await
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

#[tauri::command]
pub async fn read_account_daily_workspace_usage(
    app: AppHandle,
    account_id: String,
    days: Option<u32>,
) -> Result<DailyWorkspaceUsageResponse, String> {
    let credentials_path = credentials_path(&app, &account_id)?;
    let auth_json = fs::read_to_string(&credentials_path)
        .await
        .map_err(|_| format!("Credentials not found for account {}", account_id))?;
    let mut auth: AuthJson =
        serde_json::from_str(&auth_json).map_err(|e| format!("auth.json 解析失败: {e}"))?;

    let settings = accounts::load_settings(app.clone()).await?;
    let client = build_http_client(
        &settings,
        "codex-manager/1.0",
        std::time::Duration::from_secs(18),
    )?;

    let now = chrono::Utc::now().date_naive();
    let days_back = i64::from(days.unwrap_or(30).clamp(1, 120));
    let start_date = (now - chrono::Duration::days(days_back)).to_string();
    let end_date = (now + chrono::Duration::days(1)).to_string();

    let mut resolved_account_id = match extract_account_id(&auth) {
        Some(id) => id,
        None => return Err("凭证中缺少账号标识，请重新登录该账号。".to_string()),
    };

    let current_access_token = access_token(&auth)?.to_string();
    match request_daily_workspace_usage_payload(
        &client,
        &current_access_token,
        &resolved_account_id,
        &start_date,
        &end_date,
    )
    .await
    {
        Ok(payload) => Ok(payload),
        Err(err) if err.should_refresh_auth => {
            if let Err(refresh_err) = refresh_auth_tokens(&client, &mut auth).await {
                return Err(refresh_err.message);
            }

            resolved_account_id = extract_account_id(&auth)
                .ok_or_else(|| "刷新后仍无法识别账号标识，请重新登录该账号。".to_string())?;
            let serialized = serde_json::to_string_pretty(&auth)
                .map_err(|e| format!("auth.json 序列化失败: {e}"))?;
            write_text_atomic_async(credentials_path.clone(), serialized)
                .await
                .map_err(|e| format!("更新账号凭证失败: {e}"))?;
            let refreshed_access_token = access_token(&auth)?.to_string();

            request_daily_workspace_usage_payload(
                &client,
                &refreshed_access_token,
                &resolved_account_id,
                &start_date,
                &end_date,
            )
            .await
            .map_err(|refresh_err| {
                format!(
                    "{} | 刷新令牌后重试仍失败: {}",
                    err.message, refresh_err.message
                )
            })
        }
        Err(err) => Err(err.message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(used_percent: f64, limit_window_seconds: i64, reset_at: i64) -> UsageWindowRaw {
        UsageWindowRaw {
            used_percent,
            limit_window_seconds,
            reset_at,
        }
    }

    #[test]
    fn maps_weekly_quota_from_week_window_not_daily_window() {
        let response = map_usage_payload(UsageApiResponse {
            plan_type: Some("team".to_string()),
            rate_limit: Some(RateLimitDetails {
                primary_window: Some(window(1.0, 5 * 60 * 60, 1_800)),
                secondary_window: Some(window(0.0, 24 * 60 * 60, 86_400)),
            }),
            additional_rate_limits: Some(vec![AdditionalRateLimitDetails {
                rate_limit: Some(RateLimitDetails {
                    primary_window: None,
                    secondary_window: Some(window(41.0, 7 * 24 * 60 * 60, 604_800)),
                }),
            }]),
            credits: None,
        });

        let snapshot = response.rate_limits.expect("rate limits should be present");
        assert_eq!(snapshot.primary.expect("primary").remaining_percent, 99);

        let weekly = snapshot.secondary.expect("weekly");
        assert_eq!(weekly.remaining_percent, 59);
        assert_eq!(weekly.resets_at, Some(604_800));
        assert_eq!(weekly.window_duration_mins, Some(7 * 24 * 60));
    }

    #[test]
    fn does_not_treat_daily_window_as_weekly_quota() {
        let response = map_usage_payload(UsageApiResponse {
            plan_type: Some("team".to_string()),
            rate_limit: Some(RateLimitDetails {
                primary_window: Some(window(1.0, 5 * 60 * 60, 1_800)),
                secondary_window: Some(window(0.0, 24 * 60 * 60, 86_400)),
            }),
            additional_rate_limits: None,
            credits: None,
        });

        let snapshot = response.rate_limits.expect("rate limits should be present");
        assert!(snapshot.secondary.is_none());
    }
}
