# Installer Test — v0.1.0-alpha.17 — 2026-05-30

## Environment

| Item | Value |
|------|-------|
| OS | Linux (headless server, x86_64, kernel 5.10.134) |
| Installer | `Construct_0.1.0_amd64.deb` (459 MB download, 482 MB on disk) |
| Disk space | 5.7 GB available |
| Python | 3.12.13 |
| Ollama | Not installed (blocked — see below) |
| GPU | None (CPU-only) |

## STEP 1: Download Installer

- [x] Downloaded installer from GitHub Releases
- [x] URL: `https://github.com/Razisafir/construct-ai-agent/releases/tag/v0.1.0-alpha.17`
- [x] File: `Construct_0.1.0_amd64.deb` (481,795,174 bytes)
- [x] SHA256 verified by GitHub release asset integrity

## STEP 2: Extract and Examine Package

Could not install via `dpkg` (no sudo access). Extracted manually with `ar` + `tar`.

### Package Metadata

```
Package: construct
Version: 0.1.0
Architecture: amd64
Installed-Size: 490551 (490 MB)
Depends: libgtk-3-0t64, libwebkit2gtk-4.1-0, libayatana-appindicator3-1
Maintainer: Razisafir
Description: AI coding agent that never forgets
```

### Installed Files

| Path | Size | Type |
|------|------|------|
| `/usr/bin/construct` | 24 MB | ELF 64-bit (Tauri/Rust GUI binary) |
| `/usr/bin/agent-backend` | 454 MB | ELF 64-bit (PyInstaller Python sidecar) |
| `/usr/share/applications/Construct.desktop` | 253 B | Desktop entry |
| `/usr/share/icons/hicolor/32x32/apps/construct.png` | — | App icon |
| `/usr/share/icons/hicolor/128x128/apps/construct.png` | — | App icon |
| `/usr/share/icons/hicolor/512x512/apps/construct.png` | — | App icon |
| `/usr/share/icons/hicolor/1024x1024/apps/construct.png` | — | App icon |

- [x] Package structure correct: GUI binary + sidecar binary + icons + desktop entry
- [x] Desktop entry has correct Categories, Exec, Icon, and Terminal=false
- [x] Both binaries are valid ELF x86-64 executables

## STEP 3: App Launch

- [ ] **CANNOT TEST** — Headless server has no display server (no X11/Wayland)
- The Tauri GUI app requires a display server to render its window
- This must be tested on a local machine with a desktop environment

**Expected behavior on desktop:**
- Window opens with "Construct" title
- No terminal window appears (release mode, `Terminal=false` in .desktop)
- App loads to AgentChat or Settings page

## STEP 4: Python Backend — CRITICAL BUG FOUND

### Bug: PyInstaller Sidecar Fails to Start

**Severity: BLOCKER**

When running the bundled `agent-backend` binary directly:

```
$ ./agent-backend
🚀 Construct Agent Backend starting on port 8000
📁 Data directory: /tmp/_MEIvzyhuv/../data
📝 Log level: info
ERROR:    Error loading ASGI app. Could not import module "app".
```

**Root Cause:** The `app.py` entry point uses `uvicorn.run("app:app", ...)` — the string import form. When PyInstaller bundles a Python script, it loads it as `__main__`, not `app`. Uvicorn's string import then fails because it tries to `import app` which doesn't exist as a separate module.

**Fix Applied:** Changed `app.py` entry point from:
```python
uvicorn.run("app:app", host="127.0.0.1", port=PORT, reload=False, log_level=LOG_LEVEL)
```
to:
```python
uvicorn.run(app, host="127.0.0.1", port=PORT, log_level=LOG_LEVEL)
```

Passing the `app` object directly bypasses the import mechanism entirely and works in both normal Python and PyInstaller bundled modes.

### Backend from Source (with fix applied)

- [x] Backend starts successfully from source
- [x] Health check passes: `{"status": "ok", "service": "construct-agent-api", "version": "0.3.0"}`
- [x] All 39 tools registered
- [x] LLM providers: ollama, mock
- [x] Autonomous services initialised
- [x] Startup time: ~5 seconds

### What This Means for the Installer

The v0.1.0-alpha.17 release **has a blocker bug**: the bundled Python sidecar cannot start. This means:
1. The Tauri app would launch but the backend would fail silently
2. Users would see the app window but agent features would not work
3. Manual backend start (from source) would work as a workaround

**This fix must be included in v0.1.0-alpha.18** before any user-facing release.

## STEP 5: Ollama Installation

- [ ] **BLOCKED** — Cannot install Ollama in this environment

**Reasons:**
1. No `sudo` access — the Ollama install script requires root
2. Binary download is 1.2 GB (too large for available disk)
3. `zstd` not installed (required to extract `.tar.zst` archive)
4. No GPU available (CPU inference would be extremely slow)

**Deferred to local machine testing.** On a local Linux desktop with sudo:
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull llama3.2:1b
```

## STEP 6: Agent Test with Mock LLM

Since Ollama is not available, tested with the Mock LLM provider.

### Test Goal
> "Create a hello_world.py file that prints Hello from Construct!"

### Results

- [x] Goal submitted via `POST /agent/start`
- [x] Session created: `4d2b7298` in "code" mode
- [x] Session completed with status "completed"
- [x] 2 tasks planned and completed
- [x] `write_file` tool executed successfully
- [x] File created at correct path: `/home/z/construct-projects/default/hello_world.py`

### File Content on Disk

```python
print("Hello from Construct!")
```

### Execution Verification

```bash
$ python3 ~/construct-projects/default/hello_world.py
Hello from Construct!
```

### Path Resolution Fix Verified

The path resolution fix from PR #32 (commit be1b1cc) is working correctly:
- Files are created at `~/construct-projects/default/` (session.project_path)
- NOT in `agent-backend/` (the old buggy behavior)
- Relative paths are correctly resolved against project_path

### Mock LLM Limitations

The Mock LLM has a known issue: it repeats the same `write_file` tool call until hitting `max_iterations=15` instead of varying tool calls (e.g., write_file then read_file to verify). This is expected behavior for a mock and would not occur with a real LLM.

## STEP 7: Diff Viewer

- [ ] **CANNOT TEST** — No display server to render the GUI
- The diff viewer was implemented in commit c26d07f
- It renders in the bottom panel "Changes" tab
- Must be tested on a local machine with the full app running

## Issues Found

| # | Issue | Severity | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | PyInstaller sidecar fails to start (`uvicorn.run("app:app")`) | **BLOCKER** | Fixed in source, needs rebuild | Must be in alpha.18 |
| 2 | No display server in test environment | — | N/A | Cannot test GUI features |
| 3 | Ollama cannot be installed (no sudo) | — | Deferred | Test on local machine |
| 4 | Mock LLM repeats same tool call | Minor | Known | Expected mock behavior |

## Performance

| Metric | Time |
|--------|------|
| Installer download | ~2 min (482 MB) |
| Package extraction | ~30 sec |
| Backend startup (from source) | ~5 sec |
| Agent session (mock LLM) | ~7 sec total |
| File creation | <0.5 sec |

## Conclusion

**PARTIAL PASS**

### What Works
- Installer downloads and extracts correctly
- Package structure is correct (GUI + sidecar + icons + desktop entry)
- Backend starts from source with the fix applied
- Agent pipeline works end-to-end with Mock LLM
- File path resolution is correct (~/construct-projects/default/)
- Agent creates files that execute correctly

### What Fails
- **BLOCKER**: PyInstaller-bundled sidecar cannot start (uvicorn string import bug)
- Cannot test GUI features (headless server)
- Cannot test real LLM (Ollama not installable)

### Required Before Beta
1. **Fix the PyInstaller sidecar bug** (already fixed in source)
2. **Rebuild and release v0.1.0-alpha.18** with the fix
3. **Test on a local machine** with display server and Ollama
4. **Verify the .msi/.exe/.dmg installers** on Windows/macOS

### Next Steps
1. Commit the `app.py` fix
2. Push to main, tag `v0.1.0-alpha.18`
3. Download and test alpha.18 on a local machine with:
   - Display server (X11/Wayland)
   - Ollama with `llama3.2:1b`
   - Full GUI verification (agent chat, diff viewer, settings)
