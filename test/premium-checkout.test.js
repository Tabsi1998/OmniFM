import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// #321: nothing is bought on the website any more; Premium comes to Discord.
// A code that grants a license still works, a purchase gets a plain answer,
// and the old Stripe webhook and return page are gone.

const ENV = {
  WEB_INTERNAL_PORT: "0",
  WEB_BIND: "127.0.0.1",
  PUBLIC_WEB_URL: "http://127.0.0.1",
  SMTP_HOST: "",
};

test("website checkout: a free code grants a license, a purchase is not possible", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-checkout-321-"));
  const previous = Object.fromEntries(Object.keys({ ...ENV, OMNIFM_RUNTIME_DATA_DIR: "" }).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV, { OMNIFM_RUNTIME_DATA_DIR: dataDir });

  const { startWebServer } = await import("../src/api/server.js");
  const { upsertOffer } = await import("../src/coupon-store.js");
  const { listLicensesByContactEmail } = await import("../src/premium-store.js");
  const server = startWebServer([]);
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // The logger may still hold its file open on Windows; the folder is temporary anyway.
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  });

  const post = async (pathname, body) => {
    const response = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OmniFM-Language": "de" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  const purchase = await post("/api/premium/checkout", { tier: "pro", email: "buyer@example.com", months: 1, seats: 1 });
  assert.equal(purchase.status, 400);
  assert.equal(purchase.body.code, "purchase_unavailable");
  assert.match(purchase.body.error, /Discord/);
  assert.equal(purchase.body.url, undefined, "no payment page to go to");

  upsertOffer({ code: "FREEPRO321", kind: "coupon", fulfillmentMode: "direct_grant", active: true, grantPlan: "pro", grantSeats: 1, grantMonths: 1, createdBy: "test-suite" });
  const grant = await post("/api/premium/checkout", { tier: "pro", email: "gift@example.com", months: 1, seats: 1, couponCode: "FREEPRO321" });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  assert.equal(grant.body.activated, true);
  assert.equal(grant.body.directGrant, true);
  assert.equal(listLicensesByContactEmail("gift@example.com").length, 1);

  for (const gone of ["/api/premium/webhook", "/api/premium/verify"]) {
    // eslint-disable-next-line no-await-in-loop -- two requests, one after the other
    assert.equal((await post(gone, {})).status, 404, `${gone} is gone`);
  }
});
