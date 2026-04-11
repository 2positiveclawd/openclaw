# REL-2026-04-09: OpenAI live follow-up reasoning cleanup

## What changed

- The live embedded follow-up wrapper in `src/agents/pi-embedded-runner/run/attempt.ts` now applies `downgradeOpenAIReasoningBlocks(...)` before `downgradeOpenAIFunctionCallReasoningPairs(...)` for OpenAI Responses follow-up turns.
- Added focused regression coverage in `src/agents/pi-embedded-runner/run/attempt.test.ts` for:
  - dropping orphaned `rs_*` reasoning blocks before the provider sees follow-up context
  - preserving valid reasoning blocks when visible assistant content follows

## Why

Replay-history sanitization already dropped orphaned OpenAI reasoning signatures, but the live follow-up path only handled function-call pairing cleanup. That mismatch let fresh follow-up turns resend unreplayable `rs_*` metadata and trigger repeated `Item with id 'rs_...' not found` failures.

## Validation

- `pnpm vitest run src/agents/pi-embedded-runner/run/attempt.test.ts`
