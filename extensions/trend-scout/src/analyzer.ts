// ---------------------------------------------------------------------------
// Trend Scout - Analyzer
// ---------------------------------------------------------------------------
//
// Filters trends by relevance and generates insights using LLM.
// ---------------------------------------------------------------------------

import type { TrendItem, TrendScoutConfig, TrendDigest } from "./types.js";

/**
 * Filter items by topic relevance using keyword matching
 */
export function filterByRelevance(
  items: TrendItem[],
  config: TrendScoutConfig
): TrendItem[] {
  const topicPatterns = config.topics.map((t) => new RegExp(t, "i"));

  return items.filter((item) => {
    const text = [
      item.title,
      item.description || "",
      ...(item.tags || []),
    ].join(" ");

    return topicPatterns.some((pattern) => pattern.test(text));
  });
}

/**
 * Deduplicate items by URL
 */
export function deduplicateItems(items: TrendItem[]): TrendItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Score and rank items by importance
 */
export function rankItems(items: TrendItem[]): TrendItem[] {
  // Normalize scores per source (they have different scales)
  const bySource = new Map<string, TrendItem[]>();
  for (const item of items) {
    const list = bySource.get(item.source) || [];
    list.push(item);
    bySource.set(item.source, list);
  }

  // Add normalized score
  const withNormalized: Array<TrendItem & { normalizedScore: number }> = [];

  for (const [source, sourceItems] of bySource) {
    const maxScore = Math.max(...sourceItems.map((i) => i.score), 1);
    for (const item of sourceItems) {
      withNormalized.push({
        ...item,
        normalizedScore: item.score / maxScore,
      });
    }
  }

  // Sort by normalized score
  return withNormalized
    .sort((a, b) => b.normalizedScore - a.normalizedScore)
    .map(({ normalizedScore, ...item }) => item);
}

/**
 * Build the prompt for LLM analysis
 */
export function buildAnalysisPrompt(items: TrendItem[], config: TrendScoutConfig): string {
  const itemsList = items
    .slice(0, 30) // Limit for prompt size
    .map((item, i) => {
      const desc = item.description ? ` - ${item.description}` : "";
      return `${i + 1}. [${item.source}] "${item.title}" (score: ${item.score})${desc}`;
    })
    .join("\n");

  return `You are a tech trend analyst. Analyze these trending items from Hacker News, Reddit, and GitHub.

## Topics of Interest
${config.topics.join(", ")}

## Trending Items
${itemsList}

## Your Task
Provide a concise analysis with:

1. **Summary** (2-3 sentences): What's the overall trend landscape today?

2. **Key Insights** (3-5 bullet points): Notable patterns, emerging technologies, or interesting developments.

3. **Opportunities** (2-3 bullet points): Actionable opportunities for a developer/entrepreneur based on these trends.

4. **Top Picks** (3-5 items): Which items are most worth reading? Include the item number and why.

Be specific, actionable, and focus on what matters for builders. Skip generic observations.`;
}

/**
 * Parse LLM response into structured insights
 */
export function parseAnalysisResponse(response: string): {
  summary: string;
  insights: string[];
  opportunities: string[];
  topPicks: string[];
} {
  const sections = {
    summary: "",
    insights: [] as string[],
    opportunities: [] as string[],
    topPicks: [] as string[],
  };

  const lines = response.split("\n");
  let currentSection = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section headers (with or without markdown formatting)
    // Match "Summary", "**Summary**", "## Summary", "1. Summary", etc.
    const headerPattern = /^(?:\*{1,2}|#{1,3}|\d+\.)?\s*/;
    const cleanHeader = trimmed.replace(headerPattern, "").replace(/\*{1,2}$/, "").toLowerCase();

    if (cleanHeader === "summary" || cleanHeader.startsWith("summary:")) {
      currentSection = "summary";
      continue;
    }
    if (cleanHeader === "key insights" || cleanHeader.startsWith("key insight") || cleanHeader === "insights") {
      currentSection = "insights";
      continue;
    }
    if (cleanHeader === "opportunities" || cleanHeader.startsWith("opportunit")) {
      currentSection = "opportunities";
      continue;
    }
    if (cleanHeader === "top picks" || cleanHeader.startsWith("top pick")) {
      currentSection = "topPicks";
      continue;
    }

    // Extract content
    if (currentSection === "summary" && !trimmed.startsWith("-") && !trimmed.startsWith("*") && !/^\d+\./.test(trimmed)) {
      sections.summary += (sections.summary ? " " : "") + trimmed;
    } else if (currentSection && (trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed))) {
      const content = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
      if (currentSection === "insights") sections.insights.push(content);
      if (currentSection === "opportunities") sections.opportunities.push(content);
      if (currentSection === "topPicks") sections.topPicks.push(content);
    }
  }

  return sections;
}

/**
 * Create the full digest
 */
export function createDigest(
  items: TrendItem[],
  analysis: { summary: string; insights: string[]; opportunities: string[] },
  config: TrendScoutConfig
): TrendDigest {
  const now = new Date();
  return {
    date: now.toISOString().split("T")[0],
    generatedAt: now.getTime(),
    topics: config.topics,
    items: items.slice(0, 50), // Keep top 50 for storage
    summary: analysis.summary,
    insights: analysis.insights,
    opportunities: analysis.opportunities,
  };
}

/**
 * Format digest as markdown for memory storage
 */
export function formatDigestAsMarkdown(digest: TrendDigest): string {
  const lines: string[] = [
    `# Trend Scout - ${digest.date}`,
    "",
    `*Generated at ${new Date(digest.generatedAt).toISOString()}*`,
    "",
    "## Summary",
    "",
    digest.summary,
    "",
    "## Key Insights",
    "",
    ...digest.insights.map((i) => `- ${i}`),
    "",
    "## Opportunities",
    "",
    ...digest.opportunities.map((o) => `- ${o}`),
    "",
    "## Top Trending Items",
    "",
  ];

  // Group by source
  const bySource = new Map<string, TrendItem[]>();
  for (const item of digest.items.slice(0, 20)) {
    const list = bySource.get(item.source) || [];
    list.push(item);
    bySource.set(item.source, list);
  }

  for (const [source, sourceItems] of bySource) {
    lines.push(`### ${source.charAt(0).toUpperCase() + source.slice(1)}`);
    lines.push("");
    for (const item of sourceItems.slice(0, 7)) {
      const title = item.title.replace(/^\[.*?\]\s*/, ""); // Remove source prefix
      lines.push(`- [${title}](${item.url}) (score: ${item.score})`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Topics tracked: ${digest.topics.join(", ")}*`);

  return lines.join("\n");
}
