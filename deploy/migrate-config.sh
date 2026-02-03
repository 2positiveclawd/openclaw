#!/bin/bash
# Migrate existing ~/.openclaw config into Docker volume
set -e

SOURCE="${1:-$HOME/.openclaw}"
VOLUME_NAME="openclawd-config"

if [ ! -d "$SOURCE" ]; then
    echo "Error: Source directory $SOURCE does not exist"
    exit 1
fi

echo "Migrating config from $SOURCE to Docker volume $VOLUME_NAME..."

# Create volume if it doesn't exist
docker volume create "$VOLUME_NAME" 2>/dev/null || true

# Copy files into volume
docker run --rm \
    -v "$VOLUME_NAME":/dest \
    -v "$SOURCE":/src:ro \
    alpine sh -c "cp -r /src/* /dest/ && chown -R 1000:1000 /dest"

echo "Migration complete!"
echo ""
echo "Migrated contents:"
docker run --rm -v "$VOLUME_NAME":/data alpine ls -la /data

echo ""
echo "To start the gateway:"
echo "  docker compose -f deploy/docker-compose.gateway.yml up -d"
