# Release Note — 2026-04-05 — Browser act preflight and stale-target guidance

## What changed

- `browser act` now rejects a few common invalid request shapes before dispatching them to the browser runtime.
- New corrective guidance covers:
  - `kind="fill"` without `fields=[...]`
  - `selector` used on interaction kinds where snapshot refs are required
  - missing `ref` on interaction kinds that need one
- Stale `targetId` errors now return actionable guidance for openclaw-managed tabs too, not just `profile="chrome"` relay tabs.

## Why

Recent browser sessions were wasting turns on runtime 400s like `fields are required`, `ref is required`, and `selector is not supported`. The tool now fails faster and tells the agent how to recover.

## User-visible effect

- Faster failure on malformed `browser act` calls.
- Error text now tells the agent to use `snapshot` refs, keep the same `targetId`, use `type` for one input, and refresh `tabs`/`snapshot` when a tab target goes stale.

## Verification

- `pnpm vitest run src/agents/tools/browser-tool.test.ts`
- QA note: `/home/azureuser/.openclaw/workspace/memory/qa/2026-04-05-browser-act-preflight.md`
