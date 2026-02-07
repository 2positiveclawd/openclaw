# Vision and Roadmap

> Future possibilities, strategic direction, and what could be built next.

## Current State (February 2026)

OpenClawd is a functional AI agent orchestration platform with:

- 24 agents with isolated workspaces and persistent memory
- 3 orchestration modes (goal loop, planner, researcher)
- Event-driven automation (webhooks, chains, templates)
- Discord as primary interface, 20+ channels available
- Local Mission Control Dashboard
- Daily trend monitoring
- ~17K lines of custom code across 6 extensions

**What works well**: Autonomous goal execution, task decomposition, budget governance, agent isolation, Discord UX.

**What's limited**: Static routing, basic workflow chains, single-user only, no mobile-native UI, limited observability.

---

## Near-Term Opportunities (Next 3 Months)

### 1. Intent-Based Routing

**Problem**: Users must know which channel maps to which agent. New users get confused.

**Solution**: An intent classifier that analyzes incoming messages and routes to the best agent automatically.

```
User sends "book me a flight to Tokyo" in #general
  -> Intent classifier identifies: travel intent
  -> Routes to travel agent
  -> Travel agent responds in thread
```

**Complexity**: Medium. Requires a lightweight classifier (could use the gateway's existing model) plus routing rules.

### 2. Workflow Engine Extension

**Problem**: Chains are basic trigger-action pairs. Can't express conditional branches, parallel/join, human-in-the-loop approval steps, or long-running stateful workflows.

**Solution**: A proper workflow engine with:

- Visual workflow definition (YAML or JSON)
- Conditional branches (if score > 80, do X; else do Y)
- Parallel execution with join barriers
- Human approval gates
- Retry policies with exponential backoff
- Workflow state persistence and resumability

### 3. Integration Hub

**Problem**: Connecting to external tools requires custom `exec` or `browser` calls per service.

**Solution**: Pre-built connectors for common tools:

- **GitHub**: Issues, PRs, Actions (via `gh` CLI -- partially available)
- **Notion**: Database queries, page creation
- **Linear**: Issue tracking, sprint management
- **Calendar**: Google Calendar, Outlook
- **Email**: SMTP/IMAP for outbound/inbound

### 4. Mobile-Responsive Dashboard

**Problem**: Mission Control Dashboard isn't optimized for mobile. Managing goals/plans on the go requires Discord mobile.

**Solution**: Responsive redesign of key pages:

- Command Center (Kanban as swipeable columns)
- Quick actions (start/stop/approve from mobile)
- Notification center (push notifications via PWA)

### 5. Cost Analytics

**Problem**: Token usage is tracked but not converted to dollar costs. No budget forecasting.

**Solution**: Add pricing tables per model, compute per-goal/per-plan costs, show burn rate trends, and predict monthly spending.

---

## Medium-Term Possibilities (3-12 Months)

### 6. Agent Marketplace

Create a registry where users can share and install agent packs:

- SOUL templates for different use cases
- Pre-configured tool policies
- Tested workflows and chains
- Community-contributed packs

### 7. Voice Interface

OpenClaw already has voice-call extension support. Extend this to:

- Voice-activated goal creation ("Start a goal to refactor the auth module")
- Hands-free status updates
- Phone call interface for urgent approvals

### 8. Learning and Self-Improvement

The automation learnings module already records execution outcomes. Extend this to:

- **Auto-tune budgets**: Learn optimal iteration counts for different goal types
- **Strategy selection**: Recommend goal-loop vs planner based on past patterns
- **Failure prediction**: Flag goals likely to stall early
- **Prompt optimization**: A/B test different agent system prompts

### 9. Multi-Instance Federation

For users with multiple machines:

- Sync agent state across instances
- Route tasks to the instance with the right tools (e.g., macOS for iOS builds)
- Shared memory across instances
- Failover if one instance goes down

### 10. Collaborative Agents

Currently agents are independent. Enable richer collaboration:

- **Shared workspaces**: Multiple agents contribute to the same project
- **Code review chains**: Executor writes -> Reviewer reviews -> Docs agent documents
- **Debate protocol**: Two agents argue different approaches, human picks winner

---

## Long-Term Vision (1-3 Years)

### 11. Self-Evolving Agent System

The Scout-Spec-Ship playbook is currently human-triggered. Fully automate it:

- Nightly Scout scans identify improvement opportunities
- Assessment runs automatically evaluate feasibility
- Spec generation creates implementation plans
- Build phase executes (with human approval gate)
- Verify phase runs automated tests
- Ship phase deploys changes

The system literally improves itself over time.

### 12. Distributed Agent Network

Move beyond single-machine to a network of agent instances:

- Edge agents on personal devices (phone, laptop, desktop)
- Cloud agents for heavy compute (ML training, large builds)
- IoT agents for home automation
- Each node contributes capabilities to the network

### 13. Domain-Specific Expertise

Deep specialization in vertical domains:

- **Legal**: Contract review, compliance checking, regulatory monitoring
- **Healthcare**: Symptom tracking, medication management, appointment scheduling
- **Education**: Tutoring, curriculum design, progress tracking
- **Creative**: Music composition, art generation, story writing

### 14. Natural Language Infrastructure

Replace configuration files with natural language:

- "Add an agent that handles customer support"
- "When any goal completes above 90, post to Slack"
- "The travel agent should also be able to book restaurants"

The system translates natural language into config, extensions, and workflows.

---

## What NOT to Build

Some things are better left to specialized tools:

| Don't Build         | Use Instead             | Why                                  |
| ------------------- | ----------------------- | ------------------------------------ |
| Full CI/CD system   | GitHub Actions, Jenkins | Mature, well-tested, team-oriented   |
| Database management | Supabase, PlanetScale   | Agent should query, not manage infra |
| Monitoring stack    | Grafana, Datadog        | OpenTelemetry export is sufficient   |
| Team chat           | Slack, Discord          | Already using Discord as interface   |
| Project management  | Linear, Jira            | Agents should integrate, not replace |

---

## Technical Debt to Address

| Issue                           | Impact                              | Effort                                |
| ------------------------------- | ----------------------------------- | ------------------------------------- |
| Core patches as ad-hoc edits    | Merge conflicts on upstream updates | Medium -- formalize as `.patch` files |
| Skills outside git repo         | Lost on fresh install               | Low -- move to `skills/` directory    |
| No encryption at rest for creds | Security risk                       | Medium -- implement SOPS or keychain  |
| No rate limiting                | DoS risk                            | Low -- add per-user limits            |
| No setup script (WIP)           | Manual bootstrapping                | Low -- finalize `setup.sh`            |
| Session transcripts unencrypted | Privacy risk                        | Medium -- add encryption option       |
| Static routing only             | UX friction                         | Medium -- build intent classifier     |

---

## Contribution to Upstream

Some extensions are general-purpose enough to contribute back to OpenClaw:

| Extension   | Upstream Potential | Notes                                            |
| ----------- | ------------------ | ------------------------------------------------ |
| Goal Loop   | High               | General-purpose, any user could benefit          |
| Planner     | High               | DAG task execution is broadly useful             |
| Automation  | Medium             | Webhooks and chains are common patterns          |
| Agent Packs | Medium             | Framework is useful, specific packs are personal |
| Researcher  | Medium             | Interview-to-PRD flow is novel                   |
| Trend Scout | Low                | Highly personal, niche use case                  |

**Extension bridge pattern**: This is the most valuable upstream contribution -- the pattern of keeping `plugin-sdk` clean while exposing fork-specific APIs through a separate bridge entry point.

---

## Success Metrics

How to measure whether OpenClawd is working:

| Metric                    | Target                          | How to Track                     |
| ------------------------- | ------------------------------- | -------------------------------- |
| Goals completed / started | > 70%                           | `goals.json` status distribution |
| Average goal score        | > 80                            | Evaluation history               |
| Budget efficiency         | < 60% budget used on completion | Token/iteration usage vs limits  |
| Stall rate                | < 15%                           | Goals ending in `stalled` status |
| Plan task success rate    | > 85%                           | Task completion vs total         |
| Research-to-launch rate   | > 50%                           | Researches that reach `launched` |
| Time to first iteration   | < 30 seconds                    | Goal start to first agent turn   |
| Daily active agents       | > 5                             | Session activity logs            |
