# CONSTRUCT IDE

**An offline-first AI coding environment**

CONSTRUCT IDE is a fork of VS Code (Code - OSS) rebuilt for AI-native development. It runs large language models locally, embeds autonomous coding agents directly into the editor, and keeps your data on your machine. No telemetry. No cloud dependencies. No compromises on privacy.

## Features

- **Local LLM via Ollama** — Run Mistral, Llama, Phi, and other models on your own hardware. GPU-accelerated inference with automatic fallback to in-process ONNX models (Xenova) or cloud APIs.
- **Autonomous agents with tool use** — Plan-act agent loop that reads files, writes code, runs terminal commands, and searches your codebase — all with human approval before applying changes.
- **Kali Linux terminal on Windows** — Detects Kali WSL2 automatically and adds a dedicated terminal profile for security testing workflows.
- **Codebase memory with RAG** — Indexes your workspace into vector embeddings (Ollama `nomic-embed-text` + Qdrant) and injects relevant context into every agent conversation. Falls back to BM25 keyword search when embeddings aren't available.
- **Open-source & no telemetry** — All Microsoft telemetry (1ds-core, Application Insights) has been removed. Your code and conversations never leave your machine.

## Prerequisites

- **Node.js 20+** and **npm**
- **Ollama** — [Install from ollama.ai](https://ollama.ai), then pull models:
  ```bash
  ollama pull mistral
  ollama pull nomic-embed-text
  ```
- **Qdrant** (optional, for vector search) — [Install from qdrant.tech](https://qdrant.tech/)

## Install

```bash
git clone https://github.com/Razisafir/CONSTRUCT-VSCODE.git
cd CONSTRUCT-VSCODE
npm install
npm run compile
./scripts/code.sh
```

## First Launch

When you start CONSTRUCT for the first time, the setup wizard opens automatically and walks you through:

1. **Welcome** — Overview of CONSTRUCT features
2. **Provider Setup** — Detects Ollama, lists available models, lets you pick a default
3. **Kali Terminal** (Windows only) — Detects Kali WSL2 and offers to enable it
4. **Ready** — Saves your configuration and starts the IDE

You can re-open the wizard anytime via the Command Palette: `Construct: Open Setup Wizard`.

## Configuration

CONSTRUCT stores settings in two places:

**VS Code settings** (preferred, editable via Settings UI):
- `construct.provider.default` — AI provider: `ollama`, `xenova`, or `cloud`
- `construct.provider.model` — Default model ID
- `construct.terminal.kaliWSL` — Enable Kali terminal profile
- `construct.cloud.baseUrl` — Cloud API base URL (for OpenAI-compatible endpoints)
- `construct.cloud.apiKey` — Cloud API key

**Workspace config** (`.construct/settings.json` in your project root):
```json
{
  "defaultModel": "mistral",
  "ollamaEndpoint": "http://localhost:11434",
  "kaliEnabled": false,
  "providerType": "ollama",
  "embeddingModel": "nomic-embed-text"
}
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+C` | Focus agent panel |
| `Ctrl+Shift+I` | Inline edit |
| `Ctrl+Shift+Enter` | Accept all pending diffs |
| `Ctrl+Shift+Esc` | Reject all pending diffs |

## Contributing

- **Branch per feature** — Create a branch like `feature/my-feature` or `phase/N-description`
- **TypeScript strict** — No implicit `any`, full strict mode
- **PR to dev branch** — All PRs target the `dev` branch
- **Document as you go** — JSDoc on all public methods

## License

MIT
