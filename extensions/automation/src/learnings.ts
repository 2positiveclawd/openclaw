// ---------------------------------------------------------------------------
// Goal Learning System
// ---------------------------------------------------------------------------
//
// Tracks what works and what doesn't for goals, and injects learnings into
// new goal prompts to improve success rates.
//
// Storage: ~/.openclaw/dashboard/learnings.json
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

const LEARNINGS_FILE = path.join(
  process.env.HOME || "/home/azureuser",
  ".openclaw/dashboard/learnings.json"
);

export interface GoalLearning {
  id: string;
  goal: string;
  keywords: string[];
  outcome: "completed" | "failed" | "stalled";
  score: number;
  iterations: number;
  durationMs: number;
  tokensUsed: number;
  toolsUsed: string[];
  whatWorked: string[];
  whatFailed: string[];
  suggestions: string[];
  createdAt: number;
}

export interface LearningsStore {
  version: number;
  learnings: GoalLearning[];
  stats: {
    totalGoals: number;
    completedGoals: number;
    avgScore: number;
    avgIterations: number;
  };
}

function loadLearnings(): LearningsStore {
  try {
    if (!fs.existsSync(LEARNINGS_FILE)) {
      return {
        version: 1,
        learnings: [],
        stats: { totalGoals: 0, completedGoals: 0, avgScore: 0, avgIterations: 0 },
      };
    }
    return JSON.parse(fs.readFileSync(LEARNINGS_FILE, "utf-8"));
  } catch {
    return {
      version: 1,
      learnings: [],
      stats: { totalGoals: 0, completedGoals: 0, avgScore: 0, avgIterations: 0 },
    };
  }
}

function saveLearnings(store: LearningsStore): void {
  const dir = path.dirname(LEARNINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(LEARNINGS_FILE, JSON.stringify(store, null, 2));
}

/**
 * Extract keywords from goal text for similarity matching
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "and", "or", "but", "if", "then", "else", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "other", "some",
    "such", "no", "not", "only", "same", "so", "than", "too", "very",
    "just", "also", "now", "here", "there", "this", "that", "these", "those",
    "i", "me", "my", "we", "our", "you", "your", "it", "its", "they", "them",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 20);
}

/**
 * Calculate similarity between two keyword sets (Jaccard index)
 */
function similarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Record learnings from a completed goal
 */
export function recordLearning(params: {
  id: string;
  goal: string;
  outcome: "completed" | "failed" | "stalled";
  score: number;
  iterations: number;
  durationMs: number;
  tokensUsed: number;
  toolsUsed?: string[];
  whatWorked?: string[];
  whatFailed?: string[];
  suggestions?: string[];
}): void {
  const store = loadLearnings();

  // Check if we already have this goal
  const existingIdx = store.learnings.findIndex((l) => l.id === params.id);
  if (existingIdx >= 0) {
    // Update existing
    store.learnings[existingIdx] = {
      ...store.learnings[existingIdx],
      ...params,
      keywords: extractKeywords(params.goal),
      createdAt: store.learnings[existingIdx].createdAt,
    };
  } else {
    // Add new
    store.learnings.push({
      ...params,
      keywords: extractKeywords(params.goal),
      toolsUsed: params.toolsUsed || [],
      whatWorked: params.whatWorked || [],
      whatFailed: params.whatFailed || [],
      suggestions: params.suggestions || [],
      createdAt: Date.now(),
    });
  }

  // Update stats
  const completed = store.learnings.filter((l) => l.outcome === "completed");
  store.stats = {
    totalGoals: store.learnings.length,
    completedGoals: completed.length,
    avgScore: completed.length > 0
      ? Math.round(completed.reduce((sum, l) => sum + l.score, 0) / completed.length)
      : 0,
    avgIterations: completed.length > 0
      ? Math.round(completed.reduce((sum, l) => sum + l.iterations, 0) / completed.length)
      : 0,
  };

  // Keep only last 100 learnings
  if (store.learnings.length > 100) {
    store.learnings = store.learnings.slice(-100);
  }

  saveLearnings(store);
  console.log(`[learnings] Recorded learning for goal ${params.id} (${params.outcome})`);
}

/**
 * Find similar past goals and get insights
 */
export function findSimilarGoals(goalText: string, limit = 5): {
  similar: GoalLearning[];
  insights: string[];
} {
  const store = loadLearnings();
  const keywords = extractKeywords(goalText);

  // Find similar goals by keyword overlap
  const withScores = store.learnings
    .map((l) => ({
      learning: l,
      sim: similarity(keywords, l.keywords),
    }))
    .filter((x) => x.sim > 0.1)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit);

  const similar = withScores.map((x) => x.learning);

  // Generate insights from similar goals
  const insights: string[] = [];

  if (similar.length > 0) {
    const completed = similar.filter((l) => l.outcome === "completed");
    const failed = similar.filter((l) => l.outcome === "failed" || l.outcome === "stalled");

    if (completed.length > 0) {
      const avgScore = Math.round(
        completed.reduce((sum, l) => sum + l.score, 0) / completed.length
      );
      const avgIter = Math.round(
        completed.reduce((sum, l) => sum + l.iterations, 0) / completed.length
      );
      insights.push(
        `Similar goals completed with avg score ${avgScore}/100 in ~${avgIter} iterations.`
      );

      // Collect what worked
      const worked = completed.flatMap((l) => l.whatWorked).filter(Boolean);
      if (worked.length > 0) {
        const unique = [...new Set(worked)].slice(0, 3);
        insights.push(`What worked: ${unique.join("; ")}`);
      }
    }

    if (failed.length > 0) {
      // Collect what to avoid
      const toAvoid = failed.flatMap((l) => l.whatFailed).filter(Boolean);
      if (toAvoid.length > 0) {
        const unique = [...new Set(toAvoid)].slice(0, 3);
        insights.push(`Avoid: ${unique.join("; ")}`);
      }
    }

    // Collect suggestions
    const suggestions = similar.flatMap((l) => l.suggestions).filter(Boolean);
    if (suggestions.length > 0) {
      const unique = [...new Set(suggestions)].slice(0, 2);
      insights.push(`Suggestions: ${unique.join("; ")}`);
    }
  }

  return { similar, insights };
}

/**
 * Get overall stats
 */
export function getStats(): LearningsStore["stats"] {
  return loadLearnings().stats;
}

/**
 * Generate prompt context for a new goal based on past learnings
 */
export function generateLearningContext(goalText: string): string | null {
  const { similar, insights } = findSimilarGoals(goalText);

  if (insights.length === 0) {
    return null;
  }

  const lines = [
    "## Insights from similar past goals",
    "",
    ...insights.map((i) => `- ${i}`),
    "",
  ];

  return lines.join("\n");
}
