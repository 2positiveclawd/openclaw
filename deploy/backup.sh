#!/bin/bash
# OpenClawd Backup Script
# Backs up all agent data, config, and workspaces
#
# Usage: ./backup.sh [backup_dir]
# Default backup location: ~/.openclaw-backups/
#
# Schedule with: ./install-backup-cron.sh

set -e

# Configuration
BACKUP_BASE="${OPENCLAW_BACKUP_DIR:-$HOME/.openclaw-backups}"
OPENCLAW_DIR="${OPENCLAW_CONFIG_DIR:-$HOME/.openclaw}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

# Create timestamped backup directory
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_BASE/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

echo "=== OpenClawd Backup ==="
echo "Source: $OPENCLAW_DIR"
echo "Destination: $BACKUP_DIR"
echo ""

# Function to backup a file if it exists
backup_file() {
    local src="$1"
    local dest="$2"
    if [ -f "$src" ]; then
        cp "$src" "$BACKUP_DIR/$dest"
        echo "  [OK] $dest"
    else
        echo "  [SKIP] $dest (not found)"
    fi
}

# Function to backup a directory as tarball
backup_dir() {
    local src="$1"
    local name="$2"
    if [ -d "$src" ]; then
        tar -czf "$BACKUP_DIR/${name}.tar.gz" -C "$(dirname "$src")" "$(basename "$src")" 2>/dev/null
        local size=$(du -h "$BACKUP_DIR/${name}.tar.gz" | cut -f1)
        echo "  [OK] ${name}.tar.gz ($size)"
    else
        echo "  [SKIP] $name (not found)"
    fi
}

echo "Backing up config files..."
backup_file "$OPENCLAW_DIR/openclaw.json" "openclaw.json"
backup_file "$OPENCLAW_DIR/.secrets.env" "secrets.env"
backup_file "$OPENCLAW_DIR/SOUL.md" "SOUL.md"

echo ""
echo "Backing up agent workspaces..."
backup_dir "$OPENCLAW_DIR/workspace" "workspace"
backup_dir "$OPENCLAW_DIR/workspace-travel" "workspace-travel"
backup_dir "$OPENCLAW_DIR/workspace-researcher" "workspace-researcher"
backup_dir "$OPENCLAW_DIR/workspace-executor" "workspace-executor"

echo ""
echo "Backing up goal-loop and planner state..."
backup_dir "$OPENCLAW_DIR/goal-loop" "goal-loop"
backup_dir "$OPENCLAW_DIR/planner" "planner"

echo ""
echo "Backing up agent sessions and data..."
backup_dir "$OPENCLAW_DIR/agents" "agents"
backup_dir "$OPENCLAW_DIR/researcher" "researcher"
backup_dir "$OPENCLAW_DIR/dashboard" "dashboard"
backup_dir "$OPENCLAW_DIR/prds" "prds"

echo ""
echo "Backing up browser sessions..."
backup_dir "$OPENCLAW_DIR/browser" "browser"

echo ""
echo "Backing up extensions and plugins..."
backup_dir "$OPENCLAW_DIR/extensions" "extensions"
backup_dir "$OPENCLAW_DIR/hooks" "hooks"

echo ""
echo "Backing up credentials and identity..."
backup_dir "$OPENCLAW_DIR/credentials" "credentials"
backup_dir "$OPENCLAW_DIR/identity" "identity"
backup_dir "$OPENCLAW_DIR/devices" "devices"

echo ""
echo "Backing up cron and logs..."
backup_dir "$OPENCLAW_DIR/cron" "cron"
backup_dir "$OPENCLAW_DIR/logs" "logs"

# Create manifest
echo ""
echo "Creating manifest..."
cat > "$BACKUP_DIR/manifest.json" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "hostname": "$(hostname)",
  "user": "$(whoami)",
  "source": "$OPENCLAW_DIR",
  "contents": [
$(ls -1 "$BACKUP_DIR" | grep -v manifest.json | sed 's/^/    "/; s/$/",/' | sed '$ s/,$//')
  ]
}
EOF
echo "  [OK] manifest.json"

# Create restore guide
cat > "$BACKUP_DIR/RESTORE.md" << 'EOF'
# OpenClawd Restore Guide

## Quick Restore (full)

```bash
# Stop gateway first
systemctl --user stop openclaw-gateway

# Extract all tarballs
cd ~/.openclaw
for f in /path/to/backup/*.tar.gz; do
    tar -xzf "$f"
done

# Restore config files
cp /path/to/backup/openclaw.json ~/.openclaw/
cp /path/to/backup/secrets.env ~/.openclaw/.secrets.env
cp /path/to/backup/SOUL.md ~/.openclaw/

# Restart gateway
systemctl --user start openclaw-gateway
```

## Selective Restore

To restore only specific components:

```bash
# Just workspaces
tar -xzf workspace.tar.gz -C ~/.openclaw/

# Just goal-loop state
tar -xzf goal-loop.tar.gz -C ~/.openclaw/

# Just browser sessions
tar -xzf browser.tar.gz -C ~/.openclaw/
```

## Verify Restore

```bash
openclaw channels status --probe
openclaw goal list
```
EOF
echo "  [OK] RESTORE.md"

# Calculate total backup size
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
FILE_COUNT=$(ls -1 "$BACKUP_DIR" | wc -l)

echo ""
echo "=== Backup Complete ==="
echo "Location: $BACKUP_DIR"
echo "Size: $TOTAL_SIZE ($FILE_COUNT files)"

# Cleanup old backups
if [ "$RETENTION_DAYS" -gt 0 ]; then
    echo ""
    echo "Cleaning up backups older than $RETENTION_DAYS days..."
    find "$BACKUP_BASE" -maxdepth 1 -type d -mtime +$RETENTION_DAYS -exec rm -rf {} \; 2>/dev/null || true
    REMAINING=$(ls -1d "$BACKUP_BASE"/*/ 2>/dev/null | wc -l)
    echo "  Remaining backups: $REMAINING"
fi

echo ""
echo "Done!"
