// ---------------------------------------------------------------------------
// Agent Packs Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  soulFile: string;
  tools: string[];
}

export interface PackDefinition {
  id: string;
  name: string;
  description: string;
  agents: AgentDefinition[];
}

export interface AgentPacksConfig {
  enabled: boolean;
  enabledPacks: string[] | "all";
  disabledPacks: string[];
}

export interface LoadedSoul {
  packId: string;
  agentId: string;
  name: string;
  role: string;
  content: string;
  tools: string[];
}
