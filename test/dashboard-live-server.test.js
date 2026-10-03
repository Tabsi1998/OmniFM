import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #502 against the real Node API: signed in, the stream answers with the
// first state at once and with the next one when a listener joins.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-dashboard-live-"));
const env = {
  OMNIFM_RUNTIME_DATA_DIR: dataDir,
  WEB_INTERNAL_PORT: "0",
  WEB_PORT: "0",
  WEB_BIND: "127.0.0.1",
  API_RATE_LIMIT_MAX: "500",
};
const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);

const { startWebServer } = await import("../src/api/server.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { setDashboardAuthSession, deleteDashboardAuthSession } = await import("../src/dashboard-store.js");

const GUILD = String(100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)));
const WORKER = "bot-live-worker-1";

function runtimeOf({ id, name, role, guildDetails }) {
  const status = { id, botId: id, name, role, requiredTier: "free", ready: true, servers: 1, users: 3, connections: guildDetails.length, listeners: 3, uptimeSec: 120 };
  return {
    role,
    config: { id, index: role === "commander" ? 1 : 2, name, requiredTier: "free" },
    client: { isReady: () => true, guilds: { cache: new Map([[GUILD, { id: GUILD, name: "Club" }]]) } },
    getPublicStatus: () => status,
    getDashboardStatus: () => ({ ...status, guildDetails }),
    collectStats: () => ({ servers: 1, users: 3, connections: 1, listeners: 3 }),
    getPlayingGuildCount: () => 1,
  };
}

/** Reads the stream until `count` live messages arrived (or the time is up). */
async function liveMessages(body, count, timeoutMs) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const messages = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (messages.length < count && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- the stream comes piece by piece
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((resolve) => { setTimeout(() => resolve({ value: undefined, done: false }), Math.max(0, deadline - Date.now())); }),
    ]);
    if (done) break;
    if (!value) continue;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (block.startsWith("event: live")) messages.push(JSON.parse(block.split("data: ")[1]));
    }
  }
  reader.cancel().catch(() => {});
  return messages;
}

test("signed in, the stream sends the state at once and again when a listener joins", async (t) => {
  setLicenseProvider(() => null);
  const token = `live-dashboard-${Date.now()}`;
  const nowTs = Math.floor(Date.now() / 1000);
  setDashboardAuthSession(token, {
    user: { id: "523456789012345678", username: "Vereinsadmin" },
    guilds: [{ id: GUILD, name: "Club", permissions: "32", owner: true }],
    createdAt: nowTs,
    expiresAt: nowTs + 3600,
  });
  const playing = { guildId: GUILD, guildName: "Club", stationKey: "groovesalad", stationName: "Groove Salad", channelId: "423456789012345678", channelName: "Radio", listenerCount: 3, playing: true };
  const worker = runtimeOf({ id: WORKER, name: "OmniFM 1", role: "worker", guildDetails: [playing] });
  const commander = {
    ...runtimeOf({ id: "bot-live-commander", name: "OmniFM DJ", role: "commander", guildDetails: [] }),
    workerManager: { refreshRemoteStates: async () => null, getStreamingWorkers: (guildId) => (guildId === GUILD ? [worker] : []) },
  };
  const server = startWebServer([commander, worker]);
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    deleteDashboardAuthSession(token);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  });

  const anonymous = await fetch(`${base}/api/dashboard/live?serverId=${GUILD}`);
  assert.equal(anonymous.status, 401);
  await anonymous.body?.cancel();

  const controller = new AbortController();
  const answer = await fetch(`${base}/api/dashboard/live?serverId=${GUILD}`, { headers: { "x-session-token": token }, signal: controller.signal });
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get("content-type"), /^text\/event-stream/);
  assert.equal(answer.headers.get("x-accel-buffering"), "no");
  assert.equal(answer.headers.get("cache-control"), "no-store");

  // A listener joins a moment later; the hub looks every two seconds.
  setTimeout(() => { playing.listenerCount = 4; }, 300);
  const [first, second] = await liveMessages(answer.body, 2, 8000);
  controller.abort();
  assert.ok(first, "the first state came at once");
  assert.deepEqual(first.streams.map((row) => [row.botId, row.stationName, row.channelName, row.listeners]), [[WORKER, "Groove Salad", "Radio", 3]]);
  assert.equal(first.listenersNow, 3);
  assert.equal(first.totalListeningMs, undefined, "Free: the streams only, no stats");
  assert.ok(second, "the change came without asking");
  assert.equal(second.listenersNow, 4);
});
