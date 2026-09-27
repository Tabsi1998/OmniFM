import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// #283: the owner console with Discord sign-in and roles. The dashboard's
// Discord session is seeded directly; MongoDB is not needed (sessions fall
// back to memory, the owner settings come from the test hook).

const SUPPORT = "111111111111111111";
const BILLING = "222222222222222222";
const OWNER = "333333333333333333";
const STRANGER = "444444444444444444";
const TOKEN = "script-token-283";

const access = (overrides = {}) => ({
  access: {
    accounts: [
      { discordId: SUPPORT, name: "Sam Support", role: "support" },
      { discordId: BILLING, name: "Bea Billing", role: "billing" },
      { discordId: OWNER, name: "Olli Owner", role: "owner" },
    ],
    tokenEnabled: true,
    ...overrides,
  },
});

test("owner console: Discord sign-in, roles, audit with the person", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-access-"));
  const env = {
    OMNIFM_RUNTIME_DATA_DIR: dataDir,
    OMNIFM_OWNER_AUDIT_FILE: path.join(dataDir, "owner-audit.json"),
    API_ADMIN_TOKEN: TOKEN,
    WEB_INTERNAL_PORT: "0",
    WEB_BIND: "127.0.0.1",
    PUBLIC_WEB_URL: "http://127.0.0.1",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);

  const { startWebServer } = await import("../src/api/server.js");
  const { setDashboardAuthSession } = await import("../src/dashboard-store.js");
  const { setOwnerSettingsForTests } = await import("../src/lib/owner-settings-cache.js");
  const { getOwnerAuditSnapshot } = await import("../src/lib/owner-audit-store.js");
  setOwnerSettingsForTests(access());
  const server = startWebServer([]);
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.close();
    setOwnerSettingsForTests({});
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  });

  // A Discord sign-in of the dashboard for each person.
  const dashboardCookie = (discordId, name) => {
    const token = `dash-${discordId}`;
    setDashboardAuthSession(token, {
      user: { id: discordId, username: name },
      guilds: [],
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    return `omnifm_session=${token}`;
  };
  const call = async (method, pathname, { cookie = "", csrf = true, headers = {}, body } = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-OmniFM-CSRF": "owner-intent" } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, cookie: response.headers.get("set-cookie") || "", body: await response.json().catch(() => ({})) };
  };
  const signIn = async (discordId, name) => {
    const answer = await call("POST", "/api/admin/session", { cookie: dashboardCookie(discordId, name) });
    const ownerCookie = answer.cookie.split(";")[0];
    return { ...answer, ownerCookie };
  };

  assert.deepEqual((await call("GET", "/api/admin/session")).body.authenticated, false);

  // A foreign Discord account gets nothing.
  const stranger = await signIn(STRANGER, "Eve");
  assert.equal(stranger.status, 403);
  assert.equal(stranger.cookie, "");

  // Signing in needs the console's header, so no foreign page can do it.
  const forged = await call("POST", "/api/admin/session", { cookie: dashboardCookie(SUPPORT, "Sam"), csrf: false });
  assert.equal(forged.status, 403);

  // Support: reads, runs checks, writes nothing.
  const support = await signIn(SUPPORT, "Sam");
  assert.equal(support.status, 200);
  assert.match(support.cookie, /^omnifm_owner=[^;]+; Max-Age=43200; Path=\/api; HttpOnly; SameSite=Strict/);
  assert.deepEqual([support.body.role, support.body.user.name], ["support", "Sam Support"]);
  assert.equal((await call("GET", "/api/admin/session", { cookie: support.ownerCookie })).body.role, "support");
  assert.equal((await call("GET", "/api/admin/overview", { cookie: support.ownerCookie })).status, 200);
  const supportLicence = await call("POST", "/api/admin/licenses", { cookie: support.ownerCookie, body: { email: "a@b.test", tier: "pro" } });
  assert.deepEqual([supportLicence.status, supportLicence.body.error], [403, "Deine Rolle (Support) darf das nicht."]);
  assert.equal((await call("PUT", "/api/admin/config", { cookie: support.ownerCookie, body: { section: "plans", data: {} } })).status, 403);
  assert.equal((await call("DELETE", "/api/admin/stations/x", { cookie: support.ownerCookie })).status, 403);
  // Without the header a change through the cookie is refused before anything else.
  assert.equal((await call("POST", "/api/admin/stations/test", { cookie: support.ownerCookie, csrf: false, body: { url: "x" } })).status, 403);
  assert.notEqual((await call("POST", "/api/admin/stations/test", { cookie: support.ownerCookie, body: { url: "x" } })).status, 403);
  assert.notEqual((await call("POST", "/api/owner/status/check", { cookie: support.ownerCookie, body: {} })).status, 403, "support may check");

  // Billing: licences, payments and plans, nothing else.
  const billing = await signIn(BILLING, "Bea");
  assert.equal((await call("PUT", "/api/admin/config", { cookie: billing.ownerCookie, body: { section: "company", data: {} } })).status, 403);
  assert.notEqual((await call("PUT", "/api/admin/config", { cookie: billing.ownerCookie, body: { section: "plans", data: {} } })).status, 403);
  assert.equal((await call("POST", "/api/owner/status/check", { cookie: billing.ownerCookie, body: {} })).status, 403);

  // The owner may change the access list itself; support may not.
  const owner = await signIn(OWNER, "Olli");
  assert.equal((await call("PUT", "/api/admin/config", { cookie: support.ownerCookie, body: { section: "access", data: {} } })).status, 403);
  const lockout = await call("PUT", "/api/admin/config", { cookie: owner.ownerCookie, body: { section: "access", data: { accounts: [], tokenEnabled: false } } });
  assert.deepEqual([lockout.status, lockout.body.error], [400, "Der Token kann erst aus, wenn mindestens ein Discord-Konto die Rolle Owner hat."]);

  // The script token: works, can be switched off once a Discord owner exists.
  assert.equal((await call("GET", "/api/admin/overview", { headers: { "X-Admin-Token": TOKEN }, csrf: false })).status, 200);
  setOwnerSettingsForTests(access({ tokenEnabled: false }));
  assert.equal((await call("GET", "/api/admin/overview", { headers: { "X-Admin-Token": TOKEN }, csrf: false })).status, 401);
  setOwnerSettingsForTests({ access: { accounts: [], tokenEnabled: false } });
  assert.equal((await call("GET", "/api/admin/overview", { headers: { "X-Admin-Token": TOKEN }, csrf: false })).status, 200, "never locked out");

  // Taking a person off the list ends their access at once.
  setOwnerSettingsForTests(access({ accounts: [{ discordId: OWNER, name: "Olli Owner", role: "owner" }] }));
  assert.equal((await call("GET", "/api/admin/overview", { cookie: support.ownerCookie })).status, 401);

  // Signing out ends the session.
  assert.equal((await call("DELETE", "/api/admin/session", { cookie: owner.ownerCookie })).status, 200);
  assert.equal((await call("GET", "/api/admin/overview", { cookie: owner.ownerCookie })).status, 401);

  // The audit names the person, not just "owner".
  const events = getOwnerAuditSnapshot({ limit: 200 }).events;
  assert.ok(events.some((event) => event.action === "owner.login" && event.status === "success" && event.actor === `Sam Support (${SUPPORT})`));
  assert.ok(events.some((event) => event.action === "owner.denied" && event.actor === `Sam Support (${SUPPORT})`));
  assert.ok(events.some((event) => event.action === "owner.login" && event.status === "denied" && event.actor === `Eve (${STRANGER})`));
});

test("roles in short: who may do what", async () => {
  const { roleAllows, roleMaySaveSection } = await import("../src/lib/owner-access.js");
  assert.equal(roleAllows("owner", "DELETE", "/api/admin/stations/x"), true);
  assert.equal(roleAllows("support", "GET", "/api/admin/config"), true);
  assert.equal(roleAllows("support", "PUT", "/api/admin/config"), false);
  assert.equal(roleAllows("billing", "PATCH", "/api/admin/licenses/OMNI-1"), true);
  assert.equal(roleAllows("billing", "POST", "/api/admin/archive/arc_1/restore"), false);
  assert.equal(roleAllows("nobody", "GET", "/api/admin/overview"), false);
  assert.equal(roleMaySaveSection("billing", "plans"), true);
  assert.equal(roleMaySaveSection("billing", "access"), false);
});
