# REL-2026-04-10: Recurring main-session cron permanent run errors auto-disable

## What changed

- `src/cron/service/timer.ts` now recognizes a narrow set of permanent target-resolution run errors for recurring main-session `systemEvent` jobs, including `Unknown Channel`, `Target channel could not be resolved`, and `chat not found`.
- Matching recurring jobs now auto-disable after 2 consecutive permanent failures instead of staying enabled on exponential backoff forever.
- The auto-disable path preserves the final error state and emits an operator-visible system event plus heartbeat wake request.
- Added focused regression coverage in `src/cron/service/timer.regression.test.ts` for:
  - recurring main-session permanent run errors auto-disabling after repeated failures
  - transient recurring errors staying on backoff
  - one-shot behavior staying unchanged
- Updated cron docs in `docs/automation/cron-jobs.md` and `docs/cli/cron.md`.

## Why

Two live recurring main-session cron jobs were looping on the same permanent `Unknown Channel` style failure for days. The existing recurring error path only backed off, which hid terminal routing mistakes behind endless retries.

## Validation

- `pnpm vitest run src/cron/service/timer.regression.test.ts`
- `pnpm vitest run src/cron/service/timer.test.ts`
