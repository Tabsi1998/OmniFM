import test from "node:test";
import assert from "node:assert/strict";

const licenses = await import("../src/lib/owner-licenses.js");

const NOW = new Date("2026-09-25T12:00:00Z");
const G1 = "111111111111111111";
const G2 = "222222222222222222";
const G3 = "333333333333333333";
const empty = () => ({ licenses: {}, serverEntitlements: {} });

test("a new license: OMNI key, 30 days per month, seats 1 to 5, tier checked", () => {
  const data = empty();
  const created = licenses.addOwnerLicense(data, { email: "a@b.de", tier: "pro", months: 3, seats: 9 }, NOW);
  assert.match(created.licenseKey, /^OMNI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(created.seats, 5);
  assert.equal(created.expiresAt, new Date(NOW.getTime() + 90 * 86_400_000).toISOString());
  assert.deepEqual([created.tier, created.plan, created.active, created.activatedBy], ["pro", "pro", true, "owner"]);
  assert.throws(() => licenses.addOwnerLicense(data, { tier: "free" }, NOW), { status: 400 });
});

test("linking servers: one seat each, a server moves off its old license, bad ids refused", () => {
  const data = empty();
  const a = licenses.addOwnerLicense(data, { tier: "pro", seats: 1 }, NOW).licenseKey;
  const b = licenses.addOwnerLicense(data, { tier: "ultimate", seats: 2 }, NOW).licenseKey;
  licenses.setLicenseServerLinks(data, a, [G1], NOW);
  assert.deepEqual(data.serverEntitlements[G1], { serverId: G1, licenseId: a });
  assert.throws(() => licenses.setLicenseServerLinks(data, a, [G1, G2], NOW), /1 Seat\(s\), angefordert wurden 2/);
  assert.throws(() => licenses.setLicenseServerLinks(data, a, ["123"], NOW), /Ungültige Discord Guild-ID: 123/);
  licenses.setLicenseServerLinks(data, b, [G1, G2], NOW);
  assert.deepEqual(data.licenses[a].linkedServerIds, [], "the server left its old license");
  assert.equal(data.serverEntitlements[G1].licenseId, b);
  licenses.setLicenseServerLinks(data, b, [G2], NOW);
  assert.equal(data.serverEntitlements[G1], undefined, "an unlinked server loses its entitlement");
});

test("changing a license like the owner console does", () => {
  const data = empty();
  const key = licenses.addOwnerLicense(data, { tier: "pro", seats: 2, months: 1 }, NOW).licenseKey;
  const base = Date.parse(data.licenses[key].expiresAt);
  assert.deepEqual(licenses.patchOwnerLicense(data, key, { extendDays: 30 }, NOW), ["expiry+30d"]);
  assert.equal(Date.parse(data.licenses[key].expiresAt), base + 30 * 86_400_000);
  assert.deepEqual(licenses.patchOwnerLicense(data, key, { extendDays: -60 }, NOW), ["expiry-60d"]);
  licenses.patchOwnerLicense(data, key, { addServerId: G1 }, NOW);
  licenses.patchOwnerLicense(data, key, { addServerId: G2 }, NOW);
  assert.throws(() => licenses.patchOwnerLicense(data, key, { seats: 1 }, NOW), /nicht unter die 2 verknüpften Server/);
  assert.throws(() => licenses.patchOwnerLicense(data, key, { tier: "gold" }, NOW), { status: 400 });
  assert.throws(() => licenses.patchOwnerLicense(data, key, { expiresAt: "morgen" }, NOW), /Ungültiges Ablaufdatum/);
  assert.throws(() => licenses.patchOwnerLicense(data, "OMNI-NOPE", {}, NOW), { status: 404 });
  licenses.patchOwnerLicense(data, key, { removeServerId: G1, tier: "ultimate", email: "x@y.de" }, NOW);
  assert.deepEqual(data.licenses[key].linkedServerIds, [G2]);
  assert.deepEqual([data.licenses[key].tier, data.licenses[key].contactEmail], ["ultimate", "x@y.de"]);
  licenses.patchOwnerLicense(data, key, { expireNow: true }, NOW);
  assert.equal(licenses.isLicenseExpired(data.licenses[key], NOW.getTime()), true);
});

test("the lists: masked for the short one, full with how each server resolves", () => {
  const data = empty();
  const key = licenses.addOwnerLicense(data, { email: "owner@example.org", tier: "pro", seats: 2 }, NOW).licenseKey;
  licenses.setLicenseServerLinks(data, key, [G1, G3], NOW);
  const [short] = licenses.licenseRows(data, NOW.getTime());
  assert.equal(short.contactEmail, "ow***@example.org");
  assert.equal(short.planName, "Pro");
  const [full] = licenses.adminLicenseRows(data, { [G1]: { name: "Verein", memberCount: 40, bots: ["OmniFM 1"] } }, NOW.getTime());
  assert.equal(full.email, "owner@example.org");
  assert.deepEqual(full.linkedServers.map((server) => [server.name, server.known, server.licenseResolved, server.effectivePlan, server.resolutionSource]), [
    ["Verein", true, true, "pro", "serverEntitlement"],
    [G3, false, true, "pro", "serverEntitlement"],
  ]);
  assert.equal(licenses.remainingLicenseDays(data.licenses[key], NOW.getTime()), 31, "30 days left count as 31, like FastAPI");
});
