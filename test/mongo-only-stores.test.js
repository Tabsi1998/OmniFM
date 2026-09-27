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
