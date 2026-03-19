use serde::Deserialize;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::commands::paths::{app_data_dir, home_codex_dir};
use crate::models::{RestoreResult, SessionInfo, SnapshotMeta, SnapshotResult, SwitchResult};

// ─── Path helpers ─────────────────────────────────────────────────────────────

fn live_sessions_dir() -> Result<PathBuf, String> {
    home_codex_dir().map(|d| d.join("sessions"))
}

/// Validates that account_id is a well-formed UUID to prevent path traversal.
fn validate_uuid(account_id: &str) -> Result<String, String> {
    Uuid::parse_str(account_id)
        .map(|u| u.to_string())
        .map_err(|_| format!("Invalid account_id: must be a UUID (got {:?})", account_id))
}

fn account_snapshot_dir(app: &AppHandle, account_id: &str) -> Result<PathBuf, String> {
    let id = validate_uuid(account_id)?;
    app_data_dir(app).map(|d| d.join("sessions").join(id))
}

// ─── Directory copy (blocking, runs in spawn_blocking) ───────────────────────

fn copy_dir_recursive(from: &PathBuf, to: &PathBuf) -> Result<(u32, u64), std::io::Error> {
    let mut file_count = 0u32;
    let mut total_bytes = 0u64;

    for entry in WalkDir::new(from).min_depth(1) {
        let entry = entry?;
        let relative = entry
            .path()
            .strip_prefix(from)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let dest = to.join(relative);

        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let bytes = std::fs::copy(entry.path(), &dest)?;
            file_count += 1;
            total_bytes += bytes;
        }
    }

    Ok((file_count, total_bytes))
}

fn count_dir(path: &PathBuf) -> (u32, u64) {
    if !path.exists() {
        return (0, 0);
    }
    let mut file_count = 0u32;
    let mut total_bytes = 0u64;
    for entry in WalkDir::new(path).min_depth(1) {
        if let Ok(e) = entry {
            if e.file_type().is_file() {
                if let Ok(meta) = e.metadata() {
                    file_count += 1;
                    total_bytes += meta.len();
                }
            }
        }
    }
    (file_count, total_bytes)
}

#[derive(Debug, Deserialize)]
struct SessionIndexEntry {
    id: String,
    #[serde(default)]
    thread_name: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
}

async fn latest_shared_session() -> Result<Option<SessionIndexEntry>, String> {
    let path = home_codex_dir()?.join("session_index.jsonl");
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).await.map_err(|e| e.to_string())?;

    for line in content.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(entry) = serde_json::from_str::<SessionIndexEntry>(trimmed) {
            return Ok(Some(entry));
        }
    }

    Ok(None)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async fn snapshot_sessions_inner(
    app: &AppHandle,
    account_id: &str,
) -> Result<SnapshotResult, String> {
    let src = live_sessions_dir()?;
    let dst = account_snapshot_dir(app, account_id)?;
    let snapshot_parent = dst
        .parent()
        .ok_or_else(|| "Invalid snapshot destination".to_string())?
        .to_path_buf();
    let temp_name = format!(
        "{}.tmp-{}",
        dst.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Invalid snapshot directory name".to_string())?,
        Uuid::new_v4()
    );
    let temp_dst = snapshot_parent.join(temp_name);
    let backup_name = format!(
        "{}.bak-{}",
        dst.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Invalid snapshot directory name".to_string())?,
        Uuid::new_v4()
    );
    let backup_dst = snapshot_parent.join(backup_name);

    // Ensure source exists
    fs::create_dir_all(&src).await.map_err(|e| e.to_string())?;
    // Build snapshot in a temp directory first, so a failed copy does not destroy the last good snapshot.
    if temp_dst.exists() {
        fs::remove_dir_all(&temp_dst)
            .await
            .map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&temp_dst)
        .await
        .map_err(|e| e.to_string())?;

    let src_clone = src.clone();
    let dst_clone = temp_dst.clone();
    let (file_count, total_bytes) =
        tokio::task::spawn_blocking(move || copy_dir_recursive(&src_clone, &dst_clone))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

    let snapshot_time = chrono::Utc::now().to_rfc3339();

    // Write meta
    let meta = SnapshotMeta {
        file_count,
        total_bytes,
        snapshot_at: snapshot_time.clone(),
    };
    let meta_path = temp_dst.join(".snapshot_meta.json");
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(meta_path, meta_json)
        .await
        .map_err(|e| e.to_string())?;

    let had_existing_snapshot = dst.exists();
    if had_existing_snapshot {
        if backup_dst.exists() {
            fs::remove_dir_all(&backup_dst)
                .await
                .map_err(|e| e.to_string())?;
        }
        fs::rename(&dst, &backup_dst)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Err(rename_error) = fs::rename(&temp_dst, &dst).await {
        if had_existing_snapshot && backup_dst.exists() {
            let _ = fs::rename(&backup_dst, &dst).await;
        }
        if temp_dst.exists() {
            let _ = fs::remove_dir_all(&temp_dst).await;
        }
        return Err(rename_error.to_string());
    }

    if had_existing_snapshot && backup_dst.exists() {
        fs::remove_dir_all(&backup_dst)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(SnapshotResult {
        file_count,
        total_bytes,
        snapshot_time,
    })
}

async fn restore_sessions_inner(
    app: &AppHandle,
    account_id: &str,
) -> Result<RestoreResult, String> {
    let dst = live_sessions_dir()?;
    let src = account_snapshot_dir(app, account_id)?;

    // Clear live sessions
    if dst.exists() {
        fs::remove_dir_all(&dst).await.map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&dst).await.map_err(|e| e.to_string())?;

    let restore_time = chrono::Utc::now().to_rfc3339();

    if !src.exists() {
        // No snapshot — just leave sessions empty
        return Ok(RestoreResult {
            file_count: 0,
            total_bytes: 0,
            restore_time,
        });
    }

    let src_clone = src.clone();
    let dst_clone = dst.clone();
    let (file_count, total_bytes) =
        tokio::task::spawn_blocking(move || copy_dir_recursive(&src_clone, &dst_clone))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

    Ok(RestoreResult {
        file_count,
        total_bytes,
        restore_time,
    })
}

async fn write_auth_json_inner(content: &str) -> Result<(), String> {
    let path = home_codex_dir()?.join("auth.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    fs::write(path, content).await.map_err(|e| e.to_string())
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn snapshot_sessions(
    app: AppHandle,
    account_id: String,
) -> Result<SnapshotResult, String> {
    snapshot_sessions_inner(&app, &account_id).await
}

#[tauri::command]
pub async fn restore_sessions(app: AppHandle, account_id: String) -> Result<RestoreResult, String> {
    restore_sessions_inner(&app, &account_id).await
}

#[tauri::command]
pub async fn switch_account(
    _app: AppHandle,
    lock: tauri::State<'_, crate::SwitchLock>,
    _from_id: Option<String>,
    _to_id: String,
    to_auth: String,
) -> Result<SwitchResult, String> {
    let _guard = lock.0.lock().await; // serialize all switch operations
    let sessions_dir = live_sessions_dir()?;
    let snapshot_time = chrono::Utc::now().to_rfc3339();
    let snapshot_dir = sessions_dir.clone();
    let (snapshot_file_count, snapshot_total_bytes) =
        tokio::task::spawn_blocking(move || count_dir(&snapshot_dir))
            .await
            .map_err(|e| e.to_string())?;

    let snapshot = SnapshotResult {
        file_count: snapshot_file_count,
        total_bytes: snapshot_total_bytes,
        snapshot_time,
    };

    // Switching accounts now preserves the shared ~/.codex/sessions store and only swaps auth.json.
    let current_auth_backup = fs::read_to_string(home_codex_dir()?.join("auth.json"))
        .await
        .ok();

    if let Err(e) = write_auth_json_inner(&to_auth).await {
        if let Some(backup) = current_auth_backup {
            let _ = write_auth_json_inner(&backup).await;
        }
        return Err(format!("Write auth failed: {}", e));
    }

    let restore_time = chrono::Utc::now().to_rfc3339();
    let restore_dir = sessions_dir.clone();
    let (restore_file_count, restore_total_bytes) =
        tokio::task::spawn_blocking(move || count_dir(&restore_dir))
            .await
            .map_err(|e| e.to_string())?;

    let restore = RestoreResult {
        file_count: restore_file_count,
        total_bytes: restore_total_bytes,
        restore_time,
    };

    Ok(SwitchResult {
        success: true,
        snapshot,
        restore,
        error: None,
    })
}

#[tauri::command]
pub async fn list_account_session_info(
    app: AppHandle,
    account_id: String,
) -> Result<Option<SessionInfo>, String> {
    let snapshot_dir = account_snapshot_dir(&app, &account_id)?;
    let meta_path = snapshot_dir.join(".snapshot_meta.json");

    if !meta_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&meta_path)
        .await
        .map_err(|e| e.to_string())?;
    let meta: SnapshotMeta = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(SessionInfo {
        file_count: meta.file_count,
        total_bytes: meta.total_bytes,
        last_snapshot_at: Some(meta.snapshot_at),
        current_session_id: None,
        current_thread_name: None,
        current_updated_at: None,
    }))
}

#[tauri::command]
pub async fn get_current_sessions_info() -> Result<SessionInfo, String> {
    let sessions_dir = live_sessions_dir()?;
    let dir_clone = sessions_dir.clone();
    let (file_count, total_bytes) = tokio::task::spawn_blocking(move || count_dir(&dir_clone))
        .await
        .map_err(|e| e.to_string())?;
    let latest_session = latest_shared_session().await?;

    Ok(SessionInfo {
        file_count,
        total_bytes,
        last_snapshot_at: None,
        current_session_id: latest_session.as_ref().map(|entry| entry.id.clone()),
        current_thread_name: latest_session
            .as_ref()
            .and_then(|entry| entry.thread_name.clone()),
        current_updated_at: latest_session
            .as_ref()
            .and_then(|entry| entry.updated_at.clone()),
    })
}

#[tauri::command]
pub async fn delete_account_sessions(app: AppHandle, account_id: String) -> Result<(), String> {
    let path = account_snapshot_dir(&app, &account_id)?;
    if path.exists() {
        fs::remove_dir_all(&path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
