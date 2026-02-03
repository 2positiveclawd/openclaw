// ---------------------------------------------------------------------------
// OpenClaw Automation Extension
// ---------------------------------------------------------------------------
//
// This extension provides automation capabilities for OpenClaw:
// - Webhooks: HTTP callbacks triggered by events
// - Chains: Automatic execution of new goals/plans when events occur
//
// Usage in other plugins:
//
//   import { fireEvent } from "@openclaw/automation";
//
//   // When a goal completes:
//   await fireEvent({
//     type: "goal.completed",
//     timestamp: Date.now(),
//     data: { id: goalId, goal: goalText, score: 85, duration: 300000 }
//   });
//
// ---------------------------------------------------------------------------

import type { AutomationEvent, EventType } from "./types.js";
import { fireWebhooks, testWebhook } from "./webhooks.js";
import { evaluateChains } from "./chains.js";
import { loadWebhooks, loadChains, loadTemplates, getTemplate } from "./config.js";
import { notifyDiscord, saveDiscordConfig, getDiscordConfig } from "./discord.js";

// Re-export types
export type {
  AutomationEvent,
  EventType,
  Webhook,
  WebhookPayload,
  Chain,
  ChainTrigger,
  ChainAction,
  Template,
} from "./types.js";

// Re-export config functions
export { loadWebhooks, loadChains, loadTemplates, getTemplate };

// Re-export webhook functions
export { fireWebhooks, testWebhook };

// Re-export chain functions
export { evaluateChains };

// Re-export Discord functions
export { notifyDiscord, saveDiscordConfig, getDiscordConfig };

// Re-export learning functions
export {
  recordLearning,
  findSimilarGoals,
  generateLearningContext,
  getStats as getLearningStats,
} from "./learnings.js";

/**
 * Fire an automation event
 *
 * This is the main entry point for plugins to trigger automation.
 * It will:
 * 1. Send Discord notification (if configured)
 * 2. Fire all matching webhooks
 * 3. Evaluate and execute all matching chains
 *
 * @param event - The event to fire
 * @returns Summary of what was triggered
 */
export async function fireEvent(event: AutomationEvent): Promise<{
  discordNotified: boolean;
  webhooksTriggered: string[];
  chainsTriggered: string[];
}> {
  console.log(`[automation] Event fired: ${event.type} (id: ${event.data.id})`);

  // Fire Discord, webhooks, and chains in parallel
  const [discordNotified, webhooksTriggered, chainsTriggered] = await Promise.all([
    notifyDiscord(event).catch((err) => {
      console.error("[automation] Error sending Discord notification:", err);
      return false;
    }),
    fireWebhooks(event).catch((err) => {
      console.error("[automation] Error firing webhooks:", err);
      return [] as string[];
    }),
    evaluateChains(event).catch((err) => {
      console.error("[automation] Error evaluating chains:", err);
      return [] as string[];
    }),
  ]);

  return { discordNotified, webhooksTriggered, chainsTriggered };
}

/**
 * Helper to create common events
 */
export const events = {
  goalStarted: (id: string, goal: string): AutomationEvent => ({
    type: "goal.started",
    timestamp: Date.now(),
    data: { id, goal, status: "running" },
  }),

  goalCompleted: (
    id: string,
    goal: string,
    score: number,
    duration: number
  ): AutomationEvent => ({
    type: "goal.completed",
    timestamp: Date.now(),
    data: { id, goal, status: "completed", score, duration },
  }),

  goalFailed: (id: string, goal: string, error?: string): AutomationEvent => ({
    type: "goal.failed",
    timestamp: Date.now(),
    data: { id, goal, status: "failed", error },
  }),

  goalStalled: (id: string, goal: string, score: number): AutomationEvent => ({
    type: "goal.stalled",
    timestamp: Date.now(),
    data: { id, goal, status: "stalled", score },
  }),

  planStarted: (id: string, goal: string): AutomationEvent => ({
    type: "plan.started",
    timestamp: Date.now(),
    data: { id, goal, status: "running" },
  }),

  planCompleted: (
    id: string,
    goal: string,
    score: number,
    duration: number
  ): AutomationEvent => ({
    type: "plan.completed",
    timestamp: Date.now(),
    data: { id, goal, status: "completed", score, duration },
  }),

  planFailed: (id: string, goal: string, error?: string): AutomationEvent => ({
    type: "plan.failed",
    timestamp: Date.now(),
    data: { id, goal, status: "failed", error },
  }),

  researchStarted: (id: string, goal: string): AutomationEvent => ({
    type: "research.started",
    timestamp: Date.now(),
    data: { id, goal, status: "running" },
  }),

  researchCompleted: (
    id: string,
    goal: string,
    duration: number
  ): AutomationEvent => ({
    type: "research.completed",
    timestamp: Date.now(),
    data: { id, goal, status: "completed", duration },
  }),
};
