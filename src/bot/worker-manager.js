// ============================================================
// OmniFM: Worker Manager - Worker Assignment & Coordination
// ============================================================
import { TIERS } from "../lib/helpers.js";

function hasReservedPlaybackState(state) {
  return Boolean(
    state?.currentStationKey
    && (
      state?.connection
      || state?.currentProcess
      || state?.voiceConnectInFlight
      || state?.reconnectInFlight
      || state?.reconnectTimer
      || (state?.shouldReconnect && state?.lastChannelId)
    )
  );
}

function isRecoveringPlaybackState(state) {
  return Boolean(
    state?.currentStationKey
    && state?.shouldReconnect
    && (
      !state?.connection
      || state?.reconnectTimer
      || state?.reconnectInFlight
      || state?.voiceConnectInFlight
    )
  );
}

function getOwnedChannelId(state) {
  return String(state?.connection?.joinConfig?.channelId || state?.lastChannelId || "").trim();
}

class WorkerManager {
  /**
   * @param {BotRuntime[]} workers - Worker bot instances
   */
  constructor(workers = [], options = {}) {
    this.workers = [...workers].sort((a, b) => Number(a?.config?.index || 0) - Number(b?.config?.index || 0));
    this.statusProvider = options?.statusProvider || null;
    this.remoteRefreshIntervalMs = Math.max(500, Number(options?.remoteRefreshIntervalMs || process.env.REMOTE_WORKER_STATUS_POLL_MS || 2000) || 2000);
    this.lastRemoteRefreshAt = 0;
    this.remoteRefreshInFlight = null;
    this.remoteRefreshTimer = null;
    this.workers.forEach((worker, idx) => {
      if (worker) {
        worker.workerSlot = idx + 1;
      }
    });
  }

  /**
   * Get the max worker index allowed for a tier.
   * Free: 1-2, Pro: 1-8, Ultimate: 1-16
   */
  getMaxWorkerIndex(tier) {
    const t = String(tier || "free").toLowerCase();
    return TIERS[t]?.maxBots ?? 2;
  }

  /**
   * Resolve worker slot (1-based) for a runtime instance.
   */
  getWorkerSlot(workerRuntime) {
    const idx = this.workers.findIndex((w) => w === workerRuntime);
    return idx >= 0 ? idx + 1 : null;
  }

  /**
   * Resolve worker by slot number (1-based).
   */
  getWorkerBySlot(slot) {
    const workerSlot = Number.parseInt(String(slot || ""), 10);
    if (!Number.isFinite(workerSlot) || workerSlot < 1) return null;
    return this.workers[workerSlot - 1] || null;
  }

  /**
   * Resolve worker by absolute BOT_N index from config.
   */
  getWorkerByBotIndex(botIndex) {
    const botIdx = Number.parseInt(String(botIndex || ""), 10);
    if (!Number.isFinite(botIdx) || botIdx < 1) return null;
    return this.workers.find((w) => Number(w?.config?.index || 0) === botIdx) || null;
  }

  /**
   * Resolve input index to worker + slot.
   * Slot mode is used by internal worker menus; botIndex mode is used by slash `bot:` options.
   */
  resolveWorker(inputIndex, options = {}) {
    const prefer = String(options?.prefer || "slot").trim() === "botIndex" ? "botIndex" : "slot";
    const resolvers = prefer === "botIndex"
      ? [
        () => this.getWorkerByBotIndex(inputIndex),
      ]
      : [
        () => this.getWorkerBySlot(inputIndex),
        () => this.getWorkerByBotIndex(inputIndex),
      ];

    for (const resolve of resolvers) {
      const worker = resolve();
      if (!worker) continue;
      return {
        worker,
        workerSlot: this.getWorkerSlot(worker),
        mode: Number(worker?.config?.index || 0) === Number.parseInt(String(inputIndex || ""), 10)
          ? "botIndex"
          : "slot",
      };
    }
    return null;
  }

  /**
   * Get workers available for a guild based on tier.
   * A worker is available if:
   * 1. Its index is within the tier's max (Free: 1-2, Pro: 1-8, Ultimate: 1-16)
   * 2. The worker's Discord client is in the guild (invited)
   * 3. The worker is not already streaming in this guild
   */
  getAvailableWorkers(guildId, tier = "free") {
    const maxIndex = this.getMaxWorkerIndex(tier);
    return this.workers.filter((w) => {
      const workerSlot = this.getWorkerSlot(w);
      if (!workerSlot || workerSlot > maxIndex) return false;
      if (!w.client?.isReady()) return false;
      if (!w.client.guilds.cache.has(guildId)) return false;
      const state = w.guildState.get(guildId);
      if (hasReservedPlaybackState(state)) return false;
      return true;
    });
  }

  /**
   * Get all workers that are invited to a guild (regardless of streaming state).
   */
  getInvitedWorkers(guildId, tier = null) {
    const maxIndex = tier ? this.getMaxWorkerIndex(tier) : Number.POSITIVE_INFINITY;
    return this.workers.filter((w) => {
      const workerSlot = this.getWorkerSlot(w);
      if (!workerSlot || workerSlot > maxIndex) return false;
      if (!w.client?.isReady()) return false;
      return w.client.guilds.cache.has(guildId);
    });
  }

  /**
   * Find the best free worker for a guild.
   * Prefers lowest index that is available.
   */
  findFreeWorker(guildId, tier = "free") {
    const available = this.getAvailableWorkers(guildId, tier);
    if (available.length === 0) return null;
    available.sort((a, b) => Number(this.getWorkerSlot(a) || 0) - Number(this.getWorkerSlot(b) || 0));
    return available[0];
  }

  /**
   * Get a specific worker by slot (preferred) or BOT_N index (fallback).
   */
  getWorkerByIndex(index, options = {}) {
    return this.resolveWorker(index, options)?.worker || null;
  }

  async refreshRemoteStates({ force = false } = {}) {
    if (!this.statusProvider || typeof this.statusProvider.listStatuses !== "function") {
      return this.workers;
    }

    const now = Date.now();
    if (!force && this.lastRemoteRefreshAt > 0 && (now - this.lastRemoteRefreshAt) < this.remoteRefreshIntervalMs) {
      return this.workers;
    }

    if (this.remoteRefreshInFlight) {
      return this.remoteRefreshInFlight;
    }

    this.remoteRefreshInFlight = (async () => {
      try {
        const workerIds = this.workers
          .map((worker) => String(worker?.config?.id || "").trim())
          .filter(Boolean);
        const docs = await this.statusProvider.listStatuses({ workerIds });
        const docMap = new Map(
          (Array.isArray(docs) ? docs : []).map((doc) => [String(doc?.workerId || "").trim(), doc])
        );

        for (const worker of this.workers) {
          if (typeof worker?.applyRemoteStatus !== "function") continue;
          const workerId = String(worker?.config?.id || "").trim();
          worker.applyRemoteStatus(docMap.get(workerId) || null);
        }

        this.lastRemoteRefreshAt = Date.now();
        return this.workers;
      } finally {
        this.remoteRefreshInFlight = null;
      }
    })();

    return this.remoteRefreshInFlight;
  }

  startRemotePolling() {
    if (!this.statusProvider || typeof this.statusProvider.listStatuses !== "function") return;
    if (this.remoteRefreshTimer) return;
    this.remoteRefreshTimer = setInterval(() => {
      this.refreshRemoteStates().catch(() => null);
    }, this.remoteRefreshIntervalMs);
    this.remoteRefreshTimer?.unref?.();
  }

  stopRemotePolling() {
    if (!this.remoteRefreshTimer) return;
    clearInterval(this.remoteRefreshTimer);
    this.remoteRefreshTimer = null;
  }

  /**
   * Get the worker currently streaming in a guild.
   * Returns the first worker found streaming (there should be at most one per user expectation,
   * but multiple are possible if users manually assigned different workers).
   */
  getStreamingWorkers(guildId) {
    return this.workers.filter((w) => {
      const state = w.guildState.get(guildId);
      return hasReservedPlaybackState(state);
    });
  }

  /**
   * Find the worker currently streaming inside a specific voice/stage channel.
   */
  findStreamingWorkerByChannel(guildId, channelId) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return null;
    return this.workers.find((worker) => {
      const state = worker.guildState.get(guildId);
      if (!hasReservedPlaybackState(state)) return false;
      const activeChannelId = getOwnedChannelId(state);
      return activeChannelId === normalizedChannelId;
    }) || null;
  }

  /**
   * Find a worker whose bot account is currently connected to a specific voice/stage channel,
   * even if the local runtime state is stale.
   */
  async findConnectedWorkerByChannel(guildId, channelId, tier = null) {
    const normalizedGuildId = String(guildId || "").trim();
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedGuildId || !normalizedChannelId) return null;

    const maxIndex = tier ? this.getMaxWorkerIndex(tier) : Number.POSITIVE_INFINITY;
    for (const worker of this.workers) {
      const workerSlot = this.getWorkerSlot(worker);
      if (!workerSlot || workerSlot > maxIndex) continue;
      if (!worker.client?.isReady()) continue;
      const state = worker.guildState.get(normalizedGuildId);
      if (hasReservedPlaybackState(state) && getOwnedChannelId(state) === normalizedChannelId) {
        return worker;
      }

      const guild = worker.client.guilds.cache.get(normalizedGuildId)
        || await worker.client.guilds.fetch(normalizedGuildId).catch(() => null);
      if (!guild) continue;

      const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
      const activeChannelId = String(me?.voice?.channelId || "").trim();
      if (activeChannelId && activeChannelId === normalizedChannelId) {
        return worker;
      }
    }

    return null;
  }

  /**
   * Find the worker that currently owns a scheduled event playback in a guild.
   */
  findWorkerByScheduledEvent(guildId, eventId) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) return null;
    return this.workers.find((worker) => {
      const state = worker.guildState.get(guildId);
      return String(state?.activeScheduledEventId || "").trim() === normalizedEventId;
    }) || null;
  }

  /**
   * Get all worker statuses for the API / web display.
   */
  getAllStatuses() {
    return this.workers.map((w) => {
      const slot = this.getWorkerSlot(w);
      const botIndex = Number(w?.config?.index || 0) || null;
      const guilds = [];
      if (w.client?.isReady()) {
        for (const [guildId, state] of w.guildState.entries()) {
          if (hasReservedPlaybackState(state)) {
            const guild = w.client.guilds.cache.get(guildId);
            guilds.push({
              guildId,
              guildName: guild?.name || "Unknown",
              stationKey: state.currentStationKey || null,
              stationName: state.currentStationName || null,
              channelId: state.lastChannelId || null,
              recovering: isRecoveringPlaybackState(state),
            });
          }
        }
      }

      return {
        index: slot,
        botIndex,
        name: w.config.name,
        online: Boolean(w.client?.isReady()),
        totalGuilds: w.client?.isReady() ? w.client.guilds.cache.size : 0,
        activeStreams: guilds.length,
        streams: guilds,
        clientId: w.getApplicationId() || w.config.clientId || "",
      };
    });
  }

  /**
   * Check if a specific worker can be used in a guild for a given tier.
   */
  canUseWorker(workerIndex, guildId, tier = "free", options = {}) {
    const maxIndex = this.getMaxWorkerIndex(tier);
    const resolved = this.resolveWorker(workerIndex, options);
    if (!resolved) {
      return { ok: false, reason: "not_configured", maxIndex };
    }
    const workerSlot = Number(resolved.workerSlot || 0);
    if (!workerSlot || workerSlot > maxIndex) {
      return { ok: false, reason: "tier", maxIndex, workerSlot, worker: resolved.worker, mode: resolved.mode };
    }
    const worker = resolved.worker;
    if (!worker.client?.isReady()) {
      return { ok: false, reason: "offline" };
    }
    if (!worker.client.guilds.cache.has(guildId)) {
      return { ok: false, reason: "not_invited" };
    }
    return { ok: true, worker, workerSlot, mode: resolved.mode };
  }
}

export { WorkerManager };
