# OpenClawd Gateway - Docker Deployment

Containerized deployment for the OpenClawd gateway with security hardening.

## Quick Start

### 1. Build the image

```bash
cd /path/to/openclaw
docker compose -f deploy/docker-compose.gateway.yml build
```

### 2. Configure environment

```bash
cd deploy
cp .env.example .env
cp secrets.env.example secrets.env
chmod 600 secrets.env

# Edit with your values
nano .env
nano secrets.env
```

### 3. Start the gateway

```bash
docker compose -f deploy/docker-compose.gateway.yml up -d
```

### 4. Check status

```bash
docker compose -f deploy/docker-compose.gateway.yml logs -f
docker compose -f deploy/docker-compose.gateway.yml ps
```

## Migrating Existing Config

If you have an existing `~/.openclaw` configuration:

```bash
# Copy config into Docker volume
docker run --rm -v openclawd-config:/dest -v ~/.openclaw:/src alpine \
  sh -c "cp -r /src/* /dest/"
```

Or use the migration script:

```bash
./deploy/migrate-config.sh
```

## Security Features

| Feature | Description |
|---------|-------------|
| Non-root user | Container runs as `openclaw` user, not root |
| Resource limits | CPU and memory limits prevent runaway processes |
| Dropped capabilities | Only essential Linux capabilities enabled |
| No new privileges | Prevents privilege escalation |
| Read-only secrets | Secrets mounted read-only at `/run/secrets/` |
| Health checks | Automatic restart on failure |
| Logging limits | Log rotation prevents disk fill |

## Volume Mounts

The container mounts your host `~/.openclaw` directory to preserve path compatibility with your config.

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `~/.openclaw` | `/home/azureuser/.openclaw` | Everything (see below) |
| `./secrets.env` | `/run/secrets/openclaw.env` | API keys (read-only) |

### What's in ~/.openclaw (Agent Directories)

```
~/.openclaw/
├── openclaw.json          # Main config
├── workspace/             # Main agent workspace (projects, memory, files)
├── workspace-travel/      # Travel agent workspace
├── workspace-researcher/  # Researcher agent workspace
├── workspace-executor/    # Executor agent workspace
├── goal-loop/             # Goal states, iterations, history
├── planner/               # Planner states, tasks, DAGs
├── agents/                # Agent sessions and logs
├── browser/               # Chrome/Puppeteer sessions & cookies
├── dashboard/             # Trend digests and reports
├── prds/                  # Product requirement documents
├── researcher/            # Research outputs
├── media/                 # Media files (images, videos)
├── cron/                  # Cron job states
├── logs/                  # Gateway logs
└── extensions/            # Custom plugins
```

**Important:** The config has hardcoded paths like `/home/azureuser/.openclaw/workspace`. The container creates a matching user so these paths work inside the container.

## Commands

```bash
# Start
docker compose -f deploy/docker-compose.gateway.yml up -d

# Stop
docker compose -f deploy/docker-compose.gateway.yml down

# Restart
docker compose -f deploy/docker-compose.gateway.yml restart

# View logs
docker compose -f deploy/docker-compose.gateway.yml logs -f

# Shell into container
docker compose -f deploy/docker-compose.gateway.yml exec openclawd-gateway bash

# Check gateway status
docker compose -f deploy/docker-compose.gateway.yml exec openclawd-gateway \
  node dist/index.js channels status
```

## Updating

```bash
# Pull latest code
git pull

# Rebuild image
docker compose -f deploy/docker-compose.gateway.yml build

# Restart with new image
docker compose -f deploy/docker-compose.gateway.yml up -d
```

## Backup

```bash
# Backup config volume
docker run --rm -v openclawd-config:/data -v $(pwd):/backup alpine \
  tar czf /backup/openclawd-config-backup.tar.gz -C /data .

# Restore
docker run --rm -v openclawd-config:/data -v $(pwd):/backup alpine \
  sh -c "cd /data && tar xzf /backup/openclawd-config-backup.tar.gz"
```

## Troubleshooting

### Gateway won't start

Check logs:
```bash
docker compose -f deploy/docker-compose.gateway.yml logs openclawd-gateway
```

### Discord not connecting

Ensure `DISCORD_BOT_TOKEN` is set in `.env` and the token is valid.

### WhatsApp/Signal issues

The container includes Chromium for browser sessions. If sessions fail:
1. Check that the config volume has the session data
2. You may need to re-scan the QR code

### Permission denied errors

The container runs as non-root. If you migrated config from a root-owned setup:
```bash
docker compose -f deploy/docker-compose.gateway.yml exec -u root openclawd-gateway \
  chown -R openclaw:openclaw /home/openclaw/.openclaw
```
