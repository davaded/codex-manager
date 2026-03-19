use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub fn home_codex_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".codex"))
        .ok_or_else(|| "Cannot resolve home directory".to_string())
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_codex_dir() -> Result<String, String> {
    home_codex_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_sessions_dir() -> Result<String, String> {
    home_codex_dir().map(|p| p.join("sessions").to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_account_sessions_dir(app: AppHandle, account_id: String) -> Result<String, String> {
    app_data_dir(&app).map(|p| {
        p.join("sessions")
            .join(&account_id)
            .to_string_lossy()
            .to_string()
    })
}
