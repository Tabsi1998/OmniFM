import os from "node:os";

import {
  claimNextWorkerCommand,
  clearWorkerSnapshot,
  completeWorkerCommand,
  failWorkerCommand,
  publishWorkerSnapshot,
} from "../core/worker-bridge.js";
import { log } from "../lib/logging.js";

const REMOTE_WORKER_HEARTBEAT_MS = Math.max(2_000, Number.parseInt(String(process.env.REMOTE_WORKER_HEARTBEAT_MS || "5000"), 10) || 5_000);
const REMOTE_WORKER_COMMAND_POLL_MS = Math.max(250, Number.parseInt(String(process.env.REMOTE_WORKER_COMMAND_POLL_MS || "1000"), 10) || 1_000);

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
  constructor(runtime) {
    this.runtime = runtime;
    this.heartbeatTimer = null;
    this.commandTimer = null;
    this.commandLoopInFlight = false;
  }

  async publishSnapshot() {
    await publishWorkerSnapshot(this.runtime.config.id, buildWorkerSnapshot(this.runtime));
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

  async tickCommands() {
    if (this.commandLoopInFlight) return;
    this.commandLoopInFlight = true;
    try {
      const command = await claimNextWorkerCommand(this.runtime.config.id);
      if (!command) return;

      try {
        const result = await this.executeCommand(command);
        await this.publishSnapshot().catch((err) => {
          log("WARN", `[${this.runtime.config.name}] Worker-Bridge Snapshot nach Command fehlgeschlagen: ${err?.message || err}`);
        });
        await completeWorkerCommand(command.commandId, result || { ok: true });
      } catch (err) {
        await failWorkerCommand(command.commandId, err);
        log("ERROR", `[${this.runtime.config.name}] Worker-Bridge command failed (${command?.type || "-"}) guild=${command?.payload?.guildId || "-"}: ${err?.message || err}`);
      } finally {
        await this.publishSnapshot().catch(() => null);
      }
    } finally {
      this.commandLoopInFlight = false;
    }
  }

  async start() {
    await this.publishSnapshot();

    this.heartbeatTimer = setInterval(() => {
      this.publishSnapshot().catch((err) => {
        log("WARN", `[${this.runtime.config.name}] Worker-Bridge heartbeat fehlgeschlagen: ${err?.message || err}`);
      });
    }, REMOTE_WORKER_HEARTBEAT_MS);
    this.heartbeatTimer?.unref?.();

    this.commandTimer = setInterval(() => {
      this.tickCommands().catch((err) => {
        log("WARN", `[${this.runtime.config.name}] Worker-Bridge poll fehlgeschlagen: ${err?.message || err}`);
      });
    }, REMOTE_WORKER_COMMAND_POLL_MS);
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
    await clearWorkerSnapshot(this.runtime.config.id).catch(() => null);
  }
}

export { WorkerBridgeService, buildWorkerSnapshot };
