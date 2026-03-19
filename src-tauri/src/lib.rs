pub mod commands;
pub mod models;

use commands::{accounts, oauth, paths, sessions, usage};
use tauri::{
    menu::MenuEvent,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

/// Global mutex to serialize all operations that mutate live session/auth files,
/// preventing concurrent switches from interleaving and corrupting isolation.
#[derive(Default)]
pub struct SwitchLock(pub tokio::sync::Mutex<()>);

fn show_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}

fn toggle_tray_panel(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("tray") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(SwitchLock::default())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("index.html#tray".into()))
                .title("Codex Manager Tray")
                .inner_size(420.0, 640.0)
                .resizable(false)
                .visible(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .decorations(false)
                .build()?;

            let open_panel = MenuItemBuilder::with_id("open_panel", "打开快速面板").build(app)?;
            let open_main = MenuItemBuilder::with_id("open_main", "打开主窗口").build(app)?;
            let hide_panel = MenuItemBuilder::with_id("hide_panel", "收起快速面板").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&open_panel, &open_main, &hide_panel, &quit])
                .build()?;

            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event: MenuEvent| match event.id().as_ref() {
                    "open_panel" => toggle_tray_panel(app),
                    "open_main" => {
                        hide_window(app, "tray");
                        show_window(app, "main");
                    }
                    "hide_panel" => hide_window(app, "tray"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray: &TrayIcon, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_tray_panel(&tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // paths
            paths::get_codex_dir,
            paths::get_sessions_dir,
            paths::get_account_sessions_dir,
            // accounts
            accounts::load_accounts,
            accounts::save_accounts,
            accounts::load_settings,
            accounts::save_settings,
            accounts::read_auth_json,
            accounts::write_auth_json,
            accounts::save_account_credentials,
            accounts::read_account_credentials,
            accounts::delete_account_credentials,
            // sessions
            sessions::snapshot_sessions,
            sessions::restore_sessions,
            sessions::switch_account,
            sessions::list_account_session_info,
            sessions::get_current_sessions_info,
            sessions::delete_account_sessions,
            sessions::resume_session_in_terminal,
            sessions::restart_codex_desktop,
            usage::read_account_rate_limits,
            // oauth
            oauth::start_oauth_flow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
