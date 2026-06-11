<div align="center">

# Kovix

**AI-native development environment with autonomous coding agents**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Razisafir/KOVIX)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Razisafir/KOVIX)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/Razisafir/KOVIX/actions)

</div>

---

## What is Kovix?

Kovix is an AI-native development environment built on the [VS Code open-source (Code-OSS)](https://github.com/microsoft/vscode) foundation. It integrates autonomous coding agents directly into the editor, enabling a workflow where AI reads your codebase, writes code, runs terminal commands, and searches your project — all with human approval before applying changes. Unlike cloud-dependent tools like Cursor or GitHub Copilot, Kovix is designed to work with **local LLMs** via Ollama or LM Studio, ensuring your code and API keys never leave your machine. No telemetry, no Microsoft account, and no subscription required.

The agent system uses a plan/act loop: you describe what you want, the agent reasons through the steps, calls tools (file read/write, terminal execution, code search), and presents changes for your review. Multiple AI backends are supported — switch between Ollama for fully offline inference, Xenova Transformers.js for in-process ONNX models, or cloud APIs like Anthropic for maximum capability.

## Built on Code-OSS

Kovix is built on [Microsoft's Code-OSS]((https://github.com/microsoft/vscode)), the open-source foundation of VS Code, used under the [MIT License](https://opensource.org/licenses/MIT). We are grateful to Microsoft and the VS Code team for their incredible work on the editor platform that makes Kovix possible. All VS Code editor features, the extension system, terminal, debugging, and the entire workbench are inherited from Code-OSS.

## Features

- **Autonomous AI coding agents with tool use** — Plan-act agent loop that reads files, writes code, runs terminal commands, and searches your codebase — all with human approval before applying changes
- **MCP protocol support** — Connect any Model Context Protocol server to extend agent capabilities with custom tools via JSON-RPC over stdio
- **Vector memory (Qdrant)** — Index your entire workspace into vector embeddings for semantic search and automatic context injection into agent conversations
- **Local ML models (Transformers.js)** — In-process ONNX inference via @xenova/transformers for code completion without any external API
- **Persistent memory (Supermemory)** — Conversation context persistence and memory management across sessions
- **Offline-first: runs on Ollama, LM Studio, or local ONNX models** — GPU-accelerated inference with automatic fallback to in-process ONNX or cloud APIs
- **Built-in Kali Linux terminal on Windows via WSL2** — Detects Kali WSL2 automatically and adds a dedicated terminal profile for security testing workflows
- **Security tooling: nmap, Ghidra, Nuclei** — Integrated network scanning, binary decompilation, and vulnerability scanning with safety gates requiring explicit user confirmation
- **Multi-model: switch between local and cloud models in one click** — Status bar model picker lets you swap providers instantly
- **No telemetry, no Microsoft account, no subscription** — All Microsoft telemetry removed; Open VSX gallery replaces the proprietary marketplace

## Screenshots / Demo

<!-- Add screenshots here -->

> **Placeholder:** Add screenshots of the agent panel, onboarding wizard, and status bar model picker.

## Prerequisites

- **Node.js 20+** and **npm 10+**
- **Git**
- For local AI: [Ollama](https://ollama.ai) (recommended) or [LM Studio](https://lmstudio.ai)
- For Kali terminal (Windows only): WSL2 + Kali Linux from Microsoft Store
- For Ghidra decompilation: [Docker](https://www.docker.com) + `ghidra-headless` image

See [INSTALL.md](./INSTALL.md) for detailed platform-specific installation instructions.

## Installation

### Download from Releases

Pre-built binaries for Windows, macOS, and Linux are available on the [GitHub Releases](https://github.com/Razisafir/KOVIX/releases) page.

### Build from Source

```bash
git clone https://github.com/Razisafir/KOVIX
cd KOVIX
npm install
NODE_OPTIONS="--max-old-space-size=8192" npm run compile
./scripts/code.sh        # Linux/macOS
.\scripts\code.bat       # Windows
```

For detailed build instructions, see [BUILD.md](./BUILD.md).

## First Launch

When you start Kovix for the first time, the setup wizard opens automatically and walks you through:

1. **Welcome** — Overview of Kovix features
2. **Provider Setup** — Detects Ollama, lists available models, lets you pick a default
3. **Kali Terminal** (Windows only) — Detects Kali WSL2 and offers to enable it
4. **Ready** — Saves your configuration and starts the IDE

Pull the recommended models before launching:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

You can re-open the wizard anytime via the Command Palette: `Kovix: Open Setup Wizard`.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+K` | Open Kovix Agent panel |
| `Ctrl+Shift+I` | Show inline agent |
| `Ctrl+Enter` | Send message |
| `Ctrl+Shift+Enter` | Accept all pending diffs |
| `Ctrl+Shift+Escape` | Reject all pending diffs |

## Commands

All Kovix commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `construct.focusPanel` | Open the Kovix Agent panel (`Ctrl+Shift+K`) |
| `construct.newChat` | Start a new chat session |
| `construct.setApiKey` | Set Anthropic API key (stored in OS keychain) |
| `construct.clearApiKey` | Remove stored API key |
| `construct.switchProvider` | Switch between Ollama / Xenova / Cloud providers |
| `construct.selectModel` | Select the active AI model |
| `construct.indexWorkspace` | Index workspace for semantic search |
| `construct.openMemoryPanel` | Open the Memory panel |
| `construct.searchMemories` | Search stored memories |
| `construct.addMemory` | Add a manual memory entry |
| `construct.testCloudConnection` | Test cloud AI connection |
| `construct.testMemoryConnection` | Test memory service connection |
| `construct.openApiSettings` | Open Kovix API settings |
| `construct.undoTask` | Undo last agent task |
| `construct.showInlineAgent` | Show inline agent (`Ctrl+Shift+I`) |

## Configuration

Kovix stores workspace settings in `.kovix/settings.json`:

```json
{
  "defaultModel": "llama3.2",
  "ollamaEndpoint": "http://localhost:11434",
  "kaliEnabled": false,
  "providerType": "ollama",
  "embeddingModel": "nomic-embed-text",
  "enableSecurityTools": true
}
```

| Field | Description |
|---|---|
| `defaultModel` | Model ID used for agent conversations (e.g. `llama3.2`, `mistral`) |
| `ollamaEndpoint` | Ollama API base URL (default: `http://localhost:11434`) |
| `kaliEnabled` | Enable the Kali Linux terminal profile (Windows + WSL2 only) |
| `providerType` | AI provider backend: `ollama`, `xenova`, or `cloud` |
| `embeddingModel` | Embedding model for semantic search (default: `nomic-embed-text`) |
| `enableSecurityTools` | Enable security tools (nmap, Ghidra, Nuclei) in agent |

## Security Tooling

Kovix integrates professional security tools directly into the agent loop. Every security tool has a **safety gate** — the agent must receive explicit user confirmation before execution.

### nmap_scan — Network Scanner

Target scanning with XML output parsing. The agent can scan hosts, detect open ports, and identify running services.

```
User: Scan 192.168.1.100 for open ports
Agent: I'd like to run nmap to scan that target. Approve? [Yes/No]
→ Parses XML output, summarizes open ports and services
```

Requires: `nmap` installed on the system (`sudo apt-get install nmap` / `brew install nmap`)

### ghidra_decompile — Binary Decompilation

Binary decompilation via Docker headless Ghidra. Upload a binary and get decompiled C-like source code.

```
User: Decompile the function at 0x00401000 in malware.exe
Agent: Running Ghidra headless decompilation. Approve? [Yes/No]
→ Returns decompiled pseudocode from the specified address
```

Requires: Docker + `ghidra-headless` image (`docker pull ghidra-headless`)

### nuclei_scan — Vulnerability Scanner

Template-based vulnerability scanning with severity filtering and JSON output parsing.

```
User: Scan https://example.com for CVEs
Agent: Running Nuclei vulnerability scan. Approve? [Yes/No]
→ Parses JSON output, lists findings by severity (critical/high/medium/low)
```

Requires: `nuclei` installed (`go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`)

## MCP Servers

Kovix supports the **Model Context Protocol (MCP)**, allowing you to connect external tool servers that extend the agent's capabilities. MCP servers provide additional tools the agent can call during conversations.

### Configuration

MCP servers are configured via the `construct.mcp.servers` setting (array of objects):

```json
{
  "construct.mcp.servers": [
    {
      "name": "my-server",
      "command": "node",
      "args": ["path/to/mcp-server.js"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  ]
}
```

| Field | Description |
|---|---|
| `name` | Unique identifier for the MCP server (used in tool dispatch) |
| `command` | Executable to launch the server |
| `args` | Arguments passed to the command |
| `env` | Environment variables for the server process |

### Tool Dispatch Format

Tools from MCP servers are dispatched using the format: `mcpServerName__toolName`

For example, a server named `my-server` exposing a tool `query_database` would be invoked as `my-server__query_database`.

### Managing MCP Servers

- Add servers via Settings → search `construct.mcp.servers`
- Restart Kovix after adding or removing servers
- The agent automatically discovers available MCP tools and includes them in its tool registry
- MCP tools respect the same safety blocklist as built-in tools

## Semantic Memory

Kovix indexes your entire workspace for semantic search, enabling the agent to retrieve relevant context without you having to specify file paths.

### How It Works

1. **Indexing** — Run `Kovix: Index Workspace` (or it triggers automatically). Files are chunked and embedded using Ollama's `nomic-embed-text` model (or falls back to pseudo-embeddings).
2. **Storage** — Embeddings are stored in a local Qdrant vector database running in-process. BM25 keyword indexing runs as a fallback.
3. **Retrieval** — When you ask the agent a question, relevant code chunks are injected into the conversation context automatically.

### Commands

| Command | Description |
|---|---|
| `construct.indexWorkspace` | Build or rebuild the workspace index |
| `construct.openMemoryPanel` | View and manage indexed memories |
| `construct.searchMemories` | Search stored memories by query |
| `construct.addMemory` | Add a manual memory entry |

### Configuration

```json
{
  "embeddingModel": "nomic-embed-text",
  "ollamaEndpoint": "http://localhost:11434"
}
```

If Ollama is unavailable, the system falls back to BM25 keyword search — no embeddings required.

## Architecture

Kovix is built on the [VS Code open-source project](https://github.com/microsoft/vscode) with the following additions:

- **VS Code fork** — Full editor with all upstream features intact
- **`IKovixAIService`** — Unified AI provider interface for Ollama, Xenova ONNX, and cloud backends
- **Agent loop** — Plan/act cycle with built-in tools (read, write, run, search, memory) plus security tools and MCP extensions
- **MCP tool registry** — Extensible tool execution engine with command safety blocklist; dispatches MCP tools via `serverName__toolName` format
- **Security tools** — nmap_scan, ghidra_decompile, nuclei_scan with user-approval safety gates
- **Qdrant + BM25 memory** — Hybrid retrieval: vector embeddings with keyword fallback

```
┌──────────────────────────────────────────────────────┐
│                    Kovix                       │
├──────────┬──────────┬──────────┬─────────────────────┤
│  Editor  │  Agent   │ Terminal │  Memory Panel       │
│ (VS Code │  Panel   │(Kali/    │  (Qdrant/BM25)      │
│  fork)   │          │ WSL2)    │                     │
├──────────┴──────────┴──────────┴─────────────────────┤
│              IKovixAIService                       │
├──────────┬──────────┬────────────────────────────────┤
│ Ollama   │ Xenova   │   Cloud API (Anthropic)        │
│ Provider │ Provider │   Provider                     │
├──────────┴──────────┴────────────────────────────────┤
│         Tool Registry (Built-in + MCP + Security)     │
├─────────────┬───────────────┬────────────────────────┤
│ Agent Tools │ Security Tools│  MCP Server Tools      │
│ read/write/ │ nmap_scan /   │  server__tool          │
│ run/search/ │ ghidra /      │  (user-configured)     │
│ memory      │ nuclei_scan   │                        │
├─────────────┴───────────────┴────────────────────────┤
│           Semantic Memory (Qdrant · BM25)             │
│          nomic-embed-text embeddings                  │
└──────────────────────────────────────────────────────┘
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Branch naming conventions (`feature/`, `fix/`, `security/`)
- TypeScript strict mode requirements
- PR workflow (target `main-dev`, not `main`)

## Known Limitations

- **No code signing**: Windows and macOS builds are not code-signed. Users may see SmartScreen (Windows) or Gatekeeper (macOS) warnings when installing. Right-click > Open on macOS, or More Info > Run Anyway on Windows to bypass.
- **Build requires 16GB+ RAM**: Full packaging builds (`npm run gulp vscode-linux-x64`) require 16GB+ RAM. 8GB machines may OOM during compilation.
- **Python agent backend removed**: The `agent-backend/` Python server has been removed. All AI processing is handled by the TypeScript providers (Ollama, Cloud, Xenova) directly.
- **Dependabot vulnerabilities**: GitHub reports ~250 dependency vulnerabilities from the VS Code upstream. Most are in dev dependencies. See the Dependabot alerts for details.

## License

This project is licensed under the [MIT License](./LICENSE).

## Fork Attribution

Kovix is a fork of [Code-OSS](https://github.com/microsoft/vscode) by Microsoft, used under the [MIT License](https://opensource.org/licenses/MIT). The original VS Code open-source project is available at https://github.com/microsoft/vscode.
