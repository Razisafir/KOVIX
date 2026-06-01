#!/usr/bin/env bash
# bundle-backend.sh — Build the Python agent-backend as a standalone executable
# Usage: ./scripts/bundle-backend.sh [--platform linux|macos|windows] [--clean]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/agent-backend"
OUTPUT_DIR="$REPO_ROOT/vscode-fork/resources/agent-backend"
PLATFORM=""
CLEAN=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --platform) shift; PLATFORM="$1" ;;
        --clean) CLEAN=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

# Auto-detect platform if not specified
if [ -z "$PLATFORM" ]; then
    case "$(uname -s)" in
        Linux*) PLATFORM="linux" ;;
        Darwin*) PLATFORM="macos" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *) echo "Unknown OS, please specify --platform"; exit 1 ;;
    esac
fi

echo "============================================"
echo "  Construct IDE — Backend Bundler"
echo "============================================"
echo ""
echo "Platform: $PLATFORM"
echo "Source:   $BACKEND_DIR"
echo "Output:   $OUTPUT_DIR"
echo ""

# Verify backend directory
if [ ! -d "$BACKEND_DIR" ]; then
    echo "ERROR: agent-backend/ not found at $BACKEND_DIR"
    exit 1
fi

# Verify requirements.txt exists
if [ ! -f "$BACKEND_DIR/requirements.txt" ]; then
    echo "ERROR: requirements.txt not found in agent-backend/"
    exit 1
fi

cd "$BACKEND_DIR"

# Install PyInstaller if needed
if ! command -v pyinstaller &> /dev/null; then
    echo "Installing PyInstaller..."
    pip install pyinstaller
fi

# Clean previous build
if [ "$CLEAN" = true ]; then
    echo "Cleaning previous build artifacts..."
    rm -rf build/ dist/ *.spec
fi

# Determine executable name
case "$PLATFORM" in
    linux|macos)
        EXE_NAME="construct-agent-backend"
        ;;
    windows)
        EXE_NAME="construct-agent-backend.exe"
        ;;
    *)
        echo "Unknown platform: $PLATFORM"
        exit 1
        ;;
esac

echo "Building $EXE_NAME with PyInstaller..."
echo ""

# Build with PyInstaller
# --onefile: Single executable
# --add-data: Include Python packages
# --hidden-import: Ensure dependencies are found
pyinstaller --onefile \
    --name "construct-agent-backend" \
    --add-data "core:core" \
    --add-data "tools:tools" \
    --add-data "agents:agents" \
    --add-data "mcp:mcp" \
    --hidden-import uvicorn \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.lifespan.on \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import fastapi \
    --hidden-import fastapi.responses \
    --hidden-import chromadb \
    --hidden-import sqlite3 \
    --hidden-import httpx \
    --hidden-import pydantic \
    --hidden-import starlette \
    --hidden-import starlette.responses \
    --hidden-import starlette.routing \
    --hidden-import starlette.middleware \
    --collect-all chromadb \
    --collect-all httpx \
    --noconfirm \
    app.py

# Copy to output directory
mkdir -p "$OUTPUT_DIR"
cp "dist/$EXE_NAME" "$OUTPUT_DIR/"
chmod +x "$OUTPUT_DIR/$EXE_NAME"

# Verify
if [ -f "$OUTPUT_DIR/$EXE_NAME" ]; then
    FILESIZE=$(du -h "$OUTPUT_DIR/$EXE_NAME" | cut -f1)
    echo ""
    echo "============================================"
    echo "  Build successful!"
    echo "============================================"
    echo ""
    echo "  Executable: $OUTPUT_DIR/$EXE_NAME"
    echo "  Size: $FILESIZE"
    echo ""
    echo "To test the bundled backend:"
    echo "  $OUTPUT_DIR/$EXE_NAME --port 8000"
else
    echo ""
    echo "ERROR: Build failed — executable not found"
    exit 1
fi
