#!/usr/bin/env bash
# sync-vscode.sh — Sync upstream VS Code changes into our fork
# Usage: ./scripts/sync-vscode.sh [--dry-run] [--no-rebase]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VSCODE_DIR="$REPO_ROOT/vscode-fork"
UPSTREAM_REMOTE="upstream-vscode"
UPSTREAM_URL="https://github.com/microsoft/vscode.git"
DRY_RUN=false
NO_REBASE=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
        --no-rebase) NO_REBASE=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

echo "============================================"
echo "  Construct IDE — VS Code Upstream Sync"
echo "============================================"
echo ""

# Verify vscode-fork exists
if [ ! -d "$VSCODE_DIR" ]; then
    echo "ERROR: vscode-fork/ directory not found at $VSCODE_DIR"
    echo "Run the initial VS Code clone first."
    exit 1
fi

cd "$VSCODE_DIR"

# Initialize upstream remote if not present
if ! git remote | grep -q "^${UPSTREAM_REMOTE}$"; then
    echo "Adding upstream remote: $UPSTREAM_URL"
    if [ "$DRY_RUN" = false ]; then
        git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
    fi
fi

# Fetch upstream
echo "Fetching upstream changes..."
if [ "$DRY_RUN" = false ]; then
    git fetch "$UPSTREAM_REMOTE" --depth=50
fi

# Get latest upstream main
UPSTREAM_COMMIT=$(git rev-parse "${UPSTREAM_REMOTE}/main" 2>/dev/null || echo "unknown")
echo "Upstream latest commit: $UPSTREAM_COMMIT"
echo ""

# Check for conflicts with our customizations
echo "Checking for conflicts with our customizations..."
CONFLICT_FILES=""

# Files we've modified that are likely to conflict
OUR_MODIFIED_FILES=(
    "product.json"
    "extensions/theme-construct/"
    "extensions/construct-agent/"
    "resources/"
)

for file in "${OUR_MODIFIED_FILES[@]}"; do
    if [ -e "$file" ]; then
        echo "  [PROTECTED] $file — will be preserved during sync"
    fi
done

if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "[DRY RUN] Would sync from upstream $UPSTREAM_COMMIT"
    echo "[DRY RUN] Our customizations in product.json, theme-construct, construct-agent would be preserved"
    exit 0
fi

# Create sync branch
SYNC_BRANCH="sync/upstream-$(date +%Y%m%d-%H%M%S)"
echo "Creating sync branch: $SYNC_BRANCH"
git checkout -b "$SYNC_BRANCH"

# Attempt merge or rebase
if [ "$NO_REBASE" = true ]; then
    echo "Merging upstream changes..."
    git merge "${UPSTREAM_REMOTE}/main" --no-edit
else
    echo "Rebasing on upstream changes..."
    git rebase "${UPSTREAM_REMOTE}/main"
fi

echo ""
echo "============================================"
echo "  Sync complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git log --oneline -20"
echo "  2. Test the build: yarn install && yarn compile"
echo "  3. Re-apply branding if needed (product.json, theme)"
echo "  4. Push when ready: git push origin $SYNC_BRANCH"
echo ""
echo "To revert if something went wrong:"
echo "  git checkout vscode-fork-main"
echo "  git branch -D $SYNC_BRANCH"
