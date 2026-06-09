# Construct IDE Privacy Policy

**Last updated: June 2026**

## Data Collection

Construct IDE does **not collect any data by default**. No telemetry, no usage analytics, no crash reports, and no personal information is transmitted to any server unless you explicitly opt in.

### Telemetry

All Microsoft telemetry systems (1DS, Application Insights) have been disabled in this fork. The telemetry setting is off by default and there is no prompt to enable it. If you choose to enable telemetry through settings, only minimal anonymous usage data would be sent — but this is not the default configuration.

## AI Features

Construct IDE includes AI capabilities that may transmit data under certain conditions:

### Local AI (Ollama, LM Studio, Xenova Transformers.js)

When using local AI providers, **no data leaves your machine**. All inference runs locally on your hardware. Your code, conversations, and prompts stay entirely on your device.

### Cloud AI (Anthropic, OpenAI, or other API providers)

When you configure a cloud AI provider (e.g., Anthropic Claude, OpenAI GPT), the following data is sent to that provider's API:

- The content of your chat messages to the agent
- Any file content the agent reads as context
- Terminal command output that the agent processes
- Workspace context injected into conversations (via semantic memory)

**This data transmission is controlled entirely by you.** Cloud AI features are only active if you explicitly configure an API key and select a cloud provider. No API keys are pre-configured, and the default provider is Ollama (local).

### API Key Storage

API keys are stored in your operating system's secure credential storage (OS keychain on macOS, Credential Manager on Windows, libsecret on Linux). Keys are never stored in plaintext configuration files or transmitted to any Construct IDE server.

## MCP Servers

If you configure MCP (Model Context Protocol) servers, those servers may receive data from the agent depending on the tools they provide. This is controlled by your MCP server configuration and is outside Construct IDE's data handling. Review the privacy policy of each MCP server you connect.

## Extensions

Extensions installed from the Open VSX Registry or other sources have their own data handling policies. Construct IDE does not mediate data collection by installed extensions. Review each extension's privacy practices before installation.

## Contact

For privacy questions or concerns, please open an issue on GitHub: https://github.com/Razisafir/CONSTRUCT-VSCODE/issues
