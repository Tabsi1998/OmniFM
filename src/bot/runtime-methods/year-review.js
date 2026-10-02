// /jahresrueckblick (#301 part 2): a server's year as cards to page through.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js; the
// commander answers. The review comes from the monthly values (#301 part 1).
import { AttachmentBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";

import { log } from "../../lib/logging.js";
import { getTier } from "../../core/entitlements.js";
import { planAtLeast } from "../../config/plan-features.js";
import { renderYearReviewCard } from "../../lib/share-card.js";
import { yearReviewFor } from "../../year-review-store.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import {
  buildYearReviewAnnouncement,
  buildYearReviewPage,
  isEmptyReview,
  parseYearReviewCustomId,
  reviewYearOf,
} from "../year-review-panel.js";

/** A post in the channel at most every six hours per server. */
const ANNOUNCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const lastAnnouncement = new Map();

// A component update may not carry the ephemeral flag; V2 stays.
function asUpdate(payload) {
  return { ...payload, flags: MessageFlags.IsComponentsV2 };
}

export function resetYearReviewAnnouncementsForTests() {
  lastAnnouncement.clear();
}

export const yearReviewMethods = {
  async loadYearReview(guildId, { now = Date.now(), loadReview = yearReviewFor } = {}) {
    const { year, final } = reviewYearOf(now);
    const review = await loadReview(guildId, year).catch((err) => {
      log("WARN", `[${this.config?.name}] Jahresrückblick nicht geladen guild=${guildId}: ${err?.message || err}`);
      return null;
    });
    return { review: review || { year, listeningHours: 0, topStations: [], topSongs: [] }, year, final };
  },

  async handleYearReviewCommand(interaction, options = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { review, final } = await this.loadYearReview(interaction.guildId, options);
    return interaction.editReply(asUpdate(buildYearReviewPage({
      t,
      language,
      review,
      page: 0,
      final,
      guildName: interaction.guild?.name || "",
      paid: planAtLeast(getTier(interaction.guildId), "pro"),
      now: options.now,
    })));
  },

  async handleYearReviewComponent(interaction, options = {}) {
    const parsed = parseYearReviewCustomId(interaction.customId);
    if (!parsed) return false;
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = interaction.guildId;
    const paid = planAtLeast(getTier(guildId), "pro");
    const now = options.now ?? Date.now();
    const pageOf = (review, final, page) => buildYearReviewPage({
      t, language, review, page, final, guildName: interaction.guild?.name || "", paid, now,
    });

    if (parsed.action === "page") {
      const { review, final } = await this.loadYearReview(guildId, options);
      await interaction.update(asUpdate(pageOf(review, final, parsed.page)));
      return true;
    }
    if (parsed.action === "open") {
      // From the post in the channel: everyone gets their own cards.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { review, final } = await this.loadYearReview(guildId, options);
      await interaction.editReply(asUpdate(pageOf(review, final, 0)));
      return true;
    }

    const warn = (title, description) => this.respondInteraction(interaction, buildNoticePayload({ t, language, tone: "warning", title, description }));
    if (!paid) {
      await warn(t("Ab Pro", "With Pro"), t("Das Bild und den Beitrag im Kanal gibt es ab Pro.", "The picture and the channel post come with Pro."));
      return true;
    }

    if (parsed.action === "image") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { review } = await this.loadYearReview(guildId, options);
      if (isEmptyReview(review)) {
        await interaction.editReply({ content: t("Noch keine Hörzeit für ein Bild.", "No listening time for a picture yet.") });
        return true;
      }
      const png = await (options.renderCard || renderYearReviewCard)({
        language,
        guildName: interaction.guild?.name || "",
        year: review.year,
        hours: review.listeningHours,
        topStation: review.topStations?.[0]?.name || null,
        topSong: review.topSongs?.[0]?.title || null,
        busiestHour: review.busiestHour,
        t,
      });
      await interaction.editReply({
        content: t("Euer Jahr als Bild. Speichern oder weiterleiten, wie ihr mögt.", "Your year as a picture. Save it or forward it as you like."),
        files: [new AttachmentBuilder(Buffer.from(png), { name: `omnifm-${review.year}.png` })],
      });
      return true;
    }

    // "announce": only in December and January, only for managers, not too often.
    const { review, final } = await this.loadYearReview(guildId, options);
    if (!final) {
      await warn(t("Ab 1. Dezember", "From 1 December"), t("Im Kanal teilen geht vom 1. Dezember bis 31. Januar.", "Sharing in the channel works from 1 December to 31 January."));
      return true;
    }
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await warn(t("Nur für Verwalter", "Managers only"), t("Im Kanal teilen können Personen mit „Server verwalten“.", "People with “Manage Server” can share it in the channel."));
      return true;
    }
    if (isEmptyReview(review)) {
      await warn(t("Noch nichts zu teilen", "Nothing to share yet"), t("Für dieses Jahr gibt es noch keine Hörzeit.", "There is no listening time for this year yet."));
      return true;
    }
    const last = lastAnnouncement.get(guildId) || 0;
    if (now - last < ANNOUNCE_COOLDOWN_MS) {
      await warn(t("Schon geteilt", "Already shared"), t("Der Rückblick wurde gerade erst im Kanal geteilt. Später noch einmal.", "The review was just shared in the channel. Try again later."));
      return true;
    }
    const channel = interaction.channel;
    if (!channel?.send) {
      await warn(t("Kein Kanal", "No channel"), t("In diesen Kanal kann OmniFM nicht schreiben.", "OmniFM cannot write in this channel."));
      return true;
    }
    await channel.send(buildYearReviewAnnouncement({ t, language, review, guildName: interaction.guild?.name || "" }));
    lastAnnouncement.set(guildId, now);
    await this.respondInteraction(interaction, buildNoticePayload({
      t, language, tone: "success", title: t("Geteilt", "Shared"), description: t("Der Rückblick steht jetzt im Kanal.", "The review is in the channel now."),
    }));
    return true;
  },
};
