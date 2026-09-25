// "Share" in the now-playing panel (#282): a 1200 × 630 card with cover,
// title, artist, station and server, posted in the channel. Without a song
// title the station card is shared instead. One share per server every 30
// seconds; SHARE_CARDS_ENABLED=0 switches it off under load.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime (the worker that plays).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { log } from "../../lib/logging.js";
import { renderNowPlayingCard, renderStationCard } from "../../lib/share-card.js";
import { loadStations } from "../../stations-store.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import { WEBSITE_URL } from "../runtime-links.js";
import { SHARE_CARDS_ENABLED } from "../runtime-shared.js";

const SHARE_COOLDOWN_MS = 30_000;

const shareMethods = {
  async handleShareCardControl(interaction, { now = Date.now(), enabled = SHARE_CARDS_ENABLED } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = interaction.guildId;
    if (!enabled) {
      await interaction.reply(buildNoticePayload({
        t, language, tone: "info", title: t("Teilen ist aus", "Sharing is off"),
        description: t("Teilen ist auf OmniFM gerade ausgeschaltet.", "Sharing is switched off on OmniFM right now."),
      }));
      return true;
    }
    const state = this.guildState?.get?.(guildId);
    if (!state?.currentStationKey) {
      await interaction.reply(buildNoticePayload({ t, language, code: "nothing-playing" }));
      return true;
    }
    if (!(this.shareCardTimes instanceof Map)) this.shareCardTimes = new Map();
    if (now - (this.shareCardTimes.get(guildId) || 0) < SHARE_COOLDOWN_MS) {
      await interaction.reply(buildNoticePayload({
        t, language, tone: "info", title: t("Gerade erst geteilt", "Just shared"),
        description: t("Die Karte ist eben erst gekommen. In ein paar Sekunden geht es wieder.", "The card came a moment ago. Try again in a few seconds."),
      }));
      return true;
    }
    this.shareCardTimes.set(guildId, now);
    // Drawing and fetching the cover take a moment: acknowledge (public) first.
    await interaction.deferReply();

    const stationKey = state.currentStationKey;
    const official = loadStations()?.stations?.[stationKey] || null;
    const station = this.getResolvedCurrentStation?.(guildId, state)?.station || official || {};
    const stationName = station.name || state.currentStationName || stationKey;
    const song = this.collectCurrentSongForSaving?.(guildId) || null;
    const png = song
      ? await renderNowPlayingCard({
        title: song.title || song.displayTitle,
        artist: song.title ? song.artist : "",
        stationName,
        guildName: interaction.guild?.name || "",
        color: station.color,
        coverUrl: song.artworkUrl || station.logo || null,
        t,
      })
      : await renderStationCard({ key: stationKey, name: stationName, genre: station.genre, color: station.color, logoUrl: station.logo, t });

    const components = [];
    if (official) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t("Sender ansehen", "See the station"))
          .setURL(`${String(WEBSITE_URL).replace(/\/+$/, "")}/api/share/station/${encodeURIComponent(stationKey)}?lang=${language}`),
      ));
    }
    const content = song
      ? `🎧 **${song.title || song.displayTitle}**${song.title && song.artist ? ` – ${song.artist}` : ""} · 📻 ${stationName}`
      : t(`📻 Gerade läuft **${stationName}**`, `📻 Now playing **${stationName}**`);
    await interaction.editReply({
      content: content.slice(0, 1900),
      files: [{ attachment: png, name: "omnifm-jetzt-laeuft.png" }],
      components,
      allowedMentions: { parse: [] },
    });
    log("INFO", `[${this.config?.name}] Karte geteilt guild=${guildId} station=${stationKey}`);
    return true;
  },
};

export { shareMethods };
