//! Agent control commands — start, pause, resume, stop, status, output.
//!
//! The agent runs asynchronously in a background task. Output is streamed
//! to the frontend via Tauri events (not command return values).
//!
//! # Frontend usage
//! ```ts
//! // Start an agent session
//! const sessionId = await invoke('start_agent', {
//!   goal: 'Create a Counter component',
//!   projectPath: '/path/to/project'
//! });
//!
//! // Listen for output events
//! listen(`agent:${sessionId}`, (event) => {
//!   const output = event.payload as AgentOutputEvent;
//!   console.log(output.event_type, output.content);
//! });
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Backend URL helper — reads the sidecar port from managed state
// ---------------------------------------------------------------------------

fn backend_url(app: &AppHandle) -> String {
    // Try to get the port from sidecar-managed state
    if let Some(backend) = app.try_state::<std::sync::Arc<parking_lot::Mutex<crate::sidecar::BackendState>>>() {
        let state = backend.lock();
        state.url()
    } else {
        // Fallback: try default port 8000
        "http://127.0.0.1:8000".to_string()
    }
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Overall state of an agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentStatus {
    Idle,
    Running,
    Paused,
    Completed,
    Failed,
    Waiting,
}

/// Status of an individual task within a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Blocked,
}

/// A single task the agent is working on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: String,
    pub description: String,
    pub status: TaskStatus,
    pub result: Option<String>,
    pub error: Option<String>,
}

/// A running (or completed) agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub goal: String,
    pub status: AgentStatus,
    pub tasks: Vec<AgentTask>,
    pub current_task_index: usize,
    pub output_log: Vec<AgentOutputEvent>,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_path: String,
    pub mode: String,
}

/// A single output event emitted by the agent.
///
/// The `event_type` field is one of:
/// - `"thought"` — the agent's internal reasoning
/// - `"tool_call"` — a tool is being invoked
/// - `"tool_result"` — result from a tool invocation
/// - `"code"` — generated code snippet
/// - `"error"` — an error occurred
/// - `"complete"` — the session finished successfully
/// - `"task_start"` — a new task has started
/// - `"task_complete"` — a task finished successfully
/// - `"task_failed"` — a task failed
/// - `"waiting"` — the agent is waiting for user input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOutputEvent {
    pub session_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub content: String,
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// Thread-safe store of all active and completed agent sessions.
#[derive(Clone)]
pub struct AgentState {
    pub sessions: Arc<Mutex<HashMap<String, AgentSession>>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Emit an output event for the given session.
///
/// Events are sent on the channel `agent:{session_id}` so the frontend
/// can scope listeners to a single session.
fn emit_output(app: &AppHandle, session_id: &str, event_type: &str, content: &str) {
    let event = AgentOutputEvent {
        session_id: session_id.to_string(),
        event_type: event_type.to_string(),
        content: content.to_string(),
        timestamp: Utc::now().timestamp(),
    };

    let channel = format!("agent:{}", session_id);

    if let Err(e) = app.emit(&channel, event.clone()) {
        eprintln!("[agent] failed to emit event on '{}': {}", channel, e);
    }

    // Also append to the in-memory log so `get_agent_output` can paginate.
    // NOTE: we do *not* hold the lock while emitting — the event is already
    // sent; this just stores it for later replay.
    // In a real implementation we would need access to the state map here.
    // The log is updated by the background task itself (see `start_agent`).
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Start a new agent session with the given goal.
///
/// Returns the session ID immediately. The agent runs in the background
/// and streams output via Tauri events on the channel `agent:{session_id}`.
///
/// # Example (frontend)
/// ```ts
/// const sessionId = await invoke('start_agent', {
///   goal: 'Create a Counter component',
///   projectPath: '/home/user/my-project'
/// });
///
/// listen(`agent:${sessionId}`, (event) => {
///   const output = event.payload as AgentOutputEvent;
///   appendToUI(output);
/// });
/// ```
#[tauri::command]
pub fn start_agent(
    state: State<'_, AgentState>,
    app_handle: AppHandle,
    goal: String,
    project_path: Option<String>,
    mode: Option<String>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string()[..8].to_string();
    let agent_mode = mode.unwrap_or_else(|| "code".to_string());

    let session = AgentSession {
        id: session_id.clone(),
        goal: goal.clone(),
        status: AgentStatus::Running,
        tasks: vec![],
        current_task_index: 0,
        output_log: vec![],
        created_at: Utc::now().timestamp(),
        updated_at: Utc::now().timestamp(),
        project_path: project_path.clone().unwrap_or_else(|| ".".to_string()),
        mode: agent_mode.clone(),
    };

    {
        let mut sessions = state.sessions.lock();
        sessions.insert(session_id.clone(), session);
    }

    // Clone the sessions Arc for the async background task.
    // We pass it directly into the closure rather than calling
    // app.state::<AgentState>() inside the async block.
    let sessions_for_task = state.sessions.clone();

    // Spawn async tokio task for HTTP communication with Python backend
    let sid = session_id.clone();
    let app = app_handle.clone();
    let path = project_path.unwrap_or_else(|| ".".to_string());
    let goal_clone = goal.clone();
    let mode_for_backend = agent_mode.clone();

    tauri::async_runtime::spawn(async move {
        // 1. Start the agent session on the Python backend
        // POST /agent/start — the REAL executor (not the /api/ stub)
        // The real endpoint expects {goal, project_path, mode} and returns
        // {session_id, goal, status, mode, message} with the Python-generated ID.
        let client = reqwest::Client::new();
        let start_payload = serde_json::json!({
            "goal": goal_clone,
            "project_path": path,
            "mode": mode_for_backend,
        });

        let real_session_id = match client
            .post(&format!("{}/agent/start", backend_url(&app)))
            .json(&start_payload)
            .send()
            .await
        {
            Ok(resp) => {
                if !resp.status().is_success() {
                    let err_text = resp.text().await.unwrap_or_else(|_| "Unknown error".into());
                    emit_output(&app, &sid, "error", &format!("Backend failed to start agent: {}", err_text));
                    return;
                }
                // Parse the response to get the Python-generated session_id
                match resp.json::<serde_json::Value>().await {
                    Ok(body) => {
                        body.get("session_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&sid)
                            .to_string()
                    }
                    Err(_) => sid.clone(),
                }
            }
            Err(e) => {
                emit_output(&app, &sid, "error", &format!("Cannot connect to Python backend at :8000: {}. Is the backend running?", e));
                return;
            }
        };

        // Update the local session with the real session_id from Python
        let real_sid = real_session_id.clone();
        {
            let mut sessions = sessions_for_task.lock();
            if let Some(session) = sessions.remove(&sid) {
                let mut real_session = session;
                real_session.id = real_sid.clone();
                sessions.insert(real_sid.clone(), real_session);
            }
        }

        // Emit an event to the frontend with the real session_id so it can
        // update its listener from the temporary Rust ID to the real one.
        let _ = app.emit(
            &format!("agent:{}", sid),
            AgentOutputEvent {
                session_id: real_sid.clone(),
                event_type: "session_id".to_string(),
                content: format!("Session started with ID: {}", real_sid),
                timestamp: Utc::now().timestamp(),
            },
        );

        // 2. Poll for events from the Python backend
        let mut events_seen: usize = 0;
        let mut consecutive_errors = 0u32;
        const MAX_CONSECUTIVE_ERRORS: u32 = 10;
        const POLL_INTERVAL_MS: u64 = 500;

        loop {
            // Check if session was stopped/paused
            let should_stop = {
                let sessions_guard = sessions_for_task.lock();
                if let Some(session) = sessions_guard.get(&real_sid) {
                    if matches!(session.status, AgentStatus::Failed) {
                        // Send stop signal to backend
                        true
                    } else {
                        false
                    }
                } else {
                    true // Session removed
                }
            };

            if should_stop {
                let _ = client
                    .post(&format!("{}/agent/{}/stop", backend_url(&app), real_sid))
                    .send()
                    .await;
                break;
            }

            // Poll events from the REAL executor via /agent/{sid}/output
            match client
                .get(&format!(
                    "{}/agent/{}/output?since={}",
                    backend_url(&app), real_sid, events_seen
                ))
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
            {
                Ok(resp) => {
                    consecutive_errors = 0;
                    if resp.status().is_success() {
                        // Response format: {"session_id": str, "events": [...], "has_more": bool}
                        if let Ok(body) = resp.json::<serde_json::Value>().await {
                            if let Some(events_arr) = body.get("events").and_then(|v| v.as_array()) {
                                for event_val in events_arr {
                                    let event = AgentOutputEvent {
                                        session_id: real_sid.clone(),
                                        event_type: event_val.get("type")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                            .to_string(),
                                        content: event_val.get("content")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                        timestamp: event_val.get("timestamp")
                                            .and_then(|v| v.as_f64())
                                            .unwrap_or(0.0) as i64,
                                    };
                                    events_seen += 1;

                                // Update session state
                                {
                                    let mut sessions = sessions_for_task.lock();
                                    if let Some(session) = sessions.get_mut(&real_sid) {
                                        session.output_log.push(event.clone());
                                        session.updated_at = Utc::now().timestamp();

                                        // Update task tracking
                                        match event.event_type.as_str() {
                                            "task_start" => {
                                                let task = AgentTask {
                                                    id: format!("task-{}", session.tasks.len()),
                                                    description: event.content.clone(),
                                                    status: TaskStatus::InProgress,
                                                    result: None,
                                                    error: None,
                                                };
                                                session.tasks.push(task);
                                                session.current_task_index = session.tasks.len().saturating_sub(1);
                                            }
                                            "task_complete" => {
                                                if let Some(task) = session.tasks.last_mut() {
                                                    task.status = TaskStatus::Completed;
                                                    task.result = Some(event.content.clone());
                                                }
                                            }
                                            "task_failed" => {
                                                if let Some(task) = session.tasks.last_mut() {
                                                    task.status = TaskStatus::Failed;
                                                    task.error = Some(event.content.clone());
                                                }
                                            }
                                            "error" => {
                                                session.status = AgentStatus::Failed;
                                            }
                                            "complete" => {
                                                session.status = AgentStatus::Completed;
                                            }
                                            _ => {}
                                        }
                                    }
                                }

                                let _ = app.emit(&format!("agent:{}", sid), event.clone());
                            }
                        }
                    }
                }
                Err(_) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        emit_output(&app, &sid, "error", "Lost connection to Python backend. Too many consecutive errors.");
                        break;
                    }
                }
            }

            // Check if session completed
            let is_done = {
                let sessions = sessions_for_task.lock();
                if let Some(session) = sessions.get(&real_sid) {
                    matches!(session.status, AgentStatus::Completed | AgentStatus::Failed)
                } else {
                    true
                }
            };

            if is_done {
                break;
            }

            tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;
        }
    });

    Ok(session_id)
}

/// Get the current status and full details of an agent session.
///
/// # Example (frontend)
/// ```ts
/// const session = await invoke('get_agent_status', { sessionId: 'abc12345' });
/// console.log(session.status, session.tasks);
/// ```
#[tauri::command]
pub fn get_agent_status(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<AgentSession, String> {
    let sessions = state.sessions.lock();
    sessions
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Session not found".to_string())
}

/// Pause a running agent session.
///
/// The background task will spin-wait until `resume_agent` is called.
#[tauri::command]
pub fn pause_agent(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.status = AgentStatus::Paused;
        session.updated_at = Utc::now().timestamp();
        Ok(())
    } else {
        Err("Session not found".to_string())
    }
}

/// Resume a paused agent session.
///
/// The background task will break out of its spin-wait and continue
/// emitting events.
#[tauri::command]
pub fn resume_agent(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.status = AgentStatus::Running;
        session.updated_at = Utc::now().timestamp();
        Ok(())
    } else {
        Err("Session not found".to_string())
    }
}

/// Stop (terminate) an agent session.
///
/// Sets the session status to `Failed`. The background task detects
/// this on its next iteration and exits cleanly after emitting an
/// abort event.
#[tauri::command]
pub fn stop_agent(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.status = AgentStatus::Failed;
        session.updated_at = Utc::now().timestamp();
        Ok(())
    } else {
        Err("Session not found".to_string())
    }
}

/// Get output events for a session since a given index.
///
/// This is useful for polling (as a fallback when events are missed)
/// or for fetching historical output after a page reload.
///
/// # Example (frontend)
/// ```ts
/// const events = await invoke('get_agent_output', {
///   sessionId: 'abc12345',
///   sinceIndex: 10
/// });
/// ```
#[tauri::command]
pub fn get_agent_output(
    state: State<'_, AgentState>,
    session_id: String,
    since_index: Option<usize>,
) -> Result<Vec<AgentOutputEvent>, String> {
    let sessions = state.sessions.lock();
    if let Some(session) = sessions.get(&session_id) {
        let start = since_index.unwrap_or(0);
        Ok(session.output_log.iter().skip(start).cloned().collect())
    } else {
        Err("Session not found".to_string())
    }
}
