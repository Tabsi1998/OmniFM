function normalizeChannelId(value) {
  return String(value || "").trim();
}

function getNowPlayingCandidateIds(state = {}, guild = null) {
  const candidateIds = [
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
