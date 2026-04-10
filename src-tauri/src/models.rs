use chrono::TimeZone;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── IPC structs (camelCase for JS interop) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub user_id: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub last_switched_at: Option<String>,
    pub session_info: Option<SessionInfo>,
    #[serde(default)]
    pub usage_ledger: Option<AccountUsageLedger>,
    #[serde(default)]
    pub last_preheat_at: Option<String>,
    #[serde(default)]
    pub preheat_status: Option<AccountPreheatStatus>,
    #[serde(default)]
    pub preheat_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub file_count: u32,
    pub total_bytes: u64,
    #[serde(alias = "lastSnapshotAt")]
    pub last_session_observed_at: Option<String>,
    pub current_session_id: Option<String>,
    pub current_thread_name: Option<String>,
    pub current_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsageLedger {
    pub accumulated: TokenUsageInfo,
    pub segment_start: Option<TokenUsageInfo>,
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsStore {
    pub version: String,
    pub accounts: Vec<Account>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub file_count: u32,
    pub total_bytes: u64,
    pub snapshot_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub file_count: u32,
    pub total_bytes: u64,
    pub restore_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub success: bool,
    pub snapshot: SnapshotResult,
    pub restore: RestoreResult,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    pub auth_json: String,
    pub email: Option<String>,
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub auto_refresh_interval: u32,
    #[serde(default)]
    pub auto_preheat_interval_hours: u32,
    #[serde(default = "default_auto_restart_codex_after_switch")]
    pub auto_restart_codex_after_switch: bool,
    pub theme: String,
    pub proxy_url: String,
}

fn default_auto_restart_codex_after_switch() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPlatformCapabilities {
    pub platform: String,
    pub supports_auto_restart_codex_desktop: bool,
    pub supports_resume_session_in_terminal: bool,
    pub supports_system_tray: bool,
    pub supports_taskbar_shortcuts: bool,
    pub supports_dock_menu: bool,
    pub supports_app_indicator: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditsSnapshot {
    pub has_credits: Option<bool>,
    pub unlimited: Option<bool>,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitWindow {
    pub used_percent: i32,
    pub resets_at: Option<i64>,
    pub window_duration_mins: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitSnapshot {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub plan_type: Option<String>,
    pub credits: Option<CreditsSnapshot>,
    pub primary: Option<RateLimitWindow>,
    pub secondary: Option<RateLimitWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountRateLimitStatus {
    Available,
    Invalid,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountPreheatStatus {
    Success,
    Skipped,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountRateLimitsResponse {
    pub rate_limits: Option<RateLimitSnapshot>,
    pub rate_limits_by_limit_id: Option<std::collections::HashMap<String, RateLimitSnapshot>>,
    #[serde(default)]
    pub account_status: Option<AccountRateLimitStatus>,
    #[serde(default)]
    pub account_status_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreheatAccountResult {
    pub account_id: String,
    pub outcome: AccountPreheatStatus,
    pub message: String,
    pub checked_at: String,
    #[serde(default)]
    pub rate_limit_result: Option<GetAccountRateLimitsResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreheatAccountsResponse {
    pub results: Vec<PreheatAccountResult>,
    pub success_count: usize,
    pub skipped_count: usize,
    pub error_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageInfo {
    #[serde(alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(alias = "cached_input_tokens")]
    pub cached_input_tokens: u64,
    #[serde(alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(alias = "reasoning_output_tokens")]
    pub reasoning_output_tokens: u64,
    #[serde(alias = "total_tokens")]
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageSummary {
    pub model: String,
    pub sessions: u32,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatsSummary {
    pub sessions_analyzed: u32,
    pub latest_model: Option<String>,
    pub total_tokens: TokenUsageInfo,
    pub latest_total_tokens: Option<TokenUsageInfo>,
    pub models: Vec<ModelUsageSummary>,
}

// ─── File-format structs (snake_case, matches on-disk JSON) ──────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthJson {
    pub auth_mode: String,
    pub tokens: Option<AuthTokens>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_last_refresh",
        serialize_with = "serialize_last_refresh"
    )]
    pub last_refresh: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthTokens {
    pub access_token: Option<String>,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
}

/// Stored at `<app_data>/sessions/<id>/.snapshot_meta.json`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub file_count: u32,
    pub total_bytes: u64,
    pub snapshot_at: String,
}

/// Response from OAuth token endpoint
#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_in: Option<u64>,
}

fn deserialize_last_refresh<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => Ok(number.as_i64()),
        Some(Value::String(text)) => {
            if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&text) {
                return Ok(Some(parsed.timestamp_millis()));
            }
            if let Ok(parsed) = text.parse::<i64>() {
                return Ok(Some(parsed));
            }
            Ok(None)
        }
        _ => Ok(None),
    }
}

fn serialize_last_refresh<S>(value: &Option<i64>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match value {
        Some(raw) => {
            let dt = if *raw > 1_000_000_000_000 {
                chrono::Utc.timestamp_millis_opt(*raw).single()
            } else {
                chrono::Utc.timestamp_opt(*raw, 0).single()
            };

            match dt {
                Some(parsed) => serializer.serialize_some(&parsed.to_rfc3339()),
                None => serializer.serialize_none(),
            }
        }
        None => serializer.serialize_none(),
    }
}
