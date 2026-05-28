use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Simple greeting command for frontend-Rust communication testing
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Construct.", name)
}

/// Returns the current application version
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
