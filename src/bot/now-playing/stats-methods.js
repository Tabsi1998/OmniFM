// OmniFM: the /stats and /history embeds.
// BotRuntime methods, split out of src/bot/now-playing/now-playing-methods.js (#295) and mixed in with it.
import { EmbedBuilder } from "discord.js";
import { clipText } from "../../lib/helpers.js";
import { getGuildListeningStats, getTopGuildsByActivity } from "../../listening-stats-store.js";
import { BRAND } from "../../config/plans.js";
import { OMNI_COLORS, brandFooter, brandAuthor } from "../brand-embed.js";
import { botTranslator } from "../../lib/bot-i18n.js";

const nowPlayingStatsMethods = {
  formatStatsHourBucket(hour, language = "de") {
    const normalizedHour = Number.parseInt(String(hour || 0), 10);
    const safeHour = Number.isFinite(normalizedHour) ? Math.max(0, Math.min(23, normalizedHour)) : 0;
    const nextHour = (safeHour + 1) % 24;
    if (language === "de") {
      return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
    }
    return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
  },

  formatDurationMs(ms, _language = "de") {
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    // The same in every language.
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  },

  buildListeningStatsEmbed(guildId, language = "de") {
    const t = botTranslator(language);
    const guild = this.client.guilds.cache.get(guildId) || null;
    const stats = getGuildListeningStats(guildId);
    const liveStreams = this.getLiveGuildPlaybackSnapshot(guildId);
    const totalLiveListeners = liveStreams.reduce((sum, item) => sum + (Number(item.listenerCount) || 0), 0);
    const topStationEntry = Object.entries(stats?.stationStarts || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    const topHourEntry = Object.entries(stats?.hours || {})
      .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0] || null;
    const topDayEntry = Object.entries(stats?.daysOfWeek || {})
      .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0] || null;
    const dayNames = language === "de"
      ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const topChannels = Object.entries(stats?.voiceChannels || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([channelId, count]) => {
        const name = guild?.channels?.cache?.get(channelId)?.name || channelId;
        return `#${name}: ${count}`;
      });
    const topGuild = getTopGuildsByActivity(1)[0] || null;
    const topGuildName = topGuild
      ? (this.client.guilds.cache.get(topGuild.guildId)?.name || topGuild.guildId)
      : null;
    const liveStationsText = liveStreams.length
      ? liveStreams.map((item) => {
        const stationName = clipText(item.stationName || item.stationKey || "-", 80);
        const voiceLabel = item.channelId ? `<#${item.channelId}>` : t("unbekannt", "unknown");
        return `**${stationName}** - ${voiceLabel} - ${item.listenerCount} ${t("Zuhörer", "listeners")}`;
      }).join("\n")
      : t("Aktuell läuft auf diesem Server kein Stream.", "No stream is currently running on this server.");

    // Calculate total listening time (including active sessions)
    const totalListeningMs = stats?.currentTotalListeningMs || stats?.totalListeningMs || 0;
    const totalListeningText = totalListeningMs > 0
      ? this.formatDurationMs(totalListeningMs, language)
      : t("Noch keine Daten", "No data yet");

    // Connection health
    const totalConnections = stats?.totalConnections || 0;
    const totalReconnects = stats?.totalReconnects || 0;
    const totalDisconnects = stats?.totalConnectionDisconnects || 0;
    const totalErrors = stats?.totalConnectionErrors || 0;
    const successfulConnections = totalConnections + totalReconnects;
    const reliability = (successfulConnections + totalDisconnects + totalErrors) > 0
      ? Math.round((successfulConnections / (successfulConnections + totalDisconnects + totalErrors)) * 100)
      : 100;

    // Session stats
    const avgSessionText = stats?.avgSessionMs > 0
      ? this.formatDurationMs(stats.avgSessionMs, language)
      : "-";
    const longestSessionText = stats?.longestSessionMs > 0
      ? this.formatDurationMs(stats.longestSessionMs, language)
      : "-";

    const embed = new EmbedBuilder()
      .setColor(OMNI_COLORS.cyan)
      .setAuthor(brandAuthor())
      .setTitle(t("📊 Listening-Stats", "📊 Listening stats"))
      .setDescription(
        t(
          "Server: **{server}**\nLive-Zuhörer jetzt: **{listeners}**",
          "Server: **{server}**\nLive listeners now: **{listeners}**",
          { server: guild?.name || guildId, listeners: totalLiveListeners }
        )
      )
      .addFields(
        {
          name: t("Live gerade", "Live now"),
          value: clipText(liveStationsText, 900),
          inline: false,
        },
        {
          name: t("Gesamte Hörzeit", "Total listening time"),
          value: totalListeningText,
          inline: true,
        },
        {
          name: t("Sessions gesamt", "Total sessions"),
          value: String(stats?.totalSessions || 0),
          inline: true,
        },
        {
          name: t("Peak-Zuhörer", "Peak listeners"),
          value: String(Number(stats?.peakListeners || 0)),
          inline: true,
        },
        {
          name: t("Meist gespielte Station", "Most played station"),
          value: topStationEntry
            ? `${clipText(topStationEntry[0], 100)} (${topStationEntry[1]}x)`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Peak-Stunde", "Peak hour"),
          value: topHourEntry && Number(topHourEntry[1]) > 0
            ? `${this.formatStatsHourBucket(topHourEntry[0], language)} (${topHourEntry[1]})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Aktivster Tag", "Busiest day"),
          value: topDayEntry && Number(topDayEntry[1]) > 0
            ? `${dayNames[Number(topDayEntry[0])] || "?"} (${topDayEntry[1]})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Aktivste Voice-Channels", "Most active voice channels"),
          value: topChannels.length ? clipText(topChannels.join("\n"), 900) : t("Noch keine Daten", "No data yet"),
          inline: false,
        },
        {
          name: t("Session-Daten", "Session data"),
          value: t("Durchschnitt: **{average}** | Längste: **{longest}**", "Average: **{average}** | Longest: **{longest}**", { average: avgSessionText, longest: longestSessionText }),
          inline: false,
        },
        {
          name: t("Verbindung", "Connection"),
          value: t(
            "Verbindungen: **{connections}** | Reconnects: **{reconnects}** | Zuverlässigkeit: **{reliability}%**",
            "Connections: **{connections}** | Reconnects: **{reconnects}** | Reliability: **{reliability}%**",
            { connections: totalConnections, reconnects: totalReconnects, reliability }
          ),
          inline: false,
        },
        {
          name: t("Server gesamt", "Server totals"),
          value: t(
            "Starts ohne Recovery: **{starts}**\nLetzter Start: {last}",
            "Starts without recovery: **{starts}**\nLast start: {last}",
            { starts: Number(stats?.totalStarts || 0), last: stats?.lastStartedAt ? this.formatDiscordTimestamp(stats.lastStartedAt, "R") : "-" }
          ),
          inline: true,
        },
        {
          name: t("Top-Server global", "Top server global"),
          value: topGuild
            ? `${clipText(topGuildName, 80)} (${topGuild.totalStarts} ${t("Starts", "starts")})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        }
      )
      .setFooter(brandFooter(t("OmniFM Analytics · /stats", "OmniFM analytics · /stats")))
      .setTimestamp(new Date());

    return embed;
  },

  buildSongHistoryEmbed(history, guildId, playbackRuntime, language = "de") {
    const t = botTranslator(language);
    const lines = history.map((entry, index) => {
      const unix = Number.isFinite(entry.timestampMs) ? Math.floor(entry.timestampMs / 1000) : null;
      const when = unix ? `<t:${unix}:R>` : "-";
      const title = clipText(entry.displayTitle || entry.streamTitle || "-", 150);
      const station = entry.stationName ? clipText(entry.stationName, 80) : null;
      return `${index + 1}. ${when} - **${title}**${station ? `\n${t("Station", "Station")}: ${station}` : ""}`;
    });

    const latest = history[0] || null;
    const embed = new EmbedBuilder()
      .setColor(OMNI_COLORS.orange)
      .setAuthor(brandAuthor())
      .setTitle(t("🕘 Song-History", "🕘 Song history"))
      .setDescription(clipText(lines.join("\n\n"), 3800))
      .setFooter(brandFooter(playbackRuntime
        ? `${playbackRuntime.config?.name || BRAND.name} · ${t("letzte", "latest")} ${history.length}`
        : `${BRAND.name} · ${t("letzte", "latest")} ${history.length}`))
      .setTimestamp(new Date());

    if (latest?.artworkUrl) {
      embed.setThumbnail(latest.artworkUrl);
    }

    return {
      embeds: [embed],
      components: latest
        ? this.buildTrackLinkComponents(guildId, { name: latest.stationName || latest.stationKey || "-" }, latest)
        : [],
    };
  },
};

export { nowPlayingStatsMethods };
