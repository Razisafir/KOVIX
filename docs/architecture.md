# CONSTRUCT IDE — Architecture

## Overview

CONSTRUCT-IDE is a fork of VS Code 1.96.0 that replaces all fake/stubbed AI implementations with real, working services. A user can type "Create a React counter app" and the agent makes real LLM calls, writes real files, runs real terminal commands, and the files appear in VS Code.

## Service Architecture

All core services follow the **Dependency Injection** pattern via a singleton `ServiceLocator`:

```
ServiceLocator (singleton)
├── LLMBridgeKey      → LLMBridge
├── MCPClientKey      → MCPClient
├── TerminalExecutorKey → TerminalExecutor
├── ContextBudgetKey  → ContextBudget
├── DiffServiceKey    → DiffService
├── GitServiceKey     → GitService
├── RefactoringServiceKey → RefactoringService
└── AgentEngineKey    → AgentEngine
```

### Service Details

| Service | Responsibility | Key Features |
|---------|---------------|--------------|
| **LLMBridge** | Anthropic Claude API wrapper | SSE streaming, exponential backoff (429), AbortSignal, token estimation |
| **MCPClient** | MCP filesystem JSON-RPC client | Spawns `@modelcontextprotocol/server-filesystem`, path validation, auto-restart |
| **TerminalExecutor** | Safe command runner | 14-pattern blocklist, 60s timeout, AbortSignal |
| **ContextBudget** | Token window manager | 60K hard limit, 20-entry max, auto-truncation preserving system messages |
| **DiffService** | Diff-based file editing | `applyPatch()`, `applyEdit()` with fuzzy matching, `createPatch()`, change summaries |
| **GitService** | Git CLI integration | Status, add, commit, undo, revert, auto-commit with conventional messages |
| **RefactoringService** | Cross-file symbol rename | Regex-based search, import path updates for TypeScript |
| **AgentEngine** | Plan→Execute orchestration | ReAct-style tool parsing, max 15 rounds, 8 tool dispatchers |

## Agent Flow: Plan/Act

```
User Input → AgentEngine.plan()
                    ↓
            LLM generates numbered steps
                    ↓
            parsePlan() → PlanStep[]
                    ↓
            Webview shows PlanModal (checkboxes, edit, delete)
                    ↓
            User clicks "Approve & Execute"
                    ↓
            AgentEngine.execute()
                    ↓
            ┌─ Loop (max 15 rounds) ─┐
            │  LLM generates output   │
            │  parseToolUse()          │
            │  dispatchTool()          │
            │  Feed result back        │
            └─────────────────────────┘
                    ↓
            Final summary
```

## Tool Dispatch

The `AgentEngine` dispatches 8 tool types:

| Tool | Handler | Description |
|------|---------|-------------|
| `read` | MCPClient.readFile | Read file content via MCP |
| `write` | MCPClient.writeFile | Write file content via MCP |
| `edit` | DiffService.applyEdit + MCPClient | Search/replace with fuzzy matching |
| `bash` | TerminalExecutor.run | Execute shell commands (with blocklist) |
| `mcp` | MCPClient (direct) | Direct MCP JSON-RPC call |
| `diff_edit` | DiffService.applyPatch + MCPClient | Apply unified diff patch |
| `git_commit` | GitService.autoCommit | Stage all + commit with message |
| `refactor_rename` | RefactoringService.renameSymbol | Rename symbol across files |

## Security

- **Path validation**: MCPClient rejects any path outside `workspaceRoot`
- **Terminal blocklist**: 14 regex patterns block dangerous commands (rm -rf /, mkfs, fork bomb, curl|bash, etc.)
- **API key storage**: Via `vscode.SecretStorage` (key: `anthropicApiKey`)
- **AbortSignal**: Supported on LLM streaming, terminal execution, and the entire agent loop

## Token Budget

- **Hard limit**: 60,000 tokens
- **Estimation heuristic**: `tokens ≈ Math.ceil(text.length / 4)`
- **Auto-truncation**: Removes oldest non-system entries when budget exceeded
- **Max turns**: 20 entries in WorkingMemory

## Testing

- **Framework**: Jest + ts-jest
- **Config**: `jest.construct.cjs` with two projects (services + webview)
- **Current**: 75 tests across 10 suites
- **Coverage target**: ≥80% branches/functions/lines/statements

## File Structure

```
src/construct/
├── agent/
│   ├── types.ts          # PlanStep, ToolRequest, ToolResult, ALLOWED_TOOLS
│   └── symbols.ts        # DI symbol keys
└── services/
    ├── ServiceLocator.ts  # DI container singleton
    ├── LLMBridge.ts       # Anthropic SSE streaming client
    ├── MCPClient.ts       # MCP filesystem JSON-RPC client
    ├── TerminalExecutor.ts # Safe command runner
    ├── ContextBudget.ts   # Token window manager
    ├── AgentEngine.ts     # Plan→Execute orchestration
    ├── AgentError.ts      # Custom error (TOOL_FAILURE | LLM_TIMEOUT | MAX_ROUNDS)
    ├── DiffService.ts     # Diff-based file editing
    ├── GitService.ts      # Git CLI integration
    ├── RefactoringService.ts # Cross-file refactoring
    ├── Disposable.ts      # VS Code-style disposable helper
    ├── registerServices.ts # Bootstrap function
    └── index.ts           # Barrel exports

extensions/construct-webview/
└── src/
    ├── index.tsx           # Webview entry (state machine: idle→planning→review→executing→done)
    └── components/
        └── PlanModal.tsx   # Plan review UI (checkboxes, edit, delete, approve/cancel)

test/construct/
└── services/
    ├── ServiceLocator.test.ts
    ├── LLMBridge.test.ts
    ├── MCPClient.test.ts
    ├── TerminalExecutor.test.ts
    ├── ContextBudget.test.ts
    ├── AgentEngine.test.ts
    ├── AgentError.test.ts
    ├── DiffService.test.ts
    ├── GitService.test.ts
    └── RefactoringService.test.ts
```
