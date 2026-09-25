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

test("failover history rows and configured bots like FastAPI", () => {
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
  assert.equal(monitoring.isStripeEnabled({ payments: { stripe: { enabled: false, secretKey: "sk" } } }, {}), false);
  assert.equal(monitoring.isStripeEnabled({}, { STRIPE_SECRET_KEY: "sk_live_x" }), true);
});
