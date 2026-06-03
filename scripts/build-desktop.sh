#!/usr/bin/env bash
# =============================================================================
# Real Construct — Desktop Build Script
# =============================================================================
# Orchestrates the full desktop packaging pipeline for Windows, macOS, and Linux.
#
# Usage:
#   ./scripts/build-desktop.sh                    # Build for current platform
#   ./scripts/build-desktop.sh --platform win      # Build for Windows (NSIS)
#   ./scripts/build-desktop.sh --platform mac      # Build for macOS (DMG)
#   ./scripts/build-desktop.sh --platform linux    # Build for Linux (AppImage/DEB/RPM)
#   ./scripts/build-desktop.sh --platform all      # Build for all platforms
#
# Flags:
#   --platform <win|mac|linux|all>   Target platform (default: auto-detect)
#   --arch <x64|arm64>               Target architecture (default: host arch)
#   --skip-compile                   Skip the VS Code compilation step
#   --skip-sign                      Skip code signing (macOS/Windows)
#   --publish                        Publish artifacts after build
#   --clean                          Clean dist/ before building
#   --verbose                        Enable verbose output
#   -h, --help                       Show this help message
#
# Environment variables:
#   CSC_LINK            Path or URL to code-signing certificate (macOS/Windows)
#   CSC_KEY_PASSWORD    Password for the code-signing certificate
#   APPLE_ID            Apple ID for notarization
#   APPLE_ID_PASSWORD   App-specific password for notarization
#   APPLE_TEAM_ID       Apple Developer team ID
#   GH_TOKEN            GitHub token for publishing releases
#   ELECTRON_CACHE      Custom Electron binary cache directory
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Script directory & project root
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Color output helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step()    { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
PLATFORM=""
ARCH=""
SKIP_COMPILE=false
SKIP_SIGN=false
PUBLISH=false
CLEAN=false
VERBOSE=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
usage() {
    head -30 "$0" | tail -28 | sed 's/^# \?//'
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --skip-compile)
            SKIP_COMPILE=true
            shift
            ;;
        --skip-sign)
            SKIP_SIGN=true
            shift
            ;;
        --publish)
            PUBLISH=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Auto-detect platform if not specified
# ---------------------------------------------------------------------------
detect_platform() {
    local uname_out
    uname_out="$(uname -s)"
    case "${uname_out}" in
        Linux*)     echo "linux" ;;
        Darwin*)    echo "mac" ;;
        MINGW*|MSYS*|CYGWIN*) echo "win" ;;
        *)          log_error "Unsupported operating system: ${uname_out}"; exit 1 ;;
    esac
}

detect_arch() {
    local uname_m
    uname_m="$(uname -m)"
    case "${uname_m}" in
        x86_64|amd64)  echo "x64" ;;
        aarch64|arm64) echo "arm64" ;;
        *)             log_error "Unsupported architecture: ${uname_m}"; exit 1 ;;
    esac
}

if [[ -z "${PLATFORM}" ]]; then
    PLATFORM="$(detect_platform)"
    log_info "Auto-detected platform: ${PLATFORM}"
fi

if [[ -z "${ARCH}" ]]; then
    ARCH="$(detect_arch)"
    log_info "Auto-detected architecture: ${ARCH}"
fi

# Validate platform
case "${PLATFORM}" in
    win|mac|linux|all) ;;
    *)
        log_error "Invalid platform '${PLATFORM}'. Must be: win, mac, linux, or all"
        exit 1
        ;;
esac

# Validate architecture
case "${ARCH}" in
    x64|arm64) ;;
    *)
        log_error "Invalid architecture '${ARCH}'. Must be: x64 or arm64"
        exit 1
        ;;
esac

# ---------------------------------------------------------------------------
# Validate cross-compilation support
# ---------------------------------------------------------------------------
validate_cross_compilation() {
    local host_platform
    host_platform="$(detect_platform)"

    if [[ "${PLATFORM}" != "all" && "${PLATFORM}" != "${host_platform}" ]]; then
        log_warn "Cross-compilation requested: host=${host_platform}, target=${PLATFORM}"
        case "${host_platform}" in
            linux)
                # Linux can cross-compile for Windows via wine + electron-builder
                if [[ "${PLATFORM}" == "mac" ]]; then
                    log_error "Cross-compiling for macOS is only supported on macOS hosts."
                    log_error "Use a macOS runner or set --platform mac on a Mac."
                    exit 1
                fi
                log_info "Linux→Windows cross-compilation is supported via electron-builder."
                ;;
            mac)
                log_info "macOS can cross-compile for Linux (AppImage/DEB only) and Windows."
                ;;
            win)
                if [[ "${PLATFORM}" == "mac" ]]; then
                    log_error "Cross-compiling for macOS is only supported on macOS hosts."
                    exit 1
                fi
                ;;
        esac
    fi
}

validate_cross_compilation

# ---------------------------------------------------------------------------
# Check required dependencies
# ---------------------------------------------------------------------------
check_dependencies() {
    log_step "Checking required dependencies"

    local missing=()

    # Node.js
    if command -v node &>/dev/null; then
        local node_version
        node_version="$(node --version)"
        log_success "Node.js ${node_version} found"

        # Check minimum version (18.x+)
        local node_major
        node_major="$(echo "${node_version}" | sed 's/^v\([0-9]*\).*/\1/')"
        if [[ "${node_major}" -lt 18 ]]; then
            log_error "Node.js 18+ is required (found ${node_version})"
            missing+=("node>=18")
        fi
    else
        log_error "Node.js not found. Install from https://nodejs.org"
        missing+=("node")
    fi

    # npm
    if command -v npm &>/dev/null; then
        local npm_version
        npm_version="$(npm --version)"
        log_success "npm ${npm_version} found"
    else
        log_error "npm not found. It should be included with Node.js."
        missing+=("npm")
    fi

    # Platform-specific checks
    case "${PLATFORM}" in
        win|all)
            # Check for wine on non-Windows when targeting Windows
            if [[ "$(detect_platform)" != "win" ]]; then
                if command -v wine &>/dev/null; then
                    log_success "Wine found (for Windows cross-compilation)"
                else
                    log_warn "Wine not found — Windows builds on non-Windows hosts may fail."
                    log_warn "  Install wine if you need to build Windows installers."
                fi
            fi
            ;;
        mac|all)
            if [[ "$(detect_platform)" == "mac" ]]; then
                # Check for Xcode command line tools
                if xcode-select -p &>/dev/null; then
                    log_success "Xcode command line tools found"
                else
                    log_warn "Xcode command line tools not found. Run: xcode-select --install"
                    missing+=("xcode-cli")
                fi
            fi
            ;;
        linux|all)
            # Check for fpm (for RPM builds) on Linux
            if [[ "$(detect_platform)" == "linux" ]]; then
                if command -v fpm &>/dev/null; then
                    log_success "fpm found (for RPM packaging)"
                else
                    log_warn "fpm not found — RPM packages may not be buildable."
                    log_warn "  Install with: gem install fpm"
                fi
            fi
            ;;
    esac

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing[*]}"
        log_error "Please install them before running this script."
        exit 1
    fi

    log_success "All required dependencies are available"
}

# ---------------------------------------------------------------------------
# Clean output directory
# ---------------------------------------------------------------------------
clean_dist() {
    log_step "Cleaning output directory"
    local dist_dir="${PROJECT_ROOT}/dist"
    if [[ -d "${dist_dir}" ]]; then
        rm -rf "${dist_dir}"
        log_success "Removed ${dist_dir}"
    else
        log_info "No dist/ directory to clean"
    fi
}

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
install_deps() {
    log_step "Installing project dependencies"

    cd "${PROJECT_ROOT}"

    if [[ -f "package.json" ]]; then
        log_info "Running npm ci for deterministic install..."
        if [[ "${VERBOSE}" == true ]]; then
            npm ci
        else
            npm ci --silent 2>&1 | while read -r line; do
                log_info "  ${line}"
            done
        fi
        log_success "Dependencies installed"
    else
        log_warn "No package.json found — skipping dependency installation"
    fi
}

# ---------------------------------------------------------------------------
# Compile the VS Code / Real Construct source
# ---------------------------------------------------------------------------
compile_source() {
    if [[ "${SKIP_COMPILE}" == true ]]; then
        log_step "Skipping compilation (--skip-compile)"
        return
    fi

    log_step "Compiling Real Construct source"

    cd "${PROJECT_ROOT}"

    # Check if out/ directory already exists and is recent
    if [[ -d "out" ]]; then
        log_info "Existing out/ directory found"
    fi

    # Try the standard VS Code compilation pipeline
    # The project may use npm scripts or gulp tasks
    if npm run compile &>/dev/null 2>&1; then
        log_info "Running npm run compile..."
        if [[ "${VERBOSE}" == true ]]; then
            npm run compile
        else
            npm run compile 2>&1 | tail -5
        fi
    elif npm run vscode &>/dev/null 2>&1; then
        log_info "Running npm run vscode..."
        if [[ "${VERBOSE}" == true ]]; then
            npm run vscode
        else
            npm run vscode 2>&1 | tail -5
        fi
    elif [[ -f "gulpfile.js" ]]; then
        log_info "Running gulp compile..."
        npx gulp compile
    else
        log_warn "No standard compile target found"
        log_info "Attempting to run yarn compile (if yarn is available)..."
        if command -v yarn &>/dev/null; then
            yarn compile 2>&1 | tail -5
        else
            log_error "Cannot find a way to compile the project."
            log_error "Ensure one of the following exists:"
            log_error "  - npm run compile"
            log_error "  - npm run vscode"
            log_error "  - gulpfile.js with compile task"
            log_error "  - yarn with compile script"
            exit 1
        fi
    fi

    # Verify compilation output
    if [[ -d "out" ]]; then
        log_success "Compilation complete — out/ directory created"
    else
        log_error "Compilation may have failed — out/ directory not found"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Run electron-builder for the specified platform(s)
# ---------------------------------------------------------------------------
run_electron_builder() {
    local target_platform="$1"
    local publish_flag=""

    if [[ "${PUBLISH}" == true ]]; then
        publish_flag="--publish always"
    else
        publish_flag="--publish never"
    fi

    local sign_flag=""
    if [[ "${SKIP_SIGN}" == true ]]; then
        # Disable code signing via environment variable
        export CSC_IDENTITY_AUTO_DISCOVERY=false
        log_warn "Code signing disabled (--skip-sign)"
    fi

    local verbose_flag=""
    if [[ "${VERBOSE}" == true ]]; then
        verbose_flag="--config.compression=store"
    fi

    cd "${PROJECT_ROOT}"

    case "${target_platform}" in
        win)
            log_step "Building Windows NSIS installer"
            npx electron-builder --win --"${ARCH}" ${publish_flag} ${verbose_flag}
            ;;
        mac)
            log_step "Building macOS DMG"
            npx electron-builder --mac --"${ARCH}" ${publish_flag} ${verbose_flag}

            # Notarize if Apple credentials are available
            if [[ "${SKIP_SIGN}" == false ]] && [[ -n "${APPLE_ID:-}" ]] && [[ -n "${APPLE_ID_PASSWORD:-}" ]] && [[ -n "${APPLE_TEAM_ID:-}" ]]; then
                log_info "Apple notarization credentials detected — notarization will be attempted by electron-builder"
            fi
            ;;
        linux)
            log_step "Building Linux packages (AppImage + DEB + RPM)"
            npx electron-builder --linux --"${ARCH}" ${publish_flag} ${verbose_flag}
            ;;
        all)
            log_step "Building all platforms"
            npx electron-builder --win --mac --linux --"${ARCH}" ${publish_flag} ${verbose_flag}
            ;;
        *)
            log_error "Unknown platform: ${target_platform}"
            exit 1
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Post-build: summarize artifacts
# ---------------------------------------------------------------------------
summarize_artifacts() {
    log_step "Build artifacts"

    local dist_dir="${PROJECT_ROOT}/dist"

    if [[ ! -d "${dist_dir}" ]]; then
        log_warn "No dist/ directory found — build may have failed"
        return
    fi

    local artifact_count=0
    local total_size=0

    echo ""
    while IFS= read -r -d '' file; do
        local filename
        filename="$(basename "${file}")"
        local size
        size="$(stat -f%z "${file}" 2>/dev/null || stat -c%s "${file}" 2>/dev/null || echo "0")"
        local size_mb
        size_mb="$(echo "scale=1; ${size} / 1048576" | bc 2>/dev/null || echo "?")"
        echo -e "  ${GREEN}▸${NC} ${filename}  (${size_mb} MB)"
        artifact_count=$((artifact_count + 1))
        total_size=$((total_size + size))
    done < <(find "${dist_dir}" -maxdepth 2 -type f \( -name "*.exe" -o -name "*.dmg" -o -name "*.zip" -o -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.snap" -o -name "*.yml" -o -name "*.blockmap" \) -print0 2>/dev/null | sort -z)

    echo ""
    if [[ ${artifact_count} -gt 0 ]]; then
        local total_size_mb
        total_size_mb="$(echo "scale=1; ${total_size} / 1048576" | bc 2>/dev/null || echo "?")"
        log_success "${artifact_count} artifact(s) produced (${total_size_mb} MB total)"
        log_info "Output directory: ${dist_dir}"
    else
        log_warn "No build artifacts found in ${dist_dir}"
    fi
}

# ---------------------------------------------------------------------------
# Main execution
# ---------------------------------------------------------------------------
main() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              Real Construct — Desktop Build                    ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    log_info "Platform:   ${PLATFORM}"
    log_info "Architecture: ${ARCH}"
    log_info "Project:    ${PROJECT_ROOT}"
    log_info "Skip compile: ${SKIP_COMPILE}"
    log_info "Skip sign:  ${SKIP_SIGN}"
    log_info "Publish:    ${PUBLISH}"
    echo ""

    # Step 1: Check dependencies
    check_dependencies

    # Step 2: Clean if requested
    if [[ "${CLEAN}" == true ]]; then
        clean_dist
    fi

    # Step 3: Install npm dependencies
    install_deps

    # Step 4: Compile source
    compile_source

    # Step 5: Build for target platform(s)
    if [[ "${PLATFORM}" == "all" ]]; then
        # Build each platform sequentially
        for p in win mac linux; do
            run_electron_builder "${p}"
        done
    else
        run_electron_builder "${PLATFORM}"
    fi

    # Step 6: Summarize output
    summarize_artifacts

    echo ""
    log_success "Build complete!"
    echo ""
}

# Run main
main
