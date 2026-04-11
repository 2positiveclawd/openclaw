# Release Note — 2026-04-07 — Cron payload.model validation hardening

## What changed

- Isolated cron jobs now reject disallowed `payload.model` overrides at save time.
- Cron doctor now warns when stored jobs still carry a disallowed or invalid `payload.model` override.
- Isolated cron runs no longer silently swap back to agent defaults when a stored `payload.model` is disallowed. They fail explicitly instead.

## Why

Silent fallback made cron jobs look healthy while they were actually running on a different model than the job requested. That hid behavior, cost, and quality drift.

## User-visible effect

- `cron add|edit --model ...` now fails fast when the chosen model is outside the current allowlist.
- Older stored jobs with bad overrides show up in doctor warnings.
- If a stored bad override still slips through, the run returns a clear error telling you to remove `payload.model` to use agent defaults.

## Verification

- `pnpm vitest run src/cron/service/save-validation.test.ts src/commands/doctor-cron.test.ts src/cron/isolated-agent/run.skill-filter.test.ts src/cron/isolated-agent/run.cron-model-override.test.ts`
- QA note: `/home/azureuser/.openclaw/workspace/memory/qa/2026-04-07-cron-model-override-validation.md`
