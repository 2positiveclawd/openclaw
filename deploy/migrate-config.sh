#!/bin/bash
# Migrate/verify OpenClaw config for Docker deployment
set -e

CONFIG_DIR="${1:-$HOME/.openclaw}"

echo "Checking OpenClaw config at $CONFIG_DIR..."

if [ ! -d "$CONFIG_DIR" ]; then
    echo "Error: Config directory $CONFIG_DIR does not exist"
    echo "Run 'openclaw onboard' first to create initial config"
    exit 1
fi

echo ""
echo "=== Config Structure ==="
ls -la "$CONFIG_DIR" | head -20

echo ""
echo "=== Agent Workspaces ==="
for ws in "$CONFIG_DIR"/workspace*; do
    if [ -d "$ws" ]; then
        echo "  $(basename $ws): $(ls "$ws" 2>/dev/null | wc -l) files"
    fi
done

echo ""
echo "=== Data Directories ==="
for dir in goal-loop planner agents researcher dashboard prds browser; do
    if [ -d "$CONFIG_DIR/$dir" ]; then
        echo "  $dir: $(find "$CONFIG_DIR/$dir" -type f 2>/dev/null | wc -l) files"
    else
        echo "  $dir: (not created yet)"
    fi
done

echo ""
echo "=== Checking Path Compatibility ==="
HOST_USER=$(whoami)
if grep -q "/home/$HOST_USER/.openclaw" "$CONFIG_DIR/openclaw.json" 2>/dev/null; then
    echo "  Config paths use /home/$HOST_USER/.openclaw - OK"
else
    echo "  Warning: Config may have different paths, check openclaw.json"
fi

echo ""
echo "=== Permissions ==="
echo "  Owner: $(stat -c '%U:%G' "$CONFIG_DIR")"
echo "  UID/GID: $(stat -c '%u:%g' "$CONFIG_DIR")"

echo ""
echo "=== Next Steps ==="
echo "1. Copy .env.example to .env:"
echo "   cp deploy/.env.example deploy/.env"
echo ""
echo "2. Set your user info in .env:"
echo "   HOST_USER=$HOST_USER"
echo "   HOST_UID=$(id -u)"
echo "   HOST_GID=$(id -g)"
echo ""
echo "3. Add your secrets to deploy/secrets.env"
echo ""
echo "4. Build and run:"
echo "   docker compose -f deploy/docker-compose.gateway.yml build"
echo "   docker compose -f deploy/docker-compose.gateway.yml up -d"
