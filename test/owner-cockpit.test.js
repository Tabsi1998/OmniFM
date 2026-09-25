import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-cockpit-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const checks = await import("../src/services/owner-status/checks.js");
const { createOwnerStatusService } = await import("../src/services/owner-status/service.js");
const { createOwnerStatusRoutesHandler } = await import("../src/api/routes/owner-status-routes.js");
const cockpit = await import("../frontend/src/lib/ownerCockpit.js");

/** A fetch that answers by URL: { match: string|RegExp, status, json?, text?, headers? } or a thrown error. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const route = routes.find((entry) => (entry.match instanceof RegExp ? entry.match.test(url) : url.includes(entry.match)));
    if (!route) throw new Error(`no route for ${url}`);
    if (route.error) throw new Error(route.error);
    return {
      status: route.status,
      ok: route.status >= 200 && route.status < 300,
      headers: { get: (name) => route.headers?.[name.toLowerCase()] ?? null },
      json: async () => route.json ?? {},
      text: async () => route.text ?? "",
    };
  };
  impl.calls = calls;
  return impl;
}

const PUBLIC = { PUBLIC_WEB_URL: "https://omnifm.xyz" };

test("Discord login: the secret is tried at Discord, and this morning's localhost redirect turns red", async () => {
  assert.equal((await checks.checkDiscordLogin({ env: PUBLIC, fetchImpl: fakeFetch([]) })).state, "off");
  const env = { ...PUBLIC, DISCORD_CLIENT_ID: "1476192449721274472", DISCORD_CLIENT_SECRET: "secret" };
  const valid = fakeFetch([{ match: "oauth2/token", status: 200, json: { access_token: "x" } }]);
  const ok = await checks.checkDiscordLogin({ env, fetchImpl: valid });
  assert.equal(ok.state, "ok");
  assert.match(valid.calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(valid.calls[0].options.body, "grant_type=client_credentials&scope=identify");
  assert.equal((await checks.checkDiscordLogin({ env, fetchImpl: fakeFetch([{ match: "oauth2/token", status: 401 }]) })).state, "fail");
  assert.equal((await checks.checkDiscordLogin({ env, fetchImpl: fakeFetch([{ match: "oauth2/token", error: "ECONNRESET" }]) })).state, "warn");
  const leftovers = await checks.checkDiscordLogin({
    env: { DISCORD_CLIENT_ID: "1", DISCORD_CLIENT_SECRET: "s", PUBLIC_WEB_URL: "http://192.168.2.253:8001", DISCORD_REDIRECT_URI: "http://localhost:8081/api/auth/discord/callback" },
    fetchImpl: fakeFetch([{ match: "oauth2/token", status: 200 }]),
  });
  assert.equal(leftovers.state, "fail");
  assert.match(leftovers.summary, /localhost:8081/);
});

test("Stripe: no key is 'not set up', a refused key is red, a missing webhook is a warning", async () => {
  const none = await checks.checkStripe({ ownerConfig: {}, env: {}, fetchImpl: fakeFetch([]) });
  assert.equal(none.state, "off");
  assert.match(none.summary, /Premium kann nicht gekauft werden/);
  assert.equal((await checks.checkStripe({ ownerConfig: { payments: { stripe: { enabled: false, secretKey: "sk_live_x" } } }, env: {}, fetchImpl: fakeFetch([]) })).state, "off");
  const config = { payments: { stripe: { secretKey: "sk_live_x", webhookSecret: "whsec_x" } } };
  assert.equal((await checks.checkStripe({ ownerConfig: config, env: {}, fetchImpl: fakeFetch([{ match: "stripe.com", status: 401 }]) })).state, "fail");
  assert.equal((await checks.checkStripe({ ownerConfig: config, env: {}, fetchImpl: fakeFetch([{ match: "stripe.com", status: 200 }]) })).state, "ok");
  const noWebhook = await checks.checkStripe({ ownerConfig: {}, env: { STRIPE_SECRET_KEY: "sk_live_x" }, fetchImpl: fakeFetch([{ match: "stripe.com", status: 200 }]) });
  assert.equal(noWebhook.state, "warn");
  assert.match(noWebhook.summary, /Webhook-Secret fehlt/);
  const testMode = await checks.checkStripe({ ownerConfig: { payments: { stripe: { secretKey: "sk_test_x", webhookSecret: "w" } } }, env: {}, fetchImpl: fakeFetch([{ match: "stripe.com", status: 200 }]) });
  assert.match(testMode.summary, /Testmodus/);
});

test("SMTP logs in without sending; recognition and the alarm channel are tried for real", async () => {
  assert.equal((await checks.checkSmtp({ ownerConfig: {}, env: {}, createTransport: () => null })).state, "off");
  const good = await checks.checkSmtp({ ownerConfig: { system: { smtp: { host: "mail.example", port: 587, user: "u", password: "p" } } }, env: {}, createTransport: () => ({ verify: async () => true, close() {} }) });
  assert.equal(good.state, "ok");
  const bad = await checks.checkSmtp({ ownerConfig: {}, env: { SMTP_HOST: "mail.example" }, createTransport: () => ({ verify: async () => { throw new Error("535 auth failed"); } }) });
  assert.equal(bad.state, "fail");
  assert.equal(bad.detail, "535 auth failed");

  const on = { system: { audioRecognition: { enabled: true, apiKey: "k" } } };
  assert.equal((await checks.checkRecognition({ ownerConfig: {}, env: {}, fetchImpl: fakeFetch([]) })).state, "off");
  assert.equal((await checks.checkRecognition({ ownerConfig: on, env: {}, fetchImpl: fakeFetch([{ match: "acoustid", status: 200, json: { status: "ok", results: [] } }]) })).state, "ok");
  assert.equal((await checks.checkRecognition({ ownerConfig: on, env: {}, fetchImpl: fakeFetch([{ match: "acoustid", status: 400, json: { status: "error", error: { code: 4, message: "invalid API key" } } }]) })).state, "fail");

  assert.equal((await checks.checkOperatorWebhook({ env: {}, fetchImpl: fakeFetch([]) })).state, "off");
  const hook = { OPERATOR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" };
  assert.equal((await checks.checkOperatorWebhook({ env: hook, fetchImpl: fakeFetch([{ match: "webhooks", status: 404 }]) })).state, "fail");
  const reachable = fakeFetch([{ match: "webhooks", status: 200 }]);
  assert.equal((await checks.checkOperatorWebhook({ env: hook, fetchImpl: reachable })).state, "ok");
  assert.equal(reachable.calls[0].options.method, undefined, "only a GET, nothing is posted");
});

test("the website from outside: login link, redirect URI and share links", async () => {
  const good = fakeFetch([
    { match: "/api/auth/discord/login", status: 302, headers: { location: "https://discord.com/api/oauth2/authorize?redirect_uri=https%3A%2F%2Fomnifm.xyz%2Fapi%2Fauth%2Fdiscord%2Fcallback" } },
    { match: "/api/share/page/premium", status: 200, text: '<meta property="og:url" content="https://omnifm.xyz/api/share/page/premium">' },
  ]);
  assert.equal((await checks.checkWebsite({ env: PUBLIC, fetchImpl: good })).state, "ok");
  assert.equal(good.calls[0].options.redirect, "manual");

  const json = await checks.checkWebsite({ env: PUBLIC, fetchImpl: fakeFetch([
    { match: "/api/auth/discord/login", status: 200 },
    { match: "/api/share/page/premium", status: 200, text: '<meta property="og:url" content="http://192.168.2.253:8001/api/share/page/premium">' },
  ]) });
  assert.equal(json.state, "fail");
  assert.match(json.summary, /Login-Link: HTTP 200[\s\S]*Share-Links zeigen auf http:\/\/192\.168\.2\.253:8001/);

  const unreachable = await checks.checkWebsite({ env: PUBLIC, fetchImpl: fakeFetch([{ match: "omnifm.xyz", error: "ENOTFOUND" }]) });
  assert.equal(unreachable.state, "warn", "the server not reaching itself is no proof the site is down");
});

test("bots, bot lists, stations and the version", async () => {
  const commander = {
    role: "commander",
    config: { name: "OmniFM" },
    client: { isReady: () => true, guilds: { cache: { size: 12 } }, ws: { ping: 42 } },
    workerManager: { getAllStatuses: () => [{ name: "OmniFM 1", online: true, totalGuilds: 10, activeStreams: 3 }, { name: "OmniFM 2", online: false }] },
  };
  const bots = await checks.checkBots({ runtimes: [commander] });
  assert.equal(bots.state, "fail");
  assert.match(bots.summary, /1 von 3 Bots offline: OmniFM 2/);
  commander.workerManager.getAllStatuses = () => [{ name: "OmniFM 1", online: true, totalGuilds: 10, activeStreams: 3 }];
  assert.match((await checks.checkBots({ runtimes: [commander] })).summary, /Alle 2 Bots online · 3 Streams/);

  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal((await checks.checkBotLists({ lists: [{ name: "Top.gg", enabled: false }] })).state, "off");
  assert.equal((await checks.checkBotLists({ now, lists: [{ name: "Top.gg", enabled: true, lastStatsSync: { at: "2026-09-25T11:30:00Z", ok: true } }] })).state, "ok");
  assert.equal((await checks.checkBotLists({ now, lists: [{ name: "Top.gg", enabled: true, lastStatsSync: { at: "2026-09-25T11:30:00Z", ok: false, error: "401" } }] })).state, "fail");
  assert.equal((await checks.checkBotLists({ now, lists: [{ name: "Top.gg", enabled: true, lastStatsSync: { at: "2026-09-25T02:00:00Z", ok: true } }] })).state, "warn");

  assert.equal((await checks.checkStations({ report: [] })).state, "off");
  const stations = await checks.checkStations({ report: [
    { key: "a", name: "Lounge", status: "up", consecutiveFailures: 0 },
    { key: "b", name: "Techno", status: "down", consecutiveFailures: 3, error: "HTTP 404" },
  ] });
  assert.equal(stations.state, "warn");
  assert.match(stations.summary, /1 von 2 Sendern ausgefallen: Techno/);

  assert.equal(checks.isOlderVersion("3.2.0", "v3.10.0"), true);
  assert.equal(checks.isOlderVersion("3.3.0", "v3.3.0"), false);
  const outdated = await checks.checkVersion({ runningVersion: "3.2.0", fetchImpl: fakeFetch([{ match: "releases/latest", status: 200, json: { tag_name: "v3.3.0" } }]) });
  assert.equal(outdated.state, "warn");
  assert.match(outdated.summary, /Update auf 3\.3\.0 verfügbar/);
  assert.equal((await checks.checkVersion({ runningVersion: "3.3.0", fetchImpl: fakeFetch([{ match: "releases/latest", status: 200, json: { tag_name: "v3.3.0" } }]) })).state, "ok");
});

test("the service: every 5 minutes on its own, one alarm when something turns red and one when it is fine again", async () => {
  let stripeState = "ok";
  const alarms = [];
  let clock = Date.parse("2026-09-25T12:00:00Z");
  const service = createOwnerStatusService({
    checks: {
      stripe: async () => ({ key: "stripe", state: stripeState, summary: `Stripe ${stripeState}` }),
      mongo: async () => { throw new Error("boom"); },
    },
    getOwnerConfig: async () => ({}),
    notify: async (key, embed) => { alarms.push({ key, title: embed.title }); },
    now: () => clock,
  });
  await service.run();
  stripeState = "fail";
  clock += 300_000;
  await service.run();
  clock += 300_000;
  await service.run();
  assert.deepEqual(alarms.map((alarm) => alarm.title), ["🔴 Zahlungen (Stripe) funktioniert nicht"], "red once, not every run");
  stripeState = "ok";
  await service.run();
  assert.equal(alarms.at(-1).title, "🟢 Zahlungen (Stripe) wieder in Ordnung");

  const snapshot = service.snapshot();
  const stripe = snapshot.checks.find((entry) => entry.key === "stripe");
  assert.deepEqual(stripe.history.map((entry) => entry.state), ["ok", "fail", "fail", "ok"]);
  assert.equal(stripe.area, "payments", "the tile leads to the one place to fix it");
  assert.equal(snapshot.checks.find((entry) => entry.key === "mongo").state, "warn", "a crashing check does not take the others down");
  assert.equal(snapshot.checks.find((entry) => entry.key === "bots").state, "pending");

  stripeState = "warn";
  await service.run({ only: ["mongo"] });
  assert.equal(service.snapshot().checks.find((entry) => entry.key === "stripe").state, "ok", "only the asked check runs");
});

test("the cockpit route needs the owner token", async () => {
  const sent = [];
  const service = { snapshot: () => ({ checks: [] }), run: async ({ only }) => ({ checks: [], only }) };
  const handler = createOwnerStatusRoutesHandler({ getService: () => service, isOwner: (req) => req.headers["x-admin-token"] === "owner" });
  const call = async (method, pathname, headers = {}, body = {}) => {
    const res = { writeHead(status) { this.status = status; }, setHeader() {}, end(payload) { this.body = payload ? JSON.parse(payload) : null; } };
    await handler({ req: { method, headers }, res, requestUrl: new URL(`https://omnifm.xyz${pathname}`), readJsonBody: async () => body });
    sent.push(res);
    return res;
  };
  assert.equal((await call("GET", "/api/owner/status")).status, 401);
  assert.equal((await call("GET", "/api/owner/status", { "x-admin-token": "owner" })).status, 200);
  assert.deepEqual((await call("POST", "/api/owner/status/check", { "x-admin-token": "owner" }, { key: "stripe" })).body.only, ["stripe"]);
  assert.equal((await call("POST", "/api/owner/status/check", { "x-admin-token": "owner" }, { key: "rm -rf" })).body.only, null, "unknown keys check everything");
});

test("the page: red first, a headline in words, the strip keeps the last hours", () => {
  const list = [
    { key: "bots", state: "ok" },
    { key: "smtp", state: "off" },
    { key: "stripe", state: "fail" },
    { key: "website", state: "warn" },
  ];
  assert.deepEqual(cockpit.sortCockpitChecks(list).map((entry) => entry.key), ["stripe", "website", "smtp", "bots"]);
  assert.deepEqual(cockpit.cockpitHeadline(list), { state: "fail", text: "1 Dienst funktioniert nicht." });
  assert.equal(cockpit.cockpitHeadline([{ state: "ok" }, { state: "off" }]).text, "Alles läuft. 1 Dienst ist nicht eingerichtet.");
  assert.equal(cockpit.historyCells(Array.from({ length: 50 }, (_, index) => ({ state: "ok", at: new Date(index * 300_000).toISOString() }))).length, 36);
  for (const state of ["ok", "warn", "off", "fail", "pending"]) {
    const meta = cockpit.stateMeta(state);
    assert.ok(meta.icon && meta.label, `${state} has an icon and a word, never colour alone`);
  }
});
