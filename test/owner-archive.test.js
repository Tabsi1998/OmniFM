import test from "node:test";
import assert from "node:assert/strict";

import { archiveMongoRecords, restoreArchivedOperation } from "../src/lib/owner-archive.js";

// The owner console's archive (#288), against a real MongoDB: what the owner
// deletes comes back whole, but never over newer data (from FastAPI's unit
// tests, #291).
async function scratchDb(t, suffix) {
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    t.skip("MongoDB is not configured for this test run");
    return null;
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  const db = client.db(`${String(process.env.DB_NAME || "omnifm_test").trim()}_${suffix}`);
  await db.dropDatabase();
  t.after(async () => {
    await db.dropDatabase().catch(() => null);
    await client.close();
  });
  return db;
}

test("a deleted licence and its server come back whole", async (t) => {
  const db = await scratchDb(t, "archive");
  if (!db) return;
  await db.collection("licenses").insertOne({ _id: "license-object", _licenseId: "OMNI-1", plan: "ultimate" });
  await db.collection("server_entitlements").insertOne({ _id: "entitlement-object", _serverId: "123", licenseId: "OMNI-1" });

  const archived = await archiveMongoRecords(db, [
    ["licenses", { _licenseId: "OMNI-1" }],
    ["server_entitlements", { licenseId: "OMNI-1" }],
  ], { operation: "owner.license.delete", target: "OMNI-1" });
  assert.equal(archived.archived, 2);
  assert.deepEqual(archived.deleted, { licenses: 1, server_entitlements: 1 });
  assert.equal(await db.collection("licenses").countDocuments(), 0);
  assert.equal(await db.collection("server_entitlements").countDocuments(), 0);
  assert.equal(await db.collection("data_archive").countDocuments(), 2);

  const restored = await restoreArchivedOperation(db, archived.operationId);
  assert.equal(restored.restored, 2);
  assert.equal((await db.collection("licenses").findOne({ _licenseId: "OMNI-1" })).plan, "ultimate");
  assert.equal((await db.collection("server_entitlements").findOne({ _serverId: "123" })).licenseId, "OMNI-1");
  assert.equal(await db.collection("data_archive").countDocuments({ restoredAt: null }), 0, "every record is marked restored");
});

test("a restore never overwrites newer active data", async (t) => {
  const db = await scratchDb(t, "archive_newer");
  if (!db) return;
  await db.collection("stations").insertOne({ _id: "station-object", key: "rock", name: "Original" });
  const archived = await archiveMongoRecords(db, [["stations", { key: "rock" }]], { operation: "owner.station.delete", target: "rock" });
  await db.collection("stations").insertOne({ _id: "station-object", key: "rock", name: "Newer" });

  await assert.rejects(restoreArchivedOperation(db, archived.operationId), (error) => error.status === 409 && /neuere aktive Daten/.test(error.message));
  assert.equal((await db.collection("stations").findOne({ key: "rock" })).name, "Newer");
  assert.equal((await db.collection("data_archive").findOne({})).restoredAt, null, "the archive stays ready");
});
