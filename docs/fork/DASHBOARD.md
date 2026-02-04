# OpenClawd Mission Control Dashboard

Local-first monitoring and control dashboard for the OpenClawd AI agent system. The dashboard reads state directly from the filesystem and executes commands via CLI/Gateway API. No external database required.

**Location:** `~/projects/openclawd-dashboard`
**Repo:** `git@github.com:2positiveclawd/openclawd-dashboard.git`
**URL:** `http://localhost:3000` (local only, never deploy publicly)

## Quick Start

```bash
cd ~/projects/openclawd-dashboard
npm run dev
# Open http://localhost:3000
```

## Pages

| Route          | Page           | Description                                                         |
| -------------- | -------------- | ------------------------------------------------------------------- |
| `/command`     | Command Center | Unified Kanban board for all missions (goals, plans, research)      |
| `/`            | (redirect)     | Redirects to `/command`                                             |
| `/goals`       | (redirect)     | Redirects to `/command?type=goal`                                   |
| `/goals/[id]`  | Goal Detail    | Iteration timeline, evaluation history, criteria status             |
| `/plans`       | (redirect)     | Redirects to `/command?type=plan`                                   |
| `/plans/[id]`  | Plan Detail    | Task Kanban board, DAG visualization, budget gauges, phase stepper  |
| `/research`    | (redirect)     | Redirects to `/command?type=research`                               |
| `/prds`        | PRDs           | Product Requirement Documents rendered as markdown                  |
| `/agents`      | Agents         | Agent list, workspace info, session stats, SOUL.md viewer           |
| `/agents/[id]` | Agent Detail   | Full agent config, binding info, workspace files, recent tool calls |
| `/analytics`   | Analytics      | Daily usage charts, cost breakdown, performance metrics             |
| `/automation`  | Automation     | Templates, webhooks, chained execution rules                        |
| `/cron`        | Cron           | Scheduled jobs, enable/disable toggle, next run times               |
| `/system`      | System         | Gateway config, plugin status, registered agents                    |
| `/security`    | Security       | Security settings, allowlists, policy review                        |
| `/trends`      | Trends         | Trend tracking and analysis (if trend-scout enabled)                |

## Features

### Command Center (Kanban)

The `/command` page is the unified mission control for all agent operations:

- **5-Column Kanban:** Backlog | Active | Review | Done | Failed
- **Mission Types:** Goals, Plans, Research unified as "Missions"
- **Status Mapping:**
  - `running`, `planning`, `executing`, `researching`, `synthesizing` → **Active**
  - `interviewing`, `ready` → **Review** (awaiting input)
  - `completed`, `done`, `launched` → **Done**
  - `failed`, `budget_exceeded` → **Failed**
  - `stopped` → **Backlog** (resumable)
- **Agent Queues Sidebar:** Shows each agent's assigned work
- **Activity Feed:** Collapsible timeline of recent events
- **Type Filter:** Toggle between All / Goals / Plans / Research
- **Auto-refresh:** 5-second polling when active missions exist
- **Priority Badges:** Critical (errors), High (running/low score), Medium, Low

Each mission card shows:

- Type icon and ID
- Title (truncated)
- Progress bar
- Priority badge
- Score (if available)
- Error indicator
- Time since update

### Interactive Controls

- **Start Goal/Plan/Research:** "+ New" button expands forms with budget limits, criteria, notifications
- **Stop/Abandon:** Action buttons on running executions
- **Resume:** Resume stalled or stopped goals/plans
- **Launch Plan from Research:** One-click handoff from completed research PRD to planner

### Research Flow

When a research session is in "interviewing" phase, an inline form appears to submit answers to the agent's questions. Phases: `researching → interviewing → synthesizing → ready → launched`

### Plans Visualization

- **Phase Stepper:** Visual pipeline with CSS pulse on current phase
- **Task Board:** 6-column kanban: pending / ready / running / completed / failed / skipped
- **Task DAG:** SVG dependency graph with BFS layout, status-colored nodes
- **Budget Gauges:** Agent turns, tokens, time usage bars
- **Criteria Checklist:** Final evaluation with met/unmet indicators

### Organization

- **Tags:** Custom labels on goals, plans, research (stored in `~/.openclaw/dashboard/tags.json`)
- **Favorites:** Star items to pin them to top
- **Global Search:** `/` or `Cmd+K` searches across all content

### Automation

- **Templates:** Reusable configs for starting goals/plans/research
- **Webhooks:** HTTP callbacks on events (goal.completed, plan.failed, etc.)
- **Chains:** Trigger → action rules (e.g., "on goal completion, start plan")

### Keyboard Shortcuts

| Shortcut | Action               |
| -------- | -------------------- |
| `g c`    | Go to Command Center |
| `g a`    | Go to Analytics      |
| `g s`    | Go to System         |
| `g t`    | Go to Agents         |
| `g u`    | Go to Automation     |
| `/`      | Open search          |
| `?`      | Show shortcuts help  |

## Data Sources

The dashboard reads from `~/.openclaw/`:

| Data             | File                               | Format                                               |
| ---------------- | ---------------------------------- | ---------------------------------------------------- |
| Goals            | `goal-loop/goals.json`             | `{ version, goals: Record<id, Goal> }`               |
| Goal iterations  | `goal-loop/<id>/iterations.jsonl`  | JSONL                                                |
| Goal evaluations | `goal-loop/<id>/evaluations.jsonl` | JSONL                                                |
| Plans            | `planner/plans.json`               | `{ version, plans: Record<id, PlanState> }`          |
| Plan tasks       | `planner/<id>/tasks.jsonl`         | JSONL task transitions                               |
| Plan workers     | `planner/<id>/worker-runs.jsonl`   | JSONL worker results                                 |
| Plan evals       | `planner/<id>/evaluations.jsonl`   | JSONL eval records                                   |
| Research         | `researcher/researches.json`       | `{ version, researches: Record<id, ResearchState> }` |
| PRDs             | `prds/*.md`                        | Markdown files                                       |
| Cron             | `cron/jobs.json`                   | `{ jobs: CronJob[] }`                                |
| Config           | `openclaw.json`                    | Gateway configuration                                |
| Tags             | `dashboard/tags.json`              | Dashboard-specific                                   |
| Favorites        | `dashboard/favorites.json`         | Dashboard-specific                                   |
| Templates        | `dashboard/templates.json`         | Dashboard-specific                                   |
| Webhooks         | `dashboard/webhooks.json`          | Dashboard-specific                                   |
| Chains           | `dashboard/chains.json`            | Dashboard-specific                                   |

## Server Actions

Actions execute via CLI commands or Gateway API:

| Action                   | Method | Description                                         |
| ------------------------ | ------ | --------------------------------------------------- |
| `startGoal`              | CLI    | `openclaw goal start --goal "..." --criteria "..."` |
| `startPlan`              | CLI    | `openclaw planner start --goal "..."`               |
| `startResearch`          | CLI    | `openclaw researcher start --goal "..."`            |
| `stopGoal`               | CLI    | `openclaw goal stop <id>`                           |
| `stopPlan`               | CLI    | `openclaw planner stop <id>`                        |
| `stopResearch`           | CLI    | `openclaw researcher stop <id>`                     |
| `resumeGoal`             | CLI    | `openclaw goal resume <id>`                         |
| `resumePlan`             | CLI    | `openclaw planner resume <id>`                      |
| `answerInterview`        | HTTP   | POST `/researcher/answer`                           |
| `launchPlanFromResearch` | HTTP   | POST `/researcher/go`                               |
| `toggleCronJob`          | File   | Direct edit of `cron/jobs.json`                     |

All CLI commands use 30-second timeout to prevent hangs.

## Tech Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **React 19**
- **Tailwind CSS 4** (Kitesurf/ocean theme)
- **TypeScript**
- **react-markdown** + **remark-gfm** (PRD rendering)

## Theme

Ocean/Kitesurf color palette (Mistral Wind theme):

| Token          | Value     | Usage                 |
| -------------- | --------- | --------------------- |
| bg-primary     | `#0a141e` | Deep ocean background |
| bg-secondary   | `#0f1f2e` | Cards, panels         |
| border         | `#1e3a4f` | All borders           |
| text-primary   | `#e8f4fa` | Headings, body        |
| text-secondary | `#7a9bb0` | Labels, muted         |
| accent-cyan    | `#22d3ee` | Active/wind status    |
| accent-teal    | `#00d4aa` | Success/safe harbor   |
| accent-coral   | `#fb923c` | Warning/anchored      |

## Adding to a New Instance

1. Clone: `git clone git@github.com:2positiveclawd/openclawd-dashboard.git`
2. Install: `cd openclawd-dashboard && npm install`
3. Configure data path in `src/lib/data.ts` if not using default `~/.openclaw/`
4. Run: `npm run dev`

## Extending

### Add a new page

1. Create `src/app/your-page/page.tsx`
2. Add nav link in `src/app/layout.tsx`
3. Add keyboard shortcut in `src/components/KeyboardShortcuts.tsx`

### Add a new data source

1. Add read function in `src/lib/data.ts`
2. Add mutation action in `src/lib/actions.ts` if needed

### Add analytics metric

1. Update `DailyStats` interface in `src/lib/analytics.ts`
2. Populate in `getDailyStats()` loop
3. Add to chart options in `UsageChart.tsx`

## Important Notes

- **LOCAL ONLY** - Never deploy to Vercel or any public hosting
- Gateway must be running on `127.0.0.1:18789` for actions to work
- No authentication (runs locally)
- Auto-refresh toggles on when executions are active

## Troubleshooting

**Dashboard not loading data:**

- Check gateway is running: `systemctl --user status openclaw-gateway`
- Verify data files exist in `~/.openclaw/`

**Actions failing:**

- Check gateway port: `ss -ltnp | grep 18789`
- Check CLI works: `openclaw goal list`

**Stale data:**

- Enable auto-refresh toggle (top right)
- Or manually refresh page

## See Also

- `~/projects/openclawd-dashboard/docs/FEATURES.md` - Detailed feature documentation
- `~/projects/openclawd-dashboard/README.md` - Quick reference
