# Building Construct IDE Locally

## Prerequisites
- Node.js 20.x (use nvm: `nvm use`)
- Git
- Python 3.x (for native module compilation)
- C++ build tools:
  - **Windows**: Visual Studio Build Tools 2022 with "Desktop development with C++"
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `sudo apt-get install build-essential`

## Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/Razisafir/CONSTRUCT-VSCODE.git
   cd CONSTRUCT-VSCODE
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the source:
   ```bash
   npm run compile
   ```

   For systems with limited memory (8GB RAM), use:
   ```bash
   NODE_OPTIONS="--max-old-space-size=8192" npm run compile
   ```

4. Run in development mode:
   ```bash
   # macOS/Linux:
   ./scripts/code.sh

   # Windows:
   .\scripts\code.bat
   ```

## Building Release Packages

```bash
# Windows installer:
node ./node_modules/gulp/bin/gulp.js vscode-win32-x64-inno-updater

# macOS .dmg:
node ./node_modules/gulp/bin/gulp.js vscode-darwin-x64

# Linux .tar.gz:
node ./node_modules/gulp/bin/gulp.js vscode-linux-x64
```

## System Requirements

- **Compile-time**: 16+ GB RAM recommended (8 GB may cause OOM on full builds)
- **Disk space**: ~10 GB for full build output
- **Node.js**: Version 20.x required
