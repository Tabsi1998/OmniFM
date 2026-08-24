// ============================================================
// OmniFM: Weekly Stats Digest Service
// Fix 6: Ausgelagert aus index.js (war: Zeilen 533-641)
//
// Sendet wöchentlich einen Listening-Stats-Report an konfigurierte
// Discord-Channels. Konfiguration pro Guild in MongoDB guild_settings.
// ============================================================

import { EmbedBuilder } from "discord.js";
import { log } from "../lib/logging.js";
import { OMNI_COLORS, brandFooter, brandAuthor } from "../bot/brand-embed.js";
import { getGuildListeningStats, getGuildDailyStats } from "../listening-stats-store.js";
import { getDb, isConnected as isMongoConnected } from "../lib/db.js";
import {
  normalizeWeeklyDigestConfig,
  shouldSendWeeklyDigest,
} from "../lib/weekly-digest.js";

/** Wie oft der Digest-Check läuft (Standard: stündlich) */
const DIGEST_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let digestTimer = null;

// ---- Hilfsfunktionen ----

/**
 * Liest die Guild-Settings für den Digest aus MongoDB.
 * @param {string} guildId
 * @returns {Promise<object|null>}
 */
async function getDigestSettings(guildId) {
  if (!isMongoConnected() || !getDb()) return null;
  try {
    return await getDb()
      .collection("guild_settings")
      .findOne({ guildId }, { projection: { _id: 0 } });
  } catch {
    return null;
  }
}

/**
 * Speichert den Zeitstempel des letzten gesendeten Digests.
 * @param {string} guildId
 * @param {string} timestamp ISO-String
 */
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
    // ignore – nächster Check wird es erneut versuchen
  }
}

/**
 * Formatiert Millisekunden als lesbare Dauer (z.B. "2h 15m").
 * @param {number} ms
 * @returns {string}
 */
function formatMsDuration(ms) {
  if (!ms || ms <= 0) return "0m";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ---- Haupt-Sendefunktion ----

/**
 * Baut den Weekly-Digest-Embed und sendet ihn an den konfigurierten Channel.
 * @param {import('../bot/runtime.js').BotRuntime} runtime
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} [language]
 */
async function sendWeeklyDigest(runtime, guildId, channelId, language = "de") {
  const t = (de, en) => (language === "de" ? de : en);

  const guild = runtime.client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const stats = getGuildListeningStats(guildId);
  const dailyStats = await getGuildDailyStats(guildId, 7);

  const weekStarts = dailyStats.reduce((s, d) => s + (d.totalStarts || 0), 0);
  const weekListeningMs = dailyStats.reduce((s, d) => s + (d.totalListeningMs || 0), 0);
  const weekSessions = dailyStats.reduce((s, d) => s + (d.totalSessions || 0), 0);
  const weekPeak = Math.max(0, ...dailyStats.map((d) => d.peakListeners || 0));

  const topStations = Object.entries(stats?.stationStarts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count], i) => `${i + 1}. **${name}** (${count}x)`)
    .join("\n") || t("Keine Daten", "No data");

  const embed = new EmbedBuilder()
    .setColor(OMNI_COLORS.orange)
    .setAuthor(brandAuthor("OmniFM · Weekly Digest"))
    .setTitle(t("📈 Wöchentlicher Radio-Report", "📈 Weekly radio report"))
    .setDescription(
      t(
        `Hier ist die Zusammenfassung der letzten 7 Tage für **${guild.name}**:`,
        `Here is the summary for the last 7 days on **${guild.name}**:`
      )
    )
    .addFields(
      { name: t("Hörzeit", "Listening time"), value: formatMsDuration(weekListeningMs), inline: true },
      { name: t("Sessions", "Sessions"), value: String(weekSessions), inline: true },
      { name: t("Starts", "Starts"), value: String(weekStarts), inline: true },
      { name: t("Peak-Zuhörer", "Peak listeners"), value: String(weekPeak), inline: true },
      { name: t("Gesamte Hörzeit", "Total listening"), value: formatMsDuration(stats?.totalListeningMs || 0), inline: true },
      { name: t("Gesamt Sessions", "Total sessions"), value: String(stats?.totalSessions || 0), inline: true },
      { name: t("Top 5 Stationen", "Top 5 stations"), value: topStations, inline: false }
    )
    .setFooter(brandFooter("OmniFM · Weekly Digest"))
    .setTimestamp(new Date());

  try {
    await channel.send({ embeds: [embed] });
    log("INFO", `[WeeklyDigest] Gesendet an ${guild.name} #${channel.name}`);
  } catch (err) {
    log("WARN", `[WeeklyDigest] Fehler beim Senden an ${guild.name} #${channel.name}: ${err?.message || err}`);
  }
}

// ---- Tick-Funktion ----

/**
 * Prüft alle Guilds ob ein Digest fällig ist und sendet ihn.
 * @param {import('../bot/runtime.js').BotRuntime[]} runtimes
 */
async function tickWeeklyDigest(runtimes) {
  if (!isMongoConnected() || !getDb()) return;

  const now = new Date();

  try {
    const settings = await getDb()
      .collection("guild_settings")
      .find({ "weeklyDigest.enabled": true })
      .toArray();

    for (const setting of settings) {
      const config = normalizeWeeklyDigestConfig(setting.weeklyDigest || {});
      const channelId = config.channelId;
      if (!channelId || !setting.guildId) continue;
      if (!shouldSendWeeklyDigest(config, { now, lastSentAt: setting.weeklyDigestLastSent || null })) continue;

      for (const runtime of runtimes) {
        if (runtime.client.guilds.cache.has(setting.guildId)) {
          await sendWeeklyDigest(runtime, setting.guildId, channelId, config.language || "de");
          await setDigestLastSent(setting.guildId, now.toISOString());
          break;
        }
      }
    }
  } catch (err) {
    log("WARN", `[WeeklyDigest] Check fehlgeschlagen: ${err?.message || err}`);
  }
}

// ---- Service Start/Stop ----

/**
 * Startet den Weekly-Digest-Service.
 * @param {import('../bot/runtime.js').BotRuntime[]} runtimes
 */
function startWeeklyDigestService(runtimes) {
  if (digestTimer) return; // Bereits gestartet

  digestTimer = setInterval(() => {
    tickWeeklyDigest(runtimes).catch((err) => {
      log("WARN", `[WeeklyDigest] Unerwarteter Fehler im Tick: ${err?.message || err}`);
    });
  }, DIGEST_CHECK_INTERVAL_MS);

  // unref() damit der Timer den Prozess nicht am Leben hält wenn alles andere beendet ist
  digestTimer?.unref?.();

  log("INFO", `[WeeklyDigest] Service gestartet (Intervall: ${DIGEST_CHECK_INTERVAL_MS / 60_000}min).`);
}

/**
 * Stoppt den Weekly-Digest-Service.
 */
function stopWeeklyDigestService() {
  if (digestTimer) {
    clearInterval(digestTimer);
    digestTimer = null;
  }
}

export {
  startWeeklyDigestService,
  stopWeeklyDigestService,
  sendWeeklyDigest,
  tickWeeklyDigest,
  formatMsDuration,
  getDigestSettings,
  setDigestLastSent,
  DIGEST_CHECK_INTERVAL_MS,
};
