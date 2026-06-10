# Kovix — Packaging Guide

## Project Structure

CONSTRUCT is a **fork of VS Code** (not a standalone extension), so packaging differs from typical VS Code extension workflows. The full Electron application must be built using the VS Code gulp pipeline.

---

## Task 9.1 — VSIX Packaging: N/A

**Result: Not applicable.**

No `extensions/construct-*/package.json` extension entry point exists. CONSTRUCT modifies the VS Code core directly (workbench, sidebar, agent loop, etc.) rather than shipping as an installable `.vsix` extension. VSIX packaging is not a valid distribution mechanism for this project.

If CONSTRUCT features were ever extracted into a standalone extension, a `package.json` with `engines.vscode` and `vsce` (VS Code Extension Manager) would be needed. That is not the current architecture.

---

## Task 9.2 — Electron Packager / Gulp Build

### Attempted: `vscode-linux-x64` gulp task

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run gulp -- vscode-linux-x64
```

### Result: OOM Kill

The build process was **killed by the OOM killer** during the `compile-src` phase:

```
[11:27:49] Starting compilation...
Killed
```

This occurred approximately 13 seconds into compilation after the TypeScript angler collected 8,310 classes and 10,128 exported symbols. The system has **8 GB RAM with no swap**, which is insufficient for a full VS Code compilation.

### Available Gulp Packaging Tasks

The following packaging tasks are available in the gulp pipeline:

| Task | Description |
|------|-------------|
| `vscode-linux-x64` | Full Linux x64 build (compile + package) |
| `vscode-linux-x64-min` | Minified Linux x64 build |
| `vscode-linux-x64-ci` | CI-optimized Linux x64 build |
| `vscode-linux-x64-prepare-deb` | Prepare Debian package structure |
| `vscode-linux-x64-build-deb` | Build .deb package |
| `vscode-linux-x64-prepare-rpm` | Prepare RPM package structure |
| `vscode-linux-x64-build-rpm` | Build .rpm package |
| `vscode-linux-x64-prepare-snap` | Prepare Snap package |
| `vscode-linux-x64-build-snap` | Build Snap package |
| `vscode-linux-arm64` | Full Linux ARM64 build |
| `vscode-linux-armhf` | Full Linux ARM HF build |

### Available npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run compile` | Compile TypeScript sources only (no packaging) |
| `npm run watch` | Watch mode for development |
| `npm run watch-client` | Watch client sources |
| `npm run watch-extensions` | Watch extension sources |

---

## System Requirements for Successful Packaging

Based on the failed build attempt and VS Code's official build requirements:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 12 GB | 16+ GB |
| Swap | 8 GB | 16 GB |
| Disk Space | 30 GB free | 50 GB free |
| CPU Cores | 4 | 8+ |
| Node.js | 20.x | 20.x LTS |
| Build Time | ~30 min (16GB) | ~15 min (32GB) |

---

## Instructions for Packaging on a Proper Build Machine

### 1. Prerequisites

```bash
# Node.js 20.x (via nvm)
source ~/.nvm/nvm.sh && nvm use 20

# Ensure dependencies are installed
cd /home/z/my-project/KOVIX
npm install
```

### 2. Full Linux x64 Build (Development)

```bash
# With sufficient RAM (16GB+)
NODE_OPTIONS="--max-old-space-size=8192" npm run gulp -- vscode-linux-x64
```

### 3. Minified Production Build

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run gulp -- vscode-linux-x64-min
```

### 4. Debian Package (.deb)

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run gulp -- vscode-linux-x64-build-deb
```

### 5. RPM Package (.rpm)

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run gulp -- vscode-linux-x64-build-rpm
```

### 6. Build Output

Compiled output goes to:
- `.build/electron/` — Electron binary
- `out/` — Compiled JS sources
- `.build/linux/` — Packaged application (deb/rpm/snap)

### 7. Development-Only Compilation (no packaging)

If you just need to verify TypeScript compiles without packaging:

```bash
npm run compile
```

This is less memory-intensive than the full packaging pipeline and may succeed on 8GB systems.

---

## Alternative: Docker-Based Build

For reproducible builds on any machine:

```dockerfile
FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    libx11-dev libxkbfile-dev libsecret-1-dev \
    libgtk-3-dev libgbm-dev libnss3-dev \
    fakeroot dpkg-dev rpm

WORKDIR /build
COPY . .
RUN npm install
RUN NODE_OPTIONS="--max-old-space-size=8192" npm run gulp -- vscode-linux-x64-build-deb
```

---

## Summary

| Approach | Status | Notes |
|----------|--------|-------|
| VSIX packaging | N/A | CONSTRUCT is a VS Code fork, not an extension |
| Gulp `vscode-linux-x64` | Failed (OOM) | 8GB RAM insufficient, killed during compile-src |
| Gulp `compile` only | Not attempted | Less memory-intensive, may work on 8GB |
| DEB/RPM/Snap packaging | Blocked | Requires successful compilation first |
| Docker build | Recommended | Use on a machine with 16GB+ RAM |

**Next step**: Run the full build pipeline on a machine with 16+ GB RAM to produce distributable packages (deb/rpm/tar.gz).
