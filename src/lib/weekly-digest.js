function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeWeeklyDigestLanguage(value, fallback = "de") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized === "en" ? "en" : "de";
}

function normalizeWeeklyDigestConfig(input = {}, fallbackLanguage = "de") {
  const source = input && typeof input === "object" ? input : {};
  return {
    enabled: source.enabled === true,
    channelId: String(source.channelId || "").trim(),
    dayOfWeek: clampInt(source.dayOfWeek, 0, 6, 1),
    hour: clampInt(source.hour, 0, 23, 9),
    language: normalizeWeeklyDigestLanguage(source.language, fallbackLanguage),
  };
}

function toValidDate(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed;
}

function computeNextWeeklyDigestRunAt(config, now = new Date()) {
  const digest = normalizeWeeklyDigestConfig(config);
  const base = toValidDate(now);
  if (!base) return null;

  const next = new Date(base.getTime());
  const dayOffset = (digest.dayOfWeek - base.getDay() + 7) % 7;
  next.setDate(base.getDate() + dayOffset);
  next.setHours(digest.hour, 0, 0, 0);

  if (next.getTime() < base.getTime()) {
    next.setDate(next.getDate() + 7);
  }

  return next.toISOString();
}

function buildWeeklyDigestMeta(config, { now = new Date(), lastSentAt = null } = {}) {
  const digest = normalizeWeeklyDigestConfig(config);
  const nextRunAt = computeNextWeeklyDigestRunAt(digest, now);
  const lastSent = toValidDate(lastSentAt);

  return {
    ready: digest.enabled === true && Boolean(digest.channelId),
    channelConfigured: Boolean(digest.channelId),
    nextRunAt,
    lastSentAt: lastSent ? lastSent.toISOString() : null,
  };
}

function shouldSendWeeklyDigest(config, { now = new Date(), lastSentAt = null } = {}) {
  const digest = normalizeWeeklyDigestConfig(config);
  const current = toValidDate(now);
  if (!current || digest.enabled !== true || !digest.channelId) return false;
  if (current.getDay() !== digest.dayOfWeek || current.getHours() !== digest.hour) return false;

  const lastSent = toValidDate(lastSentAt);
  if (lastSent && (current.getTime() - lastSent.getTime()) < 23 * 60 * 60 * 1000) {
    return false;
  }

  return true;
}

function formatWeeklyDigestDuration(ms) {
  if (!ms || ms <= 0) return "0m";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function buildWeeklyDigestPreview({
  guildName = "",
  channelId = "",
  channelName = "",
  stats = {},
  dailyStats = [],
  language = "de",
  now = new Date(),
} = {}) {
  const normalizedLanguage = normalizeWeeklyDigestLanguage(language, "de");
  const t = (de, en) => (normalizedLanguage === "de" ? de : en);
  const generatedAt = toValidDate(now, new Date()) || new Date();
  const safeGuildName = String(guildName || "").trim() || "OmniFM";
  const safeChannelId = String(channelId || "").trim();
  const safeChannelName = String(channelName || "").trim();
  const safeStats = stats && typeof stats === "object" ? stats : {};
  const safeDailyStats = Array.isArray(dailyStats) ? dailyStats : [];

  const weekStarts = safeDailyStats.reduce((sum, day) => sum + (Number(day?.totalStarts || 0) || 0), 0);
  const weekListeningMs = safeDailyStats.reduce((sum, day) => sum + (Number(day?.totalListeningMs || 0) || 0), 0);
  const weekSessions = safeDailyStats.reduce((sum, day) => sum + (Number(day?.totalSessions || 0) || 0), 0);
  const weekPeak = safeDailyStats.reduce((peak, day) => Math.max(peak, Number(day?.peakListeners || 0) || 0), 0);

  const stationStarts = safeStats.stationStarts && typeof safeStats.stationStarts === "object"
    ? safeStats.stationStarts
    : {};
  const stationNames = safeStats.stationNames && typeof safeStats.stationNames === "object"
    ? safeStats.stationNames
    : {};

  const topStations = Object.entries(stationStarts)
    .map(([stationKey, count]) => ({
      stationKey,
      stationName: String(stationNames[stationKey] || stationKey || "Unknown"),
      starts: Number(count || 0) || 0,
    }))
    .sort((a, b) => b.starts - a.starts || a.stationName.localeCompare(b.stationName))
    .slice(0, 5);

  const topStationsValue = topStations.length > 0
    ? topStations.map((station, index) => `${index + 1}. **${station.stationName}** (${station.starts}x)`).join("\n")
    : t("Keine Daten", "No data");

  const fields = [
    { name: t("Hoerzeit", "Listening time"), value: formatWeeklyDigestDuration(weekListeningMs), inline: true },
    { name: t("Sessions", "Sessions"), value: String(weekSessions), inline: true },
    { name: t("Starts", "Starts"), value: String(weekStarts), inline: true },
    { name: t("Peak-Zuhoerer", "Peak listeners"), value: String(weekPeak), inline: true },
    { name: t("Gesamte Hoerzeit", "Total listening"), value: formatWeeklyDigestDuration(Number(safeStats.totalListeningMs || 0) || 0), inline: true },
    { name: t("Gesamt Sessions", "Total sessions"), value: String(Number(safeStats.totalSessions || 0) || 0), inline: true },
    { name: t("Top 5 Stationen", "Top 5 stations"), value: topStationsValue, inline: false },
  ];

  return {
    title: t("Woechentlicher Radio-Report", "Weekly radio report"),
    description: t(
      `Hier ist die Zusammenfassung der letzten 7 Tage fuer **${safeGuildName}**:`,
      `Here is the summary for the last 7 days on **${safeGuildName}**:`
    ),
    generatedAt: generatedAt.toISOString(),
    footerText: "OmniFM Weekly Digest",
    channelId: safeChannelId,
    channelName: safeChannelName,
    summary: {
      weekListeningMs,
      weekSessions,
      weekStarts,
      weekPeak,
      totalListeningMs: Number(safeStats.totalListeningMs || 0) || 0,
      totalSessions: Number(safeStats.totalSessions || 0) || 0,
    },
    topStations,
    fields,
  };
}

function buildWeeklyDigestEmbedData(input = {}) {
  const preview = buildWeeklyDigestPreview(input);
  return {
    color: 0xFF6B00,
    title: preview.title,
    description: preview.description,
    fields: preview.fields,
    footer: { text: preview.footerText },
    timestamp: preview.generatedAt,
  };
}

export {
  buildWeeklyDigestMeta,
  buildWeeklyDigestEmbedData,
  buildWeeklyDigestPreview,
  computeNextWeeklyDigestRunAt,
  formatWeeklyDigestDuration,
  normalizeWeeklyDigestConfig,
  shouldSendWeeklyDigest,
};
