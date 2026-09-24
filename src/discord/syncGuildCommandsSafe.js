import { once } from "node:events";
import { runExclusive } from "../utils/commandSyncGuard.js";
import { commandPayloadHash } from "./commandFingerprints.js";

function toInt(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(err) {
  if (!err) return "unknown";
  if (typeof err === "string") return err;
  return String(err?.message || err);
}

function ensureDiscordApiUrl(route) {
  const rawRoute = String(route || "").trim();
  if (!rawRoute) return "https://discord.com/api/v10";
  if (rawRoute.startsWith("http://") || rawRoute.startsWith("https://")) return rawRoute;
  if (rawRoute.startsWith("/")) return `https://discord.com/api/v10${rawRoute}`;
  return `https://discord.com/api/v10/${rawRoute}`;
}

function defaultLog(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

function emit(logFn, level, message) {
  if (typeof logFn === "function") {
    logFn(level, message);
    return;
  }
  defaultLog(level, message);
}

function resolveApplicationId(client) {
  return String(client?.application?.id || client?.user?.id || "").trim();
}

function extractGuildIds(collection) {
  if (!collection) return [];
  if (typeof collection.keys === "function") {
    return [...collection.keys()].map((id) => String(id));
  }
  if (Array.isArray(collection)) {
    return collection
      .map((entry) => String(entry?.id || entry || "").trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueGuildIds(ids) {
  const out = [];
  const seen = new Set();
  for (const rawId of ids || []) {
    const guildId = String(rawId || "").trim();
    if (!guildId || seen.has(guildId)) continue;
    seen.add(guildId);
    out.push(guildId);
  }
  return out;
}

function resolveDelayMsRange(minRaw, maxRaw, fallbackMin, fallbackMax) {
  const minDelayMs = Math.max(0, toInt(minRaw, fallbackMin));
  const maxDelayCandidate = toInt(maxRaw, fallbackMax);
  const maxDelayMs = Math.max(minDelayMs, maxDelayCandidate);
  if (maxDelayMs <= minDelayMs) return minDelayMs;
  return minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));
}

function resolveSyncDelayMs(syncSource) {
  const source = String(syncSource || "").toLowerCase();

  if (source === "startup") {
    const fixedDelayRaw = process.env.GUILD_COMMAND_SYNC_READY_DELAY_MS ?? process.env.GUILD_COMMAND_READY_DELAY_MS;
    if (fixedDelayRaw !== undefined && fixedDelayRaw !== null && String(fixedDelayRaw).trim() !== "") {
      return Math.max(0, toInt(fixedDelayRaw, 7000));
    }

    return resolveDelayMsRange(
      process.env.GUILD_COMMAND_SYNC_READY_DELAY_MIN_MS ?? process.env.GUILD_COMMAND_SYNC_STARTUP_DELAY_MIN_MS,
      process.env.GUILD_COMMAND_SYNC_READY_DELAY_MAX_MS ?? process.env.GUILD_COMMAND_SYNC_STARTUP_DELAY_MAX_MS,
      5000,
      10000
    );
  }

  if (source === "join") {
    const fixedJoinDelayRaw = process.env.GUILD_COMMAND_SYNC_JOIN_DELAY_MS;
    if (fixedJoinDelayRaw !== undefined && fixedJoinDelayRaw !== null && String(fixedJoinDelayRaw).trim() !== "") {
      return Math.max(0, toInt(fixedJoinDelayRaw, 12000));
    }

    return resolveDelayMsRange(
      process.env.GUILD_COMMAND_SYNC_JOIN_DELAY_MIN_MS,
      process.env.GUILD_COMMAND_SYNC_JOIN_DELAY_MAX_MS,
      10000,
      20000
    );
  }

  return 0;
}

function shouldEmitVerboseSyncLogs(syncSource) {
  return String(syncSource || "").toLowerCase() !== "periodic";
}

async function ensureClientReady(client) {
  if (client?.isReady?.()) return;
  await once(client, "clientReady");
}

function getRateLimitMeta(err) {
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  const retryAfterSeconds = Number(
    err?.rawError?.retry_after
    ?? err?.data?.retry_after
    ?? err?.retry_after
    ?? 0
  );
  const isRateLimited = status === 429 || retryAfterSeconds > 0;
  const isGlobal = Boolean(err?.rawError?.global ?? err?.data?.global ?? false);
  return {
    isRateLimited,
    status,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
    isGlobal,
  };
}

async function putGuildCommandsWithTimeout({
  rest,
  route,
  payload,
  timeoutMs,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    await rest.put(route, { body: payload });
    return;
  }

  let timeoutHandle = null;
  let didTimeout = false;
  const controller = typeof AbortController === "function" ? new AbortController() : null;

  const requestPromise = rest.put(route, {
    body: payload,
    ...(controller ? { signal: controller.signal } : {}),
  });

  // If timeout already happened, swallow late request rejection to avoid hanging queue on unhandled rejections.
  const settledRequest = requestPromise.catch((err) => {
    if (didTimeout) return undefined;
    throw err;
  });

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      if (controller) {
        try {
          controller.abort();
        } catch {
          // ignore abort errors
        }
      }
      const timeoutError = new Error(`Guild command sync timeout after ${timeoutMs}ms`);
      timeoutError.code = "SYNC_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    await Promise.race([settledRequest, timeoutPromise]);
  } catch (err) {
    if (err?.code === "SYNC_TIMEOUT") {
      throw err;
    }
    const aborted = didTimeout || controller?.signal?.aborted || err?.name === "AbortError";
    if (aborted) {
      const wrapped = new Error(`Guild command sync timeout after ${timeoutMs}ms`);
      wrapped.code = "SYNC_TIMEOUT";
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function putGuildCommandsViaFetchWithTimeout({
  route,
  payload,
  timeoutMs,
  botToken,
}) {
  if (typeof fetch !== "function") {
    throw new Error("Guild command sync fetch transport: fetch ist in dieser Node-Version nicht verfügbar.");
  }

  if (!botToken || !String(botToken).trim()) {
    throw new Error("Guild command sync fetch transport: botToken fehlt.");
  }

  const endpoint = ensureDiscordApiUrl(route);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutHandle = null;

  if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore abort errors
      }
    }, timeoutMs);
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${String(botToken).trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    const aborted = controller?.signal?.aborted || err?.name === "AbortError";
    if (aborted) {
      const timeoutError = new Error(`Guild command sync timeout after ${timeoutMs}ms`);
      timeoutError.code = "SYNC_TIMEOUT";
      timeoutError.cause = err;
      throw timeoutError;
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const err = new Error(body?.message || `Discord API status=${response.status}`);
    err.status = response.status;
    err.rawError = body;
    err.data = body;
    throw err;
  }
}

function logSyncDone(logFn, label, ok, failed, source, reason = "") {
  const reasonSuffix = reason ? ` reason=${reason}` : "";
  emit(logFn, "INFO", `[${label}] Command Sync done: ok=${ok} failed=${failed} source=${source}${reasonSuffix}`);
}

export async function syncGuildCommandsSafe({
  client,
  rest,
  routes,
  commands,
  guildIds = null,
  botToken = null,
  botLabel,
  source,
  logFn = null,
  fingerprints = null,
  force = false,
}) {
  if (!client || !rest || !routes || typeof routes.applicationGuildCommands !== "function") {
    throw new Error("syncGuildCommandsSafe: client/rest/routes fehlen.");
  }

  const label = botLabel || "Bot";
  const syncSource = source || "sync";
  const isJoinSync = String(syncSource).toLowerCase() === "join";
  const verboseSyncLogs = shouldEmitVerboseSyncLogs(syncSource);
  const joinTransport = String(process.env.GUILD_COMMAND_SYNC_JOIN_TRANSPORT || "fetch").trim().toLowerCase();
  const fetchAvailable = typeof fetch === "function";
  const useFetchForJoin = isJoinSync
    && joinTransport !== "rest"
    && fetchAvailable
    && Boolean(String(botToken || "").trim());
  const payload = Array.isArray(commands) ? commands : [];
  // Only servers whose last written list differs get a PUT (#215). A server
  // the bot just joined, or GUILD_COMMAND_SYNC_FORCE=1, always gets one.
  const commandsHash = commandPayloadHash(payload);
  const forceSync = force === true || isJoinSync || String(process.env.GUILD_COMMAND_SYNC_FORCE || "0") === "1";
  const syncDelayMs = resolveSyncDelayMs(syncSource);
  const retryDelayMs = Math.max(
    5000,
    toInt(process.env.GUILD_COMMAND_SYNC_RETRY_DELAY_MS ?? process.env.GUILD_COMMAND_SYNC_RETRY_MS, 10000)
  );
  const requestTimeoutRaw = isJoinSync
    ? (process.env.GUILD_COMMAND_SYNC_JOIN_REQUEST_TIMEOUT_MS ?? process.env.GUILD_COMMAND_SYNC_REQUEST_TIMEOUT_MS)
    : process.env.GUILD_COMMAND_SYNC_REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = Math.max(
    5000,
    toInt(requestTimeoutRaw, isJoinSync ? 30000 : 15000)
  );
  const triesRaw = isJoinSync
    ? (process.env.GUILD_COMMAND_SYNC_JOIN_TRIES ?? process.env.GUILD_COMMAND_SYNC_TRIES ?? process.env.GUILD_COMMAND_SYNC_RETRIES)
    : (process.env.GUILD_COMMAND_SYNC_TRIES ?? process.env.GUILD_COMMAND_SYNC_RETRIES);
  const configuredTries = toInt(
    triesRaw,
    isJoinSync ? 2 : 3
  );
  const maxTries = Math.min(3, Math.max(1, configuredTries));

  if (payload.length === 0) {
    emit(logFn, "ERROR", `[${label}] Command Sync aborted: commandsCount=0 source=${syncSource}`);
    logSyncDone(logFn, label, 0, 0, syncSource, "empty-commands");
    return { ok: 0, failed: 0, attempts: 0, skipped: true, reason: "empty-commands" };
  }

  let lastResult = { ok: 0, failed: 0, attempts: 0 };

  if (isJoinSync && joinTransport !== "rest" && !useFetchForJoin) {
    emit(
      logFn,
      "INFO",
      `[${label}] Join-Sync transport fallback: rest (fetchAvailable=${fetchAvailable} hasBotToken=${Boolean(String(botToken || "").trim())})`
    );
  }

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      await ensureClientReady(client);
    } catch (err) {
      emit(
        logFn,
        "ERROR",
        `[${label}] Command Sync ready wait failed (attempt=${attempt}/${maxTries}): ${err?.message || err}`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      logSyncDone(logFn, label, 0, 0, syncSource, "ready-wait-failed");
      throw err;
    }

    let fetchedGuilds;
    try {
      fetchedGuilds = await client.guilds.fetch();
    } catch (err) {
      emit(
        logFn,
        "ERROR",
        `[${label}] Guild fetch failed (attempt=${attempt}/${maxTries}): ${err?.message || err}`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      logSyncDone(logFn, label, 0, 0, syncSource, "guild-fetch-failed");
      throw err;
    }

    const fetchedGuildIds = extractGuildIds(fetchedGuilds);
    const cacheGuildIds = [...client.guilds.cache.keys()];
    const discoveredGuildIds = uniqueGuildIds([...fetchedGuildIds, ...cacheGuildIds]);
    const requestedGuildIds = uniqueGuildIds(Array.isArray(guildIds) ? guildIds : []);
    const targetGuildIds = requestedGuildIds.length ? requestedGuildIds : discoveredGuildIds;
    const guildCount = targetGuildIds.length;
    const discoveredGuildCount = discoveredGuildIds.length;
    const fetchedCount = fetchedGuildIds.length;
    const cacheCount = cacheGuildIds.length;
    const applicationId = resolveApplicationId(client);

    if (verboseSyncLogs) {
      emit(logFn, "INFO", `[${label}] Guild discovery complete: fetched=${fetchedCount} source=${syncSource}`);
      emit(
        logFn,
        "INFO",
        `[${label}] Command Sync debug: botId=${client.user?.id || "n/a"} applicationId=${applicationId || "n/a"} guildCount=${guildCount} discoveredGuildCount=${discoveredGuildCount} requestedGuildCount=${requestedGuildIds.length} fetchedGuildCount=${fetchedCount} cacheGuildCount=${cacheCount} guildIds=${targetGuildIds.join(",") || "-"} commandsCount=${payload.length} source=${syncSource} transport=${useFetchForJoin ? "fetch" : "rest"} syncDelayMs=${syncDelayMs} requestTimeoutMs=${requestTimeoutMs} retryDelayMs=${retryDelayMs} attempt=${attempt}/${maxTries}`
      );
    }

    if (!applicationId) {
      emit(
        logFn,
        "ERROR",
        `[${label}] Command Sync blocked: applicationId missing (attempt=${attempt}/${maxTries})`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      logSyncDone(logFn, label, 0, guildCount, syncSource, "missing-application-id");
      return { ok: 0, failed: guildCount, attempts: attempt, skipped: true, reason: "missing-application-id" };
    }

    if (guildCount === 0) {
      const reason = requestedGuildIds.length ? "no-target-guild-ids" : "no-guild-ids-after-fetch";
      emit(
        logFn,
        "ERROR",
        `[${label}] Command Sync retry trigger: ${reason} (attempt=${attempt}/${maxTries})`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      logSyncDone(logFn, label, 0, guildCount, syncSource, reason);
      return { ok: 0, failed: guildCount, attempts: attempt, skipped: true, reason };
    }

    let known = new Map();
    if (fingerprints && !forceSync) {
      try {
        // The retry attempts run one after the other by design.
        // eslint-disable-next-line no-await-in-loop
        known = await fingerprints.load(applicationId, targetGuildIds);
      } catch {
        known = new Map();
      }
    }
    const pendingGuildIds = targetGuildIds.filter((guildId) => known.get(guildId) !== commandsHash);
    const unchanged = guildCount - pendingGuildIds.length;
    if (pendingGuildIds.length === 0) {
      emit(logFn, "INFO", `[${label}] Command Sync skipped: commands unchanged in all ${guildCount} guilds (source=${syncSource})`);
      return { ok: 0, failed: 0, unchanged, attempts: attempt, skipped: true, reason: "unchanged" };
    }

    if (verboseSyncLogs && syncDelayMs > 0) {
      emit(logFn, "INFO", `[${label}] Sync delay before command sync: ${syncDelayMs}ms (source=${syncSource})`);
      await waitMs(syncDelayMs);
    } else if (syncDelayMs > 0) {
      await waitMs(syncDelayMs);
    }

    const result = await runExclusive(async () => {
      let ok = 0;
      let failed = 0;
      const writtenGuildIds = [];
      emit(logFn, "INFO", `[${label}] Command Sync start: guilds=${pendingGuildIds.length} unchanged=${unchanged} commands=${payload.length} source=${syncSource}`);

      try {
        for (const guildId of pendingGuildIds) {
          if (verboseSyncLogs) {
            emit(logFn, "INFO", `[${label}] Syncing guild ${guildId}...`);
          }
          try {
            const route = routes.applicationGuildCommands(applicationId, guildId);
            if (useFetchForJoin) {
              // eslint-disable-next-line no-await-in-loop
              await putGuildCommandsViaFetchWithTimeout({
                route,
                payload,
                timeoutMs: requestTimeoutMs,
                botToken,
              });
            } else {
              // eslint-disable-next-line no-await-in-loop
              await putGuildCommandsWithTimeout({
                rest,
                route,
                payload,
                timeoutMs: requestTimeoutMs,
              });
            }
            ok += 1;
            writtenGuildIds.push(guildId);
            if (verboseSyncLogs) {
              emit(logFn, "INFO", `[${label}] Guild ${guildId} success`);
            }
          } catch (err) {
            failed += 1;
            const rateLimitMeta = getRateLimitMeta(err);
            if (rateLimitMeta.isRateLimited) {
              emit(
                logFn,
                "ERROR",
                `[${label}] Guild ${guildId} failed: rate_limit status=${rateLimitMeta.status || 429} retry_after=${rateLimitMeta.retryAfterSeconds}s global=${rateLimitMeta.isGlobal} error=${toErrorMessage(err)}`
              );
            } else {
              const status = Number(err?.status ?? err?.statusCode ?? 0);
              const statusSuffix = Number.isFinite(status) && status > 0 ? ` status=${status}` : "";
              emit(logFn, "ERROR", `[${label}] Guild ${guildId} failed:${statusSuffix} error=${toErrorMessage(err)}`);
            }
          }
        }
      } finally {
        logSyncDone(logFn, label, ok, failed, syncSource);
        if (fingerprints && writtenGuildIds.length) {
          await fingerprints.save(applicationId, writtenGuildIds, commandsHash).catch(() => null);
        }
      }
      return { ok, failed, unchanged, attempts: attempt };
    });

    lastResult = result;
    if (result.failed === 0) {
      return result;
    }

    if (attempt < maxTries) {
      emit(
        logFn,
        "INFO",
        `[${label}] Command Sync retry scheduled in ${retryDelayMs}ms (attempt=${attempt + 1}/${maxTries})`
      );
      await waitMs(retryDelayMs);
    }
  }

  return lastResult;
}
