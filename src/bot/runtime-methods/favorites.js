// Favourite stations (#276): quick buttons in the now-playing panel, edited
// with the star menu of the station browser or in the dashboard.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime: the worker plays a favourite, the commander saves
// the list.
import { MessageFlags, PermissionFlagsBits } from "discord.js";

import { log } from "../../lib/logging.js";
import { getTier } from "../../core/entitlements.js";
import { updateGuildSettings } from "../../lib/guild-settings.js";
import {
  favoriteLimitForTier,
  normalizeFavoriteStations,
  visibleFavoriteKeys,
} from "../../lib/favorite-stations.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import { buildStationCatalog } from "../runtime-panels.js";

const favoriteMethods = {
  /** The stored list, from the settings cache (loaded by the panel loop). */
  getStoredFavoriteStations(guildId) {
    try {
      return normalizeFavoriteStations(this.getCachedGuildSettings?.(guildId)?.favoriteStations);
    } catch {
      return [];
    }
  },

  /** What the panel shows: [{ key, name, color }], available on the plan. */
  getVisibleFavoriteStations(guildId) {
    const stored = this.getStoredFavoriteStations(guildId);
    if (!stored.length) return [];
    const { stationsData } = buildStationCatalog(guildId);
    const stations = stationsData?.stations || {};
    return visibleFavoriteKeys(stored, getTier(guildId), (key) => Boolean(stations[key]))
      .map((key) => ({ key, name: stations[key]?.name || key, color: stations[key]?.color || null }));
  },

  /**
   * Saves the list for the server and lets the panels of this process show
   * it now; workers in other processes pick it up with their settings cache.
   */
  async saveFavoriteStations(guildId, list) {
    const normalized = normalizeFavoriteStations(list);
    const result = normalized.length
      ? await updateGuildSettings(guildId, { favoriteStations: normalized })
      : await updateGuildSettings(guildId, {}, { unset: ["favoriteStations"] });
    for (const runtime of new Set([this, ...(this.workerManager?.workers || [])])) {
      runtime?.invalidateGuildSettingsCache?.(guildId);
      const state = runtime?.guildState?.get?.(guildId);
      if (state?.currentStationKey && typeof runtime.updateNowPlayingEmbed === "function") {
        runtime.updateNowPlayingEmbed(guildId, state, { force: true }).catch(() => null);
      }
    }
    return { ...result, list: normalized };
  },

  /** A favourite button in the panel: the worker switches right here. */
  async handleFavoriteControl(interaction, stationKey) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const permission = this.checkCommandRolePermission?.(interaction, "play");
    if (permission && !permission.ok) {
      await interaction.reply(buildNoticePayload({
        t, language, tone: "warning", title: t("Nicht erlaubt", "Not allowed"),
        description: permission.message || t("Dafür fehlen dir die Rechte.", "You are not allowed to do that."),
      }));
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = interaction.guildId;
    const state = this.guildState?.get?.(guildId);
    const channelId = String(state?.connection?.joinConfig?.channelId || state?.lastChannelId || "").trim();
    if (!state?.currentStationKey || !channelId) {
      await this.respondInteraction(interaction, buildNoticePayload({ t, language, code: "nothing-playing" }));
      return true;
    }
    const { stationsData } = buildStationCatalog(guildId);
    const station = stationsData?.stations?.[stationKey];
    if (!station) {
      await this.respondInteraction(interaction, buildNoticePayload({ t, language, code: "station-unknown" }));
      return true;
    }
    this.clearScheduledEventPlaybackInGuild?.(guildId);
    const result = await this.playInGuild(guildId, channelId, stationKey, stationsData);
    if (!result?.ok) {
      await this.respondInteraction(interaction, buildNoticePayload({ t, language, code: "failed", params: { detail: result?.error || "" } }));
      return true;
    }
    log("INFO", `[${this.config?.name}] Favorit guild=${guildId} -> ${stationKey}`);
    await this.respondInteraction(interaction, buildNoticePayload({
      t, language, tone: "success", title: t("Sender gewechselt", "Station switched"),
      description: t(`📻 Jetzt läuft **${station.name || stationKey}**.`, `📻 Now playing **${station.name || stationKey}**.`),
    }));
    return true;
  },

  /** Whether the person may change the server's favourites (server managers). */
  canEditFavorites(interaction) {
    return interaction?.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) === true;
  },

  favoriteLimitForGuild(guildId) {
    return favoriteLimitForTier(getTier(guildId));
  },
};

export { favoriteMethods };
