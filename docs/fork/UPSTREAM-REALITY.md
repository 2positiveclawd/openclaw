# Building a Real Agent System on OpenClaw: What We Had to Fix

> A technical post-mortem on turning an open-source AI gateway into a production autonomous agent system. What worked, what was broken, and why you can't just `npm install` your way to AGI.

## The Promise vs. The Reality

OpenClaw is an open-source AI gateway that connects language models to messaging channels (Discord, Telegram, Slack) with tool access (browser, exec, file I/O). On paper, it's everything you need for an agent system: multi-model support, persistent sessions, a plugin SDK, and a browser automation stack.

We chose it as the foundation for OpenClawd — a 24-agent autonomous system with goal-directed execution loops, task decomposition planners, and a trend-monitoring scout. After several months of production use, here's the honest assessment: **OpenClaw is an excellent messaging gateway, but it's not an agent orchestration framework.** We had to build that layer ourselves, and in doing so, discovered fundamental architectural gaps that upstream can't easily fix.

---

## The Core Issues

### 1. No Token Tracking — The Agent System Was Flying Blind

The most basic requirement for any production agent system is knowing how much it costs. OpenClaw had **zero token tracking** for autonomous agent runs.

The embedded agent runner (`runCronIsolatedAgentTurn`) — the function that powers every background agent execution — returned results without any usage data. The model reported tokens, the session recorded them, but the orchestration layer never bubbled them up.

```typescript
// BEFORE: The return type had no tokenUsage field
return {
  output: pickSummaryFromOutput(result),
  messagesSnapshot: result.messagesSnapshot,
  // tokenUsage? Doesn't exist.
};
```

We had to:

- Add `tokenUsage` to all four return paths in `runCronIsolatedAgentTurn`
- Accumulate tokens in the goal-loop engine (`goal.usage.totalTokens`)
- Accumulate tokens across all planner phases (planner agent, workers, evaluator, replanner)
- Build a `usage.by-source` gateway endpoint for per-source attribution
- Add a dashboard Quota & Billing tab

After the fix, our first goal reported 19,628 tokens. All 22 previous goals showed 0.

**Worse**: some providers don't report tokens at all. OpenAI's Codex subscription API returns `{input: 0, output: 0, totalTokens: 0}` for every request. We had to add a **fallback estimator** in the core embedded runner that estimates tokens from conversation message content when the provider reports zero:

```typescript
if (!hasNonzeroUsage(usage) && !attempt.aborted && !attempt.promptError) {
  const estimated = estimateMessagesTokens(attempt.messagesSnapshot);
  if (estimated > 0) {
    const lastContent = attempt.assistantTexts.join("");
    const outputEst = Math.ceil(lastContent.length / 4) || Math.ceil(estimated * 0.3);
    const inputEst = Math.max(0, estimated - outputEst);
    usage = { input: inputEst, output: outputEst, total: estimated };
  }
}
```

This is a core patch. There's no extension point for it. If upstream refactors the embedded runner, we lose it.

### 2. The `instanceof` Trap — Extensions Can't Use Core Classes

This was the most insidious bug. Extensions are loaded at runtime via [jiti](https://github.com/unjs/jiti) (a TypeScript transpiler). When an extension imports `@buape/carbon` (the Discord framework), jiti resolves it from `node_modules/`. But the gateway's built `dist/` bundle includes its own copy of `@buape/carbon`. These are **different class instances** at the JavaScript level.

The result: `instanceof Button` returns `false` for buttons created in extension code, even though they're the exact same class. Carbon's `ComponentHandler` rejects them silently.

We spent hours debugging why Discord buttons registered by extensions simply didn't fire. The fix required a fundamental architectural change:

```typescript
// WRONG: Extension creates a Button subclass → instanceof fails in core
export class MyButton extends Button { ... }

// RIGHT: Extension registers a plain spec object
export function createMyButtonSpec(): DiscordButtonSpec {
  return {
    customId: "my-button",
    label: "Click me",
    style: ButtonStyle.Primary,
    run: async (interaction) => { ... },
  };
}

// Core creates the real Button from the spec using its own bundled class
function createButtonFromSpec(spec: DiscordButtonSpec): Button {
  return class extends Button {
    customId = spec.customId;
    // ...
  };
}
```

**Rule**: Never pass class instances from jiti-loaded extensions to bundled core code when `instanceof` checks are involved. Use plain objects/specs instead.

This pattern has to be replicated for every Carbon class we use across the extension boundary. It's fragile — any new upstream feature that adds `instanceof` checks will silently break extensions.

### 3. Browser Tool Returns Unbounded Page Content

This was a production cost disaster we discovered by analyzing a failed plan that consumed **679,000 tokens** for what should have been a 50,000-token task (finding hotel accommodations).

The root cause: when the browser tool's snapshot action is called with `labels: true` (which the model does by default for interactive pages), it goes through `snapshotRoleViaPlaywright` instead of `snapshotAiViaPlaywright`. The AI snapshot path has an 80,000-character cap. The role snapshot path has **no cap at all**.

A single Booking.com search results page returned **268,800 characters** (~67K tokens) of ARIA accessibility tree. The agent loaded 5 such pages in one session. Combined with context accumulation (each new page adds to the conversation), a single task consumed 206K tokens.

Across the 4 browser-heavy tasks in that plan:

- **32 snapshot results** over 10KB each
- **1.7 million characters** of browser page content
- **~427K tokens** wasted — **63% of the entire plan budget**

The fix was 8 lines in `browser-tool.ts`:

```typescript
const capChars = resolvedMaxChars ?? DEFAULT_AI_SNAPSHOT_MAX_CHARS;
const cappedText =
  typeof snapshot.snapshot === "string" && snapshot.snapshot.length > capChars
    ? `${snapshot.snapshot.slice(0, capChars)}\n...(snapshot truncated)...`
    : snapshot.snapshot;
```

This is core code. Extensions can't intercept tool results.

### 4. Goal-Loop Service Doesn't Detect New Goals

The goal-loop service only checked for running goals **at startup**. When the CLI wrote a new goal to `goals.json`, the running service never noticed. You had to restart the entire gateway for every new goal.

The fix: a `fs.watch` file watcher on `goals.json` with 500ms debounce:

```typescript
watcher = fs.watch(GOALS_FILE, () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(pickUpNewGoals, 500);
});
```

Simple, but it took us debugging "why does this goal have 0 iterations after 2 minutes?" to discover the gateway wasn't even trying to run it.

### 5. No Extension Bridge — Fork Patches in Plugin SDK

OpenClaw's plugin SDK (`openclaw/plugin-sdk`) exports types for plugin development. Our extensions need additional functions from core — `runCronIsolatedAgentTurn`, `registerDiscordButton`, `GatewayClient`, etc.

Initially, we patched `src/plugin-sdk/index.ts` to re-export these. Every `git pull` from upstream caused merge conflicts in this high-traffic file.

The solution: a dedicated **extension bridge** entry point at `src/extension-bridge/index.ts` with its own build target and package.json export. Extensions import from two paths:

```typescript
import type { OpenClawConfig } from "openclaw/plugin-sdk"; // upstream types
import { runCronIsolatedAgentTurn } from "openclaw/extension-bridge"; // fork functions
```

This keeps `src/plugin-sdk/index.ts` at **zero fork-specific exports** — no merge conflicts. But it requires maintaining a jiti alias in the plugin loader so extensions can resolve the import at runtime.

---

## What We Built on Top

With the core issues addressed, we built the actual agent system as extensions:

### Goal-Loop Engine (`extensions/goal-loop/`)

An autonomous execution loop: governance check → agent turn → record → evaluate → check terminal → sleep → repeat. Each iteration spawns an isolated agent with full tool access. Progress is evaluated by a separate model every N iterations, scoring 0-100 against acceptance criteria. Stall detection stops loops that aren't making progress. Budget controls prevent runaway spending.

### Planner Orchestrator (`extensions/planner/`)

Decomposes complex goals into a DAG of focused tasks. Executes workers in parallel (up to configurable concurrency), respecting dependency edges. If batch failure rate exceeds a threshold, spawns a replanner to restructure remaining tasks. Final evaluation scores the aggregate result.

### Researcher (`extensions/researcher/`)

A goal research framework with Discord-based interview questions. Generates PRDs from research findings and can launch planner executions from them.

### Trend Scout (`extensions/trend-scout/`)

Autonomous daily monitoring of HN, Reddit, and GitHub. LLM-based analysis identifies opportunities relevant to configured interests. Results stored in workspace memory with Discord notifications.

### Agent Packs (`extensions/agent-packs/`)

18 personality-configured agents organized into packs (Content Creator, Dev Team, Solopreneur, etc.), each with dedicated Discord channels and SOUL documents defining their behavior.

### Automation (`extensions/automation/`)

Event-driven webhooks and chains. Goal/plan lifecycle events trigger notifications, follow-up actions, and cross-extension coordination.

---

## The Upstream Dependency Risk

Every core patch we maintain is a liability:

| Patch                             | Risk                                  | Files                                                                    |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Token tracking in embedded runner | High — frequently refactored upstream | `src/agents/pi-embedded-runner/run.ts`                                   |
| Token tracking in cron runner     | High — same                           | `src/cron/isolated-agent/run.ts`                                         |
| Browser snapshot cap              | Medium — browser tool evolves         | `src/agents/tools/browser-tool.ts`                                       |
| Extension bridge entry point      | Low — isolated files                  | `src/extension-bridge/`, `tsdown.config.ts`, `package.json`              |
| Usage attribution endpoint        | Low — additive                        | `src/gateway/server-methods/usage.ts`, `src/infra/session-cost-usage.ts` |
| Model auth passthrough            | Low — small patch                     | `src/agents/model-auth.ts`                                               |

The high-risk patches touch files that upstream actively develops. A major refactor of the agent runner — which happens every few releases — means manual reapplication of our changes. The `instanceof` workaround requires vigilance: any new Carbon class used across the extension boundary will silently fail.

---

## What's Still Missing in Core

Things we need but can't build as extensions:

1. **Session compaction for tool results** — After the model extracts data from a browser page, the 80KB of page content stays in context forever. The conversation grows monotonically. Upstream's compaction logic doesn't distinguish between valuable context and spent tool results.

2. **Tool result size policies** — There's no per-tool or per-action size limit configuration. The 80KB snapshot cap is hardcoded. We need configurable limits per tool, per action, per agent.

3. **Agent-level budget enforcement** — Budget checks happen in our extension code, but the underlying agent loop has no concept of "stop after N tokens." If a single model call exceeds the remaining budget, there's no way to abort it mid-stream.

4. **Proper extension lifecycle** — Extensions can't register new tool types, modify existing tool behavior, or intercept tool results. The only extension point is the plugin SDK's service/command/skill registration. Everything else requires core patches.

5. **Provider usage reporting** — Different providers report usage differently (or not at all). There's no normalization layer. Our estimation fallback is a hack.

---

## Lessons Learned

1. **An AI gateway is not an agent framework.** Routing messages between channels and models is 10% of the problem. The other 90% is orchestration, budget control, progress evaluation, and tool result management.

2. **The `instanceof` boundary between runtime-loaded extensions and bundled core is fundamental.** Any framework that loads plugins at runtime via a different module resolution path will hit this. The only clean solution is a spec/factory pattern at every boundary.

3. **Token tracking must be first-class.** It can't be an afterthought or a plugin. Every execution path must report usage, and there must be a normalization layer for providers that don't.

4. **Browser automation needs hard output caps.** Language models will happily consume 268KB of DOM tree and charge you for it. The tool must protect the model from itself.

5. **File watching beats polling, but both beat "restart the gateway."** If your system persists state to files that external processes modify, watch those files.

---

## Where This Goes Next

We're evaluating porting the core principles — goal loops, DAG planners, budget governance, tool result management — to a .NET/Semantic Kernel stack where we control the full pipeline. The extensions work well, but maintaining a fork of an actively-developed Node.js project with 10+ core patches is unsustainable for a production system.

The question isn't whether OpenClaw is good software — it is. The question is whether an AI gateway designed for human-in-the-loop messaging is the right foundation for autonomous multi-agent orchestration. Our experience says no.
