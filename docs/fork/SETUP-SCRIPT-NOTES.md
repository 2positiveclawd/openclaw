# setup.sh notes (expected tree + packaging constraints)

## Expected package tree (from PACKAGING-AUDIT.md)

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
  deploy/
  docs/fork/
  templates/
    openclaw.json.template
    secrets.env.template
    souls/
  setup.sh
  README.md
```

## Packaging constraints (from PACKAGING-AUDIT.md)

- Core patches must be formalized as `.patch` files or upstream PRs (plugin-sdk bridge, browser stealth, gateway protocol).
- Skills live outside the repo today; packaging must include them or have setup.sh generate/copy them into `~/.openclaw/extensions/`.
- External ecosystem must be bootstrapped by setup.sh: config, secrets, state directories, wrappers, systemd override.
- Agent souls are referenced via `extensions/agent-packs/src/packs-registry.ts` (soulFile paths). Souls should be on-disk files for customization.

## Directories setup.sh must create

- `~/.openclaw/`
- `~/.openclaw/extensions/`
- `~/.openclaw/extensions/goal-skill/`
- `~/.openclaw/extensions/plan-skill/`
- `~/.openclaw/extensions/research-skill/`
- `~/.openclaw/goal-loop/`
- `~/.openclaw/planner/`
- `~/.openclaw/researcher/`
- `~/.openclaw/prds/`
- `~/.openclaw/scout-proposals/`
- `~/.openclaw/agents/`
- `~/.openclaw/agents/main/sessions/`
- `~/.openclaw/agents/travel/sessions/`
- `~/.openclaw/agents/researcher/sessions/`
- `~/.openclaw/agents/executor/sessions/`
- `~/.openclaw/agents/qa/sessions/`
- `~/.openclaw/agents/mia-strategist/sessions/`
- `~/.openclaw/agents/blake-scriptwriter/sessions/`
- `~/.openclaw/agents/jordan-social/sessions/`
- `~/.openclaw/agents/marcus-techlead/sessions/`
- `~/.openclaw/agents/elena-reviewer/sessions/`
- `~/.openclaw/agents/sam-docs/sessions/`
- `~/.openclaw/agents/claire-assistant/sessions/`
- `~/.openclaw/agents/leo-researcher/sessions/`
- `~/.openclaw/agents/harper-outreach/sessions/`
- `~/.openclaw/agents/noah-coach/sessions/`
- `~/.openclaw/agents/nina-nutrition/sessions/`
- `~/.openclaw/agents/ethan-accountability/sessions/`
- `~/.openclaw/agents/olivia-wellness/sessions/`
- `~/.openclaw/agents/mason-sleep/sessions/`
- `~/.openclaw/agents/priya-habits/sessions/`
- `~/.openclaw/agents/sophia-invoices/sessions/`
- `~/.openclaw/agents/liam-expenses/sessions/`
- `~/.openclaw/agents/nora-tax/sessions/`
- `~/.openclaw/agents/ba-product/sessions/`
- `~/.openclaw/agents/designer-ux/sessions/`
- `~/.openclaw/agents/travel/agent/` (from openclaw.json `agentDir`)
- `~/.openclaw/agents/researcher/agent/`
- `~/.openclaw/agents/executor/agent/`
- `~/.openclaw/agents/qa/agent/`
- `~/.openclaw/workspace/` (default workspace in openclaw.json)
- `~/.openclaw/workspace-travel/`
- `~/.openclaw/workspace-researcher/`
- `~/.openclaw/workspace-executor/`
- `~/.openclaw/workspace-qa/`
- `~/.openclaw/workspace-mia-strategist/`
- `~/.openclaw/workspace-blake-scriptwriter/`
- `~/.openclaw/workspace-jordan-social/`
- `~/.openclaw/workspace-marcus-techlead/`
- `~/.openclaw/workspace-elena-reviewer/`
- `~/.openclaw/workspace-sam-docs/`
- `~/.openclaw/workspace-claire-assistant/`
- `~/.openclaw/workspace-leo-researcher/`
- `~/.openclaw/workspace-harper-outreach/`
- `~/.openclaw/workspace-noah-coach/`
- `~/.openclaw/workspace-nina-nutrition/`
- `~/.openclaw/workspace-ethan-accountability/`
- `~/.openclaw/workspace-olivia-wellness/`
- `~/.openclaw/workspace-mason-sleep/`
- `~/.openclaw/workspace-priya-habits/`
- `~/.openclaw/workspace-sophia-invoices/`
- `~/.openclaw/workspace-liam-expenses/`
- `~/.openclaw/workspace-nora-tax/`
- `~/.openclaw/workspace-ba-product/`
- `~/.openclaw/workspace-designer-ux/`
- `~/.config/systemd/user/openclaw-gateway.service.d/`

## Files setup.sh must create/copy (with destinations)

- `~/.openclaw/openclaw.json` (template source: `templates/openclaw.json.template`)
- `~/.openclaw/.secrets.env` (template source: `templates/secrets.env.template`, chmod 600)
- Skill plugin files copied into `~/.openclaw/extensions/`:
  - `~/.openclaw/extensions/goal-skill/index.ts`
  - `~/.openclaw/extensions/goal-skill/openclaw.plugin.json`
  - `~/.openclaw/extensions/goal-skill/package.json`
  - `~/.openclaw/extensions/goal-skill/skills/goal/SKILL.md`
  - `~/.openclaw/extensions/plan-skill/index.ts`
  - `~/.openclaw/extensions/plan-skill/openclaw.plugin.json`
  - `~/.openclaw/extensions/plan-skill/package.json`
  - `~/.openclaw/extensions/plan-skill/skills/plan/SKILL.md`
  - `~/.openclaw/extensions/research-skill/index.ts`
  - `~/.openclaw/extensions/research-skill/openclaw.plugin.json`
  - `~/.openclaw/extensions/research-skill/package.json`
  - `~/.openclaw/extensions/research-skill/skills/research/SKILL.md`
- Soul files copied into workspaces (from `extensions/agent-packs/packs/<pack>/`):
  - `content-creator/mia-strategist.md` → `~/.openclaw/workspace-mia-strategist/SOUL.md`
  - `content-creator/blake-scriptwriter.md` → `~/.openclaw/workspace-blake-scriptwriter/SOUL.md`
  - `content-creator/jordan-social.md` → `~/.openclaw/workspace-jordan-social/SOUL.md`
  - `dev-team/marcus-techlead.md` → `~/.openclaw/workspace-marcus-techlead/SOUL.md`
  - `dev-team/elena-reviewer.md` → `~/.openclaw/workspace-elena-reviewer/SOUL.md`
  - `dev-team/sam-docs.md` → `~/.openclaw/workspace-sam-docs/SOUL.md`
  - `solopreneur/claire-assistant.md` → `~/.openclaw/workspace-claire-assistant/SOUL.md`
  - `solopreneur/leo-researcher.md` → `~/.openclaw/workspace-leo-researcher/SOUL.md`
  - `solopreneur/harper-outreach.md` → `~/.openclaw/workspace-harper-outreach/SOUL.md`
  - `fitness-training/noah-coach.md` → `~/.openclaw/workspace-noah-coach/SOUL.md`
  - `fitness-training/nina-nutrition.md` → `~/.openclaw/workspace-nina-nutrition/SOUL.md`
  - `fitness-training/ethan-accountability.md` → `~/.openclaw/workspace-ethan-accountability/SOUL.md`
  - `health-wellness/olivia-wellness.md` → `~/.openclaw/workspace-olivia-wellness/SOUL.md`
  - `health-wellness/mason-sleep.md` → `~/.openclaw/workspace-mason-sleep/SOUL.md`
  - `health-wellness/priya-habits.md` → `~/.openclaw/workspace-priya-habits/SOUL.md`
  - `finance-taxes/sophia-invoices.md` → `~/.openclaw/workspace-sophia-invoices/SOUL.md`
  - `finance-taxes/liam-expenses.md` → `~/.openclaw/workspace-liam-expenses/SOUL.md`
  - `finance-taxes/nora-tax.md` → `~/.openclaw/workspace-nora-tax/SOUL.md`
- System wrappers:
  - `~/.npm-global/bin/openclaw` (wrapper/symlink pointing at repo `openclaw.mjs`)
  - `/usr/local/bin/openclaw-goal` (wrapper pointing at repo `openclaw.mjs goal`)
  - `/usr/local/bin/openclaw-planner` (wrapper pointing at repo `openclaw.mjs planner`)
- Systemd override:
  - `~/.config/systemd/user/openclaw-gateway.service.d/dev-tree.conf` with:
    - `ExecStart=/usr/bin/node /home/azureuser/openclaw/openclaw.mjs gateway --port 18789`

## Repo-relative paths wrappers/systemd override must point to

- `openclaw.mjs` at repo root (absolute path used in overrides: `/home/azureuser/openclaw/openclaw.mjs`).
- Agent soul sources under `extensions/agent-packs/packs/<pack>/<agent>.md`.
- Skill plugin sources (if moved into repo) under `skills/goal-skill`, `skills/plan-skill`, `skills/research-skill`.

## Idempotency rules (explicit) + summary output requirements

- Do **not** overwrite existing user files:
  - If `~/.openclaw/openclaw.json` exists, leave it untouched.
  - If `~/.openclaw/.secrets.env` exists, leave it untouched.
  - If any `SOUL.md` already exists in a workspace, leave it untouched.
  - If skill directories already exist under `~/.openclaw/extensions/`, do not overwrite their contents.
  - If wrappers or systemd override already exist, do not overwrite (print a “exists, skipped” line).
- Always use `mkdir -p` so directory creation is safe to re-run.
- Summary must print:
  - Created vs skipped counts for directories and files.
  - List of wrappers installed or skipped.
  - Whether systemd override was created or already present.

## Acceptance checklist (1–8)

1. [ ] `docs/fork/SETUP-SCRIPT-NOTES.md` exists in repo.
2. [ ] Notes include the target package tree from PACKAGING-AUDIT.
3. [ ] Notes enumerate all directories setup.sh must create (state + agents + workspaces + systemd override dir).
4. [ ] Notes enumerate all files setup.sh must create/copy (config, secrets, skills, souls, wrappers, systemd override).
5. [ ] Notes list repo-relative paths that wrappers/systemd override must point to.
6. [ ] Notes include explicit idempotency rules (no overwrite) for configs, souls, skills, wrappers, overrides.
7. [ ] Notes specify required summary output details (created/skipped counts + wrappers/override status).
8. [ ] Notes capture packaging constraints (skills outside repo, patches formalization, setup script required).
