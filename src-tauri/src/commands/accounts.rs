use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{TimeZone, Utc};
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;
use uuid::Uuid;

use crate::commands::paths::{app_data_dir, home_codex_dir};
use crate::models::{AccountsStore, AppSettings, AuthJson};

/// Validates that account_id is a well-formed UUID to prevent path traversal.
fn validate_uuid(account_id: &str) -> Result<String, String> {
    Uuid::parse_str(account_id)
        .map(|u| u.to_string())
        .map_err(|_| format!("Invalid account_id: must be a UUID (got {:?})", account_id))
}

async fn ensure_dir(path: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(path).await.map_err(|e| e.to_string())
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

fn extract_nested_profile_claim(value: &Value, key: &str) -> Option<String> {
    value
        .get("https://api.openai.com/profile")?
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
        if let Some(value) = extract_claim_string(claims, "chatgpt_account_id") {
            return Some(value);
        }
        if let Some(value) = extract_nested_auth_claim(claims, "chatgpt_account_id") {
            return Some(value);
        }
    }

    let id_claims = auth
        .tokens
        .as_ref()?
        .id_token
        .as_deref()
        .and_then(decode_jwt_payload);
    if let Some(claims) = id_claims.as_ref() {
        if let Some(value) = extract_claim_string(claims, "chatgpt_account_id") {
            return Some(value);
        }
        if let Some(value) = extract_nested_auth_claim(claims, "chatgpt_account_id") {
            return Some(value);
        }
    }

    None
}

fn extract_email(auth: &AuthJson) -> Option<String> {
    let access_claims = auth
        .tokens
        .as_ref()?
        .access_token
        .as_deref()
        .and_then(decode_jwt_payload);
    if let Some(claims) = access_claims.as_ref() {
        if let Some(value) = extract_claim_string(claims, "email") {
            return Some(value);
        }
        if let Some(value) = extract_nested_profile_claim(claims, "email") {
            return Some(value);
        }
    }

    let id_claims = auth
        .tokens
        .as_ref()?
        .id_token
        .as_deref()
        .and_then(decode_jwt_payload);
    if let Some(claims) = id_claims.as_ref() {
        if let Some(value) = extract_claim_string(claims, "email") {
            return Some(value);
        }
        if let Some(value) = extract_nested_profile_claim(claims, "email") {
            return Some(value);
        }
    }

    None
}

fn extract_user_id(auth: &AuthJson) -> Option<String> {
    let access_claims = auth
        .tokens
        .as_ref()?
        .access_token
        .as_deref()
        .and_then(decode_jwt_payload);
    if let Some(claims) = access_claims.as_ref() {
        if let Some(value) = extract_claim_string(claims, "user_id") {
            return Some(value);
        }
        if let Some(value) = extract_nested_auth_claim(claims, "chatgpt_user_id") {
            return Some(value);
        }
        if let Some(value) = extract_nested_auth_claim(claims, "user_id") {
            return Some(value);
        }
        if let Some(value) = extract_claim_string(claims, "sub") {
            return Some(value);
        }
    }

    let id_claims = auth
        .tokens
        .as_ref()?
        .id_token
        .as_deref()
        .and_then(decode_jwt_payload);
    if let Some(claims) = id_claims.as_ref() {
        if let Some(value) = extract_claim_string(claims, "user_id") {
            return Some(value);
        }
        if let Some(value) = extract_nested_auth_claim(claims, "chatgpt_user_id") {
            return Some(value);
        }
        if let Some(value) = extract_nested_auth_claim(claims, "user_id") {
            return Some(value);
        }
        if let Some(value) = extract_claim_string(claims, "sub") {
            return Some(value);
        }
    }

    None
}

fn normalized_eq(left: Option<&str>, right: &str) -> bool {
    left.map(|value| value.trim().eq_ignore_ascii_case(right.trim()))
        .unwrap_or(false)
}

async fn migrate_account_identities(
    app: &AppHandle,
    store: &mut AccountsStore,
) -> Result<bool, String> {
    let mut changed = false;

    for account in &mut store.accounts {
        let path = match credentials_path(app, &account.id) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if !path.exists() {
            continue;
        }

        let content = match read_auth_file_normalized(&path).await {
            Ok(content) => content,
            Err(_) => continue,
        };
        let auth: AuthJson = match serde_json::from_str(&content) {
            Ok(auth) => auth,
            Err(_) => continue,
        };

        if let Some(email) = extract_email(&auth) {
            if !normalized_eq(account.email.as_deref(), &email) {
                account.email = Some(email);
                changed = true;
            }
        }

        if let Some(account_id) = extract_account_id(&auth) {
            if !normalized_eq(account.account_id.as_deref(), &account_id) {
                account.account_id = Some(account_id);
                changed = true;
            }
        }

        if let Some(user_id) = extract_user_id(&auth) {
            if !normalized_eq(account.user_id.as_deref(), &user_id) {
                account.user_id = Some(user_id);
                changed = true;
            }
        }
    }

    Ok(changed)
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
        fs::write(path, &normalized)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(normalized)
}

async fn write_auth_file_normalized(path: &PathBuf, content: String) -> Result<(), String> {
    let (normalized, _) = normalize_auth_json_content(&content)?;
    ensure_dir(&path.parent().unwrap().to_path_buf()).await?;
    fs::write(path, normalized).await.map_err(|e| e.to_string())
}

fn default_settings() -> AppSettings {
    AppSettings {
        auto_refresh_interval: 0,
        auto_restart_codex_after_switch: true,
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
    let mut store: AccountsStore = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if migrate_account_identities(&app, &mut store).await? {
        save_accounts(app.clone(), store.clone()).await?;
    }

    Ok(store)
}

#[tauri::command]
pub async fn save_accounts(app: AppHandle, data: AccountsStore) -> Result<(), String> {
    let path = accounts_path(&app)?;
    ensure_dir(&path.parent().unwrap().to_path_buf()).await?;
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, content).await.map_err(|e| e.to_string())
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
    ensure_dir(&path.parent().unwrap().to_path_buf()).await?;
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, content).await.map_err(|e| e.to_string())
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
