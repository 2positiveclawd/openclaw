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
 * Supplementary headless evasions that fingerprint-injector doesn't cover.
 * Patches: window.chrome, chrome.runtime, Permissions.query, plugins,
 * and iframe contentWindow leaks.
 */
const HEADLESS_EVASIONS = `
// -- chrome object --
if (!window.chrome) {
  Object.defineProperty(window, 'chrome', {
    writable: true,
    enumerable: true,
    configurable: false,
    value: {},
  });
}
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
    PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
    PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
    RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    connect: function() { return { onDisconnect: { addListener: function() {} } }; },
    sendMessage: function() {},
  };
}
if (!window.chrome.app) {
  window.chrome.app = {
    isInstalled: false,
    InstallState: { INSTALLED: 'installed', DISABLED: 'disabled', NOT_INSTALLED: 'not_installed' },
    RunningState: { RUNNING: 'running', CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run' },
    getDetails: function() { return null; },
    getIsInstalled: function() { return false; },
  };
}

// -- plugins (headless has 0) --
if (navigator.plugins.length === 0) {
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
  ];
  const pluginArray = Object.create(PluginArray.prototype);
  fakePlugins.forEach((p, i) => {
    const plugin = Object.create(Plugin.prototype, {
      name: { value: p.name, enumerable: true },
      filename: { value: p.filename, enumerable: true },
      description: { value: p.description, enumerable: true },
      length: { value: 0, enumerable: true },
    });
    pluginArray[i] = plugin;
  });
  Object.defineProperty(pluginArray, 'length', { value: fakePlugins.length, enumerable: true });
  Object.defineProperty(pluginArray, 'item', { value: function(i) { return this[i] || null; } });
  Object.defineProperty(pluginArray, 'namedItem', { value: function(n) {
    for (let i = 0; i < this.length; i++) { if (this[i].name === n) return this[i]; }
    return null;
  }});
  Object.defineProperty(pluginArray, 'refresh', { value: function() {} });
  try {
    Object.defineProperty(navigator, 'plugins', { get: () => pluginArray });
  } catch {}
}

// -- Permissions.query --
const originalQuery = window.Permissions?.prototype?.query;
if (originalQuery) {
  window.Permissions.prototype.query = function(parameters) {
    if (parameters?.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission, onchange: null });
    }
    return originalQuery.call(this, parameters);
  };
}

// -- iframe contentWindow --
try {
  const origAttachShadow = HTMLElement.prototype.attachShadow;
  HTMLElement.prototype.attachShadow = function() {
    return origAttachShadow.apply(this, arguments);
  };
} catch {}
`;

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

    // Supplement with headless-specific evasions
    await context.addInitScript(HEADLESS_EVASIONS);

    log.info("stealth fingerprint injected");
  } catch (err) {
    log.warn(`stealth injection failed: ${String(err)}`);
  }
}
