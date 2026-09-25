// Forms in Discord (#273): add a station, plan an event, report a problem.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime: the commander handles the station and event forms,
// the worker the problem report from its now-playing panel.
import { MessageFlags } from "discord.js";

import { log } from "../../lib/logging.js";
import { getTier } from "../../core/entitlements.js";
import { addGuildStation, countGuildStations, MAX_STATIONS_PER_GUILD } from "../../custom-stations.js";
import { testOwnerStationStream } from "../../lib/owner-station-test.js";
import { translateCustomStationErrorMessage } from "../../lib/language.js";
import { recordRuntimeIncident } from "../../runtime-incidents-store.js";
import { loadStations } from "../../stations-store.js";
import { describePlaybackPhaseHistory } from "../playback-phase.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import { handleEventCommand } from "../runtime-event-command.js";
import {
  EVENT_FORM_ID,
  STATION_FORM_ID,
  buildProblemReportModal,
  buildStationFormModal,
  problemReasonLabel,
  readEventForm,
  readProblemReport,
  readStationForm,
} from "../forms.js";

// One report per person and server within this time; more would only be noise.
const PROBLEM_REPORT_COOLDOWN_MS = 5 * 60_000;

function catalogGenres() {
  const stations = loadStations()?.stations || {};
  return [...new Set(Object.values(stations).map((station) => String(station?.genre || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

const formMethods = {
  /** /addstation without options: the form (Ultimate). */
  async openStationForm(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    if (getTier(interaction.guildId) !== "ultimate") {
      await interaction.reply(buildNoticePayload({ t, language, code: "premium-required", params: { tier: "Ultimate" } }));
      return;
    }
    await interaction.showModal(buildStationFormModal({ t, genres: catalogGenres() }));
  },

  async handleStationFormSubmit(interaction, { testStream = testOwnerStationStream } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = interaction.guildId;
    if (getTier(guildId) !== "ultimate") {
      await interaction.reply(buildNoticePayload({ t, language, code: "premium-required", params: { tier: "Ultimate" } }));
      return true;
    }
    const form = readStationForm(interaction.fields);
    if (!form.ok) {
      const messages = {
        name: t("Der Name braucht mindestens zwei Zeichen.", "The name needs at least two characters."),
        url: t("Die Stream-URL muss mit http:// oder https:// beginnen.", "The stream URL must start with http:// or https://."),
        key: t("Aus dem Namen lässt sich kein Kurzname bilden. Gib einen Kurznamen an (Buchstaben und Zahlen).", "No short key can be made from the name. Enter one (letters and digits)."),
      };
      await interaction.reply(buildNoticePayload({ t, language, tone: "warning", title: t("Bitte prüfen", "Please check"), description: messages[form.error] }));
      return true;
    }
    // Testing the stream takes a few seconds: acknowledge first.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const test = await testStream({ key: form.station.key, name: form.station.name, url: form.station.url }).catch((error) => ({ ok: false, error: error?.message || "test_failed" }));
    if (!test?.ok) {
      await this.respondInteraction(interaction, buildNoticePayload({
        t, language, tone: "warning", title: t("Stream antwortet nicht", "Stream does not answer"),
        description: t(
          `Unter der URL kam kein Stream (${test?.error || "keine Antwort"}). Nichts gespeichert – prüf den Link und versuch es noch einmal.`,
          `No stream came from the URL (${test?.error || "no answer"}). Nothing saved – check the link and try again.`
        ),
      }));
      return true;
    }
    const result = await addGuildStation(guildId, form.station.key, { name: form.station.name, genre: form.station.genre, url: form.station.url }, form.station.url);
    if (result?.error) {
      await this.respondInteraction(interaction, buildNoticePayload({
        t, language, tone: "warning", title: t("Nicht gespeichert", "Not saved"),
        description: translateCustomStationErrorMessage(result.error, language),
      }));
      return true;
    }
    await this.respondInteraction(interaction, buildNoticePayload({
      t, language, tone: "success", title: t("Sender gespeichert", "Station saved"),
      description: t(
        `**${result.station?.name || form.station.name}** ist jetzt als \`${result.key}\` da (${countGuildStations(guildId)}/${MAX_STATIONS_PER_GUILD} Plätze). Der Stream-Test war erfolgreich.`,
        `**${result.station?.name || form.station.name}** is now available as \`${result.key}\` (${countGuildStations(guildId)}/${MAX_STATIONS_PER_GUILD} slots). The stream test passed.`
      ),
      quickActions: { includePlay: true, includeStations: true },
    }));
    log("INFO", `[${this.config?.name}] Eigener Sender per Formular guild=${guildId} key=${result.key}`);
    return true;
  },

  /** The event form's submit runs through /event create's checks. */
  async handleEventFormSubmit(interaction) {
    const input = readEventForm(interaction.fields);
    await handleEventCommand(this, interaction, {
      formInput: { ...input, voiceChannelId: input.voiceChannel?.id || null },
    });
    return true;
  },

  /** Commander: the forms of the station and the event. */
  async handleFormSubmit(interaction) {
    if (!interaction.isModalSubmit?.()) return false;
    if (interaction.customId === STATION_FORM_ID) return this.handleStationFormSubmit(interaction);
    if (interaction.customId === EVENT_FORM_ID) return this.handleEventFormSubmit(interaction);
    return false;
  },

  /** "Report a problem" in the now-playing panel (worker). */
  async showProblemReportForm(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    await interaction.showModal(buildProblemReportModal({ t }));
    return true;
  },

  /**
   * The report becomes a server incident for the owner console, with the
   * station and the last playback phases (#210). Nobody's name is stored.
   */
  async handleProblemReportSubmit(interaction, { now = Date.now() } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = interaction.guildId;
    const report = readProblemReport(interaction.fields);
    if (!report.ok) {
      await interaction.reply(buildNoticePayload({ t, language, tone: "warning", title: t("Bitte auswählen", "Please choose"), description: t("Wähle aus, was los ist.", "Choose what is wrong.") }));
      return true;
    }
    if (!(this.problemReportTimes instanceof Map)) this.problemReportTimes = new Map();
    const reporterKey = `${guildId}:${interaction.user?.id || ""}`;
    const last = this.problemReportTimes.get(reporterKey) || 0;
    if (now - last < PROBLEM_REPORT_COOLDOWN_MS) {
      await interaction.reply(buildNoticePayload({
        t, language, tone: "info", title: t("Schon gemeldet", "Already reported"),
        description: t("Deine Meldung von eben ist angekommen. Danke!", "Your report from a moment ago has arrived. Thanks!"),
      }));
      return true;
    }
    this.problemReportTimes.set(reporterKey, now);

    const state = this.guildState?.get?.(guildId) || null;
    const guild = interaction.guild || this.client?.guilds?.cache?.get?.(guildId) || null;
    await recordRuntimeIncident({
      guildId,
      guildName: guild?.name || "",
      tier: getTier(guildId),
      eventKey: "listener_report",
      severity: "warning",
      runtime: { id: this.config?.id || "", name: this.config?.name || "", role: this.role || "" },
      payload: {
        reason: report.reason,
        detail: report.detail,
        previousStationKey: state?.currentStationKey || "",
        previousStationName: state?.currentStationName || "",
        listenerCount: this.getCurrentListenerCount?.(guildId, state) || 0,
        phaseHistory: describePlaybackPhaseHistory(state, { limit: 5 }).map((line) => line.replace(/<t:\d+:R>/g, "").trim()),
      },
    });
    log("INFO", `[${this.config?.name}] Hoerer-Meldung guild=${guildId} reason=${report.reason}`);
    await interaction.reply(buildNoticePayload({
      t, language, tone: "success", title: t("Danke für die Meldung", "Thanks for the report"),
      description: t(
        `„${problemReasonLabel(report.reason, t)}“ ist beim OmniFM-Team angekommen, zusammen mit dem Sender und dem Wiedergabe-Verlauf. Dein Name wird nicht gespeichert.`,
        `“${problemReasonLabel(report.reason, t)}” has reached the OmniFM team, together with the station and the playback history. Your name is not stored.`
      ),
    }));
    return true;
  },
};

export { formMethods };
