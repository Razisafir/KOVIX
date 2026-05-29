//! Persistent session storage — saves agent sessions to disk as JSON.
//!
//! Uses atomic writes (temp file + rename) to avoid corruption.

use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::commands::agent::AgentSession;

/// Manages loading and saving agent sessions to a JSON file on disk.
#[derive(Debug)]
pub struct SessionStore {
    file_path: PathBuf,
}

/// Wrapper for serializing the sessions HashMap.
#[derive(Debug, Serialize, Deserialize)]
struct SessionCollection {
    sessions: HashMap<String, AgentSession>,
    version: u32,
    saved_at: i64,
}

impl SessionStore {
    const CURRENT_VERSION: u32 = 1;

    /// Create a new SessionStore with the given file path.
    pub fn new(file_path: PathBuf) -> Self {
        Self { file_path }
    }

    /// Create a SessionStore using the app's data directory.
    pub fn from_app_dir(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data directory: {}", e))?;
        std::fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app dir: {}", e))?;
        let file_path = app_dir.join("sessions.json");
        Ok(Self::new(file_path))
    }

    /// Save all sessions to disk atomically.
    pub fn save(&self, sessions: &HashMap<String, AgentSession>) -> Result<(), String> {
        let collection = SessionCollection {
            sessions: sessions.clone(),
            version: Self::CURRENT_VERSION,
            saved_at: chrono::Utc::now().timestamp(),
        };

        let json = serde_json::to_string_pretty(&collection)
            .map_err(|e| format!("Failed to serialize sessions: {}", e))?;

        // Atomic write: write to temp file, then rename
        let temp_path = self.file_path.with_extension("tmp");
        std::fs::write(&temp_path, json)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        std::fs::rename(&temp_path, &self.file_path)
            .map_err(|e| format!("Failed to rename temp file: {}", e))?;

        Ok(())
    }

    /// Load sessions from disk. Returns empty HashMap if file doesn't exist.
    pub fn load(&self) -> Result<HashMap<String, AgentSession>, String> {
        if !self.file_path.exists() {
            return Ok(HashMap::new());
        }

        let json = std::fs::read_to_string(&self.file_path)
            .map_err(|e| format!("Failed to read sessions file: {}", e))?;

        let collection: SessionCollection = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to deserialize sessions: {}", e))?;

        Ok(collection.sessions)
    }

    /// Delete the sessions file (e.g., on user logout or explicit clear).
    pub fn clear(&self) -> Result<(), String> {
        if self.file_path.exists() {
            std::fs::remove_file(&self.file_path)
                .map_err(|e| format!("Failed to remove sessions file: {}", e))?;
        }
        Ok(())
    }
}
