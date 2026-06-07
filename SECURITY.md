# CONSTRUCT IDE Security Policy

## Contact

For security vulnerabilities, please contact: **security@construct-ide.dev**

**Do NOT use the public issue tracker for security vulnerabilities.**

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

## Reporting a Vulnerability

1. Email **security@construct-ide.dev** with a description of the vulnerability
2. Include steps to reproduce, affected versions, and potential impact
3. We will respond within **7 days** with an initial assessment
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
