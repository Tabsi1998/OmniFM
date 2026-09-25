function normalizeChannelId(value) {
  return String(value || "").trim();
}

// `configuredChannelId`: the panel channel chosen in the setup (#271).
function getNowPlayingCandidateIds(state = {}, guild = null, { configuredChannelId = null } = {}) {
  const candidateIds = [
    configuredChannelId,
    state?.connection?.joinConfig?.channelId,
    state?.lastChannelId,
    state?.nowPlayingChannelId,
    guild?.systemChannelId,
  ];

  return [...new Set(candidateIds.map(normalizeChannelId).filter(Boolean))];
}

function buildNowPlayingSignature(stationKey, meta = {}, state = {}, targetChannelId = null) {
  return [
    stationKey,
    meta?.displayTitle || "",
    meta?.artist || "",
    meta?.title || "",
    meta?.artworkUrl || "",
    meta?.album || "",
    meta?.metadataStatus || "",
    meta?.metadataSource || "",
    meta?.musicBrainzRecordingId || "",
    meta?.musicBrainzReleaseId || "",
    state?.connection?.joinConfig?.channelId || state?.lastChannelId || "",
    normalizeChannelId(targetChannelId),
    // The embed shows a hint and buttons for these, so a change must re-render it.
    state?.failoverActive === true ? `failover:${state?.desiredStationKey || ""}` : "",
    state?.serverMuted === true ? "server-muted" : "",
  ].join("|").toLowerCase();
}

export {
  buildNowPlayingSignature,
  getNowPlayingCandidateIds,
};
