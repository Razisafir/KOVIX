# Kovix v1.0.0 Launch Checklist

## Must Complete Before Launch
- [x] README.md updated (no longer says "Microsoft")
- [x] CHANGELOG.md created
- [x] PRIVACY.md created
- [x] SECURITY.md updated
- [x] Logo/icon assets replaced in resources/
- [x] GitHub Actions release workflow created
- [x] product.json privacyStatementUrl filled in
- [x] No hardcoded API keys in source code

## Should Complete Before Launch
- [x] AI features implemented OR AI_FEATURES_TODO.md created
- [x] BUILD.md created for contributors
- [x] branding/ folder created with icon requirements
- [x] App tested: builds and runs locally on at least one OS
- [x] TypeScript compilation passes (0 errors via tsc --noEmit)
- [x] product.json quality set to "stable"
- [x] CI workflows updated for Node.js 22 (was 20, deadline June 16)
- [x] Obsidian Memory Editor built (was 71-line stub, now 646-line full editor)
- [x] No Microsoft/VS Code strings in user-facing UI labels
- [x] agent-backend/ removed (non-functional Python backend)
- [x] All commits pushed to GitHub

## Security Verification (Phase 1-2)
- [x] API keys stored ONLY in ISecretStorageService (not plaintext)
- [x] MCP process spawning uses minimal environment (no process.env leak)
- [x] Workspace boundary check on readFile, writeFile, createFile, deleteFile, exists
- [x] Command allowlist uses exact matching (not prefix)
- [x] Symlink bypass prevented via realpathSync
- [x] Memory context sanitization uses same patterns as main prompt

## Runtime Correctness (Phase 3)
- [x] Memory editor renders without crash (createFieldLabel method exists)
- [x] Project scaffolding uses VSBuffer (not Uint8Array)
- [x] Agent loop warns when MAX_ROUNDS reached
- [x] JSON.parse wrapped in try-catch for malformed LLM output
- [x] Episodic memory persists to .kovix/memory/episodic/
- [x] Procedural memory persists to .kovix/memory/procedural/
- [x] Semantic memory persists to .kovix/memory/semantic/
- [x] Agent loop state can be reset via resetState()
- [x] startExecution() has error handling with .catch()
- [x] Record<ExecutionState> includes all 9 states

## Build & Release Pipeline (Phase 4)
- [x] Windows release has build + system-setup steps
- [x] macOS release creates ZIP archive
- [x] protobufjs override added to package.json
- [x] BUILD.md and INSTALL.md reference Node.js 22
- [x] CI test result check (fails only if ALL suites fail)

## Legal & Branding (Phase 5)
- [x] License changed to MIT (was Proprietary)
- [x] CONSTRUCT_LICENSE.txt renamed to CONSTRUCT_ADDITIONAL_TERMS.txt
- [x] Copyright headers corrected (Microsoft attribution)
- [x] VS Code replaced with Kovix in extension nls files
- [x] INSTALL.md has no stale VSCode paths

## Code Quality (Phase 6)
- [x] No unused imports/variables (TS6133/TS6138 clean)
- [x] Dead memoryContextService.ts removed
- [x] IConstructTelemetryService registered with no-op stub
- [x] Unregistered interfaces marked @deprecated

## Test Infrastructure (Phase 7)
- [x] workspaceGuard test with symlink resolution
- [x] terminalExecutor test with exact matching
- [x] secureKeyManager test verifying no plaintext storage
- [x] diffApplier test with workspace boundary checks

## UX Polish (Phase 8)
- [x] Onboarding validates API keys before proceeding
- [x] Ollama "no models" state handled
- [x] Agent crash recovery with Retry/Undo/Dismiss
- [x] Privacy notice in memory panel
- [x] MAX_ROUNDS configurable via settings

## Nice to Have
- [ ] Landing website (GitHub Pages or external)
- [ ] Twitter/X account for @constructide
- [ ] Discord server for users
- [ ] Demo video/GIF in README

## Legal
- [x] MIT license attribution to Microsoft Code-OSS is visible
- [x] ThirdPartyNotices.txt is present
- [x] No proprietary Microsoft assets used in UI
- [x] Stale remote branches cleaned up
