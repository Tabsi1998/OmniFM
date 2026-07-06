import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithValidatedRedirects } from "../src/lib/safe-fetch.js";

test("safe fetch validates every redirected GET target", async () => {
  const validatedUrls = [];
  const fetchCalls = [];
  const validateUrl = async (url) => {
    validatedUrls.push(url);
    return { ok: true, url };
  };
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url === "https://radio.example/start") {
      return new Response("", {
        status: 302,
        headers: { Location: "https://cdn.example/live" },
      });
    }
    return new Response("ok", { status: 200 });
  };

  const { response, finalUrl, redirects } = await fetchWithValidatedRedirects(
    "https://radio.example/start",
    { method: "GET" },
    { fetchImpl, validateUrl }
  );

  assert.equal(response.status, 200);
  assert.equal(finalUrl, "https://cdn.example/live");
  assert.equal(redirects, 1);
  assert.deepEqual(validatedUrls, ["https://radio.example/start", "https://cdn.example/live"]);
  assert.deepEqual(fetchCalls, ["https://radio.example/start", "https://cdn.example/live"]);
});

test("safe fetch blocks redirected targets rejected by validation", async () => {
  const validateUrl = async (url) => (
    url.includes("private.local")
      ? { ok: false, error: "private target blocked" }
      : { ok: true, url }
  );
  const fetchImpl = async () => new Response("", {
    status: 302,
    headers: { Location: "http://private.local/live" },
  });

  await assert.rejects(
    () => fetchWithValidatedRedirects(
      "https://radio.example/start",
      { method: "GET" },
      { fetchImpl, validateUrl }
    ),
    /private target blocked/
  );
});

test("safe fetch does not follow redirected POST requests", async () => {
  const validateUrl = async (url) => ({ ok: true, url });
  const fetchImpl = async () => new Response("", {
    status: 307,
    headers: { Location: "https://webhook.example/next" },
  });

  await assert.rejects(
    () => fetchWithValidatedRedirects(
      "https://webhook.example/start",
      { method: "POST", body: "{}" },
      { fetchImpl, validateUrl }
    ),
    /HTTP-Methode/
  );
});
