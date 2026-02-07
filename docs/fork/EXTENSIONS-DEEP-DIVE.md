# Extensions Deep Dive

> Detailed architecture of all 6 custom OpenClawd extensions.

## Overview

| Extension       | Purpose                                   | Lines  | State Storage                      |
| --------------- | ----------------------------------------- | ------ | ---------------------------------- |
| **Goal Loop**   | Autonomous iterative goal execution       | ~2,500 | `goals.json` + per-goal JSONL      |
| **Planner**     | DAG task decomposition + parallel workers | ~2,800 | `plans.json` + per-plan JSONL      |
| **Researcher**  | Interview-driven PRD generation           | ~2,700 | `researches.json` + PRD markdown   |
| **Trend Scout** | Daily trend scanning + Discord proposals  | ~1,700 | `trends-*.md` + proposals registry |
| **Agent Packs** | 18 pre-built agent personas               | ~1,200 | None (static registry)             |
| **Automation**  | Webhooks, chains, notifications           | ~1,000 | `dashboard/*.json`                 |

All extensions follow the same plugin entry point pattern:

```typescript
const MyPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    api.registerService({ id: "my-service", start, stop });
    api.registerCli(({ program }) => { ... });
    api.registerGatewayMethod("my-plugin.status", ...);
    api.registerHttpRoute({ path: "/my-plugin/status", handler: ... });
    api.registerCommand({ name: "cmd", handler: ... });
  }
};
```

---

## 1. Goal Loop (`extensions/goal-loop/`)

### What It Does

The Goal Loop implements autonomous goal-directed agent execution with iterative progress, LLM-based evaluation, stall detection, and budget governance. It is the simplest orchestration tool -- best for single-focus goals.

### How It Works

```
START
  |
  v
ITERATE (agent turn) <--+
  |                     |
  v                     |
GOVERNANCE CHECKS       |
  |                     |
  Pass?     Fail?       |
  |         --> STOP    |
  v             (budget)|
EVALUATE?               |
(every N iterations)    |
  |                     |
  Yes      No -------->-+
  |
  v
EVALUATOR (LLM scores 0-100)
  |
  Score < 95    Score >= 95    Stall detected
  |             --> COMPLETED  --> STOPPED
  +------------------------------>--+
```

### State Machine

```
pending -> running -> evaluating -> running (loop)
                                 -> completed (score >= 95)
                                 -> budget_exceeded
                                 -> stopped (manual)
                                 -> failed (error)
         -> paused (quality gate) -> running (approved)
                                  -> stopped (rejected)
```

### Governance Checks

| Check            | Trigger                              | Action                 |
| ---------------- | ------------------------------------ | ---------------------- |
| Iteration Budget | `iterations >= maxIterations`        | Stop (budget_exceeded) |
| Token Budget     | `totalTokens >= maxTokens`           | Stop (budget_exceeded) |
| Time Budget      | `elapsed >= maxTimeMs`               | Stop (budget_exceeded) |
| Provider Usage   | API usage % exceeds threshold        | Stop (budget_exceeded) |
| Circuit Breaker  | N consecutive errors (default: 3)    | Stop (failed)          |
| Stall Detection  | Last N evals show < 5 point progress | Stop (stalled)         |

All checks emit **80% warnings** when approaching limits.

### Budget Controls

| Parameter                | Default        | Description                         |
| ------------------------ | -------------- | ----------------------------------- |
| `maxIterations`          | 20             | Maximum agent iterations            |
| `maxTokens`              | 500,000        | Maximum total tokens                |
| `maxTimeMs`              | 7,200,000 (2h) | Maximum wall-clock time             |
| `providerUsageThreshold` | 80             | Provider usage % limit              |
| `evalEvery`              | 3              | Evaluate every N iterations         |
| `stallThreshold`         | 3              | Consecutive flat evals before stall |
| `minProgressDelta`       | 5              | Minimum score delta between evals   |

### Evaluator Output

```json
{
  "progressScore": 85,
  "assessment": "Core functionality complete, missing edge cases",
  "criteriaStatus": [
    { "criterion": "CRUD operations work", "met": true, "notes": "All endpoints tested" },
    { "criterion": "JWT auth", "met": false, "notes": "Not yet implemented" }
  ],
  "shouldContinue": true,
  "suggestedNextAction": "Implement JWT authentication"
}
```

### Quality Gates

Quality gates pause execution at specific iteration counts for human approval:

1. Goal status changes to `paused`
2. Notification sent via Discord/Telegram
3. Human approves or rejects via CLI or Discord
4. Approved: resumes. Rejected: stops.

### CLI

```bash
openclaw goal start \
  --goal "Build a REST API" \
  --criteria "CRUD works" "JWT auth" "Tests pass" \
  --budget-iterations 30 \
  --budget-tokens 1000000 \
  --eval-every 5 \
  --quality-gate 10 20 \
  --notify-channel discord --notify-to "CHANNEL_ID"

openclaw goal stop abc12345
openclaw goal list
openclaw goal resume abc12345 --add-iterations 10
openclaw goal approve abc12345
openclaw goal reject abc12345
```

### Data Storage

| File                                           | Content               |
| ---------------------------------------------- | --------------------- |
| `~/.openclaw/goal-loop/goals.json`             | All goal states       |
| `~/.openclaw/goal-loop/{id}/iterations.jsonl`  | Per-iteration records |
| `~/.openclaw/goal-loop/{id}/evaluations.jsonl` | Evaluation records    |

---

## 2. Planner (`extensions/planner/`)

### What It Does

The Planner decomposes goals into a DAG of focused subtasks, executes them in parallel with worker agents, replans on failure, and evaluates the final result. Best for complex, multi-step goals with many criteria.

### How It Works

```
PLAN PHASE
  |
  Planner agent decomposes goal into 5-20 tasks
  Creates task DAG with dependencies
  |
  v
EXECUTE PHASE
  |
  Scheduler finds ready tasks (all deps satisfied)
  Dispatches workers in parallel (up to maxConcurrency)
  Workers execute in isolated subagent sessions
  |
  v
MONITOR
  |
  Track per-task status, tokens, failures
  If batch failure rate > threshold --> REPLAN
  |
  v
REPLAN (if needed)
  |
  Replanner agent regenerates task DAG
  Uses latest context + failure information
  |
  v
EVALUATE
  |
  Evaluator scores 0-100 against original criteria
  |
  v
DONE
```

### Agent Roles

| Agent     | ID         | Purpose                              |
| --------- | ---------- | ------------------------------------ |
| Planner   | `planner`  | Decomposes goal into task DAG        |
| Workers   | `executor` | Execute individual tasks in parallel |
| Evaluator | `qa`       | Score final result against criteria  |

### Task States

```
pending -> ready (all deps met) -> running -> completed
                                           -> failed -> retry
                                                     -> skipped (max retries)
```

### Features

- **DAG validation**: No cycles, no orphans, all dependencies reachable
- **Parallel execution**: Up to `maxConcurrency` workers simultaneously
- **Per-task retries**: Configurable `maxRetries` per task
- **Replanning**: Triggered when batch failure rate exceeds threshold
- **Worker isolation**: Each task runs in a spawned subagent session

### CLI

```bash
openclaw planner start \
  --goal "Complex project" \
  --criteria "All requirements met" \
  --max-turns 50 --max-concurrency 4

openclaw planner stop abc12345
openclaw planner list
openclaw planner tasks abc12345
openclaw planner resume abc12345
```

### Data Storage

| File                                         | Content             |
| -------------------------------------------- | ------------------- |
| `~/.openclaw/planner/plans.json`             | All plan states     |
| `~/.openclaw/planner/{id}/tasks.jsonl`       | Task execution logs |
| `~/.openclaw/planner/{id}/worker-runs.jsonl` | Worker agent logs   |
| `~/.openclaw/planner/{id}/evaluations.jsonl` | Evaluation records  |

---

## 3. Researcher (`extensions/researcher/`)

### What It Does

Conducts multi-round user interviews via Discord interactive buttons, generates Product Requirement Documents (PRDs) from findings, and auto-launches the Planner to build the PRD.

### Phases

```
RESEARCHING
  Agent does background research on the topic
  |
  v
INTERVIEWING
  Sends structured questions as Discord embed buttons
  Waits for user answers (interactive multi-choice or text)
  Incorporates answers into context
  Repeats for N rounds
  |
  v
SYNTHESIZING
  Compiles research + interview answers into PRD
  |
  v
READY
  PRD generated, waiting for "go" signal
  |
  v
LAUNCHED
  Automatically starts Planner with generated PRD
```

### Discord Integration

The Researcher sends interview questions as interactive Discord embeds with:

- Multi-choice buttons for structured answers
- Free-text input for open-ended questions
- Per-round progress tracking
- "Skip" and "Done early" options

### CLI and API

```bash
openclaw researcher start --goal "Build a user dashboard" --max-rounds 5

# Discord commands
/research-reply <id> <answers>
/research-go <id>
/research-stop <id>
/research-status
```

### Data Storage

| File                                       | Content                 |
| ------------------------------------------ | ----------------------- |
| `~/.openclaw/researcher/researches.json`   | All research states     |
| `~/.openclaw/researcher/{id}/rounds.jsonl` | Round-by-round logs     |
| `~/.openclaw/prds/{id}.md`                 | Generated PRD documents |

---

## 4. Trend Scout (`extensions/trend-scout/`)

### What It Does

Autonomously scans Hacker News, Reddit, and GitHub for trending topics relevant to the system. Posts proposals as interactive Discord buttons for human approval/rejection.

### How It Works

1. **Scheduler**: Runs daily at 9am (configurable)
2. **Scan**: Fetches top items from HN, specified subreddits, GitHub trending
3. **Filter**: Scores, recency, topic keywords
4. **Analyze**: LLM evaluates relevance and extracts key insights
5. **Store**: Saves digest to `memory/trends-YYYY-MM-DD.md`
6. **Propose**: Posts interesting findings as Discord buttons (approve/reject/dismiss)

### Discord Buttons

Scout proposals appear as rich Discord embeds with:

- Title, source, relevance score
- "Approve" button (saves to knowledge base)
- "Reject" button (marks as not relevant)
- "Dismiss" button (ignore without recording)

### Data Storage

| File                                        | Content             |
| ------------------------------------------- | ------------------- |
| `~/.openclaw/workspace/memory/trends-*.md`  | Daily trend digests |
| `~/.openclaw/scout-proposals/registry.json` | Proposal statuses   |

---

## 5. Agent Packs (`extensions/agent-packs/`)

### What It Does

Provides 18 pre-built AI agent personas organized into 6 thematic packs. Each agent has a defined role, SOUL personality file, and tool allowlist.

### Packs Registry

| Pack                  | Agents                                                         | Purpose                          |
| --------------------- | -------------------------------------------------------------- | -------------------------------- |
| **Content Creator**   | Mia (Strategist), Blake (Script Writer), Jordan (Social Media) | Plan, script, distribute content |
| **Dev Team**          | Marcus (Tech Lead), Elena (Reviewer), Sam (Docs)               | Code review, docs, leadership    |
| **Solopreneur**       | Claire (Assistant), Leo (Researcher), Harper (Outreach)        | Solo business operations         |
| **Fitness Training**  | Noah (Coach), Nina (Nutrition), Ethan (Accountability)         | Fitness program management       |
| **Health & Wellness** | Olivia (Wellness), Mason (Sleep), Priya (Habits)               | Health and habit tracking        |
| **Finance & Taxes**   | Sophia (Invoices), Liam (Expenses), Nora (Tax)                 | Financial management             |

### Architecture

- Pack definitions in `extensions/agent-packs/src/packs-registry.ts`
- Soul files in `extensions/agent-packs/packs/{pack-id}/{agent-id}.md`
- Each agent configured in `~/.openclaw/openclaw.json` with Discord channel bindings
- One Discord channel per agent for dedicated interaction

---

## 6. Automation (`extensions/automation/`)

### What It Does

Provides event-driven automation through webhooks, chains, templates, and Discord notifications.

### Components

**Templates**: Reusable execution configs (goal, plan, or research presets with criteria and budgets).

**Webhooks**: HTTP POST callbacks on events with HMAC-SHA256 signatures.

**Chains**: Trigger-action rules that auto-start new executions on events.

**Discord Notifications**: Event alerts to configured channels.

**Learnings**: Records completed executions for pattern matching and recommendations.

See [AUTOMATION-AND-WORKFLOWS.md](./AUTOMATION-AND-WORKFLOWS.md) for full details.

---

## Extension Interaction Map

```
                    Discord User
                         |
                    +----v----+
                    | Gateway |
                    +----+----+
                         |
          +---------+----+----+---------+
          |         |         |         |
     +----v----+ +--v---+ +--v----+ +--v--------+
     |Researcher| |Goal  | |Planner| |Trend Scout|
     |          | |Loop  | |       | |           |
     +----+-----+ +--+---+ +--+----+ +-----------+
          |           |        |
          |     +-----v-----+  |
          |     | Evaluator |  |
          |     | (LLM)     |  |
          |     +-----------+  |
          |                    |
          +-------> PRD -------+
          |                    |
          |    auto-launch     |
          +-----> Planner -----+
                    |
              +-----v------+
              | Workers x N |  (executor agents)
              +-----+------+
                    |
              +-----v------+
              | Evaluator   |  (qa agent)
              +-----------+
                    |
              +-----v------+
              | Automation  | --> Webhooks, Chains, Notifications
              +------------+
```

## Key File Locations

| Component          | Path                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| Goal Loop          | `/home/azureuser/openclaw/extensions/goal-loop/`                     |
| Planner            | `/home/azureuser/openclaw/extensions/planner/`                       |
| Researcher         | `/home/azureuser/openclaw/extensions/researcher/`                    |
| Trend Scout        | `/home/azureuser/openclaw/extensions/trend-scout/`                   |
| Agent Packs        | `/home/azureuser/openclaw/extensions/agent-packs/`                   |
| Automation         | `/home/azureuser/openclaw/extensions/automation/`                    |
| Extension Bridge   | `/home/azureuser/openclaw/src/extension-bridge/index.ts`             |
| Component Registry | `/home/azureuser/openclaw/src/discord/monitor/component-registry.ts` |
| External Skills    | `~/.openclaw/extensions/{goal,plan,research}-skill/`                 |
