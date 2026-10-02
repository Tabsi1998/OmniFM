import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { botTranslator } from "../src/lib/bot-i18n.js";

// Linked roles (#302): Discord knows two values per connected person, the
// listening hours (counted only with the switch in /mydata) and whether the
// person owns a server with Pro or Ultimate; the tokens are kept encrypted;
// the support server's premium role follows. The stored parts skip without
// MONGO_URL.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-linked-roles-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.DB_NAME = `omnifm_linked_roles_${process.pid}_${Date.now()}`;
const KEY_HEX = randomBytes(32).toString("hex");
process.env.OMNIFM_TOKEN_KEY = KEY_HEX;
process.env.DISCORD_CLIENT_ID = "100000000000000001";
process.env.DISCORD_CLIENT_SECRET = "test-secret";
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const crypto = await import("../src/lib/token-crypto.js");
const roles = await import("../src/lib/linked-roles.js");
const { createLinkedRolesRoutes } = await import("../src/api/routes/linked-roles-routes.js");
const { linkedRolesStatus } = await import("../src/api/routes/admin-linked-roles-routes.js");
const service = await import("../src/services/linked-roles.js");
const { listeningHourMethods } = await import("../src/bot/runtime-methods/listening-hours.js");
const panel = await import("../src/bot/personal-data-panel.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");

const PERSON = "200000000000000001";
const OTHER = "200000000000000002";
const BOT_USER = "200000000000000003";
const DEAF = "200000000000000004";
const GUILD = "300000000000000001";
const CHANNEL = "400000000000000001";

after(async () => {
  if (hasMongoConfig) {
    const { getDb, isConnected, close } = await import("../src/lib/db.js");
    if (isConnected()) await getDb().dropDatabase().catch(() => null);
    await close().catch(() => null);
  }
  fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 });
});

/** A fetch that answers Discord's endpoints from a table and remembers the calls. */
function fakeDiscord(answers) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const key = `${options.method || "GET"} ${String(url).replace("https://discord.com/api/v10", "")}`;
    calls.push({ key, options });
    const answer = answers[key];
    if (!answer) return { ok: false, status: 404, json: async () => ({}) };
    const value = typeof answer === "function" ? answer(options) : answer;
    return { ok: value.status ? value.status < 400 : true, status: value.status || 200, json: async () => value.body || {} };
  };
  return { calls, fetchImpl };
}

// ---- the pure part ----

test("the tokens: encrypted with the key from the environment, opened only with it", () => {
  const key = crypto.tokenKeyFrom({ OMNIFM_TOKEN_KEY: KEY_HEX });
  assert.equal(key.length, 32);
  assert.equal(crypto.tokenKeyFrom({ OMNIFM_TOKEN_KEY: randomBytes(32).toString("base64") }).length, 32, "base64 works too");
  assert.equal(crypto.tokenKeyFrom({ OMNIFM_TOKEN_KEY: "short" }), null);
  assert.equal(crypto.tokenKeyFrom({}), null);
  assert.equal(crypto.tokenCryptoAvailable({}), false);

  const sealed = crypto.encryptToken("discord-access-token", key);
  assert.match(sealed, /^v1:[\w-]+:[\w-]+:[\w-]+$/);
  assert.ok(!sealed.includes("discord-access-token"));
  assert.notEqual(crypto.encryptToken("discord-access-token", key), sealed, "a new nonce every time");
  assert.equal(crypto.decryptToken(sealed, key), "discord-access-token");
  assert.equal(crypto.decryptToken(sealed, randomBytes(32)), null, "another key opens nothing");
  const [version, iv, tag, data] = sealed.split(":");
  const flipped = `${data.slice(0, -2)}${data.endsWith("A") ? "B" : "A"}${data.slice(-1)}`;
  assert.equal(crypto.decryptToken([version, iv, tag, flipped].join(":"), key), null, "a changed token is refused");
  const shortTag = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
  assert.equal(crypto.decryptToken([version, iv, shortTag, data].join(":"), key), null, "a shortened tag is refused");
  assert.equal(crypto.decryptToken("plain-text", key), null);
  assert.throws(() => crypto.encryptToken("x", null), /OMNIFM_TOKEN_KEY/);
});

test("the values Discord gets: hours only with the switch, premium as 1 or 0", () => {
  assert.deepEqual(roles.roleConnectionFor({ listenedMs: 52.9 * 3_600_000, counting: true, premium: true }), {
    platform_name: "OmniFM",
    metadata: { listening_hours: "52", premium_customer: "1" },
  });
  assert.deepEqual(roles.roleConnectionFor({ listenedMs: 52 * 3_600_000, counting: false }).metadata, { listening_hours: "0", premium_customer: "0" });
  assert.equal(roles.listeningHours(-5), 0);
  assert.equal(roles.roleConnectionFor().platform_name, "OmniFM");
});

test("the two records follow Discord's rules for role connection metadata", () => {
  assert.ok(roles.ROLE_CONNECTION_METADATA.length <= 5);
  for (const record of roles.ROLE_CONNECTION_METADATA) {
    assert.match(record.key, /^[a-z0-9_]{1,50}$/);
    assert.ok([2, 7].includes(record.type));
    assert.ok(record.name.length <= 100 && record.description.length <= 200, record.key);
    for (const [locale, text] of Object.entries({ ...record.name_localizations, ...record.description_localizations })) {
      assert.ok(text.length >= 1 && text.length <= 200, `${record.key} ${locale}`);
    }
    for (const locale of ["de", "fr", "es-ES", "es-419", "it", "pl", "tr", "pt-BR", "nl"]) {
      assert.ok(record.name_localizations[locale] && record.description_localizations[locale], `${record.key} ${locale}`);
    }
  }
});

test("premium customers: the owners of servers with Pro or Ultimate", () => {
  const guilds = [
    { id: "1", ownerId: PERSON },
    { id: "2", ownerId: OTHER },
    { id: "3", ownerId: OTHER },
    { id: "4", ownerId: null },
  ];
  const tiers = { 1: "ultimate", 2: "free", 3: "pro", 4: "pro" };
  assert.deepEqual([...roles.premiumCustomerIds(guilds, (id) => tiers[id])].sort(), [PERSON, OTHER]);
  assert.deepEqual([...roles.premiumCustomerIds(guilds, () => "free")], []);
  assert.equal(roles.tokenNeedsRefresh(Date.now() + 23 * 3_600_000), true);
  assert.equal(roles.tokenNeedsRefresh(new Date(Date.now() + 3 * 24 * 3_600_000)), false);
  assert.deepEqual(roles.normalizeLinkedRolesSettings({ supportGuildId: " 123456789012345678 ", premiumRoleId: "x" }), { supportGuildId: "123456789012345678", premiumRoleId: "" });
  const url = new URL(roles.linkedRolesAuthorizeUrl({ clientId: "1", redirectUri: "https://omnifm.xyz/api/auth/linked-roles/callback", state: "s" }));
  assert.equal(url.searchParams.get("scope"), "role_connections.write identify");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(roles.linkedRolesRedirectUri("https://omnifm.xyz/"), "https://omnifm.xyz/api/auth/linked-roles/callback");
});

// ---- counting, only with consent ----

function commanderWith(members) {
  const runtime = { ...listeningHourMethods };
  const channel = { isVoiceBased: () => true, members: new Map(members.map((member) => [member.id, member])) };
  runtime.client = { guilds: { cache: new Map([[GUILD, { channels: { cache: new Map([[CHANNEL, channel]]) } }]]) } };
  runtime.listeningConsents = null;
  runtime.listeningConsentsAt = 0;
  runtime.listeningCountedAt = 0;
  return runtime;
}

const listener = (id, extra = {}) => ({ id, user: { bot: false }, voice: { deaf: false }, ...extra });

test("who listens: people in the channel, not bots, not deafened", () => {
  const runtime = commanderWith([listener(PERSON), listener(BOT_USER, { user: { bot: true } }), listener(DEAF, { voice: { deaf: true } }), listener(OTHER)]);
  assert.deepEqual(runtime.listeningUserIds(GUILD, CHANNEL), [PERSON, OTHER]);
  assert.deepEqual(runtime.listeningUserIds(GUILD, "999"), []);
});

test("without the switch in /mydata nothing about a person is counted (acceptance)", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const hours = await import("../src/listening-hours-store.js");
  await getDb().collection(hours.LISTENING_HOURS_COLLECTION).deleteMany({});
  assert.deepEqual(await hours.setListeningConsent(PERSON, true), { ok: true, counting: true });

  const runtime = commanderWith([listener(PERSON), listener(OTHER), listener(DEAF, { voice: { deaf: true } })]);
  const channels = new Map([[GUILD, [CHANNEL]]]);
  assert.equal(await runtime.countListeningTime(channels, { now: 1_000_000 }), 0, "the first sample only sets the clock");
  assert.equal(await runtime.countListeningTime(channels, { now: 1_030_000 }), 1);
  assert.equal(await runtime.countListeningTime(channels, { now: 1_060_000 }), 1);
  assert.equal((await hours.getListeningHours(PERSON)).listenedMs, 60_000);
  const strangers = await getDb().collection(hours.LISTENING_HOURS_COLLECTION).find({ _id: { $in: [OTHER, DEAF] } }).toArray();
  assert.deepEqual(strangers, [], "nobody without the switch has a document at all");
  assert.equal(await runtime.countListeningTime(channels, { now: 1_060_000 + 10 * 60_000 }), 1);
  assert.equal((await hours.getListeningHours(PERSON)).listenedMs, 120_000, "a gap counts at most two samples");

  // Switching off deletes the hours; a count from a process that still had the old list adds nothing.
  assert.deepEqual(await hours.setListeningConsent(PERSON, false), { ok: true, counting: false });
  assert.equal(await hours.addListeningTime(new Map([[PERSON, 30_000]])), 0);
  assert.equal(await getDb().collection(hours.LISTENING_HOURS_COLLECTION).countDocuments({}), 0);
  runtime.noteListeningConsent(PERSON, false);
  assert.equal(runtime.listeningConsents.has(PERSON), false);
});

// ---- the sign-in ----

function routeWith(overrides = {}) {
  const saved = [];
  const synced = [];
  const discord = fakeDiscord({
    "POST /oauth2/token": { body: { access_token: "access-1", refresh_token: "refresh-1", expires_in: 604800, scope: "role_connections.write identify" } },
    "GET /users/@me": { body: { id: PERSON } },
  });
  const handle = createLinkedRolesRoutes({
    fetchImpl: discord.fetchImpl,
    now: () => 1_000_000,
    ready: () => true,
    credentials: () => ({ clientId: "100000000000000001", clientSecret: "test-secret" }),
    origin: () => "https://omnifm.xyz",
    save: async (userId, tokens) => { saved.push([userId, tokens]); return { ok: true }; },
    sync: async (userId, options) => { synced.push([userId, options]); return { ok: true, sent: true, metadata: { listening_hours: "12", premium_customer: "1" } }; },
    ...overrides,
  });
  const call = async (pathname, { headers = {}, runtimes = [] } = {}) => {
    const res = { status: 0, headers: {}, body: "", writeHead(status, head = {}) { this.status = status; Object.assign(this.headers, head); }, setHeader() {}, end(text) { this.body = String(text || ""); } };
    const handled = await handle({ req: { method: "GET", headers }, res, requestUrl: new URL(`https://omnifm.xyz${pathname}`), runtimes });
    return { handled, ...res };
  };
  return { call, saved, synced, discord };
}

test("the verification URL sends the browser to Discord, with a state tied to a cookie", async () => {
  const { call } = routeWith();
  assert.equal((await call("/api/auth/other")).handled, false);
  const start = await call("/api/auth/linked-roles");
  assert.equal(start.status, 302);
  const location = new URL(start.headers.Location);
  assert.equal(location.origin + location.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(location.searchParams.get("redirect_uri"), "https://omnifm.xyz/api/auth/linked-roles/callback");
  const state = location.searchParams.get("state");
  assert.match(start.headers["Set-Cookie"], new RegExp(`^omnifm_linked_roles=${state}; Path=/api/auth/linked-roles; Max-Age=600; HttpOnly; SameSite=Lax; Secure$`));

  const notReady = await routeWith({ ready: () => false }).call("/api/auth/linked-roles");
  assert.equal(notReady.status, 503);
  assert.match(notReady.body, /Not set up yet/);
});

test("back from Discord: tokens kept, values sent, a page that says so; a wrong state is refused", async () => {
  const { call, saved, synced } = routeWith();
  const start = await call("/api/auth/linked-roles");
  const state = new URL(start.headers.Location).searchParams.get("state");
  const PREMIUM_GUILD = "300000000000000009";
  setLicenseProvider((serverId) => (String(serverId) === PREMIUM_GUILD ? { plan: "ultimate", active: true, seats: 1 } : null));
  const commander = { role: "commander", client: { guilds: { cache: new Map([[PREMIUM_GUILD, { id: PREMIUM_GUILD, ownerId: PERSON }]]) } } };

  const stolen = await call(`/api/auth/linked-roles/callback?code=abc&state=${state}`, { headers: { cookie: "omnifm_linked_roles=other" } });
  assert.equal(stolen.status, 400, "the state belongs to another browser");
  assert.equal(saved.length, 0);

  const again = await call("/api/auth/linked-roles");
  const fresh = new URL(again.headers.Location).searchParams.get("state");
  const done = await call(`/api/auth/linked-roles/callback?code=abc&state=${fresh}`, {
    headers: { cookie: `x=1; omnifm_linked_roles=${fresh}`, "accept-language": "de-AT,de;q=0.9" },
    runtimes: [commander],
  });
  assert.equal(done.status, 200);
  assert.match(done.body, /Verbunden/);
  assert.match(done.body, /12 Hörstunden, Premium-Kunde: ja/);
  assert.match(done.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.equal(saved[0][0], PERSON);
  assert.equal(saved[0][1].refreshToken, "refresh-1");
  assert.equal(synced[0][0], PERSON);
  assert.equal(synced[0][1].force, true);
  assert.deepEqual([...synced[0][1].premiumIds], [PERSON], "premium from the commander's servers");

  const reused = await call(`/api/auth/linked-roles/callback?code=abc&state=${fresh}`, { headers: { cookie: `omnifm_linked_roles=${fresh}` } });
  assert.equal(reused.status, 400, "a state works once");
});

// ---- Discord, stored ----

test("stored: tokens only encrypted; a day's values go once, a refresh before they run out; three failures end it", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const store = await import("../src/linked-roles-store.js");
  const hours = await import("../src/listening-hours-store.js");
  const now = new Date("2026-10-02T12:00:00Z");
  await store.saveLinkedRoleTokens(PERSON, { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: new Date(now.getTime() + 5 * 86_400_000) }, { now });
  const raw = await getDb().collection(store.LINKED_ROLES_COLLECTION).findOne({ _id: PERSON });
  assert.ok(!JSON.stringify(raw).includes("access-1") && !JSON.stringify(raw).includes("refresh-1"), "no token in plain text");
  assert.equal((await store.getLinkedRoleTokens(PERSON)).accessToken, "access-1");
  assert.equal(await store.getLinkedRoleTokens(PERSON, { key: randomBytes(32) }), null);

  await hours.setListeningConsent(PERSON, true, { now });
  await hours.addListeningTime(new Map([[PERSON, 3 * 3_600_000 + 5]]));
  const discord = fakeDiscord({ [`PUT /users/@me/applications/100000000000000001/role-connection`]: { status: 200 } });
  const premiumIds = new Set([PERSON]);
  const first = await service.syncLinkedRoleUser(PERSON, { premiumIds, fetchImpl: discord.fetchImpl, now });
  assert.deepEqual(first, { ok: true, sent: true, metadata: { listening_hours: "3", premium_customer: "1" } });
  assert.equal(discord.calls[0].options.headers.Authorization, "Bearer access-1");
  assert.deepEqual(JSON.parse(discord.calls[0].options.body), { platform_name: "OmniFM", metadata: { listening_hours: "3", premium_customer: "1" } });
  assert.equal((await service.syncLinkedRoleUser(PERSON, { premiumIds, fetchImpl: discord.fetchImpl, now: new Date(now.getTime() + 3_600_000) })).sent, false, "unchanged within a day");
  assert.equal((await service.syncLinkedRoleUser(PERSON, { premiumIds: new Set(), fetchImpl: discord.fetchImpl, now: new Date(now.getTime() + 3_600_000) })).sent, true, "a change goes at once");

  const later = new Date(now.getTime() + 4.5 * 86_400_000);
  const refreshing = fakeDiscord({
    "POST /oauth2/token": { body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 604800 } },
    [`PUT /users/@me/applications/100000000000000001/role-connection`]: { status: 200 },
  });
  assert.equal((await service.syncLinkedRoleUser(PERSON, { premiumIds, fetchImpl: refreshing.fetchImpl, now: later })).ok, true);
  assert.match(String(refreshing.calls[0].options.body), /grant_type=refresh_token&refresh_token=refresh-1/);
  assert.equal(refreshing.calls[1].options.headers.Authorization, "Bearer access-2");
  assert.equal((await store.getLinkedRoleTokens(PERSON)).refreshToken, "refresh-2");

  const revoked = fakeDiscord({ [`PUT /users/@me/applications/100000000000000001/role-connection`]: { status: 401 } });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- one after the other
    const result = await service.syncLinkedRoleUser(PERSON, { premiumIds, fetchImpl: revoked.fetchImpl, now: later, force: true });
    assert.equal(result.error, attempt < 3 ? "role_connection_failed:401" : "ended");
  }
  assert.equal(await store.getLinkedRoleInfo(PERSON), null, "the connection ended after three failures");

  // A new key opens none of the stored tokens: the connection ends at the next round.
  await store.saveLinkedRoleTokens(PERSON, { accessToken: "a", refreshToken: "r", expiresAt: later }, { key: randomBytes(32) });
  assert.deepEqual(await service.syncLinkedRoleUser(PERSON, { premiumIds, fetchImpl: revoked.fetchImpl, now: later }), { ok: false, error: "ended" });
  assert.equal(await store.getLinkedRoleInfo(PERSON), null);
  assert.deepEqual(await service.syncLinkedRoleUser(PERSON, { premiumIds, fetchImpl: revoked.fetchImpl, now: later }), { ok: false, error: "not-linked" });
  await hours.setListeningConsent(PERSON, false);
});

test("the support server: premium customers get the role, former ones lose it, others keep theirs", { skip: !hasMongoConfig }, async () => {
  const { connect } = await import("../src/lib/db.js");
  await connect();
  const ROLE = "500000000000000001";
  const memberOf = (id, roleIds) => {
    const has = new Set(roleIds);
    return {
      id,
      roles: {
        cache: { has: (roleId) => has.has(roleId) },
        add: async (roleId) => { has.add(roleId); },
        remove: async (roleId) => { has.delete(roleId); },
      },
      has,
    };
  };
  const members = new Map([[PERSON, memberOf(PERSON, [])], [OTHER, memberOf(OTHER, [ROLE])]]);
  const guild = {
    roles: { cache: new Map([[ROLE, { id: ROLE }]]) },
    members: { fetch: async (id) => { if (!members.has(id)) throw new Error("Unknown Member"); return members.get(id); } },
  };
  const commander = { client: { guilds: { cache: new Map([[GUILD, guild]]) } } };
  const settings = { supportGuildId: GUILD, premiumRoleId: ROLE };

  assert.deepEqual(await service.syncSupportPremiumRoles(commander, { premiumIds: new Set([PERSON, "200000000000000099"]), settings }), { added: 1, removed: 0, skipped: null });
  assert.equal(members.get(PERSON).has.has(ROLE), true);
  assert.equal(members.get(OTHER).has.has(ROLE), true, "a role OmniFM did not give stays");
  assert.deepEqual(await service.syncSupportPremiumRoles(commander, { premiumIds: new Set(), settings }), { added: 0, removed: 1, skipped: null });
  assert.equal(members.get(PERSON).has.has(ROLE), false);
  assert.equal(members.get(OTHER).has.has(ROLE), true);
  assert.equal((await service.syncSupportPremiumRoles(commander, { premiumIds: new Set(), settings: {} })).skipped, "not-configured");
  assert.equal((await service.syncSupportPremiumRoles(commander, { premiumIds: new Set(), settings: { ...settings, premiumRoleId: "500000000000000009" } })).skipped, "no-role");
});

// ---- /mydata and the owner console ----

test("/mydata: the switch for the hours, and what the hours show", () => {
  const t = botTranslator("de");
  const counts = { savedSongs: 0, votes: 0, dashboardLogins: 0, ownerConsoleLogins: 0, pollsStarted: 0, eventsCreated: 0, dashboardChanges: 0, linkedRoles: 1 };
  const buttonsOf = (payload) => payload.components.flatMap((component) => component.toJSON().components)
    .filter((block) => block.type === 1)
    .flatMap((row) => row.components);
  const off = panel.buildPersonalDataPayload({ t, counts });
  assert.ok(buttonsOf(off).some((button) => button.custom_id === panel.personalDataCustomId("hourson")));
  assert.match(JSON.stringify(off), /Hörstunden: \*\*aus\*\*/);
  assert.match(JSON.stringify(off), /Verknüpfte Rollen in Discord: \*\*verbunden\*\*/);
  const on = panel.buildPersonalDataPayload({ t, counts, listening: { counting: true, hours: 7 } });
  assert.ok(buttonsOf(on).some((button) => button.custom_id === panel.personalDataCustomId("hoursoff")));
  assert.match(JSON.stringify(on), /Hörstunden: \*\*7\*\* Std\./);
  assert.equal(panel.parsePersonalDataCustomId(panel.personalDataCustomId("hourson")), "hourson");
});

test("the owner console: what is set up and the two addresses for Discord's portal", async () => {
  const env = { DISCORD_CLIENT_ID: "100000000000000001", DISCORD_CLIENT_SECRET: "s", OMNIFM_TOKEN_KEY: KEY_HEX, PUBLIC_WEB_URL: "https://omnifm.xyz", COMMANDER_BOT_INDEX: "1", BOT_1_CLIENT_ID: "100000000000000001" };
  const ready = await linkedRolesStatus({ env, raw: { linkedRoles: { supportGuildId: GUILD, premiumRoleId: "nope" } }, counts: { linked: 3, counting: 2 } });
  assert.equal(ready.ready, true);
  assert.equal(ready.verificationUrl, "https://omnifm.xyz/api/auth/linked-roles");
  assert.equal(ready.redirectUri, "https://omnifm.xyz/api/auth/linked-roles/callback");
  assert.deepEqual(ready.supportRole, { configured: false, supportGuildId: GUILD, premiumRoleId: "" });
  assert.equal(ready.linked, 3);
  const otherApp = await linkedRolesStatus({ env: { ...env, BOT_1_CLIENT_ID: "100000000000000002" }, raw: {}, counts: { linked: 0, counting: 0 } });
  assert.equal(otherApp.checks.commanderApp, false);
  assert.equal(otherApp.ready, false);
  const fromConsole = await linkedRolesStatus({ env: { ...env, BOT_1_CLIENT_ID: "" }, raw: { discord: { commander: { clientId: "100000000000000001" } } }, counts: { linked: 0, counting: 0 } });
  assert.equal(fromConsole.checks.commanderApp, true, "the console's commander counts first");
  const noKey = await linkedRolesStatus({ env: { ...env, OMNIFM_TOKEN_KEY: "" }, raw: {}, counts: { linked: 0, counting: 0 } });
  assert.equal(noKey.checks.tokenKey, false);
});
