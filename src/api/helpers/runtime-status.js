// OmniFM API: what the bots report per server: live details, health and setup status.
// Split out of src/api/server.js (#293).
import { isRuntimePlaybackActive, isRuntimeVoiceConnected } from "../../bot/runtime-live-state.js";
import { clipText } from "../../lib/helpers.js";
import { getPlanLimits } from "../../core/entitlements.js";
import { listScheduledEvents } from "../../scheduled-events-store.js";

function sortDashboardRuntimes(runtimes) {
  return [...(Array.isArray(runtimes) ? runtimes : [])].sort((a, b) => {
    if (a.role === "commander" && b.role !== "commander") return -1;
    if (a.role !== "commander" && b.role === "commander") return 1;
    return Number(a?.config?.index || 0) - Number(b?.config?.index || 0);
  });
}

function getDashboardStatusSnapshot(runtime) {
  if (typeof runtime?.getDashboardStatus === "function") {
    return runtime.getDashboardStatus();
  }
  if (typeof runtime?.getPublicStatus === "function") {
    return runtime.getPublicStatus();
  }
  return {};
}

function buildDerivedDashboardGuildDetail(runtime, guildId) {
  const state = runtime?.guildState?.get?.(guildId);
  if (!state) return null;

  const guild = runtime?.client?.guilds?.cache?.get?.(guildId) || null;
  const reconnectAttempts = Number(state?.reconnectAttempts || 0) || 0;
  const streamErrorCount = Number(state?.streamErrorCount || 0) || 0;
  const playing = isRuntimePlaybackActive(runtime, guildId, state);
  const voiceConnected = isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true });
  const recovering = Boolean(
    state?.currentStationKey
    && state?.shouldReconnect === true
    && (!playing || state?.reconnectTimer || reconnectAttempts > 0)
  );
  if (!playing && !recovering && !state?.currentStationKey && !state?.lastChannelId) {
    return null;
  }

  let listenerCount = 0;
  if (playing && typeof runtime?.getCurrentListenerCount === "function") {
    try {
      listenerCount = Number(runtime.getCurrentListenerCount(guildId, state) || 0) || 0;
    } catch {
      listenerCount = 0;
    }
  }

  return {
    guildId,
    guildName: guild?.name || null,
    stationKey: state?.currentStationKey || null,
    stationName: state?.currentStationName || state?.currentStationKey || null,
    channelId: state?.lastChannelId || null,
    channelName: state?.lastChannelId ? guild?.channels?.cache?.get?.(state.lastChannelId)?.name || null : null,
    listenerCount,
    voiceConnected,
    playing,
    recovering,
    reconnectAttempts,
    streamErrorCount,
    shouldReconnect: state?.shouldReconnect === true,
    meta: state?.currentMeta || null,
    reconnectPending: Boolean(state?.reconnectTimer),
    reconnectInFlight: state?.reconnectInFlight === true,
    streamRestartPending: Boolean(state?.streamRestartTimer),
    voiceConnectInFlight: state?.voiceConnectInFlight === true,
    reconnectCount: Number(state?.reconnectCount || 0) || 0,
    lastReconnectAt: toDashboardIsoTime(state?.lastReconnectAt),
    lastStreamErrorAt: toDashboardIsoTime(state?.lastStreamErrorAt),
    lastProcessExitCode: state?.lastProcessExitCode ?? null,
    lastProcessExitDetail: state?.lastProcessExitDetail || null,
    lastProcessExitAt: toDashboardIsoTime(state?.lastProcessExitAt),
    lastStreamEndReason: state?.lastStreamEndReason || null,
    lastNetworkFailureAt: toDashboardIsoTime(state?.lastNetworkFailureAt),
    voiceDisconnectObservedAt: toDashboardIsoTime(state?.voiceDisconnectObservedAt),
    restoreBlockedUntil: toDashboardIsoTime(state?.restoreBlockedUntil),
    restoreBlockedAt: toDashboardIsoTime(state?.restoreBlockedAt),
    restoreBlockCount: Number(state?.restoreBlockCount || 0) || 0,
    restoreBlockReason: state?.restoreBlockReason || null,
    reconnectCircuitTripCount: Number(state?.reconnectCircuitTripCount || 0) || 0,
    reconnectCircuitOpenUntil: toDashboardIsoTime(state?.reconnectCircuitOpenUntil),
    networkRecoveryDelayMs: typeof runtime?.getNetworkRecoveryDelayMs === "function"
      ? Number(runtime.getNetworkRecoveryDelayMs(guildId) || 0) || 0
      : 0,
  };
}

function resolveDashboardGuildDetail(runtime, guildId, status = null) {
  const snapshot = status || getDashboardStatusSnapshot(runtime);
  const guildDetails = Array.isArray(snapshot?.guildDetails) ? snapshot.guildDetails : [];
  const detail = guildDetails.find((entry) => String(entry?.guildId || "") === String(guildId)) || null;
  return detail || buildDerivedDashboardGuildDetail(runtime, guildId);
}

function runtimeHasGuildContext(runtime, guildId, detail = null) {
  if (runtime?.client?.guilds?.cache?.has?.(guildId) === true) return true;
  return Boolean(detail);
}

export function resolveRuntimeForGuild(runtimes, guildId) {
  const sorted = sortDashboardRuntimes(runtimes);

  for (const runtime of sorted) {
    const guild = runtime?.client?.guilds?.cache?.get?.(guildId) || null;
    if (guild) return { runtime, guild };
  }

  return { runtime: sorted[0] || null, guild: null };
}

function toDashboardTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) {
    const parsedNumeric = Number.parseInt(text, 10);
    if (Number.isFinite(parsedNumeric) && parsedNumeric > 0) {
      return parsedNumeric;
    }
  }
  const parsedDate = Date.parse(text);
  return Number.isFinite(parsedDate) && parsedDate > 0 ? parsedDate : 0;
}

function toDashboardIsoTime(value) {
  const timestampMs = toDashboardTimeMs(value);
  return timestampMs > 0 ? new Date(timestampMs).toISOString() : null;
}

function getDashboardRemainingMs(value) {
  const timestampMs = toDashboardTimeMs(value);
  if (timestampMs <= 0) return 0;
  return Math.max(0, timestampMs - Date.now());
}

export function collectGuildLiveDetails(runtimes, guildId) {
  const rows = [];
  for (const runtime of runtimes) {
    if (typeof runtime?.getPublicStatus !== "function") continue;
    const status = getDashboardStatusSnapshot(runtime);
    const detail = resolveDashboardGuildDetail(runtime, guildId, status);
    if (!detail) continue;
    if (detail?.playing !== true && detail?.recovering !== true) continue;
    rows.push({
      botId: status.botId || status.id || null,
      botName: status.name || "Bot",
      stationKey: detail.stationKey || null,
      stationName: detail.stationName || detail.stationKey || "-",
      channelId: detail.channelId || null,
      channelName: detail.channelName || detail.channelId || "Voice",
      listeners: Number(detail.listenerCount || 0) || 0,
      reconnectAttempts: Number(detail.reconnectAttempts || 0) || 0,
      streamErrorCount: Number(detail.streamErrorCount || 0) || 0,
      recovering: detail?.recovering === true,
      shouldReconnect: detail.shouldReconnect === true,
      voiceGuardPolicy: detail?.voiceGuardPolicy || "default",
      voiceGuardEffectivePolicy: detail?.voiceGuardEffectivePolicy || null,
      voiceGuardLastAction: detail?.voiceGuardLastAction || null,
      voiceGuardLastActionAt: toDashboardIsoTime(detail?.voiceGuardLastActionAt),
      voiceGuardMoveCount: Number(detail?.voiceGuardMoveCount || 0) || 0,
      voiceGuardReturnCount: Number(detail?.voiceGuardReturnCount || 0) || 0,
      voiceGuardDisconnectCount: Number(detail?.voiceGuardDisconnectCount || 0) || 0,
      // What the stream list of the dashboard shows (#413).
      failoverActive: detail?.failoverActive === true,
      desiredStationKey: detail?.desiredStationKey || null,
      desiredStationName: detail?.desiredStationName || null,
      failoverFromStationName: detail?.failoverFromStationName || null,
      failbackNextProbeAt: Number(detail?.failbackNextProbeAt || 0) || 0,
      parkedReason: detail?.parkedReason || null,
      serverMuted: detail?.serverMuted === true,
      uptimeSec: Number(status?.uptimeSec || 0) || 0,
    });
  }
  return rows;
}

function collectGuildBotHealthRows(runtimes, guildId) {
  const rows = [];
  for (const runtime of sortDashboardRuntimes(runtimes)) {
    const status = getDashboardStatusSnapshot(runtime);
    const detail = resolveDashboardGuildDetail(runtime, guildId, status);
    if (!runtimeHasGuildContext(runtime, guildId, detail)) continue;

    const reconnectAttempts = Number(detail?.reconnectAttempts || 0) || 0;
    const streamErrorCount = Number(detail?.streamErrorCount || 0) || 0;
    const playing = detail?.playing === true;
    const recovering = detail?.recovering === true;
    const shouldReconnect = detail?.shouldReconnect === true;

    let botStatus = "idle";
    if (runtime?.client?.isReady?.() !== true) {
      botStatus = "offline";
    } else if (recovering) {
      botStatus = "recovering";
    } else if (playing && (reconnectAttempts > 0 || streamErrorCount > 0)) {
      botStatus = "degraded";
    } else if (playing) {
      botStatus = "streaming";
    }

    rows.push({
      botId: status?.botId || status?.id || runtime?.config?.id || null,
      botName: status?.name || runtime?.config?.name || "Bot",
      role: runtime?.role || status?.role || "worker",
      ready: runtime?.client?.isReady?.() === true,
      status: botStatus,
      playing,
      listeners: Number(detail?.listenerCount || 0) || 0,
      reconnectAttempts,
      streamErrorCount,
      recovering,
      shouldReconnect,
      channelId: detail?.channelId || null,
      channelName: detail?.channelName || detail?.channelId || null,
      stationKey: detail?.stationKey || null,
      stationName: detail?.stationName || detail?.stationKey || null,
      reconnectPending: detail?.reconnectPending === true,
      reconnectInFlight: detail?.reconnectInFlight === true,
      streamRestartPending: detail?.streamRestartPending === true,
      voiceConnectInFlight: detail?.voiceConnectInFlight === true,
      reconnectCount: Number(detail?.reconnectCount || 0) || 0,
      lastReconnectAt: toDashboardIsoTime(detail?.lastReconnectAt),
      lastStreamErrorAt: toDashboardIsoTime(detail?.lastStreamErrorAt),
      lastProcessExitCode: detail?.lastProcessExitCode ?? null,
      lastProcessExitDetail: detail?.lastProcessExitDetail || null,
      lastProcessExitAt: toDashboardIsoTime(detail?.lastProcessExitAt),
      lastStreamEndReason: detail?.lastStreamEndReason || null,
      lastNetworkFailureAt: toDashboardIsoTime(detail?.lastNetworkFailureAt),
      voiceDisconnectObservedAt: toDashboardIsoTime(detail?.voiceDisconnectObservedAt),
      restoreBlockedUntil: toDashboardIsoTime(detail?.restoreBlockedUntil),
      restoreBlockedAt: toDashboardIsoTime(detail?.restoreBlockedAt),
      restoreBlockCount: Number(detail?.restoreBlockCount || 0) || 0,
      restoreBlockReason: detail?.restoreBlockReason || null,
      restoreCooldownMs: getDashboardRemainingMs(detail?.restoreBlockedUntil),
      reconnectCircuitTripCount: Number(detail?.reconnectCircuitTripCount || 0) || 0,
      reconnectCircuitOpenUntil: toDashboardIsoTime(detail?.reconnectCircuitOpenUntil),
      reconnectCircuitRemainingMs: getDashboardRemainingMs(detail?.reconnectCircuitOpenUntil),
      networkRecoveryDelayMs: Number(detail?.networkRecoveryDelayMs || 0) || 0,
      voiceGuardPolicy: detail?.voiceGuardPolicy || "default",
      voiceGuardEffectivePolicy: detail?.voiceGuardEffectivePolicy || null,
      voiceGuardUnlockUntil: toDashboardIsoTime(detail?.voiceGuardUnlockUntil),
      voiceGuardCooldownUntil: toDashboardIsoTime(detail?.voiceGuardCooldownUntil),
      voiceGuardUnlockRemainingMs: getDashboardRemainingMs(detail?.voiceGuardUnlockUntil),
      voiceGuardCooldownRemainingMs: getDashboardRemainingMs(detail?.voiceGuardCooldownUntil),
      voiceGuardMoveCount: Number(detail?.voiceGuardMoveCount || 0) || 0,
      voiceGuardWindowMoveCount: Number(detail?.voiceGuardWindowMoveCount || 0) || 0,
      voiceGuardReturnCount: Number(detail?.voiceGuardReturnCount || 0) || 0,
      voiceGuardDisconnectCount: Number(detail?.voiceGuardDisconnectCount || 0) || 0,
      voiceGuardEscalationCount: Number(detail?.voiceGuardEscalationCount || 0) || 0,
      voiceGuardLastAction: detail?.voiceGuardLastAction || null,
      voiceGuardLastActionAt: toDashboardIsoTime(detail?.voiceGuardLastActionAt),
      voiceGuardLastActionReason: detail?.voiceGuardLastActionReason || null,
      voiceGuardLastExpectedChannelId: detail?.voiceGuardLastExpectedChannelId || null,
      voiceGuardLastActualChannelId: detail?.voiceGuardLastActualChannelId || null,
    });
  }
  return rows;
}

export function buildDashboardHealthSummary(serverId, runtimes, {
  liveRows = null,
  listenersNow = null,
  activeStreams = null,
  events = null,
  incidents = null,
} = {}) {
  const botRows = collectGuildBotHealthRows(runtimes, serverId);
  const activeLiveRows = Array.isArray(liveRows) ? liveRows : collectGuildLiveDetails(runtimes, serverId);
  const eventRows = Array.isArray(events) ? events : listScheduledEvents({ guildId: serverId });
  const recentIncidents = Array.isArray(incidents) ? incidents : [];
  const enabledEvents = eventRows.filter((entry) => entry?.enabled !== false);
  const nextEvent = enabledEvents
    .filter((entry) => Number.parseInt(String(entry?.runAtMs || 0), 10) > Date.now())
    .sort((a, b) => Number.parseInt(String(a?.runAtMs || 0), 10) - Number.parseInt(String(b?.runAtMs || 0), 10))[0] || null;

  const managedBots = botRows.length;
  const readyBots = botRows.filter((row) => row.ready).length;
  const liveStreamCount = Number(activeStreams ?? activeLiveRows.length) || 0;
  const activeVoiceChannels = new Set(
    activeLiveRows.map((row) => String(row?.channelId || row?.channelName || "").trim()).filter(Boolean)
  ).size;
  const recoveringStreams = activeLiveRows.filter((row) => row?.recovering === true).length;
  const degradedStreams = activeLiveRows.filter((row) => {
    if (row?.recovering === true) return false;
    const reconnectAttempts = Number(row?.reconnectAttempts || 0) || 0;
    const streamErrors = Number(row?.streamErrorCount || 0) || 0;
    return reconnectAttempts > 0 || streamErrors > 0;
  }).length;
  const reconnectAttempts = activeLiveRows.reduce((sum, row) => sum + (Number(row?.reconnectAttempts || 0) || 0), 0);
  const streamErrors = activeLiveRows.reduce((sum, row) => sum + (Number(row?.streamErrorCount || 0) || 0), 0);
  const unavailableBots = Math.max(0, managedBots - readyBots);

  let status = "healthy";
  if (managedBots <= 0 || (readyBots <= 0 && managedBots > 0)) {
    status = "critical";
  } else if (unavailableBots > 0 || recoveringStreams > 0 || degradedStreams > 0) {
    status = "warning";
  }

  const alerts = [];
  if (managedBots <= 0) {
    alerts.push({ code: "no_bot_available", severity: "critical", count: 1 });
  } else if (unavailableBots > 0) {
    alerts.push({
      code: "bot_unavailable",
      severity: readyBots <= 0 ? "critical" : "warning",
      count: unavailableBots,
    });
  }
  if (recoveringStreams > 0) {
    alerts.push({ code: "stream_recovering", severity: "warning", count: recoveringStreams });
  }
  if (degradedStreams > 0) {
    alerts.push({
      code: "stream_unstable",
      severity: streamErrors >= 3 ? "critical" : "warning",
      count: degradedStreams,
    });
  }

  return {
    status,
    managedBots,
    readyBots,
    unavailableBots,
    liveStreams: liveStreamCount,
    activeVoiceChannels,
    listenersNow: Number(listenersNow ?? 0) || 0,
    recoveringStreams,
    degradedStreams,
    reconnectAttempts,
    streamErrors,
    eventsConfigured: eventRows.length,
    eventsActive: enabledEvents.length,
    nextEventAt: nextEvent?.runAtMs ? new Date(Number(nextEvent.runAtMs)).toISOString() : null,
    nextEventTitle: clipText(nextEvent?.name || "", 120) || null,
    alerts,
    incidents: recentIncidents,
    bots: botRows,
  };
}

export function buildDashboardSetupStatus(serverId, tier, runtimes, {
  liveRows = null,
} = {}) {
  const safeServerId = String(serverId || "").trim();
  const safeTier = String(tier || "free").trim().toLowerCase() || "free";
  const maxWorkerSlots = Math.max(0, Number(getPlanLimits(safeTier)?.maxBots || 0) || 0);
  const activeLiveRows = Array.isArray(liveRows) ? liveRows : collectGuildLiveDetails(runtimes, safeServerId);
  const activeStreamCount = activeLiveRows.length;
  const commanderRuntime = sortDashboardRuntimes(runtimes).find((runtime) => String(runtime?.role || "").trim() === "commander") || null;
  const commanderReady = Boolean(
    commanderRuntime?.client?.isReady?.() === true
    && commanderRuntime?.client?.guilds?.cache?.has?.(safeServerId)
  );

  const invitedWorkerCount = sortDashboardRuntimes(runtimes)
    .filter((runtime) => String(runtime?.role || "").trim() !== "commander")
    .filter((runtime) => {
      const workerSlot = Number(runtime?.workerSlot || runtime?.config?.index || 0) || 0;
      if (!workerSlot || workerSlot > maxWorkerSlots) return false;
      const detail = resolveDashboardGuildDetail(runtime, safeServerId);
      return runtimeHasGuildContext(runtime, safeServerId, detail);
    })
    .length;

  const workerInvited = invitedWorkerCount > 0;
  const firstStreamLive = activeStreamCount > 0;

  return {
    commanderReady,
    workerInvited,
    invitedWorkerCount,
    maxWorkerSlots,
    activeStreamCount,
    firstStreamLive,
    completedSteps: [commanderReady, workerInvited, firstStreamLive].filter(Boolean).length,
  };
}

export async function buildGuildChannelNameMap(guild, channelIds = []) {
  const uniqueIds = [...new Set((Array.isArray(channelIds) ? channelIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!guild || !uniqueIds.length) return {};

  try {
    if (typeof guild.channels?.fetch === "function") {
      await guild.channels.fetch();
    }
  } catch {
    // Ignore channel fetch failures and fall back to cached names only.
  }

  return uniqueIds.reduce((map, channelId) => {
    const channel = guild.channels?.cache?.get?.(channelId) || null;
    if (channel?.name) {
      map[channelId] = channel.name;
    }
    return map;
  }, {});
}

export async function resolveGuildTextChannel(guild, channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  if (!guild || !normalizedChannelId) return null;

  let channel = guild.channels?.cache?.get?.(normalizedChannelId) || null;
  if (channel) return channel;

  try {
    if (typeof guild.channels?.fetch === "function") {
      channel = await guild.channels.fetch(normalizedChannelId);
    }
  } catch {
    channel = null;
  }

  return channel || null;
}
