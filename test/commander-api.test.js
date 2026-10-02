import test from "node:test";
import assert from "node:assert/strict";

import { configureCommanderApi, resolveNodeApiPort } from "../src/lib/commander-api.js";

test("the commander's API is on even where backend/.env still names FastAPI (#291)", () => {
  const env = { WEB_SERVER_ENABLED: "0", OMNIFM_PUBLIC_BACKEND: "fastapi", OMNIFM_DASHBOARD_BACKEND: "fastapi" };
  assert.deepEqual(configureCommanderApi(env), { port: 8002 });
  assert.equal(env.WEB_SERVER_ENABLED, "1");
});

test("the commander's API binds to loopback and trusts only the local entry", () => {
  const env = {
    WEB_BIND: "0.0.0.0",
    TRUSTED_PROXY_IPS: "10.0.0.5",
    PUBLIC_WEB_URL: "https://omnifm.xyz",
  };
  configureCommanderApi(env, { redirectUri: "https://other.example/api/auth/discord/callback" });
  assert.equal(env.WEB_SERVER_ENABLED, "1");
  assert.equal(env.WEB_BIND, "127.0.0.1", "never public, whatever backend/.env says");
  assert.equal(env.WEB_INTERNAL_PORT, "8002");
  assert.equal(env.TRUST_PROXY_HEADERS, "1");
  assert.deepEqual(env.TRUSTED_PROXY_IPS.split(",").sort(), ["10.0.0.5", "127.0.0.1", "::1"]);
  assert.equal(env.PUBLIC_WEB_URL, "https://omnifm.xyz", "a configured public URL wins");
});

test("the login return address comes from the OAuth redirect when no public URL is set", () => {
  const env = { OMNIFM_NODE_API_PORT: "18002" };
  configureCommanderApi(env, { redirectUri: "https://omnifm.xyz/api/auth/discord/callback" });
  assert.equal(env.PUBLIC_WEB_URL, "https://omnifm.xyz");
  assert.equal(env.WEB_INTERNAL_PORT, "18002");
  assert.equal(resolveNodeApiPort({ OMNIFM_NODE_API_PORT: "99999" }), 8002, "invalid ports fall back");
});
