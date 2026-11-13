import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #523: a dashboard session keeps the server list and rights of its Discord
// login for 24 hours. Whoever loses "Manage Server" or leaves the server must
// not change it longer than DASHBOARD_PERMISSION_RECHECK_SECONDS: after that
// the bot asks Discord again, once per user and server until the next deadline.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-permission-recheck-"));
const env = {
  OMNIFM_RUNTIME_DATA_DIR: dataDir,
  WEB_INTERNAL_PORT: "0",
  WEB_PORT: "0",
  WEB_BIND: "127.0.0.1",
  API_RATE_LIMIT_MAX: "5000",
  DASHBOARD_PERMISSION_RECHECK_SECONDS: "600",
};
const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);

const { startWebServer } = await import("../src/api/server.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { setDashboardAuthSession, deleteDashboardAuthSession } = await import("../src/dashboard-store.js");
const { setDashboardPermissionRestForTests, freshPermissionRevoked, checkFreshGuildPermission } = await import("../src/api/helpers/permission-recheck.js");

const GUILD = "723456789012345678";
const OTHER_GUILD = "723456789012345679";
const WORKER_TOKEN = "worker-token-sentinel";
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;
const REVOKED_MESSAGE = /no longer manage this server/i;
const UNAVAILABLE_MESSAGE = /could not be checked/i;

const unknownMember = () => Object.assign(new Error("Unknown Member"), { code: 10007, status: 404 });

/** What Discord says about each user on the servers; counts every question. */
function fakeDiscord() {
  const members = new Map(); // GUILD
  const otherMembers = new Map(); // OTHER_GUILD
  const calls = [];
  const guildOf = (id, answers) => ({
    id,
    name: "Club",
    members: {
      async fetch(options) {
        calls.push(options);
        const answer = answers.get(String(options?.user || ""));
        if (answer instanceof Error) throw answer;
        if (answer === undefined) throw unknownMember();
        return { id: options.user, permissions: { bitfield: answer } };
      },
    },
  });
  const runtime = {
    role: "commander",
    config: { id: "bot-commander", index: 1, name: "OmniFM", requiredTier: "free" },
    client: { isReady: () => true, guilds: { cache: new Map([[GUILD, guildOf(GUILD, members)], [OTHER_GUILD, guildOf(OTHER_GUILD, otherMembers)]]) } },
    getPublicStatus: () => ({ id: "bot-commander", ready: true, servers: 1 }),
    getDashboardStatus: () => ({ id: "bot-commander", ready: true, servers: 1, guildDetails: [] }),
    collectStats: () => ({ servers: 1, users: 1, connections: 0, listeners: 0 }),
    getPlayingGuildCount: () => 0,
    getState: () => null,
  };
  return { members, otherMembers, calls, runtime };
}

/**
 * A worker of the split mode as the commander sees it (RemoteWorkerHandle):
 * a stand-in guild without members.fetch, Discord only over REST.
 */
function fakeWorker(t, { guild, members = new Map(), fail = null }) {
  const calls = [];
  const tokens = [];
  setDashboardPermissionRestForTests((token) => {
    tokens.push(token);
    return {
      async get(route) {
        calls.push(route);
        if (fail) throw fail;
        const memberMatch = route.match(/^\/guilds\/(\d+)\/members\/(\d+)$/);
        if (memberMatch) {
          const roles = members.get(memberMatch[2]);
          if (!roles) throw unknownMember();
          return { user: { id: memberMatch[2] }, roles };
        }
        if (route === `/guilds/${GUILD}`) return guild;
        throw Object.assign(new Error("Unknown Guild"), { code: 10004, status: 404 });
      },
    };
  });
  t.after(() => setDashboardPermissionRestForTests(null));
  const runtime = {
    role: "worker",
    remote: true,
    config: { id: "bot-worker-1", index: 2, name: "OmniFM 1", token: WORKER_TOKEN },
    client: { isReady: () => true, guilds: { cache: new Map([[GUILD, { id: GUILD, name: "Club", members: { me: null, fetchMe: async () => null } }]]) } },
    getPublicStatus: () => ({ id: "bot-worker-1", ready: true, servers: 1 }),
    getDashboardStatus: () => ({ id: "bot-worker-1", ready: true, servers: 1, guildDetails: [] }),
    collectStats: () => ({ servers: 1, users: 1, connections: 0, listeners: 0 }),
    getPlayingGuildCount: () => 0,
    getState: () => null,
  };
  return { calls, tokens, runtime, members };
}

let userCounter = 0;
/** A session whose login is `ageSeconds` old; every test gets its own user. */
function signIn(ageSeconds, guildIds = [GUILD]) {
  userCounter += 1;
  const userId = String(523000000000000000n + BigInt(userCounter));
  const token = `recheck-${userId}-${Date.now()}`;
  const nowTs = Math.floor(Date.now() / 1000);
  setDashboardAuthSession(token, {
    user: { id: userId, username: "Vereinsadmin" },
    guilds: guildIds.map((id) => ({ id, name: "Club", permissions: "32", owner: false })),
    createdAt: nowTs - ageSeconds,
    expiresAt: nowTs + 86_400,
  });
  return { userId, token };
}

async function startServer(t, runtimes) {
  setLicenseProvider(() => null);
  const server = startWebServer(runtimes);
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  return base;
}

async function call(base, token, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "en",
      ...(method === "GET" ? {} : { "X-OmniFM-CSRF": "dashboard-intent", "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, error: String(payload?.error || "") };
}

// playback/stop names its server in the body; behind the guard the route
// answers 404 (no bot plays), so 404 means "the change got through".
const stop = (base, token) => call(base, token, "/api/dashboard/playback/stop", { method: "POST", body: { serverId: GUILD, botId: "bot-x" } });

test.after(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("rights lost after the login stop changes at the next deadline, not after 24 hours", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { userId, token } = signIn(0);
  t.after(() => deleteDashboardAuthSession(token));

  // Fresh login: its own rights count, Discord is not asked.
  discord.members.set(userId, 0n);
  assert.equal((await stop(base, token)).status, 404);
  assert.equal(discord.calls.length, 0);

  t.mock.timers.tick(601_000);
  const refused = await stop(base, token);
  assert.equal(refused.status, 403);
  assert.match(refused.error, REVOKED_MESSAGE);
  assert.equal(discord.calls.length, 1);
  assert.equal(discord.calls[0].user, userId);
  assert.equal(discord.calls[0].force, true, "past Discord's member cache");
});

test("a kept right is asked once per deadline; a right lost meanwhile counts from the next one", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { userId, token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));

  discord.members.set(userId, MANAGE_GUILD);
  assert.equal((await stop(base, token)).status, 404);
  assert.equal((await stop(base, token)).status, 404);
  assert.equal((await call(base, token, `/api/dashboard/capabilities?serverId=${GUILD}`)).status, 200);
  assert.equal(discord.calls.length, 1, "one question for the user and server until the deadline");

  discord.members.set(userId, 0n);
  assert.equal((await stop(base, token)).status, 404, "still within the deadline");
  t.mock.timers.tick(601_000);
  assert.equal((await stop(base, token)).status, 403);
  assert.equal(discord.calls.length, 2);
});

test("Administrator counts like Manage Server, the same rule as the login", async (t) => {
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { userId, token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));
  discord.members.set(userId, ADMINISTRATOR);
  assert.equal((await stop(base, token)).status, 404);
});

test("whoever left the server is refused changes and reads", async (t) => {
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));

  const refused = await stop(base, token);
  assert.equal(refused.status, 403);
  assert.match(refused.error, REVOKED_MESSAGE);
  assert.equal((await call(base, token, `/api/dashboard/capabilities?serverId=${GUILD}`)).status, 403);
  assert.equal(discord.calls.length, 1);
});

test("Discord not answering: changes fail closed, reads keep working, no storm of questions", async (t) => {
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { userId, token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));
  discord.members.set(userId, Object.assign(new Error("Service Unavailable"), { status: 503 }));

  const refused = await stop(base, token);
  assert.equal(refused.status, 503);
  assert.match(refused.error, UNAVAILABLE_MESSAGE);
  assert.equal((await stop(base, token)).status, 503);
  assert.equal((await call(base, token, `/api/dashboard/capabilities?serverId=${GUILD}`)).status, 200);
  assert.equal(discord.calls.length, 1, "the failure is kept for a while, too");
});

test("no OmniFM bot on the server: changes are refused with a sign-in hint, reads keep working", async (t) => {
  const discord = fakeDiscord();
  discord.runtime.client.guilds.cache.clear();
  const base = await startServer(t, [discord.runtime]);
  const { token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));
  const refused = await stop(base, token);
  assert.equal(refused.status, 403);
  assert.match(refused.error, /no OmniFM bot is on it\. Please sign in again/);
  assert.equal((await call(base, token, `/api/dashboard/capabilities?serverId=${GUILD}`)).status, 200);
});

test("split mode, only a worker on the server: its REST answers, the token stays inside", async (t) => {
  const roleManage = "823456789012345678";
  const roleAdmin = "823456789012345679";
  const roleDj = "823456789012345680";
  const guild = {
    id: GUILD,
    owner_id: "999999999999999999",
    roles: [
      { id: GUILD, permissions: "1024" }, // @everyone: view channels only
      { id: roleManage, permissions: String(MANAGE_GUILD) },
      { id: roleAdmin, permissions: String(ADMINISTRATOR) },
      { id: roleDj, permissions: "2048" },
    ],
  };
  const worker = fakeWorker(t, { guild });
  const commander = fakeDiscord().runtime;
  commander.client.guilds.cache.clear();
  const base = await startServer(t, [commander, worker.runtime]);

  const manager = signIn(700);
  const admin = signIn(700);
  const owner = signIn(700);
  const dj = signIn(700);
  const left = signIn(700);
  for (const session of [manager, admin, owner, dj, left]) t.after(() => deleteDashboardAuthSession(session.token));
  worker.members.set(manager.userId, [roleManage]);
  worker.members.set(admin.userId, [roleDj, roleAdmin]);
  worker.members.set(owner.userId, []);
  worker.members.set(dj.userId, [roleDj]);
  guild.owner_id = owner.userId;

  assert.equal((await stop(base, manager.token)).status, 404, "Manage Server through a role");
  assert.equal((await stop(base, admin.token)).status, 404, "Administrator through a role");
  assert.equal((await stop(base, owner.token)).status, 404, "the owner, without any role");
  const djAnswer = await stop(base, dj.token);
  assert.equal(djAnswer.status, 403);
  assert.match(djAnswer.error, REVOKED_MESSAGE);
  assert.equal((await stop(base, left.token)).status, 403, "no longer on the server");
  assert.ok(worker.tokens.length > 0 && worker.tokens.every((token) => token === WORKER_TOKEN));
  assert.ok(worker.calls.includes(`/guilds/${GUILD}/members/${manager.userId}`));

  const callsBefore = worker.calls.length;
  assert.equal((await stop(base, manager.token)).status, 404);
  assert.equal(worker.calls.length, callsBefore, "the answer is kept until the deadline");
});

test("@everyone with Manage Server counts too", async (t) => {
  const worker = fakeWorker(t, { guild: { id: GUILD, owner_id: "1", roles: [{ id: GUILD, permissions: String(MANAGE_GUILD) }] } });
  const base = await startServer(t, [worker.runtime]);
  const { userId, token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));
  worker.members.set(userId, []);
  assert.equal((await stop(base, token)).status, 404);
});

test("split mode: a rate limit on the worker's REST fails closed with 503", async (t) => {
  const worker = fakeWorker(t, { guild: { id: GUILD, roles: [] }, fail: Object.assign(new Error("rate limited"), { name: "RateLimitError" }) });
  const base = await startServer(t, [worker.runtime]);
  const { token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));
  const refused = await stop(base, token);
  assert.equal(refused.status, 503);
  assert.match(refused.error, UNAVAILABLE_MESSAGE);
  assert.equal(worker.calls.length, 1);
  assert.equal((await stop(base, token)).status, 503);
  assert.equal(worker.calls.length, 1, "no storm while Discord says wait");
});

test("playback: a server in the address does not cover another one in the body", async (t) => {
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { userId, token } = signIn(700, [GUILD, OTHER_GUILD]);
  t.after(() => deleteDashboardAuthSession(token));
  discord.members.set(userId, 0n); // lost on GUILD
  discord.otherMembers.set(userId, MANAGE_GUILD); // kept on OTHER_GUILD

  for (const action of ["restart", "reconnect", "switch", "stop"]) {
    // eslint-disable-next-line no-await-in-loop -- one request after the other
    const answer = await call(base, token, `/api/dashboard/playback/${action}?serverId=${OTHER_GUILD}`, { method: "POST", body: { serverId: GUILD, botId: "bot-x" } });
    assert.equal(answer.status, 403, action);
    assert.match(answer.error, REVOKED_MESSAGE, action);
  }
  const foreign = await call(base, token, `/api/dashboard/playback/stop?serverId=${OTHER_GUILD}`, { method: "POST", body: { serverId: "723456789012345600", botId: "bot-x" } });
  assert.equal(foreign.status, 403, "a body server outside the session");
  assert.equal((await call(base, token, `/api/dashboard/playback/stop?serverId=${OTHER_GUILD}`, { method: "POST", body: { serverId: OTHER_GUILD, botId: "bot-x" } })).status, 404);
});

test("a big body keeps the route's own limit after the check read it (bot look, 8 MB)", async (t) => {
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { token } = signIn(0);
  t.after(() => deleteDashboardAuthSession(token));
  const body = { slot: 1, avatar: `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}` };
  const withQuery = await call(base, token, `/api/dashboard/bot-profile?serverId=${GUILD}`, { method: "PUT", body });
  assert.notEqual(withQuery.status, 413);
  const withoutQuery = await call(base, token, "/api/dashboard/bot-profile", { method: "PUT", body });
  assert.notEqual(withoutQuery.status, 413);
  const tooBig = await call(base, token, `/api/dashboard/reports?serverId=${GUILD}`, { method: "POST", body: { text: "x".repeat(64 * 1024) } });
  assert.equal(tooBig.status, 413, "a small route still refuses a big body");
});

test("the live stream learns of a lost right without waiting for Discord", async () => {
  const discord = fakeDiscord();
  const userId = "523999999999999999";
  const session = { user: { id: userId }, createdAt: Math.floor(Date.now() / 1000) - 700 };
  assert.equal(freshPermissionRevoked([discord.runtime], { ...session, createdAt: Math.floor(Date.now() / 1000) }, GUILD), false, "fresh login");
  assert.equal(freshPermissionRevoked([discord.runtime], session, GUILD), false, "asked, no answer yet");
  await checkFreshGuildPermission([discord.runtime], userId, GUILD);
  assert.equal(freshPermissionRevoked([discord.runtime], session, GUILD), true);
  assert.equal(discord.calls.length, 1);
});

// Every dashboard path the routes know, so a new route is covered on its own.
function dashboardPaths() {
  const dir = new URL("../src/api/routes/", import.meta.url);
  const found = new Set(["/api/dashboard/events/some-event"]);
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const source = fs.readFileSync(new URL(name, dir), "utf8");
    for (const match of source.matchAll(/"(\/api\/dashboard\/[a-z0-9/-]+)"/g)) found.add(match[1]);
  }
  found.delete("/api/dashboard/telemetry"); // the owner's API token, no session
  return [...found].sort();
}

test("every changing dashboard call goes through the check, before its route", async (t) => {
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { token } = signIn(700);
  t.after(() => deleteDashboardAuthSession(token));

  const paths = dashboardPaths();
  assert.ok(paths.length >= 35, `found ${paths.length} dashboard paths`);
  const passed = [];
  for (const pathname of paths) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      // eslint-disable-next-line no-await-in-loop -- one request after the other
      const answer = await call(base, token, `${pathname}?serverId=${GUILD}`, { method, body: { serverId: GUILD } });
      if (answer.status !== 403 || !REVOKED_MESSAGE.test(answer.error)) passed.push(`${method} ${pathname} -> ${answer.status}`);
    }
  }
  assert.deepEqual(passed, []);
  assert.equal(discord.calls.length, 1, "one question for all of them");
});

test("an open live stream ends once Discord says the right is gone", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const discord = fakeDiscord();
  const base = await startServer(t, [discord.runtime]);
  const { userId, token } = signIn(0);
  t.after(() => deleteDashboardAuthSession(token));
  discord.members.set(userId, 0n);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/dashboard/live?serverId=${GUILD}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  assert.equal(response.status, 200);
  t.mock.timers.tick(601_000);
  const reader = response.body.getReader();
  const ended = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8_000);
    (async () => {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- the stream comes piece by piece
        const { done } = await reader.read().catch(() => ({ done: true }));
        if (done) break;
      }
      clearTimeout(timer);
      resolve(true);
    })();
  });
  assert.equal(ended, true, "the stream was closed");
  assert.equal(discord.calls.length, 1);
});
