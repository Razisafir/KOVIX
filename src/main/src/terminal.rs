use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// State held by the app for a single terminal session.
struct TerminalSession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
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

/// Spawn a new PTY shell and connect it to the frontend via Tauri events.
#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    // Use native PTY system (ConPTY on Windows, fork/exec on Unix)
    let pty_system = native_pty_system();

    // Open a new PTY pair with the requested size
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Build the shell command — uses user's default shell
    let cmd = CommandBuilder::new_default_prog();
    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Clone the reader from the master side for the reader thread.
    // NOTE: portable-pty v0.8 supports try_clone_reader() but NOT try_clone_writer().
    // We write directly to the MasterPty which implements the Write trait.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    // Keep master alive — we write to it directly via the Write trait
    let master: Box<dyn MasterPty + Send> = pair.master;
    let master = Arc::new(Mutex::new(master));

    // Spawn blocking reader task — reads PTY output and emits to frontend
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app_clone.emit("terminal:data", "\r\n[Process exited]\r\n");
                    break;
                }
                Ok(n) => {
                    // Pass raw bytes as lossy UTF-8 — xterm.js handles the rest
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit("terminal:data", data);
                }
                Err(e) => {
                    log::error!("PTY read error: {}", e);
                    break;
                }
            }
        }
    });

    // Store session
    let state = app.state::<TerminalState>();
    let mut session = state.session.lock().await;
    *session = Some(TerminalSession { master });

    log::info!("Terminal PTY spawned ({}x{})", cols, rows);
    Ok("terminal_spawned".to_string())
}

/// Send input from the frontend to the shell via PTY.
/// Writes directly to the MasterPty which implements the Write trait.
#[tauri::command]
pub async fn terminal_input(
    app: AppHandle,
    data: String,
) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let session_guard = state.session.lock().await;

    if let Some(session) = session_guard.as_ref() {
        let mut master = session.master.lock().await;
        master
            .write_all(data.as_bytes())
            .map_err(|e| format!("PTY write error: {}", e))?;
        master.flush().map_err(|e| format!("PTY flush error: {}", e))?;
    }

    Ok(())
}

/// Resize the terminal viewport via PTY.
#[tauri::command]
pub async fn terminal_resize(
    app: AppHandle,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let session_guard = state.session.lock().await;

    if let Some(session) = session_guard.as_ref() {
        let master = session.master.lock().await;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("PTY resize error: {}", e))?;
    }

    Ok(())
}

/// Kill the terminal session.
#[tauri::command]
pub async fn kill_terminal(app: AppHandle) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut session_guard = state.session.lock().await;

    if let Some(session) = session_guard.take() {
        // Dropping the master PTY will send SIGHUP to the child process
        drop(session);
        log::info!("Terminal session killed");
    }

    Ok(())
}
