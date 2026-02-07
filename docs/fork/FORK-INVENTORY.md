# OpenClawd Fork: Technical Inventory

> Complete technical index of every extension, core patch, integration, and architectural pattern in the OpenClawd fork. This document serves as the knowledge transfer artifact for porting to a new framework.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Extensions (6)](#extensions)
3. [Core Patches (5)](#core-patches)
4. [Extension Bridge](#extension-bridge)
5. [Discord Integration](#discord-integration)
6. [Dashboard](#dashboard)
7. [External Ecosystem](#external-ecosystem)
8. [Upstream Dependencies](#upstream-dependencies)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Discord / CLI                            │
│                    (user-facing layer)                        │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ goal-loop│ planner  │researcher│trend-scout│  agent-packs    │
│          │          │          │          │  automation      │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│               Extension Bridge (fork-specific)               │
├─────────────────────────────────────────────────────────────┤
│              OpenClaw Core (upstream gateway)                 │
│  ┌─────────┐ ┌──────────┐ ┌───────┐ ┌─────────┐ ┌───────┐ │
│  │ Pi Agent│ │ Cron     │ │Browser│ │ Session │ │Gateway│ │
│  │ Runner  │ │ Runner   │ │ Tool  │ │ Store   │ │  API  │ │
│  └─────────┘ └──────────┘ └───────┘ └─────────┘ └───────┘ │
├─────────────────────────────────────────────────────────────┤
│           Model Providers (Azure, OpenAI, etc.)              │
└─────────────────────────────────────────────────────────────┘
```

**Lines of fork-specific code:** ~17K across 6 extensions, 5 core patches, and supporting files.

---

## Extensions

### 1. Goal-Loop (`extensions/goal-loop/`)

**Purpose:** Autonomous goal-directed execution loops with governance, evaluation, budget controls, and stall detection.

**How it works:**

1. User starts a goal (via CLI or Discord)
2. Governance check (budget, provider quota)
3. Spawn isolated agent turn with full tool access (exec, read/write, browser, git)
4. Record iteration result
5. Every N iterations, evaluate progress 0-100 against acceptance criteria
6. Check for stall (< 5 point delta over 3 evaluations)
7. Check budget limits (tokens, iterations, time)
8. Sleep → repeat

**Source files:**

| File                  | Lines | Purpose                                                                        |
| --------------------- | ----- | ------------------------------------------------------------------------------ | ---- | ------ | ---- | -------- |
| `index.ts`            | 390   | Plugin entry: registers service, CLI, RPC, HTTP, channel commands              |
| `src/loop-engine.ts`  | ~450  | Core execution loop: governance → agent turn → record → evaluate → sleep       |
| `src/loop-service.ts` | ~300  | Service manager: start/stop loops, resume on restart, `fs.watch` for new goals |
| `src/evaluator.ts`    | ~200  | Progress evaluation: spawns evaluator model, scores 0-100, stall detection     |
| `src/governance.ts`   | ~150  | Budget checks: tokens, iterations, time, provider quota threshold              |
| `src/state.ts`        | ~200  | File-based persistence: atomic writes to `~/.openclaw/goal-loop/goals.json`    |
| `src/types.ts`        | ~120  | Type definitions: Goal, GoalStatus, GoalConfig, Iteration, etc.                |
| `src/core-bridge.ts`  | ~60   | Imports from `openclaw/extension-bridge`, re-exports with fork-specific types  |
| `src/cli.ts`          | ~300  | CLI: `openclaw goal {start                                                     | stop | status | list | resume}` |

**Key types:**

```typescript
interface Goal {
  id: string;
  goal: string;
  acceptanceCriteria: string[];
  status: "pending" | "running" | "evaluating" | "completed" | "failed" | "stopped";
  config: GoalConfig;
  iterations: Iteration[];
  evaluations: Evaluation[];
  usage: { totalTokens: number; totalIterations: number };
  createdAt: number;
  updatedAt: number;
}

interface GoalConfig {
  maxIterations: number;
  maxTokens: number;
  maxTimeMs: number;
  evalEveryN: number;
  completionThreshold: number; // score needed to complete (default 90)
  stallDeltaThreshold: number; // min score improvement (default 5)
  stallWindowSize: number; // evaluations to check (default 3)
  providerUsageThreshold?: number; // stop if provider quota > N%
}
```

**Registrations:**

- Service: long-running loop manager
- CLI: `openclaw goal` subcommands
- Gateway RPC: `goal-loop.status`
- HTTP: `GET /goal-loop/status`
- Channel commands: `/goal-approve`, `/goal-reject`, `/goal-status`

---

### 2. Planner (`extensions/planner/`)

**Purpose:** Decomposes complex goals into a DAG of focused subtasks, executes workers in parallel, replans on failure, evaluates aggregate result.

**How it works:**

1. Planner agent decomposes goal into 5-20 tasks with dependencies
2. Scheduler identifies ready tasks (all dependencies met)
3. Dispatch workers in parallel (up to `maxConcurrency`)
4. Each worker is an isolated agent turn with a focused prompt
5. If batch failure rate > threshold, spawn replanner to restructure remaining tasks
6. Final evaluator scores result 0-100 against criteria

**Source files:**

| File                     | Lines | Purpose                                                             |
| ------------------------ | ----- | ------------------------------------------------------------------- | ---- | ------ | ---- | ----- | -------- |
| `index.ts`               | 331   | Plugin entry: registers service, CLI, RPC, HTTP, channel commands   |
| `src/orchestrator.ts`    | ~500  | Main orchestration loop: plan → execute batches → replan → evaluate |
| `src/planner-agent.ts`   | ~250  | Spawns planner model to decompose goal into task DAG                |
| `src/worker-agent.ts`    | ~200  | Spawns isolated worker for each task, returns result + tokenUsage   |
| `src/evaluator-agent.ts` | ~200  | Spawns evaluator to score final result against criteria             |
| `src/scheduler.ts`       | ~150  | DAG scheduler: finds ready tasks, handles dependency edges          |
| `src/plan-service.ts`    | ~250  | Service manager: start/stop plans, resume on restart                |
| `src/governance.ts`      | ~150  | Budget checks: tokens, agent turns, time, retries                   |
| `src/state.ts`           | ~200  | File-based persistence: `~/.openclaw/planner/plans.json`            |
| `src/types.ts`           | ~150  | Type definitions: Plan, Task, TaskStatus, PlanConfig, etc.          |
| `src/core-bridge.ts`     | ~60   | Extension bridge imports                                            |
| `src/cli.ts`             | ~350  | CLI: `openclaw planner {start                                       | stop | status | list | tasks | resume}` |

**Key types:**

```typescript
interface Plan {
  id: string;
  goal: string;
  acceptanceCriteria: string[];
  status:
    | "planning"
    | "executing"
    | "replanning"
    | "evaluating"
    | "completed"
    | "failed"
    | "stopped";
  tasks: Task[];
  config: PlanConfig;
  usage: { totalTokens: number; agentTurns: number };
  evaluation?: { score: number; summary: string };
}

interface Task {
  id: string;
  title: string;
  description: string;
  dependsOn: string[]; // task IDs that must complete first
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: string;
  retries: number;
  tokenUsage?: { input: number; output: number; total: number };
}
```

**Execution model:**

- `maxConcurrency` workers at a time (default 3)
- Respects DAG edges: a task only starts when all `dependsOn` are completed
- `maxRetries` per task (default 2)
- Replan threshold: if >50% of batch fails, restructure remaining tasks

---

### 3. Researcher (`extensions/researcher/`)

**Purpose:** Research framework for vague goals — conducts interviews via Discord, generates PRDs, can launch planner from research findings.

**Source files:**

| File                       | Lines | Purpose                                                          |
| -------------------------- | ----- | ---------------------------------------------------------------- |
| `index.ts`                 | 781   | Plugin entry (largest): registers everything + interview routing |
| `src/orchestrator.ts`      | ~400  | Research flow: analyze → interview → synthesize → PRD            |
| `src/research-agent.ts`    | ~250  | Initial research analysis agent                                  |
| `src/interview-agent.ts`   | ~200  | Generates interview questions based on research gaps             |
| `src/synthesizer-agent.ts` | ~250  | Synthesizes answers into structured findings                     |
| `src/research-service.ts`  | ~200  | Service manager                                                  |
| `src/state.ts`             | ~200  | File-based persistence                                           |
| `src/types.ts`             | ~150  | Type definitions                                                 |
| `src/core-bridge.ts`       | ~60   | Extension bridge imports                                         |
| `src/cli.ts`               | ~250  | CLI: `openclaw researcher` subcommands                           |
| `src/discord-questions.ts` | ~350  | Discord DM interview handler (buttons, embeds)                   |

**Registrations:**

- Service, CLI, 3 RPC methods, 3 HTTP routes, 5 channel commands
- 2 Discord buttons (question option selection, submit/skip)

---

### 4. Trend Scout (`extensions/trend-scout/`)

**Purpose:** Autonomous daily monitoring of HN, Reddit, and GitHub. LLM-based analysis identifies opportunities.

**Source files:**

| File                     | Lines | Purpose                                                            |
| ------------------------ | ----- | ------------------------------------------------------------------ |
| `index.ts`               | 403   | Plugin entry: registers CLI, HTTP, scheduler, Discord buttons      |
| `src/scout-service.ts`   | ~300  | Scheduler: daily automated scans, cron-like timing                 |
| `src/analyzer.ts`        | ~250  | LLM analysis: scores trends by relevance, generates proposals      |
| `src/sources.ts`         | ~200  | Source scrapers: HN top stories, Reddit hot posts, GitHub trending |
| `src/types.ts`           | ~100  | Type definitions                                                   |
| `src/discord-buttons.ts` | ~300  | Scout proposal approval buttons (approve → spawn planner)          |

**Data flow:** Sources → Analyzer → Proposals → Discord notification → User approves → Planner starts

---

### 5. Agent Packs (`extensions/agent-packs/`)

**Purpose:** 18 personality-configured agents organized into 6 packs, each with dedicated Discord channels and SOUL documents.

**Source files:**

| File                    | Lines | Purpose                                                  |
| ----------------------- | ----- | -------------------------------------------------------- |
| `index.ts`              | 345   | Plugin entry: registers CLI, RPC, HTTP, channel commands |
| `src/packs-registry.ts` | ~600  | Pack definitions: 6 packs × 3 agents each                |
| `src/soul-loader.ts`    | ~100  | Loads SOUL.md files from pack directories                |
| `src/types.ts`          | ~80   | Type definitions                                         |

**Packs:**

| Pack              | Agents                                            | Purpose                       |
| ----------------- | ------------------------------------------------- | ----------------------------- |
| Content Creator   | mia-strategist, blake-scriptwriter, jordan-social | Social media content pipeline |
| Dev Team          | marcus-techlead, elena-reviewer, sam-docs         | Software development team     |
| Solopreneur       | claire-assistant, leo-researcher, harper-outreach | Business automation           |
| Fitness Training  | noah-coach, nina-nutrition, ethan-accountability  | Health coaching team          |
| Health & Wellness | olivia-wellness, mason-sleep, priya-habits        | Wellness monitoring           |
| Finance & Taxes   | sophia-invoices, liam-expenses, nora-tax          | Financial management          |

Each agent has a SOUL.md in `packs/{pack-name}/{agent-name}.md` defining personality, capabilities, and behavior guidelines.

---

### 6. Automation (`extensions/automation/`)

**Purpose:** Event-driven webhooks, chains, and notifications. Bridges all other extensions.

**Source files:**

| File               | Lines | Purpose                                                       |
| ------------------ | ----- | ------------------------------------------------------------- |
| `src/index.ts`     | 162   | Main exports: `fireEvent()`, event factories, config loaders  |
| `src/config.ts`    | ~100  | Configuration loading from `~/.openclaw/automation/`          |
| `src/chains.ts`    | ~150  | Chain evaluation: condition → action sequences                |
| `src/webhooks.ts`  | ~100  | Webhook dispatch (POST with JSON payload)                     |
| `src/discord.ts`   | ~100  | Discord notification formatting and delivery                  |
| `src/learnings.ts` | ~200  | Learning database: records outcomes, finds similar past goals |
| `src/types.ts`     | ~80   | Type definitions                                              |

**Key API:**

```typescript
// Fire an event that triggers webhooks, chains, and Discord notifications
fireEvent(event: AutomationEvent): Promise<void>

// Event factories
events.goalStarted(goal)
events.goalCompleted(goal)
events.planStarted(plan)
events.planCompleted(plan)
events.researchStarted(research)
events.taskFailed(task)
// etc.
```

---

## Core Patches

These are modifications to upstream OpenClaw files that we maintain as a fork.

### Patch 1: Token Tracking in Cron Runner

**File:** `src/cron/isolated-agent/run.ts`
**Risk:** HIGH (frequently refactored upstream)
**Lines changed:** ~30

**What:** Added `tokenUsage` field to `RunCronAgentTurnResult` return type. The function already captured usage internally and wrote it to the session store, but never returned it to callers. Added token estimation fallback for providers that report zero usage (e.g., subscription APIs).

**Why:** Every extension that spawns agent turns needs to know how many tokens were consumed for budget tracking and cost attribution.

```typescript
// Added to return type
tokenUsage?: { input: number; output: number; total: number };

// Estimation fallback when provider reports 0
if (!hasNonzeroUsage(usage) && !attempt.aborted && !attempt.promptError) {
  const estimated = estimateMessagesTokens(attempt.messagesSnapshot);
  // ...split estimate into input/output
}
```

### Patch 2: Token Tracking in Embedded Runner

**File:** `src/agents/pi-embedded-runner/run.ts`
**Risk:** HIGH (same as above)
**Lines changed:** ~15

**What:** Same token estimation fallback for the embedded Pi agent runner. Uses `estimateMessagesTokens()` from compaction module when the model provider doesn't report usage data.

### Patch 3: Browser Snapshot Cap

**File:** `src/agents/tools/browser-tool.ts`
**Risk:** MEDIUM (browser tool evolves)
**Lines changed:** ~20

**What:** Enforces character cap on snapshot results at the tool return point. The upstream code has an 80K cap in `snapshotAiViaPlaywright` but no cap in `snapshotRoleViaPlaywright` (used when `labels: true`). A single Booking.com page returned 268KB of ARIA tree, consuming 67K tokens.

```typescript
const capChars = resolvedMaxChars ?? DEFAULT_AI_SNAPSHOT_MAX_CHARS;
const cappedText =
  typeof snapshot.snapshot === "string" && snapshot.snapshot.length > capChars
    ? `${snapshot.snapshot.slice(0, capChars)}\n...(snapshot truncated)...`
    : snapshot.snapshot;
```

### Patch 4: Usage Attribution Endpoint

**Files:** `src/gateway/server-methods/usage.ts`, `src/infra/session-cost-usage.ts`
**Risk:** LOW (additive)
**Lines changed:** ~80

**What:** Added `usage.by-source` RPC handler and `loadCostUsageBySource()` function. Parses session keys to extract source type (cron/goal/planner/discord/manual) and aggregates token usage by source.

**Session key format:** `agent:{agentId}:cron:{jobId}`, `agent:{agentId}:goal:{goalId}:iteration-{N}`, `agent:{agentId}:planner-worker:{planId}:{taskId}`, etc.

### Patch 5: Model Auth Passthrough

**File:** `src/agents/model-auth.ts`
**Risk:** LOW (small patch)
**Lines changed:** ~5

**What:** Minor auth resolution adjustment for fork-specific provider configurations.

---

## Extension Bridge

**File:** `src/extension-bridge/index.ts` (48 lines)
**Supporting config:** `tsdown.config.ts` (+8 lines), `package.json` (+1 export), `src/plugins/loader.ts` (+25 lines jiti alias)

**Purpose:** Dedicated entry point for fork extension imports. Keeps `src/plugin-sdk/index.ts` at zero fork-specific exports (no merge conflicts on upstream pulls).

**Exports (9 categories):**

| Category        | Exports                                                                                                | Used By                        |
| --------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Orchestration   | `runCronIsolatedAgentTurn`, `loadProviderUsageSummary`, `deliverOutboundPayloads`, `createDefaultDeps` | goal-loop, planner, researcher |
| Discord buttons | `registerDiscordButton`, `DiscordButtonSpec`                                                           | trend-scout, researcher        |
| Gateway client  | `GatewayClient`, `GATEWAY_CLIENT_MODES`, `GATEWAY_CLIENT_NAMES`                                        | researcher                     |
| Discord REST    | `createDiscordClient`                                                                                  | researcher                     |
| Logging         | `logDebug`, `logError`                                                                                 | trend-scout, researcher        |
| Security        | `wrapExternalContent`, `detectSuspiciousPatterns`                                                      | (available for all)            |
| Protocol        | `EventFrame` type                                                                                      | researcher                     |

**Import pattern in extensions:**

```typescript
// Upstream types (no fork patches)
import type { OpenClawConfig } from "openclaw/plugin-sdk";

// Fork-specific orchestration APIs
import { runCronIsolatedAgentTurn } from "openclaw/extension-bridge";
```

**Core bridge files (per-extension wrappers):**

- `extensions/goal-loop/src/core-bridge.ts`
- `extensions/planner/src/core-bridge.ts`
- `extensions/researcher/src/core-bridge.ts`

All three follow identical structure: import from `openclaw/extension-bridge`, re-export with fork-specific type aliases, provide `loadCoreDeps()` function for dependency injection.

---

## Discord Integration

### Component Registry (`src/discord/monitor/component-registry.ts`)

Solves the jiti/dist `instanceof` mismatch by implementing a spec-based button registry:

1. Extension calls `registerDiscordButton(spec)` with a plain `DiscordButtonSpec` object
2. Specs stored in `globalThis.__openclaw_discord_button_specs__` (shared between jiti and bundled code)
3. Discord provider calls `drainDiscordButtonSpecs()` at startup
4. Real `@buape/carbon` `Button` subclass instances created from specs using the **bundled** class
5. Carbon's `ComponentHandler` receives proper `instanceof Button === true`

**Button implementations:**

| Extension   | Button             | Custom ID Pattern                                          | Action                      |
| ----------- | ------------------ | ---------------------------------------------------------- | --------------------------- |
| trend-scout | Scout proposal     | `scoutprop:id={proposalId};action={approve\|reject\|info}` | Approve → spawn planner     |
| researcher  | Interview question | `researchq:id={researchId};q={qIdx};o={optIdx}`            | Select answer, submit, skip |

### Discord Monitor (`src/discord/monitor/`)

20 files handling message processing, threading, presence, allowlists, approval buttons, and reply delivery. The fork adds:

- `component-registry.ts` — Button spec registry (new file)
- Provider integration to call `drainDiscordButtonSpecs()` at startup

---

## Dashboard

**Location:** `~/projects/openclawd-dashboard/` (separate repo, local-only)

### Key files:

| File                               | Purpose                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `src/lib/data.ts`                  | Data fetching from `~/.openclaw/` (goals, plans, cron, agents, sessions)       |
| `src/lib/usage.ts`                 | Token usage aggregation from session stores                                    |
| `src/lib/mission.ts`               | Mission types and aggregation (goals + plans + research as unified "missions") |
| `src/lib/mission-types.ts`         | Mission types (client-safe, no server-only imports)                            |
| `src/lib/actions.ts`               | Server actions (CLI execution via child processes)                             |
| `src/app/layout.tsx`               | Navigation, theme, sidebar                                                     |
| `src/components/command/`          | Command Center (Kanban board) components                                       |
| `src/components/tabs/QuotaTab.tsx` | Token usage by source + daily chart                                            |

### Routes:

| Route         | Purpose                                        |
| ------------- | ---------------------------------------------- |
| `/command`    | Unified Kanban board (goals/plans/research)    |
| `/goals/[id]` | Goal detail with iterations, evaluations, logs |
| `/plans/[id]` | Plan detail with task DAG, worker results      |
| `/agents`     | Agent management, SOUL editing, tool call logs |
| `/analytics`  | Usage charts, cost breakdown, quota tab        |
| `/automation` | Templates, webhooks, chains                    |
| `/cron`       | Cron job management                            |
| `/system`     | System health, gateway status                  |
| `/security`   | Security posture                               |
| `/trends`     | Trend scout results                            |

---

## External Ecosystem

### Configuration (`~/.openclaw/`)

```
~/.openclaw/
├── openclaw.json           # Main config (providers, agents, plugins)
├── .secrets.env            # API keys (chmod 600)
├── goal-loop/
│   └── goals.json          # Goal state persistence
├── planner/
│   └── plans.json          # Plan state persistence
├── agents/
│   ├── main/sessions/      # Main agent sessions
│   ├── researcher/sessions/
│   ├── executor/sessions/  # Planner worker sessions
│   ├── qa/sessions/        # Evaluator sessions
│   └── {agent-id}/sessions/
├── workspace/              # Main agent workspace (git-tracked)
│   └── memory/
│       ├── knowledge/      # Shared knowledge base
│       ├── scout-proposals/
│       └── improvement-ideas.md
├── workspace-{agent-id}/   # Per-agent workspaces
│   └── SOUL.md
├── automation/
│   ├── webhooks.json
│   ├── chains.json
│   └── templates/
├── scout-proposals/
│   └── registry.json
└── extensions/
    └── goal-skill/         # Discord goal-starting skill
```

### CLI Wrappers

| Wrapper            | Location                          | Purpose                          |
| ------------------ | --------------------------------- | -------------------------------- |
| `openclaw`         | `~/.npm-global/bin/openclaw`      | Gateway CLI (points to dev tree) |
| `openclaw-goal`    | `/usr/local/bin/openclaw-goal`    | Goal-loop CLI wrapper            |
| `openclaw-planner` | `/usr/local/bin/openclaw-planner` | Planner CLI wrapper              |

### Systemd Service

```ini
# ~/.config/systemd/user/openclaw-gateway.service.d/dev-tree.conf
[Service]
ExecStart=
ExecStart=/home/azureuser/openclaw/dist/cli/index.js gateway run --bind loopback --port 18789
```

---

## Upstream Dependencies

### What we use from OpenClaw core:

| Component            | What we use                                                              | Our dependency level                                    |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Pi Agent Runner**  | `runCronIsolatedAgentTurn()` — isolated agent execution with tool access | CRITICAL — every agent turn goes through this           |
| **Session Store**    | JSONL session files with token tracking                                  | HIGH — all persistence and cost attribution reads these |
| **Browser Tool**     | Puppeteer/Playwright automation with snapshot                            | HIGH — browser-heavy tasks (travel, research)           |
| **Gateway API**      | WebSocket RPC for real-time communication                                | MEDIUM — dashboard and inter-extension communication    |
| **Model Auth**       | Provider key resolution (40+ providers)                                  | MEDIUM — we use Azure OpenAI primarily                  |
| **Plugin SDK**       | Plugin registration, service lifecycle, CLI registration                 | MEDIUM — all extensions use this interface              |
| **Discord Provider** | Carbon-based Discord bot with message routing                            | MEDIUM — primary user interface                         |
| **Exec Tool**        | Shell command execution in agent context                                 | HIGH — goal-loop workers use exec for all tasks         |
| **Read/Write Tools** | File system access in agent context                                      | HIGH — workspace file operations                        |
| **Compaction**       | `estimateMessagesTokens()` for token estimation                          | LOW — fallback only                                     |

### What we DON'T use:

- Telegram, Slack, Signal, iMessage, WhatsApp channels
- Web provider (browser-based chat UI)
- Voice call extension
- MS Teams, Matrix, Zalo extensions
- Media pipeline
- Mobile apps (iOS, Android)
- macOS menu bar app
- Canvas/A2UI

### Providers in use:

| Provider     | Model      | Purpose                                             |
| ------------ | ---------- | --------------------------------------------------- |
| Azure OpenAI | GPT-5-mini | Primary agent model (all goal-loop/planner workers) |
| Azure OpenAI | GPT-4.1    | Evaluator model                                     |

---

## Patch Maintenance Risk

| Patch                            | Files                                                                    | Upstream activity     | Merge conflict risk |
| -------------------------------- | ------------------------------------------------------------------------ | --------------------- | ------------------- |
| Token tracking (cron runner)     | `src/cron/isolated-agent/run.ts`                                         | Frequently refactored | **HIGH**            |
| Token tracking (embedded runner) | `src/agents/pi-embedded-runner/run.ts`                                   | Frequently refactored | **HIGH**            |
| Browser snapshot cap             | `src/agents/tools/browser-tool.ts`                                       | Evolves regularly     | **MEDIUM**          |
| Usage attribution                | `src/gateway/server-methods/usage.ts`, `src/infra/session-cost-usage.ts` | Rarely touched        | **LOW**             |
| Extension bridge                 | `src/extension-bridge/`, `tsdown.config.ts`, `package.json`              | Isolated files        | **LOW**             |
| Model auth                       | `src/agents/model-auth.ts`                                               | Small, isolated       | **LOW**             |
| Plugin loader alias              | `src/plugins/loader.ts`                                                  | Occasionally updated  | **LOW**             |
