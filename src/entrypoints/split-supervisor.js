import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { log } from "../lib/logging.js";

const entryDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(entryDir, "..", "..");

function buildSplitProcessSpecs(botIndexes = [], commanderIndex = 1) {
  const indexes = [...new Set((Array.isArray(botIndexes) ? botIndexes : [])
    .map((value) => Number.parseInt(String(value || ""), 10))
    .filter((value) => Number.isFinite(value) && value >= 1))]
    .sort((a, b) => a - b);
  const resolvedCommander = Number.parseInt(String(commanderIndex || "1"), 10);
  if (!indexes.includes(resolvedCommander)) {
    throw new Error(`Commander BOT_${resolvedCommander} ist nicht konfiguriert.`);
  }

  return [
    {
      id: "commander",
      label: `Commander BOT_${resolvedCommander}`,
      entry: path.join(entryDir, "commander.js"),
      env: {},
    },
    ...indexes
      .filter((index) => index !== resolvedCommander)
      .map((index) => ({
        id: `worker-${index}`,
        label: `Worker BOT_${index}`,
        entry: path.join(entryDir, "worker.js"),
        env: { BOT_PROCESS_INDEX: String(index) },
      })),
  ];
}

function getSplitRestartDelay(crashCount, { baseMs = 1_000, maxMs = 30_000 } = {}) {
  const count = Math.max(1, Number.parseInt(String(crashCount || "1"), 10) || 1);
  return Math.min(Math.max(250, maxMs), Math.max(250, baseMs) * (2 ** Math.min(5, count - 1)));
}

async function superviseSplitRuntime({
  botIndexes,
  commanderIndex = 1,
  spawnImpl = spawn,
  env = process.env,
  cwd = repoRoot,
  stableAfterMs = 60_000,
} = {}) {
  const specs = buildSplitProcessSpecs(botIndexes, commanderIndex);
  const children = new Map();
  const restartTimers = new Map();
  const failures = new Map();
  let stopping = false;
  let finish;
  const stopped = new Promise((resolve) => { finish = resolve; });

  const launch = (spec) => {
    if (stopping) return;
    const startedAt = Date.now();
    let child;
    try {
      child = spawnImpl(process.execPath, [spec.entry], {
        cwd,
        env: {
          ...env,
          ...spec.env,
          OMNIFM_DEPLOYMENT_MODE: "split",
          WEB_SERVER_ENABLED: "0",
        },
        stdio: "inherit",
        windowsHide: true,
      });
    } catch (err) {
      const nextFailure = (failures.get(spec.id) || 0) + 1;
      failures.set(spec.id, nextFailure);
      const delayMs = getSplitRestartDelay(nextFailure);
      log("ERROR", `[Supervisor] ${spec.label} konnte nicht gestartet werden: ${err?.message || err}. Neuer Versuch in ${delayMs}ms.`);
      restartTimers.set(spec.id, setTimeout(() => launch(spec), delayMs));
      return;
    }

    children.set(spec.id, child);
    log("INFO", `[Supervisor] ${spec.label} gestartet (PID ${child.pid || "?"}).`);

    child.once("error", (err) => {
      log("ERROR", `[Supervisor] ${spec.label} Prozessfehler: ${err?.message || err}`);
    });
    child.once("exit", (code, signal) => {
      children.delete(spec.id);
      if (stopping) return;
      const ranStable = Date.now() - startedAt >= stableAfterMs;
      const nextFailure = ranStable ? 1 : (failures.get(spec.id) || 0) + 1;
      failures.set(spec.id, nextFailure);
      const delayMs = getSplitRestartDelay(nextFailure);
      log(
        code === 0 ? "WARN" : "ERROR",
        `[Supervisor] ${spec.label} beendet (code=${code ?? "-"}, signal=${signal || "-"}). Neustart in ${delayMs}ms.`
      );
      restartTimers.set(spec.id, setTimeout(() => {
        restartTimers.delete(spec.id);
        launch(spec);
      }, delayMs));
    });
  };

  const shutdown = async (signal = "SIGTERM") => {
    if (stopping) return stopped;
    stopping = true;
    for (const timer of restartTimers.values()) clearTimeout(timer);
    restartTimers.clear();
    log("INFO", `[Supervisor] Stoppe ${children.size} Bot-Prozesse via ${signal}...`);

    const exits = [];
    for (const child of children.values()) {
      exits.push(new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) {
          resolve();
          return;
        }
        child.once("exit", resolve);
        try { child.kill("SIGTERM"); } catch { resolve(); }
      }));
    }

    let forceTimer;
    await Promise.race([
      Promise.allSettled(exits),
      new Promise((resolve) => {
        forceTimer = setTimeout(() => {
          for (const child of children.values()) {
            if (child.exitCode === null && !child.signalCode) {
              try { child.kill("SIGKILL"); } catch { /* already gone */ }
            }
          }
          resolve();
        }, 15_000);
      }),
    ]);
    if (forceTimer) clearTimeout(forceTimer);
    children.clear();
    finish();
    return stopped;
  };

  process.once("SIGINT", () => { shutdown("SIGINT").catch(() => finish()); });
  process.once("SIGTERM", () => { shutdown("SIGTERM").catch(() => finish()); });

  log("INFO", `[Supervisor] Split-Runtime aktiv: 1 Commander, ${Math.max(0, specs.length - 1)} Worker.`);
  specs.forEach(launch);
  await stopped;
}

export { buildSplitProcessSpecs, getSplitRestartDelay, superviseSplitRuntime };
