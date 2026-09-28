import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #304: the dashboard's live view. Every phase change of a bot is kept for a
// day; the view shows it as a timeline per bot; two buttons kick a hanging
// playback loose, on the bot that plays.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-live-view-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const GUILD = `5${String(Date.now()).padStart(17, "0")}`;

const { buildLiveView } = await import("../src/lib/playback-timeline.js");
const { createDashboardPlaybackRouteHandler } = await import("../src/api/routes/dashboard-playback.js");
const { liveViewMethods } = await import("../src/bot/runtime-methods/live-view.js");

after(async () => {
  if (hasMongoConfig) {
    const { getDb, close } = await import("../src/lib/db.js");
    await getDb()?.collection("playback_timeline").deleteMany({ guildId: GUILD }).catch(() => null);
    await close().catch(() => null);
  }
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
});

const entry = (hoursAgo, phase, extra = {}) => ({
  botId: "bot-2", botName: "OmniFM 2", phase, from: "idle", reason: "x", stationName: "Groove Salad", failover: false,
  at: new Date(NOW - hoursAgo * HOUR).toISOString(), ...extra,
});

test("the timeline: segments per bot inside the 24 hours, the same phase and station merged, newest change first", () => {
  const view = buildLiveView([
    entry(30, "playing"), // began before the window: its segment starts at the window
    entry(20, "playing", { reason: "restart-done" }), // same phase and station: merged
    entry(10, "recovering", { reason: "reconnect:voice-lost" }),
    entry(9.5, "playing", { failover: true, stationName: "Deep Space One" }),
    entry(2, "idle", { reason: "stop" }),
    { ...entry(40, "idle"), botId: "bot-3", botName: "OmniFM 3" }, // idle all day: left out
  ], { now: NOW });
  assert.deepEqual(view.bots.map((bot) => bot.botId), ["bot-2"]);
  const [bot] = view.bots;
  assert.deepEqual(bot.segments.map((segment) => [segment.phase, segment.station, segment.failover]), [
    ["playing", "Groove Salad", false],
    ["recovering", "Groove Salad", false],
    ["playing", "Deep Space One", true],
    ["idle", "Groove Salad", false],
  ]);
  assert.equal(bot.segments[0].from, new Date(NOW - 24 * HOUR).toISOString(), "clipped to the window");
  assert.equal(bot.segments[0].to, new Date(NOW - 10 * HOUR).toISOString());
  assert.deepEqual(bot.current, { phase: "idle", since: new Date(NOW - 2 * HOUR).toISOString(), station: "Groove Salad", failover: false });
  assert.deepEqual(bot.events.map((event) => event.phase), ["idle", "playing", "recovering", "playing"], "newest first, only inside the window");
});

function routeDeps({ capability = true } = {}) {
  return {
    getDashboardRequestTranslator: () => ({ language: "de" }),
    getDashboardSession: () => ({ session: { user: { id: "1" } } }),
    methodNotAllowed: (res) => { res.status = 405; },
    resolveDashboardGuildForSession: (_session, serverId) => (serverId === GUILD ? { id: GUILD } : null),
    sendJson: (res, status, body) => { res.status = status; res.body = body; },
    sendLocalizedError: (res, status, _language, de) => { res.status = status; res.body = { error: de }; },
    serverHasCapability: () => capability,
  };
}

function worker(id, calls) {
  return {
    config: { id },
    restartStationFromDashboard: async (guildId) => { calls.push(["restart", id, guildId]); return { ok: true }; },
    reconnectVoiceFromDashboard: async (guildId) => { calls.push(["reconnect", id, guildId]); return { ok: false, error: "busy" }; },
  };
}

test("the buttons reach the bot that plays; a bot that does not play or a server without Pro is refused", async () => {
  const calls = [];
  const commander = { role: "commander", workerManager: { getStreamingWorkers: (guildId) => (guildId === GUILD ? [worker("bot-2", calls)] : []) } };
  const handle = createDashboardPlaybackRouteHandler(routeDeps());
  const post = async (pathname, body, deps = handle) => {
    const res = {};
    const handled = await deps({ req: { method: "POST" }, res, requestUrl: new URL(`http://x${pathname}`), readJsonBody: async () => body, runtimes: [commander] });
    return { handled, ...res };
  };
  assert.deepEqual(await post("/api/dashboard/playback/restart", { serverId: GUILD, botId: "bot-2" }), { handled: true, status: 200, body: { ok: true, action: "restart" } });
  assert.deepEqual(calls, [["restart", "bot-2", GUILD]]);
  assert.equal((await post("/api/dashboard/playback/reconnect", { serverId: GUILD, botId: "bot-2" })).status, 409, "busy: the bot reconnects already");
  assert.equal((await post("/api/dashboard/playback/restart", { serverId: GUILD, botId: "bot-9" })).status, 404, "not playing there");
  assert.equal((await post("/api/dashboard/playback/restart", { serverId: "other", botId: "bot-2" })).status, 403, "not your server");
  const withoutPro = createDashboardPlaybackRouteHandler(routeDeps({ capability: false }));
  assert.equal((await post("/api/dashboard/playback/restart", { serverId: GUILD, botId: "bot-2" }, withoutPro)).status, 403);
  const res = {};
  assert.equal(await handle({ req: { method: "GET" }, res, requestUrl: new URL("http://x/api/dashboard/other"), runtimes: [] }), false, "other paths pass");
});

test("restart and reconnect keep the station and refuse while the bot is busy or not playing", async () => {
  const calls = [];
  const state = { currentStationKey: "groovesalad", shouldReconnect: true, lastChannelId: "123" };
  const runtime = {
    ...liveViewMethods,
    getState: () => state,
    restartCurrentStation: async (_state, guildId) => { calls.push(["restart", guildId]); },
    resetVoiceSession: (guildId, _state, options) => { calls.push(["reset", guildId, options]); },
    scheduleReconnect: (guildId, options) => { calls.push(["schedule", guildId, options.reason]); },
  };
  assert.deepEqual(await runtime.restartStationFromDashboard(GUILD), { ok: true });
  assert.deepEqual(await runtime.reconnectVoiceFromDashboard(GUILD), { ok: true });
  assert.deepEqual(calls, [
    ["restart", GUILD],
    ["reset", GUILD, { preservePlaybackTarget: true, clearLastChannel: false }],
    ["schedule", GUILD, "dashboard"],
  ]);
  state.reconnectInFlight = true;
  assert.deepEqual(await runtime.reconnectVoiceFromDashboard(GUILD), { ok: false, error: "busy" });
  Object.assign(state, { reconnectInFlight: false, shouldReconnect: false, currentStationKey: null });
  assert.deepEqual(await runtime.restartStationFromDashboard(GUILD), { ok: false, error: "not-playing" });
});

test("a worker in its own process gets both buttons through the bridge", async () => {
  const { WorkerBridgeService } = await import("../src/bot/worker-bridge-service.js");
  const calls = [];
  const service = new WorkerBridgeService({
    config: { id: "bot-2" },
    restartStationFromDashboard: async (guildId) => { calls.push(["restart", guildId]); return { ok: true }; },
    reconnectVoiceFromDashboard: async (guildId) => { calls.push(["reconnect", guildId]); return { ok: true }; },
  }, { bridge: {}, doorbell: {} });
  await service.executeCommand({ type: "restartStation", payload: { guildId: GUILD } });
  await service.executeCommand({ type: "reconnectVoice", payload: { guildId: GUILD } });
  assert.deepEqual(calls, [["restart", GUILD], ["reconnect", GUILD]]);
});

test("every phase change of a bot lands in the timeline, and the timeline reads it back", { skip: !hasMongoConfig }, async () => {
  const { connect } = await import("../src/lib/db.js");
  await connect();
  const { recordPlaybackPhase } = await import("../src/bot/playback-phase.js");
  const { readPlaybackTimeline } = await import("../src/playback-timeline-store.js");
  const runtime = { config: { id: "bot-2", name: "OmniFM 2" } };
  const state = { currentStationKey: "groovesalad", currentStationName: "Groove Salad", shouldReconnect: true, voiceConnectInFlight: true };
  recordPlaybackPhase(runtime, GUILD, state, "voice-connect");
  Object.assign(state, { voiceConnectInFlight: false, connection: {}, player: { state: { status: "playing" } } });
  recordPlaybackPhase(runtime, GUILD, state, "player");
  let rows = [];
  for (let attempt = 0; attempt < 20 && rows.length < 2; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- the writes are not awaited by the playback
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    // eslint-disable-next-line no-await-in-loop
    rows = await readPlaybackTimeline(GUILD);
  }
  assert.deepEqual(rows.map((row) => [row.botId, row.phase, row.reason, row.stationName]), [
    ["bot-2", "connecting", "voice-connect", "Groove Salad"],
    ["bot-2", "playing", "player", "Groove Salad"],
  ]);
  assert.ok(!("guildId" in rows[0]) && !("expiresAt" in rows[0]), "the view gets what it shows");
});
