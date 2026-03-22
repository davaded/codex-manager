pub mod commands;
pub mod models;
pub mod platform;

use commands::{accounts, desktop, oauth, paths, sessions, usage};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    menu::MenuEvent,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, Position, Rect, UserAttentionType, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::{
    Input::KeyboardAndMouse::{
        SendInput, MapVirtualKeyW, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VK_LMENU, VK_MENU,
    },
    WindowsAndMessaging::{
        BringWindowToTop, IsIconic, IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
        SW_SHOW,
    },
};

/// Global mutex to serialize all operations that mutate live session/auth files,
/// preventing concurrent switches from interleaving and corrupting isolation.
#[derive(Default)]
pub struct SwitchLock(pub tokio::sync::Mutex<()>);

#[derive(Default)]
struct TrayPanelController {
    ignore_blur_until: Option<Instant>,
    suppress_tray_click_until: Option<Instant>,
}

#[derive(Clone, Copy)]
enum AnchorEdge {
    Top,
    Bottom,
    Left,
    Right,
}

fn mark_ignore_blur(state: &Arc<Mutex<TrayPanelController>>, duration: Duration) {
    if let Ok(mut guard) = state.lock() {
        guard.ignore_blur_until = Some(Instant::now() + duration);
    }
}

fn mark_suppress_tray_click(state: &Arc<Mutex<TrayPanelController>>, duration: Duration) {
    if let Ok(mut guard) = state.lock() {
        guard.suppress_tray_click_until = Some(Instant::now() + duration);
    }
}

fn should_ignore_blur(state: &Arc<Mutex<TrayPanelController>>) -> bool {
    if let Ok(mut guard) = state.lock() {
        if let Some(until) = guard.ignore_blur_until {
            if Instant::now() <= until {
                return true;
            }
            guard.ignore_blur_until = None;
        }
    }
    false
}

fn should_suppress_tray_click(state: &Arc<Mutex<TrayPanelController>>) -> bool {
    if let Ok(mut guard) = state.lock() {
        if let Some(until) = guard.suppress_tray_click_until {
            if Instant::now() <= until {
                return true;
            }
            guard.suppress_tray_click_until = None;
        }
    }
    false
}

fn show_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = get_or_create_window(app, label) {
        if is_window_minimized(&window) {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "windows")]
        {
            let _ = force_window_active(&window);
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
            let _ = window.set_always_on_top(true);
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(180)).await;
                let _ = window.set_always_on_top(false);
            });
        }
    }
}

fn get_or_create_window(app: &tauri::AppHandle, label: &str) -> Option<tauri::WebviewWindow> {
    if label == "main" {
        ensure_main_window(app)
    } else {
        app.get_webview_window(label)
    }
}

fn ensure_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window("main") {
        return Some(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")?;
    let window = WebviewWindowBuilder::from_config(app, config)
        .ok()?
        .build()
        .ok()?;
    bind_main_window_events(&window);
    Some(window)
}

fn bind_main_window_events(window: &tauri::WebviewWindow) {
    let main_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = main_window.hide();
        }
    });
}

fn is_window_minimized(window: &tauri::WebviewWindow) -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                return IsIconic(hwnd).as_bool();
            }
        }
    }

    window.is_minimized().unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn force_window_active(window: &tauri::WebviewWindow) -> bool {
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };

    if unsafe { !IsWindow(Some(hwnd)).as_bool() } {
        return false;
    }

    unsafe {
        let _ = if IsIconic(hwnd).as_bool() {
            ShowWindow(hwnd, SW_RESTORE)
        } else {
            ShowWindow(hwnd, SW_SHOW)
        };
    }

    let brought_to_top = unsafe { BringWindowToTop(hwnd).is_ok() };
    let activated = unsafe { SetForegroundWindow(hwnd).as_bool() };
    if activated {
        return true;
    }

    // This mirrors the foreground-stealing workaround used by Tao on Windows,
    // but keeps construction and failure handling outside the raw API calls.
    let alt_sc = unsafe { MapVirtualKeyW(u32::from(VK_MENU.0), MAPVK_VK_TO_VSC) };
    if alt_sc == 0 {
        return brought_to_top;
    }

    let inputs = build_alt_menu_inputs(alt_sc as u16);
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as _) };
    if sent != inputs.len() as u32 {
        return brought_to_top;
    }

    unsafe { SetForegroundWindow(hwnd).as_bool() || brought_to_top }
}

#[cfg(target_os = "windows")]
fn build_alt_menu_inputs(scan_code: u16) -> [INPUT; 2] {
    [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_LMENU,
                    wScan: scan_code,
                    dwFlags: KEYEVENTF_EXTENDEDKEY,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_LMENU,
                    wScan: scan_code,
                    dwFlags: KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ]
}

fn hide_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}

fn detect_anchor_edge(
    anchor_position: PhysicalPosition<i32>,
    tray_width: i32,
    tray_height: i32,
    monitor_left: i32,
    monitor_top: i32,
    monitor_right: i32,
    monitor_bottom: i32,
) -> AnchorEdge {
    let distances = [
        (AnchorEdge::Top, (anchor_position.y - monitor_top).abs()),
        (
            AnchorEdge::Bottom,
            (monitor_bottom - (anchor_position.y + tray_height)).abs(),
        ),
        (AnchorEdge::Left, (anchor_position.x - monitor_left).abs()),
        (
            AnchorEdge::Right,
            (monitor_right - (anchor_position.x + tray_width)).abs(),
        ),
    ];

    distances
        .into_iter()
        .min_by_key(|(_, distance)| *distance)
        .map(|(edge, _)| edge)
        .unwrap_or(AnchorEdge::Bottom)
}

fn rect_position_to_physical(rect: &Rect, scale_factor: f64) -> PhysicalPosition<i32> {
    match rect.position {
        Position::Physical(position) => position,
        Position::Logical(position) => position.to_physical(scale_factor),
    }
}

fn rect_size_to_physical(rect: &Rect, scale_factor: f64) -> tauri::PhysicalSize<u32> {
    match rect.size {
        tauri::Size::Physical(size) => size,
        tauri::Size::Logical(size) => size.to_physical(scale_factor),
    }
}

fn resolve_monitor_for_physical_point(
    window: &tauri::WebviewWindow,
    point: PhysicalPosition<i32>,
) -> Option<tauri::Monitor> {
    if let Some(monitor) = window
        .monitor_from_point(f64::from(point.x), f64::from(point.y))
        .ok()
        .flatten()
    {
        return Some(monitor);
    }

    let monitors = window.available_monitors().ok()?;
    let mut best_match: Option<(tauri::Monitor, i64)> = None;

    for monitor in monitors {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_right = monitor_position.x + i32::try_from(monitor_size.width).ok()?;
        let monitor_bottom = monitor_position.y + i32::try_from(monitor_size.height).ok()?;

        let dx = if point.x < monitor_position.x {
            i64::from(monitor_position.x - point.x)
        } else if point.x > monitor_right {
            i64::from(point.x - monitor_right)
        } else {
            0
        };
        let dy = if point.y < monitor_position.y {
            i64::from(monitor_position.y - point.y)
        } else if point.y > monitor_bottom {
            i64::from(point.y - monitor_bottom)
        } else {
            0
        };
        let distance = dx * dx + dy * dy;

        match &best_match {
            Some((_, best_distance)) if distance >= *best_distance => {}
            _ => best_match = Some((monitor, distance)),
        }
    }

    best_match.map(|(monitor, _)| monitor)
}

fn resolve_anchor_monitor(
    window: &tauri::WebviewWindow,
    anchor: &Rect,
) -> Option<(tauri::Monitor, PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    let fallback_monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let fallback_scale = fallback_monitor.scale_factor();
    let anchor_position = rect_position_to_physical(anchor, fallback_scale);
    let anchor_size = rect_size_to_physical(anchor, fallback_scale);
    let anchor_center = PhysicalPosition::new(
        anchor_position.x + i32::try_from(anchor_size.width).unwrap_or_default() / 2,
        anchor_position.y + i32::try_from(anchor_size.height).unwrap_or_default() / 2,
    );
    let monitor =
        resolve_monitor_for_physical_point(window, anchor_center).unwrap_or(fallback_monitor);

    Some((monitor, anchor_position, anchor_size))
}

fn position_tray_panel(window: &tauri::WebviewWindow, anchor: &Rect) {
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let Some((monitor, anchor_position, anchor_size)) = resolve_anchor_monitor(window, anchor) else {
        return;
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_width = i32::try_from(window_size.width).unwrap_or(520);
    let window_height = i32::try_from(window_size.height).unwrap_or(640);
    let tray_width = i32::try_from(anchor_size.width).unwrap_or(0);
    let tray_height = i32::try_from(anchor_size.height).unwrap_or(0);

    let monitor_left = monitor_position.x;
    let monitor_top = monitor_position.y;
    let monitor_right = monitor_left + i32::try_from(monitor_size.width).unwrap_or(0);
    let monitor_bottom = monitor_top + i32::try_from(monitor_size.height).unwrap_or(0);
    #[cfg(not(target_os = "macos"))]
    let anchor_edge = detect_anchor_edge(
        anchor_position,
        tray_width,
        tray_height,
        monitor_left,
        monitor_top,
        monitor_right,
        monitor_bottom,
    );

    #[cfg(target_os = "windows")]
    let (mut x, mut y, gap) = {
        let gap = 8;
        let (x, y) = match anchor_edge {
            AnchorEdge::Bottom => (
                anchor_position.x + tray_width - window_width,
                anchor_position.y - window_height - gap,
            ),
            AnchorEdge::Top => (
                anchor_position.x + tray_width - window_width,
                anchor_position.y + tray_height + gap,
            ),
            AnchorEdge::Left => (
                anchor_position.x + tray_width + gap,
                anchor_position.y + tray_height / 2 - window_height / 2,
            ),
            AnchorEdge::Right => (
                anchor_position.x - window_width - gap,
                anchor_position.y + tray_height / 2 - window_height / 2,
            ),
        };
        (x, y, gap)
    };

    #[cfg(target_os = "macos")]
    let (mut x, mut y, gap) = {
        let gap = 6;
        let anchor_center_x = anchor_position.x + tray_width / 2;
        let x = anchor_center_x - window_width / 2;
        let y = anchor_position.y + tray_height + gap;
        (x, y, gap)
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let (mut x, mut y, gap) = {
        let gap = 8;
        let anchor_center_x = anchor_position.x + tray_width / 2;
        let anchor_center_y = anchor_position.y + tray_height / 2;
        let (x, y) = match anchor_edge {
            AnchorEdge::Bottom => (
                anchor_center_x - window_width / 2,
                anchor_position.y - window_height - gap,
            ),
            AnchorEdge::Top => (
                anchor_center_x - window_width / 2,
                anchor_position.y + tray_height + gap,
            ),
            AnchorEdge::Left => (
                anchor_position.x + tray_width + gap,
                anchor_center_y - window_height / 2,
            ),
            AnchorEdge::Right => (
                anchor_position.x - window_width - gap,
                anchor_center_y - window_height / 2,
            ),
        };
        (x, y, gap)
    };

    let x_min = monitor_left + gap;
    let x_max = monitor_right - window_width - gap;
    let y_min = monitor_top + gap;
    let y_max = monitor_bottom - window_height - gap;

    x = if x_min <= x_max { x.clamp(x_min, x_max) } else { x_min };
    y = if y_min <= y_max { y.clamp(y_min, y_max) } else { y_min };

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

fn toggle_tray_panel(
    app: &tauri::AppHandle,
    state: &Arc<Mutex<TrayPanelController>>,
    anchor: Option<&Rect>,
) {
    if let Some(window) = app.get_webview_window("tray") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            if let Some(anchor) = anchor {
                position_tray_panel(&window, anchor);
            }
            mark_ignore_blur(state, Duration::from_millis(220));
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(SwitchLock::default())
        .manage(oauth::OAuthFlowManager::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(main_window) = app.get_webview_window("main") {
                bind_main_window_events(&main_window);
            }

            let tray_controller = Arc::new(Mutex::new(TrayPanelController::default()));
            let tray_window_builder =
                WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("index.html#tray".into()))
                    .title("Codex Manager Tray")
                    .inner_size(540.0, 640.0)
                    .resizable(false)
                    .visible(false)
                    .shadow(false)
                    .skip_taskbar(true)
                    .always_on_top(true)
                    .decorations(false);
            #[cfg(target_os = "windows")]
            let tray_window_builder = tray_window_builder.transparent(true);
            let tray_window = tray_window_builder.build()?;
            let tray_window_for_events = tray_window.clone();
            let blur_state = Arc::clone(&tray_controller);
            tray_window.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    if !should_ignore_blur(&blur_state) {
                        let _ = tray_window_for_events.hide();
                    }
                }
            });

            let open_panel = MenuItemBuilder::with_id("open_panel", "打开快速面板").build(app)?;
            let open_main = MenuItemBuilder::with_id("open_main", "打开主窗口").build(app)?;
            let hide_panel = MenuItemBuilder::with_id("hide_panel", "收起快速面板").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&open_panel, &open_main, &hide_panel, &quit])
                .build()?;

            let mut tray_builder = TrayIconBuilder::new();
            if let Some(tray_icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(tray_icon);
            }

            let menu_state = Arc::clone(&tray_controller);
            let click_state = Arc::clone(&tray_controller);
            tray_builder
                .menu(&menu)
                .on_menu_event(move |app, event: MenuEvent| {
                    mark_suppress_tray_click(&menu_state, Duration::from_millis(260));
                    match event.id().as_ref() {
                        "open_panel" => toggle_tray_panel(app, &menu_state, None),
                        "open_main" => {
                            hide_window(app, "tray");
                            show_window(app, "main");
                        }
                        "hide_panel" => hide_window(app, "tray"),
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |tray: &TrayIcon, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if should_suppress_tray_click(&click_state) {
                            return;
                        }
                        if let Some(main_window) = tray.app_handle().get_webview_window("main") {
                            if is_window_minimized(&main_window) {
                                hide_window(&tray.app_handle(), "tray");
                                show_window(&tray.app_handle(), "main");
                                return;
                            }
                        }
                        toggle_tray_panel(&tray.app_handle(), &click_state, Some(&rect));
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
            desktop::resume_session_in_terminal,
            desktop::restart_codex_desktop,
            desktop::get_platform_capabilities,
            usage::read_account_rate_limits,
            // oauth
            oauth::start_oauth_flow,
            oauth::cancel_oauth_flow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
