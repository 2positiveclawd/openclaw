# Local Fork Patches

This document describes patches maintained in our fork (`2positiveclawd/openclaw`) that may conflict when pulling from upstream (`openclaw/openclaw`).

## Overview

Our fork adds extensions (goal-loop, planner, researcher, trend-scout) that need to import core functions. These are exported through a dedicated `extension-bridge` entry point, keeping the upstream `plugin-sdk/index.ts` completely untouched.

## Patches

### 1. Extension Bridge Entry Point

**New file (no upstream conflict):** `src/extension-bridge/index.ts`

**Purpose:** Dedicated entry point that exports orchestration APIs, Discord button registration, gateway client, logging, and other core functions that extensions need.

Extensions import from `openclaw/extension-bridge` for these APIs and continue using `openclaw/plugin-sdk` for standard plugin types (OpenClawConfig, PluginApi, etc.).

**Build config changes:**

| File                    | Change                                                 | Conflict risk                   |
| ----------------------- | ------------------------------------------------------ | ------------------------------- |
| `tsdown.config.ts`      | +7 lines (new entry point block)                       | LOW — config rarely changes     |
| `package.json`          | +1 line in `exports`                                   | LOW — additive                  |
| `src/plugins/loader.ts` | +25 lines (jiti alias for `openclaw/extension-bridge`) | LOW — alias code rarely changes |

**Note:** `src/plugin-sdk/index.ts` is **completely clean** — zero fork-specific exports.

---

### 2. Extension Core-Bridge Files

**Files:**

- `extensions/goal-loop/src/core-bridge.ts`
- `extensions/planner/src/core-bridge.ts`
- `extensions/researcher/src/core-bridge.ts`

**Purpose:** These files provide the bridge between extensions and core. They import from `openclaw/extension-bridge`.

**Conflict likelihood:** NONE — these extensions are not in upstream.

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

Extensions need to import core orchestration functions (agent turn runner, outbound delivery, provider usage, etc.). Originally we added these exports to `src/plugin-sdk/index.ts`, but that file is actively maintained upstream and was our highest-conflict modification.

### The Solution

A dedicated `src/extension-bridge/index.ts` entry point that:

- Is built as a separate tsdown entry (`dist/extension-bridge/index.js`)
- Has its own `package.json` exports mapping (`./extension-bridge`)
- Gets a jiti alias in the plugin loader (`openclaw/extension-bridge`)
- Keeps `src/plugin-sdk/index.ts` completely upstream-clean

Benefits:

- Zero conflict risk on the previously highest-risk file
- Low conflict risk on config files (tsdown, package.json, loader)
- Extensions use stable import paths
- Clear separation: plugin-sdk = upstream API, extension-bridge = fork API

---

## Applying Patches After Merge Conflict

If `git pull upstream main` causes conflicts:

### Step 1: Check which files conflict

```bash
git status
```

### Step 2: For tsdown/package.json/loader conflicts

These are additive patches. Keep upstream changes and re-add our additions:

- `tsdown.config.ts`: Re-add the extension-bridge entry block
- `package.json`: Re-add `"./extension-bridge"` to exports
- `src/plugins/loader.ts`: Re-add `resolveExtensionBridgeAlias()` and the alias config

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
git commit -m "Merge upstream, reapply extension bridge patches"
git push origin main
```

---

## Verification

After applying patches, verify extensions load:

```bash
# Restart gateway
systemctl --user restart openclaw-gateway

# Check logs (should see "service starting" not "failed to start")
journalctl --user -u openclaw-gateway --since "30 seconds ago" | grep -E "(Goal loop|Planner|Researcher|Trend Scout)"
```

Expected output:

```
[plugins] Trend Scout extension loaded
[plugins] Goal loop service starting
[plugins] Planner service starting
[plugins] Researcher service starting
[plugins] Trend Scout scheduler starting...
```

If you see "failed to start" errors about missing modules, the extension-bridge entry point wasn't built or the jiti alias wasn't applied.
