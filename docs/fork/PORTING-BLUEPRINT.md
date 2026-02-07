# Porting Blueprint: OpenClawd → .NET AgentHub

> Decision document for porting the agent orchestration system from the OpenClaw Node.js fork to a .NET/Semantic Kernel stack. What to keep, what to drop, and what to build differently.

---

## What We're Porting

We're not porting OpenClaw. We're porting **the agent orchestration layer we built on top of it**. OpenClaw is a messaging gateway — we need the orchestration patterns, not the gateway.

### Keep (principles and patterns)

| Concept                           | OpenClawd Implementation                       | .NET Target                           |
| --------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Goal-directed execution loop      | `extensions/goal-loop/`                        | Semantic Kernel agent loop            |
| Task decomposition DAG            | `extensions/planner/`                          | SK planner with parallel execution    |
| Progress evaluation               | Separate evaluator model call                  | Same — independent model for scoring  |
| Stall detection                   | Score delta threshold over N evaluations       | Same algorithm                        |
| Budget governance                 | Token/iteration/time limits per goal           | Same — enforce at orchestrator level  |
| Token tracking                    | Accumulated per-turn, with estimation fallback | First-class in SK (already built-in)  |
| Tool result capping               | 80K char max on browser snapshots              | Apply to all tool outputs             |
| File-based state persistence      | JSON files with atomic writes                  | SQLite or similar (upgrade from JSON) |
| Event-driven automation           | `fireEvent()` → webhooks, chains, Discord      | .NET event bus → webhooks, Discord    |
| Agent personality (SOUL)          | Markdown system prompts per agent              | Same — markdown SOUL files            |
| Spec-based component registration | Plain objects instead of class instances       | N/A (no jiti boundary in .NET)        |

### Drop (OpenClaw-specific)

| Component                  | Why drop it                                          |
| -------------------------- | ---------------------------------------------------- |
| Carbon/Discord framework   | Use Discord.NET or direct REST API instead           |
| jiti runtime transpilation | .NET compiles ahead of time — no instanceof issues   |
| Plugin SDK lifecycle       | Build native .NET dependency injection               |
| Gateway WebSocket RPC      | Use ASP.NET SignalR or gRPC                          |
| JSONL session format       | Use structured database (SQLite/Postgres)            |
| Browser via Puppeteer      | Use Playwright .NET or headless browser service      |
| Extension bridge pattern   | Not needed — .NET has proper DI and assembly loading |

### Redesign (learned from OpenClaw's gaps)

| Gap in OpenClaw                        | .NET Design                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| No session compaction for tool results | Implement context window management: mark tool results as "consumed" after extraction, compact on next turn |
| No per-tool output size limits         | Configurable `MaxOutputChars` per tool type in agent config                                                 |
| No mid-stream budget abort             | Use `CancellationToken` propagation through SK pipeline                                                     |
| No tool result interception            | Middleware pipeline for tool outputs (filter, transform, cap)                                               |
| Provider usage normalization           | Unified `ITokenCounter` interface with provider-specific adapters                                           |

---

## Architecture: .NET AgentHub

```
┌──────────────────────────────────────────────────────┐
│                   Discord.NET Bot                      │
│              (or HTTP API / SignalR)                    │
├──────────────┬───────────┬───────────────────────────┤
│  GoalRunner  │ Planner   │  TrendScout               │
│              │ Scheduler │  ResearchFlow              │
├──────────────┴───────────┴───────────────────────────┤
│              Agent Orchestration Layer                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Budget   │ │ Eval     │ │ Context  │ │ Event   │ │
│  │ Governor │ │ Engine   │ │ Manager  │ │ Bus     │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
├──────────────────────────────────────────────────────┤
│              Semantic Kernel                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Chat     │ │ Plugins  │ │ Memory   │ │ Planners│ │
│  │ Complete │ │ (tools)  │ │ Store    │ │         │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
├──────────────────────────────────────────────────────┤
│         Azure OpenAI / Other Providers                 │
└──────────────────────────────────────────────────────┘
```

---

## Component Mapping

### 1. Goal Runner (replaces `extensions/goal-loop/`)

**Semantic Kernel approach:** Use `AgentGroupChat` or a custom `Agent` subclass with an iterative execution pattern.

```csharp
public class GoalRunner
{
    private readonly Kernel _kernel;
    private readonly IGoalStore _store;
    private readonly IBudgetGovernor _governor;
    private readonly IEvaluationEngine _evaluator;

    public async Task<GoalResult> RunAsync(Goal goal, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            // 1. Budget check
            if (!_governor.CanContinue(goal)) break;

            // 2. Execute agent turn
            var turn = await ExecuteTurnAsync(goal, ct);
            goal.Usage.TotalTokens += turn.TokenUsage.Total;
            goal.Iterations.Add(turn);

            // 3. Evaluate every N iterations
            if (goal.Iterations.Count % goal.Config.EvalEveryN == 0)
            {
                var eval = await _evaluator.EvaluateAsync(goal, ct);
                goal.Evaluations.Add(eval);

                if (eval.Score >= goal.Config.CompletionThreshold)
                    return GoalResult.Completed(goal);

                if (IsStalled(goal))
                    return GoalResult.Stalled(goal);
            }

            // 4. Persist state
            await _store.SaveAsync(goal);

            // 5. Sleep between iterations
            await Task.Delay(goal.Config.SleepBetweenMs, ct);
        }
        return GoalResult.Stopped(goal);
    }
}
```

**Key differences from OpenClaw:**

- `CancellationToken` propagation instead of manual budget checks
- SK's built-in token tracking (`ChatMessageContent.Metadata["Usage"]`) instead of our estimation hack
- Proper DI instead of `loadCoreDeps()` bridge pattern
- `IGoalStore` interface (SQLite implementation) instead of JSON file

### 2. Planner (replaces `extensions/planner/`)

**Semantic Kernel approach:** Use SK's `FunctionCallingStepwisePlanner` or `HandlebarsPlanner` as the decomposition engine, then our own DAG scheduler for parallel execution.

```csharp
public class TaskDagScheduler
{
    public async Task<PlanResult> ExecuteAsync(Plan plan, CancellationToken ct)
    {
        while (plan.HasPendingTasks)
        {
            var readyTasks = plan.GetReadyTasks(); // all deps met
            var batch = readyTasks.Take(plan.Config.MaxConcurrency);

            var results = await Task.WhenAll(
                batch.Select(t => ExecuteWorkerAsync(t, ct))
            );

            foreach (var result in results)
            {
                plan.Usage.TotalTokens += result.TokenUsage.Total;
                if (result.Failed && ShouldReplan(plan))
                    await ReplanAsync(plan, ct);
            }

            await _store.SaveAsync(plan);
        }

        return await EvaluateAsync(plan, ct);
    }
}
```

**Parallel execution:** `Task.WhenAll` with configurable concurrency via `SemaphoreSlim` — much cleaner than OpenClaw's callback-based approach.

### 3. Budget Governor (replaces `governance.ts` in each extension)

Centralized instead of duplicated per-extension:

```csharp
public interface IBudgetGovernor
{
    bool CanContinue(IHasBudget entity);
    void RecordUsage(IHasBudget entity, TokenUsage usage);
}

public class BudgetGovernor : IBudgetGovernor
{
    public bool CanContinue(IHasBudget entity)
    {
        if (entity.Usage.TotalTokens >= entity.Config.MaxTokens) return false;
        if (entity.Usage.TotalIterations >= entity.Config.MaxIterations) return false;
        if (entity.ElapsedMs >= entity.Config.MaxTimeMs) return false;
        if (_quotaService.GetUsagePercent() > entity.Config.ProviderThreshold) return false;
        return true;
    }
}
```

### 4. Tool Output Management (NEW — not in OpenClaw)

```csharp
public class ToolOutputMiddleware : IToolMiddleware
{
    private readonly Dictionary<string, int> _maxCharsPerTool;

    public async Task<ToolResult> ProcessAsync(ToolResult result, ToolContext context)
    {
        // 1. Enforce per-tool size limits
        var maxChars = _maxCharsPerTool.GetValueOrDefault(context.ToolName, 80_000);
        if (result.Content.Length > maxChars)
            result = result.Truncate(maxChars);

        // 2. Mark as "consumed" after model processes it
        // (for future compaction)
        result.Metadata["Consumable"] = true;

        return result;
    }
}
```

### 5. Context Window Manager (NEW — not in OpenClaw)

```csharp
public class ContextWindowManager
{
    private readonly int _maxContextTokens;

    public ChatHistory Compact(ChatHistory history)
    {
        var totalTokens = EstimateTokens(history);
        if (totalTokens < _maxContextTokens * 0.8) return history;

        // Remove consumed tool results (keep summary)
        foreach (var msg in history.Where(m => m.Metadata.ContainsKey("Consumable")))
        {
            msg.Content = $"[Tool result consumed - {msg.Metadata["ToolName"]}]";
        }

        // If still over budget, summarize older turns
        if (EstimateTokens(history) > _maxContextTokens * 0.9)
        {
            var oldTurns = history.Take(history.Count / 2);
            var summary = await SummarizeAsync(oldTurns);
            history.RemoveRange(0, oldTurns.Count);
            history.Insert(0, new ChatMessageContent(AuthorRole.System, summary));
        }

        return history;
    }
}
```

---

## Integration Porting

### Discord

**OpenClaw:** Carbon framework (TypeScript) with `instanceof` workarounds

**AgentHub:** Discord.NET (mature, well-maintained)

```csharp
// No instanceof issues, no spec pattern needed
public class GoalApproveButton : IComponentInteraction
{
    [ComponentInteraction("goal-approve:*")]
    public async Task HandleAsync(SocketMessageComponent component)
    {
        var goalId = component.Data.CustomId.Split(':')[1];
        await _goalRunner.ApproveAsync(goalId);
        await component.UpdateAsync(msg => msg.Content = "Goal approved");
    }
}
```

### Browser Automation

**OpenClaw:** Puppeteer (Node.js) with custom snapshot logic, unbounded ARIA tree dumps

**AgentHub:** Playwright .NET with built-in output capping

```csharp
public class BrowserTool : ISemanticKernelPlugin
{
    [KernelFunction("browser_snapshot")]
    public async Task<string> SnapshotAsync(string url, int maxChars = 80_000)
    {
        var page = await _browser.NewPageAsync();
        await page.GotoAsync(url);
        var content = await page.GetAriaSnapshotAsync();

        // ALWAYS cap output
        return content.Length > maxChars
            ? content[..maxChars] + "\n...(truncated)"
            : content;
    }
}
```

### Session Storage

**OpenClaw:** JSONL files per session, JSON files for goals/plans

**AgentHub:** SQLite with Entity Framework Core

```csharp
public class AgentHubDbContext : DbContext
{
    public DbSet<Goal> Goals { get; set; }
    public DbSet<Plan> Plans { get; set; }
    public DbSet<AgentSession> Sessions { get; set; }
    public DbSet<TokenUsageEntry> TokenUsage { get; set; }
    public DbSet<AutomationEvent> Events { get; set; }
}
```

Benefits: proper queries, transactions, migrations, no file-watching hacks.

### Event System

**OpenClaw:** `fireEvent()` function in automation extension, JSON webhooks

**AgentHub:** MediatR or .NET event bus

```csharp
// Publish
await _mediator.Publish(new GoalCompletedEvent(goal));

// Handle (webhook)
public class WebhookHandler : INotificationHandler<GoalCompletedEvent>
{
    public async Task Handle(GoalCompletedEvent evt, CancellationToken ct)
    {
        await _httpClient.PostAsJsonAsync(webhook.Url, evt);
    }
}

// Handle (Discord notification)
public class DiscordNotifier : INotificationHandler<GoalCompletedEvent>
{
    public async Task Handle(GoalCompletedEvent evt, CancellationToken ct)
    {
        await _discord.SendMessageAsync(channel, $"Goal completed: {evt.Goal.Title}");
    }
}
```

---

## What We Gain

| Area                       | OpenClaw (current)                   | .NET AgentHub (target)                         |
| -------------------------- | ------------------------------------ | ---------------------------------------------- |
| **Token tracking**         | Fork patch, estimation fallback      | Built into SK, per-call metering               |
| **Budget enforcement**     | Extension-level, no mid-stream abort | CancellationToken propagation                  |
| **Tool output management** | 80K hardcoded cap, one core patch    | Configurable middleware pipeline               |
| **Context compaction**     | No tool result cleanup               | Context window manager with consumable marking |
| **State persistence**      | JSON files, manual atomic writes     | SQLite with EF Core migrations                 |
| **Parallel execution**     | Callback-based, error-prone          | `Task.WhenAll` + `SemaphoreSlim`               |
| **Dependency injection**   | Manual `loadCoreDeps()` bridge       | Native .NET DI container                       |
| **Extension loading**      | jiti + instanceof workarounds        | .NET assembly loading (no boundary issues)     |
| **Discord integration**    | Carbon + spec pattern                | Discord.NET (mature, direct)                   |
| **Upstream risk**          | 5 core patches, merge conflicts      | We own the full stack                          |
| **Type safety**            | TypeScript (good)                    | C# (excellent — no `any`, proper generics)     |

---

## What We Lose

| Loss                                                     | Mitigation                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| OpenClaw's multi-channel support (Telegram, Slack, etc.) | Only using Discord — not a loss                                    |
| Community plugins                                        | Not using any upstream plugins beyond core                         |
| Pi agent's tool ecosystem                                | Reimplement needed tools as SK plugins (exec, read/write, browser) |
| Browser stealth/anti-detection                           | Playwright .NET has equivalent capabilities                        |
| Rapid upstream improvements                              | We spend more time fixing merge conflicts than benefiting          |

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

- Set up .NET project with Semantic Kernel
- Implement `GoalRunner` with basic execution loop
- Implement `BudgetGovernor`
- Implement SQLite persistence with EF Core
- Basic CLI for goal management

### Phase 2: Planning (Week 2-3)

- Implement `TaskDagScheduler`
- Implement parallel worker execution
- Implement replan-on-failure logic
- Implement evaluation engine

### Phase 3: Tools (Week 3-4)

- Implement tool output middleware
- Port exec tool (shell commands) as SK plugin
- Port file read/write as SK plugins
- Port browser tool with Playwright .NET + output capping
- Implement context window manager

### Phase 4: Discord (Week 4-5)

- Discord.NET bot setup
- Command handlers (goal start/stop, plan start/stop)
- Notification system
- Interactive buttons (approve/reject)

### Phase 5: Advanced (Week 5-6)

- Trend scout migration
- Research flow with interview system
- Agent packs (SOUL loading)
- Automation (webhooks, chains, event bus)
- Dashboard API endpoints

---

## Files to Reference During Port

These are the most important files to study when implementing each component:

### Goal Runner

- `extensions/goal-loop/src/loop-engine.ts` — Core loop algorithm
- `extensions/goal-loop/src/evaluator.ts` — Evaluation scoring
- `extensions/goal-loop/src/governance.ts` — Budget checks
- `extensions/goal-loop/src/types.ts` — Data structures

### Planner

- `extensions/planner/src/orchestrator.ts` — Orchestration flow
- `extensions/planner/src/scheduler.ts` — DAG scheduling
- `extensions/planner/src/worker-agent.ts` — Worker execution
- `extensions/planner/src/types.ts` — Data structures

### Token Management

- `src/cron/isolated-agent/run.ts` — Token capture and estimation
- `src/infra/session-cost-usage.ts` — Cost aggregation by source
- `src/agents/pi-embedded-runner/run.ts` — Token estimation fallback

### Browser

- `src/agents/tools/browser-tool.ts` — Snapshot capping logic
- `src/browser/constants.ts` — Default caps (80K chars)

### Automation

- `extensions/automation/src/index.ts` — Event system
- `extensions/automation/src/webhooks.ts` — Webhook dispatch
- `extensions/automation/src/chains.ts` — Chain evaluation
