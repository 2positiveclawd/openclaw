/**
 * Ambient type declarations for fingerprint-generator and fingerprint-injector.
 *
 * These are optional peer dependencies used by the stealth browser module.
 */
declare module "fingerprint-generator" {
  export class FingerprintGenerator {
    constructor(options?: {
      browsers?: string[];
      operatingSystems?: string[];
      devices?: string[];
      locales?: string[];
    });
    getFingerprint(): {
      fingerprint: Record<string, unknown>;
      headers: Record<string, string>;
    };
  }
}

declare module "fingerprint-injector" {
  import type { BrowserContext } from "playwright-core";

  export class FingerprintInjector {
    attachFingerprintToPlaywright(
      context: BrowserContext,
      options: {
        fingerprint: Record<string, unknown>;
        headers: Record<string, string>;
      },
    ): Promise<void>;
  }
}
