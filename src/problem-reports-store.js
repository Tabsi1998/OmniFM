// ============================================================
// OmniFM: the stored reports (#436)
// ============================================================
// Every report is kept first; then the commander posts it to the private
// team channel. So a worker's panel report reaches the team too, and a
// report survives a moment in which the channel cannot be reached. The
// Discord ID is kept only when the reporter asked to hear back (#437 sends
// that message). A decided report goes after 180 days, an undecided one
// after a year. MongoDB only.
import { randomBytes } from "node:crypto";
import { getDb, isConnected } from "./lib/db.js";
import { REPORT_DECISIONS, REPORT_SOURCES, cleanReportText, isReportKind } from "./lib/problem-reports.js";
import { normalizeBotLanguage } from "./lib/bot-i18n.js";

export const PROBLEM_REPORTS_COLLECTION = "problem_reports";
const DAY_MS = 86_400_000;
export const KEEP_OPEN_MS = 365 * DAY_MS;
export const KEEP_DECIDED_MS = 180 * DAY_MS;
// A claim this old is taken again: the commander that took it stopped while posting.
const CLAIM_STALE_MS = 2 * 60_000;
// After this many tries a report stays an incident in the owner console.
export const MAX_DISPATCH_ATTEMPTS = 5;
const PLANS = ["free", "pro", "ultimate"];

let indexesReady = null;

function collection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(PROBLEM_REPORTS_COLLECTION);
}

async function ensureIndexes(reports) {
  if (!indexesReady) {
    indexesReady = Promise.all([
      reports.createIndex({ "dispatch.state": 1, createdAt: 1 }, { name: "dispatch" }),
      reports.createIndex({ status: 1, createdAt: -1 }, { name: "queue" }),
      reports.createIndex({ "reporter.userId": 1 }, { name: "reporter" }),
      reports.createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}

const cleanId = (value) => (/^\d{17,22}$/.test(String(value || "")) ? String(value) : "");
const clip = (value, max) => String(value ?? "").trim().slice(0, max);

/**
 * Keeps a report until the commander posts it. Says why not: "unavailable"
 * (no MongoDB), "kind", "text".
 * @param {{
 *   kind: string, text: string, reason?: string, source?: string,
 *   guild?: { id?: string, name?: string }, bot?: { id?: string, name?: string },
 *   station?: { key?: string, name?: string }, plan?: string, phases?: string[],
 *   language?: string, consent?: { public?: boolean, notify?: boolean },
 *   reporter?: { userId?: string, name?: string },
 * }} input
 * @param {{ now?: number }} [options]
 */
export async function createProblemReport(input, { now = Date.now() } = {}) {
  const reports = collection();
  if (!reports) return { error: "unavailable" };
  if (!isReportKind(input?.kind)) return { error: "kind" };
  const text = cleanReportText(input?.text);
  if (!text) return { error: "text" };
  await ensureIndexes(reports);
  const consent = { public: input?.consent?.public === true, notify: input?.consent?.notify === true };
  // The ID only for the promised message: without "tell me", no ID.
  const reporterId = consent.notify ? cleanId(input?.reporter?.userId) : "";
  const guildId = cleanId(input?.guild?.id);
  const stationName = clip(input?.station?.name || input?.station?.key, 100);
  const doc = {
    _id: randomBytes(8).toString("hex"),
    kind: input.kind,
    text,
    reason: input?.reason ? clip(input.reason, 40) : null,
    source: REPORT_SOURCES.includes(input?.source) ? input.source : "command",
    guild: guildId ? { id: guildId, name: clip(input?.guild?.name, 100) } : null,
    bot: input?.bot?.name ? { id: clip(input.bot.id, 40), name: clip(input.bot.name, 60) } : null,
    station: stationName ? { key: clip(input?.station?.key, 80), name: stationName } : null,
    plan: PLANS.includes(input?.plan) ? input.plan : "free",
    phases: Array.isArray(input?.phases) ? input.phases.slice(0, 5).map((line) => clip(line, 160)) : [],
    language: normalizeBotLanguage(input?.language, "en"),
    consent,
    ...(reporterId ? { reporter: { userId: reporterId, name: clip(input?.reporter?.name, 80) } } : {}),
    status: "new",
    dispatch: { state: "pending", attempts: 0 },
    team: null,
    forum: null,
    createdAt: new Date(now),
    expiresAt: new Date(now + KEEP_OPEN_MS),
  };
  await reports.insertOne(doc);
  return { report: doc };
}

const claimSet = (now) => ({ $set: { "dispatch.state": "claimed", "dispatch.claimedAt": new Date(now) }, $inc: { "dispatch.attempts": 1 } });

/** The oldest report waiting for the team channel, claimed so that no second commander posts it too. */
export async function claimPendingReport({ now = Date.now() } = {}) {
  const reports = collection();
  if (!reports) return null;
  await ensureIndexes(reports);
  return reports.findOneAndUpdate(
    {
      "dispatch.attempts": { $lt: MAX_DISPATCH_ATTEMPTS },
      $or: [
        { "dispatch.state": "pending" },
        { "dispatch.state": "claimed", "dispatch.claimedAt": { $lt: new Date(now - CLAIM_STALE_MS) } },
      ],
    },
    claimSet(now),
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
}

/** Claims one report that is still waiting: the commander posts right away what it took itself. */
export async function claimReport(id, { now = Date.now() } = {}) {
  const reports = collection();
  if (!reports) return null;
  return reports.findOneAndUpdate({ _id: String(id), "dispatch.state": "pending" }, claimSet(now), { returnDocument: "after" });
}

export async function markReportPosted(id, { guildId = "", channelId, messageId, now = Date.now() }) {
  const reports = collection();
  if (!reports) return;
  await reports.updateOne({ _id: String(id) }, {
    $set: { "dispatch.state": "posted", "dispatch.postedAt": new Date(now), team: { guildId: String(guildId || ""), channelId: String(channelId), messageId: String(messageId || "") } },
    $unset: { "dispatch.error": "" },
  });
}

/** Posting failed: try again later, or give up after MAX_DISPATCH_ATTEMPTS. */
export async function markReportUnposted(id, { error = "", attempts = 0 } = {}) {
  const reports = collection();
  if (!reports) return;
  const final = attempts >= MAX_DISPATCH_ATTEMPTS;
  await reports.updateOne({ _id: String(id) }, { $set: { "dispatch.state": final ? "failed" : "pending", "dispatch.error": clip(error, 200) } });
}

export async function findProblemReport(id) {
  const reports = collection();
  if (!reports) return null;
  return reports.findOne({ _id: String(id) });
}

/**
 * The team's click. "in-progress" is a step on the way; done, rejected and
 * duplicate close the report, which is then kept for 180 days.
 * @param {string} id
 * @param {string} decision one of REPORT_DECISIONS
 * @param {{ by?: { id?: string, name?: string }, answer?: string, now?: number }} [options]
 */
export async function decideProblemReport(id, decision, { by = {}, answer = "", now = Date.now() } = {}) {
  const reports = collection();
  if (!reports || !REPORT_DECISIONS.includes(decision)) return null;
  const who = { id: clip(by.id, 22), name: clip(by.name, 80) };
  const closing = decision !== "in-progress";
  return reports.findOneAndUpdate(
    { _id: String(id) },
    {
      $set: {
        status: decision,
        decidedBy: who,
        ...(closing ? { decidedAt: new Date(now), expiresAt: new Date(now + KEEP_DECIDED_MS) } : { expiresAt: new Date(now + KEEP_OPEN_MS) }),
        ...(answer ? { answer: clip(answer, 500) } : {}),
      },
      ...(closing ? {} : { $unset: { decidedAt: "" } }),
    },
    { returnDocument: "after" },
  );
}

/** Notes whether the promised direct message went out (#437). */
export async function markReportNotified(id, { ok, now = Date.now() }) {
  const reports = collection();
  if (!reports) return;
  await reports.updateOne({ _id: String(id) }, { $set: { notified: { at: new Date(now), ok: ok === true } } });
}

/** The owner console's list: open reports first, newest first. */
export async function listProblemReports({ limit = 100, includeClosed = false } = {}) {
  const reports = collection();
  if (!reports) return [];
  const filter = includeClosed ? {} : { status: { $in: ["new", "in-progress"] } };
  return reports.find(filter).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(500, limit))).toArray();
}

/** A person's reports with their Discord ID, for /mydata (#437). */
export async function listReportsOfReporter(userId) {
  const reports = collection();
  const id = cleanId(userId);
  if (!reports || !id) return [];
  return reports.find({ "reporter.userId": id }).sort({ createdAt: -1 }).limit(200).toArray();
}

/** /mydata "delete": the reports stay with the team, without the person's ID and without the promised message. */
export async function forgetReporter(userId) {
  const reports = collection();
  const id = cleanId(userId);
  if (!reports || !id) return 0;
  const result = await reports.updateMany({ "reporter.userId": id }, { $unset: { reporter: "" }, $set: { "consent.notify": false } });
  return Number(result?.modifiedCount || 0);
}

/**
 * Publishing in three steps, so that two clicks never make two posts: hold
 * the place (only with the reporter's consent), post, note the post; a
 * failed post gives the place back. Null when it is published already, held
 * by another click, or not allowed.
 */
export async function claimReportPublishing(id, { now = Date.now() } = {}) {
  const reports = collection();
  if (!reports) return null;
  return reports.findOneAndUpdate(
    { _id: String(id), forum: null, "consent.public": true },
    { $set: { forum: { channelId: "", threadId: "", claimedAt: new Date(now) } } },
    { returnDocument: "after" },
  );
}

export async function completeReportPublishing(id, { channelId, threadId, now = Date.now() }) {
  const reports = collection();
  if (!reports) return null;
  return reports.findOneAndUpdate(
    { _id: String(id), "forum.threadId": "" },
    { $set: { forum: { channelId: String(channelId), threadId: String(threadId), publishedAt: new Date(now) } } },
    { returnDocument: "after" },
  );
}

/** Gives the place back when the forum post failed. */
export async function releaseReportPublishing(id) {
  const reports = collection();
  if (!reports) return;
  await reports.updateOne({ _id: String(id), "forum.threadId": "" }, { $set: { forum: null } });
}
