// "💾 Save" in the now-playing panel and /merkliste (#272).
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime: the worker answers the panel button, the commander
// the command and its list.
import { MessageFlags } from "discord.js";

import { log } from "../../lib/logging.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import {
  clearSavedSongs,
  deleteSavedSong,
  listSavedSongs,
  saveSong,
} from "../../saved-songs-store.js";
import {
  buildClearSavedSongsConfirm,
  buildSaveSongReply,
  buildSavedSongsClearedPayload,
  buildSavedSongsListPayload,
  buildSongCard,
  parseSavedSongsCustomId,
} from "../saved-songs.js";
import * as ui from "../../discord/ui/index.js";

// A component update may not carry the ephemeral flag; V2 stays.
function asUpdate(payload) {
  return { ...payload, flags: MessageFlags.IsComponentsV2 };
}

function storeProblem(t, error) {
  if (error === "db_unavailable") {
    return t("Die Merkliste ist gerade nicht erreichbar. Versuch es gleich noch einmal.", "The list is not reachable right now. Please try again in a moment.");
  }
  return t("Das hat nicht geklappt. Versuch es gleich noch einmal.", "That did not work. Please try again in a moment.");
}

const savedSongMethods = {
  /** The song the panel shows right now, in the fields the list keeps; null without a title. */
  collectCurrentSongForSaving(guildId) {
    const state = this.guildState?.get?.(guildId);
    const meta = state?.currentMeta;
    if (!meta) return null;
    const station = this.getResolvedCurrentStation?.(guildId, state)?.station || null;
    const artist = this.normalizeNowPlayingValue(meta.artist, station, meta, 120) || null;
    const title = this.normalizeNowPlayingValue(meta.title, station, meta, 160) || null;
    const displayTitle = this.normalizeNowPlayingValue(meta.displayTitle || meta.streamTitle, station, meta, 220)
      || [artist, title].filter(Boolean).join(" - ")
      || null;
    if (!displayTitle) return null;
    return {
      artist,
      title,
      displayTitle,
      stationKey: state.currentStationKey || null,
      stationName: station?.name || state.currentStationName || null,
      artworkUrl: meta.artworkUrl || null,
    };
  },

  async handleSaveSongControl(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const applicationId = interaction.applicationId || this.client?.application?.id || null;
    const song = this.collectCurrentSongForSaving(interaction.guildId);
    if (!song) {
      return this.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("Gerade kein Titel", "No title right now"),
        description: t(
          "Der Sender schickt gerade keinen Songtitel mit, darum gibt es nichts zu merken.",
          "The station is not sending a song title right now, so there is nothing to save."
        ),
      }));
    }

    const savedAt = new Date();
    const saved = await saveSong(interaction.user?.id, song, { now: savedAt });
    if (!saved.ok) {
      return this.respondInteraction(interaction, buildNoticePayload({
        t, language, tone: "error", title: t("Nicht gemerkt", "Not saved"), description: storeProblem(t, saved.error),
      }));
    }

    let dmSent = false;
    if (!saved.duplicate) {
      dmSent = await interaction.user.send(ui.message(buildSongCard({ t, song, savedAt, applicationId })))
        .then(() => true)
        .catch((error) => {
          // 50007: the person does not take DMs from server members.
          if (error?.code !== 50007) log("WARN", `[${this.config?.name}] Song-Karte per DM fehlgeschlagen: ${error?.message || error}`);
          return false;
        });
    }
    return this.respondInteraction(interaction, buildSaveSongReply({
      t, song, duplicate: saved.duplicate, dmSent, savedAt, applicationId,
    }));
  },

  async buildSavedSongsView(interaction, page = 0) {
    const { t } = this.createInteractionTranslator(interaction);
    const songs = await listSavedSongs(interaction.user?.id);
    return buildSavedSongsListPayload({
      t,
      songs,
      page,
      applicationId: interaction.applicationId || this.client?.application?.id || null,
    });
  },

  /** /merkliste: private, always allowed; it is the person's own data. */
  async handleSavedSongsCommand(interaction) {
    await this.respondInteraction(interaction, await this.buildSavedSongsView(interaction, 0));
  },

  async handleSavedSongsComponent(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const parsed = parseSavedSongsCustomId(interaction.customId);
    if (!parsed) return false;
    const userId = interaction.user?.id;
    const applicationId = interaction.applicationId || this.client?.application?.id || null;

    if (parsed.action === "page" || parsed.action === "clearno") {
      await interaction.update(asUpdate(await this.buildSavedSongsView(interaction, parsed.page)));
      return true;
    }
    if (parsed.action === "delete" && interaction.isStringSelectMenu?.()) {
      const result = await deleteSavedSong(userId, interaction.values?.[0]);
      if (!result.ok) {
        await interaction.reply(buildNoticePayload({ t, language, tone: "error", title: t("Nicht gelöscht", "Not deleted"), description: storeProblem(t, result.error) }));
        return true;
      }
      await interaction.update(asUpdate(await this.buildSavedSongsView(interaction, parsed.page)));
      return true;
    }
    if (parsed.action === "clear") {
      const songs = await listSavedSongs(userId);
      await interaction.update(asUpdate(buildClearSavedSongsConfirm({ t, count: songs.length, page: parsed.page })));
      return true;
    }
    if (parsed.action === "clearyes") {
      const result = await clearSavedSongs(userId);
      if (!result.ok) {
        await interaction.update(asUpdate(buildNoticePayload({ t, language, tone: "error", title: t("Nicht gelöscht", "Not deleted"), description: storeProblem(t, result.error) })));
        return true;
      }
      log("INFO", `[${this.config?.name}] Merkliste geloescht: ${result.deleted} Songs`);
      await interaction.update(asUpdate(buildSavedSongsClearedPayload({ t, deleted: result.deleted, applicationId })));
      return true;
    }
    return false;
  },
};

export { savedSongMethods };
