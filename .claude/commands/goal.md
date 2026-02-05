---
description: Operate on OpenClaw goal loops (start, stop, monitor, approve)
argument-hint: [action] [args...]
allowed-tools: [Bash, Read, Grep, Glob, WebFetch]
---

# Goal Loop Operations

Manage autonomous goal-directed agent loops via the `openclaw goal` CLI and the gateway HTTP API.

## CLI Commands

All commands output JSON. Parse with `jq` for readability.

### Start a goal

```bash
openclaw goal start \
  --goal "<description>" \
  --criteria "<criterion1>" "<criterion2>" ... \
  --budget-iterations <n> \
  --budget-tokens <n> \
  --budget-time <duration> \
  --eval-every <n> \
  [--eval-model <alias>] \
  [--stall-threshold <n>] \
  [--quality-gate <iteration> ...] \
  [--notify-channel <channel>] \
  [--notify-to <recipient>] \
  [--agent-id <id>]
```

- `--budget-time` accepts `5m`, `2h`, `120s`, or raw milliseconds.
- `--criteria` are space-separated strings; each is an acceptance criterion.
- `--quality-gate` pauses the loop at the given iteration for human approval.

### Stop a goal

```bash
openclaw goal stop <goal-id>
```

### Check status

```bash
# Single goal (detailed)
openclaw goal status <goal-id>

# All goals (summary)
openclaw goal status
```

### List goals

```bash
openclaw goal list
openclaw goal list --active
```

### Resume a stopped or budget-exceeded goal

```bash
openclaw goal resume <goal-id> \
  [--add-iterations <n>] \
  [--add-tokens <n>] \
  [--add-time <duration>]
```

### Approve a quality gate

```bash
openclaw goal approve <goal-id>
```

### Reject a quality gate

```bash
openclaw goal reject <goal-id>
```

## HTTP API

The gateway exposes a status endpoint when the goal-loop plugin is loaded.

```bash
curl -s http://localhost:18789/goal-loop/status | jq .
```

Returns all goals with their status, iteration counts, token usage, scores, and stop reasons.

## Log Files

Goal state and logs are stored under `~/.openclaw/goal-loop/`:

```
~/.openclaw/goal-loop/
  <goal-id>/
    goal.json             # Current goal state
    iterations.jsonl      # One JSON object per iteration
    evaluations.jsonl     # One JSON object per evaluation
```

### Tailing logs

```bash
# Watch iterations as they happen
tail -f ~/.openclaw/goal-loop/<goal-id>/iterations.jsonl | jq .

# Watch evaluations
tail -f ~/.openclaw/goal-loop/<goal-id>/evaluations.jsonl | jq .

# Gateway log (plugin load messages, errors)
tail -f /tmp/openclaw-gateway.log
```

## Interpreting Status

| Status            | Meaning                               |
| ----------------- | ------------------------------------- |
| `pending`         | Created, waiting to start             |
| `running`         | Loop is actively iterating            |
| `evaluating`      | Running a progress evaluation         |
| `paused`          | Waiting for quality gate approval     |
| `stopped`         | Manually stopped or rejected          |
| `completed`       | All criteria met (score >= threshold) |
| `budget_exceeded` | Hit iteration, token, or time limit   |
| `failed`          | Too many consecutive errors           |

## Evaluation Scores

Evaluations return a `progressScore` (0-100). The evaluator assesses:

- How much of the goal has been accomplished
- Which criteria are satisfied vs. remaining
- Whether progress is stalling (consecutive flat scores trigger a stall stop)

A score of 90+ with all criteria met typically triggers `completed`.

## Troubleshooting

**Plugin not loading**

- Check `~/.openclaw/openclaw.json` has `"goal-loop": { "enabled": true }` under `plugins.entries`.
- Check gateway log: `grep -i goal /tmp/openclaw-gateway.log`
- Verify the extension built: `ls /home/azureuser/openclaw/extensions/goal-loop/`

**Goal starts but no iterations run**

- Check agent availability: `openclaw system status`
- Check model configuration in `~/.openclaw/openclaw.json` under `agents.defaults.model`
- Look for errors in the gateway log

**Evaluation parse errors**

- Check the evaluator model can produce valid JSON
- Look at `evaluations.jsonl` for malformed entries

**Budget exceeded too quickly**

- Default budget is 50 iterations / 1M tokens / 4 hours
- Use `--budget-*` flags to increase, or `openclaw goal resume --add-*` to extend

**Quality gate timeout**

- Default timeout is 30 minutes, then auto-rejects
- Configure via plugin settings: `approvalTimeoutMs`, `approvalTimeoutAction`

## Workflow Example

```bash
# 1. Start a goal
openclaw goal start \
  --goal "Refactor auth module to use JWT tokens" \
  --criteria "All tests pass" "JWT signing implemented" "Old session code removed" \
  --budget-iterations 20 \
  --budget-tokens 500000 \
  --budget-time 1h \
  --eval-every 3 \
  --quality-gate 10

# 2. Monitor progress
watch -n 5 'openclaw goal status | jq .'

# 3. Check HTTP endpoint
curl -s localhost:18789/goal-loop/status | jq '.goals[] | {id, status, iterations, lastScore}'

# 4. Approve at gate (when paused)
openclaw goal approve <goal-id>

# 5. If budget exceeded, extend and resume
openclaw goal resume <goal-id> --add-iterations 10 --add-tokens 200000
```
