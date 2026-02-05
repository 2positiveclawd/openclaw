# Fork Organization & Packaging Audit

> **Agent requirement:** When adding, removing, or restructuring fork-specific code (extensions, core patches, Discord additions, deploy files, skills), update this document to reflect the changes. Keep it in sync with reality.

This document maps every piece of fork-specific code in `2positiveclawd/openclaw` relative to upstream `openclaw/openclaw`. It serves as the source of truth for what we own, where it lives, and what needs to happen to package the fork as a distributable starter kit.

Last audited: 2026-02-05

---

## Architecture Overview

The fork adds ~17K lines across 5 layers. Only 10 core files are patched.

```
Layer 1: Custom Extensions    (self-contained, no conflict)     ~12K lines
Layer 2: Core Patches         (minimal, documented)             ~85 lines across 11 files
Layer 3: Discord Additions    (moved to extensions)             ~150 lines (scripts only)
Layer 4: Supporting Files     (isolated directories)            ~2,800 lines
Layer 5: External Ecosystem   (outside repo, runtime only)      config + state
```

---

## Layer 1: Custom Extensions

All registered in `pnpm-workspace.yaml` as workspace packages. None exist upstream.

| Extension       | Location                  | Lines  | Purpose                                                                                                    |
| --------------- | ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| **goal-loop**   | `extensions/goal-loop/`   | ~2,500 | Autonomous goal-directed agent loops with budget controls, evaluation, stall detection, quality gates      |
| **planner**     | `extensions/planner/`     | ~2,800 | Task DAG decomposition, parallel execution, replanning on failure, worker/evaluator isolation              |
| **researcher**  | `extensions/researcher/`  | ~2,700 | Multi-round user interviews, PRD generation, automatic planner integration, Discord interview buttons      |
| **trend-scout** | `extensions/trend-scout/` | ~1,700 | Daily scans of HN/Reddit/GitHub, scheduled execution, HTTP status routes, Discord scout proposal buttons   |
| **agent-packs** | `extensions/agent-packs/` | ~1,200 | 18 pre-built agents in 6 thematic packs (Content Creator, Dev Team, Solopreneur, Fitness, Health, Finance) |
| **automation**  | `extensions/automation/`  | ~1,000 | Webhooks, event chains, Discord notifications, learning system                                             |

### Extension Structure Pattern

```
extensions/{name}/
  package.json            # name, version, devDeps (openclaw: workspace:*)
  openclaw.plugin.json    # Plugin metadata, config schema, CLI commands
  index.ts                # Entry point
  tsconfig.json           # (some extensions)
  src/
    core-bridge.ts        # Plugin-SDK imports (goal-loop, planner, researcher only)
    cli.ts                # CLI subcommand implementation
    *-service.ts          # Core service logic
    types.ts              # Type definitions
```

### Dependency Pattern

- `devDependencies`: `"openclaw": "workspace:*"` (build-time only)
- `peerDependencies`: `"openclaw": "*"` (runtime resolution via jiti alias)
- NO runtime `dependencies` on openclaw (npm install breaks with `workspace:*`)

### Agent IDs Used by Extensions

| Extension  | Agent IDs                                                    |
| ---------- | ------------------------------------------------------------ |
| goal-loop  | `main` (default)                                             |
| planner    | `planner` (planning), `executor` (workers), `qa` (evaluator) |
| researcher | `researcher`                                                 |

**Conflict Risk: NONE** — extensions don't exist upstream.

**Packaging status: READY** — self-contained workspace packages.

---

## Layer 2: Core Patches

Documented in detail in `docs/fork/LOCAL-PATCHES.md`. Summary:

### Patch 1: Plugin-SDK Extension Bridge (~20 lines)

**File:** `src/plugin-sdk/index.ts` (end of file)

Exports core functions for extensions: `runCronIsolatedAgentTurn`, `loadProviderUsageSummary`, `deliverOutboundPayloads`, `createDefaultDeps`, `registerDiscordComponentFactory`, `GatewayClient`, `GATEWAY_CLIENT_MODES/NAMES`, `createDiscordClient`, `logDebug/logError`, `EventFrame`.

**Conflict risk:** LOW — appended at end of file.

### Patch 1b: Discord Component Registry (1 new file)

**File:** `src/discord/monitor/component-registry.ts` (NEW, 35 lines)

Generic registry that allows extensions to register Discord button components. Extensions call `registerDiscordComponentFactory()` during plugin registration; the Discord provider calls `drainDiscordComponentFactories()` when building the Carbon Client.

**Conflict risk:** NONE — new file, not in upstream.

### Patch 2: Browser Stealth Mode (~24 lines across 5 files + 1 new file)

| File                          | Change                                                   |
| ----------------------------- | -------------------------------------------------------- |
| `src/browser/stealth.ts`      | NEW — all stealth logic (162 lines)                      |
| `src/config/types.browser.ts` | Add `stealth?: boolean`, `proxy?: string` (+4 lines)     |
| `src/config/zod-schema.ts`    | Add stealth/proxy to zod schema (+2 lines)               |
| `src/browser/config.ts`       | Add to `ResolvedBrowserConfig` + resolution (+6 lines)   |
| `src/browser/chrome.ts`       | Import + stealth/proxy flags in `spawnOnce()` (+8 lines) |
| `src/browser/pw-session.ts`   | Import + call `applyStealthToContext()` (+5 lines)       |

**Added dependencies:** `fingerprint-generator`, `fingerprint-injector`, `user-agents`

**Conflict risk:** LOW — small additive patches.

### Patch 3: Gateway Client Protocol (+7 lines)

**File:** `src/gateway/client.ts` — minor additions for extension event routing.

**Conflict risk:** MEDIUM — if upstream refactors gateway protocol.

**Packaging status: NEEDS WORK** — these patches must be applied on top of upstream. Should be formalized as `.patch` files or submitted as upstream PRs.

---

## Layer 3: Discord Additions

Formerly mixed into `src/discord/` (core code). **Refactored 2026-02-05:** Button components moved to their natural extensions; `provider.ts` now uses a generic component registry.

### Moved to Extensions (DONE)

| Originally                                    | Moved To                                         | Purpose                                                             |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| `src/discord/monitor/scout-proposals.ts`      | `extensions/trend-scout/src/discord-buttons.ts`  | Interactive buttons for Scout proposal approval/rejection           |
| `src/discord/monitor/researcher-questions.ts` | `extensions/researcher/src/discord-questions.ts` | Sends researcher interview questions as Discord embeds with buttons |

### Remaining Fork Files

| File                              | Change                                                        | Lines                           |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------- |
| `src/discord/monitor/provider.ts` | Uses `drainDiscordComponentFactories()` for extension buttons | +3 (generic, not fork-specific) |
| `src/discord/resolve-channels.ts` | Minor additions                                               | +4                              |
| `scripts/scout-notify.ts`         | Standalone script to send pending proposals to Discord        | ~146                            |

### Pattern

Extensions register button factories via `registerDiscordComponentFactory()` during plugin load. The Discord provider drains the registry when building the Carbon Client. This is a generic mechanism — no fork-specific imports in `provider.ts`.

**Conflict risk:** LOW — `provider.ts` change is generic (1 import + 1 drain call), not fork-specific.

**Packaging status: DONE** — Discord buttons now live in their natural extensions. Only `scripts/scout-notify.ts` remains in the scripts directory (it's a standalone CLI tool, not a runtime component).

---

## Layer 4: Supporting Files

### Fork Documentation (`docs/fork/`)

| File                 | Lines     | Purpose                                   |
| -------------------- | --------- | ----------------------------------------- |
| `LOCAL-PATCHES.md`   | 175       | Patch maintenance instructions            |
| `DASHBOARD.md`       | ~230      | Mission Control Dashboard docs            |
| `AGENTS-GUIDE.md`    | ~676      | Multi-agent architecture guide            |
| `SCOUT-SPEC-SHIP.md` | ~531      | System improvement playbook               |
| `PACKAGING-AUDIT.md` | this file | Fork organization and packaging readiness |

**Conflict risk: NONE** — isolated directory.

### Deployment Infrastructure (`deploy/`)

| File                                  | Purpose                         |
| ------------------------------------- | ------------------------------- |
| `Dockerfile.gateway`                  | Gateway Docker image (84 lines) |
| `docker-compose.gateway.yml`          | Compose config (113 lines)      |
| `backup.sh`, `restore.sh`             | Backup/restore scripts          |
| `install-backup-cron.sh`              | Cron installer                  |
| `migrate-config.sh`                   | Config migration                |
| `.env.example`, `secrets.env.example` | Template configs                |
| `README.md`, `.gitignore`             | Docs                            |

**Conflict risk: NONE** — upstream doesn't have `deploy/`.

### Custom Scripts

| File                      | Purpose                         |
| ------------------------- | ------------------------------- |
| `scripts/scout-notify.ts` | Send Scout proposals to Discord |

**Conflict risk: NONE** — new files.

**Packaging status: READY** — already isolated.

---

## Layer 5: External Ecosystem (Outside Repo)

These components live outside the git repo at runtime. A starter kit needs to bootstrap them.

### Configuration (`~/.openclaw/`)

| Component   | Location                    | Purpose                                       |
| ----------- | --------------------------- | --------------------------------------------- |
| Main config | `openclaw.json` (825 lines) | 24 agents, bindings, plugins, provider config |
| Secrets     | `.secrets.env` (chmod 600)  | API keys (Azure, Discord, Notion, etc.)       |

### Skill Plugins (`~/.openclaw/extensions/`)

| Skill             | Purpose                                      | Wraps                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------ |
| `goal-skill/`     | `/skill goal` command for Discord agents     | `openclaw-goal start/stop/status/list/resume`          |
| `plan-skill/`     | `/skill plan` command for Discord agents     | `openclaw-planner start/stop/status/list/tasks/resume` |
| `research-skill/` | `/skill research` command for Discord agents | Researcher interviews, PRD generation                  |

**These are NOT in the git repo.** For packaging, they should either be included in the repo or generated by a setup script.

### State Directories (`~/.openclaw/`)

| Directory               | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `goal-loop/`            | Goals state (`goals.json`) + per-goal session logs |
| `planner/`              | Plans state (`plans.json`) + per-plan task logs    |
| `researcher/`           | Research state (`researches.json`) + session logs  |
| `prds/`                 | Product Requirement Documents (7 PRDs)             |
| `scout-proposals/`      | Scout proposal registry (`registry.json`)          |
| `agents/{id}/sessions/` | Per-agent session logs (JSONL)                     |
| `workspace-{id}/`       | Per-agent workspaces (24 directories)              |

### System Wrappers

| Path                              | Points To                                          |
| --------------------------------- | -------------------------------------------------- |
| `~/.npm-global/bin/openclaw`      | Dev tree (`/home/azureuser/openclaw/openclaw.mjs`) |
| `/usr/local/bin/openclaw-goal`    | Dev tree goal subcommand                           |
| `/usr/local/bin/openclaw-planner` | Dev tree planner subcommand                        |

### Systemd Override

`~/.config/systemd/user/openclaw-gateway.service.d/dev-tree.conf` forces gateway to use dev tree.

### Dashboard (Separate Repo)

`~/projects/openclawd-dashboard/` — Next.js app, reads `~/.openclaw/` state files. Local only.

**Packaging status: NEEDS SETUP SCRIPT** — a bootstrap script should create directories, install skills, generate template config, create wrappers.

---

## Packaging Readiness Summary

| Layer              | Status              | Action Needed                                  |
| ------------------ | ------------------- | ---------------------------------------------- |
| Extensions         | READY               | Already self-contained workspace packages      |
| Core Patches       | NEEDS FORMALIZATION | Create `.patch` files or upstream PRs          |
| Discord Additions  | DONE                | Moved to extensions via component registry     |
| Supporting Files   | READY               | Already isolated in `docs/fork/` and `deploy/` |
| External Ecosystem | NEEDS BOOTSTRAP     | Create `setup.sh` for skills, config, wrappers |

### Target Package Structure

```
openclawd-starter/
  extensions/                # 6 custom extensions (already clean)
    goal-loop/
    planner/
    researcher/
    trend-scout/
    agent-packs/
    automation/
  skills/                    # Move from ~/.openclaw/extensions/
    goal-skill/
    plan-skill/
    research-skill/
  patches/                   # Formalized core patches
    plugin-sdk-bridge.patch
    browser-stealth.patch
  deploy/                    # Already exists
  docs/fork/                 # Already exists
  templates/                 # Template configs for new installs
    openclaw.json.template
    secrets.env.template
    souls/                   # Agent soul templates
  setup.sh                   # Bootstrap script
  README.md
```

### Blockers for Distribution

1. ~~**Discord monitor code in core**~~ — **DONE** (2026-02-05): moved to `extensions/trend-scout/` and `extensions/researcher/` via component registry
2. **Plugin-SDK bridge patch** — biggest coupling point; needs upstream PR or formal patch
3. **Skills outside repo** — `goal-skill`, `plan-skill`, `research-skill` need to be in git
4. **No setup script** — need `setup.sh` to bootstrap `~/.openclaw/` structure
5. **Agent souls in code** — 18 souls inline in `packs-registry.ts`; should be separate files for customization
