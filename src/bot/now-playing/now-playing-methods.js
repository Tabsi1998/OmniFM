// Now-playing message: embed, buttons, channel choice, upsert, refresh loop,
// song history and listening stats embeds, and the now-playing buttons.
// BotRuntime methods, moved out of runtime.js unchanged (#210) and mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { log } from "../../lib/logging.js";
import { buildNowPlayingSignature, getNowPlayingCandidateIds } from "../../lib/now-playing-target.js";
import {
  clipText,
  applyJitter,
  NOW_PLAYING_ENABLED,
  NOW_PLAYING_POLL_MS,
  SONG_HISTORY_ENABLED,
  SONG_HISTORY_MAX_PER_GUILD,
  SONG_HISTORY_DEDUPE_WINDOW_MS,
  NOW_PLAYING_COVER_ENABLED,
} from "../../lib/helpers.js";
import { languagePick } from "../../lib/language.js";
import { fetchStreamSnapshot, normalizeTrackSearchText } from "../../services/now-playing.js";
import { appendSongHistory } from "../../song-history-store.js";
import { getGuildListeningStats, getTopGuildsByActivity } from "../../listening-stats-store.js";
import { BRAND } from "../../config/plans.js";
import {
  OMNI_COLORS,
  tierColor,
  brandFooter,
  brandAuthor,
  versionTag,
} from "../brand-embed.js";
import { STATIONS_COMPONENT_ID_OPEN } from "../runtime-links.js";
import { getRuntimeConnectedChannelId, isRuntimePlaybackActive } from "../runtime-live-state.js";
import { runRuntimeFailbackProbe, keepRuntimeFailoverStation } from "../runtime-streams.js";
import {
  NP_PREFIX,
  getTierConfig,
} from "../runtime-shared.js";

const nowPlayingMethods = {
  logNowPlayingIssue(guildId, state, message) {
    const now = Date.now();
    const cooldownMs = 120_000;
    if (state.nowPlayingLastErrorAt && now - state.nowPlayingLastErrorAt < cooldownMs) return;
    state.nowPlayingLastErrorAt = now;
    log("INFO", `[${this.config.name}] NowPlaying guild=${guildId}: ${message}`);
  },

  markNowPlayingTargetDirty(state, preferredChannelId = null) {
    const normalizedPreferredChannelId = String(preferredChannelId || "").trim();
    const currentTargetChannelId = String(state?.nowPlayingChannelId || "").trim();
    if (normalizedPreferredChannelId && currentTargetChannelId === normalizedPreferredChannelId) {
      return false;
    }

    state.nowPlayingMessageId = null;
    state.nowPlayingSignature = null;
    if (!normalizedPreferredChannelId || currentTargetChannelId !== normalizedPreferredChannelId) {
      state.nowPlayingChannelId = null;
    }
    return true;
  },

  canSendNowPlayingToChannel(channel, me) {
    if (!channel || typeof channel.send !== "function") return false;
    if (!me) return false;
    if (channel.isThread?.() && channel.archived) return false;
    const perms = channel.permissionsFor?.(me);
    return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
  },

  async fetchGuildChannelById(guild, channelId) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return null;
    return guild.channels.cache.get(normalizedChannelId)
      || await guild.channels.fetch(normalizedChannelId).catch(() => null);
  },

  scoreNowPlayingFallbackChannel(channel) {
    const name = String(channel?.name || "").toLowerCase();
    let score = 0;
    if (name.includes("now-playing") || name.includes("nowplaying")) score += 500;
    if (name.includes("music") || name.includes("radio") || name.includes("musik")) score += 420;
    if (name.includes("bot") || name.includes("command") || name.includes("kommando")) score += 260;
    if (name.includes("general") || name.includes("allgemein")) score += 180;
    if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) score += 120;
    score -= Number(channel?.rawPosition || 0);
    return score;
  },

  normalizeNowPlayingValue(value, station, meta = null, maxLength = 240) {
    const normalized = clipText(String(value || "").trim(), maxLength);
    if (!normalized) return null;

    const lower = normalized.toLowerCase();
    const blockedValues = new Set(["-", "--", "n/a", "na", "none", "null", "undefined", "unknown"]);
    if (blockedValues.has(lower)) return null;

    const knownStationTexts = [
      station?.name,
      meta?.name,
      meta?.description,
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);

    if (knownStationTexts.includes(lower)) return null;
    return normalized;
  },

  isFreshNowPlayingTrack(meta) {
    const detectedAtMs = Number.parseInt(String(meta?.trackDetectedAtMs || 0), 10);
    if (!Number.isFinite(detectedAtMs) || detectedAtMs <= 0) return false;
    return (Date.now() - detectedAtMs) <= (NOW_PLAYING_POLL_MS * 4);
  },

  buildTrackSearchQuery(station, meta) {
    const artist = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 100));
    const title = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.title, station, meta, 120));
    const displayTitle = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180));
    const query = artist && title ? `${artist} ${title}` : displayTitle;
    return clipText(query || "", 180) || null;
  },

  buildTrackLinkComponentsLegacy(guildId, station, meta) {
    const query = this.buildTrackSearchQuery(station, meta);
    if (!query) return [];

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("▶ YouTube")
        .setEmoji("\u25b6")
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("♫ Spotify")
        .setURL(`https://open.spotify.com/search/${encodeURIComponent(query)}`)
    );

    return [row];
  },

  buildTrackLinkComponents(guildId, station, meta) {
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";
    const rows = [];

    // Steuerungs-Row (immer sichtbar): Pause/Weiter · Stop · Lautstaerke -/+ · Sender wechseln.
    const state = this.guildState.get(guildId);
    const status = state?.player?.state?.status;
    const paused = status === "paused" || status === "autopaused";
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NP_PREFIX}toggle`)
        .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setEmoji(paused ? "\u25b6" : "\u23f8")
        .setLabel(paused ? (isDe ? "Weiter" : "Resume") : "Pause"),
      new ButtonBuilder()
        .setCustomId(`${NP_PREFIX}stop`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji("\u23f9")
        .setLabel("Stop"),
      new ButtonBuilder()
        .setCustomId(`${NP_PREFIX}voldown`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("\u{1f509}"),
      new ButtonBuilder()
        .setCustomId(`${NP_PREFIX}volup`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("\u{1f50a}"),
      new ButtonBuilder()
        .setCustomId(STATIONS_COMPONENT_ID_OPEN)
        .setStyle(ButtonStyle.Primary)
        .setEmoji("\u{1f4fb}")
        .setLabel(isDe ? "Sender" : "Stations"),
    );
    rows.push(controlRow);

    // Backup station active: one click brings the preferred station back or
    // keeps the backup for good (#216).
    if (
      state?.failoverActive === true
      && state.desiredStationKey
      && state.desiredStationKey !== state.currentStationKey
    ) {
      const desiredName = clipText(state.desiredStationName || state.desiredStationKey, 50);
      const currentName = clipText(state.currentStationName || state.currentStationKey, 50);
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${NP_PREFIX}failback`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("\u21a9")
          .setLabel(clipText(isDe ? `Zurück zu ${desiredName}` : `Back to ${desiredName}`, 80)),
        new ButtonBuilder()
          .setCustomId(`${NP_PREFIX}keepstation`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("\u2714")
          .setLabel(clipText(isDe ? `${currentName} behalten` : `Keep ${currentName}`, 80)),
      ));
    }

    // Link-Row (nur wenn ein Track erkannt wurde): YouTube / Spotify / MusicBrainz.
    const query = this.buildTrackSearchQuery(station, meta);
    if (query) {
      const buttons = [
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(isDe ? "YouTube-Suche" : "YouTube search")
          .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)
          .setEmoji("\u{1f4fa}"),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(isDe ? "Spotify-Suche" : "Spotify search")
          .setURL(`https://open.spotify.com/search/${encodeURIComponent(query)}`)
          .setEmoji("\u{1f3b5}"),
      ];

      const musicBrainzUrl = meta?.musicBrainzReleaseId
        ? `https://musicbrainz.org/release/${encodeURIComponent(meta.musicBrainzReleaseId)}`
        : (meta?.musicBrainzRecordingId
          ? `https://musicbrainz.org/recording/${encodeURIComponent(meta.musicBrainzRecordingId)}`
          : null);

      if (musicBrainzUrl) {
        buttons.push(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel("MusicBrainz")
            .setURL(musicBrainzUrl)
            .setEmoji("\u{1f9e0}")
        );
      }

      rows.push(new ActionRowBuilder().addComponents(...buttons));
    }

    return rows;
  },

  buildNowPlayingSourceSummary(language, meta, hasTrack) {
    const isDe = language === "de";
    const metadataSource = String(meta?.metadataSource || "").trim().toLowerCase();
    const metadataStatus = String(meta?.metadataStatus || (hasTrack ? "ok" : "empty")).trim().toLowerCase();
    const recognitionConfidence = Number.parseFloat(String(meta?.recognitionConfidence ?? ""));

    let sourceLabel = isDe ? "Unbekannt" : "Unknown";
    let sourceDetail = sourceLabel;
    let sourceNote = null;

    if (metadataSource === "icy") {
      sourceLabel = isDe ? "Sender-Metadaten" : "Station metadata";
      sourceDetail = sourceLabel;
    } else if (metadataSource === "recognition") {
      sourceLabel = isDe ? "Audio-Fingerprint" : "Audio fingerprint";
      sourceDetail = [
        meta?.recognitionProvider || "AcoustID",
        Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
      ].filter(Boolean).join(" | ") || sourceLabel;
      sourceNote = isDe
        ? "Per Audio-Fingerprint erkannt."
        : "Matched via audio fingerprint.";
    } else if (metadataSource === "icy+recognition") {
      sourceLabel = isDe ? "Metadaten + Fingerprint" : "Metadata + fingerprint";
      sourceDetail = [
        isDe ? "Sender-Metadaten ergänzt" : "Station metadata enriched",
        meta?.recognitionProvider || "AcoustID",
        Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
      ].filter(Boolean).join(" | ");
      sourceNote = isDe
        ? "Senderdaten wurden per Audio-Fingerprint ergänzt."
        : "Station data was enriched via audio fingerprint.";
    } else if (metadataSource === "stream") {
      sourceLabel = isDe ? "Stream-Info" : "Stream info";
      sourceDetail = sourceLabel;
    }

    let metadataHint = null;
    if (!hasTrack) {
      metadataHint = metadataStatus === "unsupported"
        ? (isDe
          ? "Dieser Stream sendet aktuell keine lesbaren Songdaten."
          : "This stream is not sending readable track data right now.")
        : (isDe
          ? "Dieser Sender liefert aktuell keine verwertbaren Songdaten."
          : "This station is not providing usable track data right now.");
    }

    return { metadataSource, sourceLabel, sourceDetail, sourceNote, metadataHint };
  },

  formatStatsHourBucket(hour, language = "de") {
    const normalizedHour = Number.parseInt(String(hour || 0), 10);
    const safeHour = Number.isFinite(normalizedHour) ? Math.max(0, Math.min(23, normalizedHour)) : 0;
    const nextHour = (safeHour + 1) % 24;
    if (language === "de") {
      return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
    }
    return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
  },

  formatDurationMs(ms, language = "de") {
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return language === "de" ? `${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
    }
    return language === "de" ? `${minutes}m` : `${minutes}m`;
  },

  buildListeningStatsEmbed(guildId, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
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
          `Server: **${guild?.name || guildId}**\nLive-Zuhörer jetzt: **${totalLiveListeners}**`,
          `Server: **${guild?.name || guildId}**\nLive listeners now: **${totalLiveListeners}**`
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
          value: t(
            `Durchschnitt: **${avgSessionText}** | Längste: **${longestSessionText}**`,
            `Average: **${avgSessionText}** | Longest: **${longestSessionText}**`
          ),
          inline: false,
        },
        {
          name: t("Verbindung", "Connection"),
          value: t(
            `Verbindungen: **${totalConnections}** | Reconnects: **${totalReconnects}** | Zuverlässigkeit: **${reliability}%**`,
            `Connections: **${totalConnections}** | Reconnects: **${totalReconnects}** | Reliability: **${reliability}%**`
          ),
          inline: false,
        },
        {
          name: t("Server gesamt", "Server totals"),
          value: t(
            `Starts ohne Recovery: **${Number(stats?.totalStarts || 0)}**\nLetzter Start: ${stats?.lastStartedAt ? this.formatDiscordTimestamp(stats.lastStartedAt, "R") : "-"}`,
            `Starts without recovery: **${Number(stats?.totalStarts || 0)}**\nLast start: ${stats?.lastStartedAt ? this.formatDiscordTimestamp(stats.lastStartedAt, "R") : "-"}`
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
    const t = (de, en) => languagePick(language, de, en);
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

  async resolveNowPlayingChannel(guildId, state) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;

    const me = await this.resolveBotMember(guild);
    if (!me) return null;

    const uniqueCandidateIds = getNowPlayingCandidateIds(state, guild);

    for (const candidateId of uniqueCandidateIds) {
      const channel = await this.fetchGuildChannelById(guild, candidateId);
      if (this.canSendNowPlayingToChannel(channel, me)) {
        return channel;
      }
    }

    if (!guild.channels?.cache?.size) {
      await guild.channels.fetch().catch(() => null);
    }

    const fallbackChannels = [...guild.channels.cache.values()].filter((channel) => {
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        return false;
      }
      return this.canSendNowPlayingToChannel(channel, me);
    });

    fallbackChannels.sort((a, b) => this.scoreNowPlayingFallbackChannel(b) - this.scoreNowPlayingFallbackChannel(a));
    return fallbackChannels[0] || null;
  },

  buildNowPlayingEmbed(guildId, station, meta, context = {}) {
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";
    const tierConfig = getTierConfig(guildId);
    const stationName = clipText(station?.name || meta?.name || "-", 120) || "-";
    const stationKey = clipText(String(context?.stationKey || station?.key || "").trim(), 80);
    const stationGenre = clipText(String(station?.genre || station?.category || (isDe ? "Radio" : "Radio")).trim(), 80) || "Radio";
    const stationTier = String(station?.tier || "free").trim().toUpperCase();
    const artist = clipText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 120), 120);
    const title = clipText(this.normalizeNowPlayingValue(meta?.title, station, meta, 140), 140);
    const album = clipText(this.normalizeNowPlayingValue(meta?.album, station, meta, 140), 140);
    const trackLabel = clipText(
      this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180)
      || ([artist, title].filter(Boolean).join(" - ")),
      140
    );
    const headline = clipText(title || trackLabel || "", 110) || trackLabel;
    const streamInfo = this.normalizeNowPlayingValue(meta?.description, station, meta, 240);
    const hasTrack = Boolean(trackLabel);
    const listenerCount = Math.max(0, Number.parseInt(String(context?.listenerCount || 0), 10) || 0);
    const parsedVolume = Number.parseInt(String(context?.volume ?? ""), 10);
    const visibleVolume = Number.isFinite(parsedVolume)
      ? `${Math.max(0, Math.min(100, parsedVolume))}%`
      : null;
    const voiceChannelId = String(context?.channelId || "").trim();
    const workerName = clipText(String(context?.workerName || this.config.name || BRAND.name), 60) || BRAND.name;
    const embed = new EmbedBuilder()
      .setTimestamp(new Date(meta?.updatedAt || Date.now()));
    if (meta?.artworkUrl) {
      embed.setThumbnail(meta.artworkUrl);
    }

    const sourceSummary = this.buildNowPlayingSourceSummary(language, meta, hasTrack);
    const visibleListenerCount = listenerCount >= 2 ? String(listenerCount) : null;
    const descriptionLines = [];
    if (hasTrack) {
      // Großer Titel + dezente Unterzeile (Artist · Sender) im Website-Stil.
      descriptionLines.push(`## ${headline}`);
      const subParts = [artist].filter(Boolean);
      if (subParts.length) descriptionLines.push(`-# ${subParts.join("  ·  ")}`);
      if (sourceSummary.sourceNote) descriptionLines.push(`-# ${sourceSummary.sourceNote}`);
    } else {
      descriptionLines.push(`## ${stationName}`);
      descriptionLines.push(`-# ${isDe ? "Live-Radio-Stream läuft" : "Live radio stream playing"}`);
      descriptionLines.push(`> ⚠️ ${sourceSummary.metadataHint}`);
    }

    if (context?.serverMuted === true) {
      descriptionLines.push(isDe
        ? "> \u{1f507} OmniFM ist auf diesem Server stummgeschaltet, niemand hört den Stream. Rechtsklick auf OmniFM im Sprachkanal → Server-Stummschaltung aufheben."
        : "> \u{1f507} OmniFM is server-muted here, nobody hears the stream. Right-click OmniFM in the voice channel → remove the server mute.");
    }
    const failoverDesiredName = clipText(String(context?.failover?.desiredName || "").trim(), 80);
    if (context?.failover?.active === true && failoverDesiredName) {
      descriptionLines.push(isDe
        ? `> \u21aa Ersatzsender aktiv: **${failoverDesiredName}** ist gerade nicht erreichbar. OmniFM prüft ihn automatisch und wechselt zurück, sobald er wieder läuft.`
        : `> \u21aa Backup station active: **${failoverDesiredName}** is unreachable right now. OmniFM keeps checking and switches back once it plays again.`);
    }

    const stationDetails = [stationGenre, stationTier !== "FREE" ? stationTier : null].filter(Boolean).join(" · ");
    const stableFields = [
      {
        name: isDe ? "📻 Sender" : "📻 Station",
        value: `**${stationName}**\n${stationDetails}${stationKey ? `\n-# ID: \`${stationKey}\`` : ""}`,
        inline: false,
      },
      {
        name: isDe ? "\u{1f3a7} Qualit\u00e4t" : "\u{1f3a7} Quality",
        value: tierConfig.bitrate || "\u2014",
        inline: true,
      },
    ];

    if (voiceChannelId) {
      stableFields.push({
        name: isDe ? "\u{1f39b} L\u00e4uft in" : "\u{1f39b} Running in",
        value: `<#${voiceChannelId}>`,
        inline: true,
      });
    }
    if (visibleListenerCount) {
      stableFields.push({
        name: isDe ? "\u{1f465} H\u00f6ren gerade" : "\u{1f465} Listening now",
        value: visibleListenerCount,
        inline: true,
      });
    }
    if (visibleVolume) {
      stableFields.push({
        name: isDe ? "\u{1f50a} Lautst\u00e4rke" : "\u{1f50a} Volume",
        value: visibleVolume,
        inline: true,
      });
    }
    if (album) {
      stableFields.push({
        name: "\u{1f4bf} Album",
        value: album,
        inline: true,
      });
    }
    if (streamInfo) {
      stableFields.push({
        name: isDe ? "\u2139\ufe0f Stream-Info" : "\u2139\ufe0f Stream info",
        value: streamInfo,
        inline: false,
      });
    }

    const stableFooterParts = [
      `${workerName} \u00b7 ${BRAND.name}`,
      sourceSummary.sourceLabel,
      isDe ? `\u21bb Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s` : `\u21bb Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
      versionTag(),
    ].filter(Boolean);

    embed
      .setColor(hasTrack ? tierColor(tierConfig.tier) : OMNI_COLORS.warning)
      .setTitle(isDe ? "\u{1f534} LIVE \u00b7 Jetzt auf Sendung" : "\u{1f534} LIVE \u00b7 On air now")
      .setDescription(descriptionLines.join("\n"))
      .setAuthor(brandAuthor(`${workerName} \u00b7 ${BRAND.name}`, this.client.user?.displayAvatarURL?.({ extension: "png", size: 128 })))
      .setFooter(brandFooter(stableFooterParts.join("  \u00b7  ")));

    const existingFieldCount = Array.isArray(embed.data?.fields) ? embed.data.fields.length : 0;
    if (existingFieldCount > 0) {
      embed.spliceFields(0, existingFieldCount, ...stableFields);
    } else if (stableFields.length > 0) {
      embed.addFields(...stableFields);
    }

    return embed;
  },

  buildNowPlayingMessagePayload(guildId, station, meta, context = {}) {
    return {
      embeds: [this.buildNowPlayingEmbed(guildId, station, meta, context)],
      components: this.buildTrackLinkComponents(guildId, station, meta),
      allowedMentions: { parse: [] },
    };
  },

  recordSongHistory(guildId, state, station, meta) {
    if (!SONG_HISTORY_ENABLED) return;
    if (!meta) return;

    const displayTitle = clipText(meta.displayTitle || meta.streamTitle || "", 220);
    if (!displayTitle) return;

    try {
      appendSongHistory(guildId, {
        botId: this.config.id,
        stationKey: state.currentStationKey || null,
        stationName: station?.name || state.currentStationName || null,
        displayTitle,
        streamTitle: clipText(meta.streamTitle || "", 220) || null,
        artist: clipText(meta.artist || "", 120) || null,
        title: clipText(meta.title || "", 120) || null,
        artworkUrl: clipText(meta.artworkUrl || "", 600) || null,
        timestampMs: Date.now(),
      }, {
        maxPerGuild: SONG_HISTORY_MAX_PER_GUILD,
        dedupeWindowMs: SONG_HISTORY_DEDUPE_WINDOW_MS,
      });
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, `SongHistory: ${clipText(err?.message || String(err), 180)}`);
    }
  },

  async upsertNowPlayingMessage(guildId, state, payload, channelOverride = null) {
    const channel = channelOverride || await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) return false;

    if (state.nowPlayingChannelId && state.nowPlayingChannelId !== channel.id) {
      state.nowPlayingMessageId = null;
    }
    state.nowPlayingChannelId = channel.id;

    const messagePayload = {
      embeds: [],
      allowedMentions: { parse: [] },
      components: [],
    };
    if (Array.isArray(payload?.embeds)) {
      messagePayload.embeds = payload.embeds;
    }
    if (Array.isArray(payload?.components)) {
      messagePayload.components = payload.components;
    }

    if (state.nowPlayingMessageId && channel.messages?.fetch) {
      const existing = await channel.messages.fetch(state.nowPlayingMessageId).catch(() => null);
      if (existing?.edit) {
        try {
          await existing.edit(messagePayload);
          return true;
        } catch (err) {
          this.logNowPlayingIssue(
            guildId,
            state,
            `Edit fehlgeschlagen in #${channel.name || channel.id}: ${clipText(err?.message || String(err), 160)}`
          );
          state.nowPlayingMessageId = null;
        }
      }
    }

    try {
      const sent = await channel.send(messagePayload);
      if (sent?.id) {
        state.nowPlayingMessageId = sent.id;
      }
      return true;
    } catch (err) {
      this.logNowPlayingIssue(
        guildId,
        state,
        `Senden fehlgeschlagen in #${channel.name || channel.id}: ${clipText(err?.message || String(err), 160)}`
      );
      return false;
    }
  },

  async updateNowPlayingEmbed(guildId, state, { force = false } = {}) {
    if (!NOW_PLAYING_ENABLED) return;
    if (!state.currentStationKey) return;
    if (!isRuntimePlaybackActive(this, guildId, state)) return;
    const channel = await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) {
      this.logNowPlayingIssue(guildId, state, "Kein geeigneter Kanal fuer die Live-Einbettung gefunden.");
      return;
    }

    const stationKey = state.currentStationKey;
    const resolvedStation = this.getResolvedCurrentStation(guildId, state);
    const station = resolvedStation?.station || null;
    if (!station?.url) return;

    try {
      const snapshot = await fetchStreamSnapshot(station.url, { includeCover: NOW_PLAYING_COVER_ENABLED });
      if (state.currentStationKey !== stationKey) return;

      const previousMeta = state.currentMeta || {};
      const artist = this.normalizeNowPlayingValue(snapshot.artist, station, snapshot, 120);
      const title = this.normalizeNowPlayingValue(snapshot.title, station, snapshot, 120);
      const streamTitle = this.normalizeNowPlayingValue(snapshot.streamTitle, station, snapshot, 180);
      const displayTitle = this.normalizeNowPlayingValue(snapshot.displayTitle || snapshot.streamTitle, station, snapshot, 180)
        || ([artist, title].filter(Boolean).join(" - ") || null);
      const hasFreshTrack = Boolean(displayTitle || artist || title);
      const keepPreviousTrack = !hasFreshTrack && this.isFreshNowPlayingTrack(previousMeta);
      const sameTrackAsPrevious = Boolean(
        displayTitle
        && String(previousMeta.displayTitle || "").trim()
        && displayTitle.toLowerCase() === String(previousMeta.displayTitle || "").trim().toLowerCase()
      );

      const nextMeta = {
        name: this.normalizeNowPlayingValue(snapshot.name, station, snapshot, 120) || previousMeta?.name || station.name || stationKey,
        description: this.normalizeNowPlayingValue(snapshot.description, station, snapshot, 240) || previousMeta?.description || null,
        streamTitle: streamTitle || (keepPreviousTrack ? previousMeta.streamTitle || null : null),
        artist: artist || (keepPreviousTrack ? previousMeta.artist || null : null),
        title: title || (keepPreviousTrack ? previousMeta.title || null : null),
        displayTitle: displayTitle || (keepPreviousTrack ? previousMeta.displayTitle || null : null),
        artworkUrl: snapshot.artworkUrl || ((keepPreviousTrack || sameTrackAsPrevious) ? previousMeta.artworkUrl || null : null),
        album: this.normalizeNowPlayingValue(snapshot.album, station, snapshot, 120) || (keepPreviousTrack ? previousMeta.album || null : null),
        metadataSource: snapshot.metadataSource || previousMeta.metadataSource || null,
        metadataStatus: hasFreshTrack
          ? (snapshot.metadataStatus || "ok")
          : (keepPreviousTrack ? previousMeta.metadataStatus || "ok" : (snapshot.metadataStatus || "empty")),
        recognitionProvider: snapshot.recognitionProvider || (keepPreviousTrack ? previousMeta.recognitionProvider || null : null),
        recognitionConfidence: Number.isFinite(Number(snapshot.recognitionConfidence))
          ? Number(snapshot.recognitionConfidence)
          : (keepPreviousTrack && Number.isFinite(Number(previousMeta.recognitionConfidence))
            ? Number(previousMeta.recognitionConfidence)
            : null),
        musicBrainzRecordingId: snapshot.musicBrainzRecordingId || (keepPreviousTrack ? previousMeta.musicBrainzRecordingId || null : null),
        musicBrainzReleaseId: snapshot.musicBrainzReleaseId || (keepPreviousTrack ? previousMeta.musicBrainzReleaseId || null : null),
        updatedAt: new Date().toISOString(),
        trackDetectedAtMs: hasFreshTrack
          ? Date.now()
          : (keepPreviousTrack ? Number.parseInt(String(previousMeta.trackDetectedAtMs || 0), 10) || 0 : 0),
      };
      state.currentMeta = nextMeta;
      this.recordSongHistory(guildId, state, station, nextMeta);

      const signature = buildNowPlayingSignature(stationKey, nextMeta, state, channel.id);

      if (!force && signature === state.nowPlayingSignature) {
        return;
      }

      const listenerCount = this.getCurrentListenerCount(guildId, state);
      const voiceChannelId = getRuntimeConnectedChannelId(this, guildId, state, {
        includeObserved: true,
        includeLastKnown: true,
      }) || null;
      const payload = this.buildNowPlayingMessagePayload(guildId, station, nextMeta, {
        stationKey,
        channelId: voiceChannelId,
        listenerCount,
        volume: state.volume,
        workerName: this.config.name,
        serverMuted: state.serverMuted === true,
        failover: state.failoverActive === true
          ? { active: true, desiredName: state.desiredStationName || state.desiredStationKey || "" }
          : null,
      });
      const sent = await this.upsertNowPlayingMessage(guildId, state, payload, channel);
      if (sent) {
        state.nowPlayingSignature = signature;
      }
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
    }
  },

  startNowPlayingLoop(guildId, state) {
    this.clearNowPlayingTimer(state);
    state.nowPlayingSignature = null;
    if (!NOW_PLAYING_ENABLED || !state.currentStationKey) return;

    const taskId = `guild-${guildId}-nowplaying`;
    const update = async () => {
      try {
        await this.updateNowPlayingEmbed(guildId, state);
      } catch (err) {
        this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
      }
    };

    // Enqueue first update immediately
    this.nowPlayingQueue.enqueue(taskId, update);

    // Schedule recurring updates with jitter to spread load
    const scheduleNextUpdate = () => {
      if (!state.currentStationKey) return; // Stop if station changed

      const jitterMs = applyJitter(NOW_PLAYING_POLL_MS, 0.2); // ±20% jitter
      state.nowPlayingRefreshTimer = setTimeout(() => {
        this.nowPlayingQueue.enqueue(taskId, update);
        scheduleNextUpdate(); // Reschedule next
      }, jitterMs);
    };

    scheduleNextUpdate();
  },

  // Live-Steuerung direkt aus der Now-Playing-Nachricht (Buttons).
  async handleNowPlayingControl(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: t("Nur in Servern verfuegbar.", "Only available in servers."), flags: MessageFlags.Ephemeral });
      return true;
    }
    // Discord requires an acknowledgement within three seconds. Voice/player
    // operations and the embed refresh can take longer, so acknowledge first.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const action = String(interaction.customId || "").slice(NP_PREFIX.length);
    const state = this.guildState.get(guildId);

    // A button does what its slash command does, so it follows the same /perm
    // role rules; before, anyone who saw the message could stop the stream (#232).
    const statusBefore = state?.player?.state?.status;
    const buttonCommand = {
      toggle: statusBefore === "paused" || statusBefore === "autopaused" ? "resume" : "pause",
      stop: "stop",
      volup: "setvolume",
      voldown: "setvolume",
      failback: "play",
      keepstation: "play",
    }[action];
    if (buttonCommand && typeof this.checkCommandRolePermission === "function") {
      const permission = this.checkCommandRolePermission(interaction, buttonCommand);
      if (!permission?.ok) {
        await interaction.editReply({ content: permission?.message || t("Dafür fehlen dir die Rechte.", "You are not allowed to do that.") });
        return true;
      }
    }

    let result = { ok: false, error: t("Es laeuft gerade nichts.", "Nothing is playing right now.") };
    let msg = "";

    if (action === "toggle") {
      const status = state?.player?.state?.status;
      const paused = status === "paused" || status === "autopaused";
      result = paused ? await this.resumeInGuild(guildId) : await this.pauseInGuild(guildId);
      msg = paused ? t("\u25b6 Wiedergabe fortgesetzt.", "\u25b6 Resumed.") : t("\u23f8 Pausiert.", "\u23f8 Paused.");
    } else if (action === "stop") {
      result = await this.stopInGuild(guildId);
      msg = t("\u23f9 Wiedergabe gestoppt.", "\u23f9 Playback stopped.");
    } else if (action === "volup" || action === "voldown") {
      const cur = Number(state?.volume ?? 100);
      const next = Math.max(0, Math.min(100, cur + (action === "volup" ? 10 : -10)));
      result = await this.setVolumeInGuild(guildId, next);
      msg = `\u{1f50a} ${t("Lautstaerke", "Volume")}: ${next}%`;
    } else if (action === "failback") {
      const desiredName = state?.desiredStationName || state?.desiredStationKey || "-";
      if (!state || state.failoverActive !== true) {
        result = { ok: false, error: t("Es ist gerade kein Ersatzsender aktiv.", "No backup station is active right now.") };
      } else {
        const probe = await runRuntimeFailbackProbe(this, guildId, state, { requiredConfirmations: 1 });
        if (probe?.switched) {
          result = { ok: true };
          msg = t(`\u21a9 Zurück auf ${desiredName}.`, `\u21a9 Back on ${desiredName}.`);
        } else if (probe?.abandoned) {
          result = {
            ok: false,
            error: t(
              `${desiredName} ist auf diesem Server nicht mehr verfügbar. OmniFM bleibt beim aktuellen Sender.`,
              `${desiredName} is no longer available on this server. OmniFM stays on the current station.`
            ),
          };
        } else if (probe?.skipped === "paused") {
          result = {
            ok: false,
            error: t("Die Wiedergabe ist pausiert. Setze sie fort und versuche es erneut.", "Playback is paused. Resume it and try again."),
          };
        } else if (probe?.skipped) {
          result = {
            ok: false,
            error: t(
              "OmniFM stellt die Verbindung gerade wieder her. Versuche es in einer Minute erneut.",
              "OmniFM is restoring the connection right now. Try again in a minute."
            ),
          };
        } else {
          result = {
            ok: false,
            error: t(
              `${desiredName} ist noch nicht erreichbar. OmniFM prüft automatisch weiter und wechselt zurück, sobald der Sender wieder läuft.`,
              `${desiredName} is not reachable yet. OmniFM keeps checking and switches back once the station plays again.`
            ),
          };
        }
      }
    } else if (action === "keepstation") {
      const kept = state ? keepRuntimeFailoverStation(this, guildId, state) : { ok: false };
      result = kept.ok
        ? { ok: true }
        : { ok: false, error: t("Es ist gerade kein Ersatzsender aktiv.", "No backup station is active right now.") };
      msg = t(
        `\u2714 ${state?.currentStationName || state?.currentStationKey || "-"} bleibt der Sender für diesen Server.`,
        `\u2714 ${state?.currentStationName || state?.currentStationKey || "-"} stays the station for this server.`
      );
    } else {
      await interaction.editReply({ content: t("Unbekannte Aktion.", "Unknown action.") });
      return true;
    }

    if (!result?.ok) {
      await interaction.editReply({ content: result?.error || t("Aktion fehlgeschlagen.", "Action failed.") });
      return true;
    }

    // Now-Playing-Nachricht sofort aktualisieren (Buttons/State spiegeln).
    try {
      const fresh = this.guildState.get(guildId);
      if (fresh && typeof this.updateNowPlayingEmbed === "function" && action !== "stop") {
        await this.updateNowPlayingEmbed(guildId, fresh, { force: true }).catch(() => {});
      }
    } catch { /* noop */ }

    await interaction.editReply({ content: msg });
    return true;
  },
};

export { nowPlayingMethods };
