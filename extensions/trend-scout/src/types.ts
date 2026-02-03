// ---------------------------------------------------------------------------
// Trend Scout Types
// ---------------------------------------------------------------------------

export interface TrendScoutConfig {
  // Topics to track (keywords)
  topics: string[];

  // Subreddits to monitor
  subreddits: string[];

  // GitHub languages to track
  languages: string[];

  // How many items to fetch per source
  itemsPerSource: number;

  // Minimum score/upvotes threshold
  minScore: number;

  // Hours to look back
  hoursBack: number;

  // Reddit API credentials (optional - can also use env vars)
  reddit?: {
    clientId: string;
    clientSecret: string;
    userAgent?: string;
  };
}

export interface TrendItem {
  source: "hackernews" | "reddit" | "github";
  title: string;
  url: string;
  score: number;
  comments?: number;
  author?: string;
  timestamp: number;
  description?: string;
  tags?: string[];
}

export interface TrendDigest {
  date: string;
  generatedAt: number;
  topics: string[];
  items: TrendItem[];
  summary: string;
  insights: string[];
  opportunities: string[];
}

export const DEFAULT_CONFIG: TrendScoutConfig = {
  topics: [
    "ai", "llm", "agents", "typescript", "node", "react",
    "startup", "saas", "developer tools", "automation"
  ],
  subreddits: [
    "programming", "typescript", "node", "reactjs",
    "MachineLearning", "LocalLLaMA", "SideProject"
  ],
  languages: ["typescript", "python", "rust", "go"],
  itemsPerSource: 30,
  minScore: 10,
  hoursBack: 24,
};
