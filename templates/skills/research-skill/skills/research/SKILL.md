---
name: research
description: "Research, interview, and generate PRDs for vague goals"
metadata: { "openclaw": { "emoji": "\uD83D\uDD0D" } }
---

# Research Skill

Run an autonomous research/interview loop with the user, generate a PRD, then hand off to the planner. Best for vague or aspirational goals where the requirements need discovery.

**Important**: Use `openclaw-researcher` (not `openclaw researcher`) for all commands.

## When to Use /research

Use this when:

- The goal is vague or aspirational ("make something that goes viral")
- The user hasn't specified tech stack, platform, or success criteria
- You'd normally ask 3+ clarifying questions before starting
- The user wants help defining _what_ to build, not just building it

Do NOT use this for clear goals with known requirements (use `/goal` for simple or `/plan` for complex).

## How It Works

1. **Research phase**: An agent investigates prior art, tech options, constraints, and risks
2. **Interview phase**: Targeted questions are sent to the user via Discord
3. **Loop**: Research and interview repeat (up to `--max-rounds`) to refine understanding
4. **Synthesis**: A PRD is generated from accumulated research and answers
5. **Launch**: User confirms with `/research-go <id>` and the planner starts automatically

## Starting a Research Session

```bash
openclaw-researcher start \
  --goal "Build a web game that gets 10k users" \
  --max-rounds 3 \
  --max-turns 20 \
  --max-tokens 200000 \
  --max-time 30m \
  --notify-channel discord --notify-to 302826080664813578
```

### Parameters

- `--goal` (required): The vague or aspirational goal to research.
- `--max-rounds <n>`: Max research/interview rounds (default: 3).
- `--max-turns <n>`: Agent turn budget (default: 20).
- `--max-tokens <n>`: Token budget (default: 200000).
- `--max-time <duration>`: Wall-clock limit (default: 30m).
- `--notify-channel <channel>`: Notification channel.
- `--notify-to <recipient>`: Notification recipient.
- `--notify-account-id <id>`: Notification account ID.

## Discord Commands

During a research session, the user interacts via Discord:

- **`/research-reply <id> <answers>`** — Answer interview questions (free-text format)
- **`/research-go <id>`** — Launch the plan from the generated PRD
- **`/research-stop <id>`** — Stop a running research
- **`/research-view <id>`** — View the generated PRD
- **`/research-status [id]`** — Check research status

### Example Discord Exchange

```
Bot: I have 3 questions about your web game project [abc123]:
     1. Single-player or multiplayer?
     2. 2D (Canvas/Phaser) or 3D (Three.js)?
     3. Deploy to Vercel (free) or custom hosting?
     Reply: /research-reply abc123 <your answers>

User: /research-reply abc123 multiplayer would be cool, 2D with Phaser, Vercel is fine

Bot: Thanks! Doing a deeper dive based on your answers...
     ...
Bot: Research complete! PRD saved at ~/.openclaw/prds/auto-001-web-game.md [abc123].
     Reply: /research-go abc123 to start building
     Reply: /research-view abc123 to review the PRD first

User: /research-go abc123

Bot: Plan p1a2b3c4 started from your research! I'll update you on progress.
```

## Checking Status

```bash
openclaw-researcher status <research-id>
openclaw-researcher list --active
openclaw-researcher view <research-id>    # Show generated PRD
```

### HTTP endpoint

```bash
curl -s http://localhost:18789/researcher/status | jq .
```

## Generated PRDs

PRDs are saved to `~/.openclaw/prds/auto-NNN-<slug>.md` with sections:

- Goal, Acceptance Criteria, Technical Approach, Constraints, Budget Recommendations

These PRDs can also be used directly with `/plan`:

```bash
openclaw-planner start --from-prd ~/.openclaw/prds/auto-001-web-game.md --notify-channel discord --notify-to 302826080664813578
```

## CRITICAL: Always Enable Notifications

Every `openclaw-researcher start` command MUST include:

```
--notify-channel discord --notify-to 302826080664813578
```

## Responding to the User

When the user's request is vague:

1. Start a research session with their goal
2. **ALWAYS include `--notify-channel discord --notify-to 302826080664813578`**
3. Tell the user: "I've started researching your goal. I'll send you questions in Discord shortly."
4. The researcher handles the rest autonomously (research, questions, PRD, launch)
