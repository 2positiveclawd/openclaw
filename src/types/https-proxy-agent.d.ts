/**
 * Ambient type declarations for https-proxy-agent.
 *
 * Provides minimal types when the optional dependency is not installed.
 */
declare module "https-proxy-agent" {
  import type { Agent } from "node:http";

  export class HttpsProxyAgent<Uri extends string = string> extends Agent {
    readonly proxy: URL;
    constructor(proxy: Uri | URL, opts?: Record<string, unknown>);
  }
}
