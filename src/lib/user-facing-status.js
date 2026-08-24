function clampNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRuntimeStatusInput(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  return {
    ready: input.ready !== false,
    connected: input.connected === true,
    playing: input.playing === true || input.connected === true,
    shouldReconnect: input.shouldReconnect === true,
    reconnectPending: input.reconnectPending === true,
    reconnectInFlight: input.reconnectInFlight === true,
    streamRestartPending: input.streamRestartPending === true,
    voiceConnectInFlight: input.voiceConnectInFlight === true,
    reconnectAttempts: Math.max(0, clampNumber(input.reconnectAttempts)),
    streamErrorCount: Math.max(0, clampNumber(input.streamErrorCount)),
    listeners: Math.max(0, clampNumber(input.listeners)),
    stationName: String(input.stationName || input.stationKey || "").trim() || null,
    channelLabel: String(input.channelLabel || "").trim() || null,
    voiceGuardLastAction: String(input.voiceGuardLastAction || "").trim().toLowerCase() || null,
  };
}

function buildUserFacingRuntimeStatus(source = {}, { t = (de, en) => de } = {}) {
  const status = normalizeRuntimeStatusInput(source);
  const playbackBits = [];
  if (status.stationName) playbackBits.push(status.stationName);
  if (status.channelLabel) playbackBits.push(status.channelLabel);
  if (status.listeners > 0) {
    playbackBits.push(t(`${status.listeners} Zuhoerer`, `${status.listeners} listeners`));
  }

  if (!status.ready) {
    return {
      code: "unavailable",
      label: t("Voruebergehend nicht verfuegbar", "Temporarily unavailable"),
      accent: 0xEF4444,
      summary: t(
        "Dieser Bot ist gerade nicht bereit. Bitte versuche es gleich noch einmal.",
        "This bot is not ready right now. Please try again in a moment."
      ),
      playback: playbackBits.join(" | ") || t("Keine aktive Wiedergabe", "No active playback"),
      nextStep: t("Es ist gerade keine Aktion auf dem Server noetig.", "No action is needed on the server right now."),
    };
  }

  if (status.voiceGuardLastAction === "return") {
    return {
      code: "restoring-channel",
      label: t("Stellt Kanal wieder her", "Restoring channel"),
      accent: 0xF59E0B,
      summary: t(
        "OmniFM kehrt gerade in den vorgesehenen Sprachkanal zurueck.",
        "OmniFM is returning to the intended voice channel right now."
      ),
      playback: playbackBits.join(" | ") || t("Wiedergabe wird abgesichert", "Playback is being protected"),
      nextStep: t("Kein Eingreifen noetig.", "No action is needed."),
    };
  }

  if (
    status.voiceConnectInFlight
    || status.reconnectInFlight
    || status.reconnectPending
    || status.streamRestartPending
    || (status.shouldReconnect && !status.connected)
  ) {
    return {
      code: "recovering",
      label: t("Verbindet", "Connecting"),
      accent: 0xF59E0B,
      summary: t(
        "OmniFM stellt die Wiedergabe gerade automatisch wieder her.",
        "OmniFM is automatically restoring playback right now."
      ),
      playback: playbackBits.join(" | ") || t("Wiedergabe wird vorbereitet", "Playback is being prepared"),
      nextStep: t("Bitte kurz abwarten.", "Please wait a moment."),
    };
  }

  if (status.connected && (status.reconnectAttempts > 0 || status.streamErrorCount > 0)) {
    return {
      code: "stabilizing",
      label: t("Stabilisiert sich", "Stabilizing"),
      accent: 0xF59E0B,
      summary: t(
        "Die Wiedergabe laeuft, wird aber gerade noch stabilisiert.",
        "Playback is running, but it is still being stabilized."
      ),
      playback: playbackBits.join(" | ") || t("Aktive Wiedergabe", "Active playback"),
      nextStep: t("Normalerweise ist kein Eingreifen noetig.", "Normally no action is needed."),
    };
  }

  if (status.connected || status.playing) {
    return {
      code: "live",
      label: t("Live", "Live"),
      accent: 0x10B981,
      summary: t(
        "OmniFM spielt aktuell ohne bekannte Stoerung.",
        "OmniFM is currently playing without a known issue."
      ),
      playback: playbackBits.join(" | ") || t("Aktive Wiedergabe", "Active playback"),
      nextStep: t("Alles laeuft normal.", "Everything is running normally."),
    };
  }

  return {
    code: "ready",
    label: t("Bereit", "Ready"),
    accent: 0x00E5FF,
    summary: t(
      "OmniFM ist bereit fuer den naechsten Start auf diesem Server.",
      "OmniFM is ready for the next start on this server."
    ),
    playback: playbackBits.join(" | ") || t("Noch keine aktive Wiedergabe", "No active playback yet"),
    nextStep: t("Nutze /play, um einen Stream zu starten.", "Use /play to start a stream."),
  };
}

export {
  buildUserFacingRuntimeStatus,
};
