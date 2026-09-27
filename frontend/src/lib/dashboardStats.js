import {
  buildDashboardHealthAlerts,
  buildDashboardHealthBotDebug,
  buildDashboardHealthBotSummary,
  buildDashboardHealthIncidentCounts,
  buildDashboardHealthIncidentRows,
  buildDashboardHealthStatus,
  normalizeDashboardHealthIncidentStatusFilter,
} from "./dashboardHealth.js";

function normalizeDurationMs(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatDashboardDuration(ms, { short = false } = {}) {
  const value = normalizeDurationMs(ms);
  if (value <= 0) return "0m";
  if (value < 60_000) return "<1m";

  const totalMin = Math.floor(value / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;

  if (short) {
    if (hours > 0) {
      const roundedHours = Math.round((value / 3_600_000) * 10) / 10;
      return `${roundedHours}h`;
    }
    return `${totalMin}m`;
  }

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildReliabilitySummary({
  connects = 0,
  reconnects = 0,
  disconnects = 0,
  errors = 0,
  t = (de, _en) => de,
} = {}) {
  const totalConnects = Math.max(0, Number(connects) || 0);
  const totalReconnects = Math.max(0, Number(reconnects) || 0);
  const totalDisconnects = Math.max(0, Number(disconnects) || 0);
  const totalErrors = Math.max(0, Number(errors) || 0);
  const totalSuccessfulConnections = totalConnects + totalReconnects;
  const totalDisruptions = totalDisconnects + totalErrors;

  if ((totalSuccessfulConnections + totalDisruptions) <= 0) {
    return {
      value: "\u2014",
      accent: "#71717A",
      sub: t("Noch keine Verbindungsdaten", "No connection data yet"),
    };
  }

  const reliability = totalSuccessfulConnections > 0
    ? Math.max(0, Math.min(100, Math.round((totalSuccessfulConnections / (totalSuccessfulConnections + totalDisruptions)) * 100)))
    : 0;
  return {
    value: `${reliability}%`,
    accent: reliability >= 95 ? "#10B981" : reliability >= 80 ? "#F59E0B" : "#EF4444",
    sub: totalSuccessfulConnections > 0
      ? `${totalSuccessfulConnections} ${t("erfolgreiche Verbindungen", "successful connections")}`
      : `${totalDisruptions} ${t("Stoerungen", "disruptions")}`,
  };
}

function buildVoiceChannelUsageRows(voiceChannels = {}, voiceChannelNames = {}) {
  return Object.entries(voiceChannels || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => {
      const resolvedName = String(voiceChannelNames?.[id] || "").trim();
      return {
        id,
        name: resolvedName ? `#${resolvedName}` : id,
        count: Math.max(0, Number(count) || 0),
      };
    });
}

function buildSessionHistoryEntryId(session = {}) {
  return JSON.stringify([
    String(session?.startedAt || ""),
    String(session?.stationKey || ""),
    String(session?.channelId || ""),
    Math.max(0, Number(session?.durationMs || 0) || 0),
    Math.max(0, Number(session?.humanListeningMs || 0) || 0),
    Math.max(0, Number(session?.peakListeners || 0) || 0),
    Math.max(0, Number(session?.avgListeners || 0) || 0),
  ]);
}

function buildConnectionEventEntryId(event = {}) {
  return JSON.stringify([
    String(event?.timestamp || ""),
    String(event?.botId || ""),
    String(event?.eventType || ""),
    String(event?.channelId || ""),
    String(event?.details || ""),
  ]);
}

export function normalizeDashboardTimestamp(value) {
  if (!value) return null;
  const parsedMs = typeof value === "number"
    ? value
    : Date.parse(String(value || ""));
  return Number.isFinite(parsedMs) && parsedMs > 0 ? new Date(parsedMs).toISOString() : null;
}

export function formatDashboardTimestampLabel(value, formatDate = null) {
  const normalized = normalizeDashboardTimestamp(value);
  if (!normalized) return "";
  if (typeof formatDate === "function") {
    return formatDate(normalized, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return new Date(normalized).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildDashboardAnalyticsUpgradeHint({ isUltimate = false, t = (de, _en) => de } = {}) {
  if (isUltimate) return null;

  return {
    requiredTier: "ultimate",
    badge: "ULTIMATE",
    title: t("Ultimate Analytics", "Ultimate analytics"),
    description: t(
      "Stundenmuster, Wochentage, Stations-Breakdowns und Tagestrends sind exklusiv im Ultimate-Paket enthalten.",
      "Hourly trends, weekday patterns, station breakdowns, and daily trends are exclusive to the Ultimate plan."
    ),
    bullets: [
      t("Starts nach Stunde und Wochentag", "Starts by hour and weekday"),
      t("Stations-Breakdown pro Server", "Station breakdown per server"),
      t("Taegliche Trendkurve der letzten 30 Tage", "Daily trend curve for the last 30 days"),
    ],
  };
}

function buildConnectionTimelineRows(connectionHealth = {}, formatDate = null) {
  const timeline = Array.isArray(connectionHealth?.timeline) ? connectionHealth.timeline : [];
  return timeline.map((row) => {
    const parsed = row?.date ? new Date(`${row.date}T12:00:00`) : null;
    const label = Number.isFinite(parsed?.getTime?.())
      ? (typeof formatDate === "function"
        ? formatDate(parsed.toISOString(), { month: "short", day: "numeric" })
        : row.date.slice(5))
      : String(row?.date || "");
    const connects = Math.max(0, Number(row?.connects || 0) || 0);
    const reconnects = Math.max(0, Number(row?.reconnects || 0) || 0);
    const retries = Math.max(0, Number(row?.retries || 0) || 0);
    const disconnects = Math.max(0, Number(row?.disconnects || 0) || 0);
    const errors = Math.max(0, Number(row?.errors || 0) || 0);
    const successfulConnections = connects + reconnects;
    const disruptions = disconnects + errors;

    return {
      date: row?.date || "",
      label,
      connects,
      reconnects,
      retries,
      disconnects,
      errors,
      issues: retries + disconnects + errors,
      reliability: successfulConnections > 0
        ? Math.max(0, Math.min(100, Math.round((successfulConnections / (successfulConnections + disruptions)) * 100)))
        : null,
    };
  });
}

function buildSessionTimelineRows(sessionHistory = [], formatDate = null) {
  return (Array.isArray(sessionHistory) ? sessionHistory : [])
    .slice(0, 20)
    .sort((a, b) => String(a?.startedAt || "").localeCompare(String(b?.startedAt || "")))
    .map((session, index) => {
      const stationName = String(session?.stationName || session?.stationKey || "Session");
      const startedAt = session?.startedAt || null;
      const label = startedAt
        ? (typeof formatDate === "function"
          ? formatDate(startedAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
          : new Date(startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))
        : `#${index + 1}`;

      return {
        id: session?.id || buildSessionHistoryEntryId(session),
        label,
        stationName,
        runtimeHours: Math.round(((Number(session?.durationMs || 0) || 0) / 3_600_000) * 10) / 10,
        listeningHours: Math.round(((Number(session?.humanListeningMs || 0) || 0) / 3_600_000) * 10) / 10,
        peakListeners: Math.max(0, Number(session?.peakListeners || 0) || 0),
        avgListeners: Math.max(0, Number(session?.avgListeners || 0) || 0),
      };
    });
}

function buildSessionQualitySummary(sessionHistory = [], t = (de, _en) => de) {
  const sessions = Array.isArray(sessionHistory) ? sessionHistory : [];
  if (!sessions.length) {
    return {
      trackedSessions: 0,
      avgListeningLabel: "0m",
      longestListeningLabel: "0m",
      topPeakLabel: "0",
      avgPeakLabel: "0",
      subLabel: t("Noch keine Sessions im Verlauf", "No sessions in history yet"),
    };
  }

  const totalListeningMs = sessions.reduce((sum, session) => sum + (Number(session?.humanListeningMs || 0) || 0), 0);
  const longestListeningMs = sessions.reduce((max, session) => Math.max(max, Number(session?.humanListeningMs || 0) || 0), 0);
  const topPeak = sessions.reduce((max, session) => Math.max(max, Number(session?.peakListeners || 0) || 0), 0);
  const avgPeak = Math.round(sessions.reduce((sum, session) => sum + (Number(session?.avgListeners || 0) || 0), 0) / sessions.length);

  return {
    trackedSessions: sessions.length,
    avgListeningLabel: formatDashboardDuration(Math.round(totalListeningMs / sessions.length)),
    longestListeningLabel: formatDashboardDuration(longestListeningMs),
    topPeakLabel: String(topPeak),
    avgPeakLabel: String(avgPeak),
    subLabel: t(
      `${sessions.length} Session(s) im aktuellen Verlauf`,
      `${sessions.length} session(s) in the current history`
    ),
  };
}

export {
  buildDashboardAnalyticsUpgradeHint,
  buildDashboardHealthBotSummary,
  buildDashboardHealthBotDebug,
  buildDashboardHealthAlerts,
  buildDashboardHealthIncidentCounts,
  buildDashboardHealthIncidentRows,
  buildDashboardHealthStatus,
  buildConnectionTimelineRows,
  buildConnectionEventEntryId,
  normalizeDashboardHealthIncidentStatusFilter,
  buildSessionQualitySummary,
  buildSessionHistoryEntryId,
  formatDashboardDuration,
  buildReliabilitySummary,
  buildSessionTimelineRows,
  buildVoiceChannelUsageRows,
};
