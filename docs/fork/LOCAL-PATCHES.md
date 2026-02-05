# Local Fork Patches

This document describes patches maintained in our fork (`2positiveclawd/openclaw`) that may conflict when pulling from upstream (`openclaw/openclaw`).

## Overview

Our fork adds extensions (goal-loop, planner, researcher) that need to import core functions. Rather than using fragile dynamic imports from `dist/` paths, we export these through the stable plugin-sdk API.

## Patches

### 1. Plugin-SDK Extension Bridge Exports

**File:** `src/plugin-sdk/index.ts`

**Lines added:** 12 (at end of file)

**Purpose:** Export core functions that extensions need to import.

**The patch:**

```typescript
// Extension bridge (for goal-loop, planner, researcher extensions)
export {
  runCronIsolatedAgentTurn,
  type RunCronAgentTurnResult,
} from "../cron/isolated-agent/run.js";
export { loadProviderUsageSummary } from "../infra/provider-usage.load.js";
export { deliverOutboundPayloads, type OutboundDeliveryResult } from "../infra/outbound/deliver.js";
export { createDefaultDeps, type CliDeps } from "../cli/deps.js";

// Discord button registration (for extensions with button handlers)
export {
  registerDiscordButton,
  type DiscordButtonSpec,
} from "../discord/monitor/component-registry.js";

// Gateway client (for extensions needing WebSocket to gateway)
export { GatewayClient } from "../gateway/client.js";
export { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";

// Discord REST helpers
export { createDiscordClient } from "../discord/send.shared.js";

// Logging (for extensions that need debug/error logging)
export { logDebug, logError } from "../logger.js";

// Gateway protocol types
export type { EventFrame } from "../gateway/protocol/index.js";
```

**Conflict likelihood:** LOW - only conflicts if upstream adds exports at the exact end of the file.

**Resolution:** Re-add the block at the end of the file after resolving.

---

### 2. Extension Core-Bridge Files

**Files:**

- `extensions/goal-loop/src/core-bridge.ts`
- `extensions/planner/src/core-bridge.ts`
- `extensions/researcher/src/core-bridge.ts`

**Purpose:** These files provide the bridge between extensions and core. Originally they used `importCoreModule()` to dynamically load from `dist/` paths. We simplified them to import from `openclaw/plugin-sdk`.

**Conflict likelihood:** NONE - these extensions are not in upstream.

---

### 3. Browser Stealth Mode

Anti-bot detection bypass using Apify's fingerprint-suite. Injects realistic browser fingerprints and patches detection vectors (navigator.webdriver, chrome.runtime, plugins, codecs, etc.).

**New file (no conflict risk):**

- `src/browser/stealth.ts` — All stealth logic: `getStealthLaunchArgs()`, `applyStealthToContext()`, `isStealthEnabled()`

**Patched files:**

| File                          | Change                                                                  | Lines |
| ----------------------------- | ----------------------------------------------------------------------- | ----- |
| `src/config/types.browser.ts` | Add `stealth?: boolean` and `proxy?: string` to `BrowserConfig`         | +4    |
| `src/config/zod-schema.ts`    | Add `stealth` and `proxy` to browser config zod schema                  | +2    |
| `src/browser/config.ts`       | Add `stealth` and `proxy` to `ResolvedBrowserConfig` type + resolution  | +6    |
| `src/browser/chrome.ts`       | Import `getStealthLaunchArgs`, add stealth/proxy flags in `spawnOnce()` | +8    |
| `src/browser/pw-session.ts`   | Import + call `applyStealthToContext()` in `observeContext()`           | +5    |

**Dependencies added to `package.json`:**

- `fingerprint-generator` — Generates realistic browser fingerprints
- `fingerprint-injector` — Injects fingerprints into Playwright contexts
- `user-agents` — User-agent string database

**Config:** Enable with `browser.stealth: true` in `~/.openclaw/openclaw.json`.

**Conflict likelihood:** LOW — small additive patches to 4 core files. If upstream restructures browser launch or config types, reapply the patches.

**Resolution:** Re-add stealth fields to types/config, re-add flag injection in `chrome.ts`, re-add context injection in `pw-session.ts`. The `stealth.ts` module is self-contained and only needs its imports to resolve.

---

## Why This Approach

### The Problem

The original `core-bridge.ts` files used dynamic imports:

```typescript
// OLD (broken) approach
await importCoreModule("cron/isolated-agent/run.js");
await importCoreModule("infra/provider-usage.js");
```

This constructed paths like `dist/cron/isolated-agent/run.js` and imported them at runtime. But the bundler (tsdown) doesn't create these as separate files - everything gets bundled into the main entry points.

### Failed Alternatives

1. **Adding entry points to tsdown.config.ts** - Works but requires modifying build config for every module extensions need. Creates more merge conflicts.

2. **Using unbundled builds** - Would require switching away from tsdown, major change.

### The Solution

Export the needed functions through `plugin-sdk`, which is already built as a separate entry point with its own `dist/plugin-sdk/index.js`. Extensions import from the stable `openclaw/plugin-sdk` path.

Benefits:

- Minimal patch (12 lines in one core file)
- Uses existing plugin-sdk infrastructure
- No build config changes needed
- Extensions use stable import paths

---

## Applying Patches After Merge Conflict

If `git pull upstream main` causes conflicts:

### Step 1: Check which files conflict

```bash
git status
```

### Step 2: For plugin-sdk conflicts

```bash
# Open the file and find the conflict markers
# Keep upstream changes, then add our export block at the end
code src/plugin-sdk/index.ts
```

### Step 3: Rebuild and test

```bash
pnpm build
systemctl --user restart openclaw-gateway
journalctl --user -u openclaw-gateway -f
# Look for: "[plugins] Goal loop service starting" etc.
```

### Step 4: Complete the merge

```bash
git add -A
git commit -m "Merge upstream, reapply extension bridge exports"
git push origin main
```

---

## Verification

After applying patches, verify extensions load:

```bash
# Restart gateway
systemctl --user restart openclaw-gateway

# Check logs (should see "service starting" not "failed to start")
journalctl --user -u openclaw-gateway --since "30 seconds ago" | grep -E "(Goal loop|Planner|Researcher)"
```

Expected output:

```
[plugins] Goal loop service starting
[plugins] Planner service starting
[plugins] Researcher service starting
```

If you see "failed to start" errors about missing modules, the plugin-sdk exports weren't applied correctly.
