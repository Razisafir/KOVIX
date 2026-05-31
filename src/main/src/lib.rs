pub mod commands;
pub mod db;
pub mod sidecar;
pub mod state;
pub mod tray;

use commands::agent::AgentState;
use commands::autonomous::AutonomousManager;
use sidecar::{spawn_backend, wait_for_backend};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(|app| {
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
            let state = db::init_db(app).expect("failed to initialise database");
            app.manage(state);

            // ── 4. Agent state ──────────────────────────────────────────────
            app.manage(AgentState::new());

            // ── 5. Autonomous mode ──────────────────────────────────────────
            app.manage(AutonomousManager::new());

            // ── 6. System tray ──────────────────────────────────────────────
            let app_handle = app.handle();
            tray::setup_tray(&app_handle).expect("failed to set up system tray");

            // ── 7. Check for updates ────────────────────────────────────────
            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                check_for_updates(update_handle).await;
            });

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Check for app updates on startup using the Tauri updater plugin.
///
/// If an update is available, the built-in dialog will prompt the user
/// (configured via `plugins.updater.dialog: true` in tauri.conf.json).
/// If the user accepts, the update is downloaded and installed automatically.
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
                // The dialog plugin handles user confirmation when
                // plugins.updater.dialog is true in tauri.conf.json.
                // download_and_install will show the dialog, download,
                // and restart the app after the user confirms.
                match update.download_and_install().await {
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
