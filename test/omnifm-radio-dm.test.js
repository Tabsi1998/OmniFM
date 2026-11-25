import test, { after } from "node:test";
import assert from "node:assert/strict";

// OmniFM Radio DMs (#594): when DJ Tabsi goes live, the owners of the
// servers that see OmniFM Radio get one DM. Unsolicited mass DMs can get the
// whole bot restricted, so: one DM per person in 12 hours, slowly, no
// retries, closed DMs left alone for 30 days, a kill switch that stops a
// running distribution, and the end of the show stops the rest.
import {
  collectRadioDmRecipients,
  createOmnifmRadioDmService,
  resolveRadioDmMode,
} from "../src/services/omnifm-radio-dm.js";
import { createOmnifmRadioDmStore } from "../src/omnifm-radio-dm-store.js";

const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-25T20:00:00Z");
const BOT = "100000000000000001";
const [A, B, C] = ["200000000000000001", "200000000000000002", "200000000000000003"];
const [G1, G2, G3, G4] = ["500000000000000001", "500000000000000002", "500000000000000003", "500000000000000004"];
const GUILDS = [
  { id: G1, ownerId: A, name: "Erster Server" },
  { id: G2, ownerId: B, name: "Second" },
  { id: G3, ownerId: C, name: "Kein Test" },
  { id: G4, ownerId: A, name: "Zweiter von A" },
];
const LANGUAGES = { [G1]: "de", [G2]: "en", [G3]: "fr", [G4]: "it" };
const CONFIG = Object.freeze({ enabled: true, isPublic: false, testGuildIds: [G1, G2, G4], baseUrl: "https://radio.omnifm.xyz", station: "omnifm_radio" });
const PUBLIC = Object.freeze({ ...CONFIG, isPublic: true });
const SHOW = { streamerName: "DJ Tabsi", title: "Abendshow", startedAt: "2026-11-25T20:00:00.000Z", source: "webhook" };
const start = (show = SHOW) => ({ type: "start", show });
const end = (show = SHOW) => ({ type: "end", show: { ...show, endedAt: "2026-11-25T21:00:00.000Z", durationMs: HOUR } });
const testShow = { ...SHOW, streamerName: "Test-DJ", title: "Test-Sendung", source: "test" };

function clock(at = T0) {
  const time = { at };
  const now = () => time.at;
  now.advance = (ms) => { time.at += ms; };
  now.set = (ms) => { time.at = ms; };
  return now;
}

// The connection stays open for the tests after the MongoDB one: a closed
// one counts as "MongoDB away", and then no DM goes out at all.
after(async () => {
  if (!hasMongoConfig) return;
  const { close } = await import("../src/lib/db.js");
  await close().catch(() => null);
});

const memoryStore = () => createOmnifmRadioDmStore({ getDatabase: () => null, mongoRequested: () => false });

// The commander, without client.users: DMs go through the DM sender only (one attempt each).
function fakeRuntime({ guilds = GUILDS, fail = {}, ready = true, bots = [] } = {}) {
  const sent = [];
  const fetched = [];
  const runtime = {
    sent,
    fetched,
    fail,
    ready,
    resolveGuildLanguage: (guildId) => LANGUAGES[guildId] || "de",
    getApplicationId: () => BOT,
    config: { token: "commander-token" },
    client: {
      isReady: () => runtime.ready,
      user: { id: BOT },
      guilds: { cache: new Map(guilds.map((guild) => [guild.id, guild])) },
      users: { cache: new Map(bots.map((id) => [id, { id, bot: true }])) },
    },
    sender: {
      stopped: 0,
      async send(id, body) {
        fetched.push(id);
        const failure = typeof fail[id] === "function" ? fail[id]() : fail[id];
        if (failure) throw failure;
        sent.push({ id, payload: body });
      },
      stop() { this.stopped += 1; },
    },
  };
  return runtime;
}

function setup({ config = CONFIG, env = {}, consoleMode = "", store = memoryStore(), runtime = fakeRuntime(), onSleep = null, now = clock() } = {}) {
  const sleeps = [];
  const modeStore = {
    value: consoleMode,
    broken: false,
    async read() {
      if (this.broken) throw new Error("MongoDB ist nicht verbunden.");
      return this.value;
    },
    async write(mode) { this.value = mode; },
  };
  const context = { sleeps, modeStore, runtime, store, now, alerts: [] };
  context.service = createOmnifmRadioDmService({
    getRuntime: () => runtime,
    store,
    modeStore,
    env,
    getConfig: () => config,
    createSender: (commander) => commander.sender,
    alert: async (info) => { context.alerts.push(info); },
    now,
    intervalMs: 5_000,
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      context.signal = signal;
      now.advance(ms);
      await onSleep?.(context);
    },
  });
  return context;
}

const recipientsOf = (runtime) => runtime.sent.map((entry) => entry.id);
const textOf = (payload) => JSON.stringify(payload.components);

async function distribute(context, event = start()) {
  context.service.handleEvent(event);
  await context.service.idle();
  return (await context.service.status()).lastRun;
}

// ---------------------------------------------------------------- recipients

test("recipients: the owner of every server that sees OmniFM Radio, each person once", () => {
  const resolveLanguage = (guildId) => LANGUAGES[guildId];
  const hidden = collectRadioDmRecipients({ guilds: GUILDS, config: CONFIG, test: false, resolveLanguage, selfId: BOT });
  assert.deepEqual(hidden.map((entry) => [entry.userId, entry.guildId, entry.language]), [[A, G1, "de"], [B, G2, "en"]],
    "while it is not public only the test servers; A owns two and is asked once, in the first server's language");
  assert.equal(hidden[0].guildName, "Erster Server");

  const open = collectRadioDmRecipients({ guilds: GUILDS, config: PUBLIC, test: false, resolveLanguage, selfId: BOT });
  assert.deepEqual(open.map((entry) => entry.userId), [A, B, C]);

  const tested = collectRadioDmRecipients({ guilds: GUILDS, config: PUBLIC, test: true, resolveLanguage, selfId: BOT });
  assert.deepEqual(tested.map((entry) => entry.userId), [A, B], "a test show reaches only the owners of the test servers, also when public");

  assert.deepEqual(collectRadioDmRecipients({ guilds: GUILDS, config: { ...PUBLIC, enabled: false }, test: false, resolveLanguage, selfId: BOT }), []);
});

test("recipients: no DM to the bot itself or to an owner Discord does not name", () => {
  const guilds = [{ id: G1, ownerId: BOT }, { id: G2, ownerId: "" }, { id: G3, ownerId: "abc" }, { id: "x", ownerId: A }];
  assert.deepEqual(collectRadioDmRecipients({ guilds, config: PUBLIC, test: false, resolveLanguage: () => "de", selfId: BOT }), []);
});

// ---------------------------------------------------------------- modes

test("the mode: the console wins, then OMNIFM_RADIO_DM_MODE, else owners; a typo is off", () => {
  assert.deepEqual(resolveRadioDmMode("", ""), { mode: "owners", source: "default" });
  assert.deepEqual(resolveRadioDmMode("", "optin"), { mode: "optin", source: "env" });
  assert.deepEqual(resolveRadioDmMode("", " OFF "), { mode: "off", source: "env" });
  assert.deepEqual(resolveRadioDmMode("owners", "off"), { mode: "owners", source: "console" });
  assert.deepEqual(resolveRadioDmMode("", "aus"), { mode: "off", source: "env" }, "an unknown value never sends");
  assert.deepEqual(resolveRadioDmMode("everyone", ""), { mode: "off", source: "console" });
});

test("a show start DMs each owner once, a few seconds apart, in the server's language; the end DMs nobody", async () => {
  const context = setup();
  const run = await distribute(context);
  assert.deepEqual(recipientsOf(context.runtime), [A, B]);
  assert.match(textOf(context.runtime.sent[0].payload), /DJ Tabsi ist live auf OmniFM Radio/);
  assert.match(textOf(context.runtime.sent[1].payload), /DJ Tabsi is live on OmniFM Radio/);
  assert.deepEqual(context.sleeps, [5_000], "one pause between two DMs");
  assert.equal(context.runtime.sender.stopped, 1, "the run's own REST client is closed after it");
  assert.deepEqual(
    { total: run.total, sent: run.sent, skipped: run.skipped, failed: run.failed, remaining: run.remaining, stoppedBy: run.stoppedBy, mode: run.mode },
    { total: 2, sent: 2, skipped: 0, failed: 0, remaining: 0, stoppedBy: null, mode: "owners" },
  );

  const quiet = setup();
  quiet.service.handleEvent(end());
  await quiet.service.idle();
  assert.deepEqual(recipientsOf(quiet.runtime), []);
  assert.equal((await quiet.service.status()).lastRun, null);
});

test("opt-in reaches only who subscribed; off reaches nobody", async () => {
  const optin = setup({ env: { OMNIFM_RADIO_DM_MODE: "optin" } });
  await optin.store.setSubscribed(B, true, { now: T0 - DAY });
  const run = await distribute(optin);
  assert.deepEqual(recipientsOf(optin.runtime), [B]);
  assert.equal(run.skipped, 1);

  const off = setup({ consoleMode: "off" });
  assert.equal((await distribute(off)).stoppedBy, "off");
  assert.deepEqual(off.runtime.fetched, []);
});

test("an unsubscribed owner gets nothing, a re-subscribed one again", async () => {
  const context = setup();
  await context.store.setSubscribed(A, false, { now: T0 - DAY });
  await distribute(context);
  assert.deepEqual(recipientsOf(context.runtime), [B]);
  await context.store.setSubscribed(A, true, { now: T0 });
  context.now.advance(13 * HOUR);
  await distribute(context);
  assert.deepEqual(recipientsOf(context.runtime), [B, A, B]);
});

// ---------------------------------------------------------------- kill switch and stops

test("the kill switch in the console stops a running distribution before the next DM", async () => {
  const context = setup({
    config: PUBLIC,
    onSleep: ({ modeStore }) => { modeStore.value = "off"; },
  });
  const run = await distribute(context);
  assert.deepEqual(recipientsOf(context.runtime), [A]);
  assert.deepEqual({ sent: run.sent, remaining: run.remaining, stoppedBy: run.stoppedBy }, { sent: 1, remaining: 2, stoppedBy: "off" });
});

test("switching off through the service stops at once and is stored", async () => {
  let abortedAtOnce = null;
  const context = setup({
    config: PUBLIC,
    onSleep: async (current) => {
      await current.service.setMode("off");
      abortedAtOnce = current.signal.aborted;
    },
  });
  const run = await distribute(context);
  assert.equal(abortedAtOnce, true, "the pause ends at once, not only at the next DM");
  assert.equal(run.stoppedBy, "off");
  assert.equal(context.modeStore.value, "off");
  assert.deepEqual(recipientsOf(context.runtime), [A]);
  await assert.rejects(context.service.setMode("everyone"), /Modus/);
});

test("a mode that cannot be read stops the distribution: no DM without the kill switch", async () => {
  const context = setup({ config: PUBLIC, onSleep: ({ modeStore }) => { modeStore.broken = true; } });
  const run = await distribute(context);
  assert.equal(run.stoppedBy, "error");
  assert.deepEqual(recipientsOf(context.runtime), [A]);
});

test("a show that ends while DMs go out stops the rest", async () => {
  const context = setup({ config: PUBLIC, onSleep: ({ service }) => service.handleEvent(end()) });
  const run = await distribute(context);
  assert.deepEqual(recipientsOf(context.runtime), [A]);
  assert.deepEqual({ stoppedBy: run.stoppedBy, remaining: run.remaining }, { stoppedBy: "end", remaining: 2 });
});

test("a shutdown stops a running distribution, and nothing starts after it", async () => {
  const context = setup({ config: PUBLIC, onSleep: ({ service }) => { void service.stop(); } });
  const run = await distribute(context);
  assert.equal(run.stoppedBy, "shutdown");
  assert.deepEqual(recipientsOf(context.runtime), [A]);
  context.service.handleEvent(start({ ...SHOW, startedAt: "2026-11-26T20:00:00.000Z" }));
  await context.service.idle();
  assert.deepEqual(recipientsOf(context.runtime), [A]);
});

// ---------------------------------------------------------------- limits

test("one DM in 12 hours per person, also across a restart", async () => {
  const store = memoryStore();
  const now = clock();
  const first = setup({ store, now });
  await distribute(first);
  assert.deepEqual(recipientsOf(first.runtime), [A, B]);

  now.advance(HOUR);
  const restarted = setup({ store, now });
  const run = await distribute(restarted, start({ ...SHOW, startedAt: "2026-11-25T21:00:00.000Z" }));
  assert.deepEqual(recipientsOf(restarted.runtime), []);
  assert.equal(run.skipped, 2);
  assert.deepEqual(restarted.sleeps, [], "skipped people cost no pause");

  now.advance(11 * HOUR);
  await distribute(restarted, start({ ...SHOW, startedAt: "2026-11-26T08:00:00.000Z" }));
  assert.deepEqual(recipientsOf(restarted.runtime), [A, B]);
});

test("test DMs go to the test owners only and have their own 10 minutes", async () => {
  const context = setup({ config: PUBLIC });
  await distribute(context, start(testShow));
  assert.deepEqual(recipientsOf(context.runtime), [A, B]);
  assert.match(textOf(context.runtime.sent[0].payload), /🧪/);

  await distribute(context, start(SHOW));
  assert.deepEqual(recipientsOf(context.runtime), [A, B, A, B, C], "the test used none of the 12 hours");

  context.now.advance(4 * MINUTE);
  const again = await distribute(context, start(testShow));
  assert.equal(again.skipped, 2);
  context.now.advance(10 * MINUTE);
  await distribute(context, start(testShow));
  assert.deepEqual(recipientsOf(context.runtime), [A, B, A, B, C, A, B]);
});

test("closed DMs: no retry, and the person is left alone for 30 days", async () => {
  const closed = Object.assign(new Error("Cannot send messages to this user"), { code: 50007, status: 403 });
  const broken = Object.assign(new Error("Internal Server Error"), { code: 0, status: 500 });
  const runtime = fakeRuntime({ fail: { [A]: closed, [B]: broken } });
  const context = setup({ runtime });
  const run = await distribute(context);
  assert.deepEqual({ sent: run.sent, failed: run.failed }, { sent: 0, failed: 2 });
  assert.deepEqual(runtime.fetched, [A, B], "each tried once");
  assert.equal((await context.store.get(A)).dmClosedUntil, T0 + 30 * DAY);
  assert.equal((await context.store.get(B)).dmClosedUntil, null, "another error closes nothing");

  context.now.advance(13 * HOUR);
  await distribute(context);
  assert.deepEqual(runtime.fetched, [A, B, B]);
  context.now.set(T0 + 30 * DAY);
  await distribute(context);
  assert.deepEqual(runtime.fetched, [A, B, B, A, B]);
});

test("before the bot is ready the distribution waits, and gives up after a while", async () => {
  const runtime = fakeRuntime({ ready: false });
  const waiting = setup({ runtime, onSleep: ({ sleeps }) => { if (sleeps.length === 2) runtime.ready = true; } });
  await distribute(waiting);
  assert.deepEqual(recipientsOf(runtime), [A, B]);

  const never = setup({ runtime: fakeRuntime({ ready: false }) });
  const run = await distribute(never);
  assert.equal(run.stoppedBy, "client");
  assert.ok(never.now() - T0 <= 3 * MINUTE, "not for ever");
});

test("the console sees the mode and the last run, also after a restart", async () => {
  const store = memoryStore();
  const context = setup({ store, env: { OMNIFM_RADIO_DM_MODE: "owners" } });
  await distribute(context);
  const status = await context.service.status();
  assert.deepEqual({ mode: status.mode, modeSource: status.modeSource, running: status.running }, { mode: "owners", modeSource: "env", running: false });
  assert.equal(status.lastRun.sent, 2);
  assert.equal(status.lastRun.show.streamerName, "DJ Tabsi");
  assert.equal(status.lastRun.test, false);
  assert.ok(status.lastRun.finishedAt);

  const restarted = await setup({ store }).service.status();
  assert.equal(restarted.lastRun.sent, 2);
  assert.equal(restarted.modeSource, "default");
});

// ---------------------------------------------------------------- wiring and the stored mode

test("the console's mode lives in owner_config; without it in memory, a missing MongoDB is an error", async () => {
  const { createRadioDmModeStore } = await import("../src/services/omnifm-radio-dm.js");
  const memory = createRadioDmModeStore({ getDatabase: () => null, mongoRequested: () => false });
  assert.equal(await memory.read(), "");
  await memory.write("off");
  assert.equal(await memory.read(), "off");
  await assert.rejects(createRadioDmModeStore({ getDatabase: () => null, mongoRequested: () => true }).read(), /MongoDB/);
});

test("MongoDB: the mode is stored in owner_config.radioDm, the other sections stay", { skip: !hasMongoConfig }, async () => {
  const { createRadioDmModeStore } = await import("../src/services/omnifm-radio-dm.js");
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  try {
    const ownerConfig = getDb().collection("owner_config");
    await ownerConfig.deleteMany({});
    await ownerConfig.insertOne({ _id: "global", company: { providerName: "OmniFM" } });
    await createRadioDmModeStore().write("optin");
    assert.equal(await createRadioDmModeStore().read(), "optin", "a new process reads it");
    const doc = await ownerConfig.findOne({ _id: "global" });
    assert.equal(doc.radioDm.mode, "optin");
    assert.equal(doc.company.providerName, "OmniFM");
  } finally {
    await getDb().collection("owner_config").deleteMany({});
  }
});

test("started next to the live detection: a live start reaches it, a shutdown stops it", async () => {
  const { startOmnifmRadioDmService, stopOmnifmRadioDmService, getOmnifmRadioDmService } = await import("../src/services/omnifm-radio-dm.js");
  const { emitOmnifmRadioLiveEvent } = await import("../src/services/omnifm-radio-live.js");
  assert.equal(startOmnifmRadioDmService({ getRuntime: () => null, env: { OMNIFM_RADIO_ENABLED: "0" } }), null, "no radio, no DMs");
  // The entry creates the commander after the service: until then the getter throws.
  const service = startOmnifmRadioDmService({ getRuntime: () => { throw new ReferenceError("not yet"); }, env: {} });
  emitOmnifmRadioLiveEvent(start());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await service.status()).running, true, "the distribution waits for the commander");
  await stopOmnifmRadioDmService();
  assert.equal(getOmnifmRadioDmService(), null);
  assert.equal((await service.status()).lastRun.stoppedBy, "shutdown");
  emitOmnifmRadioLiveEvent(start());
  await service.idle();
  assert.equal((await service.status()).running, false, "no listener left");
});

test("a DM that cannot be built stops the run before anybody is claimed", async () => {
  const { getOmnifmRadioConfig } = await import("../src/services/omnifm-radio-config.js");
  // OMNIFM_RADIO_BASE_URL without https://: the "Jetzt hören" link is no URL Discord takes.
  const config = getOmnifmRadioConfig({ OMNIFM_RADIO_BASE_URL: "radio.omnifm.xyz", OMNIFM_RADIO_TEST_GUILD_IDS: `${G1},${G2}` });
  const context = setup({ config });
  const run = await distribute(context);
  assert.equal(run.stoppedBy, "config");
  assert.match(run.error, /URL/i, "the console can say what is wrong");
  assert.deepEqual(context.runtime.fetched, []);
  assert.equal(await context.store.get(A), null, "nobody's 12 hours are used up");
  assert.equal(await context.store.get(B), null);
});

test("the kill switch acts before it is stored, and stays off in memory while the database does not take it", async () => {
  let rejected = null;
  const context = setup({
    config: PUBLIC,
    onSleep: async (current) => {
      current.modeStore.write = async () => { throw new Error("MongoDB ist nicht verbunden."); };
      rejected = await current.service.setMode("off").then(() => null, (error) => error);
    },
  });
  const run = await distribute(context);
  assert.ok(rejected, "the console hears that it is not stored");
  assert.equal(run.stoppedBy, "off", "but the DMs stopped anyway");
  assert.deepEqual(recipientsOf(context.runtime), [A]);
  const status = await context.service.status();
  assert.deepEqual({ mode: status.mode, modeSource: status.modeSource }, { mode: "off", modeSource: "memory" });

  context.now.advance(13 * 60 * MINUTE);
  assert.equal((await distribute(context, start({ ...SHOW, startedAt: "2026-11-26T09:00:00.000Z" }))).stoppedBy, "off", "the stored mode says owners, memory says off");
  await assert.rejects(context.service.setMode("owners"), /MongoDB/);
  assert.equal((await context.service.status()).mode, "off", "still off until a write works");
  context.modeStore.write = async function write(mode) { this.value = mode; };
  await context.service.setMode("owners");
  assert.equal((await context.service.status()).modeSource, "console");
});

test("a stop that comes while a person is being claimed sends that person nothing", async () => {
  const base = memoryStore();
  let service = null;
  const store = {
    ...base,
    get: base.get,
    async claim(...args) {
      const claimed = await base.claim(...args);
      service.handleEvent(end());
      return claimed;
    },
  };
  const context = setup({ store });
  service = context.service;
  const run = await distribute(context);
  assert.equal(run.stoppedBy, "end");
  assert.deepEqual(context.runtime.fetched, [], "claimed, but not sent");
});

// ---------------------------------------------------------------- emergency brake

const apiError = (code, status, message = "Discord") => Object.assign(new Error(message), { code, status });
const owners = (count) => Array.from({ length: count }, (_, index) => ({
  id: String(600000000000000001n + BigInt(index)),
  ownerId: String(700000000000000001n + BigInt(index)),
  name: `Server ${index + 1}`,
}));

test("Discord's spam signals stop the run at once, switch the DMs off and tell the operator", async () => {
  const { RateLimitError } = await import("@discordjs/rest");
  const limited = new RateLimitError({ timeToReset: 5000, limit: 1, method: "POST", hash: "h", url: "u", route: "/users/@me/channels", majorParameter: "1", global: false, retryAfter: 5000, sublimitTimeout: 0, scope: "user" });
  const signals = {
    "40003 (opening DMs too fast)": apiError(40003, 403, "You are opening direct messages too fast."),
    "40004 (sending disabled)": apiError(40004, 403, "Send messages has been temporarily disabled."),
    "a 429": apiError(0, 429, "Too Many Requests"),
    "a rate limit of the REST client": limited,
  };
  for (const [name, error] of Object.entries(signals)) {
    const context = setup({ config: PUBLIC, runtime: fakeRuntime({ fail: { [A]: error } }) });
    // eslint-disable-next-line no-await-in-loop -- one signal after the other
    const run = await distribute(context);
    assert.equal(run.stoppedBy, "discord", name);
    assert.deepEqual(context.runtime.fetched, [A], `${name}: nobody after that`);
    assert.equal(context.modeStore.value, "off", `${name}: the DMs are switched off`);
    assert.equal(context.alerts.length, 1, `${name}: the operator hears it`);
    assert.equal(context.alerts[0].reason, "discord");
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await context.store.get(A)).dmClosedUntil, null, `${name}: no "DMs closed" from a brake`);
  }
});

test("five failures in a row stop the run; a streak of closed DMs marks nobody", async () => {
  const guilds = owners(7);
  const fail = Object.fromEntries(guilds.map((guild) => [guild.ownerId, apiError(50007, 403, "Cannot send messages to this user")]));
  const context = setup({ config: { ...PUBLIC, testGuildIds: [] }, runtime: fakeRuntime({ guilds, fail }) });
  const run = await distribute(context);
  assert.equal(run.stoppedBy, "failures");
  assert.equal(context.runtime.fetched.length, 5);
  assert.deepEqual({ failed: run.failed, remaining: run.remaining }, { failed: 5, remaining: 2 });
  assert.equal(context.modeStore.value, "off");
  assert.equal(context.alerts[0].reason, "failures");
  const marked = await Promise.all(guilds.map((guild) => context.store.get(guild.ownerId)));
  assert.deepEqual(marked.map((person) => person?.dmClosedUntil ?? null), guilds.map(() => null), "a broken run is no proof that DMs are closed");
});

test("single closed DMs (50007, also 10013) in a healthy run are remembered; a success breaks the streak", async () => {
  const guilds = owners(7);
  const [first, second, third] = guilds.map((guild) => guild.ownerId);
  const fail = {
    [first]: apiError(50007, 403),
    [second]: apiError(10013, 404, "Unknown User"),
  };
  // Four failures, a success, four failures: never five in a row.
  for (const guild of guilds.slice(2, 4)) fail[guild.ownerId] = apiError(0, 500);
  for (const guild of guilds.slice(5)) fail[guild.ownerId] = apiError(0, 500);
  const context = setup({ config: { ...PUBLIC, testGuildIds: [] }, runtime: fakeRuntime({ guilds, fail }) });
  const run = await distribute(context);
  assert.equal(run.stoppedBy, null);
  assert.deepEqual({ sent: run.sent, failed: run.failed }, { sent: 1, failed: 6 });
  assert.ok((await context.store.get(first)).dmClosedUntil > T0, "50007 is remembered");
  assert.ok((await context.store.get(second)).dmClosedUntil > T0, "10013 too");
  assert.equal((await context.store.get(third)).dmClosedUntil, null);
  assert.equal(context.alerts.length, 0);
  assert.equal(context.modeStore.value, "", "a healthy run leaves the mode alone");
});

test("an owner Discord knows as a bot gets no DM", async () => {
  const context = setup({ runtime: fakeRuntime({ bots: [B] }) });
  await distribute(context);
  assert.deepEqual(recipientsOf(context.runtime), [A]);
});
