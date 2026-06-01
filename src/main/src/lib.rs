pub mod commands;
pub mod db;
pub mod menu;
pub mod sidecar;
pub mod state;
pub mod terminal;
pub mod tray;

use commands::agent::AgentState;
use commands::autonomous::AutonomousManager;
use sidecar::{spawn_backend, wait_for_backend};
use terminal::TerminalState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .on_menu_event(|app, event| {
            // Emit menu:{id} events to the frontend so React can dispatch
            // them to Zustand store actions.
            let event_id = event.id.as_ref();
            log::info!("Menu event: {}", event_id);
            let _ = app.emit("menu-event", event_id);
        })
        .setup(|app| {
            // ── 0. Native menu ──────────────────────────────────────────────
            // Must be set inside setup() where the App is available.
            let app_menu = menu::build_menu(app);
            if let Err(e) = app.set_menu(app_menu) {
                log::error!("Failed to set native menu: {}. App will open without menu bar.", e);
            }

            // ── 1. Spawn Python backend sidecar ─────────────────────────────
            let app_handle = app.handle().clone();
            let port = match spawn_backend(&app_handle) {
                Ok(p) => {
                    log::info!("Backend sidecar spawned on port {}", p);
                    p
                }
                Err(e) => {
                    log::error!("Failed to spawn backend sidecar: {}. Agent functionality will not work.", e);
                    // Use default port so the app still opens (agent just won't work)
                    8000
                }
            };

            // ── 2. Wait for backend health check ────────────────────────────
            if port != 8000 {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match wait_for_backend(port, 30).await {
                        Ok(()) => {
                            log::info!("Backend ready on port {}", port);
                            let _ = app_handle.emit("backend:ready", port);
                        }
                        Err(e) => {
                            log::error!("Backend health check failed: {}", e);
                            let _ = app_handle.emit("backend:error", e);
                        }
                    }
                });
            }

            // ── 3. Initialise SQLite database ───────────────────────────────
            // Graceful fallback: if the DB fails to init, the app still opens
            // but memory/recall features won't work.
            match db::init_db(app) {
                Ok(state) => {
                    app.manage(state);
                    log::info!("Database initialised successfully");
                }
                Err(e) => {
                    log::error!("Failed to initialise database: {}. Memory features disabled.", e);
                    // Provide a stub so commands don't panic on state access.
                    // We create an in-memory DB as a fallback.
                    match rusqlite::Connection::open_in_memory()
                        .and_then(|conn| {
                            conn.execute_batch(db::INIT_SQL)?;
                            Ok(conn)
                        })
                        .map(|conn| db::AppState {
                            db: std::sync::Mutex::new(db::SendConnection(conn)),
                        })
                    {
                        Ok(fallback) => {
                            app.manage(fallback);
                            log::warn!("Using in-memory database fallback — data will NOT persist.");
                        }
                        Err(e2) => {
                            log::error!("Even in-memory DB failed: {}. This should not happen.", e2);
                        }
                    }
                }
            }

            // ── 4. Agent state ──────────────────────────────────────────────
            app.manage(AgentState::new());

            // ── 5. Terminal PTY state ──────────────────────────────────────
            app.manage(TerminalState::new());

            // ── 6. Autonomous mode ──────────────────────────────────────────
            app.manage(AutonomousManager::new());

            // ── 7. System tray ──────────────────────────────────────────────
            // Graceful fallback: if tray setup fails, the app still opens
            let app_handle = app.handle();
            if let Err(e) = tray::setup_tray(&app_handle) {
                log::error!("Failed to set up system tray: {}. Tray icon won't be available.", e);
            }

            // ── 8. Check for updates (deferred 30s so it doesn't block startup) ──
            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait 30 seconds before checking for updates so the
                // window is fully loaded and the user isn't interrupted.
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                check_for_updates(update_handle).await;
            });

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // -- existing commands --
            greet,
            get_app_version,
            // -- memory commands --
            commands::memory::record_conversation,
            commands::memory::get_recent_conversations,
            commands::memory::record_code_event,
            commands::memory::get_recent_code_events,
            commands::memory::store_preference,
            commands::memory::get_preferences,
            commands::memory::get_project_state,
            commands::memory::update_project_state,
            commands::memory::recall_context,
            // -- agent commands --
            commands::agent::start_agent,
            commands::agent::get_agent_status,
            commands::agent::pause_agent,
            commands::agent::resume_agent,
            commands::agent::stop_agent,
            commands::agent::get_agent_output,
            commands::agent::stream_agent_events,
            // -- autonomous commands --
            commands::autonomous::enable_autonomous_mode,
            commands::autonomous::disable_autonomous_mode,
            commands::autonomous::get_autonomous_status,
            commands::autonomous::set_goal_deadline,
            commands::autonomous::get_agent_log,
            // -- terminal commands --
            terminal::spawn_terminal,
            terminal::terminal_input,
            terminal::terminal_resize,
            terminal::kill_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Check for app updates using the Tauri updater plugin.
///
/// Deferred by 30s on startup so the window loads first.
/// Errors are logged but never crash the app — updater failures are non-critical.
async fn check_for_updates(app_handle: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;

    match app_handle.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => {
                log::info!(
                    "Update available: {} (current: {})",
                    update.version,
                    app_handle.config().version.as_deref().unwrap_or("unknown")
                );
                match update.download_and_install(
                    |chunk_len, content_len| {
                        log::debug!("Downloaded {} bytes (total: {:?})", chunk_len, content_len);
                    },
                    || {
                        log::info!("Update download finished, installing...");
                    },
                ).await {
                    Ok(()) => {
                        log::info!("Update installed successfully — app will restart");
                    }
                    Err(e) => {
                        log::warn!("Update download/install failed: {}", e);
                    }
                }
            }
            Ok(None) => {
                log::info!("App is up to date");
            }
            Err(e) => {
                log::warn!("Update check failed: {}", e);
            }
        },
        Err(e) => {
            log::warn!("Failed to initialise updater: {}", e);
        }
    }
}

/// Simple greeting command for frontend-Rust communication testing.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Construct.", name)
}

/// Returns the current application version from Cargo.toml.
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
