# Construct IDE — Architecture Overview

## What is Construct IDE?

Construct IDE is a fork of Microsoft VS Code, rebranded and extended with a built-in AI coding agent. Unlike Cursor or other AI editors that rely on cloud APIs, Construct runs a 100% local Python backend (FastAPI + ReAct agent + SQLite/ChromaDB memory), giving you a powerful AI assistant with zero data leaving your machine.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Construct IDE                          │
│                    (VS Code Fork Shell)                       │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  VS Code     │  │  Construct   │  │  VS Code Core       │ │
│  │  Extensions  │  │  Agent Ext   │  │  (Editor, Terminal, │ │
│  │  (50,000+)   │  │  (Built-in)  │  │   Git, Debugger,   │ │
│  │              │  │              │  │   LSP, etc.)        │ │
│  └─────────────┘  └──────┬───────┘  └─────────────────────┘ │
│                          │ HTTP/SSE                          │
│                          │ localhost:8000                     │
│  ┌───────────────────────┴──────────────────────────────────┐│
│  │              agent-backend (Python FastAPI)               ││
│  │                                                          ││
│  │  ┌─────────┐ ┌────────┐ ┌──────┐ ┌─────┐ ┌───────────┐ ││
│  │  │  ReAct  │ │ LLM    │ │Memory│ │ 39  │ │   MCP     │ ││
│  │  │ Executor│ │Service │ │SQLite│ │Tools│ │  Client   │ ││
│  │  │         │ │10+prov │ │Chroma│ │     │ │           │ ││
│  │  └─────────┘ └────────┘ └──────┘ └─────┘ └───────────┘ ││
│  │  ┌─────────────┐ ┌──────────┐ ┌────────────────────────┐││
│  │  │   Safety    │ │Telemetry │ │   Shadow Filesystem   │││
│  │  │   Monitor   │ │  Traces  │ │   (Virtual Staging)   │││
│  │  └─────────────┘ └──────────┘ └────────────────────────┘││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. VS Code Fork (`vscode-fork/`)

The primary frontend — a fork of Microsoft VS Code with:

- **Rebranding**: Product name, icons, window titles changed to "Construct IDE"
- **Construct Dark Theme**: Built-in dark theme with cyan accents (#00E5FF)
- **Construct Agent Extension**: Built-in extension (always active, not marketplace-installed)
- **Bundled Backend**: Python executable shipped alongside the IDE

The fork preserves all VS Code capabilities: 50,000+ extensions, real terminal (node-pty), real debugger, real LSP, real Git UI, real search — everything VS Code users expect.

### 2. Construct Agent Extension (`vscode-fork/extensions/construct-agent/`)

A VS Code extension that provides the AI agent UI:

- **Agent Panel**: Sidebar webview for chat-based interaction with the agent
- **Inline Chat**: Cmd+Shift+L to edit code at cursor position
- **Status Bar**: Agent status (Ready/Thinking/Offline), model name, pending changes
- **Commands**: Command palette integration for all agent actions
- **API Client**: HTTP client connecting to Python backend via localhost:8000

The extension communicates with the Python backend exclusively via HTTP and Server-Sent Events (SSE). No IPC, no WebSocket complexity — simple REST.

### 3. Agent Backend (`agent-backend/`) — SHARED & SACRED

The Python FastAPI backend that powers the AI agent. This is shared between both frontends:

- **ReAct Executor**: The core agent loop (Reason → Act → Observe → Repeat)
- **LLM Service**: 10+ providers (Ollama, OpenAI, Anthropic, Google, etc.)
- **Memory**: SQLite for structured data, ChromaDB for semantic search
- **39 Tools**: File operations, code analysis, terminal, web, Git, search
- **Safety Monitor**: 41 patterns for validating agent actions
- **MCP Client**: Model Context Protocol for tool extensibility
- **Shadow Filesystem**: Virtual staging area for agent changes before merging
- **Telemetry**: Execution traces for debugging and observability

**Rule**: Never modify agent-backend/ for the VS Code fork. Both frontends use identical API endpoints.

### 4. Legacy Tauri Frontend (`src/`)

The original Tauri v2 frontend — preserved for backward compatibility. Not modified or deleted.

### 5. Shared Types (`shared-types/`)

TypeScript type definitions that mirror the Python backend's API contracts. Used by both the VS Code extension and (optionally) the Tauri frontend.

## Data Flow

```
User types in Agent Panel
         │
         ▼
Extension sends POST /agent/start
         │
         ▼
Backend creates session, starts ReAct loop
         │
         ▼
Backend streams events via SSE (/agent/{id}/stream)
         │
         ▼
Extension receives events, updates webview
         │
    ┌────┴─────┐
    │ Thought  │ Show reasoning in chat
    │ Action   │ Show tool execution
    │ Result   │ Show observation
    │ Complete │ Enable accept/reject
    └──────────┘
         │
         ▼
User clicks "Accept All" or "Reject All"
         │
         ▼
POST /shadow/merge or POST /shadow/discard
         │
         ▼
Changes applied to workspace (or discarded)
```

## IPC Protocol

All communication between the extension and backend uses HTTP on localhost:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check, backend status |
| `/agent/start` | POST | Start a new agent session |
| `/agent/{id}/stream` | GET (SSE) | Stream agent events |
| `/agent/{id}/status` | GET | Get session status |
| `/agent/{id}/cancel` | POST | Cancel running session |
| `/shadow/changes` | GET | List pending file changes |
| `/shadow/merge` | POST | Accept changes |
| `/shadow/discard` | POST | Reject changes |
| `/memory/recall` | GET | Semantic memory search |
| `/tools/list` | GET | List available tools |
| `/models/list` | GET | List available LLM models |

## Build System

### Development
```bash
# Start backend
cd agent-backend && python -m uvicorn app:app --port 8000

# Start VS Code in dev mode
cd vscode-fork && yarn && yarn watch
```

### Production (CI/CD)
The GitHub Actions workflow (`build-vscode.yml`) handles:
1. Build Python backend as PyInstaller executable
2. Copy executable to `vscode-fork/resources/agent-backend/`
3. Build VS Code for target platform
4. Package as installer (exe/dmg/deb/rpm)
5. Upload as artifact / create GitHub Release

### Platform Support
- **Windows**: System installer (.exe), user installer, portable zip
- **macOS**: DMG for ARM64 and x64
- **Linux**: .deb and .rpm packages

## Upstream Sync

VS Code updates frequently (monthly releases). To sync:

```bash
./scripts/sync-vscode.sh           # Normal sync
./scripts/sync-vscode.sh --dry-run # Preview changes
```

This fetches from microsoft/vscode and rebases our changes on top, preserving our customizations (product.json, theme, agent extension).

## Comparison: Tauri vs VS Code Fork

| Feature | Tauri (Legacy) | VS Code Fork (Primary) |
|---------|---------------|----------------------|
| App size | 8MB | ~300MB |
| Terminal | Fake (xterm.js only) | Real (node-pty + xterm.js) |
| LSP | None | Full IntelliSense (50+ languages) |
| Debugger | None | Full debugger (breakpoints, vars, stack) |
| Extensions | None | 50,000+ marketplace |
| Git UI | None | Full Git integration |
| AI Agent | Yes | Yes (identical backend) |
| Memory | Yes | Yes |
| Local-first | Yes | Yes |

The trade-off is clear: 300MB buys you a real IDE. The 8MB Tauri app is impressive but ultimately a webview — it cannot compete with VS Code's 8+ years of editor engineering.

## Security Model

- Backend only listens on 127.0.0.1:8000 (localhost only)
- No cloud API calls unless user explicitly configures an LLM provider
- Shadow filesystem ensures agent changes are reviewable before applying
- Safety monitor validates all agent actions against 41 safety patterns
- No telemetry or data collection by default
