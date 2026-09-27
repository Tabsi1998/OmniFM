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
