# CONSTRUCT AI — Developer Handover

**Version**: 0.1.0-alpha.14
**Date**: 2026-05-30
**Repository**: https://github.com/Razisafir/construct-ai-agent
**Status**: Build pipeline nearly working. Software needs feature implementation.

---

## 1. What This Project Is

Construct is a **native desktop AI coding agent** built with Tauri v2. It runs on the user's machine, understands their entire codebase, and performs coding tasks autonomously. Key differentiator: **persistent memory** — the agent remembers every conversation, code change, and decision across sessions.

**Competes with**: Cursor, Claude Code, GitHub Copilot Workspace

---

## 2. Architecture Overview

```
+----------------------------------+
|          React Frontend          |  ← TypeScript, Vite, Tailwind, Lucide
|   (src/renderer/)                |     User interface, chat, code viewer
+----------------------------------+     ↓ invoke / listen
|          Tauri v2 Shell          |  ← Rust (src/main/src/)
|   (src/main/src/)                |     Window, tray, native APIs,
+----------------------------------+     sidecar management, DB, commands
              ↑↓
+----------------------------------+
|        Python FastAPI Backend    |  ← Python (agent-backend/)
|   (agent-backend/)               |     AI agent loop, tool execution,
+----------------------------------+     LLM API calls, file operations
```

### Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Shell | Tauri v2 | ^2.0 | Window, system tray, native APIs |
| Frontend | React + TypeScript | ^18.3 + ^5.6 | UI framework |
| Bundler | Vite | ^6.0 | Build tool |
| Styling | Tailwind CSS | ^3.4 | Utility CSS |
| Icons | Lucide React | ^0.460 | Icon system |
| Fonts | Inter + JetBrains Mono | — | UI + code fonts |
| Backend | Python FastAPI | — | AI agent, tool execution |
| Database | SQLite (rusqlite) | ^0.32 | Persistence |
| HTTP | reqwest (Rust) | ^0.12 | Rust ↔ Python bridge |
| State | Zustand | ^5.0 | Frontend state |
| Testing | Vitest | ^2.1 | Unit testing |

---

## 3. Project File Structure

```
construct/
├── HANDOVER.md                    ← YOU ARE HERE
├── package.json                   ← npm scripts, dependencies
├── vite.config.ts                 ← Vite config (CI-safe Monaco)
├── vitest.config.ts               ← Vitest config (jsdom, coverage)
├── tsconfig.json                  ← TypeScript config
├── tailwind.config.js             ← Tailwind config
├── index.html                     ← Entry HTML (loads React)
├── icons/                         ← Tauri app icons
│   ├── icon.png
│   ├── icon.ico
│   └── icon.icns
├── .github/
│   └── workflows/
│       └── build.yml              ← GitHub Actions (Windows MSI build)
│
├── src/
│   ├── main/                      ← RUST TAURI APP
│   │   ├── Cargo.toml             ← Rust dependencies
│   │   ├── build.rs               ← Tauri build script
│   │   ├── tauri.conf.json        ← Tauri configuration (CRITICAL FILE)
│   │   ├── src/
│   │   │   ├── main.rs            ← Entry point (tauri::Builder)
│   │   │   ├── lib.rs             ← App setup (sidecar, DB, tray, commands)
│   │   │   ├── commands/
│   │   │   │   ├── mod.rs         ← Command module exports
│   │   │   │   ├── agent.rs       ← Agent commands (start, stop, status)
│   │   │   │   ├── autonomous.rs  ← Autonomous mode commands
│   │   │   │   └── memory.rs      ← Memory/DB commands
│   │   │   ├── sidecar.rs         ← Python backend spawn + health check
│   │   │   ├── tray.rs            ← System tray menu
│   │   │   ├── db.rs              ← SQLite database setup
│   │   │   ├── models.rs          ← Shared data types
│   │   │   ├── state.rs           ← App state (AgentState, AutonomousManager)
│   │   │   └── types.rs           ← Additional type definitions
│   │   ├── capabilities/
│   │   │   └── default.json       ← Tauri v2 permission config
│   │   └── icons/                 ← App icon variants
│   │
│   ├── renderer/                  ← REACT FRONTEND
│   │   ├── main.tsx               ← Entry point
│   │   ├── App.tsx                ← Root component (router)
│   │   ├── index.css              ← Global styles
│   │   ├── components/            ← Reusable components
│   │   ├── hooks/                 ← Custom React hooks
│   │   ├── pages/                 ← Route-level pages
│   │   ├── store/                 ← Zustand state stores
│   │   ├── lib/                   ← Utility functions
│   │   └── test/
│   │       └── setup.ts           ← Vitest test setup
│   │
│   └── shared/                    ← SHARED TYPES (Rust ↔ TS)
│       └── types.ts               ← Shared type definitions
│
├── agent-backend/                 ← PYTHON FASTAPI BACKEND
│   ├── main.py                    ← FastAPI entry point
│   ├── requirements.txt           ← Python dependencies
│   ├── Dockerfile                 ← Container build
│   ├── src/
│   │   ├── agent/                 ← Agent core logic
│   │   ├── tools/                 ← Tool implementations (file ops, shell)
│   │   ├── memory/                ← Memory/persistence layer
│   │   ├── models/                ← LLM API clients
│   │   └── api/                   ← API endpoints
│   └── tests/                     ← Python tests
│
└── construct-brand/               ← BRAND ASSETS (delivered separately)
    ├── HANDOVER.md                ← Brand usage guide
    ├── brand-identity-guide.md    ← Full brand specification
    ├── brand-identity-guide.docx  ← Word version
    └── assets/                    ← 11 brand assets (logos, social, icons)
```

---

## 4. What's Built (Detailed Inventory)

### Rust Backend (src/main/src/) — ~1,550 lines

| File | Lines | Status | What It Does |
|------|-------|--------|-------------|
| `main.rs` | ~30 | ✅ | Entry point. Calls `construct_lib::run()` |
| `lib.rs` | ~120 | ✅ | Tauri Builder setup: plugins, sidecar spawn, DB init, tray, commands registration |
| `sidecar.rs` | ~120 | ✅ | Python backend spawn via tauri-plugin-shell, port finding, health monitoring, BackendState |
| `tray.rs` | ~80 | ✅ | System tray with menu: show/hide window, pause/resume agent, settings, quit |
| `db.rs` | ~100 | ✅ | SQLite database init, connection pooling |
| `models.rs` | ~60 | ✅ | Shared data types (AppData, Config, etc.) |
| `state.rs` | ~80 | ✅ | AgentState (HashMap of sessions), AutonomousManager |
| `types.rs` | ~50 | ✅ | Additional type definitions |
| `commands/agent.rs` | ~477 | ✅ | **FULLY IMPLEMENTED**: start_agent (HTTP→Python), get_agent_status, pause_agent, resume_agent, stop_agent, get_agent_output. Event streaming via Tauri events. Connection retry logic. Task tracking. |
| `commands/autonomous.rs` | ~80 | ✅ | toggle_autonomous_mode, get_autonomous_status |
| `commands/memory.rs` | ~120 | ✅ | store_memory, search_memory, get_all_memories, delete_memory, get_memory_stats |

**Key point**: The Rust ↔ Python bridge IS working. `start_agent` in `commands/agent.rs`:
1. Creates a session
2. Spawns an async tokio task
3. POSTs to `http://127.0.0.1:{port}/api/agent/start` on the Python backend
4. Polls `GET /api/agent/{session_id}/events?after={timestamp}` every 500ms
5. Streams events back to frontend via `app.emit()` on `agent:{session_id}` channel

### Python Backend (agent-backend/) — ~3,000+ lines

| Component | Status | What It Does |
|-----------|--------|-------------|
| FastAPI server | ✅ | 50+ endpoints, CORS, middleware |
| `/api/agent/start` | ⚠️ Stub | Receives goal, returns session — needs agent loop |
| `/api/agent/{id}/events` | ⚠️ Stub | Returns events — needs event queue |
| `/api/agent/{id}/stop` | ⚠️ Stub | Stops session |
| Tool system | ⚠️ Partial | File read/write, shell execute — needs integration |
| Memory layer | ✅ | SQLite persistence for conversations |
| LLM client | ⚠️ Stub | API key management, model selection — needs providers |

### React Frontend (src/renderer/) — ~2,000+ lines

| Component | Status | What It Does |
|-----------|--------|-------------|
| Build system | ✅ | Vite, TypeScript, Tailwind all working |
| Router | ✅ | React Router set up |
| Tauri API integration | ⚠️ Partial | Some commands wired, most need UI |
| Monaco editor | ✅ | Conditional (CI-safe) |
| Main layout | ✅ | Sidebar, content area |
| **Agent chat UI** | ❌ **MISSING** | This is the core user experience |
| **Agent streaming display** | ❌ **MISSING** | Real-time event streaming |
| Settings panel | ❌ Missing | API keys, model selection, preferences |
| Project explorer | ⚠️ Partial | File tree needs wiring |

---

## 5. What's Missing (Prioritized)

### P0 — Must Have (MVP)

| # | Item | Where | Effort | Why Critical |
|---|------|-------|--------|-------------|
| 1 | **Python agent reasoning loop** | `agent-backend/src/agent/` | High | The brain. Takes a goal, plans tasks, executes tools, observes results. Without this, the app does nothing useful. |
| 2 | **Frontend agent chat UI** | `src/renderer/pages/` | High | What the user sees. Chat input, streaming output, task list, code viewer. Without this, there's no product. |
| 3 | **Frontend ↔ Rust event streaming** | `src/renderer/hooks/` | Medium | Wire Tauri's `listen()` to React state for real-time agent output. |
| 4 | **Python event queue** | `agent-backend/src/agent/` | Medium | Agent loop generates events → queue → `/api/agent/{id}/events` endpoint serves them. |

### P1 — Important

| # | Item | Where | Effort |
|---|------|-------|--------|
| 5 | Tool execution (file ops, shell) | `agent-backend/src/tools/` | Medium |
| 6 | LLM API integration (OpenAI, Claude, local) | `agent-backend/src/models/` | Medium |
| 7 | Settings/config UI + persistence | `src/renderer/pages/Settings.tsx` | Medium |
| 8 | API key management (secure storage) | Rust: `commands/config.rs` | Medium |
| 9 | Project file explorer (tree view) | `src/renderer/components/` | Low |
| 10 | Code editor integration (Monaco ↔ agent output) | `src/renderer/components/` | Low |

### P2 — Polish

| # | Item | Where | Effort |
|---|------|-------|--------|
| 11 | Auto-updater (tauri-plugin-updater) | `src/main/tauri.conf.json` | Medium |
| 12 | Sidecar crash restart | `src/main/src/sidecar.rs` | Low |
| 13 | Multi-agent team support | `agent-backend/src/agent/` | High |
| 14 | Onboarding flow | `src/renderer/pages/Onboarding.tsx` | Medium |
| 15 | Dark/light theme toggle | `src/renderer/` | Low |

---

## 6. How to Run Locally

### Prerequisites
- Node.js 20+
- Rust (install via rustup.rs): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Python 3.10+ (for backend development)

### Step 1: Install Dependencies

```bash
# Frontend dependencies
cd /path/to/construct
npm install

# Rust dependencies
cd src/main
cargo build

# Python dependencies (for backend)
cd ../../agent-backend
pip install -r requirements.txt
```

### Step 2: Run in Development Mode

Terminal 1 — Python backend:
```bash
cd agent-backend
python main.py
# or with uvicorn directly:
uvicorn main:app --reload --port 8000
```

Terminal 2 — Tauri dev:
```bash
cd /path/to/construct
npm run tauri:dev
# This opens the desktop app with hot reload
```

Terminal 3 — Frontend only (optional, for quick UI work):
```bash
cd /path/to/construct
npm run dev
# Opens in browser at localhost:5173 (no Tauri APIs available)
```

### Step 3: Run Tests

```bash
# Frontend tests (Vitest)
npm test

# Rust tests
cd src/main && cargo test

# Python tests
cd agent-backend && pytest
```

---

## 7. How to Build & Release

### Local Build (Windows MSI)

```bash
cd /path/to/construct

# Method 1: Using npm script (now fixed)
npm run tauri:build

# Method 2: Manual (more control)
cd src/main
cargo build --release                          # Build Rust
npx tauri build --verbose --no-bundle          # Build app (no installer)
npx tauri bundle --bundles msi               # Create MSI installer

# Output:
# src/main/target/release/bundle/msi/Construct_0.1.0_x64_en-US.msi
```

### GitHub Actions (Automated)

Trigger by pushing a version tag:
```bash
git tag -a v0.1.0-alpha.15 -m "Build #91: [description]"
git push origin v0.1.0-alpha.15
```

Monitor: https://github.com/Razisafir/construct-ai-agent/actions

### Current Build Status

| Build | Tag | Status | Notes |
|-------|-----|--------|-------|
| #88 | v0.1.0-alpha.12 | ❌ Failed | `features = []` (missing wry) |
| #89 | v0.1.0-alpha.13 | ❌ Failed | `bundle.identifier` (Tauri v1 field) |
| #90 | v0.1.0-alpha.14 | ✅ Likely succeeds | Both fixes applied |
| #91 | v0.1.0-alpha.15 | 🔄 Ready | Includes `cd src/main` path fix |

### All Fixes Applied So Far

| Commit | Fix | Issue |
|--------|-----|-------|
| `88638d3` | `features = ["wry"]` | Empty `[]` overrode Tauri defaults |
| `619d092` | Removed `bundle.identifier` | Tauri v2 only allows root-level identifier |
| `3340a16` | Removed `plugins.updater` | Tauri v1 schema artifact |
| `736f957` | `cd src/main &&` prefix | Tauri CLI couldn't find config in src/main/ |
| `736f957` | Added `test` script | No way to run vitest |

---

## 8. Critical Configuration Files

### `src/main/tauri.conf.json` — DO NOT BREAK

This file is validated at **compile time** by `tauri_build::build()`. Any unknown field causes the build to fail.

**Correct structure (Tauri v2)**:
```json
{
  "identifier": "com.construct.ai",    ← ROOT LEVEL ONLY (not inside bundle!)
  "bundle": {
    "active": true,
    "targets": ["msi"],
    "icon": ["icons/icon.ico"]
    // NO "identifier" here! NO "plugins" section!
  }
}
```

**Common mistakes**:
- Adding `"identifier"` inside `"bundle"` → build fails
- Adding `"plugins": { "updater": ... }` → build fails (need tauri-plugin-updater crate)
- Wrong `"$schema"` path → may cause validation errors

### `src/main/Cargo.toml` — Critical Dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["wry"] }  ← "wry" is REQUIRED
tauri-plugin-shell = "2"                         ← For sidecar spawning
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-log = "2"
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }  ← HTTP client
rusqlite = { version = "0.32", features = ["bundled"] }             ← Database
```

### `vite.config.ts` — CI-Safe Monaco

Monaco editor plugin is conditionally loaded:
```typescript
const getMonacoPlugin = () => {
  if (process.env.CI) return null;  // Skip in CI
  try {
    return monacoEditor.default({...});
  } catch { return null; }
};
```

### `package.json` — Scripts Reference

| Script | What It Does |
|--------|-------------|
| `npm run dev` | Frontend only, browser, port 5173 |
| `npm run tauri:dev` | Full Tauri app with hot reload |
| `npm run build` | Production frontend build (no Tauri) |
| `npm run tauri:build` | Build Tauri app + MSI installer |
| `npm test` | Run vitest in watch mode |
| `npm run test:run` | Run vitest once (for CI) |
| `npm run lint` | TypeScript type check |

---

## 9. Known Issues & Workarounds

### Git Issues (GitHub TLS)
```bash
# If push fails with TLS/SSL error:
GIT_HTTP_VERSION=1.1 git push origin main

# If git index corrupts:
rm -f .git/index .git/index-lock .git/refs/heads/main.lock
git reset --mixed HEAD --no-refresh
git add . && git commit -m "..."
```

### Rust Build Issues
```bash
# If Cargo.lock stale:
cd src/main && rm -f Cargo.lock && cargo update

# If tauri_build validation fails:
# Check tauri.conf.json — NO unknown fields in "bundle" section
```

### Python Backend Not Running
The Rust app handles this gracefully — it emits an error event to the frontend. But for development, always start the Python backend first.

### Monaco Editor in CI
Monaco is excluded in CI builds (`process.env.CI`). For local dev, make sure `vite-plugin-monaco-editor` is installed.

---

## 10. The Critical Path to MVP

### Phase A: Python Agent Core (Priority 0)

**Goal**: A user types "Create a React counter component" and the agent actually does it.

Files to work on:
1. `agent-backend/src/agent/core.py` — Main agent loop
   - Receives goal from Rust
   - Breaks into tasks (plan)
   - Executes tools (file read/write, shell commands)
   - Observes results
   - Generates events (thought, tool_call, code, error, complete)
   - Writes events to SQLite queue

2. `agent-backend/src/agent/events.py` — Event queue
   - In-memory or SQLite-backed queue
   - Producer (agent loop) adds events
   - Consumer (`/api/agent/{id}/events` endpoint) reads events

3. `agent-backend/src/tools/executor.py` — Tool execution
   - `read_file(path)` → returns contents
   - `write_file(path, content)` → writes file
   - `execute_shell(command)` → runs command, returns output
   - `search_files(query, path)` → finds files

4. `agent-backend/src/models/llm.py` — LLM integration
   - OpenAI GPT-4/4o
   - Anthropic Claude
   - Local models (Ollama)
   - System prompt with tool definitions

### Phase B: Frontend Agent UI (Priority 0)

**Goal**: The user sees a chat interface with streaming agent output.

Files to work on:
1. `src/renderer/pages/AgentChat.tsx` — Main chat page
   - Chat input at bottom
   - Message history (user messages + agent responses)
   - Streaming output (thoughts, tool calls, code)
   - Task list sidebar

2. `src/renderer/hooks/useAgent.ts` — Agent hook
   - `invoke('start_agent', { goal, projectPath })` to start
   - `listen('agent:{sessionId}', callback)` for events
   - Manages session state

3. `src/renderer/components/AgentMessage.tsx` — Message component
   - Renders different event types (thought, code, error, tool_call)
   - Code blocks with syntax highlighting
   - Collapsible thought sections

4. `src/renderer/components/AgentTaskList.tsx` — Task list
   - Shows current tasks
   - Status indicators (pending, running, done, error)

### Phase C: Integration Polish (Priority 1)

1. Settings page for API keys
2. Project file explorer
3. Code editor ↔ agent output integration
4. Sidecar crash restart
5. Error handling & graceful degradation

---

## 11. Rust ↔ Python API Contract

### Rust calls Python:

```
POST /api/agent/start
Body: { "session_id": "abc123", "goal": "...", "project_path": "/path", "mode": "interactive" }

GET  /api/agent/{session_id}/events?after={timestamp}
Response: [{ "session_id": "...", "type": "thought|code|error|...", "content": "...", "timestamp": 123 }]

POST /api/agent/{session_id}/stop

POST /api/agent/{session_id}/pause

POST /api/agent/{session_id}/resume
```

### Python sends events (via SSE or polling):

Event types the frontend expects:
| Type | Content Example | UI Treatment |
|------|----------------|-------------|
| `thought` | "I'll create a counter component..." | Italic, muted color, collapsible |
| `tool_call` | "Reading file: src/App.tsx" | Bold, tool name highlighted |
| `tool_result` | "File contents: ..." | Code block, expandable |
| `code` | "import React..." | Syntax highlighted code block |
| `error` | "File not found" | Red background, error icon |
| `task_start` | "Creating component structure" | Task list item, spinner |
| `task_complete` | "Component created" | Task list item, green check |
| `task_failed` | "Import error" | Task list item, red X |
| `complete` | "Done! Files modified: ..." | Success banner |
| `waiting` | "Waiting for API key" | Yellow alert, user input needed |

---

## 12. Quick Reference

### Start Working (every session)
```bash
cd /path/to/construct
git pull origin main
npm install          # if deps changed
cd src/main && cargo build  # if Rust changed
```

### Run Everything
```bash
# Terminal 1: Python backend
cd agent-backend && python main.py

# Terminal 2: Tauri app
cd construct && npm run tauri:dev
```

### Common Git Commands
```bash
git add . && git commit -m "feat: description"
GIT_HTTP_VERSION=1.1 git push origin main

# Create build tag (triggers GitHub Actions)
git tag -a v0.1.0-alpha.XX -m "Build #XX: description"
git push origin v0.1.0-alpha.XX

# Delete and recreate tag if needed
git tag -d v0.1.0-alpha.XX
git push origin :refs/tags/v0.1.0-alpha.XX
git tag -a v0.1.0-alpha.XX -m "Build #XX: description"
git push origin v0.1.0-alpha.XX --force
```

### Check Build Status
https://github.com/Razisafir/construct-ai-agent/actions

---

## 13. Brand Assets Location

Full brand system delivered at:
```
construct-brand/
├── HANDOVER.md                    ← Brand usage guide (756 lines)
├── brand-identity-guide.md        ← Full brand specification
├── brand-identity-guide.docx      ← Word version
└── assets/
    ├── logo-full-dark.png         ← App header, installer, about
    ├── logo-icon-dark.png         ← Taskbar, dock, favicon
    ├── logo-wordmark-dark.png     ← Small sizes where mark won't render
    ├── social-x-card.png          ← X/Twitter social card
    ├── social-github-preview.png  ← GitHub repo social preview
    ├── social-linkedin-banner.png ← LinkedIn company banner
    ├── social-open-graph.png      ← Website Open Graph image
    ├── social-producthunt.png     ← Product Hunt thumbnail
    ├── app-icon-macos.png         ← macOS 512x512 dock icon
    ├── app-icon-windows.png       ← Windows 150x150 tile icon
    └── favicon-32x32.png          ← Browser favicon
```

### Design Tokens Quick Reference
| Token | Hex | Usage |
|-------|-----|-------|
| Void | #0d0d0f | App background |
| Depth | #141416 | Panels, sidebars |
| Surface | #1a1a1f | Cards, inputs |
| Text Primary | #e8e8f0 | Headings, body |
| Text Secondary | #8888a0 | Labels |
| Agent Purple | #9b7cf7 | AI actions, logo |
| Link Blue | #4f8ef7 | Interactive |
| Success Green | #00d26a | Success states |
| Warning Amber | #f5a623 | Warnings |
| Error Red | #f05252 | Errors |

---

## 14. Contact & Context

- **Repository**: https://github.com/Razisafir/construct-ai-agent
- **Build Monitor**: https://github.com/Razisafir/construct-ai-agent/actions
- **Brand Assets**: `/construct-brand/` (relative to repo root)
- **Handover Date**: 2026-05-30
- **Total Code**: ~110,000 lines across all languages
- **Last Fix**: `736f957` — tauri script paths + test scripts

**Session continuity prompt** for the next session is available if needed — it contains all project context, current state, and known issues in a copy-paste ready format.

---

*End of handover. Good luck building. — The coding agent that never forgets.*
