import { BotRuntime } from "../bot/runtime.js";
import { WorkerManager } from "../bot/worker-manager.js";
import { RemoteWorkerHandle } from "../bot/remote-worker-handle.js";
import { startWebServer } from "../api/server.js";
import { startRuntimeHealthReporter } from "../services/runtime-health-reporter.js";
import { startStationHealthService, stopStationHealthService } from "../services/station-health.js";
import { listWorkerSnapshots } from "../core/worker-bridge.js";
import { loadStations } from "../stations-store.js";
import { initCustomStationsStore, stopCustomStationsStore } from "../custom-stations.js";
import { initCommandPermissionsStore, stopCommandPermissionsStore } from "../command-permissions-store.js";
import { initScheduledEventsStore, stopScheduledEventsStore } from "../scheduled-events-store.js";
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
import { startWeeklyDigestService } from "../services/weekly-digest-service.js";
import { TIERS } from "../lib/helpers.js";
import { log, logError } from "../lib/logging.js";
import { startOperatorAlertWatchers } from "../services/operator-alerts.js";
import {
  parseExpiryReminderDays,
  initializeSharedServices,
  installProcessHandlers,
  resolveBotTopology,
} from "./shared.js";

const EXPIRY_REMINDER_DAYS = parseExpiryReminderDays(process.env.EXPIRY_REMINDER_DAYS);
await initializeSharedServices({ requireMongo: true });
await initCustomStationsStore();
await initCommandPermissionsStore();
await initScheduledEventsStore();
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

const webServerEnabled = String(process.env.WEB_SERVER_ENABLED ?? "0").trim() !== "0";
const webServer = webServerEnabled ? startWebServer(runtimes) : null;
if (!webServerEnabled) {
  log("INFO", "Node-Webserver deaktiviert; FastAPI :8001 bleibt das produktive Backend.");
}
const stopRuntimeHealthReporter = startRuntimeHealthReporter(runtimes, {
  intervalMs: Number.parseInt(String(process.env.RUNTIME_HEALTH_INTERVAL_MS || "5000"), 10),
  resourceModel: "split-processes",
});
// Worker without heartbeat and low disk space reach the operator (#260).
const stopOperatorAlerts = startOperatorAlertWatchers({
  workers: workerManager.workers,
  dataDir: process.env.OMNIFM_RUNTIME_DATA_DIR || process.cwd(),
});

installProcessHandlers({
  localRuntimes,
  webServer,
  extraShutdown: [
    async () => {
      workerManager.stopRemotePolling();
    },
    async () => {
      stopOperatorAlerts();
      stopRuntimeHealthReporter();
      stopStationHealthService();
      await Promise.all([
        stopScheduledEventsStore(),
        stopCustomStationsStore(),
        stopCommandPermissionsStore(),
      ]);
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

// The weekly recap (#278): the same service as the monolith.
startWeeklyDigestService([commanderRuntime]);

loadStations();
