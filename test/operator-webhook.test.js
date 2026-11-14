import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedOperatorWebhookUrl,
  postOperatorWebhook,
  sendOperatorTestAlert,
} from "../src/services/operator-webhook.js";

test("operator webhook uses the hardened outbound policy and drains the response", async () => {
  let request = null;
  let cancelled = false;
  const sent = await postOperatorWebhook("https://discord.com/api/webhooks/123/token", {
    content: "diagnostic",
  }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        body: {
          cancel: async () => {
            cancelled = true;
          },
        },
      };
    },
  });

  assert.equal(sent, true);
  assert.equal(cancelled, true);
  assert.equal(request.url, "https://discord.com/api/webhooks/123/token");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.requireHttps, true);
  assert.equal(request.options.timeoutMs, 8_000);
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.equal(request.options.body, JSON.stringify({ content: "diagnostic" }));
});

test("operator webhook refuses local and non-HTTPS targets before sending a payload", async () => {
  const sent = await postOperatorWebhook("http://127.0.0.1:8080/internal", {
    content: "must not be sent",
  });

  assert.equal(sent, false);
});

test("operator webhook only allows the documented Discord HTTPS webhook endpoints", async () => {
  assert.equal(isAllowedOperatorWebhookUrl("https://discord.com/api/webhooks/123/token"), true);
  assert.equal(isAllowedOperatorWebhookUrl("https://canary.discord.com/api/webhooks/123/token?wait=true"), true);
  assert.equal(isAllowedOperatorWebhookUrl("https://discord.com.example/api/webhooks/123/token"), false);
  assert.equal(isAllowedOperatorWebhookUrl("https://example.com/api/webhooks/123/token"), false);
  assert.equal(isAllowedOperatorWebhookUrl("https://discord.com/api/channels/123/messages"), false);
});

test("owner console test alert goes through the operator webhook path (#555)", async () => {
  let request = null;
  const sent = await sendOperatorTestAlert("https://discord.com/api/webhooks/123/token", "<@&42>", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 204, body: { cancel: async () => {} } };
    },
  });

  assert.deepEqual(sent, { ok: true, status: 204, error: null });
  assert.equal(request.url, "https://discord.com/api/webhooks/123/token");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.requireHttps, true);
  const body = JSON.parse(request.options.body);
  assert.equal(body.content, "<@&42>");
  assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: ["42"] });
  assert.equal(body.embeds[0].title, "🧪 Testalarm");
});

test("owner console test alert says why Discord did not take it (#555)", async () => {
  let calls = 0;
  const refused = async () => {
    calls += 1;
    return { ok: false, status: 404, body: { cancel: async () => {} } };
  };
  const url = "https://discord.com/api/webhooks/123/token";
  assert.deepEqual(await sendOperatorTestAlert(url, "", { fetchImpl: refused }), { ok: false, status: 404, error: null });

  const { SafeOutboundError } = await import("../src/lib/safe-outbound-http.js");
  const timeout = async () => { throw new SafeOutboundError("OUTBOUND_TIMEOUT", "Ausgehende Anfrage hat das Zeitlimit überschritten."); };
  assert.deepEqual(await sendOperatorTestAlert(url, "", { fetchImpl: timeout }),
    { ok: false, status: null, error: "Ausgehende Anfrage hat das Zeitlimit überschritten." });
  const broken = async () => { throw new TypeError("socket hang up"); };
  assert.deepEqual(await sendOperatorTestAlert(url, "", { fetchImpl: broken }),
    { ok: false, status: null, error: "Discord ist nicht erreichbar." });

  // Never to another host; a real alert still gets a plain true/false.
  assert.equal((await sendOperatorTestAlert("https://127.0.0.1/api/webhooks/1/x", "", { fetchImpl: refused })).ok, false);
  assert.equal(calls, 1);
  assert.equal(await postOperatorWebhook(url, {}, { fetchImpl: refused }), false);
  assert.equal(await postOperatorWebhook(url, {}, { fetchImpl: broken }), false);
});

test("owner console test alert has no plain fetch left (#555)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/api/routes/admin-routes.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(^|[^.\w])fetch\(/m);
});
