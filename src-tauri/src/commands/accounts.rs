use chrono::{TimeZone, Utc};
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;
use uuid::Uuid;

use crate::atomic_io::write_text_atomic_async;
use crate::commands::paths::{app_data_dir, home_codex_dir};
use crate::models::{AccountsStore, AppSettings};

/// Validates that account_id is a well-formed UUID to prevent path traversal.
fn validate_uuid(account_id: &str) -> Result<String, String> {
    Uuid::parse_str(account_id)
        .map(|u| u.to_string())
        .map_err(|_| format!("Invalid account_id: must be a UUID (got {:?})", account_id))
}

fn accounts_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app).map(|d| d.join("accounts.json"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app).map(|d| d.join("settings.json"))
}

fn credentials_path(app: &AppHandle, account_id: &str) -> Result<PathBuf, String> {
    let id = validate_uuid(account_id)?;
    app_data_dir(app).map(|d| d.join("credentials").join(format!("{}.json", id)))
}

fn auth_json_path() -> Result<PathBuf, String> {
    home_codex_dir().map(|d| d.join("auth.json"))
}

fn format_last_refresh(value: i64) -> Option<String> {
    let dt = if value > 1_000_000_000_000 {
        Utc.timestamp_millis_opt(value).single()
    } else {
        Utc.timestamp_opt(value, 0).single()
    }?;
    Some(dt.to_rfc3339())
}

fn normalize_auth_json_content(content: &str) -> Result<(String, bool), String> {
    let mut value: Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    let Some(object) = value.as_object_mut() else {
        return Ok((content.to_string(), false));
    };

    let mut changed = false;
    if let Some(last_refresh) = object.get_mut("last_refresh") {
        match last_refresh {
            Value::Number(number) => {
                if let Some(raw) = number.as_i64().and_then(format_last_refresh) {
                    *last_refresh = Value::String(raw);
                    changed = true;
                }
            }
            Value::String(text) => {
                if let Ok(number) = text.parse::<i64>() {
                    if let Some(raw) = format_last_refresh(number) {
                        *last_refresh = Value::String(raw);
                        changed = true;
                    }
                }
            }
            _ => {}
        }
    }

    if !changed {
        return Ok((content.to_string(), false));
    }

    serde_json::to_string_pretty(&value)
        .map(|normalized| (normalized, true))
        .map_err(|e| e.to_string())
}

async fn read_auth_file_normalized(path: &PathBuf) -> Result<String, String> {
    let content = fs::read_to_string(path).await.map_err(|e| e.to_string())?;
    let (normalized, changed) = normalize_auth_json_content(&content)?;
    if changed {
        write_text_atomic_async(path.clone(), normalized.clone()).await?;
    }
    Ok(normalized)
}

async fn write_auth_file_normalized(path: &PathBuf, content: String) -> Result<(), String> {
    let (normalized, _) = normalize_auth_json_content(&content)?;
    write_text_atomic_async(path.clone(), normalized).await
}

fn default_settings() -> AppSettings {
    AppSettings {
        auto_refresh_interval: 0,
        auto_restart_codex_after_switch: true,
        auto_restart_vscode_after_switch: false,
        theme: "system".to_string(),
        proxy_url: String::new(),
    }
}

#[tauri::command]
pub async fn load_accounts(app: AppHandle) -> Result<AccountsStore, String> {
    let path = accounts_path(&app)?;
    if !path.exists() {
        return Ok(AccountsStore {
            version: "1.0".to_string(),
            accounts: vec![],
        });
    }
    let content = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_accounts(app: AppHandle, data: AccountsStore) -> Result<(), String> {
    let path = accounts_path(&app)?;
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_text_atomic_async(path, content).await
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(default_settings());
    }

    let content = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, data: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_text_atomic_async(path, content).await
}

#[tauri::command]
pub async fn read_auth_json() -> Result<String, String> {
    let path = auth_json_path()?;
    if !path.exists() {
        return Err("~/.codex/auth.json not found".to_string());
    }
    read_auth_file_normalized(&path).await
}

#[tauri::command]
pub async fn write_auth_json(content: String) -> Result<(), String> {
    let path = auth_json_path()?;
    write_auth_file_normalized(&path, content).await
}

#[tauri::command]
pub async fn save_account_credentials(
    app: AppHandle,
    account_id: String,
    content: String,
) -> Result<(), String> {
    let path = credentials_path(&app, &account_id)?;
    write_auth_file_normalized(&path, content).await
}

#[tauri::command]
pub async fn read_account_credentials(
    app: AppHandle,
    account_id: String,
) -> Result<String, String> {
    let path = credentials_path(&app, &account_id)?;
    if !path.exists() {
        return Err(format!("Credentials not found for account {}", account_id));
    }
    read_auth_file_normalized(&path).await
}

#[tauri::command]
pub async fn delete_account_credentials(app: AppHandle, account_id: String) -> Result<(), String> {
    let path = credentials_path(&app, &account_id)?;
    if path.exists() {
        fs::remove_file(&path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_auth_json_content;
    use serde_json::Value;

    #[test]
    fn normalizes_numeric_last_refresh_to_rfc3339() {
        let (normalized, changed) =
            normalize_auth_json_content(r#"{"last_refresh":1700000000000,"tokens":{}}"#)
                .expect("normalize");

        assert!(changed);
        let parsed: Value = serde_json::from_str(&normalized).expect("json");
        let last_refresh = parsed
            .get("last_refresh")
            .and_then(Value::as_str)
            .expect("last_refresh string");
        assert!(last_refresh.contains('T'));
    }

    #[test]
    fn leaves_rfc3339_last_refresh_untouched() {
        let raw = r#"{"last_refresh":"2026-03-25T08:00:00+00:00","tokens":{}}"#;
        let (normalized, changed) = normalize_auth_json_content(raw).expect("normalize");

        assert!(!changed);
        assert_eq!(normalized, raw);
    }
}
