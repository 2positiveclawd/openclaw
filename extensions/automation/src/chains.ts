// ---------------------------------------------------------------------------
// Chain Executor
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AutomationEvent, Chain, ChainAction } from "./types.js";
import { loadChains, updateChainTriggered, getTemplate } from "./config.js";

const execFileAsync = promisify(execFile);

// Path to openclaw CLI
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "/home/azureuser/openclaw/openclaw.mjs";

/**
 * Evaluate and execute chains for an event
 *
 * @param event - The automation event to evaluate
 * @returns Array of chain IDs that were triggered
 */
export async function evaluateChains(event: AutomationEvent): Promise<string[]> {
  const chains = loadChains();
  const triggered: string[] = [];

  for (const chain of chains) {
    if (shouldTrigger(chain, event)) {
      console.log(
        `[automation] Chain "${chain.name}" (${chain.id}) triggered by event: ${event.type}`
      );

      try {
        await executeChainAction(chain.action);
        updateChainTriggered(chain.id);
        triggered.push(chain.id);
        console.log(`[automation] Chain "${chain.name}" executed successfully`);
      } catch (err) {
        console.error(`[automation] Chain "${chain.name}" failed:`, err);
      }
    }
  }

  return triggered;
}

/**
 * Check if a chain should trigger for an event
 */
function shouldTrigger(chain: Chain, event: AutomationEvent): boolean {
  const { trigger } = chain;

  // Check event type matches trigger type
  const eventTypeMap: Record<string, string> = {
    "goal.completed": "goal",
    "goal.failed": "goal",
    "plan.completed": "plan",
    "plan.failed": "plan",
    "research.completed": "research",
  };

  const eventEntityType = eventTypeMap[event.type];
  if (!eventEntityType || eventEntityType !== trigger.type) {
    return false;
  }

  // Check event matches (completed/failed)
  const eventAction = event.type.split(".")[1]; // "completed" or "failed"
  if (eventAction !== trigger.event) {
    return false;
  }

  // Check specific ID if configured
  if (trigger.id && event.data.id !== trigger.id) {
    return false;
  }

  // Check score conditions
  if (trigger.condition) {
    const score = event.data.score;
    if (typeof score === "number") {
      if (trigger.condition.minScore !== undefined && score < trigger.condition.minScore) {
        return false;
      }
      if (trigger.condition.maxScore !== undefined && score > trigger.condition.maxScore) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Execute a chain action (start a new goal/plan/research)
 */
async function executeChainAction(action: ChainAction): Promise<void> {
  // Get config from template if specified
  let config = action.config || {};
  if (action.templateId) {
    const template = getTemplate(action.templateId);
    if (template) {
      config = { ...template.config, ...config };
    }
  }

  if (!config.goal) {
    throw new Error("Chain action requires a goal");
  }

  const args: string[] = [];

  switch (action.type) {
    case "goal":
      args.push("goal", "start", "--goal", config.goal);
      if (config.criteria && config.criteria.length > 0) {
        args.push("--criteria", ...config.criteria);
      }
      if (config.budget?.maxIterations) {
        args.push("--budget-iterations", String(config.budget.maxIterations));
      }
      if (config.budget?.maxTokens) {
        args.push("--budget-tokens", String(config.budget.maxTokens));
      }
      if (config.budget?.maxTimeMs) {
        args.push("--budget-time", `${Math.round(config.budget.maxTimeMs / 60000)}m`);
      }
      break;

    case "plan":
      args.push("planner", "start", "--goal", config.goal);
      if (config.criteria && config.criteria.length > 0) {
        args.push("--criteria", ...config.criteria);
      }
      if (config.budget?.maxIterations) {
        args.push("--max-turns", String(config.budget.maxIterations));
      }
      if (config.budget?.maxTokens) {
        args.push("--max-tokens", String(config.budget.maxTokens));
      }
      if (config.budget?.maxTimeMs) {
        args.push("--max-time", `${Math.round(config.budget.maxTimeMs / 60000)}m`);
      }
      break;

    case "research":
      args.push("researcher", "start", "--goal", config.goal);
      if (config.budget?.maxIterations) {
        args.push("--max-turns", String(config.budget.maxIterations));
      }
      if (config.budget?.maxTokens) {
        args.push("--max-tokens", String(config.budget.maxTokens));
      }
      if (config.budget?.maxTimeMs) {
        args.push("--max-time", `${Math.round(config.budget.maxTimeMs / 60000)}m`);
      }
      break;
  }

  console.log(`[automation] Executing: node ${OPENCLAW_BIN} ${args.join(" ")}`);

  const { stdout, stderr } = await execFileAsync("node", [OPENCLAW_BIN, ...args], {
    timeout: 60000, // 1 minute timeout for starting
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  if (stderr && !stdout) {
    throw new Error(stderr);
  }

  console.log(`[automation] Started: ${stdout.trim()}`);
}
