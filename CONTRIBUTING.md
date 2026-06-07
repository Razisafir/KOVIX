# Contributing to CONSTRUCT IDE

Thank you for your interest in contributing! This guide covers the essentials for getting started.

## Development Setup

```bash
git clone https://github.com/Razisafir/CONSTRUCT-VSCODE
cd CONSTRUCT-VSCODE
npm install
NODE_OPTIONS="--max-old-space-size=8192" npm run compile
./scripts/code.sh        # Linux/macOS
.\scripts\code.bat       # Windows
```

## Branch Naming

All branches must follow these conventions:

| Prefix | Use | Example |
|---|---|---|
| `feature/` | New features and enhancements | `feature/agent-memory` |
| `fix/` | Bug fixes | `fix/ipc-schema-validation` |
| `security/` | Security-related changes | `security/path-traversal-hardening` |

## Code Standards

- **TypeScript strict mode is required** — No implicit `any`, full strict mode enabled
- **JSDoc comments on all new services** — Every public method and class must have JSDoc documentation
- **All new tools must implement `IConstructTool`** — See the MCP tool registry for the interface definition

## Pull Requests

- All PRs target the **`main-dev`** branch (not `main`)
- Include a clear description of what changed and why
- Ensure `npm run compile` passes before submitting
- Keep PRs focused — one concern per PR

## Reporting Bugs

Open a GitHub issue with:

- CONSTRUCT IDE version
- Operating system
- Steps to reproduce
- Expected vs. actual behavior
- Relevant log output (secrets will be redacted automatically)

## Security Vulnerabilities

**Do NOT open a public issue for security vulnerabilities.**

Instead, email **security@construct-ide.dev** with:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

See [SECURITY.md](./SECURITY.md) for the full security policy and response timeline.

## Thank You

Your contributions — whether code, bug reports, or feature suggestions — make CONSTRUCT IDE better. Thank you for taking the time to contribute.
