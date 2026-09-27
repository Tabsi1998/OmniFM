// OmniFM: dashboard health: bots, incidents, alerts and their status, for the overview.
// Split out of frontend/src/lib/dashboardStats.js (#296).
import {
  buildConnectionEventEntryId,
  formatDashboardDuration,
  formatDashboardTimestampLabel,
  normalizeDashboardTimestamp,
} from "./dashboardStats.js";

function normalizeDashboardHealthBot(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const restoreCooldownMs = Math.max(0, Number(input.restoreCooldownMs || 0) || 0);
  const reconnectCircuitRemainingMs = Math.max(0, Number(input.reconnectCircuitRemainingMs || 0) || 0);
  return {
    botId: String(input.botId || "").trim() || null,
    botName: String(input.botName || "").trim() || null,
    role: String(input.role || "").trim() || null,
    ready: input.ready === true,
    status: String(input.status || "").trim() || "idle",
    playing: input.playing === true,
    recovering: input.recovering === true,
    shouldReconnect: input.shouldReconnect === true,
    listeners: Math.max(0, Number(input.listeners || 0) || 0),
    reconnectAttempts: Math.max(0, Number(input.reconnectAttempts || 0) || 0),
    reconnectCount: Math.max(0, Number(input.reconnectCount || 0) || 0),
    streamErrorCount: Math.max(0, Number(input.streamErrorCount || 0) || 0),
    channelId: String(input.channelId || "").trim() || null,
    channelName: String(input.channelName || "").trim() || null,
    stationKey: String(input.stationKey || "").trim() || null,
    stationName: String(input.stationName || "").trim() || null,
    reconnectPending: input.reconnectPending === true,
    reconnectInFlight: input.reconnectInFlight === true,
    streamRestartPending: input.streamRestartPending === true,
    voiceConnectInFlight: input.voiceConnectInFlight === true,
    lastReconnectAt: normalizeDashboardTimestamp(input.lastReconnectAt),
    lastStreamErrorAt: normalizeDashboardTimestamp(input.lastStreamErrorAt),
    lastProcessExitCode: input.lastProcessExitCode ?? null,
    lastProcessExitDetail: String(input.lastProcessExitDetail || "").trim() || null,
    lastProcessExitAt: normalizeDashboardTimestamp(input.lastProcessExitAt),
    lastStreamEndReason: String(input.lastStreamEndReason || "").trim() || null,
    lastNetworkFailureAt: normalizeDashboardTimestamp(input.lastNetworkFailureAt),
    voiceDisconnectObservedAt: normalizeDashboardTimestamp(input.voiceDisconnectObservedAt),
    restoreBlockedUntil: normalizeDashboardTimestamp(input.restoreBlockedUntil),
    restoreBlockedAt: normalizeDashboardTimestamp(input.restoreBlockedAt),
    restoreBlockCount: Math.max(0, Number(input.restoreBlockCount || 0) || 0),
    restoreBlockReason: String(input.restoreBlockReason || "").trim() || null,
    restoreCooldownMs,
    reconnectCircuitTripCount: Math.max(0, Number(input.reconnectCircuitTripCount || 0) || 0),
    reconnectCircuitOpenUntil: normalizeDashboardTimestamp(input.reconnectCircuitOpenUntil),
    reconnectCircuitRemainingMs,
    networkRecoveryDelayMs: Math.max(0, Number(input.networkRecoveryDelayMs || 0) || 0),
    voiceGuardPolicy: String(input.voiceGuardPolicy || "").trim() || "default",
    voiceGuardEffectivePolicy: String(input.voiceGuardEffectivePolicy || "").trim() || null,
    voiceGuardUnlockUntil: normalizeDashboardTimestamp(input.voiceGuardUnlockUntil),
    voiceGuardCooldownUntil: normalizeDashboardTimestamp(input.voiceGuardCooldownUntil),
    voiceGuardUnlockRemainingMs: Math.max(0, Number(input.voiceGuardUnlockRemainingMs || 0) || 0),
    voiceGuardCooldownRemainingMs: Math.max(0, Number(input.voiceGuardCooldownRemainingMs || 0) || 0),
    voiceGuardMoveCount: Math.max(0, Number(input.voiceGuardMoveCount || 0) || 0),
    voiceGuardWindowMoveCount: Math.max(0, Number(input.voiceGuardWindowMoveCount || 0) || 0),
    voiceGuardReturnCount: Math.max(0, Number(input.voiceGuardReturnCount || 0) || 0),
    voiceGuardDisconnectCount: Math.max(0, Number(input.voiceGuardDisconnectCount || 0) || 0),
    voiceGuardEscalationCount: Math.max(0, Number(input.voiceGuardEscalationCount || 0) || 0),
    voiceGuardLastAction: String(input.voiceGuardLastAction || "").trim() || null,
    voiceGuardLastActionAt: normalizeDashboardTimestamp(input.voiceGuardLastActionAt),
    voiceGuardLastActionReason: String(input.voiceGuardLastActionReason || "").trim() || null,
  };
}

export function buildDashboardHealthBotDebug(source = {}, {
  t = (de, _en) => de,
  formatDate = null,
} = {}) {
  const bot = normalizeDashboardHealthBot(source);
  const flags = [];
  if (bot.reconnectPending) flags.push(t("Reconnect-Timer", "Reconnect timer"));
  if (bot.reconnectInFlight) flags.push(t("Reconnect laeuft", "Reconnect in progress"));
  if (bot.streamRestartPending) flags.push(t("Stream-Retry", "Stream retry"));
  if (bot.voiceConnectInFlight) flags.push(t("Voice-Connect", "Voice connect"));
  if (bot.restoreBlockCount > 0) {
    flags.push(t(`${bot.restoreBlockCount} Restore-Blocks`, `${bot.restoreBlockCount} restore blocks`));
  }
  if (bot.networkRecoveryDelayMs > 0) {
    flags.push(t(
      `Netzwerk-Backoff ${formatDashboardDuration(bot.networkRecoveryDelayMs, { short: true })}`,
      `Network backoff ${formatDashboardDuration(bot.networkRecoveryDelayMs, { short: true })}`
    ));
  }
  if (bot.voiceGuardUnlockRemainingMs > 0) {
    flags.push(t(
      `Voice-Guard Unlock ${formatDashboardDuration(bot.voiceGuardUnlockRemainingMs, { short: true })}`,
      `Voice guard unlock ${formatDashboardDuration(bot.voiceGuardUnlockRemainingMs, { short: true })}`
    ));
  }
  if (bot.voiceGuardCooldownRemainingMs > 0) {
    flags.push(t(
      `Voice-Guard Cooldown ${formatDashboardDuration(bot.voiceGuardCooldownRemainingMs, { short: true })}`,
      `Voice guard cooldown ${formatDashboardDuration(bot.voiceGuardCooldownRemainingMs, { short: true })}`
    ));
  }

  let summary = "";
  if (!bot.ready && bot.recovering) {
    summary = t(
      "Worker offline mit aktivem Recovery-Ziel",
      "Worker offline with an active recovery target"
    );
  } else if (bot.restoreCooldownMs > 0) {
    summary = t("Restore-Cooldown aktiv", "Restore cooldown active");
  } else if (bot.reconnectCircuitRemainingMs > 0) {
    summary = t("Reconnect-Circuit pausiert", "Reconnect circuit paused");
  } else if (bot.voiceConnectInFlight) {
    summary = t("Voice-Verbindung wird aufgebaut", "Voice connection is being established");
  } else if (bot.reconnectInFlight) {
    summary = t("Reconnect laeuft gerade", "Reconnect is currently in progress");
  } else if (bot.streamRestartPending) {
    summary = t("Stream-Neustart geplant", "Stream restart is scheduled");
  } else if (bot.reconnectPending) {
    summary = t("Reconnect-Retry geplant", "Reconnect retry is scheduled");
  } else if (bot.voiceGuardLastAction === "disconnect") {
    summary = t("Voice Guard hat die Session beendet", "Voice guard ended the session");
  } else if (bot.voiceGuardLastAction === "return") {
    summary = t("Voice Guard plant Rueckkehr in den Ziel-Channel", "Voice guard is returning to the target channel");
  } else if (bot.voiceGuardLastAction === "cooldown") {
    summary = t("Voice Guard pausiert weitere Rueckspruenge", "Voice guard is pausing further returns");
  } else if (bot.shouldReconnect && !bot.playing) {
    summary = t("Wartet auf Wiederverbindung", "Waiting for reconnect");
  } else if (bot.lastProcessExitDetail) {
    summary = t(`Letzter Exit: ${bot.lastProcessExitDetail}`, `Last exit: ${bot.lastProcessExitDetail}`);
  } else if (bot.lastStreamEndReason) {
    summary = t(`Letztes Stream-Ende: ${bot.lastStreamEndReason}`, `Last stream end: ${bot.lastStreamEndReason}`);
  }

  const detailLines = [];
  if (bot.restoreCooldownMs > 0) {
    detailLines.push(t(
      `Restore blockiert fuer ${formatDashboardDuration(bot.restoreCooldownMs)}${bot.restoreBlockReason ? ` | ${bot.restoreBlockReason}` : ""}`,
      `Restore blocked for ${formatDashboardDuration(bot.restoreCooldownMs)}${bot.restoreBlockReason ? ` | ${bot.restoreBlockReason}` : ""}`
    ));
  }
  if (bot.reconnectCircuitRemainingMs > 0) {
    detailLines.push(t(
      `Reconnect-Circuit offen fuer ${formatDashboardDuration(bot.reconnectCircuitRemainingMs)}${bot.reconnectCircuitTripCount > 0 ? ` | Trip ${bot.reconnectCircuitTripCount}` : ""}`,
      `Reconnect circuit open for ${formatDashboardDuration(bot.reconnectCircuitRemainingMs)}${bot.reconnectCircuitTripCount > 0 ? ` | trip ${bot.reconnectCircuitTripCount}` : ""}`
    ));
  }
  if (bot.lastProcessExitDetail || bot.lastProcessExitCode !== null) {
    const exitLabel = [
      bot.lastProcessExitDetail || "",
      bot.lastProcessExitCode !== null && bot.lastProcessExitCode !== undefined
        ? t(`Code ${bot.lastProcessExitCode}`, `Code ${bot.lastProcessExitCode}`)
        : "",
      bot.lastProcessExitAt ? formatDashboardTimestampLabel(bot.lastProcessExitAt, formatDate) : "",
    ].filter(Boolean).join(" | ");
    if (exitLabel) {
      detailLines.push(t(`Prozess-Exit: ${exitLabel}`, `Process exit: ${exitLabel}`));
    }
  }
  if (bot.lastStreamEndReason) {
    detailLines.push(t(`Stream-Ende: ${bot.lastStreamEndReason}`, `Stream end: ${bot.lastStreamEndReason}`));
  }
  if (bot.lastNetworkFailureAt) {
    detailLines.push(t(
      `Letzter Netzwerkfehler: ${formatDashboardTimestampLabel(bot.lastNetworkFailureAt, formatDate)}`,
      `Last network failure: ${formatDashboardTimestampLabel(bot.lastNetworkFailureAt, formatDate)}`
    ));
  }
  if (bot.voiceDisconnectObservedAt) {
    detailLines.push(t(
      `Voice-Disconnect gesehen: ${formatDashboardTimestampLabel(bot.voiceDisconnectObservedAt, formatDate)}`,
      `Voice disconnect observed: ${formatDashboardTimestampLabel(bot.voiceDisconnectObservedAt, formatDate)}`
    ));
  }
  if (bot.voiceGuardLastAction) {
    const actionParts = [
      bot.voiceGuardLastAction,
      bot.voiceGuardLastActionReason || "",
      bot.voiceGuardLastActionAt ? formatDashboardTimestampLabel(bot.voiceGuardLastActionAt, formatDate) : "",
    ].filter(Boolean).join(" | ");
    detailLines.push(t(`Voice Guard: ${actionParts}`, `Voice guard: ${actionParts}`));
  }
  if (bot.voiceGuardMoveCount > 0 || bot.voiceGuardReturnCount > 0 || bot.voiceGuardDisconnectCount > 0) {
    detailLines.push(t(
      `Moves: ${bot.voiceGuardMoveCount} | Returns: ${bot.voiceGuardReturnCount} | Disconnects: ${bot.voiceGuardDisconnectCount}`,
      `Moves: ${bot.voiceGuardMoveCount} | Returns: ${bot.voiceGuardReturnCount} | Disconnects: ${bot.voiceGuardDisconnectCount}`
    ));
  }

  return {
    summary,
    detailLines: detailLines.slice(0, 4),
    flags: flags.slice(0, 4),
  };
}

export function buildDashboardHealthBotSummary(source = {}, {
  t = (de, _en) => de,
} = {}) {
  const bot = normalizeDashboardHealthBot(source);
  const playbackBits = [];
  if (bot.stationName) playbackBits.push(bot.stationName);
  if (bot.channelName) playbackBits.push(`#${bot.channelName}`);
  if (bot.listeners > 0) {
    playbackBits.push(t(`${bot.listeners} Zuhoerer`, `${bot.listeners} listeners`));
  }

  if (!bot.ready) {
    return {
      label: t("Voruebergehend nicht verfuegbar", "Temporarily unavailable"),
      color: "#FCA5A5",
      summary: t(
        "Dieser Bot ist gerade nicht bereit. Bitte versuche es gleich erneut.",
        "This bot is not ready right now. Please try again shortly."
      ),
      playback: playbackBits.join(" | ") || t("Keine aktive Wiedergabe", "No active playback"),
      hint: t("Es ist gerade keine Aktion auf dem Server noetig.", "No action is needed on the server right now."),
    };
  }

  if (bot.voiceGuardLastAction === "return") {
    return {
      label: t("Stellt Kanal wieder her", "Restoring channel"),
      color: "#FCD34D",
      summary: t(
        "OmniFM kehrt gerade in den vorgesehenen Sprachkanal zurueck.",
        "OmniFM is returning to the intended voice channel right now."
      ),
      playback: playbackBits.join(" | ") || t("Wiedergabe wird abgesichert", "Playback is being protected"),
      hint: t("Kein Eingreifen noetig.", "No action is needed."),
    };
  }

  if (
    bot.voiceConnectInFlight
    || bot.reconnectInFlight
    || bot.reconnectPending
    || bot.streamRestartPending
    || (bot.shouldReconnect && !bot.playing)
    || bot.recovering
  ) {
    return {
      label: t("Verbindet", "Connecting"),
      color: "#FCD34D",
      summary: t(
        "OmniFM stellt die Wiedergabe gerade automatisch wieder her.",
        "OmniFM is automatically restoring playback right now."
      ),
      playback: playbackBits.join(" | ") || t("Wiedergabe wird vorbereitet", "Playback is being prepared"),
      hint: t("Bitte kurz abwarten.", "Please wait a moment."),
    };
  }

  if (bot.playing && (bot.reconnectAttempts > 0 || bot.streamErrorCount > 0)) {
    return {
      label: t("Stabilisiert sich", "Stabilizing"),
      color: "#FCD34D",
      summary: t(
        "Die Wiedergabe laeuft, wird aber gerade noch stabilisiert.",
        "Playback is running, but it is still being stabilized."
      ),
      playback: playbackBits.join(" | ") || t("Aktive Wiedergabe", "Active playback"),
      hint: t("Normalerweise ist kein Eingreifen noetig.", "Normally no action is needed."),
    };
  }

  if (bot.playing) {
    return {
      label: t("Live", "Live"),
      color: "#6EE7B7",
      summary: t(
        "OmniFM spielt aktuell ohne bekannte Stoerung.",
        "OmniFM is currently playing without a known issue."
      ),
      playback: playbackBits.join(" | ") || t("Aktive Wiedergabe", "Active playback"),
      hint: t("Alles laeuft normal.", "Everything is running normally."),
    };
  }

  return {
    label: t("Bereit", "Ready"),
    color: "#93C5FD",
    summary: t(
      "OmniFM ist bereit fuer den naechsten Start auf diesem Server.",
      "OmniFM is ready for the next start on this server."
    ),
    playback: playbackBits.join(" | ") || t("Noch keine aktive Wiedergabe", "No active playback yet"),
    hint: t("Nutze /play, um einen Stream zu starten.", "Use /play to start a stream."),
  };
}

export function normalizeDashboardHealthIncidentStatusFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "open" || normalized === "acknowledged") return normalized;
  return "all";
}

function normalizeDashboardHealthIncident(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const eventKey = String(input.eventKey || "").trim().toLowerCase();
  if (!eventKey) return null;

  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};
  const acknowledgedBy = input?.acknowledgedBy && typeof input.acknowledgedBy === "object"
    ? {
      id: String(input.acknowledgedBy.id || "").trim() || null,
      username: String(input.acknowledgedBy.username || "").trim() || null,
    }
    : null;
  const acknowledgedAt = String(input.acknowledgedAt || "").trim() || null;
  return {
    id: String(input.id || "").trim() || buildConnectionEventEntryId({
      timestamp: input.timestamp || "",
      botId: input?.runtime?.id || "",
      eventType: eventKey,
      channelId: payload.previousStationKey || payload.failoverStationKey || payload.recoveredStationKey || "",
      details: payload.triggerError || payload.restartReason || "",
    }),
    eventKey,
    severity: ["success", "warning", "critical"].includes(String(input.severity || "").trim().toLowerCase())
      ? String(input.severity).trim().toLowerCase()
      : (eventKey === "stream_recovered" ? "success" : eventKey === "stream_failover_exhausted" ? "critical" : "warning"),
    timestamp: String(input.timestamp || "").trim() || null,
    acknowledgedAt,
    acknowledgedBy,
    status: acknowledgedAt ? "acknowledged" : "open",
    runtime: input?.runtime && typeof input.runtime === "object"
      ? {
        id: String(input.runtime.id || "").trim() || null,
        name: String(input.runtime.name || "").trim() || null,
        role: String(input.runtime.role || "").trim() || null,
      }
      : null,
    payload: {
      previousStationName: String(payload.previousStationName || "").trim() || null,
      recoveredStationName: String(payload.recoveredStationName || "").trim() || null,
      failoverStationName: String(payload.failoverStationName || "").trim() || null,
      restartReason: String(payload.restartReason || "").trim() || null,
      triggerError: String(payload.triggerError || "").trim() || null,
      streamErrorCount: Math.max(0, Number(payload.streamErrorCount || 0) || 0),
      reconnectAttempts: Math.max(0, Number(payload.reconnectAttempts || 0) || 0),
      listenerCount: Math.max(0, Number(payload.listenerCount || 0) || 0),
      attemptedCandidates: Array.isArray(payload.attemptedCandidates)
        ? payload.attemptedCandidates.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 6)
        : [],
    },
  };
}

function isCustomerVisibleDashboardHealthIncidentEvent(eventKey) {
  const normalizedEventKey = String(eventKey || "").trim().toLowerCase();
  return normalizedEventKey === "stream_failover_activated" || normalizedEventKey === "stream_failover_exhausted";
}

function normalizeDashboardHealth(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const managedBots = Math.max(0, Number(input.managedBots || 0) || 0);
  const readyBots = Math.max(0, Number(input.readyBots || 0) || 0);
  const providedUnavailableBots = Math.max(0, Number(input.unavailableBots || 0) || 0);
  return {
    status: ["healthy", "warning", "critical"].includes(String(input.status || ""))
      ? String(input.status)
      : "unknown",
    managedBots,
    readyBots,
    unavailableBots: Math.max(providedUnavailableBots, Math.max(0, managedBots - readyBots)),
    liveStreams: Math.max(0, Number(input.liveStreams || 0) || 0),
    activeVoiceChannels: Math.max(0, Number(input.activeVoiceChannels || 0) || 0),
    listenersNow: Math.max(0, Number(input.listenersNow || 0) || 0),
    recoveringStreams: Math.max(0, Number(input.recoveringStreams || 0) || 0),
    degradedStreams: Math.max(0, Number(input.degradedStreams || 0) || 0),
    reconnectAttempts: Math.max(0, Number(input.reconnectAttempts || 0) || 0),
    streamErrors: Math.max(0, Number(input.streamErrors || 0) || 0),
    eventsConfigured: Math.max(0, Number(input.eventsConfigured || 0) || 0),
    eventsActive: Math.max(0, Number(input.eventsActive || 0) || 0),
    nextEventAt: input.nextEventAt || null,
    nextEventTitle: String(input.nextEventTitle || "").trim() || null,
    alerts: Array.isArray(input.alerts) ? input.alerts : [],
    incidents: Array.isArray(input.incidents)
      ? input.incidents
        .map((incident) => normalizeDashboardHealthIncident(incident))
        .filter((incident) => incident && isCustomerVisibleDashboardHealthIncidentEvent(incident.eventKey))
      : [],
    bots: Array.isArray(input.bots) ? input.bots.map((bot) => normalizeDashboardHealthBot(bot)).filter(Boolean) : [],
  };
}

export function buildDashboardHealthStatus(source = {}, t = (de, _en) => de) {
  const health = normalizeDashboardHealth(source);

  if (health.managedBots <= 0) {
    return {
      label: t("Nicht bereit", "Not ready"),
      accent: "#EF4444",
      sub: t("Aktuell ist kein OmniFM Bot auf diesem Server verfuegbar.", "No OmniFM bot is currently available on this server."),
    };
  }

  if (health.status === "critical") {
    return {
      label: t("Voruebergehend gestoert", "Temporarily unavailable"),
      accent: "#EF4444",
      sub: t("OmniFM kann im Moment nicht normal bereitgestellt werden.", "OmniFM cannot be provided normally right now."),
    };
  }

  if (health.status === "warning") {
    return {
      label: t("Wird beobachtet", "Being monitored"),
      accent: "#F59E0B",
      sub: t("Ein Teil der Wiedergabe wird gerade automatisch stabilisiert.", "Part of playback is currently being stabilized automatically."),
    };
  }

  if (health.status === "healthy") {
    return {
      label: t("Stabil", "Stable"),
      accent: "#10B981",
      sub: `${health.readyBots}/${health.managedBots} ${t("Bots bereit", "bots ready")}`,
    };
  }

  return {
    label: t("Unbekannt", "Unknown"),
    accent: "#71717A",
    sub: t("Noch keine Health-Daten", "No health data yet"),
  };
}

export function buildDashboardHealthAlerts(source = {}, t = (de, _en) => de) {
  const health = normalizeDashboardHealth(source);
  const alerts = [];
  const unavailableBots = Math.max(0, Number(health.unavailableBots || 0) || 0);

  if (health.managedBots <= 0) {
    alerts.push({
      severity: "critical",
      message: t(
        "Kein OmniFM Bot ist aktuell auf diesem Server verfuegbar.",
        "No OmniFM bot is currently available on this server."
      ),
    });
  }

  if (unavailableBots > 0) {
    alerts.push({
      severity: health.readyBots <= 0 ? "critical" : "warning",
      message: t(
        `${unavailableBots} Bot(s) sind gerade nicht bereit.`,
        `${unavailableBots} bot(s) are currently not ready.`
      ),
    });
  }

  if (health.recoveringStreams > 0) {
    alerts.push({
      severity: "warning",
      message: t(
        `${health.recoveringStreams} Stream(s) werden gerade wiederhergestellt.`,
        `${health.recoveringStreams} stream(s) are being restored right now.`
      ),
    });
  }

  if (health.degradedStreams > 0) {
    alerts.push({
      severity: health.streamErrors >= 3 ? "critical" : "warning",
      message: t(
        `${health.degradedStreams} Stream(s) werden gerade stabilisiert.`,
        `${health.degradedStreams} stream(s) are being stabilized right now.`
      ),
    });
  }

  if (!alerts.length) {
    alerts.push({
      severity: "success",
      message: t(
        "Keine aktiven Health-Probleme erkannt.",
        "No active health issues detected."
      ),
    });
  }

  return alerts;
}

export function buildDashboardHealthIncidentCounts(source = {}) {
  const health = normalizeDashboardHealth(source);
  return health.incidents.reduce((summary, incident) => {
    summary.all += 1;
    if (incident.status === "acknowledged") {
      summary.acknowledged += 1;
    } else {
      summary.open += 1;
    }
    return summary;
  }, { all: 0, open: 0, acknowledged: 0 });
}

export function buildDashboardHealthIncidentRows(source = {}, {
  t = (de, _en) => de,
  formatDate = null,
  statusFilter = "all",
  maxItems = 20,
} = {}) {
  const health = normalizeDashboardHealth(source);
  const normalizedStatusFilter = normalizeDashboardHealthIncidentStatusFilter(statusFilter);
  const safeMaxItems = Math.max(1, Number.parseInt(String(maxItems || 20), 10) || 20);
  return health.incidents
    .filter((incident) => normalizedStatusFilter === "all" || incident.status === normalizedStatusFilter)
    .slice(0, safeMaxItems)
    .map((incident, index) => {
    const runtimeName = incident?.runtime?.name || t("Runtime", "Runtime");
    const runtimeRole = incident?.runtime?.role ? String(incident.runtime.role).toUpperCase() : "";
    const previousStation = incident?.payload?.previousStationName || t("Unbekannte Station", "Unknown station");
    const recoveredStation = incident?.payload?.recoveredStationName || previousStation;
    const failoverStation = incident?.payload?.failoverStationName || t("Fallback unbekannt", "Fallback unknown");
    const attemptedCount = incident?.payload?.attemptedCandidates?.length || 0;
    const timestampLabel = incident?.timestamp && typeof formatDate === "function"
      ? formatDate(incident.timestamp, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : incident?.timestamp
        ? new Date(incident.timestamp).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
        : "";

    let title = t("Wiedergabe-Hinweis", "Playback update");
    let detail = runtimeName;
    if (incident.eventKey === "stream_healthcheck_stalled") {
      title = t("Wiedergabe kurz unterbrochen", "Playback briefly interrupted");
      detail = `${previousStation} | ${runtimeName}`;
    } else if (incident.eventKey === "stream_recovered") {
      title = t("Wiedergabe wiederhergestellt", "Playback restored");
      detail = `${recoveredStation} | ${runtimeName}`;
    } else if (incident.eventKey === "stream_failover_activated") {
      title = t("Auf Ersatzstation gewechselt", "Switched to backup station");
      detail = `${previousStation} -> ${failoverStation}`;
    } else if (incident.eventKey === "stream_failover_exhausted") {
      title = t("Automatische Wiederherstellung ohne Erfolg", "Automatic recovery did not succeed");
      detail = attemptedCount > 0
        ? t(`${previousStation} | ${attemptedCount} Alternativen ohne Erfolg`, `${previousStation} | ${attemptedCount} alternatives did not work`)
        : previousStation;
    }

    const chips = [
      runtimeName && runtimeName !== t("Runtime", "Runtime") ? runtimeName : "",
      runtimeRole,
      incident?.payload?.listenerCount > 0 ? t(`${incident.payload.listenerCount} Zuhoerer`, `${incident.payload.listenerCount} listeners`) : "",
    ].filter(Boolean).slice(0, 3);

    return {
      id: incident.id || `${incident.eventKey}-${index}`,
      severity: incident.severity,
      status: incident.status,
      isAcknowledged: incident.status === "acknowledged",
      title,
      detail,
      timestampLabel,
      acknowledgedLabel: incident?.acknowledgedAt && typeof formatDate === "function"
        ? formatDate(incident.acknowledgedAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : incident?.acknowledgedAt
          ? new Date(incident.acknowledgedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
          : "",
      acknowledgedByLabel: incident?.acknowledgedBy?.username || incident?.acknowledgedBy?.id || "",
      chips,
    };
  });
}
