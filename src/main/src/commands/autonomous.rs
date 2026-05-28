//! Autonomous mode commands — enable/disable, status, deadlines, logs.
//!
//! Events emitted:
//!   "autonomous:started"    — Worker started
//!   "autonomous:paused"     — Worker paused (with reason)
//!   "autonomous:resumed"    — Worker resumed
//!   "autonomous:checkpoint" — Checkpoint saved (with progress %)
//!   "autonomous:completed"  — All goals completed
//!   "autonomous:error"      — Error occurred (with details)

use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AutonomousStatus {
    Disabled,
    Idle,
    Running,
    Paused,
    Throttled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomousState {
    pub status: AutonomousStatus,
    pub enabled: bool,
    pub current_goal: Option<String>,
    pub progress_percent: f32,
    pub queue_size: usize,
    pub checkpoints_saved: u32,
    pub tasks_completed: u32,
    pub started_at: Option<i64>,
    pub last_checkpoint_at: Option<i64>,
    pub resource_cpu: f32,
    pub resource_memory: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: i64,
    pub level: String,  // "info" | "warn" | "error"
    pub message: String,
    pub source: String, // "worker" | "safety" | "checkpoint" | "resource"
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

pub struct AutonomousManager {
    pub state: Arc<Mutex<AutonomousState>>,
    pub logs: Arc<Mutex<VecDeque<LogEntry>>>,
}

impl AutonomousManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(AutonomousState {
                status: AutonomousStatus::Disabled,
                enabled: false,
                current_goal: None,
                progress_percent: 0.0,
                queue_size: 0,
                checkpoints_saved: 0,
                tasks_completed: 0,
                started_at: None,
                last_checkpoint_at: None,
                resource_cpu: 0.0,
                resource_memory: 0.0,
            })),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(1000))),
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Enable autonomous mode.
///
/// Transitions the worker from `Disabled` → `Idle` and emits the
/// `autonomous:started` event so the frontend can update its UI.
#[tauri::command]
pub fn enable_autonomous_mode(
    manager: State<'_, AutonomousManager>,
    app_handle: AppHandle,
) -> Result<(), String> {
    {
        let mut state = manager.state.lock();
        state.enabled = true;
        state.status = AutonomousStatus::Idle;
    }

    let _ = app_handle.emit("autonomous:started", ());
    add_log(&manager, "info", "Autonomous mode enabled", "worker");
    Ok(())
}

/// Disable autonomous mode.
///
/// Transitions the worker to `Disabled` and emits the
/// `autonomous:paused` event with reason `"disabled_by_user"`.
#[tauri::command]
pub fn disable_autonomous_mode(
    manager: State<'_, AutonomousManager>,
    app_handle: AppHandle,
) -> Result<(), String> {
    {
        let mut state = manager.state.lock();
        state.enabled = false;
        state.status = AutonomousStatus::Disabled;
    }

    let _ = app_handle.emit("autonomous:paused", "disabled_by_user");
    add_log(&manager, "info", "Autonomous mode disabled", "worker");
    Ok(())
}

/// Get current autonomous status.
///
/// Returns a snapshot of the `AutonomousState` (status, progress,
/// resource usage, etc.) for the frontend dashboard.
#[tauri::command]
pub fn get_autonomous_status(
    manager: State<'_, AutonomousManager>,
) -> Result<AutonomousState, String> {
    let state = manager.state.lock();
    Ok(state.clone())
}

/// Set a deadline for a goal.
///
/// Stores the deadline (Unix timestamp) associated with a goal ID.
/// In a full implementation this would persist to SQLite or forward
/// to the Python backend.
#[tauri::command]
pub fn set_goal_deadline(
    _goal_id: String,
    _deadline: i64, // Unix timestamp
) -> Result<(), String> {
    // TODO: Store deadline in SQLite or forward to Python backend.
    Ok(())
}

/// Get recent agent logs.
///
/// Returns the most recent log lines (oldest first) up to the
/// requested limit.  Defaults to 100 lines.
#[tauri::command]
pub fn get_agent_log(
    manager: State<'_, AutonomousManager>,
    lines: Option<usize>,
) -> Result<Vec<LogEntry>, String> {
    let logs = manager.logs.lock();
    let limit = lines.unwrap_or(100);
    let recent: Vec<LogEntry> = logs.iter().rev().take(limit).cloned().collect();
    Ok(recent.into_iter().rev().collect()) // Return oldest first
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn add_log(
    manager: &AutonomousManager,
    level: &str,
    message: &str,
    source: &str,
) {
    let mut logs = manager.logs.lock();
    logs.push_back(LogEntry {
        timestamp: Utc::now().timestamp(),
        level: level.to_string(),
        message: message.to_string(),
        source: source.to_string(),
    });
    // Keep only last 1000 entries
    while logs.len() > 1000 {
        logs.pop_front();
    }
}
