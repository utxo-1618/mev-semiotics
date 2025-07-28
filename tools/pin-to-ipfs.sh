#!/bin/bash

# PHI-aligned IPFS pinning script - minimal downloads, focused on essential files

# Get the absolute path of the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Define essential files/directories to pin (PHI-aligned minimal set)
ESSENTIAL_FILES=(
    "index.js"
    "semantic-amplifier.js"
    "mirror.js"
    "constants.js"
    "dex-config.js"
    "package.json"
    "README.md"
    ".env.template"
    "narrative-trainer.js"
    "narrative-watcher.js"
    "tools/pin-to-ipfs.sh"
    "tools/setup-ipfs.sh"
    "tools/start-narrative.sh"
    "tools/stop-narrative.sh"
)

# Create temporary directory for essential files
TEMP_DIR="$(mktemp -d)"
ESS_DIR="$TEMP_DIR/dss-reflux-core"
mkdir -p "$ESS_DIR"

echo "Preparing minimal IPFS manifest with essential files only..."

# Copy only essential files to temp directory
for file in "${ESSENTIAL_FILES[@]}"; do
    if [ -f "$REPO_ROOT/$file" ]; then
        cp "$REPO_ROOT/$file" "$ESS_DIR/"
        echo "  Added $file to manifest"
    else
        echo "  Warning: $file not found, skipping"
    fi
done

# 1. Pin the essential files to IPFS (reduced bandwidth)
NEW_HASH=$(ipfs add -r -Q --progress "$ESS_DIR")

# Cleanup temp directory
rm -rf "$TEMP_DIR"

if [ -z "$NEW_HASH" ]; then
    echo "Error: Failed to get new IPFS hash. Make sure IPFS is running and the daemon is accessible."
    exit 1
fi

echo "New IPFS Core Manifest Hash: $NEW_HASH"

# 2. Find and replace IPFS hashes in core files only (avoid logs/temp files)
# Focus on essential configuration files
CORE_FILES_TO_UPDATE=(
    "$REPO_ROOT/README.md"
    "$REPO_ROOT/constants.js"
    "$REPO_ROOT/index.js"
    "$REPO_ROOT/semantic-amplifier.js"
)

echo "Updating core configuration files..."
for FILE in "${CORE_FILES_TO_UPDATE[@]}"; do
    if [ -f "$FILE" ] && grep -qE "Qm[1-9A-HJ-NP-Za-km-z]{44}" "$FILE"; then
        # Use sed to replace any IPFS hash with the new hash
        sed -i "" "s/Qm[1-9A-HJ-NP-Za-km-z]{44}/$NEW_HASH/g" "$FILE"
        echo "  Updated $(basename "$FILE")"
    fi
done

# 3. Update the .ipfs-hash file in the repository root
echo "$NEW_HASH" > "$REPO_ROOT/.ipfs-hash"

# 4. Pin to ensure persistence (PHI-aligned approach)
echo "Ensuring IPFS pin persistence..."
ipfs pin add "$NEW_HASH" 2>/dev/null || echo "  Already pinned or pin failed"

echo "
✓ PHI-aligned IPFS core manifest updated: $NEW_HASH
✓ Reduced bandwidth usage by focusing on essential files only
✓ Core configuration files updated with new hash
"
