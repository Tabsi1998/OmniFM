// ============================================================
// OmniFM: the public status page (#299), measured and stored
// ============================================================
// Every minute the web server looks at the bots' health document and counts
// per bot and day the minutes measured and the minutes online
// (status_uptime). An offline bot opens an outage (status_outages), online
// again closes it. The owner console adds incidents and maintenance windows
// (status_notices). The public entry and the commander both measure, so one
// of them going down leaves no gap; a minute counts once per bot
// (lastMinute), never twice.

import { randomBytes } from "node:crypto";
import { getDb, isConnected } from "../lib/db.js";
import { log } from "../lib/logging.js";
import { loadOwnerConfigRaw } from "../lib/owner-config.js";
import { commanderIndex, loadConfiguredBots, readRuntimeHealthFresh } from "../lib/owner-monitoring.js";
import {
  HISTORY_DAYS,
  STATUS_DAYS,
  STATUS_KEEP_MS,
  STATUS_TIME_ZONE,
  buildStatusResponse,
  lastStatusDays,
  normalizeStatusNotice,
  statusBotsNow,
  statusDay,
} from "../lib/status-page.js";

const isoOf = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/**
 * Counts one minute for each bot: measured, and online or not. Only the
 * process that counts a bot's minute first moves its outage, so two
 * processes open no second one. Returns how many bots this call counted.
 */
export async function recordStatusSample(db, bots, { now = Date.now(), timeZone = STATUS_TIME_ZONE } = {}) {
  const minute = Math.floor(now / 60_000);
  const day = statusDay(now, timeZone);
  const at = new Date(now);
  const uptime = db.collection("status_uptime");
  const outages = db.collection("status_outages");
  const counted = [];
  for (const bot of bots) {
    try {
      // eslint-disable-next-line no-await-in-loop -- a handful of bots, one after the other
      await uptime.updateOne(
        { _id: `${day}|${bot.key}`, lastMinute: { $lt: minute } },
        {
          $inc: { total: 1, online: bot.online ? 1 : 0 },
          $set: { day, bot: bot.key, name: bot.name, tier: bot.tier, role: bot.role, lastMinute: minute, updatedAt: at },
        },
        { upsert: true },
      );
      counted.push(bot);
    } catch (err) {
      // The other process counted this minute already.
      if (err?.code !== 11000) throw err;
    }
  }
  const closed = { $set: { endedAt: at, expiresAt: new Date(now + STATUS_KEEP_MS) } };
  for (const bot of counted) {
    if (bot.online) {
      // eslint-disable-next-line no-await-in-loop
      await outages.updateMany({ bot: bot.key, endedAt: null }, closed);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await outages.updateOne(
        { bot: bot.key, endedAt: null },
        { $setOnInsert: { name: bot.name, startedAt: at } },
        { upsert: true },
      );
    }
  }
  // A bot taken out of the configuration leaves no outage open forever.
  if (counted.length) await outages.updateMany({ bot: { $nin: bots.map((bot) => bot.key) }, endedAt: null }, closed);
  return counted.length;
}

/** GET /api/status from MongoDB; without it the page says it measures nothing. */
export async function statusResponse(db, raw, env = process.env, { now = Date.now(), timeZone = STATUS_TIME_ZONE } = {}) {
  const configured = loadConfiguredBots(raw, env);
  const commander = commanderIndex(env);
  if (!db) return buildStatusResponse({ bots: statusBotsNow(configured, null, commander), now, timeZone, measuring: false });
  const bots = statusBotsNow(configured, await readRuntimeHealthFresh(db, { now }), commander);
  const firstDay = lastStatusDays(now, STATUS_DAYS, timeZone)[0];
  const historyFrom = new Date(now - HISTORY_DAYS * 86_400_000);
  const [uptimeDocs, outages, notices] = await Promise.all([
    db.collection("status_uptime")
      .find({ day: { $gte: firstDay } }, { projection: { _id: 0, day: 1, bot: 1, online: 1, total: 1 } })
      .toArray(),
    db.collection("status_outages")
      .find({ $or: [{ endedAt: null }, { endedAt: { $gte: historyFrom } }] }, { projection: { _id: 0, bot: 1, name: 1, startedAt: 1, endedAt: 1 } })
      .toArray(),
    db.collection("status_notices")
      .find({}, { projection: { createdBy: 0, updatedBy: 0 } })
      .toArray(),
  ]);
  return buildStatusResponse({ bots, uptimeDocs, outages, notices, now, timeZone });
}

function ownerNotice(doc) {
  return {
    id: String(doc._id),
    kind: doc.kind,
    title: doc.title,
    message: doc.message || "",
    impact: doc.impact,
    startsAt: isoOf(doc.startsAt),
    endsAt: isoOf(doc.endsAt),
    resolvedAt: isoOf(doc.resolvedAt),
    createdAt: isoOf(doc.createdAt),
    updatedAt: isoOf(doc.updatedAt),
    createdBy: doc.createdBy || null,
    updatedBy: doc.updatedBy || null,
  };
}

/** The owner console's list: newest first, ended ones until they expire. */
export async function listStatusNotices(db) {
  const rows = await db.collection("status_notices").find({}).sort({ startsAt: -1 }).limit(100).toArray();
  return rows.map(ownerNotice);
}

export async function createStatusNotice(db, input, { actor = "owner", now = Date.now() } = {}) {
  const { notice, error } = normalizeStatusNotice(input, { now });
  if (error) return { error };
  const at = new Date(now);
  const doc = { _id: randomBytes(8).toString("hex"), ...notice, createdAt: at, updatedAt: at, createdBy: actor, updatedBy: actor };
  await db.collection("status_notices").insertOne(doc);
  return { notice: ownerNotice(doc) };
}

export async function updateStatusNotice(db, id, patch, { actor = "owner", now = Date.now() } = {}) {
  const previous = await db.collection("status_notices").findOne({ _id: String(id) });
  if (!previous) return { error: "Diese Meldung gibt es nicht mehr.", status: 404 };
  const { notice, error } = normalizeStatusNotice(patch, { now, previous });
  if (error) return { error, status: 400 };
  const update = { ...notice, updatedAt: new Date(now), updatedBy: actor };
  await db.collection("status_notices").updateOne({ _id: previous._id }, { $set: update });
  return { notice: ownerNotice({ ...previous, ...update }) };
}

export async function deleteStatusNotice(db, id) {
  const result = await db.collection("status_notices").deleteOne({ _id: String(id) });
  return Number(result?.deletedCount || 0) > 0;
}

let samplerTimer = null;

/** Measures every minute while MongoDB is there; a failure is logged once until it changes. */
export function startStatusSampler({ intervalMs = 60_000, env = process.env } = {}) {
  if (samplerTimer) return () => {};
  let lastError = "";
  const tick = async () => {
    if (!isConnected() || !getDb()) return;
    try {
      const db = getDb();
      const configured = loadConfiguredBots(await loadOwnerConfigRaw({ db }), env);
      const bots = statusBotsNow(configured, await readRuntimeHealthFresh(db), commanderIndex(env));
      await recordStatusSample(db, bots);
      lastError = "";
    } catch (err) {
      const message = String(err?.message || err);
      if (message !== lastError) log("WARN", `[status] Messung für die Statusseite fehlgeschlagen: ${message}`);
      lastError = message;
    }
  };
  samplerTimer = setInterval(() => { tick(); }, Math.max(10_000, intervalMs));
  samplerTimer.unref?.();
  return () => {
    clearInterval(samplerTimer);
    samplerTimer = null;
  };
}
