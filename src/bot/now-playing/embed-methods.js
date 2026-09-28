// OmniFM: the now-playing embed, message and panel payloads.
// BotRuntime methods, split out of src/bot/now-playing/now-playing-methods.js (#295) and mixed in with it.
import { EmbedBuilder } from "discord.js";
import { clipText, NOW_PLAYING_POLL_MS } from "../../lib/helpers.js";
import { BRAND } from "../../config/plans.js";
import { OMNI_COLORS, tierColor, brandFooter, brandAuthor, versionTag } from "../brand-embed.js";
import { SHARE_CARDS_ENABLED, getTierConfig } from "../runtime-shared.js";
import { buildNowPlayingPanel } from "./now-playing-panel.js";
import {
  NOW_PLAYING_LAYOUT,
  hexColor,
  httpsUrlOrNull,
  musicBrainzUrlFor,
  recentSongTitles,
} from "./now-playing-methods.js";

const nowPlayingEmbedMethods = {
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
    if (NOW_PLAYING_LAYOUT === "classic") {
      return {
        embeds: [this.buildNowPlayingEmbed(guildId, station, meta, context)],
        components: this.buildTrackLinkComponents(guildId, station, meta),
        allowedMentions: { parse: [] },
      };
    }
    return { ...this.buildNowPlayingPanelPayload(guildId, station, meta, context), allowedMentions: { parse: [] } };
  },

  // The data of the panel (#266); the layout lives in now-playing-panel.js.
  buildNowPlayingPanelPayload(guildId, station, meta, context = {}) {
    const language = this.resolveGuildLanguage(guildId);
    const t = (de, en) => (language === "de" ? de : en);
    const tierConfig = getTierConfig(guildId);
    const artist = clipText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 120), 120);
    const title = clipText(this.normalizeNowPlayingValue(meta?.title, station, meta, 140), 140);
    const trackLabel = clipText(
      this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180)
      || [artist, title].filter(Boolean).join(" - "),
      140
    );
    const hasTrack = Boolean(trackLabel);
    const sourceSummary = this.buildNowPlayingSourceSummary(language, meta, hasTrack);
    const recent = recentSongTitles(guildId, meta?.displayTitle);
    const volume = Number.parseInt(String(context?.volume ?? ""), 10);
    const listeners = Math.max(0, Number.parseInt(String(context?.listenerCount || 0), 10) || 0);
    const failover = context?.failover?.active === true && context.failover.desiredName
      ? { active: true, desiredName: context.failover.desiredName, currentName: station?.name || null }
      : null;
    return buildNowPlayingPanel({
      t,
      applicationId: this.getApplicationId?.() || this.client?.application?.id || null,
      workerName: context?.workerName || this.config?.name || BRAND.name,
      planTier: tierConfig.tier,
      station: {
        name: station?.name || meta?.name || null,
        key: context?.stationKey || station?.key || null,
        genre: station?.genre || station?.category || "Radio",
        tier: station?.tier || "free",
        color: hexColor(station?.color),
        logoUrl: httpsUrlOrNull(station?.logo),
      },
      track: {
        hasTrack,
        headline: clipText(title || trackLabel, 110) || trackLabel,
        artist,
        album: clipText(this.normalizeNowPlayingValue(meta?.album, station, meta, 140), 140),
        artworkUrl: meta?.artworkUrl || null,
        sourceNote: sourceSummary.sourceNote,
        sourceLabel: sourceSummary.sourceLabel,
        metadataHint: sourceSummary.metadataHint,
      },
      playback: {
        phase: context?.phase || "playing",
        paused: context?.paused === true,
        listeners,
        bitrate: tierConfig.bitrate || null,
        volume: Number.isFinite(volume) ? volume : Number.NaN,
        channelId: String(context?.channelId || "").trim() || null,
        sleepUntilMs: Number(this.guildState?.get?.(guildId)?.sleepUntilMs) || 0,
      },
      notices: { serverMuted: context?.serverMuted === true, failover },
      recent,
      favorites: this.role === "commander" ? [] : (this.getVisibleFavoriteStations?.(guildId) || []),
      shareEnabled: SHARE_CARDS_ENABLED && this.role !== "commander",
      searchQuery: this.buildTrackSearchQuery(station, meta) || null,
      musicBrainzUrl: musicBrainzUrlFor(meta),
      fallbackImageUrl: this.client?.user?.displayAvatarURL?.({ extension: "png", size: 256 }) || null,
      pollSeconds: Math.round(NOW_PLAYING_POLL_MS / 1000),
      design: this.getPanelDesign(guildId),
      // #426: the server's season from its cached settings and the owner's switches.
      season: this.getGuildSeason?.(guildId) ?? null,
      nowMs: Date.now(),
    });
  },
};

export { nowPlayingEmbedMethods };
