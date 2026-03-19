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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub file_count: u32,
    pub total_bytes: u64,
    pub last_snapshot_at: Option<String>,
    pub current_session_id: Option<String>,
    pub current_thread_name: Option<String>,
    pub current_updated_at: Option<String>,
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
    #[serde(default = "default_auto_restart_codex_after_switch")]
    pub auto_restart_codex_after_switch: bool,
    pub theme: String,
    pub proxy_url: String,
}

fn default_auto_restart_codex_after_switch() -> bool {
    true
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountRateLimitsResponse {
    pub rate_limits: RateLimitSnapshot,
    pub rate_limits_by_limit_id: Option<std::collections::HashMap<String, RateLimitSnapshot>>,
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
