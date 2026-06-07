<div align="center">

# CONSTRUCT IDE

**An offline-first AI coding environment. Autonomous agents. Local LLMs. No cloud required.**

[![Version](https://img.shields.io/badge/version-0.1.0--beta-orange.svg)](https://github.com/Razisafir/CONSTRUCT-VSCODE)
[![License](https://img.shields.io/badge/license-dual--MIT%2Fproprietary-blue.svg)](./CONSTRUCT_LICENSE.txt)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Razisafir/CONSTRUCT-VSCODE)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/Razisafir/CONSTRUCT-VSCODE/actions)

</div>

---

## What is CONSTRUCT?

CONSTRUCT IDE is a fork of VS Code rebuilt for AI-native development. It runs large language models **locally on your machine**, embeds autonomous coding agents directly into the editor, and keeps your data on your hardware — always. Unlike Cursor or GitHub Copilot, CONSTRUCT requires **zero cloud connectivity**. Your code, your conversations, and your API keys never leave your device. No telemetry. No Microsoft account. No subscription.

## Features

- **Autonomous AI coding agents with tool use** — Plan-act agent loop that reads files, writes code, runs terminal commands, and searches your codebase — all with human approval before applying changes
- **Offline-first: runs on Ollama, LM Studio, or local ONNX models** — GPU-accelerated inference with automatic fallback to in-process ONNX (Xenova) or cloud APIs
- **Built-in Kali Linux terminal on Windows via WSL2** — Detects Kali WSL2 automatically and adds a dedicated terminal profile for security testing workflows
- **Codebase memory: semantic search over your entire workspace** — Indexes your workspace into vector embeddings (Ollama `nomic-embed-text` + Qdrant) and injects relevant context into every agent conversation; falls back to BM25 keyword search when embeddings aren't available
- **Multi-model: switch between local and cloud models in one click** — Status bar model picker lets you swap providers instantly
- **No telemetry, no Microsoft account, no subscription** — All Microsoft telemetry (1DS, Application Insights) removed; Open VSX gallery replaces the proprietary marketplace

## Screenshots / Demo

<!-- Add screenshots here -->

> **Placeholder:** Add screenshots of the agent panel, onboarding wizard, and status bar model picker.

## Prerequisites

- **Node.js 20+** and **npm 10+**
- **Git**
- For local AI: [Ollama](https://ollama.ai) (recommended) or [LM Studio](https://lmstudio.ai)
- For Kali terminal (Windows only): WSL2 + Kali Linux from Microsoft Store

## Install & Build from Source

```bash
git clone https://github.com/Razisafir/CONSTRUCT-VSCODE
cd CONSTRUCT-VSCODE
npm install
NODE_OPTIONS="--max-old-space-size=8192" npm run compile
./scripts/code.sh        # Linux/macOS
.\scripts\code.bat       # Windows
```

## First Launch

When you start CONSTRUCT for the first time, the setup wizard opens automatically and walks you through:

1. **Welcome** — Overview of CONSTRUCT features
2. **Provider Setup** — Detects Ollama, lists available models, lets you pick a default
3. **Kali Terminal** (Windows only) — Detects Kali WSL2 and offers to enable it
4. **Ready** — Saves your configuration and starts the IDE

Pull the recommended models before launching:

```bash
ollama pull mistral
ollama pull nomic-embed-text
```

You can re-open the wizard anytime via the Command Palette: `Construct: Open Setup Wizard`.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+K` | Open CONSTRUCT chat |
| `Ctrl+Enter` | Send message |
| `Ctrl+Shift+Enter` | Accept all pending diffs |
| `Ctrl+Shift+Escape` | Reject all pending diffs |

## Configuration

CONSTRUCT stores workspace settings in `.construct/settings.json`:

```json
{
  "defaultModel": "mistral",
  "ollamaEndpoint": "http://localhost:11434",
  "kaliEnabled": false,
  "providerType": "ollama",
  "embeddingModel": "nomic-embed-text"
}
```

| Field | Description |
|---|---|
| `defaultModel` | Model ID used for agent conversations (e.g. `mistral`, `llama3`) |
| `ollamaEndpoint` | Ollama API base URL (default: `http://localhost:11434`) |
| `kaliEnabled` | Enable the Kali Linux terminal profile (Windows + WSL2 only) |
| `providerType` | AI provider backend: `ollama`, `xenova`, or `cloud` |
| `embeddingModel` | Embedding model for semantic search (default: `nomic-embed-text`) |

## Architecture

CONSTRUCT IDE is built on the [VS Code open-source project](https://github.com/microsoft/vscode) with the following additions:

- **VS Code fork** — Full editor with all upstream features intact
- **`IConstructAIService`** — Unified AI provider interface for Ollama, Xenova ONNX, and cloud backends
- **Agent loop** — Plan/act cycle with 5 built-in tools (read, write, run, search, memory)
- **MCP tool registry** — Extensible tool execution engine with command safety blocklist
- **Qdrant + BM25 memory** — Hybrid retrieval: vector embeddings with keyword fallback

```
┌─────────────────────────────────────────────┐
│               CONSTRUCT IDE                  │
├──────────┬──────────┬───────────────────────┤
│  Editor  │  Agent   │   Terminal            │
│  (VS Code│  Panel   │   (Kali/WSL2)         │
│   fork)  │          │                       │
├──────────┴──────────┴───────────────────────┤
│           IConstructAIService                │
├──────────┬──────────┬───────────────────────┤
│ Ollama   │ Xenova   │   Cloud API           │
│ Provider │ Provider │   Provider            │
├──────────┴──────────┴───────────────────────┤
│        MCP Tool Registry + Memory           │
│     (Qdrant vector · BM25 keyword)          │
└─────────────────────────────────────────────┘
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Branch naming conventions (`feature/`, `fix/`, `security/`)
- TypeScript strict mode requirements
- PR workflow (target `main-dev`, not `main`)

## License

CONSTRUCT IDE is built on the [VS Code open-source project](https://github.com/microsoft/vscode) which is MIT licensed.

The CONSTRUCT IDE features, agent loop, AI provider system, and all original additions are proprietary. See [CONSTRUCT_LICENSE.txt](./CONSTRUCT_LICENSE.txt) for details.
