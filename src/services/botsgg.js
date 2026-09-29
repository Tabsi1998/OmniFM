import { clipText } from "../lib/helpers.js";
import { log } from "../lib/logging.js";
import { getBotsGGState, setBotsGGSyncStatus } from "../botsgg-store.js";
import { buildBotsGGPublicUrls, fetchBotsGGPublicBotSummary } from "./botsgg-public.js";

const BOTSGG_API_BASE = "https://discord.bots.gg/api/v1";

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

function resolveBotsGGConfig(runtimes = []) {
  const token = String(process.env.BOTSGG_TOKEN || "").trim();
  const explicitBotId = String(process.env.BOTSGG_BOT_ID || "").trim();
  const commanderRuntime = resolveCommanderRuntime(runtimes);
  const botId = explicitBotId
    || String(commanderRuntime?.getApplicationId?.() || commanderRuntime?.config?.clientId || "").trim();
  const enabled = String(process.env.BOTSGG_ENABLED ?? (token ? "1" : "0")).trim() !== "0"
    && Boolean(token)
    && /^\d{17,22}$/.test(botId);
  const statsScope = String(process.env.BOTSGG_STATS_SCOPE || "aggregate").trim().toLowerCase() === "commander"
    ? "commander"
    : "aggregate";

  return {
    enabled,
    token,
    botId,
    statsScope,
    commanderRuntime,
  };
}

function isBotsGGEnabled(runtimes = []) {
  return resolveBotsGGConfig(runtimes).enabled;
}

function collectAggregateStats(runtimes = []) {
  const guildMembers = new Map();

  for (const runtime of runtimes) {
    if (!runtime?.client?.isReady?.()) continue;
    for (const guild of runtime.client.guilds.cache.values()) {
      const guildId = String(guild?.id || "").trim();
      if (!guildId) continue;
      const currentCount = Number(guild.memberCount || 0) || 0;
      guildMembers.set(guildId, Math.max(guildMembers.get(guildId) || 0, currentCount));
    }
  }

  return {
    guildCount: guildMembers.size,
    userCount: [...guildMembers.values()].reduce((sum, value) => sum + value, 0),
    scope: "aggregate",
  };
}

function collectCommanderStats(runtimes = []) {
  const commanderRuntime = resolveCommanderRuntime(runtimes);
  const stats = commanderRuntime?.collectStats?.() || {};
  return {
    guildCount: Number(stats.servers || 0) || 0,
    userCount: Number(stats.users || 0) || 0,
    scope: "commander",
  };
}

function collectBotsGGStats(runtimes = [], scope = null) {
  const config = resolveBotsGGConfig(runtimes);
  const resolvedScope = scope || config.statsScope;
  return resolvedScope === "commander"
    ? collectCommanderStats(runtimes)
    : collectAggregateStats(runtimes);
}

function resolveBotsGGShardState(runtimes = []) {
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

/** @param {string} method @param {string} path @param {{ token?: string, body?: any }} [options] */
async function botsGGRequest(method, path, { token, body } = {}) {
  const endpoint = `${BOTSGG_API_BASE}${path}`;
  const headers = {
    Authorization: token,
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
    const message = parsed?.error || parsed?.message || clipText(rawText, 240) || `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
  }

  return parsed || { success: true };
}

async function syncBotsGGStats(runtimes = [], { scope = null } = {}) {
  const config = resolveBotsGGConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const stats = collectBotsGGStats(runtimes, scope);
  const shardState = resolveBotsGGShardState(runtimes);
  const payload = {
    guildCount: stats.guildCount,
    shardCount: shardState.shardCount,
  };
  if (Number.isInteger(shardState.shardId) && shardState.shardId >= 0) {
    payload.shardId = shardState.shardId;
  }

  try {
    const response = await botsGGRequest("POST", `/bots/${config.botId}/stats`, {
      token: config.token,
      body: payload,
    });
    setBotsGGSyncStatus({
      ok: true,
      botId: config.botId,
      details: {
        scope: stats.scope,
        guildCount: payload.guildCount,
        userCount: stats.userCount,
        shardCount: payload.shardCount,
        shardId: payload.shardId ?? null,
      },
    });
    log(
      "INFO",
      `[BotsGG] Stats synced: bot=${config.botId} scope=${stats.scope} guildCount=${payload.guildCount} shardCount=${payload.shardCount}${payload.shardId !== undefined ? ` shardId=${payload.shardId}` : ""}`
    );
    return {
      ok: true,
      response,
      botId: config.botId,
      scope: stats.scope,
      guildCount: payload.guildCount,
      userCount: stats.userCount,
      shardCount: payload.shardCount,
      shardId: payload.shardId ?? null,
    };
  } catch (err) {
    setBotsGGSyncStatus({
      ok: false,
      botId: config.botId,
      error: err?.message || String(err),
      details: {
        scope: stats.scope,
        guildCount: payload.guildCount,
        userCount: stats.userCount,
        shardCount: payload.shardCount,
        shardId: payload.shardId ?? null,
      },
    });
    throw err;
  }
}

function getBotsGGStatus(runtimes = []) {
  const config = resolveBotsGGConfig(runtimes);
  const publicUrls = buildBotsGGPublicUrls(config.botId);
  return {
    configured: config.enabled,
    botId: config.botId || null,
    statsScope: config.statsScope,
    listingUrl: publicUrls.listingUrl,
    publicApiUrl: publicUrls.publicApiUrl,
    state: getBotsGGState(),
  };
}

function getBotsGGIntervals() {
  return {
    startupDelayMs: parseEnvInt("BOTSGG_STARTUP_DELAY_MS", 15_000, 0),
    statsSyncMs: parseEnvInt("BOTSGG_STATS_SYNC_MS", 30 * 60 * 1000, 0),
  };
}

export {
  buildBotsGGPublicUrls,
  collectBotsGGStats,
  fetchBotsGGPublicBotSummary,
  getBotsGGIntervals,
  getBotsGGStatus,
  isBotsGGEnabled,
  resolveBotsGGConfig,
  syncBotsGGStats,
};
