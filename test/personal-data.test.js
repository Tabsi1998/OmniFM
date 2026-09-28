import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #285: /mydata shows, sends and deletes what OmniFM keeps about one person.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-personal-data-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const {
  PERSONAL_DATA_PREFIX,
  buildPersonalDataPayload,
  parsePersonalDataCustomId,
  personalDataCustomId,
  totalCount,
} = await import("../src/bot/personal-data-panel.js");

// The MongoDB connection and the store timers must not keep the test process alive.
after(async () => {
  const { stopScheduledEventsStore } = await import("../src/scheduled-events-store.js");
  const { stopVoteEventsStore } = await import("../src/vote-events-store.js");
  const { stopDiscordBotListStore } = await import("../src/discordbotlist-store.js");
  const { stopDashboardStore } = await import("../src/dashboard-store.js");
  await Promise.all([stopScheduledEventsStore(), stopVoteEventsStore(), stopDiscordBotListStore(), stopDashboardStore()].map((p) => p.catch(() => null)));
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

test("mydata buttons: own prefix, known actions only", () => {
  assert.equal(personalDataCustomId("erase"), `${PERSONAL_DATA_PREFIX}erase`);
  assert.equal(parsePersonalDataCustomId(personalDataCustomId("export")), "export");
  assert.equal(parsePersonalDataCustomId(`${PERSONAL_DATA_PREFIX}drop`), null);
  assert.equal(parsePersonalDataCustomId("omnifm:saved:clear:0"), null);
});

test("mydata panel: private, and nothing to delete means no delete button", () => {
  const t = (de) => de;
  const empty = { savedSongs: 0, votes: 0, dashboardLogins: 0, ownerConsoleLogins: 0, pollsStarted: 0, eventsCreated: 0, dashboardChanges: 0 };
  const payload = buildPersonalDataPayload({ t, counts: empty });
  const buttons = payload.components.flatMap((component) => component.toJSON().components)
    .filter((block) => block.type === 1)
    .flatMap((row) => row.components);
  assert.ok(payload.flags & 64, "ephemeral");
  assert.equal(buttons.find((button) => button.custom_id === personalDataCustomId("erase"))?.disabled, true);
  assert.equal(buttons.find((button) => button.custom_id === personalDataCustomId("export"))?.disabled, undefined);
  assert.equal(totalCount({ ...empty, savedSongs: 3, votes: 2 }), 5);
});

test("after 'delete everything' the Discord ID is in no collection", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const db = getDb();
  const { saveSong, listSavedSongs } = await import("../src/saved-songs-store.js");
  const { initVoteEventsStore, recordVoteEvent, mergeVoteEvents, listVoteEventsOfUser } = await import("../src/vote-events-store.js");
  const { initDiscordBotListStore, recordDiscordBotListVote } = await import("../src/discordbotlist-store.js");
  const { initDashboardStore, setDashboardAuthSession } = await import("../src/dashboard-store.js");
  const { createOwnerSession } = await import("../src/lib/owner-access.js");
  const { saveActiveStationPoll } = await import("../src/station-polls-store.js");
  const { initScheduledEventsStore, createScheduledEvent, getScheduledEvent } = await import("../src/scheduled-events-store.js");
  const { collectPersonalData, countPersonalData, erasePersonalData } = await import("../src/lib/personal-data.js");
  const { createStationSuggestion } = await import("../src/station-suggestions-store.js");
  await Promise.all([
    initVoteEventsStore({ refreshMs: 60_000 }),
    initDiscordBotListStore({ refreshMs: 60_000 }),
    initDashboardStore({ refreshMs: 60_000 }),
    initScheduledEventsStore({ refreshMs: 60_000 }),
  ]);

  const person = snowflake();
  const other = snowflake();
  const guildId = snowflake();
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

  // Everything a person leaves behind in OmniFM, and someone else's song and vote.
  await saveSong(person, { artist: "Artist", title: "Title", displayTitle: "Artist - Title", stationName: "Groove Salad" });
  await saveSong(other, { artist: "Other", title: "Song", displayTitle: "Other - Song" });
  recordVoteEvent({ provider: "topgg", userId: person, username: "person", votedAt: hourAgo });
  recordVoteEvent({ provider: "topgg", userId: other, username: "other", votedAt: hourAgo });
  recordDiscordBotListVote({ id: person, username: "person", timestamp: hourAgo });
  setDashboardAuthSession(`token-${person}`, {
    user: { id: person, username: "person" },
    guilds: [{ id: guildId, name: "Mein Server", owner: true, permissions: "8" }],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
  await createOwnerSession({ discordId: person, name: "Person" });
  await saveActiveStationPoll({
    guildId, channelId: snowflake(), messageId: snowflake(), endsAt: Date.now() + 60_000, createdBy: person,
    stations: [{ key: "a", name: "A" }, { key: "b", name: "B" }],
  });
  const created = createScheduledEvent({
    guildId, botId: "bot-1", voiceChannelId: snowflake(), stationKey: "groovesalad", name: "Abendradio",
    runAtMs: Date.now() + 86_400_000, createdByUserId: person,
  });
  assert.ok(created?.ok, JSON.stringify(created));
  await db.collection("owner_audit").insertOne({ at: new Date().toISOString(), actor: `dashboard:${person}`, action: "guild.panelDesign.update", target: guildId, summary: "Panel-Design geändert" });
  const suggestionUrl = `https://stream.example.com/suggested-${Math.random().toString(36).slice(2)}.mp3`;
  const suggested = await createStationSuggestion({ name: "Vorschlag FM", url: suggestionUrl }, { userId: person, userName: "person", guildId });
  assert.ok(suggested.suggestion, JSON.stringify(suggested));
  assert.ok(await eventually(async () => (await listVoteEventsOfUser(person)).length === 1
    && Boolean(await db.collection("dashboard_auth_sessions").findOne({ "session.user.id": person }))
    && Boolean(await db.collection("scheduled_events").findOne({ createdByUserId: person }))), "seeded");

  const collected = await collectPersonalData(person);
  assert.equal(collected.ok, true);
  assert.deepEqual(countPersonalData(collected.data), {
    savedSongs: 1, votes: 1, dashboardLogins: 1, ownerConsoleLogins: 1, pollsStarted: 1, eventsCreated: 1, dashboardChanges: 1, stationSuggestions: 1,
  });
  assert.equal(collected.data.dashboardLogins[0].servers[0].name, "Mein Server");
  assert.ok(!JSON.stringify(collected.data).includes(`token-${person}`), "no login token in the file");

  const erased = await erasePersonalData(person, { secondPassMs: 0 });
  assert.equal(erased.ok, true);

  // The acceptance criterion: afterwards no collection holds the ID.
  const holding = async () => {
    const hits = [];
    for (const { name } of await db.listCollections().toArray()) {
      // eslint-disable-next-line no-await-in-loop -- one collection after the other
      const docs = await db.collection(name).find({}).toArray();
      if (docs.some((doc) => JSON.stringify(doc).includes(person))) hits.push(name);
    }
    return hits;
  };
  assert.ok(await eventually(async () => (await holding()).length === 0), `still holding the ID: ${(await holding()).join(", ")}`);

  // What stays: the server's event (without the person), someone else's song and vote.
  assert.equal(getScheduledEvent(created.event.id)?.name, "Abendradio");
  assert.equal(getScheduledEvent(created.event.id)?.createdByUserId, null);
  assert.equal((await listSavedSongs(other)).length, 1);
  assert.equal((await listVoteEventsOfUser(other)).length, 1);
  assert.equal(await db.collection("owner_audit").countDocuments({ actor: "dashboard:gelöscht", target: guildId }), 1);
  // The suggestion stays in the queue, without the person (#303).
  const kept = await db.collection("station_suggestions").findOne({ _id: suggested.suggestion._id });
  assert.equal(kept?.name, "Vorschlag FM");
  assert.equal(kept?.submitter, undefined);
  await db.collection("station_suggestions").deleteOne({ _id: suggested.suggestion._id });

  // A sync reading the old vote again leaves it out; a new vote counts.
  assert.equal(mergeVoteEvents([{ provider: "topgg", userId: person, username: "person", votedAt: hourAgo }]).added, 0);
  assert.equal(recordVoteEvent({ provider: "topgg", userId: person, username: "person", votedAt: new Date(Date.now() + 1000).toISOString() }).added, true);
});
