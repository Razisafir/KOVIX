# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Construct IDE, please report it by:

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. Email: security@construct-ide.dev
3. Or use GitHub's private vulnerability reporting: https://github.com/Razisafir/CONSTRUCT-VSCODE/security/advisories/new

We will respond within 72 hours.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅ Yes    |

## Security Considerations for AI Features

Construct IDE includes AI capabilities. Users should be aware:

- **Cloud AI providers**: AI features that connect to external APIs (Anthropic, OpenAI, etc.) will transmit code and context to those services. This only happens if you explicitly configure an API key and select a cloud provider. No cloud providers are configured by default.
- **Local AI**: Local ML models (via Transformers.js / Xenova) and Ollama run entirely on-device. No data leaves your machine when using local providers.
- **No telemetry**: No telemetry is collected by default. All Microsoft telemetry systems have been disabled in this fork.
- **API key security**: API keys are stored in your operating system's secure credential storage (OS keychain / Credential Manager / libsecret), never in plaintext files.
- **MCP servers**: MCP servers you configure may receive data from the agent. Review each server's privacy policy before connecting.

## Scope

The following components are in scope for our security policy:

- **CONSTRUCT IDE application** — the Electron-based desktop application
- **Agent loop** — the LLM orchestration layer that executes tasks
- **Terminal executor** — the shell command execution subsystem
- **File tools** — read_file, write_file, and all filesystem-accessing tools
- **IPC layer** — all communication between renderer and main process
- **Webview panels** — onboarding wizard, agent panel, memory view, browser preview
- **API key management** — storage, retrieval, and redaction of secrets
- **Prompt sanitisation** — injection defence for LLM context

### Out of Scope

- The underlying VS Code engine (reported to Microsoft separately)
- Third-party Ollama service (report to ollama/ollama)
- Third-party Qdrant service (report to qdrant/qdrant)
- Issues in dependencies not introduced by CONSTRUCT IDE changes

## Reporting Process

1. Email **security@construct-ide.dev** with a description of the vulnerability
2. Include steps to reproduce, affected versions, and potential impact
3. We will respond within **72 hours** with an initial assessment
4. We will work with you to coordinate disclosure once a fix is available

## Security Controls

| Control | Description |
|---------|-------------|
| SEC-1 | Electron sandbox lockdown — contextIsolation, CSP, sandbox mode |
| SEC-2 | IPC channel hardening — sender validation, schema validation, channel enum |
| SEC-3 | Terminal command injection prevention — blocklist, allowlist, rate limiting, audit log |
| SEC-4 | Path traversal prevention — assertWithinWorkspace for all file tools |
| SEC-5 | API key security — OS keychain storage, secret redaction, .gitignore |
| SEC-6 | Prompt injection defence — content delimiters, injection prefix filtering |
| SEC-7 | Auto-update URL neutralised, external network URLs audited |

## Responsible Disclosure

We ask that security researchers:

- Do not access or modify user data belonging to others
- Do not degrade service availability
- Provide reasonable time for remediation before public disclosure
- Report in good faith
