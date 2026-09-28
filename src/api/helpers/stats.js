// OmniFM API: weekly digest preview, telemetry and the statistics of the dashboard.
// Split out of src/api/server.js (#293).
import { clipText } from "../../lib/helpers.js";
import { normalizeRepeatMode } from "../../lib/event-time.js";
import {
  buildWeeklyDigestEmbedData,
  buildWeeklyDigestMeta,
  buildWeeklyDigestPreview,
  normalizeWeeklyDigestConfig,
} from "../../lib/weekly-digest.js";
import { getDashboardTelemetry } from "../../dashboard-store.js";
import { getGuildCommandPermissionRules } from "../../command-permissions-store.js";
import { listScheduledEvents } from "../../scheduled-events-store.js";
import {
  getGuildListeningStats,
  getGuildDailyStats,
  getGuildSessionHistory,
  getGuildConnectionHealth,
  getGuildListenerTimeline,
  getActiveSessionsForGuild,
} from "../../listening-stats-store.js";
import { getRecentRuntimeIncidents } from "../../runtime-incidents-store.js";
import {
  buildDashboardConnectionEventEntryId,
  buildDashboardSessionHistoryEntryId,
} from "./license.js";
import {
  buildDashboardHealthSummary,
  buildDashboardSetupStatus,
  buildGuildChannelNameMap,
  collectGuildLiveDetails,
  resolveRuntimeForGuild,
} from "./runtime-status.js";

export async function buildDashboardWeeklyDigestPreviewPayload(guildInfo, runtimes, weeklyDigest, language) {
  const digest = normalizeWeeklyDigestConfig(weeklyDigest || {}, language);
  const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
  const stats = getGuildListeningStats(guildInfo.id) || {};
  const dailyStats = await getGuildDailyStats(guildInfo.id, 7);
  const channelNames = await buildGuildChannelNameMap(guild, digest.channelId ? [digest.channelId] : []);
  const guildName = String(guild?.name || guildInfo?.name || guildInfo?.id || "OmniFM");

  const preview = buildWeeklyDigestPreview({
    guildName,
    channelId: digest.channelId,
    channelName: channelNames[digest.channelId] || "",
    stats,
    dailyStats,
    language: digest.language || language,
    now: new Date(),
  });

  return {
    weeklyDigest: digest,
    weeklyDigestMeta: buildWeeklyDigestMeta(digest),
    preview: {
      ...preview,
      embed: buildWeeklyDigestEmbedData({
        guildName,
        channelId: digest.channelId,
        channelName: channelNames[digest.channelId] || "",
        stats,
        dailyStats,
        language: digest.language || language,
        now: preview.generatedAt,
      }),
    },
  };
}

export function normalizeDashboardTelemetryPayload(rawTelemetry) {
  const source = rawTelemetry && typeof rawTelemetry === "object" ? rawTelemetry : {};
  const listenersByChannel = Array.isArray(source.listenersByChannel)
    ? source.listenersByChannel
        .filter((item) => item && typeof item === "object")
        .slice(0, 20)
        .map((item) => ({
          name: clipText(item.name || item.channel || "Voice", 80),
          listeners: Math.max(0, Number.parseInt(String(item.listeners || 0), 10) || 0),
        }))
    : [];

  const dailyReport = Array.isArray(source.dailyReport)
    ? source.dailyReport
        .filter((item) => item && typeof item === "object")
        .slice(0, 31)
        .map((item) => ({
          day: clipText(item.day || "", 20),
          starts: Math.max(0, Number.parseInt(String(item.starts || 0), 10) || 0),
          peakListeners: Math.max(0, Number.parseInt(String(item.peakListeners || 0), 10) || 0),
        }))
        .filter((item) => item.day)
    : [];

  const stationBreakdown = Array.isArray(source.stationBreakdown)
    ? source.stationBreakdown
        .filter((item) => item && typeof item === "object")
        .slice(0, 20)
        .map((item) => ({
          name: clipText(item.name || item.station || "Station", 80),
          starts: Math.max(0, Number.parseInt(String(item.starts || 0), 10) || 0),
          peakListeners: Math.max(0, Number.parseInt(String(item.peakListeners || 0), 10) || 0),
        }))
    : [];

  return {
    listenersNow: Math.max(0, Number.parseInt(String(source.listenersNow || 0), 10) || 0),
    activeStreams: Math.max(0, Number.parseInt(String(source.activeStreams || 0), 10) || 0),
    peakListeners: Math.max(0, Number.parseInt(String(source.peakListeners || 0), 10) || 0),
    peakTime: clipText(source.peakTime || "", 80),
    topStation: {
      name: clipText(source?.topStation?.name || source.topStationName || "-", 120) || "-",
      listeners: Math.max(0, Number.parseInt(String(source?.topStation?.listeners || source.topStationListeners || 0), 10) || 0),
    },
    listenersByChannel,
    dailyReport,
    stationBreakdown,
    updatedAt: clipText(source.updatedAt || new Date().toISOString(), 80),
  };
}

function buildEventInsights(events, listeningStats, nowMs = Date.now()) {
  const list = Array.isArray(events) ? events : [];
  const stationStarts = listeningStats?.stationStarts || {};
  const stationListeningMs = listeningStats?.stationListeningMs || {};
  const stationNames = listeningStats?.stationNames || {};

  const configured = list.length;
  const active = list.filter((eventRow) => eventRow?.enabled !== false).length;
  const enabledEvents = list.filter((eventRow) => eventRow?.enabled !== false);
  const nextEvent = enabledEvents
    .filter((eventRow) => Number.parseInt(String(eventRow?.runAtMs || 0), 10) > nowMs)
    .sort((a, b) => Number.parseInt(String(a?.runAtMs || 0), 10) - Number.parseInt(String(b?.runAtMs || 0), 10))[0] || null;

  const repeats = Object.entries(enabledEvents.reduce((map, eventRow) => {
    const repeat = normalizeRepeatMode(eventRow?.repeat || "none");
    map[repeat] = (map[repeat] || 0) + 1;
    return map;
  }, {}))
    .map(([repeat, count]) => ({ repeat, count: Number(count || 0) || 0 }))
    .sort((a, b) => b.count - a.count || a.repeat.localeCompare(b.repeat));

  const topStations = Object.entries(enabledEvents.reduce((map, eventRow) => {
    const stationKey = String(eventRow?.stationKey || "").trim();
    if (!stationKey) return map;
    map[stationKey] = (map[stationKey] || 0) + 1;
    return map;
  }, {}))
    .map(([stationKey, eventCount]) => ({
      stationKey,
      stationName: stationNames?.[stationKey] || stationKey,
      eventCount: Number(eventCount || 0) || 0,
      starts: Number(stationStarts?.[stationKey] || 0) || 0,
      listeningMs: Number(stationListeningMs?.[stationKey] || 0) || 0,
    }))
    .sort((a, b) => b.listeningMs - a.listeningMs || b.eventCount - a.eventCount || a.stationName.localeCompare(b.stationName))
    .slice(0, 8);

  return {
    configured,
    active,
    nextRunAt: nextEvent?.runAtMs ? new Date(Number(nextEvent.runAtMs)).toISOString() : null,
    repeats,
    topStations,
  };
}

export async function buildDashboardStatsForGuild(serverId, tier, runtimes) {
  const listeningStats = getGuildListeningStats(serverId) || {};
  const telemetry = normalizeDashboardTelemetryPayload(getDashboardTelemetry(serverId));
  const liveRows = collectGuildLiveDetails(runtimes, serverId);
  const events = listScheduledEvents({ guildId: serverId });
  const permissionRules = getGuildCommandPermissionRules(serverId);
  const healthIncidents = await getRecentRuntimeIncidents(serverId, 20);

  const listenersNow = liveRows.reduce((sum, row) => sum + (Number(row.listeners || 0) || 0), 0);
  const activeStreams = liveRows.length;
  const listenersByChannel = liveRows
    .reduce((map, row) => {
      const key = row.channelId || row.channelName || row.botId || row.botName;
      const current = map.get(key) || { name: row.channelName || row.channelId || "Voice", listeners: 0 };
      current.listeners += Number(row.listeners || 0) || 0;
      map.set(key, current);
      return map;
    }, new Map());
  const telemetryStationBreakdown = Array.isArray(telemetry.stationBreakdown) ? telemetry.stationBreakdown : [];
  const telemetryStationPeakMap = telemetryStationBreakdown.reduce((map, entry) => {
    const key = clipText(entry?.name || "", 120);
    if (!key) return map;
    map.set(key, Math.max(map.get(key) || 0, Number(entry?.peakListeners || 0) || 0));
    return map;
  }, new Map());

  const stationBreakdown = Object.entries(listeningStats.stationStarts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, starts]) => ({
      name: listeningStats.stationNames?.[name] || name,
      starts: Number(starts || 0) || 0,
      peakListeners: telemetryStationPeakMap.get(listeningStats.stationNames?.[name] || name) || 0,
    }));
  const stationTimeBreakdown = Object.entries(listeningStats.stationListeningMs || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, listeningMs]) => ({
      name: listeningStats.stationNames?.[name] || name,
      listeningMs: Number(listeningMs || 0) || 0,
      peakListeners: telemetryStationPeakMap.get(listeningStats.stationNames?.[name] || name) || 0,
    }));

  const liveTopStation = liveRows
    .filter((row) => (Number(row.listeners || 0) || 0) > 0)
    .slice()
    .sort((a, b) => b.listeners - a.listeners || String(a.stationName).localeCompare(String(b.stationName)))[0];
  const topStationByStarts = stationBreakdown[0] || null;
  const topStationByListening = stationTimeBreakdown[0] || null;
  const historicalTopStation = topStationByListening || telemetryStationBreakdown[0] || topStationByStarts || null;
  const topStation = liveTopStation
    ? { name: liveTopStation.stationName || "-", listeners: liveTopStation.listeners || 0 }
    : telemetry.topStation?.name && telemetry.topStation.name !== "-"
      ? telemetry.topStation
      : historicalTopStation
        ? {
            name: historicalTopStation.name,
            listeners: historicalTopStation.peakListeners || 0,
            listeningMs: historicalTopStation.listeningMs || 0,
          }
        : { name: "-", listeners: 0 };

  const peakTime = telemetry.peakTime
    || (listeningStats.lastStartedAt ? new Date(listeningStats.lastStartedAt).toISOString() : "");
  const peakListeners = Math.max(
    Number(listeningStats.peakListeners || 0) || 0,
    Number(telemetry.peakListeners || 0) || 0,
    listenersNow
  );

  const basic = {
    listenersNow,
    activeStreams,
    peakListeners,
    peakTime,
    topStation,
    topStationByStarts: topStationByStarts
      ? {
          name: topStationByStarts.name || "-",
          starts: Number(topStationByStarts.starts || 0) || 0,
          peakListeners: Number(topStationByStarts.peakListeners || 0) || 0,
        }
      : null,
    topStationByListening: topStationByListening
      ? {
          name: topStationByListening.name || "-",
          listeningMs: Number(topStationByListening.listeningMs || 0) || 0,
          peakListeners: Number(topStationByListening.peakListeners || 0) || 0,
        }
      : null,
    eventsConfigured: events.length,
    eventsActive: events.filter((item) => item?.enabled !== false).length,
    permRules: Object.keys(permissionRules || {}).length,
    // The overview's stream list and uptime tile; only FastAPI sent them, so
    // both stayed empty since the Node API serves the dashboard (#413).
    activeStreamDetails: liveRows,
    runtimeUptimeSec: liveRows.reduce((most, row) => Math.max(most, Number(row.uptimeSec || 0) || 0), 0),
    totalStarts: Number(listeningStats.totalStarts || 0),
    totalSessions: Number(listeningStats.totalSessions || 0),
    totalListeningMs: Number(listeningStats.currentTotalListeningMs || listeningStats.totalListeningMs || 0),
    avgSessionMs: Number(listeningStats.avgSessionMs || 0),
    longestSessionMs: Number(listeningStats.longestSessionMs || 0),
    totalConnections: Number(listeningStats.totalConnections || 0),
    totalReconnects: Number(listeningStats.totalReconnects || 0),
    totalReconnectRetries: Number(listeningStats.totalReconnectRetries || 0),
    totalConnectionDisconnects: Number(listeningStats.totalConnectionDisconnects || 0),
    totalConnectionErrors: Number(listeningStats.totalConnectionErrors || 0),
    updatedAt: telemetry.updatedAt || new Date().toISOString(),
    setupStatus: buildDashboardSetupStatus(serverId, tier, runtimes, { liveRows }),
    health: buildDashboardHealthSummary(serverId, runtimes, {
      liveRows,
      listenersNow,
      activeStreams,
      events,
      incidents: healthIncidents,
    }),
  };

  if (tier !== "ultimate") {
    return { basic, advanced: null };
  }

  const unstableStreams = liveRows
    .map((row) => {
      const streamErrors = Number(row.streamErrorCount || 0) || 0;
      const reconnectAttempts = Number(row.reconnectAttempts || 0) || 0;
      const issueScore = (streamErrors * 2) + reconnectAttempts;
      return {
        botId: row.botId,
        botName: row.botName,
        stationKey: row.stationKey,
        stationName: row.stationName,
        channelId: row.channelId,
        channelName: row.channelName,
        listeners: row.listeners,
        streamErrors,
        reconnectAttempts,
        shouldReconnect: row.shouldReconnect === true,
        issueScore,
      };
    })
    .filter((row) => row.issueScore > 0)
    .sort((a, b) => b.issueScore - a.issueScore || b.listeners - a.listeners || a.stationName.localeCompare(b.stationName))
    .slice(0, 8);

  const eventInsights = buildEventInsights(events, listeningStats);

  const advanced = {
    listenersByChannel: listenersByChannel.size
      ? [...listenersByChannel.values()].sort((a, b) => b.listeners - a.listeners || a.name.localeCompare(b.name))
      : telemetry.listenersByChannel,
    dailyReport: telemetry.dailyReport,
    stationBreakdown: stationBreakdown.length ? stationBreakdown : telemetry.stationBreakdown,
    stationTimeBreakdown,
    hours: listeningStats.hours || {},
    daysOfWeek: listeningStats.daysOfWeek || {},
    stationListeningMs: listeningStats.stationListeningMs || {},
    commands: listeningStats.commands || {},
    voiceChannels: listeningStats.voiceChannels || {},
    firstSeenAt: listeningStats.firstSeenAt || 0,
    unstableStreams,
    eventInsights,
  };

  return { basic, advanced };
}

export async function buildDashboardDetailStatsPayload(guild, runtimes, days = 30) {
  const safeDays = Math.min(90, Math.max(1, Number.parseInt(String(days || "30"), 10) || 30));
  const [dailyStats, sessionHistory, connectionHealth, listenerTimeline, activeSessions] = await Promise.all([
    getGuildDailyStats(guild.id, safeDays),
    getGuildSessionHistory(guild.id, 50),
    getGuildConnectionHealth(guild.id, safeDays),
    getGuildListenerTimeline(guild.id, 24),
    Promise.resolve(getActiveSessionsForGuild(guild.id)),
  ]);

  const listeningStats = getGuildListeningStats(guild.id) || {};
  const { guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
  const voiceChannelNames = await buildGuildChannelNameMap(managedGuild, [
    ...Object.keys(listeningStats.voiceChannels || {}),
    ...activeSessions.map((session) => session?.channelId).filter(Boolean),
  ]);
  const events = listScheduledEvents({ guildId: guild.id });
  const eventInsights = buildEventInsights(events, listeningStats);
  const unstableStreams = collectGuildLiveDetails(runtimes, guild.id)
    .map((row) => {
      const streamErrors = Number(row.streamErrorCount || 0) || 0;
      const reconnectAttempts = Number(row.reconnectAttempts || 0) || 0;
      const issueScore = (streamErrors * 2) + reconnectAttempts;
      return {
        botId: row.botId,
        botName: row.botName,
        stationKey: row.stationKey,
        stationName: row.stationName,
        channelId: row.channelId,
        channelName: row.channelName,
        listeners: row.listeners,
        streamErrors,
        reconnectAttempts,
        shouldReconnect: row.shouldReconnect === true,
        issueScore,
      };
    })
    .filter((row) => row.issueScore > 0)
    .sort((a, b) => b.issueScore - a.issueScore || b.listeners - a.listeners || a.stationName.localeCompare(b.stationName))
    .slice(0, 12);
  const connectionHealthWithIds = {
    ...connectionHealth,
    events: Array.isArray(connectionHealth?.events)
      ? connectionHealth.events.map((event) => ({
        ...event,
        id: event?.id || buildDashboardConnectionEventEntryId(event),
      }))
      : [],
  };

  return {
    serverId: guild.id,
    tier: guild.tier,
    days: safeDays,
    listeningStats: {
      totalListeningMs: listeningStats.currentTotalListeningMs || listeningStats.totalListeningMs || 0,
      totalSessions: listeningStats.totalSessions || 0,
      avgSessionMs: listeningStats.avgSessionMs || 0,
      longestSessionMs: listeningStats.longestSessionMs || 0,
      totalStarts: listeningStats.totalStarts || 0,
      peakListeners: listeningStats.peakListeners || 0,
      stationStarts: listeningStats.stationStarts || {},
      stationListeningMs: listeningStats.stationListeningMs || {},
      stationNames: listeningStats.stationNames || {},
      hours: listeningStats.hours || {},
      daysOfWeek: listeningStats.daysOfWeek || {},
      commands: listeningStats.commands || {},
      voiceChannels: listeningStats.voiceChannels || {},
      voiceChannelNames,
      firstSeenAt: listeningStats.firstSeenAt || 0,
    },
    dailyStats,
    sessionHistory: sessionHistory.map((s) => ({
      id: buildDashboardSessionHistoryEntryId(s),
      stationKey: s.stationKey,
      stationName: s.stationName,
      channelId: s.channelId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationMs: s.durationMs,
      humanListeningMs: s.humanListeningMs,
      peakListeners: s.peakListeners,
      avgListeners: s.avgListeners,
    })),
    connectionHealth: connectionHealthWithIds,
    connectionWindowDays: safeDays,
    listenerTimeline,
    unstableStreams,
    eventInsights,
    activeSessions: activeSessions.map((s) => ({
      botId: s.botId,
      stationKey: s.stationKey,
      stationName: s.stationName,
      channelId: s.channelId,
      currentDurationMs: s.currentDurationMs,
      currentHumanListeningMs: s.currentHumanListeningMs,
      currentAvgListeners: s.currentAvgListeners,
      currentListeners: s.currentListeners,
      peakListeners: s.peakListeners,
    })),
  };
}
