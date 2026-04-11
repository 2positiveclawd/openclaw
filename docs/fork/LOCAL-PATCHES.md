# Local Fork Patches

Minimal patches maintained in `2positiveclawd/openclaw` on top of upstream
`openclaw/openclaw`. As of the **2026-04-11** upstream merge (3250 commits),
the fork is deliberately kept as thin as possible — three patches remain.

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
grep -n "fetchAzureManagedIdentityToken\|azure-managed-identity" src/agents/model-auth.ts
grep -n "isStealthEnabled\|getStealthLaunchArgs" extensions/browser/src/browser/chrome.ts
grep -n "applyStealthToContext" extensions/browser/src/browser/pw-session.ts
grep -n "isUndiciTlsSessionRace\|isRecoverableException" src/infra/unhandled-rejections.ts
grep -n "isRecoverableException" src/index.ts src/cli/run-main.ts

# 3. No references to dropped patches should remain
grep -rn "extension-bridge\|runner-owned\|CronDeliveryContract" src/ extensions/ 2>&1 | head
# (should be empty)

# 4. Narrow tests for the uncaughtException classifier
pnpm test src/infra/unhandled-rejections.test.ts

# 5. Restart the gateway and confirm Azure auth works
systemctl --user restart openclaw-gateway
journalctl --user -u openclaw-gateway -f
```
