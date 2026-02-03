// ---------------------------------------------------------------------------
// Webhook Dispatcher
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type { AutomationEvent, Webhook, WebhookPayload } from "./types.js";
import { loadWebhooks, updateWebhookStatus } from "./config.js";

/**
 * Fire webhooks for an event
 *
 * @param event - The automation event to dispatch
 * @returns Array of webhook IDs that were triggered
 */
export async function fireWebhooks(event: AutomationEvent): Promise<string[]> {
  const webhooks = loadWebhooks();
  const matchingWebhooks = webhooks.filter((w) => w.events.includes(event.type));

  if (matchingWebhooks.length === 0) {
    return [];
  }

  console.log(
    `[automation] Firing ${matchingWebhooks.length} webhook(s) for event: ${event.type}`
  );

  const triggered: string[] = [];

  await Promise.all(
    matchingWebhooks.map(async (webhook) => {
      try {
        const status = await sendWebhook(webhook, event);
        updateWebhookStatus(webhook.id, Date.now(), status);
        triggered.push(webhook.id);
        console.log(
          `[automation] Webhook ${webhook.name} (${webhook.id}) fired: ${status}`
        );
      } catch (err) {
        console.error(
          `[automation] Webhook ${webhook.name} (${webhook.id}) failed:`,
          err
        );
        updateWebhookStatus(webhook.id, Date.now(), 0);
      }
    })
  );

  return triggered;
}

/**
 * Send a single webhook request
 */
async function sendWebhook(
  webhook: Webhook,
  event: AutomationEvent
): Promise<number> {
  const payload: WebhookPayload = {
    event: event.type,
    timestamp: event.timestamp,
    data: event.data,
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenClaw-Automation/1.0",
    "X-OpenClaw-Event": event.type,
    "X-OpenClaw-Delivery": crypto.randomUUID(),
  };

  // Sign payload if secret is configured
  if (webhook.secret) {
    const signature = crypto
      .createHmac("sha256", webhook.secret)
      .update(body)
      .digest("hex");
    headers["X-OpenClaw-Signature"] = `sha256=${signature}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Test a webhook by sending a test payload
 */
export async function testWebhook(webhookId: string): Promise<{
  success: boolean;
  status?: number;
  error?: string;
}> {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find((w) => w.id === webhookId);

  if (!webhook) {
    return { success: false, error: "Webhook not found" };
  }

  const testEvent: AutomationEvent = {
    type: "goal.completed",
    timestamp: Date.now(),
    data: {
      id: "test-webhook",
      goal: "Test webhook delivery",
      status: "completed",
      score: 100,
      duration: 1000,
    },
  };

  try {
    const status = await sendWebhook(webhook, testEvent);
    return { success: status >= 200 && status < 300, status };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
