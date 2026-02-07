# Agent Ecosystem

> Complete reference for all 24 agents, routing, communication, and personality system.

## Agent Roster

### System Agents (6)

| Agent ID     | Name       | Role                   | Model         | Tools                                      |
| ------------ | ---------- | ---------------------- | ------------- | ------------------------------------------ |
| `main`       | OpenClawd  | Default orchestrator   | gpt-5.2       | Full suite                                 |
| `travel`     | Travel     | Concierge, booking     | gpt-5.2       | Browser, web_search, delegation            |
| `researcher` | Researcher | Read-only research     | gpt-5.2       | read, web_search, web_fetch, memory_search |
| `executor`   | Executor   | Coding workhorse       | gpt-5.2-codex | read, write, edit, exec, browser, git      |
| `qa`         | QA         | Testing and evaluation | gpt-5.2       | read, exec, web_fetch, browser (read-only) |
| `planner`    | Planner    | Task decomposer        | gpt-5.2       | Internal use (orchestration)               |

### Agent Packs (18 agents in 6 packs)

#### Content Creator Pack

| Agent                | Name   | Role                 | Tools                             |
| -------------------- | ------ | -------------------- | --------------------------------- |
| `mia-strategist`     | Mia    | Content Strategist   | file-read, file-write, web-search |
| `blake-scriptwriter` | Blake  | Script Writer        | file-read, file-write             |
| `jordan-social`      | Jordan | Social Media Manager | file-read, file-write, web-search |

#### Dev Team Pack

| Agent             | Name   | Role          | Tools                       |
| ----------------- | ------ | ------------- | --------------------------- |
| `marcus-techlead` | Marcus | Tech Lead     | file-read, file-write, exec |
| `elena-reviewer`  | Elena  | Code Reviewer | file-read, file-write       |
| `sam-docs`        | Sam    | Documentation | file-read, file-write       |

#### Solopreneur Pack

| Agent              | Name   | Role                | Tools                             |
| ------------------ | ------ | ------------------- | --------------------------------- |
| `claire-assistant` | Claire | Executive Assistant | file-read, file-write, web-search |
| `leo-researcher`   | Leo    | Research Analyst    | file-read, file-write, web-search |
| `harper-outreach`  | Harper | Outreach Specialist | file-read, file-write, web-search |

#### Fitness Training Pack

| Agent                  | Name  | Role                 | Tools                 |
| ---------------------- | ----- | -------------------- | --------------------- |
| `noah-coach`           | Noah  | Training Coach       | file-read, file-write |
| `nina-nutrition`       | Nina  | Nutrition Coach      | file-read, file-write |
| `ethan-accountability` | Ethan | Accountability Coach | file-read, file-write |

#### Health & Wellness Pack

| Agent             | Name   | Role           | Tools                 |
| ----------------- | ------ | -------------- | --------------------- |
| `olivia-wellness` | Olivia | Wellness Coach | file-read, file-write |
| `mason-sleep`     | Mason  | Sleep Coach    | file-read, file-write |
| `priya-habits`    | Priya  | Habits Coach   | file-read, file-write |

#### Finance & Taxes Pack

| Agent             | Name   | Role            | Tools                 |
| ----------------- | ------ | --------------- | --------------------- |
| `sophia-invoices` | Sophia | Invoicing       | file-read, file-write |
| `liam-expenses`   | Liam   | Expense Tracker | file-read, file-write |
| `nora-tax`        | Nora   | Tax Planner     | file-read, file-write |

---

## Agent Architecture

Each agent is fully isolated with its own:

```
~/.openclaw/
  agents/{agent-id}/
    sessions/*.jsonl         # Conversation logs (JSONL)
  workspace-{agent-id}/
    SOUL.md                  # Personality and instructions
    TOOLS.md                 # Tool-specific notes (optional)
    IDENTITY.md              # Name and emoji (optional)
    (agent files...)         # Working files
```

### Agent Components

| Component     | Location                                   | Purpose                                                    |
| ------------- | ------------------------------------------ | ---------------------------------------------------------- |
| **Config**    | `~/.openclaw/openclaw.json`                | Agent definition, tool policies, model, subagent allowlist |
| **Sessions**  | `~/.openclaw/agents/{id}/sessions/*.jsonl` | Full conversation transcripts                              |
| **Workspace** | `~/.openclaw/workspace-{id}/`              | Isolated file system for agent work                        |
| **Soul**      | `{workspace}/SOUL.md`                      | Personality, rules, tone, boundaries                       |
| **Memory**    | SQLite + embeddings                        | Indexed SOUL + past sessions, searchable                   |

### Tool Policies

Agents have fine-grained tool access control:

```json
{
  "tools": {
    "allow": ["read", "web_search", "web_fetch", "memory_search"],
    "deny": ["write", "edit", "exec", "browser", "gateway", "cron"]
  }
}
```

**Examples:**

- **Researcher**: Read-only (no writes, no exec)
- **Executor**: Full coding (reads, writes, executes, tests)
- **QA**: Testing (read + exec, no writes)

---

## Routing and Channel Bindings

### Discord Routing

Each agent is bound to a specific Discord channel:

```
Discord Server
  + Content Creator (category)
    - #mia-strategist      --> agent: mia-strategist
    - #blake-scriptwriter   --> agent: blake-scriptwriter
    - #jordan-social        --> agent: jordan-social
  + Dev Team (category)
    - #marcus-techlead      --> agent: marcus-techlead
    - #elena-reviewer       --> agent: elena-reviewer
    - #sam-docs             --> agent: sam-docs
  + ... (4 more pack categories)
  + System
    - #main                 --> agent: main
    - #trend-scout          --> agent: trend-scout notifications
    - #notifications        --> goal/plan alert channel
```

### Routing Flow

```
Discord message arrives
  -> Gateway checks bindings[] in config
  -> Find binding where match.peer.id == channel ID
  -> Route to bound agentId
  -> Agent processes with isolated session + workspace
  -> Response sent back to channel
```

### Binding Configuration

```json
{
  "bindings": [
    {
      "agentId": "mia-strategist",
      "match": {
        "channel": "discord",
        "peer": { "kind": "channel", "id": "DISCORD_CHANNEL_ID" }
      }
    }
  ]
}
```

### Security

- **Allowlist enforcement**: Only whitelisted guild/channels can trigger agents
- **Mention requirement**: Some channels require @bot mention, others respond to all messages
- **DM allowlist**: Only specified users can DM the bot

---

## Multi-Agent Communication

### Subagent Spawning (`sessions_spawn`)

Spawn isolated background tasks on other agents:

```typescript
sessions_spawn({
  task: "Run the test suite and report results",
  agentId: "executor",
  model: "azure/gpt-5.2-codex",
  thinking: "high",
  runTimeoutSeconds: 600,
  cleanup: "keep", // or "delete"
});
```

**Governance:**

- Allowlists per agent: `agents[].subagents.allowAgents`
- Only top-level agents can spawn (no recursive spawning)
- Results announced back to the requester's session

### Agent-to-Agent Messaging (`sessions_send`)

Send messages to other agents' sessions:

```typescript
sessions_send({
  sessionKey: "agent:travel:primary",
  agentId: "travel",
  message: "Find flights to NYC next week",
  timeoutSeconds: 30,
});
```

**Governance:**

- Requires `tools.agentToAgent.enabled: true` in config
- Sandboxed agents can only message their spawned children

### Current Subagent Allowlists

```json
{
  "main": {
    "allowAgents": ["travel", "researcher", "executor", "qa", "ba-product", "designer-ux"]
  },
  "travel": { "allowAgents": ["researcher", "executor"] }
}
```

---

## Soul System (Personalities)

### What Is a SOUL?

Each agent has a `SOUL.md` file that defines its personality, rules, capabilities, and communication style. The SOUL is injected into every session as system context.

### Main Agent Soul (Key Principles)

1. **DO IT, DON'T DESCRIBE IT** -- Execute actions, don't describe what you would do
2. **FACTUALITY FIRST** -- Verify with `ls`, `cat`, `git status`. Say "I don't know" rather than guess
3. **NO WISHLISTS** -- Execute, don't list planned actions
4. **SPEC GATE** -- For ambiguous requests, create `CONTRACT.md` before building
5. **DELEGATION VIA SKILLS** -- Use `/skill goal`, `/skill plan`, `/skill research` for orchestration
6. **MEMORY-FIRST RESEARCH** -- Check `memory_search()` before `web_search()`

### Researcher Soul

- **Read-only**: No writes, no exec, no side effects
- **Focus**: Gather info, synthesize, recommend
- **Output**: Structured findings with sources

### Executor Soul

- **Focused coding workhorse**: Minimal chatter
- **Process**: Read, Execute, Report, Ask only if blocked
- **Verification**: Test before declaring done

### Travel Agent Soul

- **DECIDE, DON'T ASK**: Fill gaps with smart defaults
- **Single best option**: With reasoning, optional alternatives
- **Browser-first**: For live booking data

---

## Memory System

### How Memory Works

```
Agent writes to workspace files
  -> SQLite indexes with embeddings (OpenAI text-embedding-3-small)
  -> memory_search(query) returns relevant context from indexed files
```

### Configuration

```json
{
  "memorySearch": {
    "enabled": true,
    "sources": ["memory", "sessions"],
    "provider": "openai",
    "fallback": "local",
    "sync": { "onSessionStart": true, "watch": true, "intervalMinutes": 60 },
    "query": { "maxResults": 10, "minScore": 0.5 }
  }
}
```

### Shared Knowledge Structure

```
~/.openclaw/workspace/memory/
  knowledge/
    searches/               # Web search caches
    browser/                # Booking screenshots, prices
    research/               # Deep research articles
  research-briefs/          # Post-research summaries
  scout-proposals/          # Improvement ideas
  improvement-ideas.md      # System improvement backlog
  playbooks/                # Reusable procedures
```

### Research Tiers

1. **Tier 1 (Free)**: `memory_search()`, `web_fetch()`, `browser()`, file reads
2. **Tier 2 (Paid)**: `web_search()` (Brave API, limited queries/month)

**Rule**: After every web_search or research, save findings to `memory/knowledge/` for sharing across agents.

---

## Heartbeat System

```json
{
  "heartbeat": {
    "every": "2h",
    "activeHours": { "start": "08:00", "end": "23:00" },
    "model": "azure/gpt-5-nano"
  }
}
```

Periodic "wake up" checks to keep sessions alive, update memory indices, and scan for overdue tasks.

---

## Session Management

### Session Key Format

```
agent:{agentId}[:sessionType[:identifier]]
```

**Examples:**

- `agent:main:primary` -- Main agent primary session
- `agent:travel:label:booking-research` -- Labeled session
- `agent:executor:subagent:uuid-1234` -- Spawned subagent session

### Session Storage

Each session is a JSONL file at:

```
~/.openclaw/agents/{agentId}/sessions/{sessionId}.jsonl
```

### Visibility Rules

- Subagent sessions: Only visible to the spawner
- Label resolution: Find sessions by label + optional agentId
- Sandboxed mode: Agents only see their own spawned sessions
