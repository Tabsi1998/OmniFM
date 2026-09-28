import { buildCommandsJson } from "../commands.js";
import { safeTokenEquals } from "../lib/api-helpers.js";
import { clipText } from "../lib/helpers.js";
import { log } from "../lib/logging.js";
import {
  getDiscordBotListState,
  mergeDiscordBotListVotes,
  recordDiscordBotListVote,
  setDiscordBotListSyncStatus,
} from "../discordbotlist-store.js";
import { mergeVoteEvents, recordVoteEvent } from "../vote-events-store.js";

const DISCORD_BOT_LIST_API_BASE = "https://discordbotlist.com/api/v1";

function parseEnvInt(name, fallback, min = 0) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function resolveCommanderRuntime(runtimes = []) {
  return runtimes.find((runtime) => runtime?.role === "commander")
    || runtimes[0]
    || null;
}

function resolveDiscordBotListConfig(runtimes = []) {
  const token = String(process.env.DISCORDBOTLIST_TOKEN || "").trim();
  const explicitBotId = String(process.env.DISCORDBOTLIST_BOT_ID || "").trim();
  const slug = String(process.env.DISCORDBOTLIST_SLUG || "").trim().toLowerCase();
  const webhookSecret = String(process.env.DISCORDBOTLIST_WEBHOOK_SECRET || "").trim();
  const commanderRuntime = resolveCommanderRuntime(runtimes);
  const botId = explicitBotId
    || String(commanderRuntime?.getApplicationId?.() || commanderRuntime?.config?.clientId || "").trim();
  const enabled = String(process.env.DISCORDBOTLIST_ENABLED ?? (token ? "1" : "0")).trim() !== "0"
    && Boolean(token)
    && /^\d{17,22}$/.test(botId);
  const statsScope = String(process.env.DISCORDBOTLIST_STATS_SCOPE || "commander").trim().toLowerCase() === "aggregate"
    ? "aggregate"
    : "commander";

  return {
    enabled,
    token,
    botId,
    slug,
    webhookSecret,
    statsScope,
    commanderRuntime,
  };
}

function isDiscordBotListEnabled(runtimes = []) {
  return resolveDiscordBotListConfig(runtimes).enabled;
}

function buildDiscordBotListPublicUrls(botId) {
  const config = resolveDiscordBotListConfig([]);
  const normalizedBotId = String(botId || config.botId || "").trim();
  const slug = String(config.slug || "").trim();
  return {
    listingUrl: slug ? `https://discordbotlist.com/bots/${slug}` : null,
    publicApiUrl: null,
    ownerApiUrl: /^\d{17,22}$/.test(normalizedBotId)
      ? `${DISCORD_BOT_LIST_API_BASE}/bots/${normalizedBotId}`
      : DISCORD_BOT_LIST_API_BASE,
  };
}

function buildDiscordBotListCommandsPayload() {
  return buildCommandsJson();
}

function normalizeDiscordBotListVoteEvent(rawVote, { source = "webhook", botId = null } = {}) {
  if (!rawVote || typeof rawVote !== "object") return null;

  const userId = String(rawVote.id || rawVote.user_id || rawVote.userId || "").trim();
  if (!/^\d{17,22}$/.test(userId)) return null;

  const discriminator = String(rawVote.discriminator || "").trim();
  const usernameBase = String(rawVote.username || "").trim() || userId;
  const username = discriminator && discriminator !== "0"
    ? `${usernameBase}#${discriminator}`
    : usernameBase;

  return {
    provider: "discordbotlist",
    voteId: null,
    projectId: null,
    botId: String(botId || "").trim() || null,
    userId,
    providerUserId: userId,
    username: username.slice(0, 120),
    avatarUrl: String(rawVote.avatar || "").trim() || null,
    source,
    weight: 1,
    votedAt: rawVote.timestamp || rawVote.votedAt || new Date().toISOString(),
    expiresAt: null,
    receivedAt: rawVote.receivedAt || new Date().toISOString(),
  };
}

function collectAggregateStats(runtimes = []) {
  const guildMembers = new Map();
  let voiceConnections = 0;

  for (const runtime of runtimes) {
    if (!runtime?.client?.isReady?.()) continue;
    const stats = runtime.collectStats?.() || {};
    voiceConnections += Number(stats.connections || 0) || 0;
    for (const guild of runtime.client.guilds.cache.values()) {
      const guildId = String(guild?.id || "").trim();
      if (!guildId) continue;
      const currentCount = Number(guild.memberCount || 0) || 0;
      guildMembers.set(guildId, Math.max(guildMembers.get(guildId) || 0, currentCount));
    }
  }

  return {
    guilds: guildMembers.size,
    users: [...guildMembers.values()].reduce((sum, value) => sum + value, 0),
    voiceConnections,
    scope: "aggregate",
  };
}

function collectCommanderStats(runtimes = []) {
  const commanderRuntime = resolveCommanderRuntime(runtimes);
  const stats = commanderRuntime?.collectStats?.() || {};
  return {
    guilds: Number(stats.servers || 0) || 0,
    users: Number(stats.users || 0) || 0,
    voiceConnections: Number(stats.connections || 0) || 0,
    scope: "commander",
  };
}

function collectDiscordBotListStats(runtimes = [], scope = null) {
  const config = resolveDiscordBotListConfig(runtimes);
  const resolvedScope = scope || config.statsScope;
  return resolvedScope === "aggregate"
    ? collectAggregateStats(runtimes)
    : collectCommanderStats(runtimes);
}

function sanitizeDiscordBotListErrorSnippet(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return "";
  const withoutMarkup = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clipText(withoutMarkup || raw, 200);
}

function buildDiscordBotListHttpError(method, path, response, parsed, rawText) {
  const status = Number(response?.status || 0) || 0;
  const contentType = String(response?.headers?.get?.("content-type") || "").trim().toLowerCase();
  let detail = String(parsed?.error || parsed?.message || "").trim();
  if (!detail) {
    detail = sanitizeDiscordBotListErrorSnippet(rawText);
  }
  if (!detail && contentType.includes("text/html")) {
    detail = "HTML error page returned";
  }
  if (!detail && status >= 500) {
    detail = "upstream service temporarily unavailable";
  }
  if (!detail) {
    detail = `HTTP ${status}`;
  }
  return new Error(`${method} ${path} failed (${status}): ${detail}`);
}

/** @param {string} method @param {string} path @param {{ token?: string, body?: any, authMode?: string }} [options] */
async function discordBotListRequest(method, path, { token, body, authMode = "raw" } = {}) {
  const endpoint = `${DISCORD_BOT_LIST_API_BASE}${path}`;
  const headers = {
    Authorization: authMode === "bot-prefix" ? `Bot ${token}` : token,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(endpoint, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let parsed = null;
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { raw: rawText };
    }
  }

  if (!response.ok) {
    throw buildDiscordBotListHttpError(method, path, response, parsed, rawText);
  }

  return parsed || { success: true };
}

async function fetchDiscordBotListPublicBotSummary(botId) {
  const urls = buildDiscordBotListPublicUrls(botId);
  if (!urls.listingUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_listing_slug",
      botId: String(botId || "").trim() || null,
      ...urls,
    };
  }

  const response = await fetch(urls.listingUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const rawHtml = await response.text();
  if (!response.ok) {
    throw new Error(`GET public bot page failed (${response.status})`);
  }

  const ogTitle = rawHtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  const ogDescription = rawHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  const title = rawHtml.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
  const username = clipText(String(ogTitle || title || "").replace(/\s+Discord Bot.*$/i, "").trim(), 120) || null;
  const description = clipText(String(ogDescription || "").trim(), 240) || null;
  const monthVotesMatch = rawHtml.match(/([0-9][0-9.,]*)\s+upvotes?\s+in/i);
  const monthVotes = monthVotesMatch
    ? Number.parseInt(String(monthVotesMatch[1]).replace(/[^0-9]/g, ""), 10) || 0
    : null;

  return {
    ok: true,
    botId: String(botId || "").trim() || null,
    username,
    description,
    monthVotes,
    listingUrl: urls.listingUrl,
    publicApiUrl: null,
    ownerApiUrl: urls.ownerApiUrl,
    source: "public_html",
  };
}

function resolveDiscordBotListShardState(runtimes = []) {
  const commanderRuntime = resolveCommanderRuntime(runtimes);
  const shardManager = commanderRuntime?.client?.shard || null;
  const shardCount = Math.max(1, Number(shardManager?.count || shardManager?.shardCount || 1) || 1);

  let shardId = null;
  if (Array.isArray(shardManager?.ids) && shardManager.ids.length === 1) {
    const candidate = Number(shardManager.ids[0]);
    if (Number.isInteger(candidate) && candidate >= 0) {
      shardId = candidate;
    }
  } else {
    const candidate = Number(shardManager?.id);
    if (Number.isInteger(candidate) && candidate >= 0) {
      shardId = candidate;
    }
  }

  return { shardCount, shardId };
}

async function syncDiscordBotListCommands(runtimes = []) {
  const config = resolveDiscordBotListConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const commands = buildDiscordBotListCommandsPayload();
  try {
    const response = await discordBotListRequest("POST", `/bots/${config.botId}/commands`, {
      token: config.token,
      body: commands,
      authMode: "bot-prefix",
    });
    setDiscordBotListSyncStatus("commands", {
      ok: true,
      botId: config.botId,
      details: {
        commandCount: commands.length,
      },
    });
    log("INFO", `[DiscordBotList] Commands synced: bot=${config.botId} count=${commands.length}`);
    return { ok: true, response, commandCount: commands.length, botId: config.botId };
  } catch (err) {
    setDiscordBotListSyncStatus("commands", {
      ok: false,
      botId: config.botId,
      error: err?.message || String(err),
    });
    throw err;
  }
}

async function syncDiscordBotListStats(runtimes = [], { scope = null } = {}) {
  const config = resolveDiscordBotListConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const stats = collectDiscordBotListStats(runtimes, scope);
  const shardState = resolveDiscordBotListShardState(runtimes);
  const payload = {
    guilds: stats.guilds,
    users: stats.users,
    voice_connections: stats.voiceConnections,
  };
  if (Number.isInteger(shardState.shardId) && shardState.shardId >= 0) {
    payload.shard_id = shardState.shardId;
  }

  try {
    const response = await discordBotListRequest("POST", `/bots/${config.botId}/stats`, {
      token: config.token,
      body: payload,
    });
    setDiscordBotListSyncStatus("stats", {
      ok: true,
      botId: config.botId,
      details: {
        scope: stats.scope,
        ...payload,
        shardCount: shardState.shardCount,
      },
    });
    log(
      "INFO",
      `[DiscordBotList] Stats synced: bot=${config.botId} scope=${stats.scope} guilds=${payload.guilds} users=${payload.users} voice=${payload.voice_connections}${payload.shard_id !== undefined ? ` shardId=${payload.shard_id}` : ""}`
    );
    return { ok: true, response, botId: config.botId, ...payload, scope: stats.scope };
  } catch (err) {
    setDiscordBotListSyncStatus("stats", {
      ok: false,
      botId: config.botId,
      error: err?.message || String(err),
      details: {
        scope: stats.scope,
        ...payload,
        shardCount: shardState.shardCount,
      },
    });
    throw err;
  }
}

async function syncDiscordBotListVotes(runtimes = []) {
  const config = resolveDiscordBotListConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  try {
    const response = await discordBotListRequest("GET", `/bots/${config.botId}/upvotes`, {
      token: config.token,
    });
    const entries = Array.isArray(response?.upvotes) ? response.upvotes : [];
    const merged = mergeDiscordBotListVotes(entries, {
      source: "api",
      total: response?.total,
    });
    mergeVoteEvents(
      entries
        .map((entry) => normalizeDiscordBotListVoteEvent(entry, { source: "api", botId: config.botId }))
        .filter(Boolean)
    );
    setDiscordBotListSyncStatus("votes", {
      ok: true,
      botId: config.botId,
      source: "api",
      details: {
        received: entries.length,
        added: merged.added,
        totalVotes: merged.totalVotes,
      },
    });
    log("INFO", `[DiscordBotList] Votes synced: bot=${config.botId} received=${entries.length} added=${merged.added}`);
    return {
      ok: true,
      botId: config.botId,
      received: entries.length,
      added: merged.added,
      totalVotes: merged.totalVotes,
    };
  } catch (err) {
    setDiscordBotListSyncStatus("votes", {
      ok: false,
      botId: config.botId,
      source: "api",
      error: err?.message || String(err),
    });
    throw err;
  }
}

function handleDiscordBotListVoteWebhook(headers = {}, rawBody = {}) {
  const config = resolveDiscordBotListConfig([]);
  if (!config.webhookSecret) {
    return { ok: false, status: 503, error: "DiscordBotList Webhook ist nicht konfiguriert." };
  }

  const authHeader = Array.isArray(headers?.authorization)
    ? headers.authorization[0]
    : headers?.authorization;
  if (!safeTokenEquals(String(authHeader || ""), config.webhookSecret)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  const recorded = recordDiscordBotListVote(rawBody, { source: "webhook" });
  if (!recorded.ok) {
    return { ok: false, status: 400, error: "Ungültiger Vote-Payload." };
  }
  const normalizedVote = normalizeDiscordBotListVoteEvent(rawBody, { source: "webhook", botId: config.botId });
  if (normalizedVote) {
    recordVoteEvent(normalizedVote);
  }

  setDiscordBotListSyncStatus("votes", {
    ok: true,
    botId: config.botId || null,
    source: "webhook",
    details: {
      userId: recorded.vote.userId,
      username: recorded.vote.username,
      totalVotes: recorded.totalVotes,
    },
  });
  log("INFO", `[DiscordBotList] Vote erhalten: user=${recorded.vote.userId} username=${recorded.vote.username}`);
  return {
    ok: true,
    status: 200,
    added: recorded.added,
    vote: recorded.vote,
    totalVotes: recorded.totalVotes,
  };
}

function getDiscordBotListStatus(runtimes = [], { voteLimit = 20 } = {}) {
  const config = resolveDiscordBotListConfig(runtimes);
  const state = getDiscordBotListState({
    voteLimit: Math.max(0, Number.parseInt(String(voteLimit || 0), 10) || 0),
  });
  const publicUrls = buildDiscordBotListPublicUrls(config.botId);
  return {
    configured: config.enabled,
    botId: config.botId || null,
    slug: config.slug || null,
    statsScope: config.statsScope,
    listingUrl: publicUrls.listingUrl,
    publicApiUrl: publicUrls.publicApiUrl,
    ownerApiUrl: publicUrls.ownerApiUrl,
    state,
  };
}

function getDiscordBotListIntervals() {
  return {
    startupDelayMs: parseEnvInt("DISCORDBOTLIST_STARTUP_DELAY_MS", 15_000, 0),
    commandsSyncMs: parseEnvInt("DISCORDBOTLIST_COMMANDS_SYNC_MS", 6 * 60 * 60_000, 0),
    statsSyncMs: parseEnvInt("DISCORDBOTLIST_STATS_SYNC_MS", 30 * 60_000, 0),
    voteSyncMs: parseEnvInt("DISCORDBOTLIST_VOTE_SYNC_MS", 30 * 60_000, 0),
  };
}

export {
  buildDiscordBotListCommandsPayload,
  buildDiscordBotListPublicUrls,
  collectDiscordBotListStats,
  fetchDiscordBotListPublicBotSummary,
  getDiscordBotListIntervals,
  getDiscordBotListStatus,
  handleDiscordBotListVoteWebhook,
  isDiscordBotListEnabled,
  resolveDiscordBotListConfig,
  syncDiscordBotListCommands,
  syncDiscordBotListStats,
  syncDiscordBotListVotes,
};
