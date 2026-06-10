# Kovix — Installation Guide

## System Requirements

- **RAM**: 8GB minimum (16GB recommended for large workspaces + local LLM)
- **Storage**: 5GB for Kovix, additional 5–10GB for Ollama models
- **CPU**: 4+ cores recommended for local LLM inference
- **GPU**: Optional — NVIDIA GPU with CUDA for faster Ollama inference
- **Node.js**: 20+ (required for building from source)
- **npm**: 10+ (required for building from source)
- **Git**: Required for cloning the repository

---

## Platform-Specific Instructions

### Linux (x64)

#### Pre-built Binary (Recommended)

1. Download `kovix-linux-x64.tar.gz` from the [GitHub Releases](https://github.com/Razisafir/KOVIX/releases) page
2. Extract the archive:
   ```bash
   tar -xzf kovix-linux-x64.tar.gz
   ```
3. Run the application:
   ```bash
   ./VSCode-linux-x64/construct
   ```
4. *(Optional)* Create a desktop entry for easy launching:

   Create a file at `~/.local/share/applications/kovix.desktop` with the following content:

   ```ini
   [Desktop Entry]
   Name=Kovix
   Comment=Offline-first AI coding environment
   Exec=/path/to/VSCode-linux-x64/construct
   Icon=/path/to/VSCode-linux-x64/resources/app/resources/linux/construct.png
   Type=Application
   Categories=Development;IDE;
   StartupNotify=true
   ```

   Then update the desktop database:
   ```bash
   update-desktop-database ~/.local/share/applications/
   ```

5. *(Optional)* Add to PATH for terminal access:
   ```bash
   sudo ln -s /path/to/VSCode-linux-x64/construct /usr/local/bin/construct
   ```

#### Build from Source

Building from source gives you the latest development version and allows customization. The build process compiles the entire VS Code fork including all CONSTRUCT extensions.

```bash
# Install system dependencies (Debian/Ubuntu)
sudo apt-get update
sudo apt-get install -y libxkbfile-dev libsecret-1-0 libgtk-3-0 libgbm1 libnss3

# For Fedora/RHEL:
# sudo dnf install -y libxkbfile-devel libsecret-devel gtk3 mesa-libgbm nss

# Clone the repository
git clone https://github.com/Razisafir/KOVIX
cd KOVIX

# Install Node.js dependencies
npm install

# Compile (requires significant memory — 8GB+ heap)
NODE_OPTIONS="--max-old-space-size=8192" npm run compile

# Launch the development build
./scripts/code.sh
```

**Build Tips for Linux:**
- If `npm install` fails on native modules, ensure `build-essential` and `python3` are installed.
- The compile step can take 10–20 minutes depending on your hardware.
- If you encounter OOM (Out of Memory) errors, close other applications and increase the heap size: `NODE_OPTIONS="--max-old-space-size=12288"`
- For development, use `./scripts/code.sh` which sets up the correct Electron environment.

---

### macOS (Intel & Apple Silicon)

#### Pre-built Binary

1. Download the appropriate archive from [GitHub Releases](https://github.com/Razisafir/KOVIX/releases):
   - **Intel Macs**: `kovix-darwin-x64.zip`
   - **Apple Silicon (M1/M2/M3/M4)**: `kovix-darwin-arm64.zip`
2. Open the DMG and drag **Kovix** to your **Applications** folder
3. On first launch, macOS Gatekeeper may block the app because it is not signed with an Apple Developer certificate. To bypass:
   - **Right-click** (or Control-click) the app → select **Open**
   - Click **Open** again in the confirmation dialog
   - Alternatively, go to **System Settings → Privacy & Security** and click **Open Anyway** next to the security warning
4. *(Optional)* Install the `construct` command-line tool:
   - Open Kovix
   - Press `Cmd+Shift+P` to open the Command Palette
   - Search for **"Shell Command: Install 'construct' command in PATH"**
   - Click it to create the symlink

**Apple Silicon Notes:**
- Kovix runs natively on Apple Silicon — no Rosetta translation needed.
- Ollama also runs natively on Apple Silicon and leverages the Neural Engine / GPU for fast inference.
- If you previously used an Intel build, clear the cache: `rm -rf ~/Library/Application\ Support/Construct`

#### Build from Source

```bash
# Install Xcode command-line tools (if not already installed)
xcode-select --install

# Clone the repository
git clone https://github.com/Razisafir/KOVIX
cd KOVIX

# Install dependencies
npm install

# Compile
NODE_OPTIONS="--max-old-space-size=8192" npm run compile

# Launch
./scripts/code.sh
```

**Build Tips for macOS:**
- If `xcode-select --install` fails, you may need to install the full Xcode app from the Mac App Store.
- Homebrew is not required but is useful for installing Ollama and Docker: `brew install ollama`
- The `npm install` step may prompt for keychain access — this is normal (used for secure API key storage).
- For Apple Silicon machines with 16GB+ RAM, compilation is typically fast (8–12 minutes).

---

### Windows (x64)

#### Pre-built Binary

1. Download `kovix-win32-x64.zip` from [GitHub Releases](https://github.com/Razisafir/KOVIX/releases)
2. Extract the ZIP to your preferred location (e.g., `C:\Kovix\`)
3. Run `Kovix.exe`
4. **Windows SmartScreen** may warn on first launch because the app is not code-signed. Click **"More info"** → **"Run anyway"**
5. *(Optional)* Add to PATH for terminal access:
   - Open **System Properties → Advanced → Environment Variables**
   - Add `C:\Kovix\bin` to your **Path** variable
6. *(Optional)* Pin to taskbar: Right-click the running app → **Pin to taskbar**

**Windows Defender Note:**
- Some antivirus products may flag the Electron binary. Add an exclusion for the Kovix folder if this happens.
- The app does not contain malware — this is a common false positive for unsigned Electron applications.

#### Build from Source

```powershell
# Clone the repository
git clone https://github.com/Razisafir/KOVIX
cd KOVIX

# Install dependencies
npm install

# Set Node.js heap size for compilation
$env:NODE_OPTIONS="--max-old-space-size=8192"

# Compile
npm run compile

# Launch
.\scripts\code.bat
```

**Build Tips for Windows:**
- Use **PowerShell** or **Windows Terminal** for the build commands. CMD may not handle the environment variable correctly.
- Ensure **Visual Studio Build Tools** are installed (for native module compilation): `npm install -g windows-build-tools`
- If `npm install` fails with `node-gyp` errors, install Python 3 and ensure it's in your PATH.
- The compile step may trigger Windows Defender scans — this is normal for large file operations.
- For WSL2 + Kali Linux integration, ensure WSL2 is installed: `wsl --install`

---

## LLM Provider Setup

### Ollama (Recommended — Fully Offline)

Ollama is the recommended way to run AI models locally. It supports GPU acceleration on NVIDIA (CUDA) and Apple Silicon (Metal).

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh  # Linux/macOS
# Or download from https://ollama.ai for Windows

# Pull recommended models
ollama pull llama3.2          # General-purpose coding model (4.7GB)
ollama pull nomic-embed-text  # Embedding model for semantic search (274MB)

# Start Ollama (runs automatically on macOS/Windows)
ollama serve  # Linux

# Verify Ollama is running
ollama list
```

**Model Selection Guide:**
| Model | Size | Best For | RAM Needed |
|-------|------|----------|------------|
| `llama3.2` | 4.7GB | General coding, fast responses | 8GB |
| `llama3.2:70b` | 40GB | Complex reasoning, large codebases | 48GB+ |
| `mistral` | 4.1GB | Code generation, instruction following | 8GB |
| `codellama` | 3.8GB | Code completion and generation | 8GB |
| `nomic-embed-text` | 274MB | Semantic search embeddings | 2GB |

### Anthropic (Cloud — Requires API Key)

For cloud-based AI when local hardware is insufficient:

1. Get an API key from https://console.anthropic.com
2. In Kovix, press `Ctrl+Shift+P`
3. Run **"Construct: Set API Key"**
4. Enter your key (starts with `sk-ant-`)
5. Switch provider to **Cloud** via the status bar model picker

**Note:** Cloud mode sends your prompts to Anthropic's servers. If you need full offline operation, use Ollama instead.

---

## Docker Setup (For Ghidra)

The Ghidra decompilation tool requires Docker to run the headless analyzer:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh  # Linux
# Or download Docker Desktop for macOS/Windows

# Pull the Ghidra headless image
docker pull ghidra-headless

# Verify
docker run --rm ghidra-headless analyzeHeadless 2>&1 | head -5
```

**Platform Notes:**
- **Linux**: Add your user to the `docker` group: `sudo usermod -aG docker $USER`
- **macOS**: Docker Desktop must be running before using Ghidra tools
- **Windows**: Use Docker Desktop with WSL2 backend (not Hyper-V)

---

## Security Tools

Kovix integrates with security testing tools. These are optional but enhance the security analysis capabilities:

### Nmap — Network Scanner

Nmap is used by the `nmap_scan` agent tool for network discovery and security auditing.

```bash
# Linux (Debian/Ubuntu)
sudo apt-get install nmap

# Linux (Fedora/RHEL)
sudo dnf install nmap

# macOS
brew install nmap

# Windows: download from https://nmap.org/download.html
```

### Nuclei — Vulnerability Scanner

Nuclei is used by the `nuclei_scan` agent tool for template-based vulnerability scanning.

```bash
# Requires Go 1.21+
go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest

# Verify
nuclei --version
```

**Important:** All security tools require explicit user confirmation before execution. The agent will always ask for approval before running nmap, nuclei, or Ghidra scans.

---

## Troubleshooting

### "Ollama not running" error
Start Ollama in a terminal:
```bash
ollama serve
```
On macOS/Windows, Ollama runs as a background app — check your system tray.

### "No models available"
Pull a model first:
```bash
ollama pull llama3.2
```
Then verify: `ollama list`

### Build OOM on 8GB RAM
Increase Node heap for compilation:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run compile
```
For full gulp packaging, a machine with 16GB+ RAM is recommended. See [PACKAGING.md](./PACKAGING.md) for details.

### GPU not detected by Ollama
Ensure NVIDIA drivers and CUDA toolkit are installed:
```bash
nvidia-smi  # Should show your GPU
```
On Linux, you may also need: `sudo apt-get install nvidia-container-toolkit`

### "Permission denied" on Linux
The AppImage or binary needs execute permission:
```bash
chmod +x ./VSCode-linux-x64/construct
```

### macOS Gatekeeper blocks the app
Right-click → Open → Open (in the dialog). Or from System Settings → Privacy & Security → Open Anyway.

### Windows SmartScreen warning
Click "More info" → "Run anyway". This only appears on first launch.

### Docker command not found (Ghidra)
Install Docker and ensure it's running:
```bash
docker --version
docker info
```

### TypeScript compilation errors
Ensure you're using Node.js 20+:
```bash
node --version  # Should be v20.x.x
```
Clean and rebuild:
```bash
rm -rf node_modules/out
npm install
NODE_OPTIONS="--max-old-space-size=8192" npm run compile
```
