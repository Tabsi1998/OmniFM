// ============================================================
// OmniFM: reports to the team and into the forum (#436)
// ============================================================
// Only the commander posts. It takes the stored reports one by one and posts
// each to the private team channel; a worker's panel report rings the
// doorbell (#213) so that this happens at once. The team channel must be a
// text channel that @everyone cannot see: a report never lands anywhere
// public by a mistaken ID. Public is only the forum post a team member
// clicks for, and only with the reporter's consent, and it shows the text,
// the station and the plan, never the server or a name. When Discord
// cannot take a report, it stays an incident in the owner console.
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";

import { onDoorbell, ringDoorbell } from "../core/process-doorbell.js";
import { log } from "../lib/logging.js";
import { accountForDiscordUser } from "../lib/owner-access.js";
import { ownerSettings } from "../lib/owner-settings-cache.js";
import { forumTagFor, normalizeReportSettings } from "../lib/problem-reports.js";
import * as reportStore from "../problem-reports-store.js";
import { recordRuntimeIncident } from "../runtime-incidents-store.js";
import {
  NO_PINGS,
  buildForumReportPost,
  buildReportAnswerModal,
  buildReporterNotice,
  buildTeamReportMessage,
  parseReportActionId,
} from "../bot/problem-report-messages.js";

export const REPORTS_DOORBELL_TOPIC = "omnifm:reports";
// Who may publish and decide in the team channel: the owner console's accounts (#283).
const TEAM_ROLES = new Set(["owner", "support"]);
const DISPATCH_INTERVAL_MS = 30_000;

/** The owner's settings for reports: team channel and forums. */
export function reportSettings(settings = ownerSettings()) {
  return normalizeReportSettings(settings?.reports);
}

/**
 * The report as an incident in the owner console, the way it went before
 * #436, when Discord cannot take it (no team channel, no database, the
 * channel is gone).
 */
export async function recordReportIncident(report, because = "") {
  return recordRuntimeIncident({
    guildId: report?.guild?.id || "",
    guildName: report?.guild?.name || "",
    tier: report?.plan || "free",
    eventKey: "listener_report",
    severity: "warning",
    runtime: { id: report?.bot?.id || "", name: report?.bot?.name || "", role: "" },
    payload: {
      kind: report?.kind || "problem",
      reason: report?.reason || (report?.kind === "problem" ? "other" : ""),
      detail: String(report?.text || "").slice(0, 500),
      previousStationKey: report?.station?.key || "",
      previousStationName: report?.station?.name || "",
      phaseHistory: Array.isArray(report?.phases) ? report.phases : [],
      undelivered: String(because || ""),
    },
  }).catch(() => null);
}

/**
 * Whether a channel may receive the team's cards: a text channel that
 * @everyone cannot see. Anything else could be public.
 */
export function isPrivateTeamChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildText || typeof channel.send !== "function") return false;
  const everyone = channel.guild?.roles?.everyone;
  if (!everyone || typeof channel.permissionsFor !== "function") return false;
  const permissions = channel.permissionsFor(everyone);
  return Boolean(permissions) && !permissions.has(PermissionFlagsBits.ViewChannel);
}

/**
 * Posts one report to the team channel. { ok } or { ok: false, reason }:
 * "unconfigured", "channel" (gone or not reachable), "public" (the channel
 * is not private), "send".
 */
export async function postReportToTeam(client, report, { settings = reportSettings(), store = reportStore, now = Date.now() } = {}) {
  if (!settings.teamChannelId) return { ok: false, reason: "unconfigured" };
  const channel = await client?.channels?.fetch?.(settings.teamChannelId).catch(() => null);
  if (!channel) return { ok: false, reason: "channel" };
  if (!isPrivateTeamChannel(channel)) {
    log("WARN", `[Meldungen] Kanal ${settings.teamChannelId} ist kein privater Textkanal; Meldung ${report._id} wird dort nicht gepostet.`);
    return { ok: false, reason: "public" };
  }
  let sent;
  try {
    sent = await channel.send(buildTeamReportMessage(report, { forumChannelId: settings.forums[report.kind] }));
  } catch (err) {
    return { ok: false, reason: "send", error: String(err?.message || err) };
  }
  await store.markReportPosted(report._id, { guildId: channel.guildId || channel.guild?.id || "", channelId: channel.id, messageId: sent?.id, now });
  return { ok: true, messageId: sent?.id || "" };
}

/** A report that could not be posted waits for the next round; after the last try it becomes an incident. */
export async function notePostFailure(report, result, { store = reportStore } = {}) {
  const attempts = Number(report?.dispatch?.attempts || 1);
  await store.markReportUnposted(report._id, { error: result.reason, attempts });
  if (attempts >= reportStore.MAX_DISPATCH_ATTEMPTS) {
    log("WARN", `[Meldungen] Meldung ${report._id} nach ${attempts} Versuchen nicht gepostet (${result.reason}); sie bleibt als Vorfall.`);
    await recordReportIncident(report, result.reason);
  }
}

/** Posts the waiting reports, oldest first, up to `limit`; stops at the first failure. */
export async function dispatchPendingReports(client, { settings = reportSettings(), store = reportStore, now = Date.now(), limit = 10 } = {}) {
  if (!settings.teamChannelId) return { posted: 0 };
  let posted = 0;
  for (let round = 0; round < limit; round += 1) {
    // One after the other: each claim must see the one before it posted.
    // eslint-disable-next-line no-await-in-loop
    const report = await store.claimPendingReport({ now });
    if (!report) break;
    // eslint-disable-next-line no-await-in-loop
    const result = await postReportToTeam(client, report, { settings, store, now });
    if (!result.ok) {
      // eslint-disable-next-line no-await-in-loop
      await notePostFailure(report, result, { store });
      break;
    }
    posted += 1;
  }
  return { posted };
}

/** A worker tells the commander that a report waits (split runtime); without the doorbell the next round takes it. */
export function ringReportsDoorbell() {
  return ringDoorbell(REPORTS_DOORBELL_TOPIC, {});
}

let serviceTimer = null;
let stopDoorbell = null;
let running = null;

/** Commander: posts waiting reports every 30 seconds and at once when a worker rings. */
export function startProblemReportService(runtime, { intervalMs = DISPATCH_INTERVAL_MS } = {}) {
  if (serviceTimer) return;
  const tick = () => {
    if (running) return running;
    running = dispatchPendingReports(runtime.client)
      .catch((err) => log("WARN", `[Meldungen] Versand fehlgeschlagen: ${err?.message || err}`))
      .finally(() => { running = null; });
    return running;
  };
  serviceTimer = setInterval(tick, Math.max(5_000, intervalMs));
  serviceTimer.unref?.();
  stopDoorbell = onDoorbell(REPORTS_DOORBELL_TOPIC, () => { void tick(); });
  setTimeout(tick, 10_000).unref?.();
}

export function stopProblemReportService() {
  if (serviceTimer) clearInterval(serviceTimer);
  serviceTimer = null;
  stopDoorbell?.();
  stopDoorbell = null;
}

// ---- the team's buttons ----

const quiet = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS });

/** The forum tag of the report's status, looked up by name in the forum ("" without one). */
function statusTag(forum, report, settings) {
  return forumTagFor(forum?.availableTags, settings.tags?.[report.status] || "");
}

/** Keeps the forum post's tag in step with the status (#437); a failure does not stop the click. */
async function tagForumPost(client, report, settings) {
  if (!report?.forum?.threadId) return;
  try {
    const thread = await client?.channels?.fetch?.(report.forum.threadId);
    if (!thread?.setAppliedTags) return;
    const forum = thread.parent || await client.channels.fetch(report.forum.channelId).catch(() => null);
    const tag = statusTag(forum, report, settings);
    await thread.setAppliedTags(tag ? [tag] : []);
  } catch (err) {
    log("WARN", `[Meldungen] Tag im Forum für ${report._id} nicht gesetzt: ${err?.message || err}`);
  }
}

/** Publishes a report in the forum of its kind: only with consent, only once, without server and name. */
async function publishReport(interaction, report, { settings, store }) {
  if (!report.consent?.public) return quiet("Die Person hat nicht zugestimmt; die Meldung bleibt beim Team.");
  const forumId = settings.forums[report.kind];
  if (!forumId) return quiet("Für diese Art Meldung ist kein Forum eingestellt (Owner-Konsole → Bots & Discord → Meldungen).");
  const held = await store.claimReportPublishing(report._id);
  if (!held) return quiet("Diese Meldung steht schon im Forum.");
  const forum = await interaction.client?.channels?.fetch?.(forumId).catch(() => null);
  if (!forum || forum.type !== ChannelType.GuildForum || !forum.threads?.create) {
    await store.releaseReportPublishing(report._id);
    return quiet("Das Forum ist nicht erreichbar; nichts wurde veröffentlicht.");
  }
  let thread;
  try {
    const tag = statusTag(forum, report, settings);
    thread = await forum.threads.create(buildForumReportPost(report, { appliedTags: tag ? [tag] : [] }));
  } catch (err) {
    await store.releaseReportPublishing(report._id);
    return quiet(`Veröffentlichen ging nicht: ${String(err?.message || err).slice(0, 150)}`);
  }
  const published = await store.completeReportPublishing(report._id, { channelId: forum.id, threadId: thread.id });
  return { update: published || { ...report, forum: { channelId: forum.id, threadId: thread.id } } };
}

/** The promised direct message: only to somebody who asked for it, and only once (#437). */
export async function notifyReporter(client, report, { store = reportStore } = {}) {
  if (!report?.consent?.notify || !report.reporter?.userId || report.notified || !["done", "rejected"].includes(report.status)) return null;
  let ok = false;
  try {
    const user = await client?.users?.fetch?.(report.reporter.userId);
    await user.send(buildReporterNotice(report));
    ok = true;
  } catch (err) {
    log("INFO", `[Meldungen] Bescheid zu ${report._id} ging nicht: ${err?.message || err}`);
  }
  await store.markReportNotified(report._id, { ok });
  return { ...report, notified: { at: new Date(), ok } };
}

/**
 * A button on a team card, or the answer form behind "done" and "rejected".
 * Only the owner console's owner and support accounts may use them.
 * @returns {Promise<boolean>} whether the interaction was one of these
 */
export async function handleReportAction(interaction, { settings = reportSettings(), store = reportStore, account = accountForDiscordUser } = {}) {
  const parsed = parseReportActionId(interaction?.customId);
  if (!parsed) return false;
  const member = account(interaction.user?.id);
  if (!member || !TEAM_ROLES.has(member.role)) {
    await interaction.reply(quiet("Das darf nur das OmniFM-Team (Owner oder Support in der Owner-Konsole)."));
    return true;
  }
  const report = await store.findProblemReport(parsed.id);
  if (!report) {
    await interaction.reply(quiet("Diese Meldung gibt es nicht mehr."));
    return true;
  }
  // Somebody waits for word: first the short answer for the message.
  const waiting = report.consent?.notify && report.reporter?.userId && !report.notified;
  if (!parsed.answer && waiting && ["done", "rejected"].includes(parsed.action)) {
    await interaction.showModal(buildReportAnswerModal(parsed.action, report._id));
    return true;
  }
  let result;
  if (parsed.action === "publish") {
    result = await publishReport(interaction, report, { settings, store });
  } else {
    const answer = parsed.answer ? String(interaction.fields?.getTextInputValue?.("answer") ?? "").trim() : "";
    let decided = await store.decideProblemReport(report._id, parsed.action, { by: { id: interaction.user.id, name: member.name }, answer });
    if (decided) decided = (await notifyReporter(interaction.client, decided, { store })) || decided;
    result = { update: decided };
  }
  if (!result.update) {
    await interaction.reply(result.content ? result : quiet("Das ging gerade nicht, bitte gleich noch einmal."));
    return true;
  }
  await tagForumPost(interaction.client, result.update, settings);
  await interaction.update(buildTeamReportMessage(result.update, { forumChannelId: settings.forums[result.update.kind] }));
  return true;
}
