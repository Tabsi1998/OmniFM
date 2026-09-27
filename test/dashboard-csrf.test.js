import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { dashboardApiRequest, needsDashboardIntent } = await import("../frontend/src/lib/dashboardApi.js");

// #374: the live server dashboard sent no CSRF header, so the Node API refused
// every change (403). The rule of the client has to be the server's rule.

test("every dashboard change carries the CSRF header, reads and telemetry do not", async () => {
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url, method: init.method, csrf: init.headers["X-OmniFM-CSRF"] });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const calls = [
    ["/api/dashboard/custom-stations?serverId=1", "POST", "dashboard-intent"],
    ["/api/dashboard/perms?serverId=1", "PUT", "dashboard-intent"],
    ["/api/dashboard/events/e1?serverId=1", "PATCH", "dashboard-intent"],
    ["/api/dashboard/events/e1?serverId=1", "DELETE", "dashboard-intent"],
    ["/api/auth/logout", "POST", "dashboard-intent"],
    ["/api/dashboard/stats?serverId=1", "GET", undefined],
    ["/api/dashboard/telemetry", "POST", undefined],
    ["/api/auth/session", "GET", undefined],
  ];
  for (const [path, method] of calls) {
    // eslint-disable-next-line no-await-in-loop -- in order, like the dashboard
    await dashboardApiRequest(path, { method, body: method === "GET" ? undefined : "{}" }, fakeFetch);
  }
  assert.deepEqual(sent.map((call) => call.csrf), calls.map((call) => call[2]));
  assert.equal(needsDashboardIntent("/api/dashboards/x", "POST"), false, "only the dashboard API itself");
});

test("a refused request keeps the server's message and status", async () => {
  const refused = async () => ({ ok: false, status: 403, json: async () => ({ error: "Kein Zugriff." }) });
  await assert.rejects(dashboardApiRequest("/api/dashboard/perms", { method: "PUT", body: "{}" }, refused), (error) => error.status === 403 && error.message === "Kein Zugriff.");
});

test("the server dashboard sends every request through that helper", () => {
  const source = fs.readFileSync(new URL("../frontend/src/components/GuildDashboard.js", import.meta.url), "utf8");
  assert.match(source, /import \{ dashboardApiRequest \} from '\.\.\/lib\/dashboardApi\.js';/);
  assert.doesNotMatch(source, /\bfetch\(/, "no request past the CSRF header");
});
