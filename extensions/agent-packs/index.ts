// ---------------------------------------------------------------------------
// Agent Packs Plugin — Entry Point
// ---------------------------------------------------------------------------
//
// Registers:
//   - HTTP routes: GET /agent-packs/list, GET /agent-packs/soul/:agentId
//   - Gateway RPC: agent-packs.list, agent-packs.soul
//   - CLI: `openclaw packs` subcommands
//   - Channel commands: /packs
//

import type { AgentPacksConfig } from "./src/types.js";
import { PACKS, getPack, findAgentById } from "./src/packs-registry.js";
import {
  loadSoul,
  loadPackSouls,
  loadEnabledSouls,
  listEnabledAgentIds,
} from "./src/soul-loader.js";

// ---------------------------------------------------------------------------
// Plugin config defaults
// ---------------------------------------------------------------------------

function resolvePluginConfig(raw?: Record<string, unknown>): AgentPacksConfig {
  return {
    enabled: raw?.enabled !== false,
    enabledPacks:
      raw?.enabledPacks === "all" || !raw?.enabledPacks
        ? "all"
        : Array.isArray(raw.enabledPacks)
          ? raw.enabledPacks.filter((x): x is string => typeof x === "string")
          : "all",
    disabledPacks: Array.isArray(raw?.disabledPacks)
      ? raw.disabledPacks.filter((x): x is string => typeof x === "string")
      : [],
  };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const agentPacksPlugin = {
  id: "agent-packs",
  name: "Agent Packs",
  description: "Pre-built AI agent teams for common workflows",
  version: "0.1.0",

  register(api: {
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: {
      debug?: (msg: string) => void;
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
    };
    registerCli: (
      registrar: (ctx: { program: import("commander").Command }) => void | Promise<void>,
      opts?: { commands?: string[] },
    ) => void;
    registerGatewayMethod: (
      method: string,
      handler: (opts: {
        params: Record<string, unknown>;
        respond: (ok: boolean, payload?: unknown) => void;
      }) => Promise<void> | void,
    ) => void;
    registerHttpRoute: (params: {
      path: string;
      handler: (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => Promise<void> | void;
    }) => void;
    registerCommand: (command: {
      name: string;
      description: string;
      acceptsArgs?: boolean;
      requireAuth?: boolean;
      handler: (ctx: {
        args?: string;
        channel: string;
        isAuthorizedSender: boolean;
      }) => { text?: string } | Promise<{ text?: string }>;
    }) => void;
  }) {
    const pluginConfig = resolvePluginConfig(api.pluginConfig);
    const logger = api.logger;

    if (!pluginConfig.enabled) {
      logger.info("Agent Packs plugin disabled");
      return;
    }

    logger.info(
      `Agent Packs loaded: ${PACKS.length} packs, ${PACKS.reduce((n, p) => n + p.agents.length, 0)} agents`,
    );

    // -------------------------------------------------------------------
    // 1. Register CLI
    // -------------------------------------------------------------------
    api.registerCli(
      ({ program }) => {
        const packsCmd = program.command("packs").description("Manage agent packs");

        packsCmd
          .command("list")
          .description("List available agent packs")
          .option("--enabled-only", "Only show enabled packs")
          .action((opts: { enabledOnly?: boolean }) => {
            const enabledPackIds =
              pluginConfig.enabledPacks === "all"
                ? PACKS.map((p) => p.id)
                : pluginConfig.enabledPacks;

            for (const pack of PACKS) {
              const enabled =
                enabledPackIds.includes(pack.id) && !pluginConfig.disabledPacks.includes(pack.id);

              if (opts.enabledOnly && !enabled) continue;

              const status = enabled ? "✓" : "○";
              console.log(`${status} ${pack.name} (${pack.id})`);
              console.log(`  ${pack.description}`);
              console.log(`  Agents: ${pack.agents.map((a) => a.name).join(", ")}`);
              console.log();
            }
          });

        packsCmd
          .command("agents")
          .description("List all agents")
          .option("-p, --pack <packId>", "Filter by pack")
          .action((opts: { pack?: string }) => {
            const packs = opts.pack ? [getPack(opts.pack)].filter(Boolean) : PACKS;

            for (const pack of packs) {
              if (!pack) continue;
              console.log(`\n${pack.name}:`);
              for (const agent of pack.agents) {
                console.log(`  ${agent.name} (${agent.id}) — ${agent.role}`);
                console.log(`    Tools: ${agent.tools.join(", ")}`);
              }
            }
          });

        packsCmd
          .command("show <agentId>")
          .description("Show agent soul/prompt")
          .action((agentId: string) => {
            const soul = loadSoul(agentId);
            if (!soul) {
              console.error(`Agent ${agentId} not found`);
              process.exit(1);
            }
            console.log(`Pack: ${soul.packId}`);
            console.log(`Agent: ${soul.name} — ${soul.role}`);
            console.log(`Tools: ${soul.tools.join(", ")}`);
            console.log("\n--- Soul ---\n");
            console.log(soul.content);
          });
      },
      { commands: ["packs"] },
    );

    // -------------------------------------------------------------------
    // 2. Register gateway RPC methods
    // -------------------------------------------------------------------
    api.registerGatewayMethod("agent-packs.list", async ({ params, respond }) => {
      try {
        const packId = typeof params.packId === "string" ? params.packId : undefined;

        if (packId) {
          const pack = getPack(packId);
          if (!pack) {
            respond(false, { error: `Pack ${packId} not found` });
            return;
          }
          respond(true, { pack });
        } else {
          respond(true, {
            packs: PACKS.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              agentCount: p.agents.length,
              agents: p.agents.map((a) => ({
                id: a.id,
                name: a.name,
                role: a.role,
              })),
            })),
            enabledAgentIds: listEnabledAgentIds(pluginConfig),
          });
        }
      } catch (err) {
        respond(false, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    api.registerGatewayMethod("agent-packs.soul", async ({ params, respond }) => {
      try {
        const agentId = typeof params.agentId === "string" ? params.agentId : undefined;
        if (!agentId) {
          respond(false, { error: "agentId required" });
          return;
        }

        const soul = loadSoul(agentId);
        if (!soul) {
          respond(false, { error: `Agent ${agentId} not found` });
          return;
        }

        respond(true, { soul });
      } catch (err) {
        respond(false, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    // -------------------------------------------------------------------
    // 3. Register HTTP routes
    // -------------------------------------------------------------------
    api.registerHttpRoute({
      path: "/agent-packs/list",
      handler: async (_req, res) => {
        const payload = {
          packs: PACKS.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            agentCount: p.agents.length,
            agents: p.agents.map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role,
              tools: a.tools,
            })),
          })),
          enabledAgentIds: listEnabledAgentIds(pluginConfig),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      },
    });

    api.registerHttpRoute({
      path: "/agent-packs/soul",
      handler: async (req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const agentId = url.searchParams.get("agentId");

        if (!agentId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "agentId query param required" }));
          return;
        }

        const soul = loadSoul(agentId);
        if (!soul) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Agent ${agentId} not found` }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ soul }));
      },
    });

    // -------------------------------------------------------------------
    // 4. Register channel text commands
    // -------------------------------------------------------------------
    api.registerCommand({
      name: "packs",
      description: "List available agent packs and agents",
      acceptsArgs: true,
      requireAuth: false,
      handler: (ctx) => {
        const arg = ctx.args?.trim();

        // If arg is an agent ID, show that agent
        if (arg) {
          const found = findAgentById(arg);
          if (found) {
            const { pack, agent } = found;
            const soul = loadSoul(agent.id);
            return {
              text: [
                `**${agent.name}** — ${agent.role}`,
                `Pack: ${pack.name}`,
                `Tools: ${agent.tools.join(", ")}`,
                "",
                soul
                  ? `_Use this agent's soul as a system prompt for specialized assistance._`
                  : "",
              ].join("\n"),
            };
          }

          // Maybe it's a pack ID
          const pack = getPack(arg);
          if (pack) {
            const lines = [
              `**${pack.name}**`,
              pack.description,
              "",
              "Agents:",
              ...pack.agents.map((a) => `• ${a.name} (\`${a.id}\`) — ${a.role}`),
            ];
            return { text: lines.join("\n") };
          }

          return { text: `Pack or agent "${arg}" not found.` };
        }

        // List all packs
        const lines = ["**Agent Packs**", ""];
        for (const pack of PACKS) {
          lines.push(`• **${pack.name}** (\`${pack.id}\`) — ${pack.agents.length} agents`);
          lines.push(`  ${pack.description}`);
        }
        lines.push("");
        lines.push("Use `/packs <pack-id>` to see agents in a pack.");
        return { text: lines.join("\n") };
      },
    });
  },
};

// Export for programmatic use
export { PACKS, getPack, findAgentById } from "./src/packs-registry.js";
export {
  loadSoul,
  loadPackSouls,
  loadEnabledSouls,
  listEnabledAgentIds,
  getSoulPath,
  listAllAgentIds,
} from "./src/soul-loader.js";
export type { AgentPacksConfig, PackDefinition, AgentDefinition, LoadedSoul } from "./src/types.js";

export default agentPacksPlugin;
