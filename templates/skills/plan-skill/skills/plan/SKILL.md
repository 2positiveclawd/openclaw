---
name: plan
description: "Decompose goals into task DAGs with parallel execution"
metadata: { "openclaw": { "emoji": "\uD83D\uDCCB" } }
---

# Planner Skill

Decompose complex goals into a DAG of focused tasks, execute them in parallel with worker agents, and replan on failure.

**Important**: Use `openclaw-planner` (not `openclaw planner`) for all commands.

## When to Use /plan

Use this when:

- The goal mentions multiple files, pages, or components
- There are more than 5 acceptance criteria
- The goal involves setup + build + test + deploy steps
- A PRD describes a multi-part project
- The user has a clear goal with defined requirements but needs parallel execution

Do NOT use this for simple single-action goals (use `/goal` instead) or vague goals that need discovery (use `/research` instead).

## Starting a Plan

```bash
openclaw-planner start \
  --goal "Build a dashboard with auth and data viz" \
  --criteria "Login page works" "Dashboard renders charts" "Build passes" \
  --max-turns 50 \
  --max-tokens 500000 \
  --max-time 1h \
  --concurrency 3 \
  --notify-channel discord --notify-to 302826080664813578
```

### Starting from a PRD

```bash
openclaw-planner start \
  --from-prd ~/.openclaw/prds/005-dashboard.md \
  --goal "Build dashboard from PRD" \
  --max-turns 50 \
  --notify-channel discord --notify-to 302826080664813578
```

### Parameters

- `--goal` (required): What to accomplish.
- `--criteria <items...>`: Acceptance criteria (space-separated strings).
- `--from-prd <path>`: Load goal and criteria from a PRD file.
- `--max-turns <n>`: Max total agent turns (default: 50).
- `--max-tokens <n>`: Max total tokens (default: 500000).
- `--max-time <duration>`: Wall-clock limit, e.g. `2h`, `30m` (default: 1h).
- `--concurrency <n>`: Max parallel workers (default: 3).
- `--max-retries <n>`: Per-task retry limit (default: 2).
- `--replan-threshold <n>`: Re-plan if batch failure rate exceeds this % (default: 50).
- `--notify-channel <channel>`: Notification channel.
- `--notify-to <recipient>`: Notification recipient.
- `--notify-account-id <id>`: Notification account ID.

## How the Planner Works

1. **Planning phase**: A planner agent decomposes the goal into 5-20 focused tasks as a DAG
2. **Execution phase**: Worker agents execute ready tasks in parallel (up to `--concurrency`)
3. **Replanning**: If batch failure rate exceeds threshold, a replanner agent adjusts the plan
4. **Evaluation**: Final evaluation scores the result 0-100 against acceptance criteria

## Checking Status

```bash
openclaw-planner status <plan-id>
openclaw-planner tasks <plan-id>    # Kanban-style task board
openclaw-planner list --active
```

### HTTP endpoint

```bash
curl -s http://localhost:18789/planner/status | jq .
```

## Stopping and Resuming

```bash
# Stop a running plan
openclaw-planner stop <plan-id>

# Resume with extended budget
openclaw-planner resume <plan-id> --add-turns 20 --add-tokens 200000
```

## Available PRDs

PRD files at `~/.openclaw/prds/`:

- `001-snake-game.md` — Browser Snake game
- `002-landing-page.md` — Product landing page
- `003-cli-todo.md` — Node.js CLI todo app

## CRITICAL: Always Enable Notifications

Every `openclaw-planner start` command MUST include:

```
--notify-channel discord --notify-to 302826080664813578
```

## Responding to the User

When the user asks to start a plan:

1. If they specify a PRD, use `--from-prd` to load it
2. If free text, construct `--goal` and `--criteria` flags
3. **ALWAYS include `--notify-channel discord --notify-to 302826080664813578`**
4. Only include Vercel deployment as criteria when the PRD explicitly says to deploy publicly
5. After starting, report the plan ID and tell the user: "I'll DM you when it completes or needs attention."
