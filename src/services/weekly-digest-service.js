// ============================================================
// OmniFM: Weekly Stats Digest Service
// ============================================================
// Sends the weekly recap (#278) to the configured channel of every server
// that switched it on: a Components V2 message with tiles, top stations and
// top songs, built from src/lib/weekly-digest-report.js and
// src/bot/weekly-digest-panel.js. Configuration per guild in MongoDB
// guild_settings.weeklyDigest; the one place that sends it, for the
// monolith (index.js) and the split commander alike.

import { log } from "../lib/logging.js";
import {
  getGuildDailyStats,
  getGuildListenerTimeline,
  getGuildListeningStats,
  getGuildSessionsSince,
} from "../listening-stats-store.js";
import { getTopSongPlays } from "../song-plays-store.js";
import { loadStations } from "../stations-store.js";
import { getDb, isConnected as isMongoConnected } from "../lib/db.js";
import { DASHBOARD_URL, withLanguageParam } from "../bot/runtime-links.js";
import { buildWeeklyDigestPayload } from "../bot/weekly-digest-panel.js";
import { buildWeeklyDigestReport, weeklyDigestRange } from "../lib/weekly-digest-report.js";
import {
  normalizeWeeklyDigestConfig,
  shouldSendWeeklyDigest,
} from "../lib/weekly-digest.js";

/** How often the digest check runs (hourly). */
const DIGEST_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let digestTimer = null;

async function setDigestLastSent(guildId, timestamp) {
  if (!isMongoConnected() || !getDb()) return;
  try {
    await getDb()
      .collection("guild_settings")
      .updateOne(
        { guildId },
        { $set: { weeklyDigestLastSent: timestamp } },
        { upsert: true }
      );
  } catch {
    // ignore – the next check tries again
  }
}

/** Collects the week's numbers of a server from the stores. */
async function loadWeeklyDigestReport(guildId, { now = new Date() } = {}) {
  const range = weeklyDigestRange(now);
  const [dailyStats, sessions, snapshots, songPlays] = await Promise.all([
    getGuildDailyStats(guildId, 30),
    getGuildSessionsSince(guildId, range.previousStartMs),
    getGuildListenerTimeline(guildId, Math.ceil((Date.now() - range.startMs) / 3_600_000) + 1),
    getTopSongPlays(guildId, { sinceMs: range.startMs, untilMs: range.endMs, limit: 5 }),
  ]);
  return buildWeeklyDigestReport({
    dailyStats,
    sessions,
    snapshots,
    songPlays,
    stations: loadStations()?.stations || {},
    allTime: getGuildListeningStats(guildId) || {},
    now,
  });
}

/** The message for a server; also what the dashboard's "send test digest" posts. */
async function buildWeeklyDigestMessage(guildId, { guildName = "", config = {}, now = new Date() } = {}) {
  const digest = normalizeWeeklyDigestConfig(config);
  const t = (de, en) => (digest.language === "de" ? de : en);
  const report = await loadWeeklyDigestReport(guildId, { now });
  const payload = buildWeeklyDigestPayload({
    t,
    guildName,
    report,
    audience: digest.audience,
    urls: { dashboard: withLanguageParam(DASHBOARD_URL, digest.language) },
  });
  return { report, payload };
}

/**
 * Sends the digest of a server. A public digest skips an empty week: the
 * community channel gets no "nothing happened" post.
 * @returns {Promise<{ sent: boolean, skipped?: string }>}
 */
async function sendWeeklyDigest(runtime, guildId, config, { now = new Date() } = {}) {
  const digest = normalizeWeeklyDigestConfig(config);
  const guild = runtime.client.guilds.cache.get(guildId);
  if (!guild) return { sent: false, skipped: "guild" };
  const channel = guild.channels.cache.get(digest.channelId)
    || await guild.channels.fetch?.(digest.channelId).catch(() => null);
  if (!channel || typeof channel.send !== "function") return { sent: false, skipped: "channel" };

  const { report, payload } = await buildWeeklyDigestMessage(guildId, {
    guildName: guild.name,
    config: digest,
    now,
  });
  if (report.empty && digest.audience === "public") return { sent: false, skipped: "empty" };

  try {
    await channel.send(payload);
    log("INFO", `[WeeklyDigest] Gesendet an ${guild.name} #${channel.name}`);
    return { sent: true };
  } catch (err) {
    log("WARN", `[WeeklyDigest] Fehler beim Senden an ${guild.name} #${channel.name}: ${err?.message || err}`);
    return { sent: false, skipped: "send" };
  }
}

/**
 * Checks every server whether its digest is due and sends it, through the
 * commander when it is on the server.
 */
async function tickWeeklyDigest(runtimes, { now = new Date() } = {}) {
  if (!isMongoConnected() || !getDb()) return;
  const ordered = [...runtimes].sort((a, b) => Number(b?.role === "commander") - Number(a?.role === "commander"));

  try {
    const settings = await getDb()
      .collection("guild_settings")
      .find({ "weeklyDigest.enabled": true })
      .toArray();

    for (const setting of settings) {
      const config = normalizeWeeklyDigestConfig(setting.weeklyDigest || {});
      if (!config.channelId || !setting.guildId) continue;
      if (!shouldSendWeeklyDigest(config, { now, lastSentAt: setting.weeklyDigestLastSent || null })) continue;

      const runtime = ordered.find((candidate) => candidate?.client?.guilds?.cache?.has?.(setting.guildId));
      if (!runtime) continue;
      // eslint-disable-next-line no-await-in-loop
      await sendWeeklyDigest(runtime, setting.guildId, config, { now });
      // eslint-disable-next-line no-await-in-loop
      await setDigestLastSent(setting.guildId, now.toISOString());
    }
  } catch (err) {
    log("WARN", `[WeeklyDigest] Check fehlgeschlagen: ${err?.message || err}`);
  }
}

function startWeeklyDigestService(runtimes) {
  if (digestTimer) return;

  digestTimer = setInterval(() => {
    tickWeeklyDigest(runtimes).catch((err) => {
      log("WARN", `[WeeklyDigest] Unerwarteter Fehler im Tick: ${err?.message || err}`);
    });
  }, DIGEST_CHECK_INTERVAL_MS);

  // The timer must not keep the process alive on its own.
  digestTimer?.unref?.();

  log("INFO", `[WeeklyDigest] Service gestartet (Intervall: ${DIGEST_CHECK_INTERVAL_MS / 60_000}min).`);
}

function stopWeeklyDigestService() {
  if (digestTimer) {
    clearInterval(digestTimer);
    digestTimer = null;
  }
}

export {
  DIGEST_CHECK_INTERVAL_MS,
  buildWeeklyDigestMessage,
  loadWeeklyDigestReport,
  sendWeeklyDigest,
  startWeeklyDigestService,
  stopWeeklyDigestService,
  tickWeeklyDigest,
};
