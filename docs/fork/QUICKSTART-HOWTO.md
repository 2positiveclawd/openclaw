# OpenClawd Quick-Start and How-To Guide

Practical, copy-pasteable instructions for setting up and operating the OpenClawd AI agent system. This guide covers installation, configuration, autonomous goals, task planning, research, trend monitoring, custom agents, and troubleshooting.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [How to: Connect Discord Bot](#how-to-connect-discord-bot)
3. [How to: Run Your First Autonomous Goal](#how-to-run-your-first-autonomous-goal)
4. [How to: Use the Planner for Complex Tasks](#how-to-use-the-planner-for-complex-tasks)
5. [How to: Research and Generate PRDs](#how-to-research-and-generate-prds)
6. [How to: Monitor Trends](#how-to-monitor-trends)
7. [How to: Create Custom Agents](#how-to-create-custom-agents)
8. [How to: Use the Dashboard](#how-to-use-the-dashboard)
9. [How to: Set Up Agent Packs](#how-to-set-up-agent-packs)
10. [Troubleshooting](#troubleshooting)
11. [Configuration Reference](#configuration-reference)

---

## Getting Started

### System Requirements

| Requirement  | Minimum                   | Recommended                   |
| ------------ | ------------------------- | ----------------------------- |
| **OS**       | Ubuntu 22.04+ / macOS 13+ | Ubuntu 24.04 LTS              |
| **Node.js**  | 22.x                      | 22.x LTS (latest)             |
| **pnpm**     | 9.x                       | Latest                        |
| **RAM**      | 2 GB                      | 4 GB+                         |
| **Disk**     | 5 GB                      | 20 GB+ (for sessions/logs)    |
| **Bun**      | Optional (1.x)            | Latest (for dev/test scripts) |
| **Docker**   | Optional (24.x)           | For containerized deployment  |
| **Chromium** | Optional                  | For browser/WhatsApp features |

**Additional accounts needed:**

- An AI provider account (Azure OpenAI, OpenAI, or Anthropic)
- A Discord account and bot application (for Discord integration)
- Optionally: Reddit API credentials (for trend-scout)

### Installation from Scratch

#### Step 1: Clone the Repository

```bash
git clone https://github.com/2positiveclawd/openclaw.git ~/openclaw
cd ~/openclaw
```

#### Step 2: Install Dependencies

```bash
# Using pnpm (recommended)
pnpm install

# Or using bun
bun install
```

#### Step 3: Build the Project

```bash
pnpm build
```

This compiles TypeScript to `dist/` and prepares all extensions.

#### Step 4: Create the Global Binary Wrapper

```bash
mkdir -p ~/.npm-global/bin

cat > ~/.npm-global/bin/openclaw << 'WRAPPER'
#!/usr/bin/env bash
exec node /home/$USER/openclaw/openclaw.mjs "$@"
WRAPPER

chmod +x ~/.npm-global/bin/openclaw

# Add to PATH (add to ~/.bashrc for persistence)
export PATH="$HOME/.npm-global/bin:$PATH"
```

Verify the binary works:

```bash
openclaw --version
# Expected output: 2026.x.x
```

#### Step 5: Create Required Directories

```bash
# Core config directory
mkdir -p ~/.openclaw

# Agent session directories
mkdir -p ~/.openclaw/agents/main/sessions

# Default workspace
mkdir -p ~/.openclaw/workspace

# Goal-loop data
mkdir -p ~/.openclaw/goal-loop

# Planner data
mkdir -p ~/.openclaw/planner

# Researcher data
mkdir -p ~/.openclaw/researcher

# PRDs storage
mkdir -p ~/.openclaw/prds

# Dashboard data
mkdir -p ~/.openclaw/dashboard/trend-digests
```

### First-Time Configuration

Create `~/.openclaw/openclaw.json` with your base configuration:

```json5
{
  // Gateway settings
  gateway: {
    mode: "local",
    port: 18789,
    bind: "loopback",
    auth: {
      token: "YOUR_GATEWAY_TOKEN_HERE",
    },
  },

  // AI model providers
  models: {
    providers: {
      azure: {
        baseUrl: "https://YOUR_RESOURCE.openai.azure.com/v1",
        apiKey: "YOUR_AZURE_API_KEY",
        models: [{ id: "gpt-4o-mini", alias: "default" }],
      },
      // Or use OpenAI directly:
      // "openai": {
      //   "apiKey": "sk-YOUR_KEY",
      //   "models": [
      //     { "id": "gpt-4o-mini", "alias": "default" }
      //   ]
      // }
    },
  },

  // Agent definitions
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        sources: ["memory", "sessions"],
        provider: "openai",
        sync: {
          onSessionStart: true,
          watchEnabled: true,
          intervalMinutes: 60,
        },
        query: {
          maxResults: 10,
          minScore: 0.5,
        },
      },
    },
    list: [
      {
        id: "main",
        workspace: "/home/YOUR_USER/.openclaw/workspace",
        identity: {
          name: "Main",
          emoji: "🤖",
        },
      },
    ],
  },

  // Channel bindings
  bindings: [],

  // Extensions/plugins
  "goal-loop": {
    enabled: true,
  },
  planner: {
    enabled: true,
  },
  researcher: {
    enabled: true,
  },
  "trend-scout": {
    enabled: true,
  },
  "agent-packs": {
    enabled: true,
    enabledPacks: "all",
    disabledPacks: [],
  },
}
```

Create secrets file `~/.openclaw/.secrets.env` (permissions restricted):

```bash
cat > ~/.openclaw/.secrets.env << 'EOF'
AZURE_OPENAI_API_KEY=your_azure_key_here
DISCORD_BOT_TOKEN=your_discord_token_here
OPENCLAW_GATEWAY_TOKEN=your_gateway_token_here
EOF

chmod 600 ~/.openclaw/.secrets.env
```

### Starting the Gateway

#### Option A: Systemd Service (Recommended for Production)

```bash
# Install the service
openclaw service install

# Create systemd override to point to dev tree
mkdir -p ~/.config/systemd/user/openclaw-gateway.service.d
cat > ~/.config/systemd/user/openclaw-gateway.service.d/dev-tree.conf << 'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/node /home/%u/openclaw/openclaw.mjs gateway run --bind loopback --port 18789 --force
EOF

# Reload and start
systemctl --user daemon-reload
systemctl --user enable openclaw-gateway
systemctl --user start openclaw-gateway
```

Check the service:

```bash
systemctl --user status openclaw-gateway
```

Expected output:

```
● openclaw-gateway.service - OpenClaw Gateway
     Loaded: loaded (/home/azureuser/.config/systemd/user/openclaw-gateway.service; enabled)
     Active: active (running) since ...
```

View logs:

```bash
journalctl --user -u openclaw-gateway -f
```

#### Option B: Manual/Foreground (For Development)

```bash
openclaw gateway run --bind loopback --port 18789 --force
```

#### Option C: Docker

```bash
cd ~/openclaw

# Copy and fill in the environment file
cp deploy/.env.example deploy/.env
# Edit deploy/.env with your secrets

# Build and start
docker compose -f deploy/docker-compose.gateway.yml build
docker compose -f deploy/docker-compose.gateway.yml up -d
```

### Verifying Everything Works

Run these checks in order:

```bash
# 1. Check gateway is running on port 18789
ss -ltnp | grep 18789
# Expected: LISTEN  0  128  127.0.0.1:18789  ...

# 2. Check gateway health endpoint
curl -sf http://127.0.0.1:18789/health
# Expected: {"status":"ok","version":"..."}

# 3. Check channels are connected (if Discord is configured)
openclaw channels status --probe
# Expected: discord: connected

# 4. Check plugins loaded
journalctl --user -u openclaw-gateway --no-pager | grep -i "plugin\|extension" | tail -20
# Should show: goal-loop, planner, researcher, trend-scout loaded
```

---

## How to: Connect Discord Bot

### Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click "New Application" and give it a name (e.g., "OpenClawd").
3. Go to the "Bot" tab.
4. Click "Reset Token" and copy the bot token. You will need this.
5. Under "Privileged Gateway Intents", enable:
   - **Message Content Intent** (required for reading messages)
   - **Server Members Intent** (optional but recommended)
6. Go to "OAuth2" > "URL Generator":
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Messages/View Channels`, `Use Slash Commands`, `Add Reactions`, `Embed Links`, `Attach Files`, `Read Message History`
7. Copy the generated URL and open it in a browser to invite the bot to your server.

### Step 2: Bot Token Setup

Add the bot token to your secrets:

```bash
# Add to secrets file
echo "DISCORD_BOT_TOKEN=your_token_here" >> ~/.openclaw/.secrets.env
```

Or set it in the main config (`~/.openclaw/openclaw.json`):

```json5
{
  discord: {
    token: "YOUR_BOT_TOKEN",
    accountId: "YOUR_BOT_USER_ID",
    policy: "allowlist",
    allowlist: ["YOUR_DISCORD_USER_ID"],
  },
}
```

### Step 3: Configuration in openclaw.json

Add Discord channel bindings to route messages to agents:

```json5
{
  bindings: [
    {
      agentId: "main",
      match: {
        channel: "discord",
        peer: {
          id: "YOUR_DISCORD_CHANNEL_ID",
        },
      },
    },
  ],
}
```

**How to get your channel ID:**

1. In Discord, go to Settings > Advanced > enable Developer Mode.
2. Right-click any channel and select "Copy Channel ID".

### Step 4: Testing the Connection

Restart the gateway to pick up the new config:

```bash
systemctl --user restart openclaw-gateway
```

Check connection:

```bash
# Verify Discord connection
openclaw channels status --probe

# Expected output:
# discord
#   Status: connected
#   Bot: OpenClawd#1234
#   Guilds: 1
```

Now send a message in your bound Discord channel. The bot should respond.

### Step 5: Setting Up Exec Approvals

Exec approvals provide a human-in-the-loop safety gate for shell commands. When the agent wants to run a command via the `exec` tool, it can be configured to ask for approval first via Discord buttons.

```json5
{
  discord: {
    // ... token, accountId, policy ...

    execApprovals: {
      enabled: true,
      approvers: ["YOUR_DISCORD_USER_ID"],
    },
  },
}
```

When enabled, the bot sends an embed with **Approve** / **Reject** buttons before executing any shell command. Only users in the `approvers` list can click the buttons.

---

## How to: Run Your First Autonomous Goal

### What is a Goal Loop?

The goal loop is an autonomous agent cycle that works toward a defined objective without continuous human supervision. It operates like this:

```
Start Goal
    |
    v
 [Iterate] ──> Agent performs one turn of work (shell, files, git, etc.)
    |
    v
 Budget OK? ──No──> Stop (budget_exceeded)
    |
   Yes
    |
    v
 Evaluate? ──No──> Back to [Iterate]
    |
   Yes
    |
    v
 [Evaluate] ──> Separate LLM scores progress 0-100 against criteria
    |
    v
 Score >= 95? ──Yes──> Stop (completed)
    |
   No
    |
    v
 Stalled? ──Yes──> Stop (stall detected)
    |
   No
    |
    v
 Quality Gate? ──Yes──> Pause (awaiting approval)
    |
   No
    |
    v
 Back to [Iterate]
```

**Key concepts:**

- **Iterations**: Each iteration is a single agent turn with full tool access (shell commands, file I/O, git, etc.)
- **Evaluations**: Separate LLM calls that score progress 0-100 against your acceptance criteria
- **Stall detection**: If consecutive evaluation scores show less than 5 points of progress, the goal stops automatically
- **Budget controls**: Hard limits on iterations, tokens, wall-clock time, and provider usage
- **Quality gates**: Optional human checkpoints at specific iteration numbers

### Starting a Goal via CLI

The CLI command is `openclaw goal start`. Here is a minimal example:

```bash
openclaw goal start \
  --goal "Create a Python script that fetches weather data from OpenWeatherMap API" \
  --criteria "Script accepts city name as argument" \
  --criteria "Outputs temperature, humidity, and description" \
  --criteria "Handles API errors gracefully" \
  --criteria "Includes usage instructions in README"
```

With full budget controls:

```bash
openclaw goal start \
  --goal "Build a REST API with Express.js that manages a todo list" \
  --criteria "CRUD endpoints for todos (GET, POST, PUT, DELETE)" \
  --criteria "Input validation with proper error responses" \
  --criteria "Persistence to a JSON file" \
  --criteria "Unit tests with at least 80% coverage" \
  --budget-iterations 30 \
  --budget-tokens 500000 \
  --budget-time 2h \
  --eval-every 3 \
  --eval-model "gpt-4o" \
  --stall-threshold 3 \
  --quality-gate 10 \
  --quality-gate 20 \
  --notify-channel discord \
  --notify-to "YOUR_DISCORD_CHANNEL_ID"
```

Expected output:

```json
{ "ok": true, "goalId": "a1b2c3d4", "status": "running" }
```

### Starting a Goal via Discord

If you have the goal-skill extension installed, you can start goals via natural language in Discord:

```
@OpenClawd start a goal: Create a snake game in HTML/CSS/JS.
Criteria: playable in browser, score tracking, game over screen.
Budget: 20 iterations, 1 hour.
```

The agent will parse your request and invoke `openclaw goal start` with the appropriate parameters.

### Monitoring Progress

**Safe method -- read the state file directly:**

```bash
# Show the most recent goal
cat ~/.openclaw/goal-loop/goals.json | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const goals = Object.values(d.goals);
    const latest = goals.sort((a,b) => b.createdAtMs - a.createdAtMs)[0];
    console.log(JSON.stringify({
      id: latest.id,
      goal: latest.goal,
      status: latest.status,
      iterations: latest.usage.iterations + '/' + latest.budget.maxIterations,
      lastScore: latest.lastEvaluation?.progressScore ?? 'N/A',
      stopReason: latest.stopReason
    }, null, 2));
  "
```

Example output:

```json
{
  "id": "a1b2c3d4",
  "goal": "Build a REST API with Express.js that manages a todo list",
  "status": "running",
  "iterations": "12/30",
  "lastScore": 65,
  "stopReason": null
}
```

**List all goals (with timeout for safety):**

```bash
timeout 5 openclaw goal list 2>&1
```

Example output:

```json
{
  "ok": true,
  "goals": [
    {
      "id": "a1b2c3d4",
      "goal": "Build a REST API...",
      "status": "running",
      "iterations": 12,
      "maxIterations": 30,
      "lastScore": 65,
      "isRunning": true
    }
  ]
}
```

**WARNING:** Never run `openclaw goal status <id>` directly -- it can hang and freeze your session. Always read the file directly or use `timeout`.

### Understanding Evaluations and Scores

Every N iterations (default: 3), the evaluator runs a separate LLM call that produces:

| Field                 | Type           | Description                                           |
| --------------------- | -------------- | ----------------------------------------------------- |
| `progressScore`       | number (0-100) | Overall completion percentage                         |
| `assessment`          | string         | Brief text assessment of current state                |
| `criteriaStatus`      | array          | Per-criterion `{criterion, met, notes}` objects       |
| `shouldContinue`      | boolean        | Whether the agent should keep iterating               |
| `suggestedNextAction` | string         | Specific recommendation for what the agent should try |

Example evaluation result (from goals.json):

```json
{
  "progressScore": 72,
  "assessment": "API endpoints are functional. Missing unit tests and input validation.",
  "criteriaStatus": [
    { "criterion": "CRUD endpoints for todos", "met": true, "notes": "All 4 endpoints working" },
    { "criterion": "Input validation", "met": false, "notes": "No validation middleware yet" },
    { "criterion": "JSON file persistence", "met": true },
    { "criterion": "Unit tests with 80% coverage", "met": false, "notes": "No tests written" }
  ],
  "shouldContinue": true,
  "suggestedNextAction": "Add express-validator middleware and write jest tests."
}
```

**Score thresholds:**

- 0-25: Early progress, foundational work
- 25-50: Core functionality partially implemented
- 50-75: Most features working, missing polish/tests
- 75-95: Refinement phase
- 95+: Goal considered complete, loop stops automatically

### Budget Controls Explained

Every goal has four budget dimensions:

| Budget Parameter             | CLI Flag                         | Default | Description                                             |
| ---------------------------- | -------------------------------- | ------- | ------------------------------------------------------- |
| **Max Iterations**           | `--budget-iterations <n>`        | 20      | Hard cap on total agent turns                           |
| **Max Tokens**               | `--budget-tokens <n>`            | 300000  | Total input + output tokens across all iterations       |
| **Max Time**                 | `--budget-time <duration>`       | 2h      | Wall-clock time limit (supports `ms`, `s`, `m`, `h`)    |
| **Provider Usage Threshold** | `--provider-usage-threshold <n>` | 80      | Stop if provider API usage exceeds this % of rate limit |

When any budget is exceeded, the goal transitions to `budget_exceeded` status. You can resume with additional budget:

```bash
openclaw goal resume a1b2c3d4 \
  --add-iterations 10 \
  --add-tokens 100000 \
  --add-time 1h
```

**Evaluation controls:**

| Parameter              | CLI Flag                | Default | Description                                        |
| ---------------------- | ----------------------- | ------- | -------------------------------------------------- |
| **Eval Every**         | `--eval-every <n>`      | 3       | Run evaluator every N iterations                   |
| **Eval Model**         | `--eval-model <ref>`    | (same)  | Model for evaluator (can differ from worker model) |
| **Stall Threshold**    | `--stall-threshold <n>` | 3       | Flat evaluations before stall detection triggers   |
| **Min Progress Delta** | (hardcoded)             | 5       | Minimum score change between evals to avoid stall  |
| **Error Limit**        | (hardcoded)             | 3       | Consecutive errors before circuit breaker trips    |

**Quality gates** pause the goal at specified iterations for human approval:

```bash
# Pause at iteration 10 and 20 for manual review
openclaw goal start \
  --goal "..." \
  --quality-gate 10 \
  --quality-gate 20
```

When a quality gate fires, the goal moves to `paused` status. Approve or reject via CLI:

```bash
# Approve -- resume execution
openclaw goal approve a1b2c3d4

# Reject -- stop the goal
openclaw goal reject a1b2c3d4
```

### Reading Goal Results

When a goal completes, examine the final state:

```bash
cat ~/.openclaw/goal-loop/goals.json | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const goal = d.goals['YOUR_GOAL_ID'];
    if (!goal) { console.log('Goal not found'); process.exit(1); }
    console.log('Status:', goal.status);
    console.log('Iterations:', goal.usage.iterations);
    console.log('Final Score:', goal.lastEvaluation?.progressScore);
    console.log('Assessment:', goal.lastEvaluation?.assessment);
    console.log('Criteria:');
    (goal.lastEvaluation?.criteriaStatus || []).forEach(c => {
      console.log('  ', c.met ? '[MET]' : '[NOT MET]', c.criterion, c.notes ? '-- ' + c.notes : '');
    });
    if (goal.stopReason) console.log('Stop Reason:', goal.stopReason);
  "
```

Example output for a completed goal:

```
Status: completed
Iterations: 18
Final Score: 98
Assessment: All acceptance criteria met. API is fully functional with tests.
Criteria:
  [MET] CRUD endpoints for todos (GET, POST, PUT, DELETE)
  [MET] Input validation with proper error responses
  [MET] Persistence to a JSON file
  [MET] Unit tests with at least 80% coverage -- Coverage at 87%
```

Check iteration logs for detailed work history:

```bash
# Iteration log is a JSONL file
cat ~/.openclaw/goal-loop/a1b2c3d4-iterations.jsonl | \
  node -e "
    require('readline').createInterface({input:process.stdin}).on('line', l => {
      const r = JSON.parse(l);
      console.log('Iteration', r.iteration, '(' + r.status + '):', (r.summary || r.error || '').slice(0, 120));
    });
  "
```

### Goal Status Reference

| Status            | Meaning                                  | Can Resume?    |
| ----------------- | ---------------------------------------- | -------------- |
| `pending`         | Created, not yet started                 | --             |
| `running`         | Actively iterating                       | --             |
| `evaluating`      | Running progress evaluation              | --             |
| `paused`          | Waiting for quality gate approval        | Approve/Reject |
| `completed`       | Score reached 95+ or evaluator said stop | No             |
| `budget_exceeded` | A budget limit was hit                   | Yes            |
| `stopped`         | Manually stopped                         | Yes            |
| `failed`          | Unrecoverable error                      | Yes            |

---

## How to: Use the Planner for Complex Tasks

### When to Use Planner vs Goal Loop

Use this decision matrix to choose the right tool:

| Factor                         | Goal Loop                    | Planner                                 |
| ------------------------------ | ---------------------------- | --------------------------------------- |
| **Task complexity**            | Simple, single-focus         | Multi-step, multiple components         |
| **Parallelism**                | Sequential iterations        | Parallel worker agents                  |
| **Dependencies between steps** | No explicit dependency model | DAG with explicit task dependencies     |
| **Failure handling**           | Retry on error, stall detect | Per-task retries, automatic replanning  |
| **Evaluation**                 | Periodic during execution    | Final evaluation after all tasks        |
| **Best for**                   | "Build X" (single artifact)  | "Build X, Y, Z; X depends on Y"         |
| **Agent isolation**            | Single agent session         | Separate agent per task                 |
| **Budget model**               | Iterations + tokens          | Agent turns + tokens (across all tasks) |

**Examples:**

- **Goal Loop**: "Write a Python script that does X" / "Create a single-page website" / "Fix bug #123"
- **Planner**: "Build a full-stack app with frontend, backend, database, and deploy" / "Refactor 5 modules and update their tests" / "Research, design, and implement a feature"

### Starting a Plan via CLI

Basic plan:

```bash
openclaw planner start \
  --goal "Build a full-stack todo application" \
  --criteria "React frontend with add/edit/delete" \
  --criteria "Express API with REST endpoints" \
  --criteria "SQLite database with migrations" \
  --criteria "Docker Compose for local development" \
  --criteria "README with setup instructions"
```

With full options:

```bash
openclaw planner start \
  --goal "Build a full-stack todo application" \
  --criteria "React frontend with add/edit/delete" \
  --criteria "Express API with REST endpoints" \
  --criteria "SQLite database with migrations" \
  --criteria "Docker Compose for local development" \
  --criteria "README with setup instructions" \
  --max-turns 50 \
  --max-tokens 800000 \
  --max-time 4h \
  --concurrency 3 \
  --max-retries 2 \
  --replan-threshold 40 \
  --notify-channel discord \
  --notify-to "YOUR_DISCORD_CHANNEL_ID"
```

Start from a PRD file:

```bash
openclaw planner start \
  --goal "placeholder" \
  --from-prd ~/.openclaw/prds/todo-app.md \
  --max-turns 60
```

The `--from-prd` flag extracts the goal and acceptance criteria automatically from the PRD's markdown structure (looks for `## Goal` and `## Acceptance Criteria` headings).

Expected output:

```json
{ "ok": true, "planId": "e5f6g7h8", "status": "planning" }
```

### Understanding the DAG

The planner works in phases:

```
Start Plan
    |
    v
[PLANNING] ──> Planner agent decomposes goal into 5-20 tasks with dependencies
    |
    v
[EXECUTING] ──> Scheduler dispatches "ready" tasks to worker agents in parallel
    |               - A task is "ready" when all its dependencies are completed
    |               - Up to maxConcurrency workers run simultaneously
    |               - Each worker gets the task description + context from completed deps
    |
    v
[REPLANNING] ──> If batch failure rate > replanThreshold%, replanner revises the DAG
    |               - Failed tasks get new approaches
    |               - New tasks may be added
    |               - Completed tasks are preserved
    |
    v
[EVALUATING] ──> Final evaluation scores all work against acceptance criteria
    |
    v
[DONE] ──> Plan complete (or failed/stopped)
```

**Task states in the DAG:**

| Task Status | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `pending`   | Not yet ready (dependencies not met)                 |
| `ready`     | All dependencies complete, waiting for a worker slot |
| `running`   | Currently being executed by a worker agent           |
| `completed` | Successfully finished                                |
| `failed`    | Worker returned error (may be retried)               |
| `skipped`   | Skipped during replanning (replaced by new tasks)    |

Example DAG (as seen in `planner tasks` output):

```
Plan: Build a full-stack todo application [e5f6g7h8]
Status: running | Phase: executing | Revision: 1
Turns: 18/50

--- COMPLETED (3) ---
  [t1] Set up project structure (setup)
  [t2] Create SQLite schema and migrations (backend) [deps: t1] -- Schema created with todos table
  [t3] Build Express REST API (backend) [deps: t2] -- CRUD endpoints for /api/todos

--- RUNNING (2) ---
  [t4] Build React frontend (frontend) [deps: t1] -- In progress: components created
  [t5] Write Dockerfile and docker-compose.yml (devops) [deps: t3]

--- PENDING (1) ---
  [t6] Write README and setup docs (docs) [deps: t4,t5]
```

### Monitoring Plan Progress

**Safe method -- read the state file directly:**

```bash
cat ~/.openclaw/planner/plans.json | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const plans = Object.values(d.plans);
    const latest = plans.sort((a,b) => b.createdAtMs - a.createdAtMs)[0];
    const completed = latest.tasks.filter(t => t.status === 'completed').length;
    console.log(JSON.stringify({
      id: latest.id,
      goal: latest.goal,
      status: latest.status,
      phase: latest.currentPhase,
      tasks: completed + '/' + latest.tasks.length + ' completed',
      turns: latest.usage.agentTurns + '/' + latest.budget.maxAgentTurns,
      finalScore: latest.finalEvaluation?.score ?? 'N/A',
      stopReason: latest.stopReason
    }, null, 2));
  "
```

**View the task board:**

```bash
timeout 10 openclaw planner tasks e5f6g7h8 2>&1
```

This outputs a kanban-style view grouped by status (see example above).

**WARNING:** Like the goal loop, `openclaw planner status <id>` can hang. Always use timeout or read the file directly.

### Handling Failures and Replanning

The planner has automatic failure handling:

1. **Per-task retries**: Each task can be retried up to `maxRetries` times (default: 2). If a worker fails, the scheduler retries with the error context.

2. **Automatic replanning**: If the failure rate in a batch exceeds `replanThreshold` (default: 40%), the orchestrator enters `replanning` phase:
   - A replanner agent reviews what failed and why
   - It revises the task DAG: may restructure, split, or replace failed tasks
   - Completed tasks are preserved
   - The `planRevision` counter increments

3. **Manual resume**: If a plan stops or fails entirely:

```bash
# Resume with additional budget
openclaw planner resume e5f6g7h8 \
  --add-turns 20 \
  --add-tokens 200000 \
  --add-time 2h
```

### Reading Plan Results

When a plan completes, the final evaluation provides an overall score:

```bash
cat ~/.openclaw/planner/plans.json | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const plan = d.plans['YOUR_PLAN_ID'];
    if (!plan) { console.log('Plan not found'); process.exit(1); }
    console.log('Status:', plan.status);
    console.log('Phase:', plan.currentPhase);
    console.log('Revision:', plan.planRevision);
    console.log('Turns Used:', plan.usage.agentTurns + '/' + plan.budget.maxAgentTurns);
    console.log('Tasks:', plan.tasks.filter(t=>t.status==='completed').length + '/' + plan.tasks.length, 'completed');
    if (plan.finalEvaluation) {
      console.log('Score:', plan.finalEvaluation.score + '/100');
      console.log('Assessment:', plan.finalEvaluation.assessment);
      (plan.finalEvaluation.criteriaStatus || []).forEach(c => {
        console.log('  ', c.met ? '[MET]' : '[NOT MET]', c.criterion);
      });
    }
    if (plan.stopReason) console.log('Stop Reason:', plan.stopReason);
  "
```

### Planner Budget Controls

| Parameter            | CLI Flag                 | Default | Description                             |
| -------------------- | ------------------------ | ------- | --------------------------------------- |
| **Max Agent Turns**  | `--max-turns <n>`        | 30      | Total turns across all tasks + planning |
| **Max Tokens**       | `--max-tokens <n>`       | 500000  | Total token budget                      |
| **Max Time**         | `--max-time <duration>`  | 2h      | Wall-clock limit                        |
| **Max Concurrency**  | `--concurrency <n>`      | 3       | Parallel worker agents                  |
| **Max Retries**      | `--max-retries <n>`      | 2       | Per-task retry limit                    |
| **Replan Threshold** | `--replan-threshold <n>` | 40      | Failure % that triggers replanning      |

---

## How to: Research and Generate PRDs

The Researcher extension implements a multi-round research and interview flow that produces a Product Requirement Document (PRD). This PRD can then be used to launch a planner execution.

### The Research Flow

```
Start Research
    |
    v
[RESEARCHING] ──> Research agent investigates the topic
    |               - Web searches, code analysis, market research
    |               - Generates questions for the user
    |
    v
[INTERVIEWING] ──> Questions sent to user (via Discord buttons)
    |               - User selects answers from options
    |               - Or skips (defaults are used)
    |               - Or times out (defaults are used)
    |
    v
More rounds? ──Yes──> Back to [RESEARCHING] with answers as context
    |
   No
    |
    v
[SYNTHESIZING] ──> Synthesizer agent generates PRD from all research
    |
    v
[READY] ──> PRD generated, awaiting user "go" to launch planner
    |
    v
[LAUNCHED] ──> Planner started from PRD
```

### Starting a Research Session

```bash
openclaw researcher start \
  --goal "Build a SaaS invoicing platform for freelancers" \
  --max-rounds 3 \
  --max-turns 20 \
  --max-tokens 200000 \
  --max-time 30m \
  --notify-channel discord \
  --notify-to "YOUR_DISCORD_USER_ID"
```

Expected output:

```json
{ "ok": true, "researchId": "x1y2z3w4", "status": "researching" }
```

### The Interview Flow (Discord Buttons)

When the researcher has gathered initial information, it sends interview questions to the specified Discord user via DM. The message appears as an embed with:

- **Question fields**: Each question with selectable options as buttons
- **Submit button**: Sends your answers back to the researcher
- **Skip button**: Uses default values (the agent proceeds without your input)

Example Discord embed:

```
Research Interview
3/3 questions answered. Click options or "Submit" when ready.

Question 1: What is your target market?
  1. Solo freelancers
  2. Small agencies (2-10 people)
  3. Enterprise freelance teams

Question 2: What payment processor do you prefer?
  1. Stripe
  2. PayPal
  3. Both

Question 3: What is your deployment preference?
  1. Cloud (AWS/GCP)
  2. Self-hosted
  3. Serverless

[Submit Answers] [Skip (use defaults)]
```

After each round, the researcher runs another research phase with your answers as context, potentially asking more refined follow-up questions.

### Research Rounds and Evaluation

Each research round consists of:

1. **Research phase**: The agent browses the web, analyzes existing solutions, and gathers information
2. **Interview phase**: Questions are sent to the user for domain-specific input
3. **Integration**: Answers are fed back into the next research round

The number of rounds is controlled by `--max-rounds` (default: 3). More rounds produce more thorough PRDs but consume more budget.

### Generated PRD Format

The synthesizer produces a markdown PRD saved to `~/.openclaw/prds/`:

```markdown
# Product Requirement Document: SaaS Invoicing Platform

## Goal

Build a SaaS invoicing platform for freelancers that simplifies
billing, tracks payments, and generates professional invoices.

## Acceptance Criteria

1. User registration and authentication (email + OAuth)
2. Invoice creation with customizable templates
3. Recurring invoice support
4. Payment integration with Stripe
5. Dashboard with payment status and analytics
6. PDF export of invoices
7. Email notifications for overdue payments

## Target Users

Solo freelancers and small agencies...

## Technical Architecture

- Frontend: React + TypeScript
- Backend: Node.js + Express
- Database: PostgreSQL
- Payments: Stripe API
  ...

## User Stories

...

## Non-Functional Requirements

...
```

### Viewing a Generated PRD

```bash
# List all research sessions
timeout 5 openclaw researcher list 2>&1

# View the generated PRD for a specific research
timeout 5 openclaw researcher view x1y2z3w4 2>&1
```

Or read the PRD file directly:

```bash
cat ~/.openclaw/prds/*.md | head -100
```

### Launching a Plan from a PRD

Once a PRD is generated, you can launch a planner execution from it:

```bash
openclaw planner start \
  --goal "placeholder" \
  --from-prd ~/.openclaw/prds/invoicing-platform.md \
  --max-turns 60 \
  --concurrency 3 \
  --notify-channel discord \
  --notify-to "YOUR_DISCORD_CHANNEL_ID"
```

The `--from-prd` flag extracts the goal from the `## Goal` heading and the criteria from the `## Acceptance Criteria` section automatically.

---

## How to: Monitor Trends

The Trend Scout extension monitors Hacker News, Reddit, and GitHub for trending topics relevant to your interests.

### How Trend Scout Works

```
[Fetch] ──> Pulls items from HN, Reddit, GitHub (configurable sources)
    |
    v
[Filter] ──> Filters by relevance to your topics
    |
    v
[Deduplicate + Rank] ──> Removes duplicates, scores by engagement
    |
    v
[Analyze] ──> LLM summarizes trends, extracts insights and opportunities
    |
    v
[Store] ──> Writes digest to memory (for agent context) and JSON archive
    |
    v
[Notify] ──> Optional Discord notification with summary
```

### Configuring Trend Topics

Create or edit `~/.openclaw/dashboard/trend-scout.json`:

```json
{
  "topics": [
    "ai",
    "llm",
    "agents",
    "typescript",
    "node",
    "react",
    "startup",
    "saas",
    "developer tools",
    "automation"
  ],
  "subreddits": [
    "programming",
    "typescript",
    "node",
    "reactjs",
    "MachineLearning",
    "LocalLLaMA",
    "SideProject"
  ],
  "languages": ["typescript", "python", "rust", "go"],
  "itemsPerSource": 30,
  "minScore": 10,
  "hoursBack": 24
}
```

**Configuration fields:**

| Field            | Type     | Default     | Description                          |
| ---------------- | -------- | ----------- | ------------------------------------ |
| `topics`         | string[] | (see above) | Keywords to track across all sources |
| `subreddits`     | string[] | (see above) | Reddit subreddits to monitor         |
| `languages`      | string[] | (see above) | GitHub trending languages            |
| `itemsPerSource` | number   | 30          | Max items to fetch per source        |
| `minScore`       | number   | 10          | Minimum upvotes/stars threshold      |
| `hoursBack`      | number   | 24          | Time window for items                |

**Optional Reddit API credentials** (for higher rate limits):

```json
{
  "reddit": {
    "clientId": "YOUR_REDDIT_CLIENT_ID",
    "clientSecret": "YOUR_REDDIT_CLIENT_SECRET",
    "userAgent": "openclawd-trend-scout/1.0"
  }
}
```

### Running Manual Scans

Trend Scout can be triggered manually or via cron. For manual runs, use the gateway's trend-scout endpoint or run the scan script:

```bash
# If a scan script or CLI command is available:
node ~/openclaw/extensions/trend-scout/src/scout-service.ts

# Or via the dashboard (see Dashboard section)
```

### Understanding Trend Digests

Each scan produces a `TrendDigest` object saved as JSON and markdown:

**JSON digest** (`~/.openclaw/dashboard/trend-digests/YYYY-MM-DD.json`):

```json
{
  "date": "2026-02-05",
  "generatedAt": 1738764800000,
  "topics": ["ai", "llm", "typescript"],
  "items": [
    {
      "source": "hackernews",
      "title": "New TypeScript 6.0 Features",
      "url": "https://...",
      "score": 342,
      "comments": 128,
      "timestamp": 1738750000000,
      "tags": ["typescript"]
    },
    {
      "source": "reddit",
      "title": "Building AI Agents with LangGraph",
      "url": "https://...",
      "score": 89,
      "comments": 45,
      "author": "user123",
      "timestamp": 1738740000000,
      "description": "A practical guide to...",
      "tags": ["ai", "agents"]
    },
    {
      "source": "github",
      "title": "awesome-llm-tools",
      "url": "https://github.com/...",
      "score": 1200,
      "timestamp": 1738730000000,
      "description": "Curated list of LLM development tools",
      "tags": ["llm", "developer tools"]
    }
  ],
  "summary": "Today's trends show strong interest in TypeScript 6.0...",
  "insights": [
    "TypeScript 6.0 release driving significant community discussion",
    "AI agent frameworks maturing rapidly with new orchestration patterns",
    "Growing interest in local LLM deployment for privacy-sensitive apps"
  ],
  "opportunities": [
    "Create a migration guide for TypeScript 6.0",
    "Build an agent orchestration comparison tool",
    "Develop a local LLM hosting tutorial"
  ]
}
```

**Markdown digest** (written to agent memory at `~/.openclaw/workspace/memory/trends-YYYY-MM-DD.md`):

This file is automatically indexed by the agent's memory system, making trend context available in future conversations.

### Scout Proposals Workflow (Discord Approval Buttons)

When Trend Scout identifies an actionable opportunity, it can create a **Scout Proposal** -- a structured improvement suggestion sent to Discord with interactive buttons.

The proposal appears in Discord as an embed with three buttons:

- **Approve**: Automatically starts a planner execution to implement the proposal
- **Reject**: Marks the proposal as rejected
- **More Info**: Shows the full proposal text (ephemeral, only visible to you)

Proposals are stored in `~/.openclaw/scout-proposals/registry.json`:

```json
{
  "proposals": [
    {
      "id": "sp-abc123",
      "title": "Add TypeScript 6.0 Migration Guide",
      "problem": "Users upgrading to TS 6.0 need guidance on breaking changes",
      "solution": "Create a comprehensive migration guide with code examples",
      "criteria": [
        "Covers all breaking changes",
        "Includes before/after code examples",
        "Published to docs site"
      ],
      "effort": "medium",
      "impact": "high",
      "risk": "low",
      "files": "docs/migration/ts6.md",
      "status": "pending",
      "createdAt": "2026-02-05T12:00:00Z"
    }
  ]
}
```

When you click **Approve**, the system:

1. Updates the proposal status to `approved`
2. Spawns `openclaw planner start` with the proposal's goal and criteria
3. The planner executes autonomously and sends notifications on completion

### Memory Integration

Trend digests are written to the agent workspace's memory directory. This means:

1. The main agent (and any agent with memory search enabled) can reference recent trends
2. When asked "What's trending in AI?", the agent searches its memory and finds recent digests
3. Scout proposals filed in `memory/scout-proposals/` are also searchable

---

## How to: Create Custom Agents

### Standalone Agent Setup (Step-by-Step)

This creates a single agent from scratch, bound to a Discord channel.

#### Step 1: Create Workspace and Sessions Directories

```bash
# Choose your agent ID (lowercase, hyphens only)
AGENT_ID="my-helper"

# Create directories
mkdir -p ~/.openclaw/workspace-${AGENT_ID}
mkdir -p ~/.openclaw/agents/${AGENT_ID}/sessions
```

#### Step 2: Write the SOUL.md

The `SOUL.md` file defines the agent's personality, instructions, and capabilities.

```bash
cat > ~/.openclaw/workspace-${AGENT_ID}/SOUL.md << 'EOF'
# MyHelper

You are MyHelper, a focused technical assistant specialized in code review and debugging.

## Core Philosophy

- Be direct and concise in responses
- Always explain the "why" behind suggestions
- Prefer minimal, targeted fixes over large refactors
- When in doubt, ask clarifying questions

## Your Responsibilities

### 1. Code Review

- Analyze code for bugs, security issues, and performance problems
- Suggest improvements with clear reasoning
- Provide before/after code examples

### 2. Debugging

- Help trace bugs through code paths
- Suggest diagnostic steps in order of likelihood
- Explain root causes, not just symptoms

### 3. Best Practices

- Guide users toward idiomatic patterns
- Recommend tools and libraries when appropriate
- Flag potential maintenance issues

## Tools You Use

- File read/write for examining and modifying code
- Exec for running tests, linters, and build commands
- Web search for looking up documentation and examples

## Output Style

- Use code blocks with language annotations
- Keep explanations under 500 words unless asked for detail
- Use bullet points for multi-step instructions
- Include relevant links when referencing docs
EOF
```

#### Step 3: Add Agent to Configuration

Edit `~/.openclaw/openclaw.json` and add the agent to the `agents.list` array:

```json5
{
  agents: {
    list: [
      // ... existing agents ...
      {
        id: "my-helper",
        workspace: "/home/YOUR_USER/.openclaw/workspace-my-helper",
        identity: {
          name: "MyHelper",
          emoji: "🔧",
        },
      },
    ],
  },
}
```

#### Step 4: Add a Channel Binding

Still in `~/.openclaw/openclaw.json`, add a binding to route a Discord channel to this agent:

```json5
{
  bindings: [
    // ... existing bindings ...
    {
      agentId: "my-helper",
      match: {
        channel: "discord",
        peer: {
          id: "YOUR_DISCORD_CHANNEL_ID",
        },
      },
    },
  ],
}
```

#### Step 5: Restart the Gateway

```bash
systemctl --user restart openclaw-gateway
```

#### Step 6: Test Your Agent

1. Send a message in the bound Discord channel
2. The agent should respond with its configured personality
3. Check gateway logs for any errors:

```bash
journalctl --user -u openclaw-gateway -f
```

### Agent Pack Creation

For creating a group of related agents (like a team), use the Agent Packs system.

#### Step 1: Define the Pack

Edit `extensions/agent-packs/src/packs-registry.ts`:

```typescript
export const PACKS: PackDefinition[] = [
  // ... existing packs ...
  {
    id: "my-team",
    name: "My Team",
    description: "Custom team of specialized agents",
    agents: [
      {
        id: "alice-analyst",
        name: "Alice",
        role: "Data Analyst",
        soulFile: "my-team/alice-analyst.md",
        tools: ["file-read", "file-write", "exec", "web-search"],
      },
      {
        id: "bob-builder",
        name: "Bob",
        role: "Implementation Specialist",
        soulFile: "my-team/bob-builder.md",
        tools: ["file-read", "file-write", "exec"],
      },
    ],
  },
];
```

#### Step 2: Create Soul Files

```bash
mkdir -p ~/openclaw/extensions/agent-packs/packs/my-team

cat > ~/openclaw/extensions/agent-packs/packs/my-team/alice-analyst.md << 'EOF'
# Alice -- Data Analyst

You are Alice, a data analyst who excels at turning raw data into actionable insights.

## Core Philosophy
- Data drives decisions
- Visualize whenever possible
- Always question assumptions

## Responsibilities
- Analyze datasets and produce reports
- Create charts and visualizations
- Identify trends and anomalies
- Write SQL queries and data pipelines

## Tools
- File read/write for data files
- Exec for running Python/SQL scripts
- Web search for methodology references
EOF

cat > ~/openclaw/extensions/agent-packs/packs/my-team/bob-builder.md << 'EOF'
# Bob -- Implementation Specialist

You are Bob, a hands-on developer who turns specifications into working code.

## Core Philosophy
- Ship early, iterate fast
- Test everything
- Keep it simple

## Responsibilities
- Write clean, tested code
- Set up project scaffolding
- Implement features from specs
- Debug and fix issues

## Tools
- File read/write for source code
- Exec for builds, tests, and deploys
EOF
```

#### Step 3: Register Agents in Config

Add each agent to `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    list: [
      // ... existing agents ...
      {
        id: "alice-analyst",
        workspace: "/home/YOUR_USER/.openclaw/workspace-alice-analyst",
        identity: { name: "Alice", emoji: "📊" },
      },
      {
        id: "bob-builder",
        workspace: "/home/YOUR_USER/.openclaw/workspace-bob-builder",
        identity: { name: "Bob", emoji: "🏗️" },
      },
    ],
  },
  bindings: [
    // ... existing bindings ...
    {
      agentId: "alice-analyst",
      match: { channel: "discord", peer: { id: "ALICE_CHANNEL_ID" } },
    },
    {
      agentId: "bob-builder",
      match: { channel: "discord", peer: { id: "BOB_CHANNEL_ID" } },
    },
  ],
}
```

#### Step 4: Create Directories and Copy Souls

```bash
# Session directories
mkdir -p ~/.openclaw/agents/alice-analyst/sessions
mkdir -p ~/.openclaw/agents/bob-builder/sessions

# Workspaces
mkdir -p ~/.openclaw/workspace-alice-analyst
mkdir -p ~/.openclaw/workspace-bob-builder

# Copy soul files
cp ~/openclaw/extensions/agent-packs/packs/my-team/alice-analyst.md \
   ~/.openclaw/workspace-alice-analyst/SOUL.md
cp ~/openclaw/extensions/agent-packs/packs/my-team/bob-builder.md \
   ~/.openclaw/workspace-bob-builder/SOUL.md
```

#### Step 5: Build and Restart

```bash
cd ~/openclaw && pnpm build
systemctl --user restart openclaw-gateway
```

### Writing a SOUL.md

The SOUL.md is the most important file for an agent. It defines personality, capabilities, and behavioral boundaries.

**Best practices:**

1. **Start with identity**: A clear one-line statement of who the agent is
2. **Define philosophy**: 3-5 core principles that guide all responses
3. **List responsibilities**: Specific tasks the agent handles
4. **Specify tools**: Which tools the agent uses and when
5. **Set output style**: Formatting preferences, tone, length guidelines
6. **Add constraints**: What the agent should NOT do

**Template:**

```markdown
# AgentName -- Role Title

You are AgentName, a [role] who [primary function]. You [key personality trait].

## Core Philosophy

- [Principle 1]
- [Principle 2]
- [Principle 3]

## Your Responsibilities

### 1. [Primary Responsibility]

- Specific duty
- Expected approach
- Quality standards

### 2. [Secondary Responsibility]

- Details...

## How You Work

- [Communication style]
- [Decision-making approach]
- [When to ask for clarification]

## Tools You Use

- File read/write: [when and why]
- Exec: [what commands, safety considerations]
- Web search: [what to search for]
- Browser: [when full browsing is needed]

## Output Style

- [Formatting preferences]
- [Tone and voice]
- [Length guidelines]

## Constraints

- [What NOT to do]
- [Boundaries and limitations]
- [Escalation criteria]
```

### Configuring Tools and Permissions

Available tools for agents:

| Tool         | Config Key   | Capability                | Risk Level |
| ------------ | ------------ | ------------------------- | ---------- |
| `file-read`  | `file-read`  | Read files from workspace | Low        |
| `file-write` | `file-write` | Write files to workspace  | Medium     |
| `exec`       | `exec`       | Execute shell commands    | High       |
| `web-search` | `web-search` | Search the internet       | Low        |
| `browser`    | `browser`    | Full Puppeteer automation | Medium     |

For agent packs, tools are specified in the pack registry:

```typescript
{
  id: "my-agent",
  name: "MyAgent",
  role: "...",
  soulFile: "...",
  tools: ["file-read", "file-write", "exec"],
}
```

### Multi-Agent Delegation Setup

Agents can spawn subagents to handle subtasks. Configure allowlists in `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    list: [
      {
        id: "alice-analyst",
        // ... identity, workspace ...
        subagents: {
          allowAgents: ["bob-builder"],
        },
      },
    ],
  },
}
```

With this configuration, Alice can delegate implementation tasks to Bob:

```
User -> Alice: "Analyze the sales data and build a dashboard"
Alice (thinking): I'll analyze the data, then delegate dashboard building to Bob
Alice -> sessions_spawn(agentId: "bob-builder", task: "Build a React dashboard showing...")
Bob runs, builds dashboard, saves files
Bob -> announces results to Alice
Alice -> User: "Analysis complete. Bob has built the dashboard at..."
```

**Visibility policies:**

- `spawned` (default): Agent can only communicate with subagents it spawned
- `unrestricted`: Agent can message any session (use with caution)

### Testing Your Agent

```bash
# 1. Verify agent is in config
cat ~/.openclaw/openclaw.json | grep -A5 '"id": "my-helper"'

# 2. Verify binding exists
cat ~/.openclaw/openclaw.json | grep -A5 '"agentId": "my-helper"'

# 3. Check session directory exists
ls -la ~/.openclaw/agents/my-helper/sessions/

# 4. Check SOUL.md is in place
cat ~/.openclaw/workspace-my-helper/SOUL.md | head -5

# 5. Restart gateway and watch logs
systemctl --user restart openclaw-gateway
journalctl --user -u openclaw-gateway -f

# 6. Send a test message in the bound Discord channel
# 7. Watch logs for any errors
```

---

## How to: Use the Dashboard

The OpenClawd Mission Control Dashboard is a local-first web application for monitoring and controlling all agent operations.

### Starting the Dashboard

```bash
cd ~/projects/openclawd-dashboard
npm run dev
# Open http://localhost:3000
```

The dashboard reads state directly from the filesystem (`~/.openclaw/`) and executes commands via the CLI/Gateway API. No external database is needed.

**IMPORTANT:** The dashboard is local-only. Never deploy it to Vercel or any public hosting.

### Command Center Overview

The main page (`/command`) is a unified Kanban board for all missions:

**5-Column Kanban Layout:**

| Column      | Status Mapping                                                    |
| ----------- | ----------------------------------------------------------------- |
| **Backlog** | `stopped` (resumable)                                             |
| **Active**  | `running`, `planning`, `executing`, `researching`, `synthesizing` |
| **Review**  | `interviewing`, `ready` (awaiting human input)                    |
| **Done**    | `completed`, `done`, `launched`                                   |
| **Failed**  | `failed`, `budget_exceeded`                                       |

Each mission card shows:

- Type icon (goal/plan/research)
- ID and title
- Progress bar
- Priority badge (Critical/High/Medium/Low)
- Score (if evaluated)
- Error indicator
- Time since last update

**Interactive Controls:**

- **"+ New" button**: Opens forms to start new goals, plans, or research sessions
- **Stop/Resume**: Action buttons on running/stopped missions
- **Auto-refresh**: 5-second polling when active missions exist

### Monitoring Goals and Plans

**Goal Detail** (`/goals/[id]`):

- Iteration timeline showing each agent turn
- Evaluation history with score charts
- Criteria status checklist (met/not met)
- Budget usage gauges

**Plan Detail** (`/plans/[id]`):

- **Phase Stepper**: Visual pipeline showing current phase (planning/executing/replanning/evaluating/done)
- **Task Board**: 6-column kanban (pending/ready/running/completed/failed/skipped)
- **Task DAG**: SVG dependency graph with status-colored nodes
- **Budget Gauges**: Agent turns, tokens, time usage bars
- **Criteria Checklist**: Final evaluation with met/unmet indicators

### Agent Management

The Agents page (`/agents`) shows:

- Full list of all configured agents
- Agent details: SOUL.md viewer, workspace info, session stats
- Binding information (which channels are routed to each agent)
- Recent tool calls

Agent Detail (`/agents/[id]`):

- Full agent configuration
- SOUL.md content
- Workspace files
- Session history
- Tool call log

### Analytics and Costs

The Analytics page (`/analytics`) provides:

- Daily usage charts (tokens consumed per day)
- Cost breakdown by provider and model
- Performance metrics (iterations per goal, turns per plan)
- Agent activity comparison

### Additional Pages

| Page       | URL           | Purpose                                  |
| ---------- | ------------- | ---------------------------------------- |
| PRDs       | `/prds`       | View generated PRDs rendered as markdown |
| Automation | `/automation` | Templates, webhooks, and chain rules     |
| Cron       | `/cron`       | Scheduled jobs management                |
| System     | `/system`     | Gateway config, plugin status            |
| Security   | `/security`   | Security settings, allowlists            |
| Trends     | `/trends`     | Trend Scout digests and analysis         |

### Keyboard Shortcuts

| Shortcut | Action               |
| -------- | -------------------- |
| `/`      | Global search        |
| `Cmd+K`  | Global search        |
| `g c`    | Go to Command Center |
| `g a`    | Go to Agents         |

---

## How to: Set Up Agent Packs

Agent Packs are pre-configured teams of agents designed to work together on specific domains.

### Available Packs and Their Purposes

| Pack ID            | Name               | Agents                                                  | Purpose                                              |
| ------------------ | ------------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| `content-creator`  | Content Creator    | Mia (Strategist), Blake (Scriptwriter), Jordan (Social) | Plan, script, and distribute content                 |
| `dev-team`         | Dev Team           | Marcus (Tech Lead), Elena (Reviewer), Sam (Docs)        | Code review, documentation, and technical leadership |
| `solopreneur`      | Solopreneur        | Claire (Assistant), Leo (Researcher), Harper (Outreach) | Executive assistance, research, and outreach         |
| `fitness-training` | Fitness & Training | Noah (Coach), Nina (Nutrition), Ethan (Accountability)  | Workout programs, nutrition, and accountability      |
| `health-wellness`  | Health & Wellness  | Olivia (Wellness), Mason (Sleep), Priya (Habits)        | Sleep optimization, habit building, wellness         |
| `finance-taxes`    | Finance & Taxes    | Sophia (Invoices), Liam (Expenses), Nora (Tax)          | Invoicing, expense tracking, and tax preparation     |

### Enabling/Disabling Packs

In `~/.openclaw/openclaw.json`:

```json5
{
  "agent-packs": {
    enabled: true,

    // Enable all packs
    enabledPacks: "all",

    // Or enable specific packs only
    // "enabledPacks": ["content-creator", "dev-team"],

    // Exclude specific packs
    disabledPacks: ["fitness-training", "health-wellness"],
  },
}
```

After changing pack configuration:

```bash
pnpm build
systemctl --user restart openclaw-gateway
```

### Customizing Agent Personalities

Each agent's personality is defined in a soul file under `extensions/agent-packs/packs/{pack-id}/`:

```
extensions/agent-packs/packs/
  content-creator/
    mia-strategist.md
    blake-scriptwriter.md
    jordan-social.md
  dev-team/
    marcus-techlead.md
    elena-reviewer.md
    sam-docs.md
  solopreneur/
    claire-assistant.md
    leo-researcher.md
    harper-outreach.md
  ...
```

To customize a pack agent's personality:

1. Edit the soul file in the pack directory:

```bash
vim ~/openclaw/extensions/agent-packs/packs/content-creator/mia-strategist.md
```

2. Copy the updated soul to the agent's workspace:

```bash
cp ~/openclaw/extensions/agent-packs/packs/content-creator/mia-strategist.md \
   ~/.openclaw/workspace-mia-strategist/SOUL.md
```

3. Restart the gateway:

```bash
systemctl --user restart openclaw-gateway
```

### Channel Bindings for Agents

Each pack agent should be bound to a dedicated Discord channel. Create a Discord category for the pack, then create channels for each agent:

**Discord server structure:**

```
[Content Creator]
  #mia-strategist
  #blake-scriptwriter
  #jordan-social

[Dev Team]
  #marcus-techlead
  #elena-reviewer
  #sam-docs
```

Add bindings in `~/.openclaw/openclaw.json`:

```json5
{
  bindings: [
    // Content Creator pack
    {
      agentId: "mia-strategist",
      match: { channel: "discord", peer: { id: "CHANNEL_ID_FOR_MIA" } },
    },
    {
      agentId: "blake-scriptwriter",
      match: { channel: "discord", peer: { id: "CHANNEL_ID_FOR_BLAKE" } },
    },
    {
      agentId: "jordan-social",
      match: { channel: "discord", peer: { id: "CHANNEL_ID_FOR_JORDAN" } },
    },
    // ... more bindings for other packs ...
  ],
}
```

Each agent reacts to messages with their configured emoji before processing, giving visual feedback about which agent is handling the request.

---

## Troubleshooting

### Common Errors and Fixes

#### "Config validation failed"

**Symptom:** Gateway refuses to start with config errors.

**Fix:** Validate your JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('$HOME/.openclaw/openclaw.json','utf8')); console.log('Valid JSON')"
```

Common issues:

- Trailing commas in JSON (use JSON5 format or remove them)
- Missing required fields (`gateway.auth.token`, `models.providers`)
- Invalid agent IDs (must be lowercase with hyphens)

#### "ECONNREFUSED 127.0.0.1:18789"

**Symptom:** CLI commands fail to connect to gateway.

**Fix:**

```bash
# Check if gateway is running
systemctl --user status openclaw-gateway

# Check if port is in use
ss -ltnp | grep 18789

# Restart if needed
systemctl --user restart openclaw-gateway

# Check logs for errors
journalctl --user -u openclaw-gateway --no-pager | tail -50
```

### Gateway Won't Start

**Check 1: Node.js version**

```bash
node --version
# Must be 22.x+
```

**Check 2: Dependencies installed**

```bash
cd ~/openclaw && pnpm install
```

**Check 3: Build is up to date**

```bash
cd ~/openclaw && pnpm build
```

**Check 4: Port not in use**

```bash
# Kill any stale gateway process
ss -ltnp | grep 18789
# If something is listening, find and stop it:
pkill -f "openclaw-gateway" || true
pkill -f "openclaw.mjs gateway" || true
```

**Check 5: Config file valid**

```bash
openclaw doctor
```

### Plugin Load Failures

**Symptom:** Extensions (goal-loop, planner, etc.) are not loading.

**Fix 1: Ensure plugins are enabled in config**

```bash
cat ~/.openclaw/openclaw.json | grep -A2 '"goal-loop"\|"planner"\|"researcher"\|"trend-scout"'
```

Expected: `"enabled": true` for each plugin.

**Fix 2: Check the plugin-sdk bridge**

The extensions import from `openclaw/plugin-sdk`. If the build is broken:

```bash
cd ~/openclaw
pnpm build
# Verify the export exists:
ls dist/plugin-sdk/index.js
```

**Fix 3: Check gateway logs for specific errors**

```bash
journalctl --user -u openclaw-gateway --no-pager | grep -i "error\|fail\|plugin" | tail -30
```

### Discord Connection Issues

**Symptom:** Bot appears offline or does not respond.

**Check 1: Bot token is valid**

```bash
# Verify token is set (don't print the actual token)
cat ~/.openclaw/openclaw.json | grep -c '"token"'
```

**Check 2: Bot is invited to the server with correct permissions**

Re-invite the bot using the OAuth2 URL from the Discord Developer Portal.

**Check 3: Message Content Intent is enabled**

Go to Discord Developer Portal > Your Application > Bot > Privileged Gateway Intents > Message Content Intent must be ON.

**Check 4: Channel bindings are correct**

Verify channel IDs match your Discord server:

```bash
cat ~/.openclaw/openclaw.json | grep -A3 '"peer"'
```

**Check 5: Allowlist includes your user ID**

```bash
cat ~/.openclaw/openclaw.json | grep -A5 '"allowlist"'
```

### Goal/Plan Hangs

**CRITICAL:** Never run `openclaw goal status <id>` or `openclaw planner status <id>` -- they can hang indefinitely and cannot be killed with Ctrl+C.

**If a CLI command is already stuck:**

1. Open a new terminal
2. Kill the stuck process: `pkill -f "openclaw goal\|openclaw planner"`
3. Use the safe alternatives below

**Safe alternatives:**

```bash
# Goal status (read file directly)
cat ~/.openclaw/goal-loop/goals.json | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    Object.values(d.goals).forEach(g=>{
      console.log(g.id, g.status, 'iter:'+g.usage.iterations, 'score:'+(g.lastEvaluation?.progressScore??'N/A'));
    });
  "

# Plan status (read file directly)
cat ~/.openclaw/planner/plans.json | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    Object.values(d.plans).forEach(p=>{
      const done=p.tasks.filter(t=>t.status==='completed').length;
      console.log(p.id, p.status, 'phase:'+p.currentPhase, 'tasks:'+done+'/'+p.tasks.length);
    });
  "

# If you must use CLI, always wrap with timeout
timeout 5 openclaw goal list 2>&1
timeout 5 openclaw planner list 2>&1
```

**Stuck goal/plan (running but making no progress):**

```bash
# Stop a stuck goal
timeout 5 openclaw goal stop GOAL_ID 2>&1

# Stop a stuck plan
timeout 5 openclaw planner stop PLAN_ID 2>&1
```

### Memory Issues

**Symptom:** Agent does not remember past conversations.

**Check 1: Memory search is enabled**

```bash
cat ~/.openclaw/openclaw.json | grep -A10 '"memorySearch"'
```

**Check 2: Session files exist**

```bash
ls -la ~/.openclaw/agents/YOUR_AGENT_ID/sessions/
```

**Check 3: MEMORY.md exists**

```bash
cat ~/.openclaw/workspace-YOUR_AGENT_ID/MEMORY.md
```

**Fix:** If memory index is stale, restart the gateway to force re-sync:

```bash
systemctl --user restart openclaw-gateway
```

### Extension instanceof Errors

**Symptom:** Discord buttons from extensions (trend-scout, researcher) don't work; logs show `instanceof` check failures.

**Cause:** Extensions loaded via jiti resolve `@buape/carbon` from `node_modules/`, but the gateway's built `dist/` bundles its own copy. These are different class objects, so `instanceof` always fails.

**Fix:** Extensions must use the spec-based pattern (not direct class instances). If you see this error, the extension's button registration code needs to use `createButtonFromSpec()` instead of extending the `Button` class directly. See `src/discord/monitor/component-registry.ts` for the pattern.

---

## Configuration Reference

### Full openclaw.json Schema

Below is a comprehensive example with comments. Note that `openclaw.json` uses JSON5 syntax (comments and trailing commas are allowed).

```json5
{
  // =========================================================================
  // Gateway Configuration
  // =========================================================================
  gateway: {
    // "local" for self-hosted, "cloud" for managed
    mode: "local",

    // Port to listen on
    port: 18789,

    // Binding mode: "loopback" (127.0.0.1 only) or "all" (0.0.0.0)
    bind: "loopback",

    // Authentication
    auth: {
      // Token required for gateway API access
      token: "YOUR_GATEWAY_TOKEN_HERE",
    },
  },

  // =========================================================================
  // Model Providers
  // =========================================================================
  models: {
    providers: {
      // Azure OpenAI
      azure: {
        baseUrl: "https://YOUR_RESOURCE.openai.azure.com/v1",
        apiKey: "YOUR_AZURE_KEY",
        models: [
          {
            id: "gpt-4o-mini",
            alias: "default",
            // Optional overrides:
            // "maxTokens": 4096,
            // "temperature": 0.7
          },
        ],
      },

      // OpenAI (direct)
      // "openai": {
      //   "apiKey": "sk-YOUR_KEY",
      //   "models": [
      //     { "id": "gpt-4o", "alias": "default" }
      //   ]
      // },

      // Anthropic
      // "anthropic": {
      //   "apiKey": "sk-ant-YOUR_KEY",
      //   "models": [
      //     { "id": "claude-sonnet-4-20250514", "alias": "default" }
      //   ]
      // }
    },
  },

  // =========================================================================
  // Discord Channel Configuration
  // =========================================================================
  discord: {
    // Bot token
    token: "YOUR_DISCORD_BOT_TOKEN",

    // Bot's user ID (find in Developer Portal)
    accountId: "YOUR_BOT_USER_ID",

    // Access policy: "allowlist" or "open"
    policy: "allowlist",

    // Users allowed to interact with the bot
    allowlist: ["YOUR_DISCORD_USER_ID"],

    // Exec approval configuration
    execApprovals: {
      enabled: true,
      approvers: ["YOUR_DISCORD_USER_ID"],
    },

    // Researcher interview questions
    researcherQuestions: {
      enabled: true,
      approvers: ["YOUR_DISCORD_USER_ID"],
    },
  },

  // =========================================================================
  // Message Configuration
  // =========================================================================
  messages: {
    // When to add ack reactions
    ackReactionScope: "group-mentions",

    // Keep reaction after responding
    removeAckAfterReply: false,
  },

  // =========================================================================
  // Agent Configuration
  // =========================================================================
  agents: {
    // Default settings applied to all agents
    defaults: {
      memorySearch: {
        enabled: true,
        sources: ["memory", "sessions"],
        provider: "openai",
        sync: {
          onSessionStart: true,
          watchEnabled: true,
          intervalMinutes: 60,
        },
        query: {
          maxResults: 10,
          minScore: 0.5,
        },
      },
    },

    // Agent definitions
    list: [
      {
        id: "main",
        workspace: "/home/YOUR_USER/.openclaw/workspace",
        identity: {
          name: "Main",
          emoji: "🤖",
        },
      },
      {
        id: "researcher",
        workspace: "/home/YOUR_USER/.openclaw/workspace-researcher",
        identity: {
          name: "Researcher",
          emoji: "🔬",
        },
      },
      {
        id: "planner",
        workspace: "/home/YOUR_USER/.openclaw/workspace-planner",
        identity: {
          name: "Planner",
          emoji: "📋",
        },
      },
      {
        id: "executor",
        workspace: "/home/YOUR_USER/.openclaw/workspace-executor",
        identity: {
          name: "Executor",
          emoji: "⚙️",
        },
      },
      {
        id: "qa",
        workspace: "/home/YOUR_USER/.openclaw/workspace-qa",
        identity: {
          name: "QA",
          emoji: "✅",
        },
      },
      // ... additional agents from packs are auto-generated
    ],
  },

  // =========================================================================
  // Channel Bindings (route messages to agents)
  // =========================================================================
  bindings: [
    {
      agentId: "main",
      match: {
        channel: "discord",
        peer: { id: "YOUR_MAIN_CHANNEL_ID" },
      },
    },
    // Add more bindings for each agent/channel pair
  ],

  // =========================================================================
  // Extension Configuration
  // =========================================================================

  // Goal Loop
  "goal-loop": {
    enabled: true,
    maxConcurrentGoals: 2,
    defaultEvalModel: null, // null = use agent's model
    defaultBudgetIterations: 20,
    defaultBudgetTokens: 300000,
    defaultBudgetTimeMs: 7200000, // 2 hours
    defaultEvalEvery: 3,
    defaultStallThreshold: 3,
    defaultProviderUsageThreshold: 80,
    approvalTimeoutMs: 1800000, // 30 minutes
    approvalTimeoutAction: "auto-approve",
  },

  // Planner
  planner: {
    enabled: true,
    maxConcurrentPlans: 2,
    defaultMaxAgentTurns: 30,
    defaultMaxTokens: 500000,
    defaultMaxTimeMs: 7200000, // 2 hours
    defaultMaxConcurrency: 3,
    defaultMaxRetries: 2,
    defaultReplanThreshold: 40,
  },

  // Researcher
  researcher: {
    enabled: true,
    maxConcurrentResearches: 2,
    defaultMaxRounds: 3,
    interviewTimeoutMs: 900000, // 15 minutes
    defaultPlannerBudget: {
      maxAgentTurns: 30,
      maxTokens: 500000,
      maxTimeMs: 7200000,
      maxConcurrency: 3,
    },
  },

  // Trend Scout
  "trend-scout": {
    enabled: true,
  },

  // Agent Packs
  "agent-packs": {
    enabled: true,
    enabledPacks: "all",
    disabledPacks: [],
  },
}
```

### Environment Variables

These can be set in `~/.openclaw/.secrets.env` or system environment:

| Variable                 | Required   | Description                                |
| ------------------------ | ---------- | ------------------------------------------ |
| `AZURE_OPENAI_API_KEY`   | If Azure   | Azure OpenAI API key                       |
| `AZURE_OPENAI_ENDPOINT`  | If Azure   | Azure OpenAI endpoint URL                  |
| `OPENAI_API_KEY`         | If OpenAI  | OpenAI API key                             |
| `ANTHROPIC_API_KEY`      | If Claude  | Anthropic API key                          |
| `DISCORD_BOT_TOKEN`      | If Discord | Discord bot token                          |
| `OPENCLAW_GATEWAY_TOKEN` | Yes        | Gateway authentication token               |
| `REDDIT_CLIENT_ID`       | Optional   | Reddit API client ID (for trend-scout)     |
| `REDDIT_CLIENT_SECRET`   | Optional   | Reddit API client secret (for trend-scout) |
| `NOTION_API_KEY`         | Optional   | Notion integration key                     |

### Systemd Service Configuration

The gateway runs as a user-level systemd service:

**Service file location:** `~/.config/systemd/user/openclaw-gateway.service`

**Override file** (to use dev tree): `~/.config/systemd/user/openclaw-gateway.service.d/dev-tree.conf`

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/node /home/%u/openclaw/openclaw.mjs gateway run --bind loopback --port 18789 --force
```

**Common systemd commands:**

```bash
# Start/stop/restart
systemctl --user start openclaw-gateway
systemctl --user stop openclaw-gateway
systemctl --user restart openclaw-gateway

# Check status
systemctl --user status openclaw-gateway

# Enable at login
systemctl --user enable openclaw-gateway

# View logs (follow mode)
journalctl --user -u openclaw-gateway -f

# View last 100 log lines
journalctl --user -u openclaw-gateway --no-pager -n 100

# Reload after changing service files
systemctl --user daemon-reload
```

### Docker Deployment Option

Docker configuration is at `deploy/docker-compose.gateway.yml`.

**Setup:**

```bash
# 1. Create environment file
cp deploy/.env.example deploy/.env
# Edit deploy/.env with your secrets

# 2. Build the image
docker compose -f deploy/docker-compose.gateway.yml build

# 3. Start the container
docker compose -f deploy/docker-compose.gateway.yml up -d

# 4. Check logs
docker compose -f deploy/docker-compose.gateway.yml logs -f

# 5. Stop
docker compose -f deploy/docker-compose.gateway.yml down
```

**Docker resource limits** (configured in docker-compose):

| Resource       | Limit     |
| -------------- | --------- |
| CPUs           | 2 cores   |
| Memory         | 4 GB      |
| CPU Reserve    | 0.5 cores |
| Memory Reserve | 512 MB    |

**Docker volumes:**

- `~/.openclaw` is mounted at the same path inside the container for config compatibility
- Secrets file is mounted read-only at `/run/secrets/openclaw.env`
- Port 18789 is bound to `127.0.0.1` only

**Health check:**

- Endpoint: `http://localhost:18789/health`
- Interval: 30 seconds
- Timeout: 10 seconds
- Retries: 3

### Data File Locations

| Data                 | Path                                           | Format   | In Git? |
| -------------------- | ---------------------------------------------- | -------- | ------- |
| Main config          | `~/.openclaw/openclaw.json`                    | JSON5    | No      |
| Secrets              | `~/.openclaw/.secrets.env`                     | Env vars | No      |
| Goal state           | `~/.openclaw/goal-loop/goals.json`             | JSON     | No      |
| Goal iteration logs  | `~/.openclaw/goal-loop/{id}-iterations.jsonl`  | JSONL    | No      |
| Goal evaluation logs | `~/.openclaw/goal-loop/{id}-evaluations.jsonl` | JSONL    | No      |
| Plan state           | `~/.openclaw/planner/plans.json`               | JSON     | No      |
| Plan worker logs     | `~/.openclaw/planner/{id}-workers.jsonl`       | JSONL    | No      |
| Plan evaluation logs | `~/.openclaw/planner/{id}-evaluations.jsonl`   | JSONL    | No      |
| Research state       | `~/.openclaw/researcher/researches.json`       | JSON     | No      |
| Generated PRDs       | `~/.openclaw/prds/*.md`                        | Markdown | No      |
| Trend digests        | `~/.openclaw/dashboard/trend-digests/*.json`   | JSON     | No      |
| Trend config         | `~/.openclaw/dashboard/trend-scout.json`       | JSON     | No      |
| Scout proposals      | `~/.openclaw/scout-proposals/registry.json`    | JSON     | No      |
| Agent sessions       | `~/.openclaw/agents/{id}/sessions/*.jsonl`     | JSONL    | No      |
| Agent workspace      | `~/.openclaw/workspace-{id}/`                  | Files    | Varies  |
| Agent memory         | `~/.openclaw/workspace-{id}/MEMORY.md`         | Markdown | No      |
| Dashboard tags       | `~/.openclaw/dashboard/tags.json`              | JSON     | No      |

---

## Quick Command Reference

### Goal Loop Commands

```bash
# Start a goal
openclaw goal start --goal "..." --criteria "..." [--budget-iterations N] [--budget-time 2h]

# Stop a running goal
openclaw goal stop GOAL_ID

# Resume a stopped/exceeded goal
openclaw goal resume GOAL_ID [--add-iterations N] [--add-time 1h]

# Approve a quality gate
openclaw goal approve GOAL_ID

# Reject a quality gate
openclaw goal reject GOAL_ID

# List goals (with timeout)
timeout 5 openclaw goal list 2>&1
timeout 5 openclaw goal list --active 2>&1

# Safe status check (read file directly)
cat ~/.openclaw/goal-loop/goals.json | node -e "..."
```

### Planner Commands

```bash
# Start a plan
openclaw planner start --goal "..." --criteria "..." [--max-turns N] [--concurrency N]

# Start from PRD
openclaw planner start --goal "placeholder" --from-prd PATH [--max-turns N]

# Stop a running plan
openclaw planner stop PLAN_ID

# Resume a stopped/failed plan
openclaw planner resume PLAN_ID [--add-turns N] [--add-time 2h]

# View task board
timeout 10 openclaw planner tasks PLAN_ID 2>&1

# List plans (with timeout)
timeout 5 openclaw planner list 2>&1
timeout 5 openclaw planner list --active 2>&1

# Safe status check (read file directly)
cat ~/.openclaw/planner/plans.json | node -e "..."
```

### Researcher Commands

```bash
# Start research
openclaw researcher start --goal "..." [--max-rounds N] [--notify-channel discord --notify-to USER_ID]

# Stop research
openclaw researcher stop RESEARCH_ID

# View generated PRD
timeout 5 openclaw researcher view RESEARCH_ID 2>&1

# List researches
timeout 5 openclaw researcher list 2>&1
timeout 5 openclaw researcher list --active 2>&1
```

### Gateway Commands

```bash
# Start gateway (foreground)
openclaw gateway run --bind loopback --port 18789 --force

# Channel status
openclaw channels status --probe

# Gateway health
curl -sf http://127.0.0.1:18789/health

# Run diagnostics
openclaw doctor

# Systemd management
systemctl --user {start|stop|restart|status} openclaw-gateway
journalctl --user -u openclaw-gateway -f
```
