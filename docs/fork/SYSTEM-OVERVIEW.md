# OpenClawd System Overview

> Complete reference for the OpenClawd AI agent orchestration platform.

## What Is OpenClawd?

OpenClawd is a **self-hosted AI agent orchestration platform** built as a fork of the open-source [OpenClaw](https://github.com/openclaw/openclaw) personal AI gateway. It transforms a single gateway process into a fleet of **24+ specialized AI agents**, each with persistent memory, isolated workspaces, and autonomous goal-pursuit capabilities.

The system adds ~10,200 lines of extension code (plus ~11K lines of docs, deploy scripts, and skills) across 6 custom extensions on top of OpenClaw's base, enabling:

- **Autonomous goal loops** with iterative execution and LLM evaluation
- **DAG-based task planning** with parallel worker agents
- **Interview-driven product generation** (research + PRD + auto-launch)
- **Real-time trend monitoring** across HN, Reddit, and GitHub
- **Pre-built personality teams** (18 agents across 6 thematic packs)
- **Event-driven automation** with webhooks, chains, and templates

All accessible through **Discord** and a **local-first Mission Control Dashboard**.

## What Is OpenClaw (Upstream)?

OpenClaw is an open-source personal AI assistant gateway. At its core, it provides:

| Capability                  | Description                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Multi-channel messaging** | 20+ channels: WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Google Chat, MS Teams, Matrix, and more |
| **AI provider integration** | Anthropic (Claude), OpenAI, Azure OpenAI, Bedrock, Ollama, Qwen, MiniMax, and custom providers              |
| **Agent runtime**           | Shell commands, file I/O, browser automation, canvas editing, memory search                                 |
| **Multi-agent support**     | Multiple isolated agents per gateway with per-agent workspaces, sessions, tools                             |
| **Plugin system**           | Extensible via npm-installable plugins for channels, tools, and services                                    |
| **Always-on daemon**        | Runs as systemd (Linux) or launchd (macOS) service                                                          |
| **Local-first**             | Everything runs on your machine, no cloud dependency                                                        |

### Architecture

```
[Messaging Channels]           [Control Clients]
  Discord, Telegram,             CLI, Web UI,
  WhatsApp, Slack...             macOS/iOS/Android apps
         |                              |
         v                              v
    +------------------------------------+
    |     Gateway (WebSocket Server)     |  Port 18789
    |     Token-based auth, loopback     |
    +------------------------------------+
         |            |            |
    +----v----+  +----v----+  +---v----+
    | Agent   |  | Agent   |  | Agent  |
    | Runtime |  | Runtime |  | Runtime|
    | (main)  |  | (travel)|  | (exec) |
    +---------+  +---------+  +--------+
         |
    +----v----+
    | Tools:  |
    | exec, read, write, browser,
    | memory_search, sessions_spawn,
    | sessions_send, canvas, camera
    +---------+
```

### Supported Channels

**Built-in (core):** WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Google Chat, MS Teams, WebChat

**Extension channels:** BlueBubbles, Matrix, Zalo, Mattermost, Nextcloud Talk, Line, Feishu, Tlon, Nostr, Twitch

### Agent Tools

| Tool                      | Capability                           |
| ------------------------- | ------------------------------------ |
| `exec`                    | Shell command execution              |
| `read` / `write` / `edit` | File system operations               |
| `browser`                 | Playwright-based web automation      |
| `canvas`                  | Agent-editable HTML (A2UI framework) |
| `memory_search`           | Embeddings-based semantic memory     |
| `sessions_spawn`          | Background subagent execution        |
| `sessions_send`           | Agent-to-agent messaging             |
| `llm_task`                | Delegate LLM subtasks                |
| `camera`                  | Device camera access (nodes only)    |

### Plugin System

OpenClaw's plugin system supports:

- **Channel plugins** (messaging integrations)
- **Skill plugins** (custom agent capabilities)
- **Provider plugins** (AI model backends)
- **Service plugins** (background services)

Plugins are loaded at runtime via `jiti` (TypeScript transpiler), discovered through npm or local directories, and configured via `openclaw.json`.

## How OpenClawd Extends OpenClaw

OpenClawd adds 6 custom extensions plus 10 core patches:

| Layer                      | Contents                                                             | Lines   |
| -------------------------- | -------------------------------------------------------------------- | ------- |
| **Custom Extensions (6)**  | goal-loop, planner, researcher, trend-scout, agent-packs, automation | ~10,200 |
| **Core Patches (2 files)** | Extension bridge (39 lines), component registry (82 lines)           | ~120    |
| **Fork Docs**              | Architecture, security, agents, extensions, roadmap                  | ~9,500  |
| **Deploy Scripts**         | Docker, backup, systemd configs                                      | ~970    |
| **External Skills (3)**    | goal-skill, plan-skill, research-skill (Discord agent wrappers)      | ~430    |

### Extension Bridge Pattern

Extensions import from two paths:

- `openclaw/plugin-sdk` — Standard upstream types (zero fork modifications)
- `openclaw/extension-bridge` — Fork-specific orchestration APIs

This keeps the upstream plugin-sdk completely clean, minimizing merge conflicts.

### The jiti/dist instanceof Pattern

Extensions loaded via jiti resolve `@buape/carbon` from `node_modules/`. The built gateway bundles its own copy. Since these are different class objects, `instanceof` checks fail across boundaries. The solution: extensions register plain spec objects (not class instances), and core code creates proper instances from the bundled class.

## Related Documents

| Document                                                     | Purpose                                          |
| ------------------------------------------------------------ | ------------------------------------------------ |
| [EXTENSIONS-DEEP-DIVE.md](./EXTENSIONS-DEEP-DIVE.md)         | Detailed architecture of all 6 custom extensions |
| [AGENT-ECOSYSTEM.md](./AGENT-ECOSYSTEM.md)                   | All 24 agents, routing, communication, souls     |
| [SECURITY-ANALYSIS.md](./SECURITY-ANALYSIS.md)               | Vulnerabilities, threat model, recommendations   |
| [DASHBOARD.md](./DASHBOARD.md)                               | Mission Control Dashboard reference              |
| [AUTOMATION-AND-WORKFLOWS.md](./AUTOMATION-AND-WORKFLOWS.md) | Webhooks, chains, templates, event system        |
| [COMPARISON-AND-DECISION.md](./COMPARISON-AND-DECISION.md)   | OpenClawd vs alternatives, migration analysis    |
| [VISION-AND-ROADMAP.md](./VISION-AND-ROADMAP.md)             | Future possibilities and strategic direction     |
| [AGENTS-GUIDE.md](./AGENTS-GUIDE.md)                         | Creating and configuring agents                  |
| [PACKAGING-AUDIT.md](./PACKAGING-AUDIT.md)                   | Fork organization and packaging readiness        |
