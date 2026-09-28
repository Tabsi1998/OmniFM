import crypto from "node:crypto";

import { buildCommandsJson } from "../commands.js";
import { safeTokenEquals } from "../lib/api-helpers.js";
import { clipText, waitMs } from "../lib/helpers.js";
import { log } from "../lib/logging.js";
import { getVoteEventsState, mergeVoteEvents, recordVoteEvent } from "../vote-events-store.js";
import {
  getTopGGState,
  setTopGGProjectState,
  setTopGGSyncStatus,
  setTopGGWebhookEvent,
} from "../topgg-store.js";

const TOPGG_SITE_BASE = "https://top.gg";
const TOPGG_V0_API_BASE = "https://top.gg/api";
const TOPGG_V1_API_BASE = "https://top.gg/api/v1";

function parseEnvInt(name, fallback, min = 0) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

class TopGGRequestError extends Error {
  constructor(message, {
    status = null,
    retryable = false,
    retryAfterMs = 0,
    method = "",
    path = "",
    endpoint = "",
    responseBody = "",
    cause = null,
  } = {}) {
    super(message);
    this.name = "TopGGRequestError";
    this.status = Number.isInteger(status) ? status : null;
    this.retryable = retryable === true;
    this.retryAfterMs = Math.max(0, Number(retryAfterMs || 0) || 0);
    this.method = String(method || "").trim() || null;
    this.path = String(path || "").trim() || null;
    this.endpoint = String(endpoint || "").trim() || null;
    this.responseBody = clipText(String(responseBody || "").trim(), 500) || null;
    if (cause) this.cause = cause;
  }
}

function getHeaderValue(headers, headerName) {
  if (!headers || !headerName) return "";
  if (typeof headers.get === "function") {
    return String(headers.get(headerName) || "").trim();
  }
  const direct = headers[headerName] ?? headers[String(headerName).toLowerCase()] ?? headers[String(headerName).toUpperCase()];
  return String(direct || "").trim();
}

function parseRetryAfterMs(headers) {
  const raw = getHeaderValue(headers, "retry-after");
  if (!raw) return 0;

  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAtMs = Date.parse(raw);
  if (Number.isFinite(retryAtMs)) {
    return Math.max(0, retryAtMs - Date.now());
  }
  return 0;
}

function isRetryableTopGGStatus(status) {
  return status === 429 || status >= 500;
}

function getTopGGRequestRetryOptions() {
  return {
    maxRetries: parseEnvInt("TOPGG_REQUEST_MAX_RETRIES", 2, 0),
    baseDelayMs: parseEnvInt("TOPGG_REQUEST_RETRY_BASE_MS", 2_000, 0),
    maxDelayMs: parseEnvInt("TOPGG_REQUEST_RETRY_MAX_MS", 30_000, 0),
  };
}

function computeTopGGRetryDelayMs(error, attemptIndex, retryOptions) {
  const retryAfterMs = Math.max(0, Number(error?.retryAfterMs || 0) || 0);
  if (retryAfterMs > 0) {
    return retryOptions.maxDelayMs > 0
      ? Math.min(retryOptions.maxDelayMs, retryAfterMs)
      : retryAfterMs;
  }

  const baseDelayMs = Math.max(0, Number(retryOptions?.baseDelayMs || 0) || 0);
  const exponentialDelayMs = baseDelayMs * Math.pow(2, Math.max(0, attemptIndex));
  if (retryOptions.maxDelayMs > 0) {
    return Math.min(retryOptions.maxDelayMs, exponentialDelayMs);
  }
  return exponentialDelayMs;
}

function resolveCommanderRuntime(runtimes = []) {
  return runtimes.find((runtime) => runtime?.role === "commander")
    || runtimes[0]
    || null;
}

function resolveTopGGConfig(runtimes = []) {
  const token = String(process.env.TOPGG_TOKEN || "").trim();
  const explicitBotId = String(process.env.TOPGG_BOT_ID || "").trim();
  const webhookSecret = String(process.env.TOPGG_WEBHOOK_SECRET || "").trim();
  const commanderRuntime = resolveCommanderRuntime(runtimes);
  const botId = explicitBotId
    || String(commanderRuntime?.getApplicationId?.() || commanderRuntime?.config?.clientId || "").trim();
  const enabled = String(process.env.TOPGG_ENABLED ?? (token ? "1" : "0")).trim() !== "0"
    && Boolean(token)
    && /^\d{17,22}$/.test(botId);
  const statsScope = String(process.env.TOPGG_STATS_SCOPE || "aggregate").trim().toLowerCase() === "commander"
    ? "commander"
    : "aggregate";

  return {
    enabled,
    token,
    botId,
    webhookSecret,
    statsScope,
    commanderRuntime,
  };
}

function isTopGGEnabled(runtimes = []) {
  return resolveTopGGConfig(runtimes).enabled;
}

function buildTopGGPublicUrls(botId) {
  const normalizedBotId = String(botId || "").trim();
  if (!/^\d{17,22}$/.test(normalizedBotId)) {
    return {
      listingUrl: null,
      statsApiUrl: null,
      projectApiUrl: `${TOPGG_V1_API_BASE}/projects/@me`,
      votesApiUrl: `${TOPGG_V1_API_BASE}/projects/@me/votes`,
    };
  }

  return {
    listingUrl: `${TOPGG_SITE_BASE}/bot/${normalizedBotId}`,
    statsApiUrl: `${TOPGG_V0_API_BASE}/bots/${normalizedBotId}/stats`,
    projectApiUrl: `${TOPGG_V1_API_BASE}/projects/@me`,
    votesApiUrl: `${TOPGG_V1_API_BASE}/projects/@me/votes`,
  };
}

function buildTopGGCommandsPayload() {
  return buildCommandsJson();
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

function collectTopGGStats(runtimes = [], scope = null) {
  const config = resolveTopGGConfig(runtimes);
  const resolvedScope = scope || config.statsScope;
  return resolvedScope === "commander"
    ? collectCommanderStats(runtimes)
    : collectAggregateStats(runtimes);
}

function resolveTopGGShardState(runtimes = []) {
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

async function topGGRequest(method, path, {
  token,
  body,
  apiVersion = "v1",
  authMode = "bearer",
} = {}) {
  const baseUrl = apiVersion === "v0" ? TOPGG_V0_API_BASE : TOPGG_V1_API_BASE;
  const endpoint = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const headers = {
    Accept: "application/json",
  };
  const retryOptions = getTopGGRequestRetryOptions();

  if (token) {
    headers.Authorization = authMode === "raw" ? token : `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let lastError = null;

  for (let attemptIndex = 0; attemptIndex <= retryOptions.maxRetries; attemptIndex += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retries wait for each other
      const response = await fetch(endpoint, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      // eslint-disable-next-line no-await-in-loop -- retries wait for each other
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
        const message = parsed?.error?.message
          || parsed?.detail
          || parsed?.error
          || parsed?.message
          || clipText(rawText, 240)
          || `HTTP ${response.status}`;
        throw new TopGGRequestError(`${method} ${path} failed (${response.status}): ${message}`, {
          status: response.status,
          retryable: isRetryableTopGGStatus(response.status),
          retryAfterMs: parseRetryAfterMs(response.headers),
          method,
          path,
          endpoint,
          responseBody: rawText,
        });
      }

      return parsed || { success: true };
    } catch (err) {
      const normalizedError = err instanceof TopGGRequestError
        ? err
        : new TopGGRequestError(`${method} ${path} failed: ${err?.message || err}`, {
          retryable: true,
          method,
          path,
          endpoint,
          cause: err,
        });

      lastError = normalizedError;
      const shouldRetry = normalizedError.retryable === true && attemptIndex < retryOptions.maxRetries;
      if (!shouldRetry) {
        throw normalizedError;
      }

      const delayMs = computeTopGGRetryDelayMs(normalizedError, attemptIndex, retryOptions);
      const nextAttempt = attemptIndex + 2;
      const totalAttempts = retryOptions.maxRetries + 1;
      log(
        "WARN",
        `[TopGG] ${method} ${path} retry in ${Math.round(delayMs)}ms ` +
        `(attempt ${nextAttempt}/${totalAttempts}, status=${normalizedError.status || "network"}).`
      );
      if (delayMs > 0) {
        // eslint-disable-next-line no-await-in-loop -- retries wait for each other
        await waitMs(delayMs);
      }
    }
  }

  throw lastError || new TopGGRequestError(`${method} ${path} failed`);
}

function normalizeTopGGProjectSummary(rawProject, fallbackBotId = null) {
  if (!rawProject || typeof rawProject !== "object") return null;
  return {
    id: String(rawProject.id || "").trim() || null,
    botId: String(rawProject.platform_id || rawProject.platformId || fallbackBotId || "").trim() || fallbackBotId || null,
    name: clipText(String(rawProject.name || ""), 120) || null,
    platform: clipText(String(rawProject.platform || ""), 40) || null,
    type: clipText(String(rawProject.type || ""), 40) || null,
    headline: clipText(String(rawProject.headline || ""), 240) || null,
    tags: Array.isArray(rawProject.tags)
      ? rawProject.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 50)
      : [],
    votes: Math.max(0, Number.parseInt(String(rawProject.votes || 0), 10) || 0),
    votesTotal: Math.max(0, Number.parseInt(String(rawProject.votes_total || rawProject.votesTotal || 0), 10) || 0),
    reviewScore: Math.max(0, Number(rawProject.review_score || rawProject.reviewScore || 0) || 0),
    reviewCount: Math.max(0, Number.parseInt(String(rawProject.review_count || rawProject.reviewCount || 0), 10) || 0),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchTopGGProjectSummary(runtimes = []) {
  const config = resolveTopGGConfig(runtimes);
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: "not_configured",
    };
  }

  const response = await topGGRequest("GET", "/projects/@me", {
    token: config.token,
    apiVersion: "v1",
    authMode: "bearer",
  });
  return {
    ok: true,
    botId: config.botId,
    project: normalizeTopGGProjectSummary(response, config.botId),
  };
}

async function syncTopGGProject(runtimes = []) {
  const config = resolveTopGGConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  try {
    const live = await fetchTopGGProjectSummary(runtimes);
    setTopGGProjectState(live.project, {
      ok: true,
      botId: config.botId,
      source: "api",
      details: {
        projectId: live.project?.id || null,
        votes: live.project?.votes || 0,
        votesTotal: live.project?.votesTotal || 0,
      },
    });
    log(
      "INFO",
      `[TopGG] Project synced: bot=${config.botId} project=${live.project?.id || "unknown"} votes=${live.project?.votes || 0} total=${live.project?.votesTotal || 0}`
    );
    return live;
  } catch (err) {
    setTopGGSyncStatus("project", {
      ok: false,
      botId: config.botId,
      source: "api",
      error: err?.message || String(err),
    });
    throw err;
  }
}

async function syncTopGGCommands(runtimes = []) {
  const config = resolveTopGGConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const commands = buildTopGGCommandsPayload();
  try {
    const response = await topGGRequest("POST", "/projects/@me/commands", {
      token: config.token,
      body: commands,
      apiVersion: "v1",
      authMode: "bearer",
    });
    setTopGGSyncStatus("commands", {
      ok: true,
      botId: config.botId,
      details: {
        commandCount: commands.length,
      },
    });
    log("INFO", `[TopGG] Commands synced: bot=${config.botId} count=${commands.length}`);
    return { ok: true, response, commandCount: commands.length, botId: config.botId };
  } catch (err) {
    setTopGGSyncStatus("commands", {
      ok: false,
      botId: config.botId,
      error: err?.message || String(err),
    });
    throw err;
  }
}

async function syncTopGGStats(runtimes = [], { scope = null } = {}) {
  const config = resolveTopGGConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const stats = collectTopGGStats(runtimes, scope);
  const shardState = resolveTopGGShardState(runtimes);
  const payload = {
    server_count: stats.guildCount,
    shard_count: shardState.shardCount,
  };
  if (Number.isInteger(shardState.shardId) && shardState.shardId >= 0) {
    payload.shard_id = shardState.shardId;
  }

  try {
    const response = await topGGRequest("POST", `/bots/${config.botId}/stats`, {
      token: config.token,
      body: payload,
      apiVersion: "v0",
      authMode: "raw",
    });
    setTopGGSyncStatus("stats", {
      ok: true,
      botId: config.botId,
      details: {
        scope: stats.scope,
        guildCount: payload.server_count,
        userCount: stats.userCount,
        shardCount: payload.shard_count,
        shardId: payload.shard_id ?? null,
      },
    });
    log(
      "INFO",
      `[TopGG] Stats synced: bot=${config.botId} scope=${stats.scope} guilds=${payload.server_count} shardCount=${payload.shard_count}${payload.shard_id !== undefined ? ` shardId=${payload.shard_id}` : ""}`
    );
    return {
      ok: true,
      response,
      botId: config.botId,
      scope: stats.scope,
      guildCount: payload.server_count,
      userCount: stats.userCount,
      shardCount: payload.shard_count,
      shardId: payload.shard_id ?? null,
    };
  } catch (err) {
    setTopGGSyncStatus("stats", {
      ok: false,
      botId: config.botId,
      error: err?.message || String(err),
      details: {
        scope: stats.scope,
        guildCount: payload.server_count,
        userCount: stats.userCount,
        shardCount: payload.shard_count,
        shardId: payload.shard_id ?? null,
      },
    });
    throw err;
  }
}

function normalizeTopGGVoteEvent(rawVote, { source = "api", botId = null } = {}) {
  if (!rawVote || typeof rawVote !== "object") return null;

  if (rawVote?.type === "vote.create" && rawVote?.data && typeof rawVote.data === "object") {
    const event = rawVote.data;
    const user = event.user || {};
    const project = event.project || {};
    const userId = String(user.platform_id || user.platformId || "").trim();
    if (!/^\d{17,22}$/.test(userId)) return null;

    return {
      provider: "topgg",
      voteId: String(event.id || "").trim() || null,
      projectId: String(project.id || "").trim() || null,
      botId: String(project.platform_id || project.platformId || botId || "").trim() || botId || null,
      userId,
      providerUserId: String(user.id || "").trim() || null,
      username: clipText(String(user.name || userId), 120) || userId,
      avatarUrl: clipText(String(user.avatar_url || ""), 500) || null,
      source,
      weight: Math.max(1, Number.parseInt(String(event.weight || 1), 10) || 1),
      votedAt: event.created_at || new Date().toISOString(),
      expiresAt: event.expires_at || null,
      receivedAt: new Date().toISOString(),
    };
  }

  const userId = String(rawVote.platform_id || rawVote.platformId || rawVote.user || rawVote.user_id || "").trim();
  if (!/^\d{17,22}$/.test(userId)) return null;

  const isWeekend = rawVote.isWeekend === true || rawVote.is_weekend === true;
  return {
    provider: "topgg",
    voteId: String(rawVote.id || "").trim() || null,
    projectId: String(rawVote.project_id || "").trim() || null,
    botId: String(rawVote.bot || botId || "").trim() || botId || null,
    userId,
    providerUserId: String(rawVote.user_id || "").trim() || null,
    username: clipText(String(rawVote.username || userId), 120) || userId,
    avatarUrl: clipText(String(rawVote.avatar || rawVote.avatar_url || ""), 500) || null,
    source,
    weight: Math.max(1, Number.parseInt(String(rawVote.weight || (isWeekend ? 2 : 1) || 1), 10) || 1),
    votedAt: rawVote.created_at || rawVote.votedAt || new Date().toISOString(),
    expiresAt: rawVote.expires_at || null,
    receivedAt: new Date().toISOString(),
  };
}

function buildVotesQuery({ cursor = "", startDate = "" } = {}) {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("cursor", cursor);
  } else if (startDate) {
    params.set("startDate", startDate);
  }
  return params.toString();
}

async function syncTopGGVotes(runtimes = []) {
  const config = resolveTopGGConfig(runtimes);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const topGGState = getTopGGState();
  const startDays = parseEnvInt("TOPGG_VOTE_SYNC_START_DAYS", 30, 1);
  let cursor = "";
  let pages = 0;
  let received = 0;
  let added = 0;
  const maxPages = 25;
  const startDate = topGGState?.lastVoteSync?.at
    || new Date(Date.now() - (startDays * 24 * 60 * 60 * 1000)).toISOString();

  try {
    while (pages < maxPages) {
      const query = buildVotesQuery({ cursor, startDate });
      // eslint-disable-next-line no-await-in-loop -- each page needs the cursor of the one before
      const response = await topGGRequest("GET", `/projects/@me/votes?${query}`, {
        token: config.token,
        apiVersion: "v1",
        authMode: "bearer",
      });
      const entries = Array.isArray(response?.data) ? response.data : [];
      const normalizedVotes = entries
        .map((vote) => normalizeTopGGVoteEvent(vote, { source: "api", botId: config.botId }))
        .filter(Boolean);
      const merged = mergeVoteEvents(normalizedVotes);

      received += entries.length;
      added += merged.added;

      const nextCursor = String(response?.cursor || "").trim();
      pages += 1;
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    const sharedVotes = getVoteEventsState({ provider: "topgg", limit: 50 });
    setTopGGSyncStatus("votes", {
      ok: true,
      botId: config.botId,
      source: "api",
      details: {
        received,
        added,
        totalVotes: sharedVotes.totalVotes,
      },
    });
    log("INFO", `[TopGG] Votes synced: bot=${config.botId} received=${received} added=${added}`);
    return {
      ok: true,
      botId: config.botId,
      received,
      added,
      totalVotes: sharedVotes.totalVotes,
    };
  } catch (err) {
    setTopGGSyncStatus("votes", {
      ok: false,
      botId: config.botId,
      source: "api",
      error: err?.message || String(err),
    });
    throw err;
  }
}

async function fetchTopGGVoteStatus(runtimes = [], userId, { source = "discord" } = {}) {
  const config = resolveTopGGConfig(runtimes);
  const normalizedUserId = String(userId || "").trim();
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }
  if (!/^\d{17,22}$/.test(normalizedUserId)) {
    return { ok: false, skipped: true, reason: "invalid_user_id" };
  }

  const query = new URLSearchParams();
  if (source) query.set("source", source);
  const response = await topGGRequest("GET", `/projects/@me/votes/${normalizedUserId}?${query.toString()}`, {
    token: config.token,
    apiVersion: "v1",
    authMode: "bearer",
  });

  return {
    ok: true,
    userId: normalizedUserId,
    source,
    createdAt: response?.created_at || null,
    expiresAt: response?.expires_at || null,
    weight: Math.max(1, Number.parseInt(String(response?.weight || 1), 10) || 1),
  };
}

function parseTopGGSignatureHeader(rawHeader) {
  const value = String(rawHeader || "").trim();
  if (!value) return null;

  const parts = value.split(",").map((part) => part.trim());
  const result = {};
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (!key || rest.length === 0) continue;
    result[key.trim()] = rest.join("=").trim();
  }

  if (!result.t || !result.v1) return null;
  return {
    timestamp: result.t,
    signature: result.v1,
  };
}

function verifyTopGGWebhookSignature(rawBody, headers = {}, secret = "") {
  const parsed = parseTopGGSignatureHeader(headers["x-topgg-signature"] || headers["X-TopGG-Signature"]);
  if (!parsed || !secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");
  return safeTokenEquals(expected, parsed.signature);
}

function handleTopGGWebhook(headers = {}, rawBody = "") {
  const config = resolveTopGGConfig([]);
  if (!config.webhookSecret) {
    return { ok: false, status: 503, error: "Top.gg Webhook ist nicht konfiguriert." };
  }

  const authHeader = Array.isArray(headers?.authorization)
    ? headers.authorization[0]
    : headers?.authorization;
  const signatureVerified = verifyTopGGWebhookSignature(rawBody, headers, config.webhookSecret);
  const authorizationVerified = safeTokenEquals(String(authHeader || ""), config.webhookSecret);

  if (!signatureVerified && !authorizationVerified) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  let parsedBody;
  try {
    parsedBody = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON." };
  }

  const eventType = String(parsedBody?.type || "").trim().toLowerCase();
  if (eventType === "webhook.test" || eventType === "test") {
    setTopGGWebhookEvent("test", { at: new Date().toISOString() });
    return {
      ok: true,
      status: 200,
      eventType: eventType || "test",
      acknowledged: true,
    };
  }

  const normalizedVote = normalizeTopGGVoteEvent(parsedBody, {
    source: "webhook",
    botId: config.botId,
  });
  if (!normalizedVote) {
    return { ok: false, status: 400, error: "Ungueltiger Vote-Payload." };
  }

  const recorded = recordVoteEvent(normalizedVote);
  setTopGGWebhookEvent("vote", { at: normalizedVote.receivedAt });
  setTopGGSyncStatus("votes", {
    ok: true,
    botId: config.botId,
    source: "webhook",
    details: {
      userId: normalizedVote.userId,
      totalVotes: recorded.totalVotes,
      weight: normalizedVote.weight,
    },
  });
  log("INFO", `[TopGG] Vote erhalten: user=${normalizedVote.userId} weight=${normalizedVote.weight}`);
  return {
    ok: true,
    status: 200,
    added: recorded.added,
    totalVotes: recorded.totalVotes,
    vote: normalizedVote,
  };
}

function getTopGGStatus(runtimes = [], { voteLimit = 20 } = {}) {
  const config = resolveTopGGConfig(runtimes);
  const publicUrls = buildTopGGPublicUrls(config.botId);
  const state = getTopGGState();
  const voteState = getVoteEventsState({
    provider: "topgg",
    limit: Math.max(0, Number.parseInt(String(voteLimit || 0), 10) || 0),
  });
  return {
    configured: config.enabled,
    botId: config.botId || null,
    statsScope: config.statsScope,
    webhookConfigured: Boolean(config.webhookSecret),
    listingUrl: publicUrls.listingUrl,
    statsApiUrl: publicUrls.statsApiUrl,
    projectApiUrl: publicUrls.projectApiUrl,
    votesApiUrl: publicUrls.votesApiUrl,
    state: {
      ...state,
      totalVotes: voteState.totalVotes,
      votes: voteState.votes,
    },
  };
}

function getTopGGIntervals() {
  return {
    startupDelayMs: parseEnvInt("TOPGG_STARTUP_DELAY_MS", 15_000, 0),
    projectSyncMs: parseEnvInt("TOPGG_PROJECT_SYNC_MS", 6 * 60 * 60_000, 0),
    commandsSyncMs: parseEnvInt("TOPGG_COMMANDS_SYNC_MS", 6 * 60 * 60_000, 0),
    statsSyncMs: parseEnvInt("TOPGG_STATS_SYNC_MS", 30 * 60_000, 0),
    voteSyncMs: parseEnvInt("TOPGG_VOTE_SYNC_MS", 30 * 60_000, 0),
  };
}

export {
  buildTopGGCommandsPayload,
  buildTopGGPublicUrls,
  collectTopGGStats,
  fetchTopGGProjectSummary,
  fetchTopGGVoteStatus,
  getTopGGIntervals,
  getTopGGStatus,
  handleTopGGWebhook,
  isTopGGEnabled,
  normalizeTopGGVoteEvent,
  resolveTopGGConfig,
  syncTopGGCommands,
  syncTopGGProject,
  syncTopGGStats,
  syncTopGGVotes,
};
