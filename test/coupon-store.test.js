import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getOffer,
  previewCheckoutOffer,
  upsertOffer,
} from "../src/coupon-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function snapshotFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath),
    };
  } catch {
    return { exists: false, content: null };
  }
}

async function restoreFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await fs.writeFile(filePath, snapshot.content);
    return;
  }
  await fs.rm(filePath, { force: true });
}

test("direct grant offers require explicit plan, seats, and months", async (t) => {
  const trackedFiles = [
    path.join(repoRoot, "coupons.json"),
    path.join(repoRoot, "coupons.json.bak"),
  ];
  const snapshots = new Map();
  for (const filePath of trackedFiles) {
    // eslint-disable-next-line no-await-in-loop -- one file after the other
    snapshots.set(filePath, await snapshotFile(filePath));
  }
  t.after(async () => {
    for (const [filePath, snapshot] of snapshots.entries()) {
      // eslint-disable-next-line no-await-in-loop -- one file after the other
      await restoreFile(filePath, snapshot);
    }
  });

  assert.throws(() => upsertOffer({
    code: "BROKENFREE",
    kind: "coupon",
    fulfillmentMode: "direct_grant",
    active: true,
    createdBy: "test-suite",
  }), /grantPlan, grantSeats, and grantMonths/i);
});

test("direct grant offers preview as zero-charge license grants", async (t) => {
  const trackedFiles = [
    path.join(repoRoot, "coupons.json"),
    path.join(repoRoot, "coupons.json.bak"),
  ];
  const snapshots = new Map();
  for (const filePath of trackedFiles) {
    // eslint-disable-next-line no-await-in-loop -- one file after the other
    snapshots.set(filePath, await snapshotFile(filePath));
  }
  t.after(async () => {
    for (const [filePath, snapshot] of snapshots.entries()) {
      // eslint-disable-next-line no-await-in-loop -- one file after the other
      await restoreFile(filePath, snapshot);
    }
  });

  const saved = upsertOffer({
    code: "FREEPRO1",
    kind: "coupon",
    fulfillmentMode: "direct_grant",
    active: true,
    grantPlan: "pro",
    grantSeats: 1,
    grantMonths: 1,
    createdBy: "test-suite",
  });

  assert.equal(saved.fulfillmentMode, "direct_grant");
  assert.equal(saved.grantPlan, "pro");
  assert.equal(saved.grantSeats, 1);
  assert.equal(saved.grantMonths, 1);

  const publicOffer = getOffer("freepro1");
  assert.equal(publicOffer.fulfillmentMode, "direct_grant");
  assert.deepEqual(publicOffer.allowedTiers, ["pro"]);
  assert.deepEqual(publicOffer.allowedSeats, [1]);

  const preview = previewCheckoutOffer({
    tier: "pro",
    seats: 1,
    months: 12,
    email: "gift@example.com",
    baseAmountCents: 1990,
    couponCode: "FREEPRO1",
  });

  assert.equal(preview.requiresPayment, false);
  assert.equal(preview.finalAmountCents, 0);
  assert.equal(preview.discountCents, 1990);
  assert.equal(preview.applied.code, "FREEPRO1");
  assert.equal(preview.applied.fulfillmentMode, "direct_grant");
  assert.equal(preview.applied.grantPlan, "pro");
  assert.equal(preview.applied.grantSeats, 1);
  assert.equal(preview.applied.grantMonths, 1);
});
