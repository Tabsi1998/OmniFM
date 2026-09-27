import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// #289: Stripe delivers a webhook again when it gets no answer in time, and
// may send completed + async_payment_succeeded for the same session. Every
// way must end in exactly one licence of one month, never a doubled one.
// The payloads are signed here with a test secret; no Stripe account needed.

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_webhook_289",
  STRIPE_WEBHOOK_SECRET: "whsec_test_webhook_289",
  WEB_INTERNAL_PORT: "0",
  WEB_BIND: "127.0.0.1",
  PUBLIC_WEB_URL: "http://127.0.0.1",
  SMTP_HOST: "",
};

function checkoutEvent(eventId, sessionId, email, type = "checkout.session.completed") {
  return {
    id: eventId,
    object: "event",
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 299,
        customer_details: { email },
        metadata: { email, tier: "pro", months: "1", seats: "1", language: "de" },
      },
    },
  };
}

test("a Stripe webhook delivered twice, or at the same time, creates exactly one licence", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-webhook-289-"));
  const previous = Object.fromEntries(Object.keys({ ...ENV, OMNIFM_RUNTIME_DATA_DIR: "" }).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV, { OMNIFM_RUNTIME_DATA_DIR: dataDir });

  const { startWebServer } = await import("../src/api/server.js");
  const { listLicensesByContactEmail, isSessionProcessed } = await import("../src/premium-store.js");
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
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

  const deliver = async (event, { secret = ENV.STRIPE_WEBHOOK_SECRET } = {}) => {
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const response = await fetch(`${base}/api/premium/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
      body: payload,
    });
    return { status: response.status, body: await response.json() };
  };
  const oneMonthLicence = (email) => {
    const licences = listLicensesByContactEmail(email);
    assert.equal(licences.length, 1, `${email}: exactly one licence`);
    const days = (Date.parse(licences[0].expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 25 && days < 35, `${email}: one month, not two (${days.toFixed(1)} days)`);
  };

  // A forged signature changes nothing.
  const forged = await deliver(checkoutEvent("evt_forged", "cs_forged", "forged@example.test"), { secret: "whsec_wrong" });
  assert.equal(forged.status, 400);
  assert.equal(listLicensesByContactEmail("forged@example.test").length, 0);

  // The same event twice, one after the other.
  const first = await deliver(checkoutEvent("evt_a", "cs_a", "a@example.test"));
  const again = await deliver(checkoutEvent("evt_a", "cs_a", "a@example.test"));
  assert.deepEqual([first.status, first.body.processed], [200, true]);
  assert.deepEqual([again.status, again.body.duplicate], [200, true]);
  oneMonthLicence("a@example.test");

  // Two events for the same session: completed, then async_payment_succeeded.
  await deliver(checkoutEvent("evt_b1", "cs_b", "b@example.test"));
  const second = await deliver(checkoutEvent("evt_b2", "cs_b", "b@example.test", "checkout.session.async_payment_succeeded"));
  assert.equal(second.status, 200);
  assert.equal(second.body.replay, true);
  oneMonthLicence("b@example.test");

  // Five deliveries of one event at the same moment.
  const burst = await Promise.all(Array.from({ length: 5 }, () => deliver(checkoutEvent("evt_c", "cs_c", "c@example.test"))));
  assert.ok(burst.every((answer) => answer.status === 200), JSON.stringify(burst));
  assert.equal(burst.filter((answer) => answer.body.processed === true && !answer.body.replay).length, 1);
  assert.equal(isSessionProcessed("cs_c"), true);
  oneMonthLicence("c@example.test");
});
