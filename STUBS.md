# Kovix — Stub Audit Report
Generated: 2026-06-09

## Confirmed Stubs

### 1. FileWatcherNodeService.startWatching() — MEDIUM
- **File**: `src/vs/platform/construct/node/constructFileWatcherService.ts`
- **Current**: Sets `_isWatching = true` but never calls `fs.watch`
- **Should**: Implement actual `fs.watch` with debouncing

### 2. MCPMarketplaceService.getServerReviews() — LOW
- **File**: `src/vs/workbench/contrib/construct/browser/services/mcp/mcpMarketplaceService.ts`
- **Current**: Returns empty array `[]`
- **Should**: Integrate with backend review service

### 3. MemoryOrchestratorService.getMemoryStats() — LOW
- **File**: `src/vs/workbench/contrib/construct/browser/services/memory/memoryOrchestratorService.ts`
- **Current**: Returns hardcoded zeros
- **Should**: Track and return actual stats

## Unimplemented Interfaces
4. `IConstructPluginService` — P3 future interface
5. `IConstructTelemetryService` — No implementation
6. `IConstructSessionService` — P1: conversations lost on panel close

## Deprecated
7. `IConstructKeyVault` — Deprecated, all key management via ISecureKeyManager

## Known Mismatch
8. `SecureKeyNodeService` — Stores keys in-memory Map, not OS keychain

## No stubs found using:
- `throw new Error('not implemented')`
- `// TODO` / `// FIXME` comments
- Empty function bodies beyond those listed above
