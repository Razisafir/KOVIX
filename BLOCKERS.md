# Kovix — Blockers
Generated: 2026-06-09 (updated during Grand Boot session)

## E2E Testing Blocked (OOM Killer)
- **Issue**: Xvfb is killed by the Linux OOM killer when the Electron process starts
- **Impact**: Cannot complete a full Electron UI boot test in the current 7.9GB RAM container
- **Evidence**: dmesg shows OOM kills for gulp processes; Xvfb dies immediately when Electron starts
- **Workaround**: 
  1. Run `npm run compile` on a machine with 16+ GB RAM
  2. Then `./scripts/code.sh` on a desktop machine (Linux/macOS/Windows)
  3. The `--ozone-platform=headless` flag allows boot without X11 but is limited
- **Resolution**: Use a machine with 16+ GB RAM for full packaging and E2E testing

## Headless Boot Progress
The app **does reach** the CodeApplication.startup() phase using `--ozone-platform=headless`:
- ✅ Electron binary launches
- ✅ Main process starts
- ✅ CONSTRUCT services (VectorStore, ChatHistory) instantiate
- ✅ IPC channels begin registering
- ⚠️ @vscode/spdlog native module not built (non-critical, logging falls back)
- ⚠️ ConstructConfigService DI error (FIXED in source, needs recompile)
- The app crashes after the DI error — with the fix, it should progress further

## Full Gulp Compile OOM
- **Issue**: `npm run compile` (gulp) OOMs during the `compile-src` step on 8GB RAM
- **Impact**: Cannot produce the full optimized output needed for packaging
- **Workaround**: Compile succeeds on machines with 12-16+ GB RAM
- **Resolution**: Use a build machine with more RAM, or use Docker with increased memory

## Native Module Builds
- **Issue**: `native-keymap` requires `libxkbfile-dev` system package
- **Impact**: Keyboard mapping may not work correctly in packaged app
- **Workaround**: Install system deps before building: `sudo apt-get install libxkbfile-dev`
- **Resolution**: Add to build CI pipeline
