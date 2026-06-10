# Kovix IDE — Ground Truth: Desktop Session

**Date:** 2026-06-10
**Session Type:** Cloud container (NOT desktop — no display, 8GB RAM)
**Operator:** Super Z AI Assistant

## Environment

| Item | Value |
|------|-------|
| Node | v24.16.0 |
| npm | 11.13.0 |
| Python | 3.12.13 |
| Git | 2.47.3 |
| OS | Linux x86_64 (kernel 5.10.134) |
| RAM | 8.1 GB (below 16 GB requirement) |
| Cores | 4 |
| DISPLAY | (not set — headless container) |

## Repository State

| Item | Value |
|------|-------|
| Repo | https://github.com/Razisafir/CONSTRUCT-VSCODE.git |
| Branch | main |
| Latest commit | d007345b — security: final pre-launch hardening + Kovix product.json fix |
| Construct contrib TS files | 38 |
| Construct platform TS files | 58 |
| Total Kovix-specific TS files | 96 |

## 7 Original Bugs — Status

| # | Bug | Status | Notes |
|---|-----|--------|-------|
| 1 | Dual IToolDefinition (parameters vs inputSchema) | ✅ FIXED | Both interfaces use `inputSchema`; Ollama provider correctly maps to `parameters` key |
| 2 | CancellationToken as unknown as AbortSignal | ✅ FIXED | Real `AbortController` used, bridged via `token.onCancellationRequested()` |
| 3 | API Keys in plain in-memory Map | ✅ FIXED | `SecureKeyNodeService` uses `IEncryptionMainService` + AES-256-GCM fallback; MCP uses `ISecretStorageService` |
| 4 | Native modules not built | ⚠️ BUILD ENV | Must run `npm install` without `--ignore-scripts` on real machine |
| 5 | Terminal onOutput broken over IPC | ✅ FIXED | Browser-layer uses `instance.onData`; Node-layer has `onOutput` callback |
| 6 | currentCancellationToken null race condition | ✅ FIXED | Local variable capture pattern used |
| 7 | MCP __ separator parsing | ✅ FIXED | Uses `indexOf('__')` with first-occurrence split |

## New Issues Found and Fixed This Session

| # | Issue | Severity | Fix Applied |
|---|-------|----------|-------------|
| N1 | `workspaceGuard.ts` uses `import * as path from 'path'` (Node.js module) in `common` layer — crashes renderer | 🔴 BLOCKING | Changed to `import * as path from '../../../base/common/path.js'` (browser-safe) |
| N2 | Duplicate `assertWithinWorkspace` across 3 files with different implementations | 🟡 MEDIUM | Consolidated: `constructToolRegistry.ts` now re-exports from `workspaceGuard.ts`; `constructToolRegistryService.ts` imports from canonical location |
| N3 | Agent system prompt says "CONSTRUCT" instead of "Kovix" | 🟡 MEDIUM | Updated to "Kovix" |
| N4 | UI labels still say "Construct Agent" in view title and input placeholder | 🟡 MEDIUM | Updated to "Kovix Agent" and "Ask Kovix anything..." |
| N5 | Status bar labels say "Construct Model/Changes" | 🟡 MEDIUM | Updated to "Kovix Model/Changes" |

## What Cannot Be Verified in This Session

- Electron window launch (no display)
- LLM response streaming (no Ollama/Anthropic access)
- Native module compilation (insufficient RAM, no build tools)
- Smoke tests 1-5 (require running app + LLM provider)
