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
    parkedReason: String(input.parkedReason || "").trim().toLowerCase() || null,
    serverMuted: input.serverMuted === true,
    failoverActive: input.failoverActive === true,
    desiredStationName: String(input.desiredStationName || "").trim() || null,
    failbackNextProbeAt: Math.max(0, clampNumber(input.failbackNextProbeAt)),
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

  if (status.serverMuted && status.connected) {
    return {
      code: "muted",
      label: t("Stummgeschaltet", "Server-muted"),
      accent: 0xEF4444,
      summary: t(
        "OmniFM ist im Sprachkanal, aber auf diesem Server stummgeschaltet. Niemand hoert den Stream.",
        "OmniFM is in the voice channel but server-muted, so nobody hears the stream."
      ),
      playback: playbackBits.join(" | ") || t("Wiedergabe laeuft stumm", "Playback runs muted"),
      nextStep: t(
        "Rechtsklick auf OmniFM im Sprachkanal und die Server-Stummschaltung aufheben.",
        "Right-click OmniFM in the voice channel and remove the server mute."
      ),
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

  if (status.parkedReason && !status.connected) {
    const permissionsMissing = status.parkedReason === "permissions";
    return {
      code: "parked",
      label: t("Wartet auf Rueckkehr", "Waiting to return"),
      accent: 0xF97316,
      summary: permissionsMissing
        ? t(
          "OmniFM darf den Sprachkanal gerade nicht betreten (Verbinden oder Sprechen fehlt). Sender und Kanal bleiben gemerkt.",
          "OmniFM is not allowed to join the voice channel right now (Connect or Speak is missing). Station and channel stay saved."
        )
        : t(
          "Der Sprachkanal war laengere Zeit nicht erreichbar. OmniFM probiert es alle paar Minuten weiter, Sender und Kanal bleiben gemerkt.",
          "The voice channel was unreachable for a longer time. OmniFM keeps trying every few minutes, station and channel stay saved."
        ),
      playback: playbackBits.join(" | ") || t("Wiedergabe pausiert bis zur Rueckkehr", "Playback paused until the return"),
      nextStep: permissionsMissing
        ? t(
          "Gib OmniFM im Kanal 'Verbinden' und 'Sprechen', dann kehrt der Bot von selbst zurueck. /play startet sofort.",
          "Grant OmniFM 'Connect' and 'Speak' in the channel and the bot returns on its own. /play starts right away."
        )
        : t("Kein Eingreifen noetig. /play startet die Wiedergabe sofort neu.", "No action is needed. /play restarts playback right away."),
    };
  }

  if (status.failoverActive && status.connected && status.desiredStationName) {
    const nextCheck = status.failbackNextProbeAt > 0
      ? t(
        ` Naechste Pruefung <t:${Math.floor(status.failbackNextProbeAt / 1000)}:R>.`,
        ` Next check <t:${Math.floor(status.failbackNextProbeAt / 1000)}:R>.`
      )
      : "";
    return {
      code: "failover",
      label: t("Ersatzsender aktiv", "Backup station active"),
      accent: 0xF59E0B,
      summary: t(
        `${status.desiredStationName} ist gerade nicht erreichbar. OmniFM spielt ${status.stationName || "einen Ersatzsender"} und wechselt automatisch zurueck, sobald ${status.desiredStationName} wieder laeuft.${nextCheck}`,
        `${status.desiredStationName} is unreachable right now. OmniFM plays ${status.stationName || "a backup station"} and switches back automatically once ${status.desiredStationName} plays again.${nextCheck}`
      ),
      playback: playbackBits.join(" | ") || t("Ersatzsender laeuft", "Backup station playing"),
      nextStep: t(
        "Kein Eingreifen noetig. Die Buttons unter der Now-Playing-Nachricht wechseln sofort zurueck oder behalten den Ersatzsender.",
        "No action needed. The buttons below the now-playing message switch back right away or keep the backup station."
      ),
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
