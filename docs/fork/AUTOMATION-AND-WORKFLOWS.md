# Automation and Workflows

> Event-driven automation, templates, webhooks, chains, and execution workflows.

## Overview

The automation system enables event-driven execution flows where completions, failures, and milestones automatically trigger follow-up actions.

```
Event Fired (goal completed, plan failed, etc.)
    |
    v
[Automation Extension]
    |-- notifyDiscord(event)           [async]
    |-- fireWebhooks(event)            [async, parallel]
    +-- evaluateChains(event)          [async, parallel]
         |-- Match triggers
         |-- Check conditions (score, entity type)
         +-- Execute actions (start new goal/plan/research)
```

---

## Event Types

| Event                 | Description                          |
| --------------------- | ------------------------------------ |
| `goal.started`        | Goal loop begins execution           |
| `goal.completed`      | Goal reaches score threshold         |
| `goal.failed`         | Goal hits error or budget            |
| `goal.stalled`        | Stall detection triggered            |
| `goal.iteration`      | Individual iteration completed       |
| `plan.started`        | Planner begins decomposition         |
| `plan.completed`      | All tasks completed, evaluation done |
| `plan.failed`         | Plan exceeds failure threshold       |
| `plan.task.completed` | Individual task finishes             |
| `plan.task.failed`    | Individual task fails                |
| `research.started`    | Research interview begins            |
| `research.completed`  | PRD generated                        |
| `research.round`      | Interview round completed            |
| `system.error`        | System-level error                   |

---

## Templates

Reusable execution presets stored in `~/.openclaw/dashboard/templates.json`.

### Default Templates

| Name                 | Type     | Budget                            |
| -------------------- | -------- | --------------------------------- |
| **Quick Goal**       | goal     | 10 iterations, 100K tokens, 10min |
| **Thorough Plan**    | plan     | 100 iterations, 500K tokens, 1hr  |
| **Research Session** | research | 50 iterations, 300K tokens        |

### Template Schema

```typescript
interface GoalTemplate {
  id: string;
  name: string;
  description: string;
  type: "goal" | "plan" | "research";
  config: {
    goal?: string;
    criteria?: string[];
    budget: {
      maxIterations?: number;
      maxTokens?: number;
      maxTimeMs?: number;
      evalEvery?: number;
    };
  };
  createdAt: number;
  usedCount: number;
}
```

Templates can be used from the dashboard or referenced by chains.

---

## Webhooks

HTTP POST callbacks fired on events with HMAC-SHA256 signatures.

### Configuration

```typescript
interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  secret?: string; // HMAC signing key
  createdAt: number;
  lastTriggered?: number;
  lastStatus?: number; // HTTP status code
}
```

### Payload

```json
{
  "event": "goal.completed",
  "timestamp": 1738838400000,
  "data": {
    "id": "abc12345",
    "goal": "Build REST API",
    "score": 95,
    "iterations": 12,
    "tokensUsed": 245000
  }
}
```

### Headers

| Header                 | Value                                        |
| ---------------------- | -------------------------------------------- |
| `X-OpenClaw-Event`     | Event type (e.g., `goal.completed`)          |
| `X-OpenClaw-Delivery`  | Unique delivery UUID                         |
| `X-OpenClaw-Signature` | HMAC-SHA256 signature (if secret configured) |
| `Content-Type`         | `application/json`                           |

### Timeout

30 seconds per webhook delivery. Failures are logged but don't block other webhooks.

---

## Chained Executions

Trigger-action rules that automatically start new executions based on events.

### Chain Schema

```typescript
interface ChainedExecution {
  id: string;
  name: string;
  description: string;
  trigger: {
    type: "goal" | "plan" | "research";
    id?: string; // Specific entity ID (or any)
    event: "completed" | "failed";
    condition?: {
      minScore?: number; // Only trigger if score >= this
      maxScore?: number; // Only trigger if score <= this
    };
  };
  action: {
    type: "goal" | "plan" | "research";
    templateId?: string; // Use a saved template
    config?: {
      goal?: string;
      criteria?: string[];
    };
  };
  enabled: boolean;
  createdAt: number;
  triggeredCount: number;
  lastTriggered?: number;
}
```

### Trigger Matching Logic

1. Event type matches trigger type (e.g., `goal.completed` matches goal trigger)
2. Event action matches (completed/failed)
3. Specific entity ID if configured (otherwise matches any)
4. Score within condition bounds (minScore/maxScore)

### Example Chains

**Research-to-Plan Pipeline:**

```json
{
  "name": "Auto-launch plan from research",
  "trigger": { "type": "research", "event": "completed" },
  "action": { "type": "plan", "templateId": "default_thorough_plan" }
}
```

**Goal Follow-up:**

```json
{
  "name": "Quality follow-up on completed goals",
  "trigger": {
    "type": "goal",
    "event": "completed",
    "condition": { "minScore": 80 }
  },
  "action": {
    "type": "goal",
    "config": {
      "goal": "Run comprehensive tests and fix any issues found",
      "criteria": ["All tests pass", "No regressions"]
    }
  }
}
```

**Failure alert:**

```json
{
  "name": "Investigate plan failures",
  "trigger": { "type": "plan", "event": "failed" },
  "action": {
    "type": "research",
    "config": {
      "goal": "Investigate why the plan failed and suggest fixes"
    }
  }
}
```

---

## Discord Notifications

Events can trigger Discord notifications to configured channels.

### Configuration

- **Channel**: Discord channel ID for notifications
- **Event types**: Which events trigger notifications
- **Format**: Compact (one-liner) or detailed (embed with metadata)

### Notification Content

| Event          | Notification                                                             |
| -------------- | ------------------------------------------------------------------------ |
| Goal completed | "Goal 'Build REST API' completed with score 95/100"                      |
| Plan failed    | "Plan 'Complex project' failed -- 3/10 tasks failed"                     |
| Research ready | "Research 'User dashboard' ready -- PRD generated, waiting for approval" |
| Stall detected | "Goal 'Refactor auth' stalled -- score stuck at 45 for 3 evaluations"    |

---

## Learnings Module

Records completed executions for future pattern matching and recommendations.

### What It Tracks

- Goal descriptions and their final scores
- Which criteria were met vs. missed
- Budget usage patterns (iterations, tokens, time)
- Failure modes and recovery strategies

### How It's Used

- **Similarity scoring**: When starting a new goal, suggests similar past goals
- **Budget estimation**: Recommends budgets based on similar past executions
- **Pattern detection**: Identifies common failure modes

---

## Complete Workflow Examples

### Example 1: Autonomous Feature Development

```
User: "Build a user authentication system"
  |
  v
[Research Phase]
  Researcher interviews user (Discord buttons):
    - "OAuth or JWT?" -> JWT
    - "Which providers?" -> Google, GitHub
    - "Session duration?" -> 24 hours
  Generates PRD
  |
  v
[Auto-Launch via Chain]
  Chain triggers: research.completed -> start plan
  |
  v
[Planning Phase]
  Planner decomposes into tasks:
    1. Set up JWT library
    2. Create auth middleware
    3. Build login endpoint
    4. Build registration endpoint
    5. Add Google OAuth
    6. Add GitHub OAuth
    7. Write integration tests
  |
  v
[Execution Phase]
  Workers execute in parallel (respecting DAG):
    Tasks 1,2 (parallel) -> Tasks 3,4 (parallel) -> Tasks 5,6 (parallel) -> Task 7
  |
  v
[Evaluation]
  QA agent scores: 92/100
  |
  v
[Webhook]
  POST to Slack: "Auth system complete, 92/100"
  |
  v
[Chain Trigger]
  Score >= 80 -> Start follow-up goal: "Run security audit on auth system"
```

### Example 2: Daily Trend Monitoring

```
[09:00 Daily - Trend Scout]
  Scans HN, Reddit, GitHub
  Finds relevant trends
  |
  v
[Discord Proposals]
  Posts interactive buttons in #trend-scout
  User clicks "Approve" on interesting trend
  |
  v
[Knowledge Base]
  Approved trend saved to memory/knowledge/
  Available via memory_search() for all agents
```

---

## Data Storage

| File                                   | Content                   |
| -------------------------------------- | ------------------------- |
| `~/.openclaw/dashboard/templates.json` | Execution templates       |
| `~/.openclaw/dashboard/webhooks.json`  | Webhook configurations    |
| `~/.openclaw/dashboard/chains.json`    | Chain rules               |
| `~/.openclaw/dashboard/tags.json`      | Mission organization tags |
| `~/.openclaw/dashboard/favorites.json` | Starred missions          |
| `~/.openclaw/dashboard/dismissed.json` | Hidden missions           |

---

## Dashboard Integration

The automation system is fully managed through the Mission Control Dashboard at `/automation`:

- **Templates tab**: Create, edit, delete, and test templates
- **Webhooks tab**: Configure endpoints, select events, test delivery
- **Chains tab**: Build trigger-action rules, view execution history
- **Activity feed**: Recent automation events and outcomes
