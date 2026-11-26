import { AudioPlayerStatus } from "@discordjs/voice";

// Since when a voice connection waits in signalling or connecting (#605), per
// connection object: the stamp of an earlier connection, or of a join that
// failed, never makes a later one look stuck.
const voiceConnectionNotReadySince = new WeakMap();
const NOT_READY_VOICE_STATUSES = new Set(["signalling", "connecting"]);

/**
 * Notes a connection's status and returns since when it is not ready (0 while
 * it is ready or in another state). Ready stops the clock; signalling or
 * connecting starts it once.
 */
export function noteVoiceConnectionStatus(connection, status, nowMs = Date.now()) {
  if (!connection || typeof connection !== "object") return 0;
  if (status === "ready") {
    voiceConnectionNotReadySince.delete(connection);
    return 0;
  }
  if (!NOT_READY_VOICE_STATUSES.has(status)) return 0;
  if (!voiceConnectionNotReadySince.has(connection)) voiceConnectionNotReadySince.set(connection, nowMs);
  return voiceConnectionNotReadySince.get(connection);
}

function normalizeChannelId(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function getRuntimeGuild(runtime, guildId) {
  const normalizedGuildId = String(guildId || "").trim();
  if (!normalizedGuildId) return null;
  return runtime?.client?.guilds?.cache?.get?.(normalizedGuildId) || null;
}

export function getRuntimeObservedVoiceChannelId(runtime, guildId) {
  const guild = getRuntimeGuild(runtime, guildId);
  if (!guild) return "";

  const memberChannelId = normalizeChannelId(guild?.members?.me?.voice?.channelId);
  if (memberChannelId) return memberChannelId;

  const userId = normalizeChannelId(runtime?.client?.user?.id);
  if (!userId) return "";

  return normalizeChannelId(guild?.voiceStates?.cache?.get?.(userId)?.channelId);
}

export function getRuntimeConnectedChannelId(runtime, guildId, state = null, {
  includeObserved = true,
  includeLastKnown = false,
} = {}) {
  const connectionChannelId = normalizeChannelId(state?.connection?.joinConfig?.channelId);
  if (connectionChannelId) return connectionChannelId;

  if (includeObserved) {
    const observedChannelId = getRuntimeObservedVoiceChannelId(runtime, guildId);
    if (observedChannelId) return observedChannelId;
  }

  return includeLastKnown ? normalizeChannelId(state?.lastChannelId) : "";
}

export function isRuntimeVoiceConnected(runtime, guildId, state = null, options = {}) {
  if (state?.connection) return true;
  return Boolean(getRuntimeConnectedChannelId(runtime, guildId, state, options));
}

export function isRuntimePlayerActive(state = null) {
  if (state?.currentProcess) return true;
  const playerStatus = String(state?.player?.state?.status || "").trim().toLowerCase();
  return Boolean(playerStatus && playerStatus !== String(AudioPlayerStatus.Idle).toLowerCase());
}

export function isRuntimePlaybackActive(runtime, guildId, state = null) {
  if (!state?.currentStationKey) return false;
  if (state?.connection) return true;
  if (!isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true })) return false;
  return isRuntimePlayerActive(state);
}
