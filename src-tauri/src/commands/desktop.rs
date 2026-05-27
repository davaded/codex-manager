use crate::{models::DesktopPlatformCapabilities, platform::codex};

#[tauri::command]
pub fn get_platform_capabilities() -> DesktopPlatformCapabilities {
    codex::desktop_platform_capabilities()
}

#[tauri::command]
pub async fn restart_codex_desktop() -> Result<(), String> {
    tokio::task::spawn_blocking(codex::restart_codex_desktop)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restart_vscode() -> Result<(), String> {
    tokio::task::spawn_blocking(codex::restart_vscode)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resume_session_in_terminal(session_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || codex::resume_session_in_terminal(session_id))
        .await
        .map_err(|e| e.to_string())?
}
