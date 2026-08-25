import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("premium store reads Owner licenses from MongoDB and refreshes changes", async (t) => {
  if (!String(process.env.MONGO_URL || "").trim()) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-premium-mongo-"));
  const originalDbName = process.env.DB_NAME;
  process.env.DB_NAME = `${originalDbName || "omnifm_test"}_premium_${process.pid}`;
  process.env.OMNIFM_RUNTIME_DATA_DIR = runtimeDir;
  process.env.PREMIUM_STORE_REFRESH_MS = "1000";

  const dbModule = await import("../src/lib/db.js");
  const premiumStore = await import("../src/premium-store.js");
  await dbModule.connect();
  const database = dbModule.getDb();
  const licenseId = "OMNI-TEST-MONGO-SYNC";
  const guildId = "123456789012345678";
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();

  t.after(async () => {
    await dbModule.close();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    if (originalDbName === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = originalDbName;
  });

  await database.collection("licenses").insertOne({
    _licenseId: licenseId,
    plan: "ultimate",
    tier: "ultimate",
    seats: 1,
    linkedServerIds: [guildId],
    expiresAt,
  });

  await premiumStore.initPremiumStore();
  assert.equal(premiumStore.getServerPlan(guildId), "ultimate");
  assert.equal(premiumStore.getServerLicense(guildId)?.id, licenseId);

  await database.collection("licenses").updateOne(
    { _licenseId: licenseId },
    { $set: { active: false } }
  );
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(premiumStore.getServerPlan(guildId), "free");
});
