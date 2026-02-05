---
name: goal
description: "Start and manage autonomous goal-directed agent loops"
metadata: { "openclaw": { "emoji": "\uD83C\uDFAF" } }
---

# Goal Loop Skill

Start, monitor, and manage autonomous goal-directed agent loops. Goals run iteratively with progress evaluation, budget controls, and quality gates.

**Important**: Use `openclaw-goal` (not `openclaw goal`) for all commands. This routes through the dev source tree where the goal-loop plugin is installed.

## When to Use /goal

Use this when:

- The goal is a single focused action (create a file, fix a bug, build one component)
- Less than 5 acceptance criteria
- Simple iterative execution is sufficient
- The user has a clear, specific goal with known requirements

Do NOT use this for vague/aspirational goals (use `/research` instead) or complex multi-step projects (use `/plan` instead).

## Starting a Goal

Run via shell to start a new goal loop:

```bash
openclaw-goal start \
  --goal "Description of what to accomplish" \
  --criteria "Criterion 1" "Criterion 2" "Criterion 3" \
  --budget-iterations 10 \
  --budget-tokens 200000 \
  --budget-time 15m \
  --eval-every 3 \
  --notify-channel discord --notify-to 302826080664813578
```

### Starting from a PRD File

PRD files are stored at `~/.openclaw/prds/`. To start a goal from a PRD:

1. Read the PRD file to extract the goal, criteria, and budgets
2. Translate them into `openclaw-goal start` flags

Example:

```bash
openclaw-goal start \
  --goal "Build a complete, playable Snake game as a single HTML file at /home/azureuser/projects/snake-game/index.html" \
  --criteria "File exists at /home/azureuser/projects/snake-game/index.html" \
    "Game renders a grid-based board using HTML5 Canvas" \
    "Arrow keys control snake direction" \
    "Food spawns randomly" \
    "Snake grows when eating food" \
    "Score displayed and increments" \
    "Game ends on collision" \
    "Game Over screen with Play Again button" \
  --budget-iterations 15 \
  --budget-tokens 300000 \
  --budget-time 20m \
  --eval-every 3 \
  --quality-gate 10 \
  --notify-channel discord --notify-to 302826080664813578
```

### Parameters

- `--goal` (required): What the agent should accomplish.
- `--criteria`: Acceptance criteria checked during evaluation. Each is a separate string.
- `--budget-iterations`: Maximum agent turns before stopping (default: 50).
- `--budget-tokens`: Maximum total tokens (default: 1000000).
- `--budget-time`: Wall-clock limit, e.g. `30m`, `2h`, `300s` (default: 4h).
- `--eval-every`: Run progress evaluation every N iterations (default: 5).
- `--eval-model`: Model for the evaluator (uses agent model if unset).
- `--stall-threshold`: Consecutive flat evaluations before declaring stall (default: 3).
- `--quality-gate <N>`: Pause for human approval at iteration N. Can specify multiple.
- `--agent-id`: Use a specific agent for iterations.

## Checking Status

```bash
# All goals summary
openclaw-goal status

# Detailed status for one goal
openclaw-goal status <goal-id>

# List all goals
openclaw-goal list
openclaw-goal list --active
```

### HTTP endpoint

```bash
curl -s http://localhost:18789/goal-loop/status | jq .
```

## Interpreting Evaluations

Each evaluation produces:

- `progressScore` (0-100): Overall completion percentage.
- `assessment`: Text summary of what's done and what remains.
- `suggestedAction`: `continue`, `stop`, or `complete`.

Scores are tracked over time. If the score plateaus for `stallThreshold` consecutive evaluations, the loop stops with a stall reason.

A goal completes when the evaluator scores >= 95 and recommends `complete`.

## Stopping and Resuming

```bash
# Stop a running goal
openclaw-goal stop <goal-id>

# Resume a stopped or budget-exceeded goal (optionally extend budget)
openclaw-goal resume <goal-id> --add-iterations 10 --add-tokens 100000
```

## Quality Gates

Quality gates pause the loop at specified iterations for human review.

```bash
# Approve — loop continues
openclaw-goal approve <goal-id>

# Reject — loop stops
openclaw-goal reject <goal-id>
```

If no action is taken within the timeout (default: 30 minutes), the gate auto-rejects.

## Log Files

Logs are stored under `~/.openclaw/goal-loop/<goal-id>/`:

- `goal.json` — Current state snapshot.
- `iterations.jsonl` — One entry per agent iteration (prompt, response, tokens).
- `evaluations.jsonl` — One entry per progress evaluation (score, assessment).

## Available PRDs

PRD files ready to execute are at `~/.openclaw/prds/`:

- `001-snake-game.md` — Browser Snake game (single HTML, Canvas)
- `002-landing-page.md` — Product landing page for "FocusAI"
- `003-cli-todo.md` — Node.js CLI todo app with docs page

## CRITICAL: Always Enable Notifications

Every `openclaw-goal start` command MUST include these notification flags:

```
--notify-channel discord --notify-to 302826080664813578
```

This sends automatic Discord DMs on: goal started, completed, stopped, stalled, failed, quality gate approval needed, and checkpoint updates.

## Responding to the User

When the user asks to start a goal:

1. If they specify a PRD number, read that PRD and start the goal
2. If they describe a goal in free text, construct the appropriate command
3. **ALWAYS include `--notify-channel discord --notify-to 302826080664813578`**
4. Only include Vercel deployment as criteria when the PRD explicitly says to deploy publicly
5. After starting, report the goal ID and tell the user: "I'll DM you when it completes or needs attention."
