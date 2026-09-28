// The Easter egg hunt (#429): the dice for each new song, the click on the
// egg and /ostereier. BotRuntime methods, mixed into BotRuntime.prototype in
// runtime.js. Every bot with a panel hides eggs; an egg belongs to the bot
// whose panel shows it, so the click comes back to that bot.
import { MessageFlags } from "discord.js";

import { log } from "../../lib/logging.js";
import { ownerSettings } from "../../lib/owner-settings-cache.js";
import { eggHuntFor, eggPoints, nextEggHunt, rollEgg, songKey } from "../../lib/easter-eggs.js";
import { DEFAULT_SEASON_TIME_ZONE, isValidTimeZone, normalizeSeasonSettings } from "../../lib/seasons.js";
import { claimEgg, eggBoard, eggStoreAvailable, latestEggYear } from "../../easter-eggs-store.js";
import { buildEggBoard, eggAnswer } from "../easter-eggs.js";

// An edited reply keeps being private; the ephemeral flag may not come again.
function asEdit(payload) {
  const { flags, ...rest } = payload;
  const v2 = Number(flags || 0) & MessageFlags.IsComponentsV2;
  return v2 ? { ...rest, flags: MessageFlags.IsComponentsV2 } : rest;
}

export const easterEggMethods = {
  /** The hunt on this server now ({ year, test }) or null, from the cached settings. */
  getEggHunt(guildId, { now = new Date() } = {}) {
    let settings;
    try {
      settings = this.getCachedGuildSettings?.(guildId) || null;
    } catch {
      settings = null;
    }
    return eggHuntFor({ now, guildId, settings: settings || {}, owner: ownerSettings()?.seasons });
  },

  /**
   * A new song: the dice decide whether it brings an egg. Outside the hunt,
   * and without MongoDB (nobody could keep the egg), the panel has none.
   */
  rollEasterEgg(guildId, state, title, { now = Date.now(), random = undefined } = {}) {
    const hunt = eggStoreAvailable() ? this.getEggHunt(guildId, { now: new Date(now) }) : null;
    const egg = hunt ? rollEgg({ test: hunt.test, random }) : null;
    state.easterEgg = egg ? { ...egg, year: hunt.year, song: songKey(title), shownAt: now, foundAt: 0, finder: "" } : null;
    return state.easterEgg;
  },

  /** A click on the egg: whoever comes first gets it; the answer is only for the clicker. */
  async handleEasterEggClick(interaction, eggId) {
    const { t } = this.createInteractionTranslator(interaction);
    const appId = this.getApplicationId?.() || null;
    const guildId = interaction.guildId;
    const state = this.guildState.get(guildId);
    const egg = state?.easterEgg;
    const userId = String(interaction.user?.id || "");
    let refused = null;
    if (interaction.user?.bot) refused = "bot";
    else if (!egg || egg.id !== eggId) refused = "gone";
    else if (egg.foundAt) refused = egg.finder === userId ? "mine" : "taken";
    else if (!this.getEggHunt(guildId)) refused = "over";
    if (refused) {
      await interaction.reply(eggAnswer({ t, result: { ok: false, reason: refused }, appId }));
      return true;
    }
    // A double click: the first one counts, the second is acknowledged without a message.
    egg.clicking ||= new Set();
    if (egg.clicking.has(userId)) {
      await interaction.deferUpdate?.();
      return true;
    }
    egg.clicking.add(userId);

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await claimEgg({
        eggId: egg.id,
        guildId,
        guildName: interaction.guild?.name || "",
        userId,
        year: egg.year,
        points: eggPoints(egg),
        song: egg.song,
      }).catch((err) => {
        log("WARN", `[${this.config?.name}] Osterei nicht vergeben guild=${guildId}: ${err?.message || err}`);
        return { ok: false, reason: "error" };
      });
      if (result.ok) egg.finder = userId;
      if (result.ok || result.reason === "taken") {
        egg.foundAt ||= Date.now();
        // The panel says "Found" at once, not only at its next round.
        this.updateNowPlayingEmbed?.(guildId, state, { force: true })?.catch?.(() => null);
      }
      await interaction.editReply(asEdit(eggAnswer({ t, result, golden: egg.golden, appId })));
    } finally {
      egg.clicking.delete(userId);
    }
    return true;
  },

  /** /ostereier (English /eggs): the server's board, only for whoever asks. */
  async handleEggHuntCommand(interaction, { now = new Date() } = {}) {
    const { t } = this.createInteractionTranslator(interaction);
    const appId = this.getApplicationId?.() || null;
    const guildId = interaction.guildId;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!eggStoreAvailable()) {
      await interaction.editReply({ content: t("Die Bestenliste geht gerade nicht. Versuch es später noch einmal.", "The leaderboard does not work right now. Try again later.") });
      return true;
    }
    const settings = (await this.loadGuildSettingsCached?.(guildId).catch(() => null)) || {};
    const hunt = eggHuntFor({ now, guildId, settings, owner: ownerSettings()?.seasons });
    const server = normalizeSeasonSettings(settings.seasonDecor);
    const zone = isValidTimeZone(settings.timeZone) ? settings.timeZone : DEFAULT_SEASON_TIME_ZONE;
    try {
      const year = hunt?.year ?? await latestEggYear(guildId);
      const board = year ? await eggBoard(guildId, year, { userId: interaction.user.id }) : null;
      await interaction.editReply(asEdit(buildEggBoard({
        t,
        board,
        running: Boolean(hunt),
        off: !hunt && (server.parts.eggHunt === false || !server.seasons.easter),
        next: hunt ? null : nextEggHunt(now, zone),
        appId,
      })));
    } catch (err) {
      log("WARN", `[${this.config?.name}] Ostereier-Bestenliste guild=${guildId}: ${err?.message || err}`);
      await interaction.editReply({ content: t("Die Bestenliste geht gerade nicht. Versuch es später noch einmal.", "The leaderboard does not work right now. Try again later.") });
    }
    return true;
  },
};
