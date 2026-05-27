pub mod atomic_io;
pub mod cli;
pub mod commands;
pub mod models;
pub mod net;
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
    Manager, PhysicalPosition, Position, Rect, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/// Global mutex to serialize all operations that mutate live session/auth files,
/// preventing concurrent switches from interleaving and corrupting isolation.
#[derive(Default)]
pub struct SwitchLock(pub tokio::sync::Mutex<()>);

#[derive(Default)]
struct TrayPanelController {
    ignore_blur_until: Option<Instant>,
    suppress_tray_click_until: Option<Instant>,
    last_anchor: Option<TrayAnchor>,
}

#[derive(Clone, Copy)]
struct TrayAnchor {
    rect: Rect,
    position: PhysicalPosition<f64>,
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

fn remember_tray_anchor(
    state: &Arc<Mutex<TrayPanelController>>,
    rect: &Rect,
    position: &PhysicalPosition<f64>,
) {
    if let Ok(mut guard) = state.lock() {
        guard.last_anchor = Some(TrayAnchor {
            rect: *rect,
            position: *position,
        });
    }
}

fn last_tray_anchor(state: &Arc<Mutex<TrayPanelController>>) -> Option<TrayAnchor> {
    state.lock().ok().and_then(|guard| guard.last_anchor)
}

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

fn attach_main_window_close_handler(window: &tauri::WebviewWindow) {
    let main_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = main_window.hide();
        }
    });
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

fn monitor_bounds(monitor: &tauri::Monitor) -> Option<(i32, i32, i32, i32)> {
    let position = monitor.position();
    let size = monitor.size();
    Some((
        position.x,
        position.y,
        position.x + i32::try_from(size.width).ok()?,
        position.y + i32::try_from(size.height).ok()?,
    ))
}

fn monitor_work_area_bounds(monitor: &tauri::Monitor) -> Option<(i32, i32, i32, i32)> {
    let work_area = monitor.work_area();
    Some((
        work_area.position.x,
        work_area.position.y,
        work_area.position.x + i32::try_from(work_area.size.width).ok()?,
        work_area.position.y + i32::try_from(work_area.size.height).ok()?,
    ))
}

fn resolve_anchor_monitor(
    window: &tauri::WebviewWindow,
    anchor: &TrayAnchor,
) -> Option<(
    tauri::Monitor,
    PhysicalPosition<i32>,
    tauri::PhysicalSize<u32>,
)> {
    let monitors = window.available_monitors().ok()?;

    let mut best_match: Option<(
        tauri::Monitor,
        PhysicalPosition<i32>,
        tauri::PhysicalSize<u32>,
        i64,
    )> = None;

    for monitor in monitors {
        let anchor_position = rect_position_to_physical(&anchor.rect, monitor.scale_factor());
        let anchor_size = rect_size_to_physical(&anchor.rect, monitor.scale_factor());
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_right = monitor_position.x + i32::try_from(monitor_size.width).ok()?;
        let monitor_bottom = monitor_position.y + i32::try_from(monitor_size.height).ok()?;
        let anchor_center_x =
            anchor_position.x + i32::try_from(anchor_size.width).unwrap_or_default() / 2;
        let anchor_center_y =
            anchor_position.y + i32::try_from(anchor_size.height).unwrap_or_default() / 2;
        let inside = anchor_center_x >= monitor_position.x
            && anchor_center_x <= monitor_right
            && anchor_center_y >= monitor_position.y
            && anchor_center_y <= monitor_bottom;

        let distance = if inside {
            0
        } else {
            let dx = if anchor_center_x < monitor_position.x {
                i64::from(monitor_position.x - anchor_center_x)
            } else if anchor_center_x > monitor_right {
                i64::from(anchor_center_x - monitor_right)
            } else {
                0
            };
            let dy = if anchor_center_y < monitor_position.y {
                i64::from(monitor_position.y - anchor_center_y)
            } else if anchor_center_y > monitor_bottom {
                i64::from(anchor_center_y - monitor_bottom)
            } else {
                0
            };
            dx * dx + dy * dy
        };

        match &best_match {
            Some((_, _, _, best_distance)) if distance >= *best_distance => {}
            _ => {
                best_match = Some((monitor, anchor_position, anchor_size, distance));
            }
        }
    }

    best_match
        .map(|(monitor, anchor_position, anchor_size, _)| (monitor, anchor_position, anchor_size))
}

fn position_tray_panel(window: &tauri::WebviewWindow, anchor: &TrayAnchor) {
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let Some((monitor, anchor_position, anchor_size)) = resolve_anchor_monitor(window, anchor)
        .or_else(|| {
            let monitor = window
                .current_monitor()
                .ok()
                .flatten()
                .or_else(|| window.primary_monitor().ok().flatten())?;
            let scale_factor = monitor.scale_factor();
            Some((
                monitor,
                rect_position_to_physical(&anchor.rect, scale_factor),
                rect_size_to_physical(&anchor.rect, scale_factor),
            ))
        })
    else {
        return;
    };

    let window_width = i32::try_from(window_size.width).unwrap_or(520);
    let window_height = i32::try_from(window_size.height).unwrap_or(640);
    let tray_width = i32::try_from(anchor_size.width).unwrap_or(0);
    let tray_height = i32::try_from(anchor_size.height).unwrap_or(0);
    let click_x = anchor.position.x.round() as i32;
    let click_y = anchor.position.y.round() as i32;
    #[cfg(target_os = "windows")]
    let (_anchor_center_x, _anchor_center_y) = (
        anchor_position.x + tray_width / 2,
        anchor_position.y + tray_height / 2,
    );

    #[cfg(not(target_os = "windows"))]
    let (anchor_center_x, anchor_center_y) = (
        anchor_position.x + tray_width / 2,
        anchor_position.y + tray_height / 2,
    );

    let Some((monitor_left, monitor_top, monitor_right, monitor_bottom)) = monitor_bounds(&monitor)
    else {
        return;
    };
    let Some((work_left, work_top, work_right, work_bottom)) = monitor_work_area_bounds(&monitor)
    else {
        return;
    };
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
        let gap = 4;
        let (x, y) = match anchor_edge {
            AnchorEdge::Bottom => (
                click_x - window_width / 2,
                click_y - tray_height / 2 - window_height - gap,
            ),
            AnchorEdge::Top => (click_x - window_width / 2, click_y + tray_height / 2 + gap),
            AnchorEdge::Left => (click_x + tray_width / 2 + gap, click_y - window_height / 2),
            AnchorEdge::Right => (
                click_x - tray_width / 2 - window_width - gap,
                click_y - window_height / 2,
            ),
        };
        (x, y, gap)
    };

    #[cfg(target_os = "macos")]
    let (mut x, mut y, gap) = {
        let gap = 6;
        let x = anchor_center_x - window_width / 2;
        let y = anchor_position.y + tray_height + gap;
        (x, y, gap)
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let (mut x, mut y, gap) = {
        let gap = 8;
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

    x = x.clamp(work_left + gap, work_right - window_width - gap);
    y = y.clamp(work_top + gap, work_bottom - window_height - gap);

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

fn toggle_tray_panel(
    app: &tauri::AppHandle,
    state: &Arc<Mutex<TrayPanelController>>,
    anchor: Option<TrayAnchor>,
) {
    if let Some(window) = app.get_webview_window("tray") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let anchor = anchor.or_else(|| last_tray_anchor(state));
            if let Some(anchor) = anchor.as_ref() {
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
            let tray_controller = Arc::new(Mutex::new(TrayPanelController::default()));
            if let Some(main_window) = app.get_webview_window("main") {
                attach_main_window_close_handler(&main_window);
            }
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
                    if let TrayIconEvent::Click { rect, position, .. } = &event {
                        remember_tray_anchor(&click_state, rect, position);
                    }

                    if let TrayIconEvent::Click {
                        rect,
                        position,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if should_suppress_tray_click(&click_state) {
                            return;
                        }
                        toggle_tray_panel(
                            &tray.app_handle(),
                            &click_state,
                            Some(TrayAnchor { rect, position }),
                        );
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
            sessions::read_usage_stats_summary,
            sessions::delete_account_sessions,
            desktop::resume_session_in_terminal,
            desktop::restart_codex_desktop,
            desktop::restart_vscode,
            desktop::get_platform_capabilities,
            usage::read_account_rate_limits,
            usage::read_account_daily_workspace_usage,
            // oauth
            oauth::start_oauth_flow,
            oauth::cancel_oauth_flow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
