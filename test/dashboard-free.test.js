import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #413 part 3: the dashboard's basics for every plan. A Free server sees what
// plays where, switches or stops the station, sets the language, voice guard
// and favourites; the rest answers with its plan.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-dashboard-free-"));
const env = {
  OMNIFM_RUNTIME_DATA_DIR: dataDir,
  WEB_INTERNAL_PORT: "0",
  WEB_PORT: "0",
  WEB_BIND: "127.0.0.1",
  API_RATE_LIMIT_MAX: "500",
};
const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const { startWebServer } = await import("../src/api/server.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { setDashboardAuthSession, deleteDashboardAuthSession } = await import("../src/dashboard-store.js");
const { getGuildLanguage } = await import("../src/guild-language-store.js");

const GUILD = String(100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)));
const VOICE = "423456789012345678";
const WORKER = "bot-free-worker-1";

function statusOf({ id, name, role, guildDetails }) {
  const status = { id, botId: id, name, role, requiredTier: "free", ready: true, servers: 1, users: 3, connections: guildDetails.length, listeners: 3, uptimeSec: 120 };
  return { getPublicStatus: () => status, getDashboardStatus: () => ({ ...status, guildDetails }) };
}

function createRuntimes() {
  const calls = { play: [], stop: [], clearEvent: [] };
  const worker = {
    role: "worker",
    config: { id: WORKER, index: 2, name: "OmniFM 1", requiredTier: "free" },
    client: { isReady: () => true, guilds: { cache: new Map([[GUILD, { id: GUILD, name: "Club" }]]) } },
    ...statusOf({
      id: WORKER,
      name: "OmniFM 1",
      role: "worker",
      guildDetails: [{ guildId: GUILD, guildName: "Club", stationKey: "groovesalad", stationName: "Groove Salad", channelId: VOICE, channelName: "Radio", listenerCount: 3, playing: true }],
    }),
    async playInGuild(...args) { calls.play.push(args); return { ok: true }; },
    async stopInGuild(guildId) { calls.stop.push(guildId); return { ok: true }; },
    clearScheduledEventPlaybackInGuild(guildId) { calls.clearEvent.push(guildId); },
  };
  const commander = {
    role: "commander",
    config: { id: "bot-free-commander", index: 1, name: "OmniFM DJ", requiredTier: "free" },
    client: { isReady: () => true, guilds: { cache: new Map([[GUILD, { id: GUILD, name: "Club" }]]) } },
    ...statusOf({ id: "bot-free-commander", name: "OmniFM DJ", role: "commander", guildDetails: [] }),
    workerManager: {
      refreshRemoteStates: async () => null,
      getStreamingWorkers: (guildId) => (guildId === GUILD ? [worker] : []),
    },
    // Like the real one: the station of the server's plan, else the reason.
    resolveStationForGuild(guildId, key) {
      if (key === "dronezone") return { ok: true, key, station: { name: "Drone Zone" }, stations: { stations: { dronezone: { name: "Drone Zone" } } } };
      return { ok: false, message: `Station \`${key}\` ist in deinem Plan nicht verfügbar.` };
    },
    collectStats: () => ({ servers: 1, users: 3, connections: 1, listeners: 3 }),
    getPlayingGuildCount: () => 1,
  };
  return { runtimes: [commander, worker], calls };
}

test("a Free server's dashboard: what plays where, switch, stop, and the rest by plan", async (t) => {
  setLicenseProvider(() => null);
  let mongo = null;
  if (hasMongoConfig) {
    const { connect, getDb } = await import("../src/lib/db.js");
    await connect();
    mongo = getDb();
  }
  const token = `free-dashboard-${Date.now()}`;
  const nowTs = Math.floor(Date.now() / 1000);
  setDashboardAuthSession(token, {
    user: { id: "523456789012345678", username: "Vereinsadmin" },
    guilds: [{ id: GUILD, name: "Club", permissions: "32", owner: true }],
    createdAt: nowTs,
    expiresAt: nowTs + 3600,
  });
  const { runtimes, calls } = createRuntimes();
  const server = startWebServer(runtimes);
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    deleteDashboardAuthSession(token);
    if (mongo) await mongo.collection("guild_settings").deleteMany({ guildId: GUILD }).catch(() => null);
    const { close } = await import("../src/lib/db.js");
    await close().catch(() => null);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  });

  const call = async (method, pathname, body) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        "x-session-token": token,
        "X-OmniFM-Language": "de",
        ...(method === "GET" ? {} : { "X-OmniFM-CSRF": "dashboard-intent", "Content-Type": "application/json" }),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, payload: await response.json().catch(() => ({})) };
  };

  // What plays where.
  const now = await call("GET", `/api/dashboard/playback/now?serverId=${GUILD}`);
  assert.equal(now.status, 200, JSON.stringify(now.payload));
  assert.deepEqual(now.payload.streams.map((row) => [row.botId, row.stationName, row.channelName, row.listeners]), [[WORKER, "Groove Salad", "Radio", 3]]);

  // Switch: only stations of the plan; the bot stays in its channel.
  const refused = await call("POST", "/api/dashboard/playback/switch", { serverId: GUILD, botId: WORKER, stationKey: "tecnoradio" });
  assert.equal(refused.status, 400);
  assert.match(refused.payload.error, /nicht verfügbar/);
  const switched = await call("POST", "/api/dashboard/playback/switch", { serverId: GUILD, botId: WORKER, stationKey: "dronezone" });
  assert.equal(switched.status, 200, JSON.stringify(switched.payload));
  assert.equal(switched.payload.stationName, "Drone Zone");
  assert.deepEqual(calls.play.map((args) => args.slice(0, 3)), [[GUILD, VOICE, "dronezone"]]);
  assert.deepEqual(calls.clearEvent, [GUILD], "a running event gives way, like with /play");

  // Stop; an unknown bot is refused.
  assert.equal((await call("POST", "/api/dashboard/playback/stop", { serverId: GUILD, botId: "someone-else" })).status, 404);
  assert.equal((await call("POST", "/api/dashboard/playback/stop", { serverId: GUILD, botId: WORKER })).status, 200);
  assert.deepEqual(calls.stop, [GUILD]);

  // Pro parts answer with their plan.
  assert.equal((await call("GET", `/api/dashboard/playback?serverId=${GUILD}`)).status, 403, "the live view is Pro");
  assert.equal((await call("POST", "/api/dashboard/playback/restart", { serverId: GUILD, botId: WORKER })).status, 403);
  assert.equal((await call("GET", `/api/dashboard/stats?serverId=${GUILD}`)).status, 403, "statistics are Pro");

  // The stations of the plan and the settings with the language.
  const stations = await call("GET", `/api/dashboard/stations?serverId=${GUILD}`);
  assert.equal(stations.status, 200);
  assert.ok(stations.payload.free.length > 0);
  assert.equal(stations.payload.pro.length, 0, "only the Free stations");
  const settings = await call("GET", `/api/dashboard/settings?serverId=${GUILD}`);
  assert.equal(settings.status, 200, JSON.stringify(settings.payload));
  assert.equal(settings.payload.capabilities.dashboardBasic, true);
  assert.equal(settings.payload.capabilities.dashboardAccess, false);
  assert.deepEqual(settings.payload.serverLanguage, { current: "auto", options: ["auto", "de", "en", "fr", "es", "it", "pl", "tr", "pt", "nl"] }, "the bot's nine languages (#477)");
  // #425: the time zone and the seasonal decoration, every plan, everything on at first.
  assert.deepEqual(settings.payload.serverTimeZone, { current: "Europe/Vienna", default: "Europe/Vienna" });
  assert.ok(Object.values(settings.payload.seasonDecor.seasons).every(Boolean));
  assert.ok(Object.values(settings.payload.seasonDecor.parts).every(Boolean));
  assert.ok(Object.values(settings.payload.seasonDecor.ownerEnabled).every(Boolean));

  if (!mongo) return;
  const german = await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { serverLanguage: "de" });
  assert.equal(german.status, 200, JSON.stringify(german.payload));
  assert.equal(german.payload.serverLanguage.current, "de");
  assert.equal(getGuildLanguage(GUILD), "de", "the same as /language");
  assert.equal((await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { serverLanguage: "klingonisch" })).status, 400);
  assert.equal((await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { serverLanguage: "auto" })).payload.serverLanguage.current, "auto");
  assert.equal(getGuildLanguage(GUILD), null);

  const status = await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { voiceStatus: { template: "{station}" } });
  assert.equal(status.status, 403, "the voice channel status is Pro");
  assert.match(status.payload.error, /Pro/);
  assert.equal((await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { weeklyDigest: { enabled: false } })).status, 403);
  const favorites = await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { favorites: { stations: ["a", "b", "c", "d"] } });
  assert.equal(favorites.status, 400, "Free: three favourites");
  assert.equal((await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { favorites: { stations: ["a", "b"] } })).status, 200);

  const zone = await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { serverTimeZone: "America/New_York" });
  assert.equal(zone.status, 200, JSON.stringify(zone.payload));
  assert.equal(zone.payload.serverTimeZone.current, "America/New_York");
  assert.equal((await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { serverTimeZone: "Mars/Olympus" })).status, 400);
  const decor = await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { seasonDecor: { seasons: { advent: false }, parts: { eggHunt: false } } });
  assert.equal(decor.status, 200, "a Free server switches the decoration too");
  assert.deepEqual([decor.payload.seasonDecor.seasons.advent, decor.payload.seasonDecor.seasons.easter, decor.payload.seasonDecor.parts.eggHunt], [false, true, false]);
  assert.equal(decor.payload.serverTimeZone.current, "America/New_York", "saving the decoration keeps the time zone");
  const again = await call("GET", `/api/dashboard/settings?serverId=${GUILD}`);
  assert.deepEqual([again.payload.serverTimeZone.current, again.payload.seasonDecor.seasons.advent], ["America/New_York", false]);
  assert.equal((await call("PUT", `/api/dashboard/settings?serverId=${GUILD}`, { serverTimeZone: "Europe/Vienna" })).payload.serverTimeZone.current, "Europe/Vienna");
});
