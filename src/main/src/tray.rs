//! System Tray — Background status indicator with quick actions.
//!
//! Features:
//! - Status icon (idle/working/error) with color
//! - Current goal display
//! - Quick actions: Pause, Resume, Stop
//! - Show/Hide window on click
//! - Context menu with full control options

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// IDs for each tray menu item.  These are used in the `on_menu_event`
/// handler to dispatch the correct action.
mod menu_id {
    pub const SHOW_HIDE: &str = "tray_show_hide";
    pub const PAUSE: &str = "tray_pause";
    pub const RESUME: &str = "tray_resume";
    pub const STOP: &str = "tray_stop";
    pub const QUIT: &str = "tray_quit";
}

/// Initialise the system tray icon + context menu.
///
/// Call this inside `tauri::Builder::setup()` after the main window
/// has been created.
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    // --- Build menu items ----------------------------------------------------

    let show_hide_i = MenuItemBuilder::with_id(menu_id::SHOW_HIDE, "Show / Hide")
        .build(app)?;

    let pause_i = MenuItemBuilder::with_id(menu_id::PAUSE, "Pause Agent")
        .build(app)?;

    let resume_i = MenuItemBuilder::with_id(menu_id::RESUME, "Resume Agent")
        .build(app)?;

    let stop_i = MenuItemBuilder::with_id(menu_id::STOP, "Stop Agent")
        .build(app)?;

    let quit_i = MenuItemBuilder::with_id(menu_id::QUIT, "Quit")
        .build(app)?;

    let sep = PredefinedMenuItem::separator(app)?;

    // --- Assemble menu -------------------------------------------------------

    let menu = MenuBuilder::new(app)
        .item(&show_hide_i)
        .item(&sep)
        .item(&pause_i)
        .item(&resume_i)
        .item(&stop_i)
        .item(&sep)
        .item(&quit_i)
        .build()?;

    // --- Build tray icon -----------------------------------------------------

    let default_icon = app
        .default_window_icon()
        .cloned()
        .ok_or("no default window icon found")?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(default_icon)
        .tooltip("Construct AI Agent")
        .menu(&menu)
        .menu_on_left_click(false) // Use left-click for window toggle, not menu
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                // Toggle window visibility on left-click release
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    toggle_window(tray.app_handle());
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            menu_id::SHOW_HIDE => toggle_window(app),
            menu_id::PAUSE => {
                let _ = app.emit("tray:pause_clicked", ());
            }
            menu_id::RESUME => {
                let _ = app.emit("tray:resume_clicked", ());
            }
            menu_id::STOP => {
                let _ = app.emit("tray:stop_clicked", ());
            }
            menu_id::QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Toggle the visibility of the main application window.
///
/// If the window is currently visible it will be hidden; otherwise it
/// is shown and brought to focus.
fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            Ok(false) => {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Err(e) => {
                eprintln!("[tray] failed to query window visibility: {}", e);
            }
        }
    }
}

/// Update the tray tooltip to reflect the current agent state.
///
/// Call this whenever the agent status changes so the tray icon
/// displays the current goal / state.
pub fn update_tray_tooltip<R: Runtime>(app: &AppHandle<R>, tooltip: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
