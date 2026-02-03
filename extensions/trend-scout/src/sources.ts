// ---------------------------------------------------------------------------
// Trend Scout - Source Fetchers
// ---------------------------------------------------------------------------

import type { TrendItem, TrendScoutConfig } from "./types.js";

const USER_AGENT = "OpenClaw-TrendScout/1.0";

// ---------------------------------------------------------------------------
// Hacker News
// ---------------------------------------------------------------------------

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  by?: string;
  time?: number;
  descendants?: number;
  type?: string;
}

export async function fetchHackerNews(config: TrendScoutConfig): Promise<TrendItem[]> {
  const items: TrendItem[] = [];

  try {
    // Fetch top stories
    const topRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    const topIds: number[] = await topRes.json();

    // Fetch details for top N items
    const limit = Math.min(config.itemsPerSource, topIds.length);
    const cutoffTime = Date.now() - config.hoursBack * 60 * 60 * 1000;

    const fetchPromises = topIds.slice(0, limit * 2).map(async (id) => {
      try {
        const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return (await res.json()) as HNItem;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);

    for (const item of results) {
      if (!item || !item.title || item.type !== "story") continue;
      if ((item.score || 0) < config.minScore) continue;

      const itemTime = (item.time || 0) * 1000;
      if (itemTime < cutoffTime) continue;

      items.push({
        source: "hackernews",
        title: item.title,
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        score: item.score || 0,
        comments: item.descendants || 0,
        author: item.by,
        timestamp: itemTime,
      });

      if (items.length >= config.itemsPerSource) break;
    }
  } catch (err) {
    console.error("[trend-scout] HN fetch failed:", err);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Reddit (OAuth2 Authentication)
// ---------------------------------------------------------------------------

interface RedditPost {
  data: {
    title: string;
    url: string;
    permalink: string;
    score: number;
    num_comments: number;
    author: string;
    created_utc: number;
    selftext?: string;
    subreddit: string;
  };
}

interface RedditListing {
  data: {
    children: RedditPost[];
  };
}

// Cache the access token
let redditAccessToken: string | null = null;
let redditTokenExpiry = 0;

async function getRedditAccessToken(config: TrendScoutConfig): Promise<string | null> {
  // Return cached token if still valid
  if (redditAccessToken && Date.now() < redditTokenExpiry - 60000) {
    return redditAccessToken;
  }

  // Get credentials from config or environment
  const clientId = config.reddit?.clientId || process.env.REDDIT_CLIENT_ID || "";
  const clientSecret = config.reddit?.clientSecret || process.env.REDDIT_CLIENT_SECRET || "";
  const userAgent = config.reddit?.userAgent || process.env.REDDIT_USER_AGENT || "OpenClaw-TrendScout/1.0";

  if (!clientId || !clientSecret) {
    console.warn("[trend-scout] Reddit credentials not configured (set in config or REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET env vars)");
    return null;
  }

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[trend-scout] Reddit auth failed: ${res.status} ${text}`);
      return null;
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    redditAccessToken = data.access_token;
    redditTokenExpiry = Date.now() + data.expires_in * 1000;

    console.log("[trend-scout] Reddit OAuth2 token acquired");
    return redditAccessToken;
  } catch (err) {
    console.error("[trend-scout] Reddit auth error:", err);
    return null;
  }
}

export async function fetchReddit(config: TrendScoutConfig): Promise<TrendItem[]> {
  const items: TrendItem[] = [];
  const cutoffTime = Date.now() - config.hoursBack * 60 * 60 * 1000;

  // Get OAuth token
  const token = await getRedditAccessToken(config);
  if (!token) {
    console.warn("[trend-scout] Skipping Reddit (no auth token)");
    return items;
  }

  const userAgent = config.reddit?.userAgent || process.env.REDDIT_USER_AGENT || "OpenClaw-TrendScout/1.0";

  for (const subreddit of config.subreddits) {
    try {
      // Use oauth.reddit.com with Bearer token
      const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/hot?limit=25`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": userAgent,
        },
      });

      if (!res.ok) {
        console.warn(`[trend-scout] Reddit r/${subreddit} returned ${res.status}`);
        continue;
      }

      const data: RedditListing = await res.json();

      for (const post of data.data.children) {
        const p = post.data;
        if (p.score < config.minScore) continue;

        const postTime = p.created_utc * 1000;
        if (postTime < cutoffTime) continue;

        items.push({
          source: "reddit",
          title: `[r/${p.subreddit}] ${p.title}`,
          url: p.url.startsWith("http") ? p.url : `https://reddit.com${p.permalink}`,
          score: p.score,
          comments: p.num_comments,
          author: p.author,
          timestamp: postTime,
          description: p.selftext?.slice(0, 200),
        });
      }

      // Rate limit: small delay between subreddits
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`[trend-scout] Reddit r/${subreddit} fetch failed:`, err);
    }
  }

  // Sort by score and limit
  return items
    .sort((a, b) => b.score - a.score)
    .slice(0, config.itemsPerSource);
}

// ---------------------------------------------------------------------------
// GitHub Trending
// ---------------------------------------------------------------------------

export async function fetchGitHubTrending(config: TrendScoutConfig): Promise<TrendItem[]> {
  const items: TrendItem[] = [];

  for (const language of config.languages) {
    try {
      // GitHub doesn't have an official trending API, so we use the search API
      // Search for repos created/pushed recently with stars
      const since = new Date(Date.now() - config.hoursBack * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const query = encodeURIComponent(`language:${language} pushed:>${since} stars:>5`);
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=15`,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (!res.ok) {
        console.warn(`[trend-scout] GitHub ${language} returned ${res.status}`);
        continue;
      }

      const data = await res.json();

      for (const repo of data.items || []) {
        items.push({
          source: "github",
          title: `[${language}] ${repo.full_name}`,
          url: repo.html_url,
          score: repo.stargazers_count,
          author: repo.owner?.login,
          timestamp: new Date(repo.pushed_at).getTime(),
          description: repo.description?.slice(0, 200),
          tags: [language, ...(repo.topics || []).slice(0, 5)],
        });
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[trend-scout] GitHub ${language} fetch failed:`, err);
    }
  }

  return items
    .sort((a, b) => b.score - a.score)
    .slice(0, config.itemsPerSource);
}

// ---------------------------------------------------------------------------
// Fetch All Sources
// ---------------------------------------------------------------------------

export async function fetchAllSources(config: TrendScoutConfig): Promise<TrendItem[]> {
  console.log("[trend-scout] Fetching from all sources...");

  const [hn, reddit, github] = await Promise.all([
    fetchHackerNews(config),
    fetchReddit(config),
    fetchGitHubTrending(config),
  ]);

  console.log(`[trend-scout] Fetched: HN=${hn.length}, Reddit=${reddit.length}, GitHub=${github.length}`);

  return [...hn, ...reddit, ...github];
}
