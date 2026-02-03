#!/bin/bash
# Install automated backup cron job for OpenClawd
#
# Usage: ./install-backup-cron.sh [interval]
# Default interval: daily at 3am
# Options: hourly, daily, weekly

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
LOG_FILE="$HOME/.openclaw-backups/backup.log"
INTERVAL="${1:-daily}"

# Ensure backup script exists and is executable
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo "Error: backup.sh not found at $BACKUP_SCRIPT"
    exit 1
fi
chmod +x "$BACKUP_SCRIPT"

# Create log directory
mkdir -p "$(dirname "$LOG_FILE")"

# Generate cron expression based on interval
case "$INTERVAL" in
    hourly)
        CRON_EXPR="0 * * * *"
        DESC="every hour"
        ;;
    daily)
        CRON_EXPR="0 3 * * *"
        DESC="daily at 3am"
        ;;
    weekly)
        CRON_EXPR="0 3 * * 0"
        DESC="weekly on Sunday at 3am"
        ;;
    *)
        echo "Unknown interval: $INTERVAL"
        echo "Valid options: hourly, daily, weekly"
        exit 1
        ;;
esac

# Create cron entry
CRON_LINE="$CRON_EXPR $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -q "$BACKUP_SCRIPT"; then
    echo "Backup cron job already exists. Updating..."
    # Remove existing entry
    crontab -l 2>/dev/null | grep -v "$BACKUP_SCRIPT" | crontab -
fi

# Add new cron entry
(crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -

echo "=== Backup Cron Installed ==="
echo "Schedule: $DESC"
echo "Script: $BACKUP_SCRIPT"
echo "Log: $LOG_FILE"
echo ""
echo "Current crontab:"
crontab -l | grep -E "(openclaw|backup)" || echo "(no matching entries)"
echo ""
echo "To run backup manually:"
echo "  $BACKUP_SCRIPT"
echo ""
echo "To view backup log:"
echo "  tail -f $LOG_FILE"
echo ""
echo "To uninstall:"
echo "  crontab -l | grep -v backup.sh | crontab -"
