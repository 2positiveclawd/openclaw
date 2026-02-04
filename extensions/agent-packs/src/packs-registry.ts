// ---------------------------------------------------------------------------
// Agent Packs Registry
// ---------------------------------------------------------------------------
// Defines all available packs and their agents

import type { PackDefinition } from "./types.js";

export const PACKS: PackDefinition[] = [
  {
    id: "content-creator",
    name: "Content Creator",
    description: "Plan, script, and distribute content across platforms",
    agents: [
      {
        id: "mia-strategist",
        name: "Mia",
        role: "Content Strategist",
        soulFile: "content-creator/mia-strategist.md",
        tools: ["file-read", "file-write", "web-search"],
      },
      {
        id: "blake-scriptwriter",
        name: "Blake",
        role: "Script Writer",
        soulFile: "content-creator/blake-scriptwriter.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "jordan-social",
        name: "Jordan",
        role: "Social Media Manager",
        soulFile: "content-creator/jordan-social.md",
        tools: ["file-read", "file-write", "web-search"],
      },
    ],
  },
  {
    id: "dev-team",
    name: "Dev Team",
    description: "Code review, documentation, and technical leadership",
    agents: [
      {
        id: "marcus-techlead",
        name: "Marcus",
        role: "Tech Lead",
        soulFile: "dev-team/marcus-techlead.md",
        tools: ["file-read", "file-write", "exec"],
      },
      {
        id: "elena-reviewer",
        name: "Elena",
        role: "Code Reviewer",
        soulFile: "dev-team/elena-reviewer.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "sam-docs",
        name: "Sam",
        role: "Documentation Specialist",
        soulFile: "dev-team/sam-docs.md",
        tools: ["file-read", "file-write"],
      },
    ],
  },
  {
    id: "solopreneur",
    name: "Solopreneur",
    description: "Executive assistance, research, and outreach for solo founders",
    agents: [
      {
        id: "claire-assistant",
        name: "Claire",
        role: "Executive Assistant",
        soulFile: "solopreneur/claire-assistant.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "leo-researcher",
        name: "Leo",
        role: "Research Analyst",
        soulFile: "solopreneur/leo-researcher.md",
        tools: ["file-read", "file-write", "web-search"],
      },
      {
        id: "harper-outreach",
        name: "Harper",
        role: "Outreach Specialist",
        soulFile: "solopreneur/harper-outreach.md",
        tools: ["file-read", "file-write", "web-search"],
      },
    ],
  },
  {
    id: "fitness-training",
    name: "Fitness & Training",
    description: "Workout programs, nutrition guidance, and accountability",
    agents: [
      {
        id: "noah-coach",
        name: "Noah",
        role: "Training Coach",
        soulFile: "fitness-training/noah-coach.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "nina-nutrition",
        name: "Nina",
        role: "Nutrition Coach",
        soulFile: "fitness-training/nina-nutrition.md",
        tools: ["file-read", "file-write", "web-search"],
      },
      {
        id: "ethan-accountability",
        name: "Ethan",
        role: "Accountability Coach",
        soulFile: "fitness-training/ethan-accountability.md",
        tools: ["file-read", "file-write"],
      },
    ],
  },
  {
    id: "health-wellness",
    name: "Health & Wellness",
    description: "Sleep optimization, habit building, and wellness routines",
    agents: [
      {
        id: "olivia-wellness",
        name: "Olivia",
        role: "Wellness Coach",
        soulFile: "health-wellness/olivia-wellness.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "mason-sleep",
        name: "Mason",
        role: "Sleep Coach",
        soulFile: "health-wellness/mason-sleep.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "priya-habits",
        name: "Priya",
        role: "Habits Coach",
        soulFile: "health-wellness/priya-habits.md",
        tools: ["file-read", "file-write"],
      },
    ],
  },
  {
    id: "finance-taxes",
    name: "Finance & Taxes",
    description: "Invoicing, expense tracking, and tax season preparation",
    agents: [
      {
        id: "sophia-invoices",
        name: "Sophia",
        role: "Invoicing Specialist",
        soulFile: "finance-taxes/sophia-invoices.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "liam-expenses",
        name: "Liam",
        role: "Expense Tracker",
        soulFile: "finance-taxes/liam-expenses.md",
        tools: ["file-read", "file-write"],
      },
      {
        id: "nora-tax",
        name: "Nora",
        role: "Tax Season Planner",
        soulFile: "finance-taxes/nora-tax.md",
        tools: ["file-read", "file-write"],
      },
    ],
  },
];

export function getPack(packId: string): PackDefinition | undefined {
  return PACKS.find((p) => p.id === packId);
}

export function getAgent(
  packId: string,
  agentId: string,
): { pack: PackDefinition; agent: PackDefinition["agents"][0] } | undefined {
  const pack = getPack(packId);
  if (!pack) return undefined;
  const agent = pack.agents.find((a) => a.id === agentId);
  if (!agent) return undefined;
  return { pack, agent };
}

export function findAgentById(
  agentId: string,
): { pack: PackDefinition; agent: PackDefinition["agents"][0] } | undefined {
  for (const pack of PACKS) {
    const agent = pack.agents.find((a) => a.id === agentId);
    if (agent) return { pack, agent };
  }
  return undefined;
}
