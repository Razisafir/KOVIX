pub mod commands;
pub mod db;
pub mod tray;

use commands::agent::AgentState;
use commands::autonomous::AutonomousManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialise the SQLite database and register it as shared state.
            let state = db::init_db(app).expect("failed to initialise database");
            app.manage(state);

            // Initialise the agent session store and register it as shared state.
            app.manage(AgentState::new());

            // Initialise the autonomous-mode manager and register it as shared state.
            app.manage(AutonomousManager::new());

            // Set up the system tray icon + context menu.
            tray::setup_tray(app).expect("failed to set up system tray");

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
