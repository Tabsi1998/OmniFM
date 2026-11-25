import test, { after } from "node:test";
import assert from "node:assert/strict";

// OmniFM Radio (#593): when DJ Tabsi goes live, OmniFM 1 announces the show
// on every server that can see the station, at most once in two hours, and
// edits the same message when the show ends.
import { getOmnifmRadioConfig } from "../src/services/omnifm-radio-config.js";
import { loadRadioAnnounceSettings, normalizeRadioAnnounceSettings } from "../src/lib/omnifm-radio-announce-settings.js";
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
    loadSettings: async (guildId) => settings[guildId]?.omnifmRadioAnnounce,
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
  for (const notABoolean of ["false", 0, "no", null]) {
    assert.equal(normalizeRadioAnnounceSettings({ enabled: notABoolean }).enabled, true, `only a real false switches it off (${JSON.stringify(notABoolean)})`);
  }
});

test("the setting is read strictly: a database that is away or fails is an error, never \"on\"", async () => {
  await assert.rejects(loadRadioAnnounceSettings(TEST_GUILD, { getDatabase: () => null, mongoRequested: () => true }), /MongoDB/);
  const failing = { collection: () => ({ findOne: async () => { throw new Error("connection reset"); } }) };
  await assert.rejects(loadRadioAnnounceSettings(TEST_GUILD, { getDatabase: () => failing }), /connection reset/);
  assert.deepEqual(await loadRadioAnnounceSettings(TEST_GUILD, { getDatabase: () => null, mongoRequested: () => false }), { enabled: true, channelId: "", roleId: "" }, "without MongoDB (development): the default");
});

test("a server that switched it off stays off when its setting cannot be read", async () => {
  const failing = { collection: () => ({ findOne: async () => { throw new Error("connection reset"); } }) };
  const bot = fakeBot();
  const strict = createOmnifmRadioAnnouncer({
    getAnnouncer: () => bot,
    store: createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false }),
    loadSettings: (guildId) => loadRadioAnnounceSettings(guildId, { getDatabase: () => failing }),
    getConfig: () => radioConfig({ isPublic: true }),
    sleep: async () => {},
  });
  strict.handle({ type: "start", show: show() });
  await strict.idle();
  assert.equal(bot.posts.length, 0);
});

test("the stored \"off\" is read from guild_settings in MongoDB", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const guildId = String(300000000000000000n + BigInt(Math.floor(Math.random() * 1e15)));
  await getDb().collection("guild_settings").insertOne({ guildId, omnifmRadioAnnounce: { enabled: false, channelId: "", roleId: "" } });
  try {
    assert.equal((await loadRadioAnnounceSettings(guildId)).enabled, false);
    assert.equal((await loadRadioAnnounceSettings("400000000000000000")).enabled, true, "nothing stored: on");
  } finally {
    await getDb().collection("guild_settings").deleteMany({ guildId });
  }
});

// ---------------------------------------------------------------- store

async function exerciseStore(store) {
  const live = show();
  const showId = radioShowId(live);
  const key = { showId, guildId: TEST_GUILD };
  assert.equal(await store.lastPostedAt(TEST_GUILD), null);

  // Claimed before anything is sent: once only, also with two processes at once.
  const claims = await Promise.all([1, 2, 3].map(() => store.claim({ ...key, botId: "bot-2", test: false, show: live, at: new Date(START) })));
  assert.deepEqual(claims.filter(Boolean).length, 1, "exactly one claim wins");
  assert.equal(await store.lastPostedAt(TEST_GUILD), START, "a claim counts for the limit before the message is out");

  await store.setMessage(key, { channelId: "1", messageId: "2", at: new Date(START + 1000) });
  await store.release(key);
  let open = await store.listForShow(showId);
  assert.deepEqual(open.map((entry) => [entry.guildId, entry.channelId, entry.messageId, entry.botId, entry.show.streamerName]), [[TEST_GUILD, "1", "2", "bot-2", "DJ Tabsi"]], "a posted message is never released");

  // A test show is kept for its end, but does not count for the limit.
  const testKey = { showId: "test:x", guildId: TEST_GUILD };
  assert.equal(await store.claim({ ...testKey, botId: "bot-2", test: true, show: live, at: new Date(START + 5 * MINUTE) }), true);
  assert.equal(await store.lastPostedAt(TEST_GUILD), START, "a test show does not count");

  // Nothing sent (no rights): the claim goes, it neither counts nor needs an edit.
  const otherKey = { showId: "live:other", guildId: OTHER_GUILD };
  await store.claim({ ...otherKey, botId: "bot-2", test: false, show: live, at: new Date(START) });
  await store.release(otherKey);
  assert.equal(await store.lastPostedAt(OTHER_GUILD), null);
  assert.equal(await store.claim({ ...otherKey, botId: "bot-2", test: false, show: live, at: new Date(START) }), true, "free again");

  assert.deepEqual((await store.listOpen()).map((entry) => entry.showId).sort(), ["live:other", showId, "test:x"].sort());
  await store.markEnded(open[0], new Date(START + 60 * MINUTE));
  open = await store.listForShow(showId);
  assert.deepEqual(open, [], "an edited message is done");
}

test("the store claims, fills in and closes each announcement (in memory)", async () => {
  await exerciseStore(createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false }));
});

test("the store refuses to forget while MongoDB is configured but away", async () => {
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => true });
  await assert.rejects(store.lastPostedAt(TEST_GUILD), /MongoDB/);
  await assert.rejects(store.claim({ showId: "live:x", guildId: TEST_GUILD, test: false, show: show(), at: new Date(START) }), /MongoDB/);
});

test("the store claims, fills in and closes each announcement in MongoDB", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const db = getDb();
  // Its own collection: the test never touches what the bot stores.
  const collectionName = `omnifm_radio_announcements_test_${process.pid}`;
  try {
    await exerciseStore(createOmnifmRadioAnnounceStore({ getDatabase: () => db, collectionName }));
    const indexes = (await db.collection(collectionName).indexes()).map((index) => index.name);
    assert.ok(indexes.includes("ttl"), "old entries expire");
    assert.ok(indexes.includes("open"), "the open ones are found fast");
  } finally {
    await db.collection(collectionName).drop().catch(() => null);
  }
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

test("with MongoDB away nothing goes out, not even a test show (its \"off\" could not be read)", async () => {
  const away = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => true });
  for (const source of ["webhook", "test"]) {
    const { bot, announcer } = setup({ store: away });
    announcer.handle({ type: "start", show: show(START, { source }) });
    // eslint-disable-next-line no-await-in-loop -- one show after the other
    await announcer.idle();
    assert.equal(bot.posts.length, 0, source);
  }
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

// ---------------------------------------------------------------- claimed before sent

test("a bridge timeout while OmniFM 1 still posts: the worker's message id arrives, the limit holds, the end edits it", async () => {
  const now = clock();
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  // Like the worker behind the bridge: it posts and writes the id itself,
  // but the commander only sees the timeout.
  bot.postRadioAnnouncement = async (guildId, options) => {
    bot.posts.push({ guildId, ...options });
    await store.setMessage(options.claim, { channelId: "1", messageId: "77", at: new Date(now()) });
    return { ok: false, error: "Worker-Command Timeout." };
  };
  const { announcer } = setup({ store, now, bot });
  const live = show(now());
  announcer.handle({ type: "start", show: live });
  await announcer.idle();
  announcer.handle({ type: "end", show: ended(live, now() + 30 * MINUTE) });
  await announcer.idle();
  assert.deepEqual(bot.edits.map((edit) => [edit.guildId, edit.channelId, edit.messageId]), [[TEST_GUILD, "1", "77"]]);

  now.advance(60 * MINUTE);
  announcer.handle({ type: "start", show: show(now()) });
  await announcer.idle();
  assert.equal(bot.posts.length, 1, "the timed-out post counts for the two hours");
});

test("a command that certainly never reached OmniFM 1 releases its claim", async () => {
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  bot.postResult = () => ({ ok: false, error: "Worker ist offline oder kein Heartbeat verfügbar.", notStarted: true });
  const { announcer } = setup({ store, bot });
  announcer.handle({ type: "start", show: show() });
  await announcer.idle();
  assert.equal(bot.posts.length, 1);
  assert.equal(await store.lastPostedAt(TEST_GUILD), null, "no limit for a message that never went out");
  assert.deepEqual(await store.listOpen(), [], "nothing to edit later");
});

test("two commander processes at once: each server gets the show once", async () => {
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const bot = fakeBot({ guilds: [TEST_GUILD, OTHER_GUILD, THIRD_GUILD] });
  const one = setup({ store, bot, isPublic: true });
  const two = setup({ store, bot, isPublic: true });
  const live = show();
  one.announcer.handle({ type: "start", show: live });
  two.announcer.handle({ type: "start", show: live });
  await Promise.all([one.announcer.idle(), two.announcer.idle()]);
  assert.deepEqual(bot.posts.map((post) => post.guildId).sort(), [TEST_GUILD, OTHER_GUILD, THIRD_GUILD].sort());
});

test("a store write that fails after the message went out still holds the limit", async () => {
  const now = clock();
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const flaky = { ...store, setMessage: async () => { throw new Error("write concern timeout"); } };
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  const { announcer } = setup({ store: flaky, now, bot });
  announcer.handle({ type: "start", show: show(now()) });
  await announcer.idle();
  announcer.handle({ type: "end", show: ended(show(START), START + 10 * MINUTE) });
  now.advance(30 * MINUTE);
  announcer.handle({ type: "start", show: show(now()) });
  await announcer.idle();
  assert.equal(bot.posts.length, 1, "no second message within two hours");
});

// ---------------------------------------------------------------- many servers

test("the order of the servers is shuffled for each show", async () => {
  const guilds = [TEST_GUILD, OTHER_GUILD, THIRD_GUILD];
  const orderWith = async (random) => {
    const bot = fakeBot({ guilds });
    const announcer = createOmnifmRadioAnnouncer({
      getAnnouncer: () => bot,
      store: createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false }),
      loadSettings: async () => undefined,
      getConfig: () => radioConfig({ isPublic: true }),
      sleep: async () => {},
      random,
    });
    announcer.handle({ type: "start", show: show() });
    await announcer.idle();
    return bot.posts.map((post) => post.guildId);
  };
  const first = await orderWith(() => 0);
  const second = await orderWith(() => 0.99);
  assert.deepEqual([...first].sort(), [...guilds].sort());
  assert.deepEqual([...second].sort(), [...guilds].sort());
  assert.notDeepEqual(first, second, "another show, another order");
  assert.notDeepEqual(first, guilds, "not simply the order of the cache");
});

test("a server that fails the quick check costs no slot in the pacing", async () => {
  const bot = fakeBot({ guilds: [TEST_GUILD, OTHER_GUILD, THIRD_GUILD] });
  bot.checks = [];
  bot.checkRadioAnnouncement = async (guildId) => {
    bot.checks.push(guildId);
    return guildId === OTHER_GUILD ? { ok: false, reason: "missing-permissions" } : { ok: true };
  };
  const { announcer, sleeps } = setup({ bot, isPublic: true });
  announcer.handle({ type: "start", show: show() });
  await announcer.idle();
  assert.equal(bot.checks.length, 3);
  assert.deepEqual(bot.posts.map((post) => post.guildId).sort(), [TEST_GUILD, THIRD_GUILD].sort());
  assert.deepEqual(sleeps, [1500], "two messages, one pause");
});

test("OMNIFM_RADIO_ANNOUNCE=0 stops new announcements; ends are still edited", async () => {
  assert.equal(getOmnifmRadioConfig({}).announce, true, "on by default");
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_ANNOUNCE: "off" }).announce, false);
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const earlier = show(START - 3 * ANNOUNCE_LIMIT_MS);
  const key = { showId: radioShowId(earlier), guildId: TEST_GUILD };
  await store.claim({ ...key, botId: "bot-2", show: earlier, at: new Date(START - 3 * ANNOUNCE_LIMIT_MS) });
  await store.setMessage(key, { channelId: "1", messageId: "2", at: new Date(START - 3 * ANNOUNCE_LIMIT_MS) });
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  const announcer = createOmnifmRadioAnnouncer({
    getAnnouncer: () => bot,
    store,
    loadSettings: async () => undefined,
    getConfig: () => getOmnifmRadioConfig({ OMNIFM_RADIO_TEST_GUILD_IDS: TEST_GUILD, OMNIFM_RADIO_ANNOUNCE: "0" }),
    sleep: async () => {},
  });
  announcer.handle({ type: "start", show: show() });
  announcer.handle({ type: "end", show: ended(earlier, START - 2 * ANNOUNCE_LIMIT_MS) });
  await announcer.idle();
  assert.equal(bot.posts.length, 0);
  assert.equal(bot.edits.length, 1);
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
    loadSettings: async () => undefined,
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

test("an event that arrives just as the queue runs dry is not stranded", async () => {
  const hop = (count, then) => (count === 0 ? then() : queueMicrotask(() => hop(count - 1, then)));
  for (let hops = 0; hops <= 12; hops += 1) {
    const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
    const live = show();
    // eslint-disable-next-line no-await-in-loop -- one round after the other
    await store.claim({ showId: radioShowId(live), guildId: TEST_GUILD, botId: "bot-2", show: live, at: new Date(START) });
    // eslint-disable-next-line no-await-in-loop
    await store.setMessage({ showId: radioShowId(live), guildId: TEST_GUILD }, { channelId: "1", messageId: "2", at: new Date(START) });
    const bot = fakeBot({ guilds: [TEST_GUILD] });
    let announcer;
    // The next show starts a few microtasks after the last job (the edit) finished.
    const watched = {
      ...store,
      async markEnded(key, at) {
        await store.markEnded(key, at);
        hop(hops, () => announcer.handle({ type: "start", show: show(START + MINUTE, { source: "test" }) }));
      },
    };
    ({ announcer } = setup({ bot, store: watched }));
    announcer.handle({ type: "end", show: ended(live, START + MINUTE) });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
    // eslint-disable-next-line no-await-in-loop
    await announcer.idle();
    assert.equal(bot.posts.length, 1, `start ${hops} microtasks after the last job`);
  }
});

// ---------------------------------------------------------------- catching up on missed ends

/** An announcement of `live` on the test server, as a commander before a restart left it. */
async function postedBefore(store, live, { messageId = "81", at = Date.parse(live.startedAt) } = {}) {
  const key = { showId: radioShowId(live), guildId: TEST_GUILD };
  await store.claim({ ...key, botId: "bot-2", test: false, show: live, at: new Date(at) });
  if (messageId) await store.setMessage(key, { channelId: "1", messageId, at: new Date(at) });
  return key;
}

const liveState = ({ current = { isLive: false }, shows = [], readable = true } = {}) => () => ({ readable, current, shows, testShows: [] });

test("after a restart the commander edits what an end it missed left on \"live\"", async () => {
  const { startOmnifmRadioAnnouncements, stopOmnifmRadioAnnouncements } = await import("../src/services/omnifm-radio-announce.js");
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const live = show();
  await postedBefore(store, live);
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  const service = startOmnifmRadioAnnouncements({
    getWorkerManager: () => ({ getWorkerBySlot: () => bot }),
    store,
    getLiveState: liveState({ shows: [ended(live, START + 72 * MINUTE)] }),
    getConfig: () => radioConfig(),
    sleep: async () => {},
  });
  try {
    await service.announcer.idle();
    assert.deepEqual(bot.edits.map((edit) => [edit.guildId, edit.messageId]), [[TEST_GUILD, "81"]]);
    assert.equal(bot.edits[0].show.endedAt, new Date(START + 72 * MINUTE).toISOString(), "the end time from the history");
    assert.deepEqual(await store.listOpen(), []);
  } finally {
    await stopOmnifmRadioAnnouncements();
  }
});

test("catching up never touches the show that is still live, and decides nothing without a readable state", async () => {
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const live = show();
  await postedBefore(store, live);
  const running = setup({ store });
  const announcer = createOmnifmRadioAnnouncer({
    getAnnouncer: () => running.bot,
    store,
    getLiveState: liveState({ current: { isLive: true, startedAt: live.startedAt, source: "webhook" } }),
    getConfig: () => radioConfig(),
    sleep: async () => {},
  });
  announcer.catchUp();
  await announcer.idle();
  assert.equal(running.bot.edits.length, 0, "the running show keeps its message");

  const blind = createOmnifmRadioAnnouncer({
    getAnnouncer: () => running.bot,
    store,
    getLiveState: liveState({ readable: false }),
    getConfig: () => radioConfig(),
    sleep: async () => {},
  });
  blind.catchUp();
  await blind.idle();
  assert.equal(running.bot.edits.length, 0, "the database was away: nothing decided");
});

test("an end whose edits failed is caught up on the next round, without a double edit", async () => {
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const live = show();
  await postedBefore(store, live);
  let failures = 1;
  const flaky = { ...store, listForShow: async (showId) => { if (failures-- > 0) throw new Error("timeout"); return store.listForShow(showId); } };
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  const announcer = createOmnifmRadioAnnouncer({
    getAnnouncer: () => bot,
    store: flaky,
    getLiveState: liveState({ shows: [ended(live, START + 10 * MINUTE)] }),
    getConfig: () => radioConfig(),
    sleep: async () => {},
  });
  announcer.handle({ type: "end", show: ended(live, START + 10 * MINUTE) });
  await announcer.idle();
  assert.equal(bot.edits.length, 0, "the end could not read its messages");
  announcer.catchUp();
  announcer.catchUp();
  await announcer.idle();
  assert.equal(bot.edits.length, 1, "caught up once");
});

test("an announcement of another bot is closed, not tried again every few minutes", async () => {
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const live = show();
  const key = { showId: radioShowId(live), guildId: TEST_GUILD };
  await store.claim({ ...key, botId: "bot-7", show: live, at: new Date(START) });
  await store.setMessage(key, { channelId: "1", messageId: "2", at: new Date(START) });
  const bot = fakeBot({ id: "bot-2", guilds: [TEST_GUILD] });
  const announcer = createOmnifmRadioAnnouncer({
    getAnnouncer: () => bot,
    store,
    getLiveState: liveState({ shows: [ended(live, START + MINUTE)] }),
    getConfig: () => radioConfig(),
    sleep: async () => {},
  });
  announcer.catchUp();
  await announcer.idle();
  assert.equal(bot.edits.length, 0, "OmniFM 1 cannot edit another bot's message");
  assert.deepEqual(await store.listOpen(), [], "closed");
});

test("a claim still waiting for its message id is left for a while, then closed", async () => {
  const now = clock(START + 60 * MINUTE);
  const store = createOmnifmRadioAnnounceStore({ getDatabase: () => null, mongoRequested: () => false });
  const live = show();
  await postedBefore(store, live, { messageId: null, at: now() - MINUTE });
  const bot = fakeBot({ guilds: [TEST_GUILD] });
  const announcer = createOmnifmRadioAnnouncer({
    getAnnouncer: () => bot,
    store,
    getLiveState: liveState({ shows: [ended(live, START + 30 * MINUTE)] }),
    getConfig: () => radioConfig(),
    now,
    sleep: async (ms) => { now.advance(ms); },
  });
  announcer.catchUp();
  await announcer.idle();
  assert.equal((await store.listOpen()).length, 1, "the worker may still report the id");
  now.advance(15 * MINUTE);
  announcer.catchUp();
  await announcer.idle();
  assert.deepEqual(await store.listOpen(), [], "closed after the wait, nothing to edit");
  assert.equal(bot.edits.length, 0);
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
    loadSettings: async () => undefined,
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
