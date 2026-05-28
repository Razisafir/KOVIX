//! Tauri command handlers exposed to the frontend.
//!
//! All commands are grouped by domain:
//! - `memory`      — persistent storage (conversations, code events, preferences, project state)
//! - `agent`       — AI agent control (start, pause, resume, stop, status, streaming output)
//! - `autonomous`  — background autonomous mode (enable, disable, status, deadlines, logs)

pub mod agent;
pub mod autonomous;
pub mod memory;
