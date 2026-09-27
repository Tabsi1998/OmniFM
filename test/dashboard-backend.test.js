import test from "node:test";
import assert from "node:assert/strict";

import {
  configureDashboardBackend,
  resolveDashboardBackend,
  resolveNodeApiPort,
  resolvePublicBackend,
} from "../src/lib/dashboard-backend.js";

test("the Node entry is the default since #290; FastAPI is the way back", () => {
  assert.equal(resolvePublicBackend({}), "node");
  assert.equal(resolvePublicBackend({ OMNIFM_PUBLIC_BACKEND: "FastAPI" }), "fastapi");
  // Behind the Node entry the commander always answers the dashboard.
  assert.equal(resolveDashboardBackend({ OMNIFM_DASHBOARD_BACKEND: "fastapi" }), "node");
});

test("behind the FastAPI entry without the dashboard switch the Node API stays off", () => {
  const env = { WEB_SERVER_ENABLED: "1", OMNIFM_PUBLIC_BACKEND: "fastapi" };
  assert.deepEqual(configureDashboardBackend(env), { backend: "fastapi", enabled: false });
  assert.equal(env.WEB_SERVER_ENABLED, "0");
  assert.equal(resolveDashboardBackend({ OMNIFM_PUBLIC_BACKEND: "fastapi", OMNIFM_DASHBOARD_BACKEND: "FastAPI" }), "fastapi");
});

test("node mode binds the Node API to loopback and trusts only the local proxy", () => {
  const env = {
    OMNIFM_DASHBOARD_BACKEND: "node",
    WEB_BIND: "0.0.0.0",
    TRUSTED_PROXY_IPS: "10.0.0.5",
    PUBLIC_WEB_URL: "https://omnifm.xyz",
  };
  const result = configureDashboardBackend(env, { redirectUri: "https://other.example/api/auth/discord/callback" });
  assert.deepEqual(result, { backend: "node", enabled: true, port: 8002, publicBackend: "node" });
  assert.equal(env.WEB_SERVER_ENABLED, "1");
  assert.equal(env.WEB_BIND, "127.0.0.1", "never public, whatever backend/.env says");
  assert.equal(env.WEB_INTERNAL_PORT, "8002");
  assert.equal(env.TRUST_PROXY_HEADERS, "1");
  assert.deepEqual(env.TRUSTED_PROXY_IPS.split(",").sort(), ["10.0.0.5", "127.0.0.1", "::1"]);
  assert.equal(env.PUBLIC_WEB_URL, "https://omnifm.xyz", "a configured public URL wins");
});

test("node mode takes the login return address from the OAuth redirect when no public URL is set", () => {
  const env = { OMNIFM_DASHBOARD_BACKEND: "node", OMNIFM_NODE_API_PORT: "18002" };
  configureDashboardBackend(env, { redirectUri: "https://omnifm.xyz/api/auth/discord/callback" });
  assert.equal(env.PUBLIC_WEB_URL, "https://omnifm.xyz");
  assert.equal(env.WEB_INTERNAL_PORT, "18002");
  assert.equal(resolveNodeApiPort({ OMNIFM_NODE_API_PORT: "99999" }), 8002, "invalid ports fall back");
});
