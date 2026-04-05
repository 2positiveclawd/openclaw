import type { SessionEntry } from "../config/sessions.js";
import { resolveSessionStoreEntry } from "../config/sessions.js";
import { parseDiscordTarget } from "../discord/targets.js";
import { deliveryContextFromSession } from "../utils/delivery-context.js";

const EMBEDDED_DISCORD_CHANNEL_ID_REGEX = /\bchannelId=(\d+)\b/g;
const DISCORD_SESSION_KEY_REGEX = /discord:(?:channel|group):(\d+)(?::thread:(\d+))?/gi;
const DISCORD_TARGET_REGEX = /\b(?:channel|group|thread):(\d+)\b/gi;

function pushUnique(values: string[], candidate: string): void {
  if (!values.includes(candidate)) {
    values.push(candidate);
  }
}

function addSnowflake(target: Set<string>, value: unknown): void {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    target.add(String(value));
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    target.add(trimmed);
  }
}

function collectFromDiscordSessionKey(target: Set<string>, sessionKey: unknown): void {
  if (typeof sessionKey !== "string") {
    return;
  }
  for (const match of sessionKey.matchAll(DISCORD_SESSION_KEY_REGEX)) {
    const channelId = match[1];
    const threadId = match[2];
    if (channelId) {
      target.add(channelId);
    }
    if (threadId) {
      target.add(threadId);
    }
  }
}

function collectFromDiscordTarget(target: Set<string>, toRaw: unknown): void {
  if (typeof toRaw !== "string") {
    return;
  }
  const trimmed = toRaw.trim();
  if (!trimmed) {
    return;
  }

  try {
    const parsed = parseDiscordTarget(trimmed, { defaultKind: "channel" });
    if (parsed?.kind === "channel") {
      addSnowflake(target, parsed.id);
    }
  } catch {
    // Fall back to regex extraction below.
  }

  for (const match of trimmed.matchAll(DISCORD_TARGET_REGEX)) {
    if (match[1]) {
      target.add(match[1]);
    }
  }
}

function collectFromDiscordEntry(target: Set<string>, entry: SessionEntry | undefined): void {
  if (!entry) {
    return;
  }
  const context = deliveryContextFromSession(entry);
  const channel =
    (typeof context?.channel === "string" ? context.channel : undefined) ??
    (typeof entry.lastChannel === "string" ? entry.lastChannel : undefined) ??
    (typeof entry.channel === "string" ? entry.channel : undefined);
  if (channel !== "discord") {
    return;
  }

  collectFromDiscordTarget(target, context?.to ?? entry.lastTo);
  addSnowflake(target, context?.threadId ?? entry.lastThreadId);
}

export function extractEmbeddedDiscordChannelIds(text: string): string[] {
  if (!text) {
    return [];
  }
  const ids: string[] = [];
  for (const match of text.matchAll(EMBEDDED_DISCORD_CHANNEL_ID_REGEX)) {
    const id = match[1];
    if (id) {
      pushUnique(ids, id);
    }
  }
  return ids;
}

export function collectKnownDiscordChannelIdsFromSessionStore(
  store: Record<string, SessionEntry>,
): Set<string> {
  const known = new Set<string>();
  for (const [sessionKey, entry] of Object.entries(store)) {
    collectFromDiscordSessionKey(known, sessionKey);
    collectFromDiscordEntry(known, entry);
  }
  return known;
}

export function collectKnownDiscordChannelIdsForSessionKey(params: {
  store: Record<string, SessionEntry>;
  sessionKey?: string;
}): Set<string> {
  const known = new Set<string>();
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return known;
  }

  collectFromDiscordSessionKey(known, sessionKey);
  const resolved = resolveSessionStoreEntry({
    store: params.store,
    sessionKey,
  });
  collectFromDiscordSessionKey(known, resolved.normalizedKey);
  for (const legacyKey of resolved.legacyKeys) {
    collectFromDiscordSessionKey(known, legacyKey);
  }
  collectFromDiscordEntry(known, resolved.existing);
  return known;
}

export function findUnresolvedEmbeddedDiscordChannelIds(params: {
  text: string;
  knownDiscordChannelIds: ReadonlySet<string>;
}): string[] {
  const unresolved: string[] = [];
  for (const embeddedId of extractEmbeddedDiscordChannelIds(params.text)) {
    if (!params.knownDiscordChannelIds.has(embeddedId)) {
      unresolved.push(embeddedId);
    }
  }
  return unresolved;
}
