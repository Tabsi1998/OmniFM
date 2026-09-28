import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";

// Listening sessions keep start and end as dates, so MongoDB's 180-day TTL
// on endedAt removes them. Sessions stored as text before are converted once;
// callers still get text dates.
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-session-dates-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
const guildId = `4${String(Date.now()).padStart(17, "0")}`;

let client = null;
let database = null;
after(async () => {
  if (database) await database.dropDatabase().catch(() => null);
  if (client) await client.close().catch(() => null);
  if (hasMongoConfig) {
    const { getDb, close } = await import("../src/lib/db.js");
    await getDb()?.collection("listening_sessions").deleteMany({ guildId }).catch(() => null);
    await close().catch(() => null);
  }
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
});

test("text dates become dates once, a text that is no date stays, a second run changes nothing", { skip: !hasMongoConfig }, async () => {
  const { convertSessionDates } = await import("../src/listening-stats/migration.js");
  client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  database = client.db(`omnifm_session_dates_${process.pid}`);
  const sessions = database.collection("listening_sessions");
  await sessions.insertMany([
    { guildId: "text", startedAt: "2026-03-01T10:00:00.000Z", endedAt: "2026-03-01T12:00:00.000Z" },
    { guildId: "dates", startedAt: new Date("2026-09-01T10:00:00Z"), endedAt: new Date("2026-09-01T11:00:00Z") },
    { guildId: "broken", startedAt: "kaputt", endedAt: "2026-09-02T11:00:00.000Z" },
  ]);
  assert.equal(await convertSessionDates(database), 2);
  const byGuild = Object.fromEntries((await sessions.find({}).toArray()).map((doc) => [doc.guildId, doc]));
  assert.ok(byGuild.text.startedAt instanceof Date && byGuild.text.endedAt instanceof Date, "the TTL can act on it now");
  assert.equal(byGuild.text.endedAt.toISOString(), "2026-03-01T12:00:00.000Z");
  assert.equal(byGuild.broken.startedAt, "kaputt", "a text that is no date stays");
  assert.ok(byGuild.broken.endedAt instanceof Date);
  assert.equal(await convertSessionDates(database), 0, "nothing left to convert");
});

test("a finished session is stored with dates; the recap finds either form and callers get text", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const store = await import("../src/listening-stats-store.js");
  const sessions = getDb().collection("listening_sessions");

  store.startListeningSession(guildId, { botId: "bot-1", stationKey: "groovesalad", stationName: "Groove Salad", channelId: "1", listenerCount: 2 });
  await store.endListeningSession(guildId, { botId: "bot-1" });
  const stored = await sessions.findOne({ guildId, stationKey: "groovesalad" });
  assert.ok(stored?.startedAt instanceof Date && stored.endedAt instanceof Date, "new sessions carry dates");

  await sessions.insertOne({ guildId, stationKey: "older", startedAt: new Date(Date.now() - 60_000).toISOString(), endedAt: new Date().toISOString(), humanListeningMs: 1000 });
  const since = await store.getGuildSessionsSince(guildId, Date.now() - 3_600_000);
  assert.deepEqual(since.map((session) => session.stationKey).sort(), ["groovesalad", "older"]);
  assert.ok(since.every((session) => typeof session.startedAt === "string"));
  const history = await store.getGuildSessionHistory(guildId, 10);
  assert.ok(history.length === 2 && history.every((session) => typeof session.startedAt === "string" && typeof session.endedAt === "string"));
});
