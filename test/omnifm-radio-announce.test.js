import test, { after } from "node:test";
import assert from "node:assert/strict";

// OmniFM Radio (#593): when DJ Tabsi goes live, OmniFM 1 announces the show
// on every server that can see the station, at most once in two hours, and
// edits the same message when the show ends.
import { getOmnifmRadioConfig } from "../src/services/omnifm-radio-config.js";
import { normalizeRadioAnnounceSettings } from "../src/lib/omnifm-radio-announce-settings.js";
import { createOmnifmRadioAnnounceStore } from "../src/omnifm-radio-announce-store.js";
import {
  ANNOUNCE_LIMIT_MS,
  createOmnifmRadioAnnouncer,
  radioShowId,
} from "../src/services/omnifm-radio-announce.js";

const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const TEST_GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const THIRD_GUILD = "333333333333333333";
const START = Date.parse("2026-11-25T20:00:00Z");
const MINUTE = 60 * 1000;

after(async () => {
  const { close } = await import("../src/lib/db.js");
  await close().catch(() => null);
});

function clock(at = START) {
  const time = { at };
  const now = () => time.at;
  now.advance = (ms) => { time.at += ms; };
  return now;
}

function radioConfig({ isPublic = false } = {}) {
  return getOmnifmRadioConfig({ OMNIFM_RADIO_TEST_GUILD_IDS: TEST_GUILD, OMNIFM_RADIO_PUBLIC: isPublic ? "1" : "0" });
}

/** OmniFM 1 as the announcer sees it: ready, on some servers, posting and editing. */
function fakeBot({ id = "bot-2", guilds = [TEST_GUILD, OTHER_GUILD], ready = true } = {}) {
  const bot = {
    config: { id, name: "OmniFM 1" },
    client: { isReady: () => ready, guilds: { cache: new Map(guilds.map((guildId) => [guildId, { id: guildId }])) } },
    posts: [],
    edits: [],
    postResult: (guildId) => ({ ok: true, channelId: `9${guildId.slice(1)}`, messageId: `8${guildId.slice(1)}` }),
    async postRadioAnnouncement(guildId, options) {
      bot.posts.push({ guildId, ...options });
      return bot.postResult(guildId, options);
    },
    async endRadioAnnouncement(guildId, options) {
      bot.edits.push({ guildId, ...options });
      return { ok: true };
    },
  };
  return bot;
}

function setup({ bot = fakeBot(), store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false }), settings = {}, isPublic = false, now = clock(), getAnnouncer } = {}) {
  const sleeps = [];
  const announcer = createOmnifmRadioAnnouncer({
    getAnnouncer: getAnnouncer || (() => bot),
    store,
    loadSettings: async (guildId) => settings[guildId] || {},
    getConfig: () => radioConfig({ isPublic }),
    now,
    intervalMs: 1500,
    sleep: async (ms) => { sleeps.push(ms); now.advance(ms); },
  });
  return { bot, store, announcer, now, sleeps };
}

const show = (at = START, overrides = {}) => ({
  isLive: true,
  streamerName: "DJ Tabsi",
  title: "Abendshow",
  startedAt: new Date(at).toISOString(),
  source: "webhook",
  ...overrides,
});
const ended = (live, at) => ({ ...live, isLive: false, endedAt: new Date(at).toISOString(), durationMs: at - Date.parse(live.startedAt) });

// ---------------------------------------------------------------- settings

test("the server's setting: on by default, the system channel, no role", () => {
  assert.deepEqual(normalizeRadioAnnounceSettings(undefined), { enabled: true, channelId: "", roleId: "" });
  assert.deepEqual(normalizeRadioAnnounceSettings({ enabled: false }), { enabled: false, channelId: "", roleId: "" });
  assert.deepEqual(
    normalizeRadioAnnounceSettings({ enabled: true, channelId: " 123456789012345678 ", roleId: "223456789012345678" }),
    { enabled: true, channelId: "123456789012345678", roleId: "223456789012345678" },
  );
  assert.deepEqual(normalizeRadioAnnounceSettings({ channelId: "#general", roleId: "@everyone" }), { enabled: true, channelId: "", roleId: "" }, "only Discord ids");
});

// ---------------------------------------------------------------- store

async function exerciseStore(store) {
  const showId = radioShowId(show());
  assert.equal(await store.lastPostedAt(TEST_GUILD), null);
  await store.record({ showId, guildId: TEST_GUILD, botId: "bot-2", channelId: "1", messageId: "2", test: false, postedAt: new Date(START) });
  await store.record({ showId: "test:x", guildId: TEST_GUILD, botId: "bot-2", channelId: "1", messageId: "3", test: true, postedAt: new Date(START + 5 * MINUTE) });
  assert.equal(await store.lastPostedAt(TEST_GUILD), START, "a test show does not count");
  const open = await store.listForShow(showId);
  assert.deepEqual(open.map((entry) => [entry.guildId, entry.channelId, entry.messageId, entry.botId]), [[TEST_GUILD, "1", "2", "bot-2"]]);
  await store.markEnded(open[0], new Date(START + 60 * MINUTE));
  assert.deepEqual(await store.listForShow(showId), [], "an edited message is done");
}

test("the store keeps each posted message and when a server last got one (in memory)", async () => {
  await exerciseStore(createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false }));
});

test("the store refuses to forget while MongoDB is configured but away", async () => {
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => true });
  await assert.rejects(store.lastPostedAt(TEST_GUILD), /MongoDB/);
});

test("the store keeps each posted message in MongoDB", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const db = getDb();
  await db.collection("omnifm_radio_announcements").deleteMany({});
  await exerciseStore(createOmnifmRadioAnnounceStore({ getDatabase: () => db }));
  const indexes = (await db.collection("omnifm_radio_announcements").indexes()).map((index) => index.name);
  assert.ok(indexes.includes("ttl"), "old entries expire");
});

// ---------------------------------------------------------------- who gets it

test("a live show is announced only on servers that see OmniFM Radio", async () => {
  const hidden = setup();
  hidden.announcer.handle({ type: "start", show: show() });
  await hidden.announcer.idle();
  assert.deepEqual(hidden.bot.posts.map((post) => post.guildId), [TEST_GUILD], "while not public: the test server only");

  const open = setup({ isPublic: true });
  open.announcer.handle({ type: "start", show: show() });
  await open.announcer.idle();
  assert.deepEqual(open.bot.posts.map((post) => post.guildId).sort(), [TEST_GUILD, OTHER_GUILD], "public: every server of OmniFM 1");
  assert.equal(open.bot.posts[0].show.streamerName, "DJ Tabsi");
  assert.equal(open.bot.posts[0].show.title, "Abendshow");
});

test("a test show reaches the test servers only, even when the station is public", async () => {
  const { bot, announcer } = setup({ isPublic: true });
  announcer.handle({ type: "start", show: show(START, { source: "test", streamerName: "Test-DJ" }) });
  await announcer.idle();
  assert.deepEqual(bot.posts.map((post) => post.guildId), [TEST_GUILD]);
});

test("a server that is off is skipped; channel and role come from its setting", async () => {
  const { bot, announcer } = setup({
    isPublic: true,
    settings: {
      [TEST_GUILD]: { omnifmRadioAnnounce: { enabled: false } },
      [OTHER_GUILD]: { omnifmRadioAnnounce: { enabled: true, channelId: "444444444444444444", roleId: "555555555555555555" } },
    },
  });
  announcer.handle({ type: "start", show: show() });
  await announcer.idle();
  assert.deepEqual(bot.posts.map((post) => [post.guildId, post.channelId, post.roleId]), [[OTHER_GUILD, "444444444444444444", "555555555555555555"]]);
});

test("a server OmniFM 1 cannot write to is skipped and keeps its next announcement", async () => {
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  bot.postResult = () => ({ ok: false, reason: "missing-permissions" });
  const { store, announcer, now } = setup({ bot });
  announcer.handle({ type: "start", show: show() });
  await announcer.idle();
  assert.equal(bot.posts.length, 1, "OmniFM 1 tried once");
  assert.equal(await store.lastPostedAt(TEST_GUILD), null, "nothing posted, nothing counted");

  bot.postResult = fakeBot().postResult;
  announcer.handle({ type: "end", show: ended(show(), START + 10 * MINUTE) });
  now.advance(20 * MINUTE);
  announcer.handle({ type: "start", show: show(now()) });
  await announcer.idle();
  assert.equal(bot.posts.length, 2, "the next show is announced");
  assert.equal(bot.edits.length, 0, "there was nothing to edit");
});

test("a server whose settings cannot be read is skipped, the others still get the message", async () => {
  const { bot, announcer } = setup({ isPublic: true });
  const failing = announcer;
  bot.postRadioAnnouncement = async (guildId, options) => {
    if (guildId === TEST_GUILD) throw new Error("bridge timeout");
    bot.posts.push({ guildId, ...options });
    return { ok: true, channelId: "1", messageId: "2" };
  };
  failing.handle({ type: "start", show: show() });
  await failing.idle();
  assert.deepEqual(bot.posts.map((post) => post.guildId), [OTHER_GUILD]);
});

test("OmniFM 1 posts once it is ready; without it on the server nothing goes out", async () => {
  const bot = fakeBot({ guilds: [OTHER_GUILD] });
  let calls = 0;
  const { announcer } = setup({
    bot,
    isPublic: true,
    // The entry points create the bots after subscribing: the first calls throw.
    getAnnouncer: () => {
      calls += 1;
      if (calls < 3) throw new ReferenceError("Cannot access 'workerManager' before initialization");
      return bot;
    },
  });
  announcer.handle({ type: "start", show: show() });
  await announcer.idle();
  assert.deepEqual(bot.posts.map((post) => post.guildId), [OTHER_GUILD], "OmniFM 1 is not on the test server");
});

// ---------------------------------------------------------------- limits

test("at most one announcement per server in two hours, also after a restart; test shows do not count", async () => {
  const now = clock();
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const first = setup({ store, now, bot: fakeBot({ guilds: [TEST_GUILD] }) });
  first.announcer.handle({ type: "start", show: show(now()) });
  await first.announcer.idle();
  first.announcer.handle({ type: "end", show: ended(show(START), START + 30 * MINUTE) });
  await first.announcer.idle();
  assert.equal(first.bot.posts.length, 1);

  // A new process: the limit comes from the store.
  now.advance(60 * MINUTE);
  const second = setup({ store, now, bot: fakeBot({ guilds: [TEST_GUILD] }) });
  second.announcer.handle({ type: "start", show: show(now()) });
  await second.announcer.idle();
  assert.equal(second.bot.posts.length, 0, "an hour later: no second message");
  second.announcer.handle({ type: "end", show: ended(show(now()), now() + MINUTE) });

  second.announcer.handle({ type: "start", show: show(now() + 2 * MINUTE, { source: "test" }) });
  await second.announcer.idle();
  assert.equal(second.bot.posts.length, 1, "a test show is not held back");
  second.announcer.handle({ type: "end", show: ended(show(now() + 2 * MINUTE, { source: "test" }), now() + 3 * MINUTE) });
  await second.announcer.idle();

  now.advance(ANNOUNCE_LIMIT_MS - 60 * MINUTE + MINUTE);
  second.announcer.handle({ type: "start", show: show(now()) });
  await second.announcer.idle();
  assert.equal(second.bot.posts.length, 2, "after two hours the next show is announced");
});

test("the messages go out one after the other, spaced", async () => {
  const { bot, announcer, sleeps } = setup({ isPublic: true, bot: fakeBot({ guilds: [TEST_GUILD, OTHER_GUILD, THIRD_GUILD] }) });
  announcer.handle({ type: "start", show: show() });
  await announcer.idle();
  assert.equal(bot.posts.length, 3);
  assert.deepEqual(sleeps, [1500, 1500], "one message every 1.5 s");
});

// ---------------------------------------------------------------- end

test("the end edits the same message, once, also after a restart", async () => {
  const now = clock();
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const first = setup({ store, now, isPublic: true });
  const live = show(now());
  first.announcer.handle({ type: "start", show: live });
  await first.announcer.idle();
  assert.equal(first.bot.posts.length, 2);

  // The commander restarted during the show; the new process only sees the end.
  const second = setup({ store, now, isPublic: true });
  const end = ended(live, START + 72 * MINUTE);
  second.announcer.handle({ type: "end", show: end });
  await second.announcer.idle();
  assert.deepEqual(
    second.bot.edits.map((edit) => [edit.guildId, edit.channelId, edit.messageId]).sort(),
    first.bot.posts.map((post) => [post.guildId, `9${post.guildId.slice(1)}`, `8${post.guildId.slice(1)}`]).sort(),
  );
  assert.equal(second.bot.edits[0].show.durationMs, 72 * MINUTE);
  assert.equal(second.bot.posts.length, 0, "no second message");

  second.announcer.handle({ type: "end", show: end });
  await second.announcer.idle();
  assert.equal(second.bot.edits.length, 2, "a repeated end edits nothing again");
});

test("a show that ends while the messages still go out posts no live message afterwards", async () => {
  const bot = fakeBot({ guilds: [TEST_GUILD, OTHER_GUILD, THIRD_GUILD] });
  let release;
  const firstPost = new Promise((resolve) => { release = resolve; });
  const original = bot.postRadioAnnouncement;
  bot.postRadioAnnouncement = async (guildId, options) => {
    const result = await original(guildId, options);
    if (bot.posts.length === 1) await firstPost;
    return result;
  };
  const { announcer } = setup({ bot, isPublic: true });
  const live = show();
  announcer.handle({ type: "start", show: live });
  // eslint-disable-next-line no-await-in-loop -- waits until the first message is on its way
  while (bot.posts.length === 0) await new Promise((resolve) => { setImmediate(resolve); });
  announcer.handle({ type: "end", show: ended(live, START + 5 * MINUTE) });
  release();
  await announcer.idle();
  assert.equal(bot.posts.length, 1, "the other servers get nothing");
  assert.deepEqual(bot.edits.map((edit) => edit.guildId), [bot.posts[0].guildId], "the one message is edited");
});

test("a show that ends during the pause between two messages posts no further one", async () => {
  const now = clock();
  const bot = fakeBot({ guilds: [TEST_GUILD, OTHER_GUILD] });
  const live = show();
  let announcer;
  announcer = createOmnifmRadioAnnouncer({
    getAnnouncer: () => bot,
    store: createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false }),
    loadSettings: async () => ({}),
    getConfig: () => radioConfig({ isPublic: true }),
    now,
    intervalMs: 1500,
    // The end arrives while the second message waits for its turn.
    sleep: async (ms) => { announcer.handle({ type: "end", show: ended(live, START + MINUTE) }); now.advance(ms); },
  });
  announcer.handle({ type: "start", show: live });
  await announcer.idle();
  assert.equal(bot.posts.length, 1);
  assert.equal(bot.edits.length, 1, "the first message is edited");
});

test("stop drops what is still waiting", async () => {
  const { bot, announcer } = setup({ isPublic: true, bot: fakeBot({ guilds: [TEST_GUILD, OTHER_GUILD, THIRD_GUILD] }) });
  announcer.handle({ type: "start", show: show() });
  await announcer.stop();
  assert.ok(bot.posts.length < 3);
  announcer.handle({ type: "start", show: show(START + MINUTE) });
  await announcer.idle();
  assert.ok(bot.posts.length < 3, "nothing new after stop");
});

// ---------------------------------------------------------------- wiring

test("the service listens to the live events and lets OmniFM 1 (worker slot 1) post; stop ends that", async () => {
  const { emitOmnifmRadioLiveEvent } = await import("../src/services/omnifm-radio-live.js");
  const { startOmnifmRadioAnnouncements, stopOmnifmRadioAnnouncements } = await import("../src/services/omnifm-radio-announce.js");
  const first = fakeBot({ id: "bot-2", guilds: [TEST_GUILD] });
  const second = fakeBot({ id: "bot-3", guilds: [TEST_GUILD] });
  const workerManager = { getWorkerBySlot: (slot) => ({ 1: first, 2: second })[slot] || null };
  const service = startOmnifmRadioAnnouncements({
    getWorkerManager: () => workerManager,
    store: createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false }),
    loadSettings: async () => ({}),
    getConfig: () => radioConfig(),
    sleep: async () => {},
  });
  emitOmnifmRadioLiveEvent({ type: "start", show: show() });
  await service.announcer.idle();
  assert.deepEqual([first.posts.length, second.posts.length], [1, 0]);

  await stopOmnifmRadioAnnouncements();
  emitOmnifmRadioLiveEvent({ type: "start", show: show(START + 3 * ANNOUNCE_LIMIT_MS) });
  await service.announcer.idle();
  assert.equal(first.posts.length, 1, "after stop nothing listens");
});

test("both entry points subscribe right below the live detection and stop on shutdown", async () => {
  const fs = await import("node:fs");
  for (const file of ["src/entrypoints/commander.js", "src/index.js"]) {
    const lines = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split(/\r?\n/);
    const live = lines.findIndex((line) => line.startsWith("await startOmnifmRadioLiveService("));
    assert.ok(live > 0, file);
    assert.match(lines[live + 1], /^startOmnifmRadioAnnouncements\(\{ getWorkerManager: \(\) => workerManager \}\);/, file);
    assert.ok(lines.some((line) => line.includes("stopOmnifmRadioAnnouncements()")), `${file}: stopped on shutdown`);
  }
});
