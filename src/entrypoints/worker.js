import { BotRuntime } from "../bot/runtime.js";
import { WorkerBridgeService } from "../bot/worker-bridge-service.js";
import { loadStations } from "../stations-store.js";
import { initCustomStationsStore, stopCustomStationsStore } from "../custom-stations.js";
import { initCommandPermissionsStore, stopCommandPermissionsStore } from "../command-permissions-store.js";
import { log } from "../lib/logging.js";
import {
  initializeSharedServices,
  installProcessHandlers,
  createWorkerRuntime,
} from "./shared.js";
import { startWorkerAutohealMonitor } from "./worker-autoheal.js";
import { startRuntimeLogShipper } from "../services/runtime-health-reporter.js";
import { startOwnerSettingsRefresh } from "../lib/owner-settings-cache.js";

await initializeSharedServices({ requireMongo: true });
// The owner's switches (seasonal decoration #426, prices) as the commander sees them.
startOwnerSettingsRefresh();
await initCustomStationsStore();
// Buttons on a worker's now-playing message are delivered to the worker, so it
// needs the /perm role rules as well (#232).
await initCommandPermissionsStore();

// Slot as the commander counts it, not the BOT number (#520).
const { runtime, workerConfig, workerIndex } = createWorkerRuntime(process.env, BotRuntime);
const bridgeService = new WorkerBridgeService(runtime);
let autohealMonitor = null;

const started = await runtime.start();
if (!started) {
  log("ERROR", `[${workerConfig.name}] Worker-Start fehlgeschlagen.`);
  process.exit(1);
}

const { shutdown } = installProcessHandlers({
  localRuntimes: [runtime],
  extraShutdown: [
    async () => {
      autohealMonitor?.stop?.();
      await bridgeService.stop();
      await stopCustomStationsStore();
      await stopCommandPermissionsStore();
    },
  ],
});

await bridgeService.start();
// The worker is where streams run; its log lines reach the owner console too (#206).
startRuntimeLogShipper({ processLabel: `worker-${workerIndex}` });
autohealMonitor = startWorkerAutohealMonitor({
  runtime,
  shutdown,
});

const stations = loadStations();
const doRestore = () => {
  log("INFO", `[${runtime.config.name}] Starte Auto-Restore (split-worker)...`);
  runtime.restoreState(stations).catch((err) => {
    log("ERROR", `[${runtime.config.name}] Auto-Restore fehlgeschlagen: ${err?.message || err}`);
  });
};

if (runtime.client.isReady()) {
  doRestore();
} else {
  runtime.client.once("clientReady", () => {
    setTimeout(doRestore, 2000);
  });
}

setInterval(() => {
  if (runtime.client.isReady()) {
    runtime.persistState();
  }
}, 60_000);

setInterval(() => {
  if (!runtime.client.isReady()) return;
  runtime.enforcePremiumGuildScope("periodic").catch((err) => {
    log("ERROR", `[${runtime.config.name}] Periodische Premium-Guild-Scope Prüfung fehlgeschlagen: ${err?.message || err}`);
  });
}, 10 * 60 * 1000);
