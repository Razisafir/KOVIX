# Changelog

## [1.0.0] - 2026-06-09

### Added
- AI-native agent framework built on MCP (Model Context Protocol)
- Vector memory integration via Qdrant
- Local ML inference via Transformers.js (@xenova/transformers)
- Persistent memory layer via Supermemory
- Redis-backed session management via ioredis
- Construct IDE branding and identity

### Changed
- Rebranded from Code-OSS to Construct IDE
- Extension gallery pointed to Open VSX Registry (open-source marketplace)

### Based On
- Microsoft Code-OSS (VS Code open source) — MIT License

---

## [1.0.0-beta] — 2025

### Added (Phase 2)

- LLM Provider Layer: Anthropic (SSE streaming) and Ollama (NDJSON streaming) providers
- Typed error classes: ConstructAuthError, ConstructRateLimitError, ConstructOverloadedError, ConstructNetworkError
- API key management via VS Code SecretStorage (construct.setApiKey / construct.clearApiKey commands)
- Configuration settings: construct.provider, construct.anthropic.model, construct.ollama.baseUrl, construct.ollama.model, construct.maxTokens

### Added (Phase 3)

- Agent loop with full plan/act cycle: message → system prompt → LLM → parse tool calls → execute → loop
- Core tools: file_read (with 100KB truncation, path traversal protection), file_write (overwrite/append/create_only modes), run_terminal_command (with allowlist + approval gate), list_directory (recursive, .gitignore aware)
- Tool registry with auto-generated system prompt tools section
- Max iteration limit (15 rounds), per-call timeout (60s), error propagation, cancellation support

### Added (Phase 4)

- CONSTRUCT sidebar panel with Activity Bar icon
- Chat view: scrollable message list, textarea input (Shift+Enter for newlines), send/stop/clear buttons
- Status bar integration: provider/model indicator, pending changes counter
- Streaming response rendering with auto-scroll
- Provider status and configuration UI (gear icon, test connection)

### Added (Phase 6)

- Security tools: nmap_scan (XML output parsing, confirmation gate), ghidra_decompile (Docker headless), nuclei_scan (JSON output parsing, severity filtering)
- construct.enableSecurityTools configuration setting
- All security tools gated behind user confirmation dialogs

### Added (Phase 7)

- MCP server management: spawn, communicate (JSON-RPC over stdio), auto-restart (3 retries with exponential backoff)
- MCP tool dispatch: serverName__toolName routing in agent loop
- construct.mcp.servers configuration for server definitions

### Added (Phase 8)

- Semantic memory: Ollama embedding service (/api/embed with nomic-embed-text, pseudo-embedding fallback)
- Workspace indexing command (construct.indexWorkspace)
- Memory integration: top-5 relevant context chunks prepended to system prompt

### Packaging (Phase 9)

- Documented packaging approaches and system requirements (PACKAGING.md)
- VSIX packaging confirmed N/A (fork architecture, not an extension)
- Gulp pipeline verified: vscode-linux-x64, deb, rpm, snap targets available
- Full build requires 16+ GB RAM (OOM on 8 GB system)

## [0.1.0-beta] — 2025

### Added

- Unified AI provider system (`IConstructAIService`) with Ollama, Xenova, and Cloud backends
- Autonomous agent loop with plan/act cycle and 5 built-in tools
- Real semantic search via Ollama embeddings + BM25 fallback
- 4-step onboarding wizard with Ollama and WSL2 detection
- Kali Linux terminal integration on Windows via WSL2
- MCP tool execution engine with command safety blocklist
- Path traversal protection on all file operations
- Prompt injection defence on context injection
- API key vault via OS keychain
- Telemetry fully disabled (1DS stubbed)
- Custom status bar model picker
- Open VSX extension gallery (no Microsoft account required)

### Security

- Electron contextIsolation and sandbox enabled
- IPC channel input validation with allowlists and shared constants (constructIpcChannels.ts)
- Terminal command blocklist and rate limiting
- Secret redaction in all log output
- Pre-commit hook for secret detection

### Known Issues

- `@xenova/transformers` ONNX inference not yet functional in Electron sandbox (BM25 fallback active)
- macOS code signing not configured for v0.1.0-beta (unsigned build)
- Windows SmartScreen warning expected on first launch (unsigned installer)
