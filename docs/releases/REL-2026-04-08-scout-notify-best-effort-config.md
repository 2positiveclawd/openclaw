# REL-2026-04-08: Scout notify best-effort config load

## What changed

- `scripts/scout-notify.ts` now reads config with `readBestEffortConfig()` instead of strict `loadConfig()`.

## Why

- Nightly Scout proposal delivery could fail before any Discord send when the local config still contained unrelated legacy Discord aliases such as `channels.discord.guilds.<id>.channels.<id>.allow`.
- The notifier only needs a readable config snapshot to resolve a Discord token and send pending proposals.

## Result

- Pending Scout proposals are no longer blocked by unrelated legacy config aliases, as long as the config snapshot is still readable enough to resolve Discord auth.
- Strict config validation remains unchanged elsewhere.

## Verification

- Focused local coverage lives in `test/scripts/scout-notify.smoke.test.ts`, including the legacy-invalid config snapshot case.
- Manual strict probe still fails on the legacy alias as expected, while the notifier path now stays usable via `readBestEffortConfig()`.
