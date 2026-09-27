import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { log, logError, getLogWriteQueue } from "../lib/logging.js";
import { connect as connectDb } from "../lib/db.js";
import { TIERS, parseExpiryReminderDays } from "../lib/helpers.js";
import { loadBotConfigs } from "../bot-config.js";
import { initStationsStore } from "../stations-store.js";
import { logStoreConcurrencyReport } from "../lib/store-concurrency.js";
import {
  getServerLicense,
  initPremiumStore,
} from "../premium-store.js";
import { setLicenseProvider } from "../core/entitlements.js";
import { initCouponStore } from "../coupon-store.js";
import { initProviderStores } from "../lib/provider-stores.js";
import { initDashboardStore } from "../dashboard-store.js";
import { initGuildLanguageStore } from "../guild-language-store.js";
import { flushBotStateStore, initBotStateStore } from "../bot-state.js";
import { initSongHistoryStore } from "../song-history-store.js";
import { MONGO_REQUIRED_MESSAGE, fileStoresAllowed } from "../lib/store-policy.js";
import { installOperatorIncidentRecorder, logRecentOperatorIncidentSummary } from "../operator-incidents-store.js";

const entryDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(entryDir, "..", "..", ".env");
dotenv.config({ path: envPath });
installOperatorIncidentRecorder({
  entry: path.basename(process.argv[1] || "entrypoint.js"),
});

function getCommanderSelection(botConfigs = [], env = process.env) {
  const configuredCommander = Number.parseInt(String(env.COMMANDER_BOT_INDEX || "1"), 10);
  const commanderIndex = Number.isFinite(configuredCommander) && configuredCommander >= 1
    ? botConfigs.findIndex((cfg) => Number(cfg?.index || 0) === configuredCommander)
    : -1;
  const resolvedCommanderIndex = commanderIndex >= 0 ? commanderIndex : 0;
  return {
    configuredCommander,
    commanderIndex,
    resolvedCommanderIndex,
    commanderConfig: botConfigs[resolvedCommanderIndex] || null,
    workerConfigs: botConfigs.filter((_, idx) => idx !== resolvedCommanderIndex),
  };
}

async function initializeSharedServices({ requireMongo = false } = {}) {
  try {
    const { generateDependencyReport } = await import("@discordjs/voice");
    const report = generateDependencyReport();
    log("INFO", `Voice-Dependencies:\n${report}`);
  } catch (depErr) {
    log("WARN", `Voice-Dependency-Check fehlgeschlagen: ${depErr.message}`);
  }

  const mongoUrlConfigured = String(process.env.MONGO_URL || "").trim().length > 0;
  const mongoEnabled = String(process.env.MONGO_ENABLED || "").trim() === "1" || mongoUrlConfigured;
  let mongoConnected = false;

  if (mongoEnabled) {
    try {
      await connectDb();
      mongoConnected = true;
      log("INFO", "MongoDB-Verbindung fuer Node.js Bot hergestellt.");
      const { migrateJsonToMongo } = await import("../listening-stats-store.js");
      const migration = await migrateJsonToMongo();
      if (migration.migrated) {
        log("INFO", `Listening-Stats JSON -> MongoDB Migration: ${migration.count}/${migration.total} Guilds migriert.`);
      }
    } catch (err) {
      log("WARN", `MongoDB-Verbindung fehlgeschlagen: ${err.message}. Datei-basierte Stores bleiben aktiv.`);
    }
  } else {
    log("INFO", "MongoDB ist deaktiviert (MONGO_ENABLED=0 und MONGO_URL nicht gesetzt). Nutze Datei-basierte Stores.");
  }

  logStoreConcurrencyReport({
    log,
    mongoConnected,
    requireMongo,
  });

  if (requireMongo && !mongoConnected) {
    throw new Error("Split-Commander/Worker benoetigt eine aktive MongoDB-Verbindung.");
  }
  // Production keeps its data in MongoDB only (#292); no silent fall back to files.
  if (!mongoConnected && !fileStoresAllowed()) {
    throw new Error(MONGO_REQUIRED_MESSAGE);
  }

  await initPremiumStore();
  // Every process speaks in the server's language, workers included (#292).
  await initGuildLanguageStore();
  // Each bot's restore state and song history, before any bot starts (#292).
  await initBotStateStore();
  await initSongHistoryStore();
  // Checkout, bot lists, votes and dashboard logins belong to the commander;
  // a worker only streams and needs none of their MongoDB refreshes (#292).
  if (String(process.env.BOT_PROCESS_ROLE || "").trim().toLowerCase() !== "worker") {
    await initCouponStore();
    await initProviderStores();
    await initDashboardStore();
  }
  await initStationsStore();
  await logRecentOperatorIncidentSummary({
    label: "Owner summary on startup",
  }).catch(() => null);

  setLicenseProvider((serverId) => {
    const license = getServerLicense(serverId);
    if (!license) return null;
    return {
      plan: license.plan || license.tier || "free",
      active: Boolean(license.active) && !license.expired,
      seats: Math.max(1, Number(license.seats || 1) || 1),
    };
  });

  return {
    mongoEnabled,
    mongoConnected,
  };
}

function resolveBotTopology(env = process.env) {
  const botConfigs = loadBotConfigs(env);
  const commanderSelection = getCommanderSelection(botConfigs, env);
  const commanderConfig = commanderSelection.commanderConfig;
  if (!commanderConfig) {
    throw new Error("Commander-Bot konnte nicht aufgeloest werden.");
  }

  if (commanderSelection.commanderIndex >= 0) {
    log("INFO", `Commander-Bot aus ENV: BOT_${commanderSelection.configuredCommander}`);
  } else if (Number.isFinite(commanderSelection.configuredCommander) && commanderSelection.configuredCommander >= 1) {
    log("WARN", `COMMANDER_BOT_INDEX=${commanderSelection.configuredCommander} ist nicht konfiguriert. Fallback auf BOT_${botConfigs[0]?.index || 1}.`);
  }

  return {
    botConfigs,
    commanderConfig,
    workerConfigs: commanderSelection.workerConfigs,
    resolvedCommanderIndex: commanderSelection.resolvedCommanderIndex,
    configuredCommander: commanderSelection.configuredCommander,
  };
}

function resolveWorkerConfig(botConfigs = [], workerIndex) {
  const normalizedIndex = Number.parseInt(String(workerIndex || ""), 10);
  if (!Number.isFinite(normalizedIndex) || normalizedIndex < 1) {
    throw new Error("BOT_PROCESS_INDEX fuer Worker fehlt oder ist ungueltig.");
  }

  const workerConfig = botConfigs.find((config) => Number(config?.index || 0) === normalizedIndex) || null;
  if (!workerConfig) {
    throw new Error(`BOT_${normalizedIndex} ist nicht konfiguriert.`);
  }
  return workerConfig;
}

function installProcessHandlers({
  localRuntimes = [],
  webServer = null,
  extraShutdown = [],
}) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("INFO", `Shutdown via ${signal}...`);

    for (const runtime of localRuntimes) {
      try {
        runtime.beginShutdown?.();
      } catch {
        // ignore begin-shutdown errors during shutdown
      }
      try {
        runtime.persistState();
      } catch {
        // ignore persist errors during shutdown
      }
    }

    if (webServer?.close) {
      try {
        webServer.close();
      } catch {
        // ignore
      }
    }

    for (const fn of extraShutdown) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fn();
      } catch {
        // ignore
      }
    }

    await Promise.all(
      localRuntimes.map(async (runtime) => {
        try {
          await runtime.stop();
        } catch {
          // ignore
        }
      })
    );

    // The state saved above has to reach MongoDB before the process ends (#292).
    await flushBotStateStore().catch(() => null);

    try {
      await getLogWriteQueue();
    } catch {
      // ignore
    }
  }

  process.on("unhandledRejection", (reason) => {
    logError("[Process] Unhandled rejection", reason, {
      context: {
        pid: process.pid,
        entry: path.basename(process.argv[1] || "entrypoint.js"),
      },
    });
  });

  process.on("uncaughtException", (err) => {
    logError("[Process] Uncaught exception", err, {
      context: {
        pid: process.pid,
        entry: path.basename(process.argv[1] || "entrypoint.js"),
      },
    });
    shutdown("uncaughtException").finally(() => process.exit(1));
  });

  process.on("SIGINT", () => {
    shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").finally(() => process.exit(0));
  });

  return { shutdown };
}

export {
  TIERS,
  envPath,
  parseExpiryReminderDays,
  initializeSharedServices,
  resolveBotTopology,
  resolveWorkerConfig,
  installProcessHandlers,
};
