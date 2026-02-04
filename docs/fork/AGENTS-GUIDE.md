# Creating New Agents in OpenClawd

This guide covers how to create, configure, and deploy new AI agents in the OpenClawd system.

## Agent Architecture Overview

Each agent in OpenClawd has:

| Component          | Purpose                                 | Location                            |
| ------------------ | --------------------------------------- | ----------------------------------- |
| **Identity**       | Name, emoji, description                | `~/.openclaw/openclaw.json`         |
| **Soul (SOUL.md)** | Personality, instructions, capabilities | Agent's workspace                   |
| **Workspace**      | Isolated file storage for the agent     | `~/.openclaw/workspace-{id}/`       |
| **Sessions**       | Conversation history and tool call logs | `~/.openclaw/agents/{id}/sessions/` |
| **Binding**        | Channel routing (Discord, etc.)         | `~/.openclaw/openclaw.json`         |

## Two Approaches

### 1. Agent Packs (Recommended for teams)

Use the **agent-packs** extension when creating multiple related agents as a cohesive team.

**Best for:** Themed agent teams, role-based workflows, reusable templates

### 2. Standalone Agents

Create individual agents directly in the config.

**Best for:** One-off agents, system agents, custom workflows

---

## Approach 1: Creating Agent Packs

### Step 1: Define the Pack in Registry

Edit `extensions/agent-packs/src/packs-registry.ts`:

```typescript
export const PACKS: PackDefinition[] = [
  // ... existing packs ...
  {
    id: "my-pack",
    name: "My Pack Name",
    description: "What this pack does",
    agents: [
      {
        id: "agent-one",
        name: "AgentOne",
        role: "Role Description",
        soulFile: "my-pack/agent-one.md",
        tools: ["file-read", "file-write", "web-search"],
      },
      {
        id: "agent-two",
        name: "AgentTwo",
        role: "Another Role",
        soulFile: "my-pack/agent-two.md",
        tools: ["file-read", "file-write", "exec"],
      },
    ],
  },
];
```

### Step 2: Create Soul Files

Create markdown files in `extensions/agent-packs/packs/{pack-id}/`:

```markdown
# AgentOne — Role Description

You are AgentOne, a [role] who [primary function].

## Core Philosophy

- Key principle 1
- Key principle 2
- Key principle 3

## Your Responsibilities

### 1. Primary Task

- Specific duty
- How you approach it
- Expected outcomes

### 2. Secondary Task

- Details...

## How You Work

- Communication style
- Decision-making approach
- Collaboration patterns

## Tools You Use

- File read/write for [purpose]
- Web search for [purpose]
- Exec for [purpose]

## Output Style

- Formatting preferences
- Tone and voice
- Example patterns
```

### Step 3: Add to OpenClaw Config

Add agents to `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    list: [
      // ... existing agents ...
      {
        id: "agent-one",
        workspace: "/home/azureuser/.openclaw/workspace-agent-one",
        identity: {
          name: "AgentOne",
          emoji: "🎯",
        },
      },
      {
        id: "agent-two",
        workspace: "/home/azureuser/.openclaw/workspace-agent-two",
        identity: {
          name: "AgentTwo",
          emoji: "📊",
        },
      },
    ],
  },
}
```

### Step 4: Create Discord Channels (Optional)

If binding to Discord:

1. Create a category for the pack
2. Create channels for each agent (e.g., `#agent-one`, `#agent-two`)
3. Get channel IDs (Developer Mode → Right-click → Copy ID)

### Step 5: Add Bindings

Add to `bindings` array in `~/.openclaw/openclaw.json`:

```json5
{
  bindings: [
    // ... existing bindings ...
    {
      agentId: "agent-one",
      match: {
        channel: "discord",
        peer: { id: "CHANNEL_ID_HERE" },
      },
    },
    {
      agentId: "agent-two",
      match: {
        channel: "discord",
        peer: { id: "CHANNEL_ID_HERE" },
      },
    },
  ],
}
```

### Step 6: Create Directories

```bash
# Session directories (for tool call tracking)
mkdir -p ~/.openclaw/agents/agent-one/sessions
mkdir -p ~/.openclaw/agents/agent-two/sessions

# Workspaces
mkdir -p ~/.openclaw/workspace-agent-one
mkdir -p ~/.openclaw/workspace-agent-two

# Copy soul files to workspaces
cp extensions/agent-packs/packs/my-pack/agent-one.md ~/.openclaw/workspace-agent-one/SOUL.md
cp extensions/agent-packs/packs/my-pack/agent-two.md ~/.openclaw/workspace-agent-two/SOUL.md
```

### Step 7: Rebuild and Restart

```bash
cd ~/openclaw
pnpm build
systemctl --user restart openclaw-gateway
```

---

## Approach 2: Standalone Agents

### Step 1: Create Workspace and Soul

```bash
mkdir -p ~/.openclaw/workspace-myagent
mkdir -p ~/.openclaw/agents/myagent/sessions
```

Create `~/.openclaw/workspace-myagent/SOUL.md`:

```markdown
# MyAgent

You are MyAgent, specialized in [domain].

## Instructions

- How to behave
- What to focus on
- Constraints and guidelines
```

### Step 2: Add to Config

Edit `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    list: [
      // ... existing ...
      {
        id: "myagent",
        workspace: "/home/azureuser/.openclaw/workspace-myagent",
        identity: {
          name: "MyAgent",
          emoji: "🤖",
        },
      },
    ],
  },
  bindings: [
    // ... existing ...
    {
      agentId: "myagent",
      match: {
        channel: "discord",
        peer: { id: "DISCORD_CHANNEL_ID" },
      },
    },
  ],
}
```

### Step 3: Restart Gateway

```bash
systemctl --user restart openclaw-gateway
```

---

## Ack Reactions (Visual Feedback)

Each agent reacts with their emoji to messages **BEFORE** processing starts. This gives immediate visual feedback that the correct agent is handling the request.

Configure in `~/.openclaw/openclaw.json`:

```json5
{
  messages: {
    ackReactionScope: "group-mentions", // React in group channels when mentioned
    removeAckAfterReply: false, // Keep the reaction after responding
  },
}
```

The agent's emoji comes from their `identity.emoji` field. When a user sends a message:

1. Agent receives the message
2. Agent immediately reacts with their emoji (e.g., 📋 for Mia)
3. Agent starts typing/thinking
4. Agent sends response

This helps users know which agent is handling their request, especially useful when multiple agents are available.

---

## Configuration Reference

### Agent Definition

```json5
{
  id: "agent-id", // Unique identifier (lowercase, hyphens)
  workspace: "/path/to/workspace",
  soulPath: "/path/to/SOUL.md", // Optional, defaults to workspace/SOUL.md
  identity: {
    name: "Display Name",
    emoji: "🤖",
  },
}
```

### Binding Definition

```json5
{
  agentId: "agent-id",
  match: {
    channel: "discord", // Channel type
    peer: {
      id: "CHANNEL_ID", // Discord channel ID
    },
  },
}
```

### Tool Permissions

Available tools for agents:

| Tool         | Description               | Use When              |
| ------------ | ------------------------- | --------------------- |
| `file-read`  | Read files from workspace | Always safe           |
| `file-write` | Write files to workspace  | Content creation      |
| `exec`       | Execute shell commands    | Dev tools, automation |
| `web-search` | Search the internet       | Research agents       |
| `browser`    | Full browser automation   | Complex web tasks     |

---

## Multi-Agent Communication

Agents can communicate with each other using built-in tools. This enables delegation workflows where one agent spawns another to handle a subtask.

### Available Tools

| Tool             | Purpose                           | Direction      |
| ---------------- | --------------------------------- | -------------- |
| `sessions_spawn` | Spawn a subagent to handle a task | Parent → Child |
| `sessions_send`  | Send a message to another session | Any → Any      |

### How Delegation Works

1. **Parent agent** calls `sessions_spawn` with target `agentId` and task
2. **Child agent** runs in isolation with its own session
3. **Child completes** and automatically announces results back to parent
4. **Parent continues** with the child's findings

### Configuration: Subagent Allowlists

Control which agents can spawn which in `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    list: [
      {
        id: "mia-strategist",
        // ... other config ...
        subagents: {
          allowAgents: ["blake-scriptwriter", "jordan-social"],
        },
      },
    ],
  },
}
```

With this config, Mia can delegate to Blake or Jordan, but not to other agents.

### Visibility Policies

- **spawned** (default): Agent can only communicate with subagents it spawned
- **unrestricted**: Agent can message any session (use with caution)

### Example: Mia Delegates to Blake

```
User → Mia: "Create a content campaign for summer sale"
Mia (thinking): I'll handle strategy, delegate scripts to Blake
Mia → sessions_spawn(agentId: "blake-scriptwriter", task: "Write 3 video scripts for summer sale...")
Blake runs, writes scripts, saves to workspace
Blake → announces results back to Mia
Mia → User: "Here's the campaign plan with Blake's scripts attached..."
```

---

## Persistent Memory

Each agent has persistent memory that survives across sessions. This is enabled via vector embeddings + SQLite.

### What Gets Remembered

| Source             | Description                   |
| ------------------ | ----------------------------- |
| `MEMORY.md`        | Agent's workspace memory file |
| `sessions/*.jsonl` | Past conversation transcripts |

### Configuration

Memory search is configured in `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        sources: ["memory", "sessions"],
        provider: "openai", // Uses Azure embeddings
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
  },
}
```

### How It Works

1. **On session start**: Agent's memory index syncs (MEMORY.md + past sessions)
2. **During conversation**: Agent can semantically search past context
3. **Automatic**: No explicit "remember" command needed - indexed automatically

### Memory Isolation

Each agent has **isolated memory** - agents cannot search each other's memories. This preserves:

- Privacy between different user contexts
- Focused retrieval (no cross-contamination)
- Clear boundaries between agent domains

### Adding Persistent Notes

Create `~/.openclaw/workspace-{agent}/MEMORY.md`:

```markdown
# Agent Memory

## User Preferences

- Prefers concise responses
- Timezone: EST
- Communication style: direct

## Past Projects

- Summer 2025: Launched product X
- Q1 2026: Rebranded to Y

## Important Contacts

- Designer: Sarah (sarah@example.com)
- Developer: Mike
```

This file is automatically indexed and searchable by the agent.

---

## Routing and Bindings

Routing determines which agent handles incoming messages. Currently uses **static bindings** (1:1 channel-to-agent mapping).

### How Routing Works

```
Discord message arrives
    ↓
Gateway checks bindings[]
    ↓
Find binding where match.peer.id == channel ID
    ↓
Route to bound agentId
```

### Binding Priority (highest to lowest)

1. **Exact peer match** - Specific channel ID
2. **Parent peer match** - Thread inherits parent channel's agent
3. **Guild match** - Server-wide fallback
4. **Team match** - Workspace fallback (Slack)
5. **Account match** - Account-wide fallback
6. **Default agent** - `main` if nothing matches

### Current Limitation: No Intent-Based Routing

The system does **not** have smart routing that analyzes message content to pick the right agent. Each channel is hardwired to one agent.

**Example of what doesn't work:**

```
User in #general: "Help me with my taxes"
→ Routes to whatever agent is bound to #general
→ Does NOT auto-route to nora-tax based on intent
```

**Workaround:** Create dedicated channels per agent (which we do with agent packs).

### Future: Smart Router

A smart router extension could:

- Analyze incoming message intent
- Match to agent capabilities
- Route dynamically to best-fit agent
- Handle a single "general" channel that dispatches to specialists

This is not yet implemented.

---

## System Agents (Extensions)

Some agents are used by extensions for automated workflows:

| Agent ID     | Used By              | Purpose               |
| ------------ | -------------------- | --------------------- |
| `main`       | Gateway default      | Default Discord agent |
| `researcher` | Researcher extension | Web research tasks    |
| `planner`    | Planner extension    | Task decomposition    |
| `executor`   | Planner extension    | Task execution        |
| `qa`         | Planner extension    | Quality evaluation    |

These are created automatically but can be customized.

---

## Testing Your Agent

### 1. Verify Configuration

```bash
# Check agent is loaded
cat ~/.openclaw/openclaw.json | grep -A5 '"id": "your-agent"'

# Check binding exists
cat ~/.openclaw/openclaw.json | grep -A5 '"agentId": "your-agent"'
```

### 2. Check Session Directory

```bash
ls -la ~/.openclaw/agents/your-agent/sessions/
```

### 3. Test in Discord

Send a message in the bound channel. The agent should respond.

### 4. Verify in Dashboard

Visit `http://localhost:3000/agents/your-agent` to see:

- Soul/personality display
- Workspace files
- Recent tool calls
- Session count

---

## Troubleshooting

### Agent Not Responding

1. Check gateway logs: `journalctl --user -u openclaw-gateway -f`
2. Verify binding channel ID matches Discord
3. Ensure gateway was restarted after config changes

### Tool Calls Not Showing in Dashboard

1. Verify session directory exists: `~/.openclaw/agents/{id}/sessions/`
2. Check agent ID matches exactly (case-sensitive)
3. Wait for agent to make tool calls (not just text responses)

### Soul Not Loading

1. Check `soulPath` in config or `SOUL.md` in workspace
2. Verify file permissions are readable
3. Check for syntax errors in markdown

---

## Best Practices

### Naming Conventions

- **Agent IDs:** lowercase, hyphens, descriptive (e.g., `elena-reviewer`, `noah-coach`)
- **Workspaces:** Match agent ID (e.g., `workspace-elena-reviewer`)
- **Soul files:** `{name}-{role}.md` (e.g., `elena-reviewer.md`)

### Soul File Quality

- Start with clear identity statement
- Define explicit responsibilities
- Specify tools and when to use them
- Include output format preferences
- Add constraints and boundaries

### Organization

- Group related agents into packs
- Use consistent naming within packs
- Document pack purpose and workflow

---

## Current Agent Inventory

### Core System Agents

| ID           | Name       | Purpose               |
| ------------ | ---------- | --------------------- |
| `main`       | Main       | Default Discord agent |
| `travel`     | Travel     | Travel planning       |
| `researcher` | Researcher | Web research          |
| `executor`   | Executor   | Task execution        |
| `qa`         | QA         | Quality assurance     |
| `planner`    | Planner    | Task planning         |

### Agent Packs (18 agents)

| Pack              | Agents                                            |
| ----------------- | ------------------------------------------------- |
| Content Creator   | mia-strategist, blake-scriptwriter, jordan-social |
| Dev Team          | marcus-techlead, elena-reviewer, sam-docs         |
| Solopreneur       | claire-assistant, leo-researcher, harper-outreach |
| Fitness Training  | noah-coach, nina-nutrition, ethan-accountability  |
| Health & Wellness | olivia-wellness, mason-sleep, priya-habits        |
| Finance & Taxes   | sophia-invoices, liam-expenses, nora-tax          |

### Discord Channel Reference

Each pack has its own Discord category with channels for each agent:

| Pack                  | Category ID           | Agent                | Channel ID            | Emoji |
| --------------------- | --------------------- | -------------------- | --------------------- | ----- |
| **Content Creator**   | `1468554234088652802` | mia-strategist       | `1468554279093669888` | 📋    |
|                       |                       | blake-scriptwriter   | `1468554280414875700` | 🎬    |
|                       |                       | jordan-social        | `1468554281585213561` | 📱    |
| **Dev Team**          | `1468554337339838587` | marcus-techlead      | `1468554339449573521` | 🏗️    |
|                       |                       | elena-reviewer       | `1468554340783362151` | 🔍    |
|                       |                       | sam-docs             | `1468554342746427392` | 📚    |
| **Solopreneur**       | `1468554344268959826` | claire-assistant     | `1468554345468399738` | 📅    |
|                       |                       | leo-researcher       | `1468554347662020680` | 🔬    |
|                       |                       | harper-outreach      | `1468554348639555585` | ✉️    |
| **Fitness Training**  | `1468554427538473170` | noah-coach           | `1468554428670808066` | 💪    |
|                       |                       | nina-nutrition       | `1468554430138945580` | 🥗    |
|                       |                       | ethan-accountability | `1468554431363678343` | ✅    |
| **Health & Wellness** | `1468554432214990932` | olivia-wellness      | `1468554433242857671` | 🧘    |
|                       |                       | mason-sleep          | `1468554434538766398` | 😴    |
|                       |                       | priya-habits         | `1468554435553660939` | 🎯    |
| **Finance & Taxes**   | `1468554436636049509` | sophia-invoices      | `1468554437856464896` | 💵    |
|                       |                       | liam-expenses        | `1468554439173607651` | 🧾    |
|                       |                       | nora-tax             | `1468554440582893599` | 📊    |

---

## Related Documentation

- [Dashboard Guide](./DASHBOARD.md) - Monitoring agents in the dashboard
- [Local Patches](./LOCAL-PATCHES.md) - Extension maintenance
- [AGENTS.md](../../AGENTS.md) - Deployment overview
