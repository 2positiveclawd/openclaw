// ---------------------------------------------------------------------------
// Extension Bridge
// ---------------------------------------------------------------------------
//
// Dedicated entry point for fork extensions (goal-loop, planner, researcher,
// trend-scout). Keeps the upstream plugin-sdk/index.ts patch-free by housing
// all orchestration, Discord-button, gateway-client, and logging re-exports
// here instead.
//
// Extensions import from "openclaw/extension-bridge" for these APIs and keep
// using "openclaw/plugin-sdk" for standard plugin types (OpenClawConfig, etc.).

// Orchestration APIs
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
