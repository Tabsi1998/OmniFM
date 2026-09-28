// ============================================================
// OmniFM: /problem, /idee, /feedback and the panel's report (#436)
// ============================================================
// Every runtime takes a report and keeps it; the commander posts it to the
// private team channel at once, a worker rings the commander's doorbell.
// Without a team channel (or without the database) the report stays an
// incident in the owner console, as before, and the person is told so.
import { getTier } from "../../core/entitlements.js";
import { log } from "../../lib/logging.js";
import { REPORT_COOLDOWN_MS } from "../../lib/problem-reports.js";
import { claimReport, createProblemReport } from "../../problem-reports-store.js";
import {
  handleReportAction,
  notePostFailure,
  postReportToTeam,
  recordReportIncident,
  reportSettings,
  ringReportsDoorbell,
} from "../../services/problem-reports.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import { buildReportModal, readReportForm } from "../forms.js";
import { describePlaybackPhaseHistory } from "../playback-phase.js";

const THANKS = {
  problem: (t) => t("Danke für die Meldung", "Thanks for the report"),
  idea: (t) => t("Danke für die Idee", "Thanks for the idea"),
  feedback: (t) => t("Danke für dein Feedback", "Thanks for your feedback"),
};

export const reportMethods = {
  /** /problem, /idee, /feedback: the form. */
  async openReportForm(interaction, kind) {
    const { t } = this.createInteractionTranslator(interaction);
    await interaction.showModal(buildReportModal({ t, kind }));
    return true;
  },

  async handleReportFormSubmit(interaction, options = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const form = readReportForm(interaction.customId, interaction.fields);
    if (!form.kind || !form.text) {
      await interaction.reply(buildNoticePayload({
        t, language, tone: "warning", title: t("Da fehlt noch etwas", "Something is missing"),
        description: t("Schreib bitte in ein paar Worten, worum es geht.", "Please say in a few words what it is about."),
      }));
      return true;
    }
    return this.submitReport(interaction, { kind: form.kind, text: form.text, consent: form.consent, source: "command" }, options);
  },

  /** What the team needs besides the text: server, bot, station and plan; from the panel the last playback phases. */
  reportContext(interaction, { withPlayback = false } = {}) {
    const guildId = interaction.guildId || "";
    const guild = interaction.guild || this.client?.guilds?.cache?.get?.(guildId) || null;
    const state = withPlayback ? this.guildState?.get?.(guildId) || null : null;
    const stationName = state?.currentStationName || state?.currentStationKey || "";
    return {
      guild: guildId ? { id: guildId, name: guild?.name || "" } : null,
      bot: withPlayback ? { id: this.config?.id || "", name: this.config?.name || "" } : null,
      station: stationName ? { key: state?.currentStationKey || "", name: stationName } : null,
      plan: guildId ? getTier(guildId) : "free",
      phases: withPlayback ? describePlaybackPhaseHistory(state, { limit: 5 }).map((line) => line.replace(/<t:\d+:R>/g, "").trim()) : [],
    };
  },

  /**
   * Keeps a report and brings it to the team: posted at once by the
   * commander, rung through by a worker. One report per person and five
   * minutes.
   */
  async submitReport(interaction, { kind, text, reason = null, consent = {}, source = "command", withPlayback = false }, { now = Date.now() } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const userId = String(interaction.user?.id || "");
    if (!(this.reportTimes instanceof Map)) this.reportTimes = new Map();
    if (userId && now - (this.reportTimes.get(userId) || 0) < REPORT_COOLDOWN_MS) {
      await interaction.reply(buildNoticePayload({
        t, language, tone: "info", title: t("Schon gemeldet", "Already reported"),
        description: t("Deine Meldung von eben ist angekommen. Die nächste geht in ein paar Minuten.", "Your report from a moment ago has arrived. The next one can go in a few minutes."),
      }));
      return true;
    }
    if (userId) this.reportTimes.set(userId, now);

    const report = {
      kind,
      text,
      reason,
      source,
      consent,
      language,
      ...this.reportContext(interaction, { withPlayback }),
      reporter: { userId, name: interaction.user?.globalName || interaction.user?.username || "" },
    };
    const settings = reportSettings();
    const created = settings.teamChannelId
      ? await createProblemReport(report, { now }).catch((err) => ({ error: String(err?.message || err) }))
      : { error: "unconfigured" };
    if (!created.report) {
      // Nothing goes to Discord, and nothing public: the owner console keeps it.
      await recordReportIncident(report, created.error);
      await interaction.reply(buildNoticePayload({
        t, language, tone: "warning", title: t("Melden über Discord geht gerade nicht", "Reporting through Discord does not work right now"),
        description: t(
          "Das Team-Postfach ist gerade nicht erreichbar. Deine Meldung ist trotzdem beim OmniFM-Team angekommen, nur ohne Forum und ohne Rückmeldung an dich.",
          "The team inbox cannot be reached right now. Your report still reached the OmniFM team, only without the forum and without a reply to you.",
        ),
      }));
      return true;
    }

    let waiting = false;
    if (this.role === "commander") {
      const claimed = await claimReport(created.report._id, { now }).catch(() => null);
      if (claimed) {
        const result = await postReportToTeam(this.client, claimed, { settings, now })
          .catch((err) => ({ ok: false, reason: "send", error: String(err?.message || err) }));
        if (!result.ok) {
          waiting = true;
          await notePostFailure(claimed, result).catch(() => null);
        }
      }
    } else {
      ringReportsDoorbell();
    }
    log("INFO", `[${this.config?.name}] Meldung ${created.report._id} (${kind}, ${source}) guild=${interaction.guildId || "-"}`);
    await interaction.reply(buildNoticePayload({
      t, language, tone: "success", title: (THANKS[kind] || THANKS.problem)(t),
      description: [
        waiting
          ? t("Sie ist gespeichert und geht ans OmniFM-Team, sobald Discord das Team-Postfach wieder erreicht.", "It is saved and goes to the OmniFM team as soon as Discord reaches the team inbox again.")
          : t("Sie ist beim OmniFM-Team angekommen.", "It has reached the OmniFM team."),
        consent.public
          ? t("Wenn das Team sie veröffentlicht, steht sie im Forum, ohne Server und ohne deinen Namen.", "If the team publishes it, it appears in the forum, without the server and without your name.")
          : t("Sie bleibt beim Team und wird nicht veröffentlicht.", "It stays with the team and is not published."),
        consent.notify
          ? t("Du bekommst eine Direktnachricht, wenn sie erledigt ist.", "You get a direct message when it is done.")
          : null,
      ].filter(Boolean).join("\n"),
    }));
    return true;
  },

  /** The team channel's buttons (commander). */
  async handleReportComponent(interaction) {
    return handleReportAction(interaction);
  },
};
