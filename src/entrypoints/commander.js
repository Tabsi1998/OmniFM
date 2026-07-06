import { BotRuntime } from "../bot/runtime.js";
import { WorkerManager } from "../bot/worker-manager.js";
import { RemoteWorkerHandle } from "../bot/remote-worker-handle.js";
import { startWebServer } from "../api/server.js";
import { listWorkerSnapshots } from "../core/worker-bridge.js";
import { loadStations } from "../stations-store.js";
import {
  listLicenses,
  patchLicenseById,
} from "../premium-store.js";
import {
  isConfigured as isEmailConfigured,
  sendMail,
  buildExpiryWarningEmail,
  buildExpiryEmail,
} from "../email.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import {
  getBotsGGIntervals,
  isBotsGGEnabled,
  syncBotsGGStats,
} from "../services/botsgg.js";
import {
  getDiscordBotListIntervals,
  isDiscordBotListEnabled,
  syncDiscordBotListCommands,
  syncDiscordBotListStats,
  syncDiscordBotListVotes,
} from "../services/discordbotlist.js";
import {
  getTopGGIntervals,
  isTopGGEnabled,
  syncTopGGCommands,
  syncTopGGProject,
  syncTopGGStats,
  syncTopGGVotes,
} from "../services/topgg.js";
import { startStationHealthService, stopStationHealthService } from "../services/station-health.js";
import { getDb, isConnected as isMongoConnected } from "../lib/db.js";
import {
  normalizeWeeklyDigestConfig,
  shouldSendWeeklyDigest,
} from "../lib/weekly-digest.js";
import { TIERS } from "../lib/helpers.js";
import { getGuildDailyStats } from "../listening-stats-store.js";
import { log, logError } from "../lib/logging.js";
import {
  parseExpiryReminderDays,
  initializeSharedServices,
  installProcessHandlers,
  resolveBotTopology,
} from "./shared.js";

const EXPIRY_REMINDER_DAYS = parseExpiryReminderDays(process.env.EXPIRY_REMINDER_DAYS);
const DIGEST_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function formatMsDuration(ms) {
  if (!ms || ms <= 0) return "0m";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

async function getDigestSettings(guildId) {
  if (!isMongoConnected() || !getDb()) return null;
  try {
    return await getDb().collection("guild_settings").findOne({ guildId }, { projection: { _id: 0 } });
  } catch {
    return null;
  }
}

async function setDigestLastSent(guildId, timestamp) {
  if (!isMongoConnected() || !getDb()) return;
  try {
    await getDb().collection("guild_settings").updateOne(
      { guildId },
      { $set: { weeklyDigestLastSent: timestamp } },
      { upsert: true }
    );
  } catch {
    // ignore
  }
}

async function sendWeeklyDigest(runtime, guildId, channelId, language = "de") {
  const t = (de, en) => (language === "de" ? de : en);
  const guild = runtime.client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const dailyStats = await getGuildDailyStats(guildId, 7);
  const weekStarts = dailyStats.reduce((sum, entry) => sum + (entry.totalStarts || 0), 0);
  const weekListeningMs = dailyStats.reduce((sum, entry) => sum + (entry.totalListeningMs || 0), 0);
  const weekSessions = dailyStats.reduce((sum, entry) => sum + (entry.totalSessions || 0), 0);
  const weekPeak = Math.max(0, ...dailyStats.map((entry) => entry.peakListeners || 0));

  const { EmbedBuilder } = await import("discord.js");
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(t("Woechentlicher Radio-Report", "Weekly radio report"))
    .setDescription(t(
      `Hier ist die Zusammenfassung der letzten 7 Tage fuer **${guild.name}**:`,
      `Here is the summary for the last 7 days on **${guild.name}**:`
    ))
    .addFields(
      { name: t("Hoerzeit", "Listening time"), value: formatMsDuration(weekListeningMs), inline: true },
      { name: t("Sessions", "Sessions"), value: String(weekSessions), inline: true },
      { name: t("Starts", "Starts"), value: String(weekStarts), inline: true },
      { name: t("Peak-Zuhoerer", "Peak listeners"), value: String(weekPeak), inline: true },
    )
    .setFooter({ text: "OmniFM Weekly Digest" })
    .setTimestamp(new Date());

  try {
    await channel.send({ embeds: [embed] });
    log("INFO", `[WeeklyDigest] Gesendet an ${guild.name} #${channel.name}`);
  } catch (err) {
    log("WARN", `[WeeklyDigest] Fehler beim Senden: ${err?.message || err}`);
  }
}

await initializeSharedServices({ requireMongo: true });
startStationHealthService(loadStations);
const { commanderConfig, workerConfigs } = resolveBotTopology(process.env);

const remoteWorkers = workerConfigs.map((config) => new RemoteWorkerHandle(config));
const workerManager = new WorkerManager(remoteWorkers, {
  statusProvider: {
    async listStatuses({ workerIds = [] } = {}) {
      return listWorkerSnapshots({ workerIds });
    },
  },
});

await workerManager.refreshRemoteStates({ force: true }).catch(() => null);
workerManager.startRemotePolling();

const commanderRuntime = new BotRuntime(commanderConfig, {
  role: "commander",
  workerManager,
});
const localRuntimes = [commanderRuntime];
const runtimes = [commanderRuntime, ...workerManager.workers];

log(
  "INFO",
  `Bot-Architektur (split): Commander="${commanderConfig.name}", Remote-Worker=${workerConfigs.length} (${workerConfigs.map((config) => config.name).join(", ") || "keine"})`
);

const started = await commanderRuntime.start();
if (!started) {
  log("ERROR", "Commander konnte nicht gestartet werden. Prozess wird beendet.");
  process.exit(1);
}

const webServer = startWebServer(runtimes);

installProcessHandlers({
  localRuntimes,
  webServer,
  extraShutdown: [
    async () => {
      stopStationHealthService();
      workerManager.stopRemotePolling();
    },
  ],
});

const discordBotListEnabled = isDiscordBotListEnabled(runtimes);
if (discordBotListEnabled) {
  const discordBotListIntervals = getDiscordBotListIntervals();
  let commandsSyncRunning = false;
  let statsSyncRunning = false;
  let votesSyncRunning = false;

  const runCommandsSync = async (source = "periodic") => {
    if (commandsSyncRunning) return;
    commandsSyncRunning = true;
    try {
      await workerManager.refreshRemoteStates({ force: true }).catch(() => null);
      await syncDiscordBotListCommands(runtimes);
    } catch (err) {
      logError(`[DiscordBotList] Command sync (${source}) fehlgeschlagen`, err, {
        context: { service: "discordbotlist", source, topology: "split" },
      });
    } finally {
      commandsSyncRunning = false;
    }
  };

  const runStatsSync = async (source = "periodic") => {
    if (statsSyncRunning) return;
    statsSyncRunning = true;
    try {
      await workerManager.refreshRemoteStates({ force: true }).catch(() => null);
      await syncDiscordBotListStats(runtimes);
    } catch (err) {
      logError(`[DiscordBotList] Stats sync (${source}) fehlgeschlagen`, err, {
        context: { service: "discordbotlist", source, topology: "split" },
      });
    } finally {
      statsSyncRunning = false;
    }
  };

  const runVotesSync = async (source = "periodic") => {
    if (votesSyncRunning) return;
    votesSyncRunning = true;
    try {
      await syncDiscordBotListVotes(runtimes);
    } catch (err) {
      logError(`[DiscordBotList] Vote sync (${source}) fehlgeschlagen`, err, {
        context: { service: "discordbotlist", source, topology: "split" },
      });
    } finally {
      votesSyncRunning = false;
    }
  };

  setTimeout(() => {
    runCommandsSync("startup");
    runStatsSync("startup");
    runVotesSync("startup");
  }, discordBotListIntervals.startupDelayMs);

  if (discordBotListIntervals.commandsSyncMs > 0) {
    setInterval(() => {
      runCommandsSync("periodic");
    }, discordBotListIntervals.commandsSyncMs);
  }
  if (discordBotListIntervals.statsSyncMs > 0) {
    setInterval(() => {
      runStatsSync("periodic");
    }, discordBotListIntervals.statsSyncMs);
  }
  if (discordBotListIntervals.voteSyncMs > 0) {
    setInterval(() => {
      runVotesSync("periodic");
    }, discordBotListIntervals.voteSyncMs);
  }
} else {
  log("INFO", "[DiscordBotList] Sync deaktiviert oder nicht konfiguriert.");
}

const botsGGEnabled = isBotsGGEnabled(runtimes);
if (botsGGEnabled) {
  const botsGGIntervals = getBotsGGIntervals();
  let statsSyncRunning = false;

  const runStatsSync = async (source = "periodic") => {
    if (statsSyncRunning) return;
    statsSyncRunning = true;
    try {
      await workerManager.refreshRemoteStates({ force: true }).catch(() => null);
      await syncBotsGGStats(runtimes);
    } catch (err) {
      logError(`[BotsGG] Stats sync (${source}) fehlgeschlagen`, err, {
        context: { service: "botsgg", source, topology: "split" },
      });
    } finally {
      statsSyncRunning = false;
    }
  };

  setTimeout(() => {
    runStatsSync("startup");
  }, botsGGIntervals.startupDelayMs);

  if (botsGGIntervals.statsSyncMs > 0) {
    setInterval(() => {
      runStatsSync("periodic");
    }, botsGGIntervals.statsSyncMs);
  }
} else {
  log("INFO", "[BotsGG] Stats sync deaktiviert oder nicht konfiguriert.");
}

const topGGEnabled = isTopGGEnabled(runtimes);
if (topGGEnabled) {
  const topGGIntervals = getTopGGIntervals();
  let projectSyncRunning = false;
  let commandsSyncRunning = false;
  let statsSyncRunning = false;
  let votesSyncRunning = false;

  const runProjectSync = async (source = "periodic") => {
    if (projectSyncRunning) return;
    projectSyncRunning = true;
    try {
      await syncTopGGProject(runtimes);
    } catch (err) {
      logError(`[TopGG] Project sync (${source}) fehlgeschlagen`, err, {
        context: { service: "topgg", source, sync: "project", topology: "split" },
      });
    } finally {
      projectSyncRunning = false;
    }
  };

  const runCommandsSync = async (source = "periodic") => {
    if (commandsSyncRunning) return;
    commandsSyncRunning = true;
    try {
      await syncTopGGCommands(runtimes);
    } catch (err) {
      logError(`[TopGG] Command sync (${source}) fehlgeschlagen`, err, {
        context: { service: "topgg", source, sync: "commands", topology: "split" },
      });
    } finally {
      commandsSyncRunning = false;
    }
  };

  const runStatsSync = async (source = "periodic") => {
    if (statsSyncRunning) return;
    statsSyncRunning = true;
    try {
      await workerManager.refreshRemoteStates({ force: true }).catch(() => null);
      await syncTopGGStats(runtimes);
    } catch (err) {
      logError(`[TopGG] Stats sync (${source}) fehlgeschlagen`, err, {
        context: { service: "topgg", source, sync: "stats", topology: "split" },
      });
    } finally {
      statsSyncRunning = false;
    }
  };

  const runVotesSync = async (source = "periodic") => {
    if (votesSyncRunning) return;
    votesSyncRunning = true;
    try {
      await syncTopGGVotes(runtimes);
    } catch (err) {
      logError(`[TopGG] Vote sync (${source}) fehlgeschlagen`, err, {
        context: { service: "topgg", source, sync: "votes", topology: "split" },
      });
    } finally {
      votesSyncRunning = false;
    }
  };

  setTimeout(() => {
    runProjectSync("startup");
    runCommandsSync("startup");
    runStatsSync("startup");
    runVotesSync("startup");
  }, topGGIntervals.startupDelayMs);

  if (topGGIntervals.projectSyncMs > 0) {
    setInterval(() => {
      runProjectSync("periodic");
    }, topGGIntervals.projectSyncMs);
  }
  if (topGGIntervals.commandsSyncMs > 0) {
    setInterval(() => {
      runCommandsSync("periodic");
    }, topGGIntervals.commandsSyncMs);
  }
  if (topGGIntervals.statsSyncMs > 0) {
    setInterval(() => {
      runStatsSync("periodic");
    }, topGGIntervals.statsSyncMs);
  }
  if (topGGIntervals.voteSyncMs > 0) {
    setInterval(() => {
      runVotesSync("periodic");
    }, topGGIntervals.voteSyncMs);
  }
} else {
  log("INFO", "[TopGG] Sync deaktiviert oder nicht konfiguriert.");
}

setInterval(() => {
  if (commanderRuntime.client.isReady()) {
    commanderRuntime.persistState();
  }
}, 60_000);

const periodicGuildSyncIntervalRaw = Number.parseInt(String(process.env.PERIODIC_GUILD_COMMAND_SYNC_MS ?? "1800000"), 10);
const periodicGuildSyncIntervalMs = Number.isFinite(periodicGuildSyncIntervalRaw) && periodicGuildSyncIntervalRaw >= 60_000
  ? periodicGuildSyncIntervalRaw
  : 0;
let periodicGuildSyncRunning = false;

if (periodicGuildSyncIntervalMs > 0) {
  log("INFO", `Periodischer Guild-Command-Sync aktiv: alle ${Math.round(periodicGuildSyncIntervalMs / 1000)}s.`);
  setInterval(() => {
    if (periodicGuildSyncRunning) return;
    periodicGuildSyncRunning = true;
    commanderRuntime.syncGuildCommands("periodic")
      .catch((err) => {
        logError("[GuildSync] Periodischer Sync fehlgeschlagen", err, {
          context: { source: "periodic", topology: "split" },
        });
      })
      .finally(() => {
        periodicGuildSyncRunning = false;
      });
  }, periodicGuildSyncIntervalMs);
} else {
  log("INFO", "Periodischer Guild-Command-Sync deaktiviert (PERIODIC_GUILD_COMMAND_SYNC_MS=0).");
}

log("INFO", `Lizenz-Reminder aktiv fuer: ${EXPIRY_REMINDER_DAYS.join(", ")} Tage vor Ablauf + abgelaufen.`);
setInterval(async () => {
  if (!isEmailConfigured()) return;
  try {
    const all = listLicenses();
    for (const [rawLicenseId, license] of Object.entries(all)) {
      if (!license?.expiresAt) continue;

      const licenseId = String(license.id || rawLicenseId || "").trim();
      const serverId = String((license.linkedServerIds || [])[0] || "-");
      const tierKey = String(license.plan || license.tier || "free");
      const tierName = TIERS[tierKey]?.name || tierKey;
      const emailLanguage = normalizeLanguage(license.preferredLanguage || license.language, getDefaultLanguage());
      const contactEmail = String(license.contactEmail || "").trim().toLowerCase();
      const daysUntilExpiry = Math.ceil((new Date(license.expiresAt) - new Date()) / 86400000);

      if (daysUntilExpiry > 0) {
        for (let idx = 0; idx < EXPIRY_REMINDER_DAYS.length; idx += 1) {
          const reminderDay = EXPIRY_REMINDER_DAYS[idx];
          const nextLowerDay = EXPIRY_REMINDER_DAYS[idx + 1] ?? 0;
          const withinWindow = daysUntilExpiry <= reminderDay && daysUntilExpiry > nextLowerDay;
          if (!withinWindow) continue;

          const warningFlagField = `_warning${reminderDay}ForExpiryAt`;
          const warningAlreadySent = license[warningFlagField] === license.expiresAt;
          if (warningAlreadySent || !contactEmail) break;

          const html = buildExpiryWarningEmail({
            tierName,
            serverId,
            expiresAt: license.expiresAt,
            daysLeft: Math.max(1, daysUntilExpiry),
            language: emailLanguage,
          });
          const warningSubject = emailLanguage === "de"
            ? `Premium ${tierName} laeuft in ${Math.max(1, daysUntilExpiry)} ${Math.max(1, daysUntilExpiry) === 1 ? "Tag" : "Tagen"} ab!`
            : `Premium ${tierName} expires in ${Math.max(1, daysUntilExpiry)} day${Math.max(1, daysUntilExpiry) === 1 ? "" : "s"}!`;
          const result = await sendMail(contactEmail, warningSubject, html);
          if (result?.success) {
            patchLicenseById(licenseId, { [warningFlagField]: license.expiresAt });
            log("INFO", `[Email] Ablauf-Warnung (${reminderDay}d) gesendet an ${contactEmail} fuer Lizenz ${licenseId} (Server ${serverId})`);
          } else {
            log("ERROR", `[Email] Ablauf-Warnung (${reminderDay}d) fehlgeschlagen fuer Lizenz ${licenseId}: ${result?.error || "Unbekannter Fehler"}`);
          }
          break;
        }
      }

      const expiredAlreadyNotified = license._expiredNotifiedForExpiryAt === license.expiresAt || license._expiredNotified === true;
      if (daysUntilExpiry <= 0 && contactEmail && !expiredAlreadyNotified) {
        const html = buildExpiryEmail({ tierName, serverId, language: emailLanguage });
        const expiredSubject = emailLanguage === "de"
          ? `Premium ${tierName} abgelaufen`
          : `Premium ${tierName} expired`;
        const result = await sendMail(contactEmail, expiredSubject, html);
        if (result?.success) {
          patchLicenseById(licenseId, { _expiredNotifiedForExpiryAt: license.expiresAt, _expiredNotified: true });
          log("INFO", `[Email] Ablauf-Benachrichtigung gesendet an ${contactEmail} fuer Lizenz ${licenseId} (Server ${serverId})`);
        } else {
          log("ERROR", `[Email] Ablauf-Benachrichtigung fehlgeschlagen fuer Lizenz ${licenseId}: ${result?.error || "Unbekannter Fehler"}`);
        }
      }
    }
  } catch (err) {
    log("ERROR", `[ExpiryCheck] ${err.message}`);
  }
}, 6 * 60 * 60 * 1000);

setInterval(() => {
  if (!commanderRuntime.client.isReady()) return;
  commanderRuntime.enforcePremiumGuildScope("periodic").catch((err) => {
    log("ERROR", `[${commanderRuntime.config.name}] Periodische Premium-Guild-Scope Pruefung fehlgeschlagen: ${err?.message || err}`);
  });
}, 10 * 60 * 1000);

setInterval(async () => {
  if (!isMongoConnected() || !getDb()) return;
  const now = new Date();

  try {
    const settings = await getDb().collection("guild_settings").find({ "weeklyDigest.enabled": true }).toArray();
    for (const setting of settings) {
      const config = normalizeWeeklyDigestConfig(setting.weeklyDigest || {});
      const channelId = config.channelId;
      if (!channelId || !setting.guildId) continue;
      if (!shouldSendWeeklyDigest(config, { now, lastSentAt: setting.weeklyDigestLastSent || null })) continue;

      const digestSettings = await getDigestSettings(setting.guildId);
      if (!digestSettings) continue;
      await sendWeeklyDigest(commanderRuntime, setting.guildId, channelId, config.language || "de");
      await setDigestLastSent(setting.guildId, now.toISOString());
    }
  } catch (err) {
    log("WARN", `[WeeklyDigest] Check fehlgeschlagen: ${err?.message || err}`);
  }
}, DIGEST_CHECK_INTERVAL_MS);

loadStations();
