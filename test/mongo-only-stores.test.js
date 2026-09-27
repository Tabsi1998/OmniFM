import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #292 wave 1: production keeps its data in MongoDB only. The stores are
// loaded after the environment is set, as a production process would.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-mongo-only-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const { fileStoresAllowed, isProductionRuntime } = await import("../src/lib/store-policy.js");

// The MongoDB connection and the store timers must not keep the test process alive.
after(async () => {
  const { close } = await import("../src/lib/db.js");
  await close().catch(() => null);
  const { stopCouponStore } = await import("../src/coupon-store.js");
  await stopCouponStore().catch(() => null);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
});

test("file stores: everywhere but production, there only on request", () => {
  assert.equal(fileStoresAllowed({}), true);
  assert.equal(fileStoresAllowed({ NODE_ENV: "development" }), true);
  assert.equal(fileStoresAllowed({ NODE_ENV: "production" }), false);
  assert.equal(fileStoresAllowed({ NODE_ENV: "Production", OMNIFM_ALLOW_FILE_STORES: "1" }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);
});

test("coupons live in MongoDB, one document each; no process overwrites another's", { skip: !hasMongoConfig }, async (t) => {
  // An offer left in coupons.json from before is copied once.
  fs.writeFileSync(path.join(dataDir, "coupons.json"), JSON.stringify({
    offers: { FILE292: { code: "FILE292", kind: "coupon", percentOff: 10, active: true } },
    redemptions: {},
  }));
  const before = fs.readFileSync(path.join(dataDir, "coupons.json"), "utf8");
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const offers = getDb().collection("coupon_offers");
  const redemptions = getDb().collection("coupon_redemptions");
  const cleanup = async () => {
    await offers.deleteMany({ _code: { $in: ["FILE292", "MONGO292"] } });
    await redemptions.deleteMany({ _sessionId: { $in: ["cs_mine_292", "cs_other_292"] } });
  };
  await cleanup();
  const coupons = await import("../src/coupon-store.js");
  t.after(async () => {
    await coupons.stopCouponStore();
    await cleanup();
    process.env.NODE_ENV = previousEnv;
  });

  assert.equal((await coupons.initCouponStore({ refreshMs: 60_000 })).backend, "mongo");
  assert.ok(await offers.findOne({ _code: "FILE292" }), "the file's offer was copied");

  coupons.upsertOffer({ code: "MONGO292", kind: "coupon", percentOff: 20, active: true });
  // The other process: a redemption this one's cache does not know yet.
  await redemptions.insertOne({ _sessionId: "cs_other_292", sessionId: "cs_other_292", code: "MONGO292", processedAt: new Date().toISOString() });
  coupons.markOfferRedemption("cs_mine_292", { code: "MONGO292", email: "a@example.test", tier: "pro", seats: 1, months: 1 });
  await coupons.stopCouponStore();

  assert.equal((await offers.findOne({ _code: "MONGO292" }))?.percentOff, 20);
  assert.ok(await redemptions.findOne({ _sessionId: "cs_mine_292" }), "this process's redemption is in MongoDB");
  assert.ok(await redemptions.findOne({ _sessionId: "cs_other_292" }), "the other process's redemption survived the save");
  assert.equal(fs.readFileSync(path.join(dataDir, "coupons.json"), "utf8"), before, "no coupons.json write in production");
});

test("premium in production: MongoDB only, no premium.json", { skip: !hasMongoConfig }, async (t) => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => { process.env.NODE_ENV = previousEnv; });
  const { connect } = await import("../src/lib/db.js");
  await connect();
  const premium = await import("../src/premium-store.js");
  await premium.initPremiumStore();
  premium.createLicense({ plan: "pro", seats: 1, months: 1, activatedBy: "test-292", note: "#292 wave 1", contactEmail: "p292@example.test" });
  await premium.flushPremiumStoreWrites();
  assert.equal(fs.existsSync(path.join(dataDir, "premium.json")), false, "no premium.json in production");
});

test("bot list states: webhook and sync loop write their own fields, neither is lost", { skip: !hasMongoConfig }, async (t) => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const state = getDb().collection("provider_state");
  await state.deleteOne({ _id: "topgg" });
  const topgg = await import("../src/topgg-store.js");
  t.after(async () => {
    await topgg.stopTopGGStore();
    await state.deleteOne({ _id: "topgg" });
    process.env.NODE_ENV = previousEnv;
  });
  await topgg.initTopGGStore({ refreshMs: 60_000 });
  // The public entry's webhook set its field; this process has not refreshed yet.
  await state.updateOne({ _id: "topgg" }, { $set: { lastWebhookVoteAt: "2026-09-27T10:00:00.000Z" } }, { upsert: true });
  topgg.setTopGGSyncStatus("stats", { ok: true, source: "test-292" });
  await topgg.stopTopGGStore();
  const doc = await state.findOne({ _id: "topgg" });
  assert.equal(doc.lastWebhookVoteAt, "2026-09-27T10:00:00.000Z", "the webhook's field survived the sync loop's save");
  assert.equal(doc.lastStatsSync?.source, "test-292");
  assert.equal(fs.existsSync(path.join(dataDir, "topgg.json")), false, "no topgg.json in production");
});

test("votes: one document each, a vote seen by two processes counts once", { skip: !hasMongoConfig }, async (t) => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const events = getDb().collection("vote_events");
  const counters = getDb().collection("vote_counters");
  const clean = async () => {
    await events.deleteMany({ _key: /^topgg:test292-/ });
    await counters.deleteOne({ _id: "topgg" });
  };
  await clean();
  const votes = await import("../src/vote-events-store.js");
  t.after(async () => {
    await votes.stopVoteEventsStore();
    await clean();
    process.env.NODE_ENV = previousEnv;
  });
  await votes.initVoteEventsStore({ refreshMs: 60_000 });
  const vote = (id) => ({ provider: "topgg", voteId: `test292-${id}`, userId: "123456789012345678", votedAt: "2026-09-27T12:00:00.000Z" });

  votes.recordVoteEvent(vote("a"));
  // The other process already stored vote b; this one merges it from the provider's list.
  await events.insertOne({ _key: "topgg:test292-b", ...vote("b"), key: "topgg:test292-b", provider: "topgg" });
  await counters.updateOne({ _id: "topgg" }, { $inc: { totalVotes: 1 } }, { upsert: true });
  votes.mergeVoteEvents([vote("b"), vote("a")]);
  await votes.stopVoteEventsStore();

  assert.equal(await events.countDocuments({ _key: /^topgg:test292-/ }), 2);
  assert.equal((await counters.findOne({ _id: "topgg" })).totalVotes, 2, "a and b once each");
  assert.equal(fs.existsSync(path.join(dataDir, "vote-events.json")), false, "no vote-events.json in production");
});

test("dashboard logins: hashed in MongoDB, found at once by another process, no dashboard.json", { skip: !hasMongoConfig }, async (t) => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { createHash } = await import("node:crypto");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const sessions = getDb().collection("dashboard_auth_sessions");
  const oauth = getDb().collection("dashboard_oauth_states");
  const clean = async () => {
    await sessions.deleteMany({ _id: { $in: [hash("tok-292-mine"), hash("tok-292-other")] } });
    await oauth.deleteMany({ _id: "state-292" });
  };
  await clean();
  const dashboard = await import("../src/dashboard-store.js");
  t.after(async () => {
    await dashboard.stopDashboardStore();
    await clean();
    process.env.NODE_ENV = previousEnv;
  });
  await dashboard.initDashboardStore({ refreshMs: 60_000 });
  const now = Math.floor(Date.now() / 1000);
  const session = { user: { id: "123456789012345678", username: "owner" }, guilds: [], createdAt: now, expiresAt: now + 3600 };

  dashboard.setDashboardAuthSession("tok-292-mine", session);
  assert.equal(dashboard.getDashboardAuthSession("tok-292-mine")?.user?.username, "owner");
  await dashboard.stopDashboardStore();
  const stored = await sessions.findOne({ _id: hash("tok-292-mine") });
  assert.ok(stored, "stored under the token's hash");
  assert.equal(await sessions.findOne({ _id: "tok-292-mine" }), null, "never the token itself");

  // The commander signed someone in a second ago; this process's cache does not know it yet.
  await sessions.insertOne({ _id: hash("tok-292-other"), session: { ...session, user: { id: "223456789012345678", username: "other" } }, expiresAt: new Date((now + 3600) * 1000) });
  assert.equal(dashboard.getDashboardAuthSession("tok-292-other"), null, "the cache is a few seconds behind");
  assert.equal((await dashboard.findDashboardAuthSession("tok-292-other"))?.user?.username, "other", "a direct look finds it");

  dashboard.setDashboardOauthState("state-292", { nextPage: "admin", expiresAt: now + 600 });
  assert.equal(dashboard.popDashboardOauthState("state-292")?.nextPage, "admin");
  assert.equal(dashboard.deleteDashboardAuthSession("tok-292-mine"), true);
  await dashboard.stopDashboardStore();
  assert.equal(await sessions.findOne({ _id: hash("tok-292-mine") }), null, "signing out removes the login");
  assert.equal(fs.existsSync(path.join(dataDir, "dashboard.json")), false, "no dashboard.json in production");
});

test("guild languages: a language set by the commander reaches the other processes", { skip: !hasMongoConfig }, async (t) => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const languages = getDb().collection("guild_languages");
  const ids = ["923456789012345601", "923456789012345602"];
  await languages.deleteMany({ _id: { $in: ids } });
  const store = await import("../src/guild-language-store.js");
  t.after(async () => {
    await store.stopGuildLanguageStore();
    await languages.deleteMany({ _id: { $in: ids } });
    process.env.NODE_ENV = previousEnv;
  });
  await store.initGuildLanguageStore({ refreshMs: 1000 });
  store.setGuildLanguage(ids[0], "de");
  // The commander (another process) sets a language for another server.
  await languages.updateOne({ _id: ids[1] }, { $set: { language: "en" } }, { upsert: true });
  await new Promise((resolve) => { setTimeout(resolve, 1600); });
  assert.equal(store.getGuildLanguage(ids[1]), "en", "picked up by the refresh, no restart needed");
  assert.equal((await languages.findOne({ _id: ids[0] }))?.language, "de");
  assert.equal(fs.existsSync(path.join(dataDir, "guild-languages.json")), false, "no guild-languages.json in production");
});

test("owner audit in production: MongoDB only, with the person and the address", { skip: !hasMongoConfig }, async (t) => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.OMNIFM_OWNER_AUDIT_FILE = path.join(dataDir, "owner-audit.json");
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const audit = getDb().collection("owner_audit");
  await audit.deleteMany({ action: "test.292" });
  t.after(async () => {
    await audit.deleteMany({ action: "test.292" });
    process.env.NODE_ENV = previousEnv;
  });
  const { recordOwnerAudit } = await import("../src/lib/owner-audit-store.js");
  recordOwnerAudit({ actor: "Olli (1)", action: "test.292", status: "success", summary: "wave 3a", metadata: { ip: "203.0.113.9" } });
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  const row = await audit.findOne({ action: "test.292" });
  assert.deepEqual([row?.actor, row?.ip], ["Olli (1)", "203.0.113.9"]);
  assert.equal(fs.existsSync(path.join(dataDir, "owner-audit.json")), false, "no owner-audit.json in production");
});
