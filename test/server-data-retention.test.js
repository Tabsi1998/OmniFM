import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #285: 30 days after OmniFM was removed from a server, its data goes; the
// server owner hears about it once, a return keeps everything.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-retention-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const DAY_MS = 24 * 60 * 60 * 1000;

after(async () => {
  const stops = await Promise.all([
    import("../src/scheduled-events-store.js").then((m) => m.stopScheduledEventsStore),
    import("../src/custom-stations.js").then((m) => m.stopCustomStationsStore),
    import("../src/command-permissions-store.js").then((m) => m.stopCommandPermissionsStore),
    import("../src/guild-language-store.js").then((m) => m.stopGuildLanguageStore),
    import("../src/song-history-store.js").then((m) => m.stopSongHistoryStore),
    import("../src/dashboard-store.js").then((m) => m.stopDashboardStore),
    import("../src/bot-state.js").then((m) => m.flushBotStateStore),
  ]);
  await Promise.all(stops.map((stop) => Promise.resolve().then(() => stop?.()).catch(() => null)));
  const { stopServerDataRetention } = await import("../src/services/server-data-retention.js");
  stopServerDataRetention();
  const { close } = await import("../src/lib/db.js");
  await close().catch(() => null);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
});

function snowflake() {
  return String(100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)));
}

async function eventually(check, { timeoutMs = 5000 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- polling until the write queues are through
    if (await check()) return true;
    if (Date.now() > until) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function fakeCommander({ inGuilds = [] } = {}) {
  const dms = [];
  return {
    dms,
    config: { id: "commander", name: "OmniFM DJ", clientId: "123456789012345678" },
    client: {
      guilds: { cache: new Map(inGuilds.map((id) => [id, { id }])) },
      users: { fetch: async (id) => ({ id, send: async (payload) => { dms.push({ id, payload }); } }) },
      application: { id: "123456789012345678" },
      user: { id: "123456789012345678" },
    },
  };
}

test("a server without data: no departure, no DM", { skip: !hasMongoConfig }, async () => {
  const { connect } = await import("../src/lib/db.js");
  await connect();
  const { handleCommanderGuildLeft } = await import("../src/services/server-data-retention.js");
  const commander = fakeCommander();
  const result = await handleCommanderGuildLeft(commander, { id: snowflake(), name: "Leer", ownerId: snowflake() });
  assert.equal(result.recorded, false);
  assert.equal(commander.dms.length, 0);
});

test("removed: one DM, a return keeps it; 30 days later the server's data is gone", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const db = getDb();
  const guildId = snowflake();
  const ownerId = snowflake();
  const botDocId = `bot-${snowflake()}`;

  // A server that used OmniFM: settings, own station and logo, permissions,
  // language, event, poll, song history, stats, telemetry, incidents, bot
  // state, command sync, directory, and a premium entitlement that stays.
  await db.collection("guild_settings").insertOne({ guildId, nowPlayingChannelId: snowflake() });
  await db.collection("custom_stations").insertOne({ guildId, key: "mystation", name: "Mein Sender", url: "https://example.test/stream" });
  await db.collection("station_logos").insertOne({ guildId, key: "mystation", png: "x", updatedAt: new Date() });
  await db.collection("guild_jingles").insertOne({ _id: guildId, guildId, pcm: Buffer.alloc(8), bytes: 8, durationMs: 1000, name: "jingle.mp3", updatedAt: Date.now() });
  for (const collection of ["daily_stats", "listening_sessions", "listener_snapshots", "connection_events", "guild_stats", "song_plays", "runtime_incidents", "year_review_months"]) {
    // eslint-disable-next-line no-await-in-loop
    await db.collection(collection).insertOne({ guildId, at: new Date() });
  }
  await db.collection("guild_command_sync").insertOne({ _id: `123456789012345678:${guildId}`, fingerprint: "x" });
  await db.collection("runtime_guild_directory").insertOne({ _id: guildId, name: "Testserver" });
  await db.collection("bot_state").insertOne({ _id: botDocId, guilds: { [guildId]: { volume: 50 }, keep: { volume: 20 } }, updatedAt: new Date().toISOString() });
  await db.collection("server_entitlements").insertOne({ _serverId: guildId, licenseId: "OMNI-TEST" });
  // A report and a station suggestion from the server stay with the team, without the server (#522).
  const { createProblemReport } = await import("../src/problem-reports-store.js");
  const { createStationSuggestion } = await import("../src/station-suggestions-store.js");
  const reported = await createProblemReport({ kind: "problem", text: "Kein Ton seit gestern", guild: { id: guildId, name: "Testserver" }, reporter: { userId: ownerId, name: "Alex" }, consent: { notify: true } });
  const suggested = await createStationSuggestion({ name: "Retention FM", url: `http://8.8.8.8:8000/omnifm-retention-${snowflake()}.mp3` }, { userId: ownerId, userName: "Alex", guildId });
  assert.ok(reported.report && suggested.suggestion, "report and suggestion kept");

  const { initCustomStationsStore } = await import("../src/custom-stations.js");
  const { initCommandPermissionsStore, setCommandRolePermission } = await import("../src/command-permissions-store.js");
  const { initGuildLanguageStore, setGuildLanguage } = await import("../src/guild-language-store.js");
  const { initScheduledEventsStore, createScheduledEvent } = await import("../src/scheduled-events-store.js");
  const { saveActiveStationPoll } = await import("../src/station-polls-store.js");
  const { initSongHistoryStore, appendSongHistory } = await import("../src/song-history-store.js");
  const { initDashboardStore, setDashboardTelemetry } = await import("../src/dashboard-store.js");
  const { initBotStateStore } = await import("../src/bot-state.js");
  await Promise.all([
    initCustomStationsStore({ refreshMs: 60_000 }),
    initCommandPermissionsStore({ refreshMs: 60_000 }),
    initGuildLanguageStore({ refreshMs: 60_000 }),
    initScheduledEventsStore({ refreshMs: 60_000 }),
    initSongHistoryStore(),
    initDashboardStore({ refreshMs: 60_000 }),
    initBotStateStore(),
  ]);
  setCommandRolePermission(guildId, "play", snowflake(), "allow");
  setGuildLanguage(guildId, "en");
  assert.ok(createScheduledEvent({ guildId, botId: "bot-1", voiceChannelId: snowflake(), stationKey: "groovesalad", name: "Abendradio", runAtMs: Date.now() + DAY_MS })?.ok);
  await saveActiveStationPoll({ guildId, channelId: snowflake(), messageId: snowflake(), endsAt: Date.now() + 60_000, stations: [{ key: "a", name: "A" }, { key: "b", name: "B" }] });
  appendSongHistory(guildId, { displayTitle: "Artist - Title", artist: "Artist", title: "Title" });
  setDashboardTelemetry(guildId, { views: 3 });
  assert.ok(await eventually(async () => Boolean(await db.collection("song_history").findOne({ guildId }))
    && Boolean(await db.collection("scheduled_events").findOne({ guildId }))
    && Boolean(await db.collection("command_permissions").findOne({ _guildId: guildId }))
    && Boolean(await db.collection("guild_languages").findOne({ _id: guildId }))
    && Boolean(await db.collection("dashboard_telemetry").findOne({ _id: guildId }))), "seeded");

  const { handleCommanderGuildLeft, handleCommanderGuildJoined, runServerDataRetention } = await import("../src/services/server-data-retention.js");
  const { listGuildDepartures } = await import("../src/guild-departures-store.js");
  const leftAt = new Date(Date.now() - 31 * DAY_MS);
  const guild = { id: guildId, name: "Testserver", ownerId };

  // Removed: the owner hears it once, with the date.
  const commander = fakeCommander();
  assert.deepEqual(await handleCommanderGuildLeft(commander, guild, { now: leftAt }), { recorded: true, notified: true });
  assert.deepEqual(await handleCommanderGuildLeft(commander, guild, { now: leftAt }), { recorded: true, notified: false });
  assert.equal(commander.dms.length, 1);
  assert.equal(commander.dms[0].id, ownerId);
  assert.match(JSON.stringify(commander.dms[0].payload.components.map((c) => c.toJSON())), /Testserver/);
  const pending = (await listGuildDepartures()).find((row) => row.guildId === guildId);
  assert.ok(pending?.ownerNotifiedAt, "noted as told");

  // Back within the 30 days: nothing goes.
  await handleCommanderGuildJoined(guildId);
  assert.equal((await listGuildDepartures()).some((row) => row.guildId === guildId), false);
  assert.deepEqual(await runServerDataRetention(fakeCommander()), []);
  assert.ok(await db.collection("guild_settings").findOne({ guildId }));

  // Removed again, 31 days ago; the commander is not on the server.
  await handleCommanderGuildLeft(fakeCommander(), guild, { now: leftAt });
  const done = await runServerDataRetention(fakeCommander());
  assert.deepEqual(done.map((row) => row.guildId), [guildId]);

  // Everything of the server is gone, except the premium entitlement and the audit entry.
  const allowed = new Set(["server_entitlements", "owner_audit"]);
  const holding = async () => {
    const hits = [];
    for (const { name } of await db.listCollections().toArray()) {
      if (allowed.has(name)) continue;
      // eslint-disable-next-line no-await-in-loop -- one collection after the other
      const docs = await db.collection(name).find({}).toArray();
      if (docs.some((doc) => JSON.stringify(doc).includes(guildId))) hits.push(name);
    }
    return hits;
  };
  assert.ok(await eventually(async () => (await holding()).length === 0), `still holding the server: ${(await holding()).join(", ")}`);
  assert.ok(await db.collection("server_entitlements").findOne({ _serverId: guildId }), "premium stays");
  const report = await db.collection("problem_reports").findOne({ _id: reported.report._id });
  assert.equal(report?.text, "Kein Ton seit gestern", "the report stays");
  assert.equal(report.guild, null);
  assert.doesNotMatch(JSON.stringify(report), /Testserver/);
  const suggestion = await db.collection("station_suggestions").findOne({ _id: suggested.suggestion._id });
  assert.equal(suggestion?.name, "Retention FM", "the suggestion stays");
  assert.equal(suggestion.submitter.guildId, null);
  assert.equal(suggestion.submitter.userId, ownerId, "the person keeps their answer");
  assert.deepEqual((await db.collection("bot_state").findOne({ _id: botDocId }))?.guilds, { keep: { volume: 20 } });
});

test("a due server the commander is back on is not deleted", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const guildId = snowflake();
  await getDb().collection("guild_settings").insertOne({ guildId });
  const { handleCommanderGuildLeft, runServerDataRetention } = await import("../src/services/server-data-retention.js");
  await handleCommanderGuildLeft(fakeCommander(), { id: guildId, name: "Zurück", ownerId: snowflake() }, { now: new Date(Date.now() - 40 * DAY_MS) });
  assert.deepEqual(await runServerDataRetention(fakeCommander({ inGuilds: [guildId] })), []);
  assert.ok(await getDb().collection("guild_settings").findOne({ guildId }));
});

test("a server with only reports and suggestions is announced; purging leaves other servers alone (#522)", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const db = getDb();
  const { createProblemReport } = await import("../src/problem-reports-store.js");
  const { createStationSuggestion } = await import("../src/station-suggestions-store.js");
  const { hasServerData, handleCommanderGuildLeft, purgeServerData } = await import("../src/services/server-data-retention.js");
  const { clearGuildDeparture } = await import("../src/guild-departures-store.js");
  const reportsOnly = snowflake();
  const suggestionsOnly = snowflake();
  const other = snowflake();
  const report = (guildId, name, text) => createProblemReport({ kind: "problem", text, guild: { id: guildId, name } });
  const suggest = (guildId) => createStationSuggestion({ name: "Only FM", url: `http://8.8.8.8:8000/omnifm-only-${snowflake()}.mp3` }, { userId: snowflake(), guildId });
  const mine = [await report(reportsOnly, "Nur Meldungen", "Erste Meldung"), await report(reportsOnly, "Nur Meldungen", "Zweite Meldung")].map((r) => r.report._id);
  const theirs = (await report(other, "Anderer Server", "Fremde Meldung")).report._id;
  const mySuggestions = [await suggest(suggestionsOnly), await suggest(suggestionsOnly)].map((r) => r.suggestion._id);
  const theirSuggestion = (await suggest(other)).suggestion._id;

  assert.equal(await hasServerData(reportsOnly), true, "reports count as data");
  assert.equal(await hasServerData(suggestionsOnly), true, "suggestions count as data");
  const commander = fakeCommander();
  assert.equal((await handleCommanderGuildLeft(commander, { id: reportsOnly, name: "Nur Meldungen", ownerId: snowflake() })).recorded, true);
  assert.equal((await handleCommanderGuildLeft(commander, { id: suggestionsOnly, name: "Nur Vorschläge", ownerId: snowflake() })).recorded, true);
  assert.equal(commander.dms.length, 2);
  await clearGuildDeparture(reportsOnly);
  await clearGuildDeparture(suggestionsOnly);

  await purgeServerData(reportsOnly);
  await purgeServerData(suggestionsOnly);
  for (const doc of await db.collection("problem_reports").find({ _id: { $in: mine } }).toArray()) {
    assert.equal(doc.guild, null);
    assert.doesNotMatch(JSON.stringify(doc), new RegExp(`${reportsOnly}|Nur Meldungen`));
  }
  assert.equal(await db.collection("problem_reports").countDocuments({ _id: { $in: mine } }), 2, "the reports stay");
  for (const doc of await db.collection("station_suggestions").find({ _id: { $in: mySuggestions } }).toArray()) {
    assert.equal(doc.submitter.guildId, null);
  }
  assert.equal(await db.collection("station_suggestions").countDocuments({ _id: { $in: mySuggestions } }), 2, "the suggestions stay");
  assert.deepEqual((await db.collection("problem_reports").findOne({ _id: theirs }))?.guild, { id: other, name: "Anderer Server" });
  assert.equal((await db.collection("station_suggestions").findOne({ _id: theirSuggestion }))?.submitter?.guildId, other);
  assert.equal(await hasServerData(reportsOnly), false);
  assert.equal(await hasServerData(suggestionsOnly), false);
});
