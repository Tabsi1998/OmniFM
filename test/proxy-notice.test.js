import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A proxy in front that backend/.env does not name (#484): every visitor
// would count as the proxy, with one request budget for all.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-proxy-notice-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
delete process.env.TRUST_PROXY_HEADERS;
delete process.env.TRUSTED_PROXY_IPS;

const notice = await import("../src/lib/proxy-notice.js");
const { enforceApiRateLimit } = await import("../src/lib/api-rate-limit.js");
const { checkProxy } = await import("../src/services/owner-status/checks.js");

function fakeDb(doc = null) {
  const writes = [];
  return {
    writes,
    collection: () => ({
      updateOne: async (filter, update) => { writes.push({ filter, update }); return { acknowledged: true }; },
      findOne: async () => doc,
    }),
  };
}

test("only an internal address counts as a proxy, and each is logged once, written at most every ten minutes", () => {
  notice.resetProxyNotice();
  const db = fakeDb();
  for (const address of ["192.168.2.100", "10.0.0.5", "127.0.0.1", "::1", "100.64.0.1", "fd00::1"]) {
    assert.equal(notice.isInternalAddress(address), true, address);
  }
  assert.equal(notice.isInternalAddress("87.247.213.69"), false, "from the internet the header may be made up");
  assert.equal(notice.noteUntrustedProxy("87.247.213.69", { db }), false);

  const start = Date.parse("2026-10-02T16:00:00Z");
  assert.equal(notice.noteUntrustedProxy("192.168.2.100", { db, now: start }), true);
  assert.equal(notice.noteUntrustedProxy("192.168.2.100", { db, now: start + 60_000 }), true);
  assert.equal(db.writes.length, 1, "not on every request");
  assert.deepEqual(db.writes[0].update.$set, { address: "192.168.2.100", lastSeenAt: new Date(start) });
  notice.noteUntrustedProxy("192.168.2.100", { db, now: start + 11 * 60_000 });
  assert.equal(db.writes.length, 2);
});

test("the rate limiter notes a forwarded request it does not trust", () => {
  notice.resetProxyNotice();
  const res = { statusCode: 0, setHeader() {}, writeHead(status) { this.statusCode = status; }, end() {} };
  const forwarded = { socket: { remoteAddress: "::ffff:192.168.2.100" }, headers: { "x-forwarded-for": "203.0.113.9" } };
  assert.equal(enforceApiRateLimit(forwarded, res, "/api/stats"), true);
  const direct = { socket: { remoteAddress: "203.0.113.10" }, headers: {} };
  assert.equal(enforceApiRateLimit(direct, res, "/api/stats"), true);
  assert.equal(notice.noteUntrustedProxy("192.168.2.100"), true, "the address is known after the forwarded request");
});

test("the owner cockpit: yellow with the two lines while a proxy is untrusted, green otherwise", async () => {
  const now = Date.parse("2026-10-02T16:00:00Z");
  const fresh = await checkProxy({ db: fakeDb({ address: "192.168.2.100", lastSeenAt: new Date(now - 5 * 60_000) }), now });
  assert.equal(fresh.state, "warn");
  assert.match(fresh.summary, /192\.168\.2\.100/);
  assert.equal(fresh.detail, "TRUST_PROXY_HEADERS=1\nTRUSTED_PROXY_IPS=192.168.2.100");

  const local = await checkProxy({ db: fakeDb({ address: "127.0.0.1", lastSeenAt: new Date(now) }), now });
  assert.equal(local.detail, "TRUST_PROXY_HEADERS=1\nTRUSTED_PROXY_IPS=127.0.0.1,::1", "nginx on the same machine");

  assert.equal((await checkProxy({ db: fakeDb({ address: "192.168.2.100", lastSeenAt: new Date(now - 3 * 3_600_000) }), now })).state, "ok",
    "an old sighting: the proxy has been named since");
  assert.equal((await checkProxy({ db: fakeDb(null), now })).state, "ok");
  assert.equal((await checkProxy({ db: null, now })).state, "warn");
});
