import test from "node:test";
import assert from "node:assert/strict";

const monitoring = await import("../src/lib/owner-monitoring.js");

const NOW = Date.parse("2026-09-25T12:00:00Z");
const fakeDb = (docs) => ({
  collection: (name) => ({
    findOne: async () => docs[name] ?? null,
    find: () => ({ toArray: async () => docs[`${name}:list`] || [] }),
  }),
  command: async () => ({ ok: 1 }),
});

test("live only while the bots' health document is fresh (30 seconds)", async () => {
  const fresh = { at: new Date(NOW - 10_000).toISOString(), nodes: [] };
  const stale = { at: new Date(NOW - 60_000).toISOString(), nodes: [] };
  assert.deepEqual(await monitoring.readRuntimeHealthFresh(fakeDb({ runtime_health: fresh }), { now: NOW }), fresh);
  assert.equal(await monitoring.readRuntimeHealthFresh(fakeDb({ runtime_health: stale }), { now: NOW }), null);
  const waiting = await monitoring.monitoringResponse(fakeDb({ runtime_health: stale }), { now: NOW });
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.simulated, false, "no simulated demo numbers on the Node API");
});

test("the live numbers count each server once and only online bots", () => {
  const totals = monitoring.liveRuntimeTotals({
    nodes: [
      { status: "online", guildIds: ["1", "2"], users: 10, voiceConnections: 1, listeners: 4 },
      { status: "online", guildIds: ["2", "3"], users: 5, voiceConnections: 2, listeners: 1 },
      { status: "offline", guildIds: ["9"], users: 99 },
    ],
  });
  assert.deepEqual(totals, { botsOnline: 2, servers: 3, users: 15, voiceConnections: 3, listeners: 5, live: true });
  assert.equal(monitoring.liveRuntimeTotals(null).live, false);
});

test("servers to look at: parked first by how long, backup station, muted, recovering", () => {
  const rows = monitoring.buildAffectedServers([{
    name: "OmniFM 1",
    guildDetails: [
      { guildId: "a", name: "A", failoverActive: true, failoverStartedAt: NOW - 60_000, stationName: "Backup" },
      { guildId: "b", name: "B", parkedReason: "stream down", parkedAt: NOW - 600_000 },
      { guildId: "c", name: "C", serverMuted: true, serverMutedAt: NOW - 5_000 },
      { guildId: "d", name: "D" },
    ],
  }], NOW);
  assert.deepEqual(rows.map((row) => [row.guildId, row.state, row.durationSec]), [["b", "parked", 600], ["a", "failover", 60], ["c", "muted", 5]]);
});

test("failover history rows and configured bots", () => {
  const row = monitoring.formatFailoverHistoryRow({
    eventKey: "stream_failback_completed",
    timestamp: new Date(NOW),
    guildId: "1",
    payload: { previousStationName: "Lounge", restoredStationName: "Lounge", failoverDurationMs: 125_000 },
  });
  assert.deepEqual([row.kind, row.from, row.to, row.durationSec, row.at], ["back", "Lounge", "Lounge", 125, new Date(NOW).toISOString()]);

  const fromEnv = monitoring.loadConfiguredBots({}, { BOT_1_TOKEN: "t", BOT_1_CLIENT_ID: "111111111111111111", BOT_2_TOKEN: "t", BOT_2_TIER: "pro" });
  assert.deepEqual(fromEnv.map((bot) => [bot.index, bot.requiredTier, bot.inviteUrl === null]), [[1, "free", false], [2, "pro", true]]);
  const fromConsole = monitoring.loadConfiguredBots({ discord: { commander: { clientId: "1", name: "Cmd" }, workers: [{ clientId: "2", tier: "ultimate" }] } }, {});
  assert.deepEqual(fromConsole.map((bot) => [bot.name, bot.requiredTier]), [["Cmd", "free"], ["OmniFM Bot 2", "ultimate"]]);
});

test("settings: what the owner saved first, then the environment, then the default", () => {
  const raw = { system: { smtp: { host: "owner.example", port: "" } } };
  assert.equal(monitoring.systemSetting(raw, "smtp", "host", "SMTP_HOST", "", { SMTP_HOST: "env.example" }), "owner.example");
  assert.equal(monitoring.systemSetting(raw, "smtp", "port", "SMTP_PORT", 587, { SMTP_PORT: "2525" }), "2525", "an empty saved value falls through");
  assert.equal(monitoring.systemSetting(raw, "smtp", "user", "SMTP_USER", "x", {}), "x");
});

// From FastAPI's unit tests (#291): incidents, the server directory and the
// rest of the affected servers and failover history.
test("an incident row: a process incident as stored, a server one named after server and event", () => {
  assert.deepEqual(monitoring.formatRuntimeIncident({
    at: "2026-09-24T10:00:00+00:00", severity: "WARNING", source: "station-health", message: "Sender x ist offline", resolved: false,
  }), { at: "2026-09-24T10:00:00+00:00", severity: "warning", source: "station-health", message: "Sender x ist offline", resolved: false });

  const server = monitoring.formatRuntimeIncident({
    guildId: "123456789012345678", guildName: "Guild One", eventKey: "stream_failover_activated", severity: "warning",
    timestamp: new Date(Date.UTC(2026, 8, 24, 10)), runtime: { name: "OmniFM 3" }, acknowledgedAt: "2026-09-24T11:00:00+00:00",
  });
  assert.deepEqual([server.message, server.source, server.at, server.resolved], ["Guild One: stream_failover_activated", "OmniFM 3", "2026-09-24T10:00:00.000Z", true]);

  const stored = monitoring.formatRuntimeIncident({
    guildId: "123456789012345678", eventKey: "stream_failback_completed", at: "2026-09-24T10:00:00.000Z",
    message: "Guild One: back on Alpha FM (before: Beta FM)", source: "OmniFM 3", severity: "success", resolved: true,
  });
  assert.equal(stored.message, "Guild One: back on Alpha FM (before: Beta FM)", "a stored message is used as it is");
  assert.equal(stored.resolved, true);
});

const GUILD_ONE = "123456789012345678";
const GUILD_TWO = "223456789012345678";
const DIRECTORY = [
  {
    _id: GUILD_ONE, name: "Guild One", memberCount: 5, iconUrl: "https://cdn.example.test/1.png",
    roles: [{ id: "1", name: "DJ" }], voiceChannels: [{ id: "2", name: "Radio" }], textChannels: [{ id: "3", name: "chat" }],
  },
  { _id: GUILD_TWO, name: "Guild Two", memberCount: 9, roles: [], voiceChannels: [], textChannels: [] },
];
function directoryDb() {
  const queries = [];
  return {
    queries,
    collection: () => ({
      find: (query, options = {}) => {
        queries.push([query, options.projection]);
        const hidden = Object.keys(options.projection || {});
        const rows = DIRECTORY.filter((row) => query._id.$in.includes(row._id))
          .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.includes(key))));
        return { toArray: async () => rows };
      },
    }),
  };
}

test("the server directory lists every server the bots are in, the lists only on request", async () => {
  const db = directoryDb();
  const guilds = await monitoring.runtimeGuildDirectory(db, { nodes: [
    { name: "Commander", guildIds: [GUILD_ONE, GUILD_TWO], guildDetails: [{ id: GUILD_ONE, guildId: GUILD_ONE, name: "Guild One", playing: true }] },
    { name: "Worker 2", guildIds: [GUILD_TWO], guildDetails: [] },
  ] });
  assert.deepEqual(Object.keys(guilds).sort(), [GUILD_ONE, GUILD_TWO]);
  assert.equal(guilds[GUILD_TWO].name, "Guild Two");
  assert.deepEqual(guilds[GUILD_TWO].bots, ["Commander", "Worker 2"]);
  assert.equal(guilds[GUILD_ONE].iconUrl, "https://cdn.example.test/1.png");
  assert.deepEqual(guilds[GUILD_ONE].roles, [], "lists only on request");
  assert.deepEqual(db.queries[0][1], { roles: 0, voiceChannels: 0, textChannels: 0 });

  const one = directoryDb();
  const single = await monitoring.runtimeGuildDirectory(one, { nodes: [{ name: "Commander", guildIds: [GUILD_ONE, GUILD_TWO], guildDetails: [] }] }, { guildIds: [GUILD_ONE], withLists: true });
  assert.deepEqual(Object.keys(single), [GUILD_ONE]);
  assert.deepEqual(
    [single[GUILD_ONE].roles, single[GUILD_ONE].voiceChannels, single[GUILD_ONE].textChannels],
    [DIRECTORY[0].roles, DIRECTORY[0].voiceChannels, DIRECTORY[0].textChannels]
  );
  assert.deepEqual(one.queries, [[{ _id: { $in: [GUILD_ONE] } }, undefined]]);
});

test("the server directory keeps the inline lists of an older bot", async () => {
  const inline = { roles: [{ id: "9", name: "Alt" }], voiceChannels: [{ id: "8" }], textChannels: [{ id: "7" }] };
  const health = { nodes: [{ name: "Commander", guildDetails: [{ id: GUILD_ONE, name: "Old Name", memberCount: 3, ...inline }] }] };
  const guild = (await monitoring.runtimeGuildDirectory(directoryDb(), health, { guildIds: [GUILD_ONE], withLists: true }))[GUILD_ONE];
  assert.deepEqual(guild.roles, inline.roles);
  assert.equal(guild.name, "Old Name");
  assert.equal(guild.memberCount, 5);
});

test("affected servers carry the station they wait for, the next probe and the bot", () => {
  const rows = monitoring.buildAffectedServers([
    { name: "Worker 2", guildDetails: [
      { guildId: "1", name: "Playing fine", playing: true },
      {
        guildId: "2", name: "Backup", failoverActive: true, failoverStartedAt: NOW - 600_000, stationName: "Beta FM",
        desiredStationName: "Alpha FM", failoverReason: "503", failbackNextProbeAt: NOW + 60_000,
      },
      { guildId: "3", name: "Parked", parkedReason: "permissions", parkedAt: NOW - 3_600_000 },
    ] },
    { name: "Worker 3", guildDetails: [
      { guildId: "4", name: "Muted", serverMuted: true, serverMutedAt: NOW - 60_000, playing: true },
      { guildId: "5", name: "Recovering", recovering: true },
    ] },
  ], NOW);
  assert.deepEqual(rows.map((row) => [row.guildName, row.state]), [["Parked", "parked"], ["Backup", "failover"], ["Muted", "muted"], ["Recovering", "recovering"]]);
  assert.deepEqual([rows[0].durationSec, rows[0].detail], [3600, "permissions"]);
  assert.deepEqual([rows[1].desiredStationName, rows[1].failbackNextProbeAt, rows[1].botName, rows[2].botName], ["Alpha FM", NOW + 60_000, "Worker 2", "Worker 3"]);
  assert.equal(rows[3].durationSec, null);
});

test("failover history reads every kind of switch", () => {
  const base = { guildId: "1", guildName: "Guild One", runtime: { name: "OmniFM 2" }, timestamp: new Date(NOW) };
  const swap = monitoring.formatFailoverHistoryRow({
    ...base, eventKey: "stream_failover_activated", payload: { previousStationName: "Alpha FM", failoverStationName: "Beta FM", triggerError: "503" },
  });
  const exhausted = monitoring.formatFailoverHistoryRow({ ...base, eventKey: "stream_failover_exhausted", payload: { previousStationName: "Alpha FM" } });
  assert.deepEqual([swap.kind, swap.from, swap.to, swap.reason, swap.runtime], ["switch", "Alpha FM", "Beta FM", "503", "OmniFM 2"]);
  assert.deepEqual([exhausted.kind, exhausted.to], ["exhausted", ""]);
});
