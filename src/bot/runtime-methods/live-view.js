// OmniFM: the dashboard's two buttons of the live view (#304). Both keep the
// server's station and channel; they only kick the playback loose, the way
// the runtime's own recovery does.
export const liveViewMethods = {
  /** "Sender neu starten": the stream of the current station starts again. */
  async restartStationFromDashboard(guildId) {
    const state = this.getState(guildId);
    if (!state?.currentStationKey || !state.shouldReconnect) return { ok: false, error: "not-playing" };
    if (state.streamRestartInFlight === true || state.reconnectInFlight || state.voiceConnectInFlight) return { ok: false, error: "busy" };
    await this.restartCurrentStation(state, guildId);
    return { ok: true };
  },

  /** "Neu verbinden": leaves the voice channel and joins it again, the station stays. */
  async reconnectVoiceFromDashboard(guildId) {
    const state = this.getState(guildId);
    if (!state?.shouldReconnect || !state.lastChannelId) return { ok: false, error: "not-playing" };
    if (state.reconnectInFlight || state.voiceConnectInFlight) return { ok: false, error: "busy" };
    this.resetVoiceSession(guildId, state, { preservePlaybackTarget: true, clearLastChannel: false });
    this.scheduleReconnect(guildId, { reason: "dashboard", resetAttempts: true });
    return { ok: true };
  },
};
