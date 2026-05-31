use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// State held by the app for a single terminal session.
struct TerminalSession {
    writer: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Managed state: one terminal session per app (extendable to multiple).
pub struct TerminalState {
    pub session: Arc<Mutex<Option<TerminalSession>>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
        }
    }
}

/// Spawn a new PTY and connect it to the frontend via Tauri events.
#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
    use tokio::io::AsyncReadExt;

    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Choose shell based on OS
    let shell = if cfg!(target_os = "windows") {
        "powershell"
    } else {
        // Try zsh first, fall back to bash, then sh
        if std::path::Path::new("/bin/zsh").exists() {
            "/bin/zsh"
        } else if std::path::Path::new("/bin/bash").exists() {
            "/bin/bash"
        } else {
            "/bin/sh"
        }
    };

    let cmd = CommandBuilder::new(shell);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Drop the slave side in the parent process
    drop(pair.slave);

    // Get reader and writer
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    let writer = Arc::new(Mutex::new(pair.master));

    // Spawn async reader task that emits data to the frontend
    let app_clone = app.clone();
    tokio::spawn(async move {
        let mut reader = reader;
        let mut buf = [0u8; 4096];

        loop {
            match reader.read(&mut buf).await {
                Ok(0) => {
                    // EOF — shell exited
                    let _ = app_clone.emit("terminal:data", "\r\n[Process exited]\r\n");
                    break;
                }
                Ok(n) => {
                    // Convert bytes to string, replacing invalid UTF-8
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit("terminal:data", data);
                }
                Err(e) => {
                    log::error!("Terminal read error: {}", e);
                    break;
                }
            }
        }
    });

    // Store session
    let state = app.state::<TerminalState>();
    let mut session = state.session.lock().await;
    *session = Some(TerminalSession {
        writer,
        _child: child,
    });

    Ok("terminal_spawned".to_string())
}

/// Send input from the frontend to the PTY.
#[tauri::command]
pub async fn terminal_input(
    app: AppHandle,
    data: String,
) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let session_guard = state.session.lock().await;

    if let Some(session) = session_guard.as_ref() {
        let mut writer = session.writer.lock().await;
        use std::io::Write;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        writer.flush().map_err(|e| format!("Flush error: {}", e))?;
    }

    Ok(())
}

/// Resize the PTY to match the terminal viewport.
#[tauri::command]
pub async fn terminal_resize(
    app: AppHandle,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let session_guard = state.session.lock().await;

    if let Some(session) = session_guard.as_ref() {
        let writer = session.writer.lock().await;
        writer
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize error: {}", e))?;
    }

    Ok(())
}

/// Kill the terminal session.
#[tauri::command]
pub async fn kill_terminal(app: AppHandle) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut session_guard = state.session.lock().await;
    *session_guard = None;
    Ok(())
}
