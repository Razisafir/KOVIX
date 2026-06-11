# Security Policy

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability in Kovix, please report it responsibly.

### How to Report

- **GitHub Security Advisories**: Use [GitHub's private vulnerability reporting](https://github.com/Razisafir/KOVIX/security/advisories/new)
- **Email**: Send details to security@kovix.dev (if configured)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 5 business days
- **Fix Development**: Depends on severity (Critical: 7 days, High: 14 days, Medium: 30 days)
- **Disclosure**: After fix is released, or 90 days from report (whichever comes first)

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

For technical details on the security architecture, see [SECURITY_AUDIT.md](./SECURITY_AUDIT.md).

Kovix implements the following security controls (SEC-1 through SEC-7):
- SEC-1: API key encryption at rest (AES-256-GCM or Electron safeStorage)
- SEC-2: Workspace guard prevents file operations outside workspace
- SEC-3: Command allowlist for shell execution
- SEC-4: Diff-based file application with user approval
- SEC-5: Snapshot-based undo for all agent changes
- SEC-6: Prompt injection mitigation (delimiter + sanitization)
- SEC-7: Secret redaction in tool outputs

See SECURITY_AUDIT.md for the full audit report.

## Known Security Considerations

- **No code signing**: Windows and macOS builds are not code-signed. Users will see SmartScreen/Gatekeeper warnings. See INSTALL.md for bypass instructions.
- **Local LLM communication**: Ollama communication uses unencrypted HTTP on localhost (by design, local-only).
- **Cloud API keys**: Stored encrypted locally but transmitted to cloud providers over HTTPS.
