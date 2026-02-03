#!/bin/bash
# OpenClawd Restore Script
# Restores agent data, config, and workspaces from backup
#
# Usage: ./restore.sh <backup_dir> [--full|--config|--workspaces|--state]
#
# Options:
#   --full       Restore everything (default)
#   --config     Restore only config files
#   --workspaces Restore only workspaces
#   --state      Restore only goal-loop/planner state

set -e

BACKUP_DIR="$1"
MODE="${2:---full}"
OPENCLAW_DIR="${OPENCLAW_CONFIG_DIR:-$HOME/.openclaw}"

if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
    echo "Usage: $0 <backup_dir> [--full|--config|--workspaces|--state]"
    echo ""
    echo "Available backups:"
    ls -1d ~/.openclaw-backups/*/ 2>/dev/null | head -10 || echo "  No backups found"
    exit 1
fi

echo "=== OpenClawd Restore ==="
echo "Source: $BACKUP_DIR"
echo "Destination: $OPENCLAW_DIR"
echo "Mode: $MODE"
echo ""

# Check if gateway is running
if systemctl --user is-active openclaw-gateway &>/dev/null; then
    echo "WARNING: Gateway is running. Stop it first for a clean restore."
    echo "  systemctl --user stop openclaw-gateway"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Function to restore a file
restore_file() {
    local src="$1"
    local dest="$2"
    if [ -f "$BACKUP_DIR/$src" ]; then
        mkdir -p "$(dirname "$dest")"
        cp "$BACKUP_DIR/$src" "$dest"
        echo "  [OK] $src -> $dest"
    else
        echo "  [SKIP] $src (not in backup)"
    fi
}

# Function to restore a directory from tarball
restore_dir() {
    local name="$1"
    local dest="$2"
    if [ -f "$BACKUP_DIR/${name}.tar.gz" ]; then
        mkdir -p "$dest"
        # Remove existing directory content
        rm -rf "${dest:?}/${name}" 2>/dev/null || true
        tar -xzf "$BACKUP_DIR/${name}.tar.gz" -C "$dest"
        echo "  [OK] ${name}.tar.gz -> $dest/"
    else
        echo "  [SKIP] ${name}.tar.gz (not in backup)"
    fi
}

restore_config() {
    echo "Restoring config files..."
    restore_file "openclaw.json" "$OPENCLAW_DIR/openclaw.json"
    restore_file "secrets.env" "$OPENCLAW_DIR/.secrets.env"
    restore_file "SOUL.md" "$OPENCLAW_DIR/SOUL.md"
    chmod 600 "$OPENCLAW_DIR/.secrets.env" 2>/dev/null || true
}

restore_workspaces() {
    echo "Restoring workspaces..."
    restore_dir "workspace" "$OPENCLAW_DIR"
    restore_dir "workspace-travel" "$OPENCLAW_DIR"
    restore_dir "workspace-researcher" "$OPENCLAW_DIR"
    restore_dir "workspace-executor" "$OPENCLAW_DIR"
}

restore_state() {
    echo "Restoring goal-loop and planner state..."
    restore_dir "goal-loop" "$OPENCLAW_DIR"
    restore_dir "planner" "$OPENCLAW_DIR"
}

restore_agents() {
    echo "Restoring agent sessions and data..."
    restore_dir "agents" "$OPENCLAW_DIR"
    restore_dir "researcher" "$OPENCLAW_DIR"
    restore_dir "dashboard" "$OPENCLAW_DIR"
    restore_dir "prds" "$OPENCLAW_DIR"
}

restore_browser() {
    echo "Restoring browser sessions..."
    restore_dir "browser" "$OPENCLAW_DIR"
}

restore_extensions() {
    echo "Restoring extensions and plugins..."
    restore_dir "extensions" "$OPENCLAW_DIR"
    restore_dir "hooks" "$OPENCLAW_DIR"
}

restore_credentials() {
    echo "Restoring credentials and identity..."
    restore_dir "credentials" "$OPENCLAW_DIR"
    restore_dir "identity" "$OPENCLAW_DIR"
    restore_dir "devices" "$OPENCLAW_DIR"
}

restore_misc() {
    echo "Restoring cron and logs..."
    restore_dir "cron" "$OPENCLAW_DIR"
    restore_dir "logs" "$OPENCLAW_DIR"
}

case "$MODE" in
    --full)
        restore_config
        echo ""
        restore_workspaces
        echo ""
        restore_state
        echo ""
        restore_agents
        echo ""
        restore_browser
        echo ""
        restore_extensions
        echo ""
        restore_credentials
        echo ""
        restore_misc
        ;;
    --config)
        restore_config
        ;;
    --workspaces)
        restore_workspaces
        ;;
    --state)
        restore_state
        ;;
    *)
        echo "Unknown mode: $MODE"
        exit 1
        ;;
esac

echo ""
echo "=== Restore Complete ==="
echo ""
echo "Next steps:"
echo "  1. Review restored files"
echo "  2. Start gateway: systemctl --user start openclaw-gateway"
echo "  3. Verify: openclaw channels status --probe"
