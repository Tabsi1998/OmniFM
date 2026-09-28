import test, { after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import {
  HISTORY_MIN_OUTAGE_MS,
  OUTAGE_GRACE_MS,
  buildStatusResponse,
  lastStatusDays,
  normalizeStatusNotice,
  statusBotsNow,
  statusDay,
} from "../src/lib/status-page.js";
import {
  createStatusNotice,
  deleteStatusNotice,
  listStatusNotices,
  recordStatusSample,
  statusResponse,
  updateStatusNotice,
} from "../src/services/status-page.js";

// #299: the public status page. Every minute counts per bot and day; an
// offline bot opens an outage; the answer names bots and plans only.
const MINUTE = 60_000;
const NOW = Date.parse("2026-09-27T12:00:30.000Z");
const COMMANDER_ID = "1".repeat(18);
const WORKER_ID = "2".repeat(18);
const GUILD_ID = "3".repeat(18);
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const configured = [
  { index: 1, name: "OmniFM DJ", clientId: COMMANDER_ID, requiredTier: "free" },
  { index: 2, name: "OmniFM 2", clientId: WORKER_ID, requiredTier: "pro" },
];
const onlineDoc = {
  nodes: [
    { botId: COMMANDER_ID, index: 1, status: "online", guildIds: [GUILD_ID], guildDetails: [{ guildId: GUILD_ID, name: "Geheimer Server", listenerCount: 7 }] },
    { botId: WORKER_ID, index: 2, status: "online", guildIds: [GUILD_ID] },
  ],
};

test("a day is the calendar day in German time, and a clock change skips none", () => {
  // 22:30 UTC on 29 March 2026 is 00:30 on the 30th in Berlin (summer time since 02:00).
  assert.equal(statusDay(Date.parse("2026-03-29T22:30:00Z")), "2026-03-30");
  assert.deepEqual(lastStatusDays(Date.parse("2026-03-29T22:30:00Z"), 3), ["2026-03-28", "2026-03-29", "2026-03-30"]);
  assert.deepEqual(lastStatusDays(Date.parse("2026-10-25T23:30:00Z"), 3), ["2026-10-24", "2026-10-25", "2026-10-26"]);
  assert.equal(lastStatusDays(NOW).length, 90);
});

test("bots are matched by client ID, then by slot; without a health document all are offline", () => {
  const bots = statusBotsNow(configured, { nodes: [{ botId: COMMANDER_ID, index: 9, status: "online" }, { index: 2, status: "offline" }] }, 1);
  assert.deepEqual(bots.map((bot) => [bot.key, bot.role, bot.tier, bot.online]), [
    ["bot-1", "commander", "free", true],
    ["bot-2", "worker", "pro", false],
  ]);
  assert.deepEqual(statusBotsNow(configured, null, 1).map((bot) => bot.online), [false, false]);
});

test("availability is rounded down, a restart is no outage, a long one is", () => {
  const bots = statusBotsNow(configured, { nodes: [onlineDoc.nodes[0]] }, 1);
  const today = statusDay(NOW);
  const shortOutage = [{ bot: "bot-2", startedAt: new Date(NOW - MINUTE), endedAt: null }];
  const response = buildStatusResponse({
    bots,
    uptimeDocs: [{ day: today, bot: "bot-1", online: 1439, total: 1440 }],
    outages: shortOutage,
    now: NOW,
  });
  assert.equal(response.bots[0].uptime, 99.93);
  assert.equal(response.bots[0].days.at(-1).down, 1);
  assert.equal(response.bots[1].uptime, null, "a bot without a measured minute has no number");
  assert.equal(response.bots[1].offlineSince, new Date(NOW - MINUTE).toISOString());
  assert.deepEqual(response.current, [], "offline for a minute is a restart");
  assert.equal(response.overall, "operational");

  const longOutage = [{ bot: "bot-2", startedAt: new Date(NOW - OUTAGE_GRACE_MS), endedAt: null }];
  const later = buildStatusResponse({ bots, outages: longOutage, now: NOW });
  assert.deepEqual(later.current, [{ type: "outage", bot: "OmniFM 2", since: new Date(NOW - OUTAGE_GRACE_MS).toISOString() }]);
  assert.equal(later.overall, "minor");

  const allDown = statusBotsNow(configured, null, 1);
  const outages = allDown.map((bot) => ({ bot: bot.key, startedAt: new Date(NOW - 10 * MINUTE), endedAt: null }));
  assert.equal(buildStatusResponse({ bots: allDown, outages, now: NOW }).overall, "major");
  assert.equal(buildStatusResponse({ bots: allDown, now: NOW, measuring: false }).overall, "unknown");
});

test("notices: maintenance wins over a measured outage, a major incident over everything", () => {
  const bots = statusBotsNow(configured, null, 1);
  const outages = bots.map((bot) => ({ bot: bot.key, startedAt: new Date(NOW - 10 * MINUTE), endedAt: null }));
  const maintenance = { _id: "m1", kind: "maintenance", title: "Server-Update", startsAt: new Date(NOW - MINUTE), endsAt: new Date(NOW + 30 * MINUTE) };
  const withMaintenance = buildStatusResponse({ bots, outages, notices: [maintenance], now: NOW });
  assert.equal(withMaintenance.overall, "maintenance");
  assert.deepEqual(withMaintenance.maintenance.map((entry) => [entry.id, entry.active]), [["m1", true]]);

  const major = { _id: "i1", kind: "incident", title: "Discord stört", impact: "major", startsAt: new Date(NOW - 5 * MINUTE), createdBy: "Fabian (1)" };
  const withMajor = buildStatusResponse({ bots, outages, notices: [maintenance, major], now: NOW });
  assert.equal(withMajor.overall, "major");
  assert.ok(!JSON.stringify(withMajor).includes("Fabian"), "who wrote a notice stays in the owner console");
});

test("history: 14 days, outages from 5 minutes on, a maintenance called off before its start is not there", () => {
  const bots = statusBotsNow(configured, onlineDoc, 1);
  const outages = [
    { bot: "bot-2", startedAt: new Date(NOW - 60 * MINUTE), endedAt: new Date(NOW - 60 * MINUTE + HISTORY_MIN_OUTAGE_MS) },
    { bot: "bot-2", startedAt: new Date(NOW - 30 * MINUTE), endedAt: new Date(NOW - 27 * MINUTE) },
    { bot: "bot-1", startedAt: new Date(NOW - 20 * 86_400_000), endedAt: new Date(NOW - 19 * 86_400_000) },
  ];
  const notices = [
    { _id: "i1", kind: "incident", title: "Sender hakten", impact: "minor", startsAt: new Date(NOW - 3 * 3_600_000), resolvedAt: new Date(NOW - 2 * 3_600_000) },
    { _id: "m1", kind: "maintenance", title: "Abgesagt", startsAt: new Date(NOW + 3_600_000), endsAt: new Date(NOW + 7_200_000), resolvedAt: new Date(NOW - MINUTE) },
  ];
  const response = buildStatusResponse({ bots, outages, notices, now: NOW });
  assert.deepEqual(response.history.map((entry) => [entry.type, entry.bot || entry.title]), [
    ["outage", "OmniFM 2"],
    ["incident", "Sender hakten"],
  ]);
  assert.deepEqual(response.maintenance, []);
});

test("owner notices are checked before they are stored", () => {
  assert.match(normalizeStatusNotice({ kind: "maintenance", title: "Update" }).error, /Beginn und Ende/);
  assert.match(normalizeStatusNotice({ kind: "maintenance", title: "Update", startsAt: "2026-09-28T10:00:00Z", endsAt: "2026-09-28T09:00:00Z" }).error, /vor ihrem Beginn/);
  assert.match(normalizeStatusNotice({ kind: "incident", title: "  " }).error, /Titel/);
  assert.match(normalizeStatusNotice({ kind: "outage", title: "x" }).error, /Störung oder Wartung/);

  const { notice } = normalizeStatusNotice({ kind: "incident", title: "Hakt", impact: "huge" }, { now: NOW });
  assert.equal(notice.impact, "minor");
  assert.equal(notice.startsAt.toISOString(), new Date(NOW).toISOString());
  assert.equal(notice.expiresAt, null, "an open incident does not expire");
  const resolved = normalizeStatusNotice({ resolved: true }, { now: NOW + MINUTE, previous: notice }).notice;
  assert.equal(resolved.resolvedAt.toISOString(), new Date(NOW + MINUTE).toISOString());
  assert.ok(resolved.expiresAt > resolved.resolvedAt);
  assert.equal(normalizeStatusNotice({ resolved: false }, { now: NOW, previous: resolved }).notice.resolvedAt, null);
});

let client = null;
let database = null;

after(async () => {
  if (database) await database.dropDatabase().catch(() => null);
  if (client) await client.close().catch(() => null);
});

async function testDatabase() {
  client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  database = client.db(`omnifm_status_test_${process.pid}`);
  return database;
}

test("a minute counts once even when two processes measure, and outages open and close", { skip: !hasMongoConfig }, async () => {
  const db = await testDatabase();
  const down = statusBotsNow(configured, { nodes: [onlineDoc.nodes[0]] }, 1);
  assert.equal(await recordStatusSample(db, down, { now: NOW }), 2);
  assert.equal(await recordStatusSample(db, down, { now: NOW + 1000 }), 0, "the other process, same minute");
  assert.equal(await recordStatusSample(db, down, { now: NOW + MINUTE }), 2);
  const worker = await db.collection("status_uptime").findOne({ _id: `${statusDay(NOW)}|bot-2` });
  assert.deepEqual([worker.total, worker.online], [2, 0]);
  const open = await db.collection("status_outages").find({ bot: "bot-2", endedAt: null }).toArray();
  assert.equal(open.length, 1, "one outage, not one per minute");
  assert.equal(open[0].startedAt.toISOString(), new Date(NOW).toISOString());

  const up = statusBotsNow(configured, onlineDoc, 1);
  await recordStatusSample(db, up, { now: NOW + 2 * MINUTE });
  const closed = await db.collection("status_outages").findOne({ bot: "bot-2" });
  assert.equal(closed.endedAt.toISOString(), new Date(NOW + 2 * MINUTE).toISOString());
  assert.ok(closed.expiresAt > closed.endedAt);

  await db.collection("runtime_health").insertOne({ _id: "latest", at: new Date(NOW + 2 * MINUTE).toISOString(), ...onlineDoc });
  const env = { BOT_1_CLIENT_ID: COMMANDER_ID, BOT_1_NAME: "OmniFM DJ", BOT_2_CLIENT_ID: WORKER_ID, BOT_2_NAME: "OmniFM 2", BOT_2_TIER: "pro" };
  const response = await statusResponse(db, {}, env, { now: NOW + 2 * MINUTE + 5000 });
  assert.deepEqual(response.bots.map((bot) => [bot.name, bot.online, bot.uptime]), [["OmniFM DJ", true, 100], ["OmniFM 2", true, 33.33]]);
  const text = JSON.stringify(response);
  for (const secret of [GUILD_ID, COMMANDER_ID, WORKER_ID, "Geheimer Server", "listenerCount"]) {
    assert.ok(!text.includes(secret), `the public answer carries no ${secret}`);
  }
});

test("the owner writes, changes, ends and deletes a notice", { skip: !hasMongoConfig }, async () => {
  const db = database || await testDatabase();
  const created = await createStatusNotice(db, { kind: "incident", title: "Sender starten verzögert", impact: "minor" }, { actor: "Fabian (1)", now: NOW });
  assert.match(created.notice.id, /^[a-f0-9]{16}$/);
  const changed = await updateStatusNotice(db, created.notice.id, { message: "Wir sind dran.", resolved: true }, { actor: "Fabian (1)", now: NOW + MINUTE });
  assert.equal(changed.notice.message, "Wir sind dran.");
  assert.equal(changed.notice.resolvedAt, new Date(NOW + MINUTE).toISOString());
  assert.equal((await updateStatusNotice(db, "0".repeat(16), { title: "x" })).status, 404);
  assert.equal((await listStatusNotices(db)).length, 1);
  assert.equal(await deleteStatusNotice(db, created.notice.id), true);
  assert.equal(await deleteStatusNotice(db, created.notice.id), false);
});
