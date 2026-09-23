import os from "node:os";

import * as workerBridge from "../core/worker-bridge.js";
import { isDoorbellConnected, onDoorbell } from "../core/process-doorbell.js";
import { log } from "../lib/logging.js";

const REMOTE_WORKER_HEARTBEAT_MS = Math.max(2_000, Number.parseInt(String(process.env.REMOTE_WORKER_HEARTBEAT_MS || "5000"), 10) || 5_000);
const REMOTE_WORKER_COMMAND_POLL_MS = Math.max(250, Number.parseInt(String(process.env.REMOTE_WORKER_COMMAND_POLL_MS || "1000"), 10) || 1_000);
// With the supervisor's doorbell a new command rings the worker at once; the
// poll only catches a ring that got lost (#213).
const REMOTE_WORKER_COMMAND_FALLBACK_POLL_MS = Math.max(
  REMOTE_WORKER_COMMAND_POLL_MS,
  Number.parseInt(String(process.env.REMOTE_WORKER_COMMAND_FALLBACK_POLL_MS || "5000"), 10) || 5_000
);
const REMOTE_WORKER_MAX_COMMANDS_PER_TICK = 25;
let lastCpuUsage = process.cpuUsage();
let lastCpuSampleAt = Date.now();

function sampleProcessCpuPct() {
  const now = Date.now();
  const current = process.cpuUsage();
  const elapsedMs = Math.max(1, now - lastCpuSampleAt);
  const usedMicros = (current.user - lastCpuUsage.user) + (current.system - lastCpuUsage.system);
  lastCpuUsage = current;
  lastCpuSampleAt = now;
  const cores = Math.max(1, (os.cpus() || []).length || 1);
  return Math.max(0, Math.min(100, Math.round((((usedMicros / 1000) / (elapsedMs * cores)) * 100) * 10) / 10));
}

function buildWorkerGuildSummaries(runtime) {
  const rows = [];
  for (const guild of runtime.client.guilds.cache.values()) {
    rows.push({
      guildId: guild.id,
      guildName: guild.name || guild.id,
      memberCount: Number(guild.memberCount || 0) || 0,
    });
  }
  return rows;
}

function buildWorkerRuntimeMetrics(runtime) {
  return {
    pid: process.pid,
    startedAtMs: Number(runtime?.startedAt || Date.now()) || Date.now(),
    uptimeSec: Math.max(0, Math.floor(process.uptime())),
    memoryRssMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
    memoryHeapUsedMb: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10,
    loadAvg: Array.isArray(os.loadavg?.()) ? os.loadavg().map((value) => Number(value.toFixed(2))) : [],
    cpuPct: sampleProcessCpuPct(),
    host: os.hostname(),
    cores: (os.cpus() || []).length || 1,
    nodeVersion: process.version,
    resourceScope: "node-process",
  };
}

function buildWorkerSnapshot(runtime) {
  return {
    status: runtime.buildStatusSnapshot({ includeGuildDetails: true }),
    guilds: buildWorkerGuildSummaries(runtime),
    runtimeMetrics: buildWorkerRuntimeMetrics(runtime),
  };
}

class WorkerBridgeService {
  constructor(runtime, { bridge = workerBridge, doorbell = { isDoorbellConnected, onDoorbell } } = {}) {
    this.runtime = runtime;
    this.bridge = bridge;
    this.doorbell = doorbell;
    this.heartbeatTimer = null;
    this.commandTimer = null;
    this.commandLoopInFlight = false;
    this.tickRequested = false;
    this.stopDoorbell = null;
  }

  async publishSnapshot() {
    await this.bridge.publishWorkerSnapshot(this.runtime.config.id, buildWorkerSnapshot(this.runtime));
  }

  async executeCommand(command) {
    const payload = command?.payload && typeof command.payload === "object"
      ? command.payload
      : {};
    const guildId = String(payload.guildId || "").trim();

    switch (String(command?.type || "").trim()) {
      case "play": {
        const parsedVolume = Number.parseInt(String(payload.volume ?? ""), 10);
        const resolvedVolume = Number.isFinite(parsedVolume)
          ? Math.max(0, Math.min(100, parsedVolume))
          : undefined;
        return this.runtime.playInGuild(
          guildId,
          payload.channelId,
          payload.stationKey,
          payload.stationsData,
          resolvedVolume,
          payload.options || {}
        );
      }
      case "stop":
        return this.runtime.stopInGuild(guildId);
      case "pause":
        return this.runtime.pauseInGuild(guildId);
      case "resume":
        return this.runtime.resumeInGuild(guildId);
      case "setVolume": {
        const parsedValue = Number.parseInt(String(payload.value ?? ""), 10);
        return this.runtime.setVolumeInGuild(guildId, Number.isFinite(parsedValue) ? parsedValue : payload.value);
      }
      case "voiceGuardRefresh": {
        await this.runtime.refreshVoiceGuardSettings(guildId, { force: payload.force === true }).catch(() => null);
        return {
          ok: true,
          summary: this.runtime.getVoiceGuardRuntimeSummary(guildId),
        };
      }
      case "voiceGuardUnlock": {
        const result = this.runtime.setVoiceGuardTemporaryUnlock(guildId, payload.durationMs, payload.reason || "remote-unlock");
        return {
          ok: true,
          ...result,
          summary: this.runtime.getVoiceGuardRuntimeSummary(guildId),
        };
      }
      case "voiceGuardLock": {
        const result = this.runtime.clearVoiceGuardTemporaryUnlock(guildId, payload.reason || "remote-lock");
        return {
          ok: true,
          ...result,
          summary: this.runtime.getVoiceGuardRuntimeSummary(guildId),
        };
      }
      default:
        throw new Error(`Unbekannter Worker-Command: ${command?.type || "-"}`);
    }
  }

  async runClaimedCommand(command) {
    try {
      const result = await this.executeCommand(command);
      await this.publishSnapshot().catch((err) => {
        log("WARN", `[${this.runtime.config.name}] Worker-Bridge Snapshot nach Command fehlgeschlagen: ${err?.message || err}`);
      });
      await this.bridge.completeWorkerCommand(command.commandId, result || { ok: true });
    } catch (err) {
      await this.bridge.failWorkerCommand(command.commandId, err).catch(() => null);
      log("ERROR", `[${this.runtime.config.name}] Worker-Bridge command failed (${command?.type || "-"}) guild=${command?.payload?.guildId || "-"}: ${err?.message || err}`);
    }
  }

  /**
   * Claims every pending command, not one per tick: `/stop` on many servers
   * or an event burst no longer drains at one command per second (#213).
   * Commands of one server run in the order they were sent, different
   * servers run in parallel.
   */
  async tickCommands() {
    if (this.commandLoopInFlight) {
      this.tickRequested = true;
      return;
    }
    this.commandLoopInFlight = true;
    try {
      let claimedAny = false;
      do {
        this.tickRequested = false;
        const claimed = [];
        while (claimed.length < REMOTE_WORKER_MAX_COMMANDS_PER_TICK) {
          // Claims are atomic one by one; the batch runs in parallel below.
          // eslint-disable-next-line no-await-in-loop
          const command = await this.bridge.claimNextWorkerCommand(this.runtime.config.id);
          if (!command) break;
          claimed.push(command);
        }
        // A ring during an empty claim may belong to a command inserted just
        // after it: look once more instead of waiting for the fallback poll.
        if (!claimed.length) {
          if (this.tickRequested) continue;
          break;
        }
        claimedAny = true;

        const byGuild = new Map();
        for (const command of claimed) {
          const guildKey = String(command?.payload?.guildId || command?.commandId || "");
          if (!byGuild.has(guildKey)) byGuild.set(guildKey, []);
          byGuild.get(guildKey).push(command);
        }
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([...byGuild.values()].map(async (commands) => {
          for (const command of commands) {
            // eslint-disable-next-line no-await-in-loop
            await this.runClaimedCommand(command);
          }
        }));
        if (claimed.length >= REMOTE_WORKER_MAX_COMMANDS_PER_TICK) this.tickRequested = true;
      } while (this.tickRequested);
      if (claimedAny) await this.publishSnapshot().catch(() => null);
    } finally {
      this.commandLoopInFlight = false;
    }
  }

  getCommandPollMs() {
    return this.doorbell.isDoorbellConnected() ? REMOTE_WORKER_COMMAND_FALLBACK_POLL_MS : REMOTE_WORKER_COMMAND_POLL_MS;
  }

  async start() {
    await this.publishSnapshot();

    this.heartbeatTimer = setInterval(() => {
      this.publishSnapshot().catch((err) => {
        log("WARN", `[${this.runtime.config.name}] Worker-Bridge heartbeat fehlgeschlagen: ${err?.message || err}`);
      });
    }, REMOTE_WORKER_HEARTBEAT_MS);
    this.heartbeatTimer?.unref?.();

    const workerId = this.runtime.config.id;
    this.stopDoorbell = this.doorbell.onDoorbell(workerBridge.WORKER_COMMAND_TOPIC, (detail) => {
      if (detail?.workerId && detail.workerId !== workerId) return;
      this.tickCommands().catch((err) => {
        log("WARN", `[${this.runtime.config.name}] Worker-Bridge Klingel fehlgeschlagen: ${err?.message || err}`);
      });
    });

    this.commandTimer = setInterval(() => {
      this.tickCommands().catch((err) => {
        log("WARN", `[${this.runtime.config.name}] Worker-Bridge poll fehlgeschlagen: ${err?.message || err}`);
      });
    }, this.getCommandPollMs());
    this.commandTimer?.unref?.();
  }

  async stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.commandTimer) {
      clearInterval(this.commandTimer);
      this.commandTimer = null;
    }
    this.stopDoorbell?.();
    this.stopDoorbell = null;
    await this.bridge.clearWorkerSnapshot(this.runtime.config.id).catch(() => null);
  }
}

export { WorkerBridgeService, buildWorkerRuntimeMetrics, buildWorkerSnapshot };
