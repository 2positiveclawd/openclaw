# OpenClawd Documentation Index

> Complete documentation for the OpenClawd AI agent orchestration platform.

## Quick Start

- [SYSTEM-OVERVIEW.md](./SYSTEM-OVERVIEW.md) -- Start here. What OpenClaw is, what OpenClawd adds, and how it all fits together.
- [SETUP.md](./SETUP.md) -- Bootstrap installation guide.
- [QUICKSTART-HOWTO.md](./QUICKSTART-HOWTO.md) -- Getting started quickly.

## Architecture

| Document                                             | Description                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [SYSTEM-OVERVIEW.md](./SYSTEM-OVERVIEW.md)           | Core platform, channels, providers, agent runtime, plugin system                              |
| [EXTENSIONS-DEEP-DIVE.md](./EXTENSIONS-DEEP-DIVE.md) | All 6 custom extensions: goal loop, planner, researcher, trend scout, agent packs, automation |
| [AGENT-ECOSYSTEM.md](./AGENT-ECOSYSTEM.md)           | All 24 agents, routing, multi-agent communication, soul system, memory                        |
| [PACKAGING-AUDIT.md](./PACKAGING-AUDIT.md)           | Fork organization map, core patches, packaging readiness                                      |
| [LOCAL-PATCHES.md](./LOCAL-PATCHES.md)               | Patches to maintain after upstream merge                                                      |

## Operations

| Document                                                     | Description                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| [DASHBOARD.md](./DASHBOARD.md)                               | Mission Control Dashboard: Kanban, analytics, agent management |
| [AUTOMATION-AND-WORKFLOWS.md](./AUTOMATION-AND-WORKFLOWS.md) | Templates, webhooks, chains, event-driven execution            |
| [AGENTS-GUIDE.md](./AGENTS-GUIDE.md)                         | Creating and configuring new agents                            |
| [SCOUT-SPEC-SHIP.md](./SCOUT-SPEC-SHIP.md)                   | System improvement playbook                                    |

## Security

| Document                                       | Description                                             |
| ---------------------------------------------- | ------------------------------------------------------- |
| [SECURITY-ANALYSIS.md](./SECURITY-ANALYSIS.md) | Vulnerability assessment, threat model, recommendations |

## Decision Making

| Document                                                   | Description                                        |
| ---------------------------------------------------------- | -------------------------------------------------- |
| [COMPARISON-AND-DECISION.md](./COMPARISON-AND-DECISION.md) | OpenClawd vs alternatives, should you consolidate? |
| [VISION-AND-ROADMAP.md](./VISION-AND-ROADMAP.md)           | Future possibilities, roadmap, technical debt      |

## Reference

| Document                                         | Description                                       |
| ------------------------------------------------ | ------------------------------------------------- |
| [PRODUCT-FEATURES.md](./PRODUCT-FEATURES.md)     | Product features and technical reference          |
| [SETUP-SCRIPT-NOTES.md](./SETUP-SCRIPT-NOTES.md) | Expected directory tree and packaging constraints |

---

## System at a Glance

```
OpenClawd Platform
|
+-- OpenClaw Gateway (upstream, open-source)
|     Port 18789, systemd service, loopback-bound
|     20+ messaging channels, multi-model AI providers
|     Plugin system, agent runtime, tool execution
|
+-- 6 Custom Extensions (~17K lines)
|     goal-loop      Autonomous iterative goal execution
|     planner        DAG task decomposition + parallel workers
|     researcher     Interview-driven PRD generation
|     trend-scout    Daily HN/Reddit/GitHub trend monitoring
|     agent-packs    18 pre-built agent personas
|     automation     Webhooks, chains, event-driven flows
|
+-- 24 Agents
|     6 system agents (main, travel, researcher, executor, qa, planner)
|     18 pack agents (content, dev, solopreneur, fitness, health, finance)
|     Each with: isolated workspace, SOUL personality, persistent memory
|
+-- Mission Control Dashboard (local, Next.js)
|     /command        Unified Kanban board
|     /analytics      Usage and cost tracking
|     /agents         Agent management
|     /automation     Templates, webhooks, chains
|
+-- Discord Interface
      24 dedicated channels (one per agent)
      Interactive buttons (proposals, interviews, approvals)
      Allowlist security
```

## Key Runtime Paths

| Path                                     | Content                                          |
| ---------------------------------------- | ------------------------------------------------ |
| `/home/azureuser/openclaw/`              | Source code (dev tree)                           |
| `~/.openclaw/openclaw.json`              | Master configuration                             |
| `~/.openclaw/.secrets.env`               | API keys and tokens                              |
| `~/.openclaw/agents/{id}/sessions/`      | Agent session logs                               |
| `~/.openclaw/workspace-{id}/`            | Agent workspaces                                 |
| `~/.openclaw/goal-loop/goals.json`       | Goal loop state                                  |
| `~/.openclaw/planner/plans.json`         | Planner state                                    |
| `~/.openclaw/researcher/researches.json` | Research state                                   |
| `~/.openclaw/prds/`                      | Generated PRD documents                          |
| `~/.openclaw/dashboard/`                 | Automation configs (templates, webhooks, chains) |
| `~/projects/openclawd-dashboard/`        | Dashboard source code                            |
