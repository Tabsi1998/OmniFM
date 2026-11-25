import test from "node:test";
import assert from "node:assert/strict";

// OmniFM Radio DMs (#594) in the owner console: every role sees the mode
// and the last distribution, only the owner switches it, and "off" is the
// kill switch.
import { createOwnerRadioRoutesHandler } from "../src/api/routes/omnifm-radio-routes.js";
import { createOmnifmRadioDmService, createRadioDmModeStore } from "../src/services/omnifm-radio-dm.js";
import { createOmnifmRadioDmStore } from "../src/omnifm-radio-dm-store.js";

const PATH = "/api/owner/radio/dm";

function setup({ dmRunning = true } = {}) {
  const modeStore = createRadioDmModeStore({ getDatabase: () => null, mongoRequested: () => false });
  const dm = createOmnifmRadioDmService({
    getRuntime: () => null,
    store: createOmnifmRadioDmStore({ getDatabase: () => null, mongoRequested: () => false }),
    modeStore,
    env: {},
    getConfig: () => ({ enabled: true, isPublic: false, testGuildIds: [], baseUrl: "https://radio.omnifm.xyz", station: "omnifm_radio" }),
  });
  const audits = [];
  const handler = createOwnerRadioRoutesHandler({
    getService: () => null,
    getDmService: () => (dmRunning ? dm : null),
    resolveIdentity: async (req) => (req.headers["x-test-role"] ? { via: "token", role: req.headers["x-test-role"], actor: "owner" } : null),
    audit: (event) => audits.push(event),
  });
  const call = async (method, body = {}, role = "owner") => {
    const res = { writeHead(status) { this.status = status; }, setHeader() {}, end(payload) { this.body = payload ? JSON.parse(payload) : null; } };
    const headers = role ? { "x-test-role": role } : {};
    const handled = await handler({ req: { method, headers }, res, requestUrl: new URL(`https://omnifm.xyz${PATH}`), readJsonBody: async () => body });
    return { handled, res };
  };
  return { call, modeStore, audits };
}

test("the console reads the mode, where it comes from and the last run", async () => {
  const { call } = setup();
  const { handled, res } = await call("GET");
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.deepEqual(
    { enabled: res.body.enabled, mode: res.body.mode, modeSource: res.body.modeSource, running: res.body.running, lastRun: res.body.lastRun, canChange: res.body.canChange },
    { enabled: true, mode: "owners", modeSource: "default", running: false, lastRun: null, canChange: true },
  );
});

test("the owner switches the mode; off is stored and named in the audit", async () => {
  const { call, modeStore, audits } = setup();
  const off = await call("POST", { mode: "off" });
  assert.equal(off.res.status, 200);
  assert.equal(off.res.body.mode, "off");
  assert.equal(off.res.body.modeSource, "console");
  assert.equal(await modeStore.read(), "off");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "radio.dm.mode");
  assert.equal(audits[0].target, "off");
  assert.equal((await call("POST", { mode: "everyone" })).res.status, 400);
  assert.equal(await modeStore.read(), "off", "an unknown mode changes nothing");
});

test("other roles read but never switch, and nobody without a login", async () => {
  const { call, modeStore } = setup();
  const read = await call("GET", {}, "support");
  assert.equal(read.res.status, 200);
  assert.equal(read.res.body.canChange, false);
  assert.equal((await call("POST", { mode: "off" }, "support")).res.status, 403);
  assert.equal((await call("POST", { mode: "off" }, "billing")).res.status, 403);
  assert.equal((await call("GET", {}, null)).res.status, 401);
  assert.equal(await modeStore.read(), "");
});

test("without the DM service (OmniFM Radio off) the console says so", async () => {
  const { call } = setup({ dmRunning: false });
  const read = await call("GET");
  assert.equal(read.res.status, 200);
  assert.equal(read.res.body.enabled, false);
  assert.equal((await call("POST", { mode: "off" })).res.status, 503);
  assert.equal((await call("DELETE")).res.status, 405);
});
