# Scout-Spec-Ship Playbook (v1)

**The pattern for discovering, validating, building, and shipping system improvements.**

> When you find something that could be better, don't just note it — Scout it, Spec it, Ship it.

## Overview

Scout-Spec-Ship (SSS) is a 6-phase process for turning a vague improvement idea into a tested, deployed enhancement. It was derived from how we built the stealth browser integration and the memory-first knowledge system.

The key insight: **brainstorming is cheap, building is expensive**. SSS front-loads validation so you never build something that doesn't work or isn't needed.

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 1.SCOUT │───▶│2.ASSESS │───▶│ 3.SPEC  │───▶│ 4.BUILD │───▶│5.VERIFY │───▶│ 6.SHIP  │
│ Discover│    │Validate │    │ Design  │    │  Code   │    │  Test   │    │ Deploy  │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
     ▲              │              │                                             │
     │         KILL if bad    KILL if risky                                      │
     └──────────────────────────────────────────────────────────────────────────┘
                                    (feed learnings back)
```

## When to Use This Playbook

Use SSS when:

- You discover a system limitation or inefficiency during normal work
- You want to add a capability that doesn't exist yet
- You find an external tool/library that could improve the system
- A nightly scan identifies an improvement opportunity

**Do NOT use SSS for:**

- Bug fixes (just fix them)
- Config changes (just change them)
- Obvious one-liners (just do them)

## The 6 Phases

---

### Phase 1: SCOUT (Discover)

**Goal:** Identify a concrete improvement opportunity with a clear "why".

**Time limit:** 5-10 minutes

**Activities:**

1. **Observe the problem** — What broke, was slow, or was painful?
2. **Brainstorm solutions** — What could make this better? (2-3 ideas max)
3. **Pick the most promising idea** — Which has the best effort/impact ratio?

**Output:** A 2-3 sentence **Scout Note** answering:

- What's the problem?
- What's the proposed solution?
- Why does it matter?

**Example Scout Note:**

> Agents waste Brave API credits (2,000/month) by searching for things we already researched.
> Proposed: Shared knowledge directory + memory-first workflow where agents check memory before web_search.
> Impact: Reduces paid API usage, makes all agents smarter over time.

**Gate:** Does this matter enough to spend 30+ minutes on? If no → file it in `memory/improvement-ideas.md` and move on.

---

### Phase 2: ASSESS (Validate)

**Goal:** Prove the idea is feasible before writing any code.

**Time limit:** 15-30 minutes

**Activities:**

1. **Research the current system** — How does it work today? Read the source code.
2. **Check for existing solutions** — Is this already solved? Check memory, docs, upstream.
3. **Identify the technical approach** — What would we actually change?
4. **Estimate the blast radius** — How many files? Core changes vs new files?
5. **Identify risks** — What could go wrong? Breaking changes? Performance?

**Output:** An **Assessment** answering:

- Current state: How does the system work today?
- Feasibility: Can we actually do this? (Yes/No/Maybe + reasoning)
- Approach: What's the technical plan? (files to change, deps to add)
- Risk: What's the blast radius? (number of core files touched)
- Verdict: GO / NO-GO / NEEDS-MORE-INFO

**Decision Gates:**
| Verdict | Action |
|---------|--------|
| GO | Proceed to SPEC |
| NO-GO | Document why in `memory/improvement-ideas.md`, move on |
| NEEDS-MORE-INFO | Ask the human, or do more research (max 1 round) |

**Example Assessment:**

> Current: Memory system uses SQLite + embeddings, per-agent isolation. Has `extraPaths` config for indexing additional directories.
> Feasibility: YES — infrastructure already exists, just needs config + workflow.
> Approach: Create shared directory, add extraPaths to config, update SOULs.
> Risk: LOW — no core code changes, just config + documentation.
> Verdict: GO

---

### Phase 3: SPEC (Design)

**Goal:** Write a concrete plan before touching code.

**Time limit:** 10-20 minutes

**Activities:**

1. **List every file that needs changing** — Be specific (path, what changes)
2. **Define the test plan** — How will we know it works?
3. **Define rollback** — How do we undo this if it breaks?
4. **Write the spec** — Use the template below

**Output:** A **Spec Document** (see template below)

**Gate:** If the spec touches >5 core files or adds >2 dependencies, get human approval before proceeding.

#### Spec Template

```markdown
## Spec: {Feature Name}

### Problem

{1-2 sentences}

### Solution

{1-2 sentences}

### Changes

| File         | Type                 | Description  |
| ------------ | -------------------- | ------------ |
| path/to/file | NEW / PATCH / CONFIG | What changes |

### Dependencies

- {new deps, if any}

### Test Plan

1. {How to verify it works — unit level}
2. {How to verify it works — integration/E2E level}

### Rollback

- {How to undo if it breaks}

### Approval

- [ ] Human approved (if >5 core files or >2 deps)
```

---

### Phase 4: BUILD (Code)

**Goal:** Implement the spec, testing incrementally.

**Activities:**

1. **Build incrementally** — One file at a time, test each piece
2. **Test as you go** — Don't write everything then test. Build → test → build → test.
3. **Fix issues immediately** — If a test fails, fix it before moving on
4. **Run existing tests** — Ensure you haven't broken anything (`pnpm test`)

**Rules:**

- Follow the spec exactly. No scope creep.
- If you discover the spec is wrong, update it first, then continue.
- Commit working checkpoints. Don't accumulate a massive uncommitted diff.
- If stuck for >15 minutes, stop and reassess.

**Output:** Working code that passes its own tests + existing test suite.

---

### Phase 5: VERIFY (Test E2E)

**Goal:** Prove the whole thing works end-to-end, not just individual pieces.

**Activities:**

1. **Write an E2E test script** — Exercises the full flow from trigger to output
2. **Run it** — Verify it passes
3. **Test edge cases** — What happens when the input is weird? When the system is cold?
4. **Cross-agent test** — If the feature is shared, verify other agents can use it
5. **Regression check** — Run the full test suite (`pnpm test`)

**Output:** E2E test results showing PASS for all scenarios.

**Gate:** All tests pass? → Proceed to SHIP. Any test fails? → Back to BUILD.

---

### Phase 6: SHIP (Deploy)

**Goal:** Deploy, document, and share the improvement.

**Activities:**

1. **Commit** — Clean commit message explaining the "why"
2. **Push** — To fork/remote
3. **Document** — Update relevant docs (SOUL.md, CLAUDE.md, AGENTS-GUIDE.md, LOCAL-PATCHES.md)
4. **Restart** — Restart the gateway if needed (`systemctl --user restart openclaw-gateway`)
5. **Verify in production** — Check logs, run a smoke test against the live system
6. **Share knowledge** — Save a knowledge file so other agents know about the change

**Output:** Deployed feature, updated docs, knowledge file saved.

---

## Case Studies

### Case Study 1: Stealth Browser Integration

| Phase      | What happened                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SCOUT**  | Travel agent couldn't browse Booking.com — got blocked by bot detection                                                                                   |
| **ASSESS** | Found Apify fingerprint-generator/injector libraries. Playwright supports context.addInitScript(). Estimated 4 core file patches + 1 new file.            |
| **SPEC**   | Wrote detailed plan: stealth.ts (new), patches to chrome.ts, pw-session.ts, config types, zod schema. Test plan: sannysoft.com + Booking.com + Airbnb.    |
| **BUILD**  | Built incrementally. Discovered zod schema needed patching (not in original spec — updated spec). Fixed headless evasions when sannysoft showed failures. |
| **VERIFY** | E2E: sannysoft ALL PASS, Booking.com 25 results, Airbnb 18 listings. Full test suite: 450 tests pass.                                                     |
| **SHIP**   | Committed, pushed, rebased onto upstream (118 commits), no conflicts in our code. Updated LOCAL-PATCHES.md.                                               |

**Key learning:** The ASSESS phase saved us from a bad approach (we initially considered `extract-stealth-evasions` which wasn't needed). The BUILD phase uncovered a missing zod schema patch that wasn't in the spec.

### Case Study 2: Memory-First Knowledge System

| Phase      | What happened                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SCOUT**  | Agents wasting 2,000/month Brave API credits on repeated searches                                                                                                  |
| **ASSESS** | Investigated current memory system (SQLite + embeddings). Found `extraPaths` config already exists. Concluded: no new code needed, just config + workflow + SOULs. |
| **SPEC**   | Create knowledge directory, add extraPaths to config, update 5 SOULs with tiered workflow. Test: force sync, search, cross-agent verification.                     |
| **BUILD**  | Created directory structure + README, updated config, updated 5 SOULs. Each step verified individually.                                                            |
| **VERIFY** | E2E script: forced sync, searched "stealth browser" → found at score 0.815. Cross-agent: travel (0.768), researcher (0.779). All pass.                             |
| **SHIP**   | Committed workspace changes. Config applied via gateway restart. All 24 agents confirmed seeing extraPaths.                                                        |

**Key learning:** The ASSESS phase prevented us from overbuilding (we almost considered Postgres, but discovered the current system was sufficient). The tiered approach (free → paid) came from brainstorming with the human during SCOUT.

---

## Running SSS as a Nightly Scout

SSS can be automated as a nightly cron job that scans the system for improvement opportunities.

### Mode: Propose-Only (Current)

The system runs Phase 1 (SCOUT) and Phase 2 (ASSESS) autonomously, then presents proposals for human approval before proceeding to BUILD.

```
Nightly at 02:00 UTC (cron job on main agent)
  │
  ├── Scan system for improvement opportunities:
  │   ├── Read gateway error logs (journalctl --since "24h ago")
  │   ├── Read agent session logs for recurring friction
  │   ├── Check API usage stats for waste patterns
  │   ├── Read memory/improvement-ideas.md for filed ideas
  │   ├── Check upstream changelog for new features to adopt
  │   └── Review recent SOUL.md changes for inconsistencies
  │
  ├── For each opportunity found (max 3 per night):
  │   ├── Run SCOUT (write Scout Note)
  │   └── Run ASSESS (feasibility check with GO/NO-GO)
  │
  └── Output:
      ├── memory/scout-proposals/YYYY-MM-DD.md (proposal document)
      └── Discord notification to operator for review
```

### Implementation

**Cron job** (registered via CLI):

```bash
openclaw cron add \
  --name "nightly-scout" \
  --cron "0 2 * * *" \
  --tz "UTC" \
  --agent main \
  --session isolated \
  --announce \
  --message "You are running the Nightly Scout scan. Follow the Scout-Spec-Ship playbook (docs/fork/SCOUT-SPEC-SHIP.md).

INSTRUCTIONS:
1. Read memory/improvement-ideas.md for filed ideas
2. Check gateway logs: exec 'journalctl --user -u openclaw-gateway --since \"24h ago\" --no-pager 2>&1 | grep -i error | tail -20'
3. Check recent agent sessions for common pain points
4. For each opportunity (max 3), write a Scout Note + Assessment
5. Write all proposals to memory/scout-proposals/$(date +%Y-%m-%d).md using the proposal template
6. If any proposals are GO, update HEARTBEAT.md with a summary for the operator

RULES:
- DO NOT implement anything. Only propose.
- DO NOT use web_search (save credits for actual research).
- DO NOT exceed 3 proposals per run.
- Rate each proposal: effort (LOW/MED/HIGH), impact (LOW/MED/HIGH), risk (LOW/MED/HIGH).
- Include specific file paths and estimated line counts in each proposal."
```

### Proposal Document Format

```markdown
# Scout Proposals — YYYY-MM-DD

**Generated by:** Nightly Scout (SSS Phase 1-2)
**Status:** Awaiting human review

---

## Proposal 1: {Title}

**Problem:** {1-2 sentences}
**Solution:** {1-2 sentences}
**Why it matters:** {1 sentence}

**Assessment:**

- Feasibility: {YES / MAYBE / NO}
- Effort: {LOW / MEDIUM / HIGH}
- Impact: {LOW / MEDIUM / HIGH}
- Risk: {LOW / MEDIUM / HIGH}
- Files to change: {count} ({list key files})
- Dependencies: {new deps or "none"}

**Verdict:** {GO / NO-GO / NEEDS-INFO}

**To approve:** Tell the main agent: "Run SSS on Proposal 1 from YYYY-MM-DD"

---

## Proposal 2: ...
```

### Mode: Autonomous (Future)

When confidence is high enough, the system can auto-execute low-risk improvements:

1. Nightly scan runs SCOUT + ASSESS (same as propose-only)
2. If effort=LOW AND impact>=MEDIUM AND risk=LOW → auto-run SPEC+BUILD+VERIFY
3. Present completed feature for human review (SHIP always requires approval)
4. If effort>=MEDIUM OR risk>=MEDIUM → stop at proposal stage

**Graduation criteria** (all must be true to enable autonomous mode):

- [ ] 10+ successful SSS cycles completed with human approval
- [ ] 0 rollbacks in last 5 cycles
- [ ] Human explicitly enables autonomous mode in config
- [ ] Autonomous changes limited to: config, SOULs, docs, knowledge files (no core code)

### Relationship with daily-self-improvement

Two cron jobs work together:

| Job                      | Schedule     | Mode         | Purpose                                                       |
| ------------------------ | ------------ | ------------ | ------------------------------------------------------------- |
| `nightly-scout`          | 02:00 UTC    | Propose-only | Scans system, writes proposals to `memory/scout-proposals/`   |
| `daily-self-improvement` | 19:00 Warsaw | Autonomous   | Picks ONE improvement from backlog + proposals, implements it |

**Data flow:**

1. `nightly-scout` runs first → writes proposals
2. Human reviews proposals (via Discord notification or dashboard)
3. Approved proposals go to `memory/improvement-ideas.md`
4. `daily-self-improvement` reads `memory/improvement-ideas.md` → picks one → implements it
5. Results logged to `memory/improvements-log.md`

The scout proposes; the daily job executes. Both follow the SSS phases but the scout stops at ASSESS while the daily job runs the full cycle.

---

## Vision Scout (Proactive Extension Scout)

While the **Nightly Scout** looks **backwards** at problems (errors, friction, waste), the **Vision Scout** looks **forward** at opportunities — new capabilities that advance the operator's goals.

### Philosophy

The Vision Scout asks: _"What should we be able to do that we can't do today?"_

Examples of Vision Scout proposals:

- "Agents can't browse anti-bot sites" → Stealth browser integration
- "No way to track spending across providers" → Cost dashboard
- "Agents can't collaborate on complex tasks" → Multi-agent workflows
- "No proactive monitoring of user interests" → Trend scout packs

### How It Differs from Nightly Scout

| Aspect            | Nightly Scout                       | Vision Scout                                          |
| ----------------- | ----------------------------------- | ----------------------------------------------------- |
| **Focus**         | Fix what's broken                   | Build what's missing                                  |
| **Sources**       | Error logs, session friction, waste | Operator goals, capability gaps, ecosystem tools      |
| **Trigger**       | System signals (errors, noise)      | Strategic alignment (goals, vision)                   |
| **Risk profile**  | Usually LOW-MED (fixing existing)   | Usually MED-HIGH (adding new capability)              |
| **Allowed tools** | No web_search                       | web_search allowed (1-2 calls for ecosystem research) |

### Input: Operator Goals

The Vision Scout needs to know what the operator wants to achieve. Goals are stored at:

**`memory/operator-goals.md`**

```markdown
# Operator Goals

## Primary Goals

1. {Goal 1 — what the operator wants to achieve}
2. {Goal 2}

## Current Capabilities

- {What the system can already do toward these goals}

## Known Gaps

- {What's missing — things agents can't do yet}

## Interests & Domains

- {Topics the operator cares about — travel, finance, health, etc.}
```

The Vision Scout reads this file at the start of every run. If the file doesn't exist or is stale, the scout should note this and skip vision proposals.

### Implementation

**Schedule:** Weekly (Sundays at 03:00 UTC) — less frequent because proactive ideas need more thought and research.

**Discord channel:** Same `#nightly-scout` channel (category: Improvements), but tagged differently.

**Cron job:**

```bash
openclaw cron add \
  --name "vision-scout" \
  --cron "0 3 * * 0" \
  --tz "UTC" \
  --agent main \
  --session isolated \
  --announce \
  --to "NIGHTLY_SCOUT_CHANNEL_ID" \
  --message "You are running the Vision Scout (proactive extension scan)..."
```

### Vision Proposal Format

```markdown
## Vision Proposal {N}: {Title}

**Goal alignment:** {Which operator goal this serves}
**Capability gap:** {What agents can't do today}
**Proposed capability:** {What they'd be able to do after}

**Assessment:**

- Feasibility: {YES / MAYBE / NO}
- Effort: {LOW / MEDIUM / HIGH}
- Impact: {LOW / MEDIUM / HIGH}
- Risk: {LOW / MEDIUM / HIGH}
- Ecosystem tools: {libraries, APIs, or services that enable this}
- Files to change: {count} ({key files})

**Verdict:** {GO / NO-GO / NEEDS-INFO}
```

### Three-Scout Ecosystem

| Scout                    | Schedule             | Focus                         | Channel        |
| ------------------------ | -------------------- | ----------------------------- | -------------- |
| `nightly-scout`          | Daily 02:00 UTC      | Fix problems, reduce waste    | #nightly-scout |
| `vision-scout`           | Weekly Sun 03:00 UTC | New capabilities toward goals | #nightly-scout |
| `daily-self-improvement` | Daily 19:00 Warsaw   | Execute approved proposals    | (internal)     |

---

## Checklists

### Quick Reference: Phase Gates

| Phase  | Gate Question                                | Pass →                  | Fail →                       |
| ------ | -------------------------------------------- | ----------------------- | ---------------------------- |
| SCOUT  | Does this matter enough to spend 30+ min on? | ASSESS                  | File in improvement-ideas.md |
| ASSESS | Is it feasible and worth doing?              | SPEC                    | Document NO-GO, move on      |
| SPEC   | Is the plan clear and complete?              | BUILD                   | Revise spec                  |
| BUILD  | Does each piece work?                        | Continue BUILD / VERIFY | Fix, then continue           |
| VERIFY | Do all E2E tests pass?                       | SHIP                    | Back to BUILD                |
| SHIP   | Is it deployed, documented, and shared?      | Done ✅                 | Fix remaining items          |

### Quick Reference: Time Budgets

| Phase  | Max Time | If over budget →                   |
| ------ | -------- | ---------------------------------- |
| SCOUT  | 10 min   | File idea and move on              |
| ASSESS | 30 min   | Ask human for direction            |
| SPEC   | 20 min   | Simplify scope                     |
| BUILD  | 2 hours  | Split into smaller pieces          |
| VERIFY | 30 min   | Reduce test scope to critical path |
| SHIP   | 15 min   | Just commit + push, doc later      |

---

## Integration with OpenClawd

### For Agents

- When you notice an improvement opportunity during normal work, file a Scout Note
- Location: `memory/knowledge/research/YYYY-MM-DD-scout-{topic}.md`
- Use tag `**Type**: scout-note` in the file metadata
- The nightly scan will pick it up

### For the Nightly Scanner

- Read `memory/improvement-ideas.md` for filed ideas
- Read agent session logs for recurring errors/friction
- Read API usage stats for waste patterns
- Write proposals to `memory/scout-proposals/YYYY-MM-DD.md`

### For Humans

- Review proposals in Discord or dashboard
- Approve with: "Run SSS on proposal N"
- The approved proposal becomes the spec input for Phase 3

---

_Created 2026-02-05. Pattern derived from stealth browser + memory-first implementations._
