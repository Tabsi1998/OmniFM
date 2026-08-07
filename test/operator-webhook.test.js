import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedOperatorWebhookUrl,
  postOperatorWebhook,
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
