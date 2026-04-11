# Local Fork Patches

Minimal patches maintained in `2positiveclawd/openclaw` on top of upstream
`openclaw/openclaw`. As of the **2026-04-11** upstream merge (3250 commits),
the fork tracks upstream exactly except for **seven** patches — all either
fix live bugs on this deployment or support fork-specific operator tooling.

> **Philosophy:** upstream moves fast and refactors aggressively. Every fork
> patch you keep becomes a recurring merge tax. Unless a patch is truly
> load-bearing for our deployment, drop it and accept upstream.

## Patches

### 1. Azure Managed Identity Auth (CRITICAL)

**File:** `src/agents/model-auth.ts`

Our primary LLM provider is Azure OpenAI and the VM authenticates via IMDS
(Instance Metadata Service) — no API keys on disk. Upstream has AWS Bedrock
managed-identity but no Azure equivalent.

**What the patch adds:**

- `fetchAzureManagedIdentityToken()` — fetches OAuth2 token from
  `http://169.254.169.254/metadata/identity/oauth2/token?...&resource=https://cognitiveservices.azure.com/`
  with `Metadata: true` header, caches until 60s before expiry.
- `isAzureProvider(provider)` — returns true for `azure` or
  `azure-openai-responses` (uses upstream's `normalizeProviderId`).
- Integration inside `resolveApiKeyForProvider`, placed right after the
  amazon-bedrock branch: when the provider is Azure and IMDS responds,
  return `{ apiKey: token, source: "azure-managed-identity", mode: "token" }`.
  On any failure, fall through to the normal API-key path.

**Re-apply after merge conflict:**

1. Find `resolveApiKeyForProvider(...)` and the amazon-bedrock AWS SDK branch.
2. Add the `isAzureProvider(provider)` check immediately after it.
3. Add the helper functions (`fetchAzureManagedIdentityToken`, `isAzureProvider`,
   token cache variable) near the top of the file, after the subsystem logger.
4. Verify `normalizeProviderId` is still imported (upstream usually keeps it).

**Test:** restart the gateway on the Azure VM; `journalctl --user -u openclaw-gateway`
should show Azure calls succeeding without any `AZURE_API_KEY` in config.

---

### 2. Browser Stealth

**Files:**

- `extensions/browser/src/browser/stealth.ts` — self-contained module
- `extensions/browser/src/browser/chrome.ts` — import + call `getStealthLaunchArgs`
- `extensions/browser/src/browser/pw-session.ts` — import + call `applyStealthToContext`

Defeats common anti-bot detection via Apify's fingerprint-suite and extra
Chrome launch flags. `stealth.ts` is self-contained; only the chrome+pw-session
files need wiring re-applied after a conflict.

**What the patch adds:**

- `stealth.ts` exports:
  - `getStealthLaunchArgs({ headless })` — returns Chrome flags like
    `--disable-blink-features=AutomationControlled`, `--window-size=1920,1080`,
    plus GL flags in headless mode.
  - `isStealthEnabled()` — reads `browser.extraArgs` from config and returns
    true when it contains `AutomationControlled`. (The legacy `browser.stealth`
    boolean was removed upstream; we infer from extraArgs to avoid adding
    config schema surface.)
  - `applyStealthToContext(context)` — lazy-imports `fingerprint-generator` +
    `fingerprint-injector`, attaches a realistic fingerprint to the Playwright
    context, and runs the `HEADLESS_EVASIONS` init script. Softfails if
    the deps are missing (try/catch with warn log).

**Wiring:**

```ts
// extensions/browser/src/browser/chrome.ts
import { getStealthLaunchArgs, isStealthEnabled } from "./stealth.js";

// inside buildOpenClawChromeLaunchArgs(...), after extraArgs push:
if (isStealthEnabled()) {
  args.push(...getStealthLaunchArgs({ headless: resolved.headless }));
}
```

```ts
// extensions/browser/src/browser/pw-session.ts
import { applyStealthToContext, isStealthEnabled } from "./stealth.js";

// inside observeContext(...), after ensureContextState(...):
if (isStealthEnabled()) {
  void applyStealthToContext(context);
}
```

**Optional deps (not in package.json):** `fingerprint-generator`,
`fingerprint-injector`, `user-agents`. Install them in the browser extension
if you actually need stealth injection (not just launch flags). Without them,
`applyStealthToContext` logs a warning and noops — launch flags still apply.

**Enable at runtime:** set `browser.extraArgs` in `~/.openclaw/openclaw.json`
to include `--disable-blink-features=AutomationControlled`. `isStealthEnabled()`
detects the flag and activates the rest of the stealth path.

---

### 3. uncaughtException classification (2026-04-11)

**Files:**

- `src/infra/unhandled-rejections.ts` — add `isUndiciTlsSessionRace()` matcher
- `src/index.ts` — wire `isRecoverableException` into the uncaughtException handler
- `src/cli/run-main.ts` — same wiring for the CLI entry handler
- `src/infra/unhandled-rejections.test.ts` — 6 new narrow-match assertions

**Why:** on 2026-04-10 the gateway hit an undici `onHttpSocketClose` TLS race:

```
TypeError: Cannot read properties of null (reading 'setSession')
    at TLSSocket.setSession (node:_tls_wrap:1132:16)
    at Object.connect (node:_tls_wrap:1826:13)
    at Client.connect (undici/lib/core/connect.js:70:20)
    at TLSSocket.onHttpSocketClose (undici/lib/dispatcher/client-h1.js:942:18)
```

This is a synchronous throw from an EventEmitter (`emit('close', …)`), so it
surfaces as `uncaughtException`, not `unhandledRejection`. Upstream's
`src/index.ts:92` and `src/cli/run-main.ts:207` both always `console.error +
process.exit(1)` on `uncaughtException`, which meant a single TLS race plus
systemd's 5 s restart loop spun the gateway through **4,637 failed restarts**
over ~15 hours, ending only when a subsequent upstream merge happened to
rebuild `dist/` through our work.

Notably, `isRecoverableException()` already exists in `src/infra/unhandled-rejections.ts:343`
— upstream wrote it, but it is **not** wired into the uncaughtException path.
It is currently only consulted for `unhandledRejection`.

**What the patch adds:**

- `isUndiciTlsSessionRace(err)` — narrow matcher requiring all of:
  1. `err instanceof TypeError`
  2. `err.message` matches `cannot read properties of null \(reading 'setSession'\)`
  3. stack includes `_tls_wrap` (Node internal TLS)
  4. stack includes `undici/lib/dispatcher` or `onHttpSocketClose`
- Extends `isRecoverableException()` to return true for that matcher.
- Updates both `uncaughtException` handlers to consult `isRecoverableException`
  first and, on match, log a `[openclaw] Suppressed recoverable uncaught
exception (continuing): …` warn line and return instead of exiting.

**Why it is safe:**

- The matcher is narrow on purpose: an unrelated `null.setSession` TypeError
  from our own code will not match because the stack check fails. Generic
  `TypeError`s and plain `Error`s with the same message also do not match.
- Suppressed events are still logged at WARN level (visible in journalctl),
  so operator can count them and notice abuse.
- Fatal classifications (`isFatalError`, `isConfigError`) are unaffected —
  they live in the `unhandledRejection` handler, not this path.
- `isTransientNetworkError` and the Discord zombie-reconnect rule already
  existed in upstream's `isRecoverableException`; we did not change their
  semantics, only the call site.

**Re-apply after merge conflict:**

1. Find `isRecoverableException` in `src/infra/unhandled-rejections.ts`. Add
   the `isUndiciTlsSessionRace` helper just above it (or verify it still
   exists) and add a call to it at the end of `isRecoverableException` before
   the final `return false`.
2. In `src/index.ts` and `src/cli/run-main.ts` find the `process.on("uncaughtException", …)`
   blocks and prepend an `if (isRecoverableException(error)) { console.warn(…); return; }`
   check. Make sure `isRecoverableException` is imported from
   `./infra/unhandled-rejections.js` (src/index.ts) or
   `../infra/unhandled-rejections.js` (src/cli/run-main.ts — lazy inside
   `Promise.all`, same destructure as `installUnhandledRejectionHandler`).
3. Update the test file `src/infra/unhandled-rejections.test.ts` to import
   `isRecoverableException` and `isUndiciTlsSessionRace` and keep the
   `describe("isUndiciTlsSessionRace")` block — the crash-stack fixture inside
   it is the verbatim 2026-04-10 crash.

**Test:** `pnpm test src/infra/unhandled-rejections.test.ts` — expect the
`isUndiciTlsSessionRace` block (6 assertions) plus the pre-existing 40 to all
pass. Full-repo build: `pnpm build`.

**If the matcher stops firing:** either Node renamed `_tls_wrap`, undici
renamed `onHttpSocketClose` / moved `client-h1.js` out of `lib/dispatcher/`,
or the bug finally got fixed upstream. Update the stack-frame checks in
`isUndiciTlsSessionRace` to match the new names — or, if the bug is gone,
delete the matcher entirely. Do NOT widen the matcher: we do not want to
swallow user-code null-property reads.

---

### 4. Cron `payload.model` validation (2026-04-07)

**Files:**

- `src/cron/model-override-policy.ts` — new module, ~86 LOC
- `src/cron/service/state.ts` — add `validateJobBeforeSave?: (job) => Promise<void> | void` to `CronServiceDeps`
- `src/cron/service/ops.ts` — invoke `validateJobBeforeSave?.(job)` at both add and edit call sites
- `src/cron/isolated-agent/model-selection.ts` — flip silent-fallback to fail-fast on `"model not allowed:"`
- `src/gateway/server-cron.ts` — wire `loadConfig()` + `assertCronPayloadModelAllowed` into the `validateJobBeforeSave` deps hook
- `src/cron/service/save-validation.test.ts` — new test, ~143 LOC
- Refreshes `src/commands/doctor-cron.test.ts`, `src/cron/isolated-agent/run.skill-filter.test.ts`, and `run.cron-model-override.test.ts`

**Why:** upstream's `src/cron/isolated-agent/model-selection.ts` silently
swaps back to agent defaults when a stored `payload.model` is disallowed:

```ts
// upstream
if (resolvedOverride.error.startsWith("model not allowed:")) {
  return {
    ok: true,
    provider,
    model,
    warning: `cron: payload.model '${modelOverride}' not allowed, falling back to agent defaults`,
  };
}
```

That turns "cron job runs on wrong model than requested" into a warning line
in the log and nothing else. Cost and quality drift goes unnoticed. Upstream
also has no save-time validation, so `cron add|edit --model badmodel`
succeeds and only fails on first run.

**What the patch adds:**

- `model-override-policy.ts` exports two functions:
  - `assertCronPayloadModelAllowed({ cfg, job })` — throws on disallowed
    model, called at save time
  - `resolveCronPayloadModelIssue({ cfg, job })` — returns a structured
    issue or `null`, used internally by `assertCronPayloadModelAllowed`
- `src/cron/service/state.ts` adds a new optional deps field
  `validateJobBeforeSave?: (job: CronJob) => Promise<void> | void`. This is
  additive and purely opt-in, so upstream merges that touch `CronServiceDeps`
  stay compatible.
- `src/cron/service/ops.ts` invokes the hook at two call sites: inside the
  add path (directly on the new job) and inside the edit path (on a
  `structuredClone(job)` with the patch pre-applied). This order matters:
  clone + apply + validate lets the hook see the post-edit state without
  mutating the real job on failure.
- `src/gateway/server-cron.ts` imports `assertCronPayloadModelAllowed` and
  wires it into the `validateJobBeforeSave` deps hook using a fresh
  `loadConfig()` so the policy reads the current allowlist each call.
- `src/cron/isolated-agent/model-selection.ts` flips the silent-fallback
  block to `{ ok: false, error: "cron: payload.model '…' is not allowed by
policy. Remove payload.model to use agent defaults." }` so isolated runs
  error loudly instead of pretending success.

**Why it is safe:**

- `validateJobBeforeSave` is an _optional_ deps field; skipping it yields
  upstream behavior exactly. The hook is not applied to boot-time state
  rehydration, only to add/edit paths, so existing stored jobs are unaffected.
- The isolated-run fail-fast only triggers when upstream's own
  `resolvedOverride.error` already starts with `"model not allowed:"` —
  we do not invent new rejection cases, we just stop hiding upstream's own
  classification.
- Error message is actionable: it names the offending field and tells the
  operator how to fix it (`Remove payload.model to use agent defaults.`).

**Re-apply after merge conflict:**

1. Verify `src/cron/model-override-policy.ts` still exists (new file; should
   survive most merges unless upstream adds a file with the same name).
2. Re-add `validateJobBeforeSave?` to `CronServiceDeps` in
   `src/cron/service/state.ts`. Upstream touches this type often — keep the
   new field at the end of the type.
3. Re-add the two `await state.deps.validateJobBeforeSave?.(…)` calls in
   `src/cron/service/ops.ts`. For the edit path, ensure the pattern is
   `const candidate = structuredClone(job); applyJobPatch(candidate, patch, …); await state.deps.validateJobBeforeSave?.(candidate);`
   so the real `job` object is untouched on validation failure.
4. In `src/cron/isolated-agent/model-selection.ts`, find the
   `resolvedOverride.error.startsWith("model not allowed:")` branch (or its
   `toLowerCase()` equivalent) and ensure it returns `{ ok: false, error }`
   with an actionable message instead of `{ ok: true, warning }`.
5. In `src/gateway/server-cron.ts`, add the
   `import { assertCronPayloadModelAllowed }` line and wire the deps hook:

   ```ts
   validateJobBeforeSave: async (job) => {
     await assertCronPayloadModelAllowed({ cfg: loadConfig(), job });
   },
   ```

**Test:** `pnpm test src/cron/service/save-validation.test.ts src/cron/isolated-agent/run.cron-model-override.test.ts src/cron/isolated-agent/run.skill-filter.test.ts` —
expect all three green.

---

### 5. Scout proposal notifier tooling (2026-04-08)

**Files:**

- `scripts/scout-notify.ts` — fork-only script (~225 LOC)
- `scripts/lib/scout-proposals.ts` — fork-only library
- `test/scripts/scout-notify.smoke.test.ts` — fork-only smoke test
- `test/scripts/scout-proposals.test.ts` — fork-only unit test

**Why:** these files are fork-local tooling driven by three of our cron
jobs (`nightly-scout`, `vision-scout`, `nightly-scout-catchup`) that read
`~/.openclaw/scout-proposals/registry.json`, send pending Scout proposals
to Discord with Approve/Reject/More Info buttons, and update the registry
with message IDs. Upstream has no equivalent — nightly Scout proposal
delivery is specific to this fork's operator workflow.

The 2026-04-08 change specifically switched from strict `loadConfig()` to
`readBestEffortConfig()` so that unrelated legacy schema drift in
`~/.openclaw/openclaw.json` cannot block proposal delivery. The notifier
only needs a readable snapshot to resolve a Discord token and send
messages.

**Why it is safe / has zero merge tax:**

- All four files are fork-only (not in upstream). New files only collide
  if upstream introduces a file with the exact same path.
- `readBestEffortConfig` is an upstream-shipped public API, so we depend on
  upstream's own surface, not a fork helper.

**Re-apply after merge conflict:**

In practice this patch cannot conflict — upstream has no scout proposal
scripts. If a future upstream ships something named `scripts/scout-notify.ts`
or `scripts/lib/scout-proposals.ts`, rename the fork files first and
update the cron `exec` call sites in `~/.openclaw/cron/jobs.json`
(`nightly-scout`, `vision-scout`, `nightly-scout-catchup`).

**Test:** `pnpm test test/scripts/scout-notify.smoke.test.ts test/scripts/scout-proposals.test.ts`.

**Runtime check:** `ls -l ~/.openclaw/scout-proposals/registry.json` —
should show a recent mtime and a sizable file. The three scout cron jobs
write to it; scout-notify.ts drains pending entries and sets message IDs.

---

### 6. OpenAI live follow-up reasoning cleanup (2026-04-09)

**Files:**

- `src/agents/pi-embedded-runner/run/attempt.ts` — extract
  `wrapStreamFnSanitizeOpenAIResponsesFollowupContext` + new
  `sanitizeOpenAIResponsesFollowupMessages` helper, ~20 LOC change
- `src/agents/pi-embedded-runner/run/attempt.test.ts` — new regression
  coverage for orphan `rs_*` block dropping + preservation of valid blocks

**Why:** upstream has an asymmetry in OpenAI reasoning sanitization:

| Path                                                                        | What it runs                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/replay-history.ts:447-448` (replay)          | **Both** `downgradeOpenAIFunctionCallReasoningPairs(downgradeOpenAIReasoningBlocks(messages))` |
| `src/agents/pi-embedded-runner/run/attempt.ts` stream-wrap (live follow-up) | **Only** `downgradeOpenAIFunctionCallReasoningPairs(messages)`                                 |

The live follow-up path resends orphaned `rs_*` reasoning block metadata
that the OpenAI Responses API then rejects with
`Item with id 'rs_...' not found. Items are not persisted when store is
set to false.` As of 2026-04-11 this gateway had **9 journal occurrences of
that error in the last 24 hours**.

**What the patch adds:**

- Moves the inline `streamFn` wrapper to a named helper
  `wrapStreamFnSanitizeOpenAIResponsesFollowupContext(baseFn)` that builds
  a new context with sanitized messages, leaving the original context
  untouched.
- Adds `sanitizeOpenAIResponsesFollowupMessages(messages)` which runs
  `downgradeOpenAIFunctionCallReasoningPairs(downgradeOpenAIReasoningBlocks(messages))`
  in the same order as the replay path.
- Both helpers are exported so the regression test can call them directly.

**Why it is safe:**

- Both downgrade helpers are upstream-owned and used by the replay path,
  so we are not inventing new sanitization — we are making the live path
  match an already-existing upstream pattern.
- The wrapper creates a new context object (`{ ...context, messages: sanitized }`)
  rather than mutating the caller's context, matching upstream's existing
  inline wrapper shape.
- If the sanitized messages array is reference-identical to the input,
  the wrapper returns `baseFn(model, context, options)` unchanged,
  avoiding an unnecessary allocation.

**Re-apply after merge conflict:**

1. Find the `streamFn` wrap site in `src/agents/pi-embedded-runner/run/attempt.ts`.
   Upstream calls `downgradeOpenAIFunctionCallReasoningPairs(messages)` inline.
2. Replace the inline block with a call to
   `wrapStreamFnSanitizeOpenAIResponsesFollowupContext(activeSession.agent.streamFn)`.
3. Ensure the `sanitizeOpenAIResponsesFollowupMessages` helper chains both
   sanitizers: `downgradeOpenAIFunctionCallReasoningPairs(downgradeOpenAIReasoningBlocks(messages))`.
4. Re-export both helpers so the regression test can import them.

**Test:** `pnpm test src/agents/pi-embedded-runner/run/attempt.test.ts` —
expect the two new orphan-reasoning regression cases to pass alongside the
existing 83+.

**If the error stops happening:** if you notice `Item with id 'rs_... not found`
disappears from logs entirely over several days, consider checking whether
upstream finally aligned the live path with the replay path. If so, this
patch can be dropped.

---

### 7. Recurring cron permanent-error auto-disable (2026-04-10)

**Files:**

- `src/cron/service/timer.ts` — new helpers
  `isRecurringMainPermanentRunError`,
  `shouldDisableRecurringMainJobAfterPermanentRunError`,
  `autoDisableRecurringMainJobAfterPermanentRunError`, plus a call site
  inside the recurring-error branch (~120 LOC total)
- `src/cron/service/timer.regression.test.ts` — new regression test, ~157 LOC

**Why:** upstream's `timer.ts` recognizes permanent vs transient errors
via `isTransientCronError`, but **only applies auto-disable to one-shot
`"at"` jobs**. For recurring `"every"` and `"cron"` schedules the
`else if` branch applies exponential backoff and keeps the job enabled
forever, regardless of whether the underlying error is permanent.

Real impact on this gateway: two recurring main-session cron jobs were
looping on the same `Unknown Channel` / `chat not found` failure for days
before the 2026-04-10 fix. The journal during the 2026-04-11 restart
still showed dozens of `[delivery-recovery] Retry failed ... Unknown Channel`
entries from the old stale queue that accumulated while this was broken.

**What the patch adds:**

- Narrow regex allowlist of target-resolution permanent errors:
  - `/\bunknown channel\b/i`
  - `/\btarget channel could not be resolved\b/i`
  - `/\bchat not found\b/i`
  - `/\bcould not resolve (?:target|channel)\b/i`
- `isRecurringMainPermanentRunError(job, error)` — returns true only when
  the job is recurring, session target is `"main"`, and the error matches
  one of the patterns.
- `shouldDisableRecurringMainJobAfterPermanentRunError(...)` — requires
  `consecutiveErrors >= 2` AND both current and previous errors match the
  pattern, so a one-off transient that _happens_ to contain one of those
  words does not trigger disable.
- `autoDisableRecurringMainJobAfterPermanentRunError(...)` — sets
  `job.enabled = false`, clears `nextRunAtMs`, logs a warn line, and
  enqueues an operator-visible system event plus heartbeat request so
  the operator notices via Discord/Telegram.

**Why it is safe:**

- Does not touch one-shot job handling — upstream's existing
  `isTransientCronError` + retry-exhausted logic is unchanged.
- Does not touch transient network errors — those still go through
  upstream's exponential backoff.
- Scoped to `sessionTarget === "main"` + recurring + specific target-
  resolution patterns. Isolated jobs and non-target errors use upstream
  behavior.
- Requires **two** consecutive matching failures; single-shot weirdness
  does not trigger disable.
- On disable, the job state is preserved (not deleted) so the operator
  can inspect the error and decide whether to re-enable or delete.

**Re-apply after merge conflict:**

1. In `src/cron/service/timer.ts`, re-add the three new helper functions
   (`isRecurringMainPermanentRunError`,
   `shouldDisableRecurringMainJobAfterPermanentRunError`,
   `autoDisableRecurringMainJobAfterPermanentRunError`) and the
   `RECURRING_MAIN_RUN_PERMANENT_ERROR_PATTERNS` regex list near the top
   of the file.
2. Find the recurring-error branch in the per-job result handler
   (upstream: `} else if (result.status === "error" && isJobEnabled(job)) {`).
   Before the existing `errorBackoffMs` schedule path, guard with:

   ```ts
   if (
     shouldDisableRecurringMainJobAfterPermanentRunError({
       job,
       currentError: result.error,
       previousError: previousLastError,
     })
   ) {
     autoDisableRecurringMainJobAfterPermanentRunError(state, {
       job,
       error: result.error,
     });
   } else {
     // upstream's existing backoff schedule path here
   }
   ```

3. Ensure `previousLastError` is captured **before** the state update in
   the same block, since we need to compare current vs previous.
4. Both `enqueueSystemEvent` and `requestHeartbeatNow` need to be on
   `state.deps`; upstream already exposes them.

**Test:** `pnpm test src/cron/service/timer.regression.test.ts` — expect
cases for:

- recurring main permanent errors auto-disabling after 2 consecutive
  matching failures
- transient recurring errors staying on backoff (no disable)
- one-shot behavior staying unchanged

**If the patterns become noisy:** tighten or split the regex allowlist.
Do NOT widen it to match generic `ECONNRESET`-style network errors — those
should ride upstream's transient-error backoff path.

---

## Dropped Patches (2026-04-05)

For anyone wondering "wasn't there also ...?" — yes, these used to exist and
were intentionally dropped in favor of upstream. Do not re-add without a
compelling operational reason:

| Former patch                                                             | Why it was dropped                                                                                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension-bridge/index.ts` + `tsdown`/`package.json`/`loader` alias | Bridge imported `src/discord/**` which upstream moved to `extensions/discord/`. All dependents (fork extensions) were also dropped.                                   |
| Fork extensions `goal-loop`, `planner`, `researcher`, `trend-scout`      | All depended on `openclaw/extension-bridge`. Not in upstream. User primarily uses Telegram for LLM interactions — none of these are critical.                         |
| `CronDeliveryContract` `runner-owned` / `task-owned`                     | Upstream introduced its own `cron-owned` / `shared` contract at a different seam. Fighting the refactor is costly and our variant had no unique user-visible benefit. |
| `src/cron/system-event-channel-id-lint.ts` + ops.ts lint                 | Built on top of our contract work; removed alongside it.                                                                                                              |
| `isRecoverableException()` in `src/infra/unhandled-rejections.ts`        | Upstream has its own classification path now.                                                                                                                         |
| `uncaughtException` handler in `src/index.ts` / `src/cli/run-main.ts`    | Same — upstream handles this.                                                                                                                                         |

---

## Upstream Sync Workflow

### Prerequisites

Upstream remote is set up as `upstream`:

```bash
git remote -v  # expect: upstream  https://github.com/openclaw/openclaw.git
```

### Standard merge

```bash
git fetch upstream main
git merge upstream/main
# resolve conflicts — see "Conflict strategy" below
pnpm install     # upstream almost always bumps deps
pnpm build       # must succeed before pushing
git push origin main
```

### Conflict strategy (for thousand-commit gaps)

When the gap is large (hundreds of commits or more), upstream has likely
refactored paths, moved files between `src/` and `extensions/`, and renamed
types. Manual line-by-line merging is not worth the effort. Instead:

1. **Default: take upstream.** For almost any conflicted file that isn't
   explicitly a fork patch file, run `git checkout --theirs -- <file>` and
   move on.
2. **Re-apply the two patches above** on top of the upstream version. The
   locations are stable: model-auth's `resolveApiKeyForProvider`, and the
   three browser files in `extensions/browser/src/browser/`.
3. **Delete fork-only broken files** that reference moved upstream paths
   (e.g. `src/extension-bridge/`, fork extensions depending on it). Do not
   try to rewire them — upstream has already moved on.
4. **Run `pnpm build`.** Any residual errors are either (a) fork-only files
   you forgot to delete or (b) genuine upstream bugs. Fix upstream bugs with
   minimal casts (e.g. the `as unknown as ProviderRuntimeHooks` fix we made
   to `src/agents/pi-embedded-helpers/provider-error-patterns.ts`).
5. **Accept tsgo test errors in upstream test files.** If the main `pnpm build`
   passes but `pnpm tsgo` still shows errors in `extensions/{diffs,fal,google,
openai,firecrawl,discord/voice}/...test.ts` files — those are inherited
   upstream issues. Don't try to fix them.

### Footguns

- **DO NOT** use `git merge -X theirs`. It produces duplicate import blocks
  across hundreds of files because Git's `theirs` strategy resolves per-hunk,
  not per-file. Use `git checkout --theirs -- <file>` instead.
- **DO NOT** `git stash -u` during a merge. Stashing clears `MERGE_HEAD` and
  silently drops the merge state — you end up with thousands of unstaged
  changes and no merge in progress. Use `git commit --no-edit` or
  `git merge --abort` instead.
- **DO NOT** run `scripts/committer` during a merge. It calls
  `git restore --staged :/` which clobbers the staged merge resolutions.
- **DO NOT** re-add fork extensions just because their names appear in old
  configs or docs. They're gone.

### Recovery: merge state lost mid-resolution

If you stashed (or the committer reset the index) and `MERGE_HEAD` is gone
but your working tree still has the resolved content:

```bash
# Stage everything
git add -A

# Manually create the merge commit with two parents
TREE=$(git write-tree)
COMMIT=$(git commit-tree $TREE -p HEAD -p upstream/main -m "Merge upstream/main: NNNN commits

<description of what was kept and dropped>")
git update-ref HEAD $COMMIT
```

Verify with `git log --oneline --graph -5` — the new commit should show the
merge-diamond marker (`*|\`) and include both HEAD and upstream/main as parents.

---

## Verification After Merge

```bash
# 1. Build must pass
pnpm build

# 2. Fork patches must still be present
#    Patch #1 (Azure MI)
grep -n "fetchAzureManagedIdentityToken\|azure-managed-identity" src/agents/model-auth.ts
#    Patch #2 (browser stealth)
grep -n "isStealthEnabled\|getStealthLaunchArgs" extensions/browser/src/browser/chrome.ts
grep -n "applyStealthToContext" extensions/browser/src/browser/pw-session.ts
#    Patch #3 (uncaughtException classifier)
grep -n "isUndiciTlsSessionRace\|isRecoverableException" src/infra/unhandled-rejections.ts
grep -n "isRecoverableException" src/index.ts src/cli/run-main.ts
#    Patch #4 (cron payload.model validation)
grep -n "assertCronPayloadModelAllowed\|validateJobBeforeSave" src/cron/model-override-policy.ts src/cron/service/ops.ts src/cron/service/state.ts src/gateway/server-cron.ts
grep -n "is not allowed by policy" src/cron/isolated-agent/model-selection.ts
#    Patch #5 (scout-notify tooling)
ls scripts/scout-notify.ts scripts/lib/scout-proposals.ts test/scripts/scout-notify.smoke.test.ts test/scripts/scout-proposals.test.ts
#    Patch #6 (OpenAI live follow-up reasoning cleanup)
grep -n "wrapStreamFnSanitizeOpenAIResponsesFollowupContext\|sanitizeOpenAIResponsesFollowupMessages" src/agents/pi-embedded-runner/run/attempt.ts
#    Patch #7 (recurring cron permanent-error auto-disable)
grep -n "RECURRING_MAIN_RUN_PERMANENT_ERROR_PATTERNS\|autoDisableRecurringMainJobAfterPermanentRunError" src/cron/service/timer.ts

# 3. No references to dropped patches should remain
grep -rn "extension-bridge\|runner-owned\|CronDeliveryContract\|\"task-owned\"" src/ extensions/ 2>&1 | head
# (should be empty)

# 4. Narrow tests for each patch
pnpm test src/infra/unhandled-rejections.test.ts                                     # #3
pnpm test src/cron/service/save-validation.test.ts \
          src/cron/isolated-agent/run.cron-model-override.test.ts \
          src/cron/isolated-agent/run.skill-filter.test.ts                            # #4
pnpm test test/scripts/scout-notify.smoke.test.ts test/scripts/scout-proposals.test.ts # #5
pnpm test src/agents/pi-embedded-runner/run/attempt.test.ts                           # #6
pnpm test src/cron/service/timer.regression.test.ts                                   # #7

# 5. Restart the gateway and confirm Azure auth works
systemctl --user restart openclaw-gateway
journalctl --user -u openclaw-gateway -f
```
