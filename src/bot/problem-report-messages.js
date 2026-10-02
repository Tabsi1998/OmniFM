// ============================================================
// OmniFM: the messages of a report (#436, #437)
// ============================================================
// The card in the private team channel (in German, the team's language), the
// public forum post, which shows the text, the station and the plan only,
// the team's answer form and the direct message to the reporter. Mentions in
// a report never ping anybody. The report forms are in forms.js.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import * as ui from "../discord/ui/index.js";
import { PLAN_NAMES } from "../config/plan-features.js";
import { cleanReportText, publicReportView, reportThreadName } from "../lib/problem-reports.js";
import { problemReasonLabel } from "./forms.js";
import { botTranslator } from "../lib/bot-i18n.js";

// The team's buttons, and the answer form "done" and "rejected" open when the reporter wants to hear back.
export const REPORT_PREFIX = "omnifm:report:";
const ACTION_ID = /^omnifm:report:(publish|in-progress|done|rejected|duplicate):([a-f0-9]{16})$/;
const ANSWER_ID = /^omnifm:report:answer:(done|rejected):([a-f0-9]{16})$/;

export const reportActionId = (action, id) => `${REPORT_PREFIX}${action}:${id}`;
export const reportAnswerId = (decision, id) => `${REPORT_PREFIX}answer:${decision}:${id}`;

/** { action, id, answer } of a team button or of the answer form, or null. */
export function parseReportActionId(customId) {
  const value = String(customId || "");
  const answer = ANSWER_ID.exec(value);
  if (answer) return { action: answer[1], id: answer[2], answer: true };
  const match = ACTION_ID.exec(value);
  return match ? { action: match[1], id: match[2], answer: false } : null;
}

/** Whatever a report says, nobody is pinged. */
export const NO_PINGS = Object.freeze({ parse: [] });

const KIND_LOOK = Object.freeze({
  problem: { emoji: "🐞", de: "Problem", en: "problem", accent: ui.UI_COLORS.warning },
  idea: { emoji: "💡", de: "Idee", en: "idea", accent: ui.UI_COLORS.info },
  feedback: { emoji: "💬", de: "Feedback", en: "feedback", accent: ui.UI_COLORS.brand },
});
const SOURCE_DE = Object.freeze({ command: "per Befehl", panel: "aus dem Now-Playing-Panel", dashboard: "aus dem Dashboard" });
const STATUS_DE = Object.freeze({ new: "🆕 neu", "in-progress": "🔧 in Arbeit", done: "✅ erledigt", rejected: "🚫 abgelehnt", duplicate: "🔁 doppelt" });

const quote = (text) => String(text || "").split("\n").map((line) => `> ${line}`).join("\n");
const short = (text, max) => {
  const value = cleanReportText(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

// ---- the team channel ----

function teamButtons(report, { forumChannelId = "" } = {}) {
  const buttons = [];
  if (report.consent?.public && forumChannelId && !report.forum?.threadId) {
    buttons.push(new ButtonBuilder().setCustomId(reportActionId("publish", report._id)).setStyle(ButtonStyle.Primary).setLabel("Im Forum veröffentlichen"));
  }
  const status = (id, label, style) => new ButtonBuilder().setCustomId(reportActionId(id, report._id)).setStyle(style).setLabel(label).setDisabled(report.status === id);
  buttons.push(
    status("in-progress", "In Arbeit", ButtonStyle.Secondary),
    status("done", "Erledigt", ButtonStyle.Success),
    status("rejected", "Abgelehnt", ButtonStyle.Secondary),
    status("duplicate", "Doppelt", ButtonStyle.Secondary),
  );
  return new ActionRowBuilder().addComponents(buttons);
}

/**
 * The card in the private team channel: the report, where it comes from,
 * what the reporter allowed, and the buttons to publish and to decide.
 * @param {Record<string, any>} report as stored
 * @param {{ forumChannelId?: string }} [options] the forum of the report's kind, if one is set
 */
export function buildTeamReportMessage(report, { forumChannelId = "" } = {}) {
  const look = KIND_LOOK[report.kind] || KIND_LOOK.problem;
  const facts = ui.statusLine([
    report.guild ? `Server: **${report.guild.name || "?"}** (${report.guild.id})` : null,
    report.bot?.name ? `Bot: ${report.bot.name}` : null,
    report.station?.name ? `Sender: ${report.station.name}` : null,
    `Plan: ${PLAN_NAMES[report.plan] || PLAN_NAMES.free}`,
  ]);
  const allowed = ui.statusLine([
    report.consent?.public ? "🌐 darf ins Forum" : "🔒 nur fürs Team",
    report.consent?.notify ? "📬 möchte Bescheid" : null,
  ]);
  const reporter = report.reporter?.userId
    ? `Melder: <@${report.reporter.userId}>${report.reporter.name ? ` (${report.reporter.name})` : ""}`
    : "Melder: nicht gespeichert (ohne „Gib mir Bescheid“)";
  const published = report.forum?.threadId ? `Im Forum: <#${report.forum.threadId}>` : null;
  const by = report.status !== "new" && report.decidedBy?.name ? ` von ${report.decidedBy.name}` : "";
  const notified = report.notified
    ? (report.notified.ok ? "📬 Bescheid gegeben" : "📭 Bescheid ging nicht (Direktnachrichten zu)")
    : null;
  const body = [
    ui.text(quote(report.text)),
    report.reason ? ui.text(`Grund: **${problemReasonLabel(report.reason)}**`) : null,
    ui.text(facts),
    report.phases?.length ? ui.text(ui.subtext(`Letzte Wiedergabe-Phasen:\n${report.phases.join("\n")}`)) : null,
    ui.separator({ divider: false }),
    ui.text([
      allowed,
      reporter,
      published,
      `Status: ${STATUS_DE[report.status] || STATUS_DE.new}${by}`,
      report.answer ? `Antwort: ${report.answer}` : null,
      notified,
    ].filter(Boolean).join("\n")),
  ].filter(Boolean);
  const payload = ui.message(ui.panel({
    accent: look.accent,
    title: `${look.emoji} ${look.de} ${SOURCE_DE[report.source] || SOURCE_DE.command}`,
    body,
    actions: [teamButtons(report, { forumChannelId })],
    footer: `Meldung ${report._id}`,
  }));
  return { ...payload, allowedMentions: NO_PINGS };
}

/** "Done" or "rejected" with somebody waiting for word: the team may add a short answer. */
export function buildReportAnswerModal(decision, id) {
  return new ModalBuilder()
    .setCustomId(reportAnswerId(decision, id))
    .setTitle(decision === "done" ? "Erledigt: Antwort an die Person" : "Abgelehnt: Antwort an die Person")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Antwort (freiwillig)")
        .setDescription("Steht in der Direktnachricht; leer lassen geht auch.")
        .setTextInputComponent(new TextInputBuilder().setCustomId("answer").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
    );
}

// ---- the reporter ----

/** The title of the answer, per kind of report (#477: whole sentences per language). */
function reporterTitle(kind, done, t) {
  if (kind === "idea") {
    return done
      ? t("✅ Deine Meldung an OmniFM ist erledigt", "✅ Your idea for OmniFM is done")
      : t("🚫 Deine Meldung an OmniFM wurde abgelehnt", "🚫 Your idea for OmniFM was turned down");
  }
  if (kind === "feedback") {
    return done
      ? t("✅ Deine Meldung an OmniFM ist erledigt", "✅ Your feedback for OmniFM is done")
      : t("🚫 Deine Meldung an OmniFM wurde abgelehnt", "🚫 Your feedback for OmniFM was turned down");
  }
  return done
    ? t("✅ Deine Meldung an OmniFM ist erledigt", "✅ Your problem report to OmniFM is done")
    : t("🚫 Deine Meldung an OmniFM wurde abgelehnt", "🚫 Your problem report to OmniFM was turned down");
}

/** The direct message for somebody who asked to hear back, in their language: done or rejected, and the team's answer. */
export function buildReporterNotice(report) {
  const t = botTranslator(report.language || "en");
  const done = report.status === "done";
  const title = reporterTitle(report.kind, done, t);
  const payload = ui.message(ui.panel({
    accent: done ? ui.UI_COLORS.success : ui.UI_COLORS.neutral,
    title,
    body: [
      ui.text(quote(short(report.text, 300))),
      report.answer ? ui.text(`${t("**Antwort des Teams:**", "**The team's answer:**")} ${report.answer}`) : null,
      ui.text(ui.subtext(t(
        "Du bekommst diese Nachricht, weil du „Gib mir Bescheid“ gewählt hast. Mit /meine-daten siehst und löschst du, was dazu gespeichert ist.",
        "You get this message because you chose “Tell me when it is done”. With /mydata you see and delete what is kept for it.",
      ))),
    ].filter(Boolean),
  }));
  return { ...payload, allowedMentions: NO_PINGS };
}

// ---- the public forum ----

/**
 * The public post: the text, the station and the plan, nothing else. No
 * server, no ID, no bot, no name, whatever the stored report holds.
 * @param {Record<string, any>} report
 * @param {{ appliedTags?: string[] }} [options] the forum tag of the report's status
 */
export function buildForumReportPost(report, { appliedTags = [] } = {}) {
  const view = publicReportView(report);
  const look = KIND_LOOK[view.kind];
  const facts = ui.statusLine([view.station ? `📻 ${view.station}` : null, PLAN_NAMES[view.plan] || null]);
  return {
    name: reportThreadName(view, `${look.emoji} ${look.de}`),
    ...(appliedTags.length ? { appliedTags } : {}),
    message: {
      content: [quote(view.text), facts ? `-# ${facts}` : null].filter(Boolean).join("\n\n"),
      allowedMentions: NO_PINGS,
    },
  };
}
