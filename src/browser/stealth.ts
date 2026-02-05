/**
 * Browser stealth mode — anti-bot detection bypass.
 *
 * Uses Apify's fingerprint-suite to inject realistic browser fingerprints
 * and patch common detection vectors (navigator.webdriver, chrome.runtime,
 * plugins, codecs, etc.).
 *
 * All stealth logic is contained here to keep core patches minimal.
 */

import type { BrowserContext } from "playwright-core";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("browser").child("stealth");

/** Extra Chrome flags for stealth mode. */
export function getStealthLaunchArgs(opts: { headless: boolean }): string[] {
  const args: string[] = [
    // Disable automation flags that sites detect
    "--disable-blink-features=AutomationControlled",
    // Realistic window size
    "--window-size=1920,1080",
  ];

  if (opts.headless) {
    // In headless, use the "new" headless that's harder to detect.
    // The caller already pushes --headless=new, but we add GL flags
    // to avoid headless GL fingerprint leaks.
    args.push("--use-gl=angle", "--use-angle=swiftshader-webgl");
  }

  return args;
}

/** Check config to see if stealth mode is enabled. */
export function isStealthEnabled(): boolean {
  try {
    const cfg = loadConfig();
    return cfg?.browser?.stealth === true;
  } catch {
    return false;
  }
}

/**
 * Inject fingerprint + stealth evasions into a Playwright BrowserContext.
 *
 * Lazy-loads fingerprint-generator and fingerprint-injector so there's
 * zero cost when stealth is disabled.
 */
export async function applyStealthToContext(context: BrowserContext): Promise<void> {
  try {
    const { FingerprintGenerator } = await import("fingerprint-generator");
    const { FingerprintInjector } = await import("fingerprint-injector");

    const generator = new FingerprintGenerator({
      browsers: ["chrome"],
      operatingSystems: [process.platform === "darwin" ? "macos" : "linux"],
      devices: ["desktop"],
      locales: ["en-US"],
    });

    const { fingerprint, headers } = generator.getFingerprint();

    const injector = new FingerprintInjector();
    await injector.attachFingerprintToPlaywright(context, { fingerprint, headers });

    log.info("stealth fingerprint injected");
  } catch (err) {
    log.warn(`stealth injection failed: ${String(err)}`);
  }
}
