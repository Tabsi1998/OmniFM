import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// What the imprint, the privacy policy and the terms must say (#424): one
// list for the owner console, the cockpit and the public answers.
const req = await import("../src/config/legal-requirements.js");
const pub = await import("../src/lib/owner-public.js");
const { checkLegal, OWNER_STATUS_CHECKS } = await import("../src/services/owner-status/checks.js");

const companyDefaults = JSON.parse(fs.readFileSync(new URL("../src/config/owner-config-defaults.json", import.meta.url), "utf8")).company;
const ownerConfigSource = fs.readFileSync(new URL("../frontend/src/components/OwnerConfig.js", import.meta.url), "utf8");

// A sole trader with everything that has to be there.
const COMPLETE = {
  providerName: "Max Mustermann", streetAddress: "Musterstraße 1", postalCode: "4020", city: "Linz",
  email: "hallo@omnifm.xyz", mediaOwner: "Max Mustermann, Linz", effectiveDate: "01.10.2026",
};
const DOES_NOT_APPLY = ["commercialRegister", "supervisoryAuthority", "profession", "vatId", "dpo"];

const answersFor = (company, env = {}) => ({
  legal: pub.legalNotice({ company }, env),
  privacy: pub.privacyNotice({ company }, env),
  terms: pub.termsNotice({ company }, env),
});
const stateOf = (items, key) => items.find((item) => item.key === key).state;
const lightOf = (items, page) => req.legalPageLight(items.filter((item) => item.page === page));

test("every requirement has its page, level and reason, and fields the owner console can fill", () => {
  const pages = new Set(req.LEGAL_PAGES.map((page) => page.key));
  for (const item of req.LEGAL_REQUIREMENTS) {
    assert.ok(pages.has(item.page), item.key);
    assert.ok(["required", "conditional", "optional"].includes(item.level), item.key);
    assert.ok(item.label && item.why, item.key);
    const parts = [].concat(item.value({}));
    assert.ok(item.fields.length === 0 || parts.length <= item.fields.length, `${item.key}: every part has its field`);
    for (const field of item.fields) {
      assert.ok(field in companyDefaults, `${item.key}: ${field} is a company setting`);
      assert.ok(ownerConfigSource.includes(`setC('${field}'`), `${item.key}: the owner console has an input for ${field}`);
    }
  }
  assert.equal(new Set(req.LEGAL_REQUIREMENTS.map((item) => item.key)).size, req.LEGAL_REQUIREMENTS.length, "every key once");
  assert.deepEqual(companyDefaults.legalNotApplicable, [], "nothing is marked as not applying at first");
});

test("the checklist: filled is ok, required and empty is missing, conditional stays open until it does not apply", () => {
  const empty = req.legalChecklist(answersFor({}));
  assert.equal(stateOf(empty, "providerName"), "missing");
  assert.equal(stateOf(empty, "address"), "missing");
  assert.equal(stateOf(empty, "mediaOwner"), "missing");
  assert.equal(stateOf(empty, "effectiveDate"), "missing");
  assert.equal(stateOf(empty, "businessPurpose"), "ok", "the default purpose counts");
  assert.equal(stateOf(empty, "authority"), "ok", "the data protection authority is always named");
  assert.equal(stateOf(empty, "governingLaw"), "ok", "Austrian law by default");
  assert.equal(stateOf(empty, "vatId"), "open");
  assert.equal(stateOf(empty, "phone"), "optional");
  assert.equal(lightOf(empty, "imprint"), "red");

  const filled = req.legalChecklist(answersFor(COMPLETE));
  assert.equal(lightOf(filled, "imprint"), "yellow", "UID number, register and trade licence are still open");
  assert.equal(lightOf(filled, "disclosure"), "green");

  const done = req.legalChecklist(answersFor(COMPLETE), DOES_NOT_APPLY);
  assert.deepEqual(done.filter((item) => ["missing", "open"].includes(item.state)).map((item) => item.key), []);
  assert.equal(stateOf(done, "vatId"), "na");
  for (const page of req.LEGAL_PAGES) assert.equal(lightOf(done, page.key), "green", page.key);
});

test("the public answers' missingCoreFields come from the same list", () => {
  assert.deepEqual(pub.legalNotice({}, {}).missingCoreFields, ["providerName", "streetAddress", "postalCode", "city", "email", "mediaOwner"]);
  assert.deepEqual(pub.privacyNotice({}, {}).missingCoreFields, ["providerName", "streetAddress", "postalCode", "city", "email"]);
  assert.deepEqual(pub.termsNotice({ company: { ...COMPLETE, effectiveDate: "" } }, {}).missingCoreFields, ["effectiveDate"]);

  const complete = answersFor(COMPLETE);
  assert.deepEqual([complete.legal.isConfigured, complete.privacy.isConfigured, complete.terms.isConfigured], [true, true, true]);
  assert.equal(
    pub.legalNotice({ company: { ...COMPLETE, mediaOwner: "" } }, { LEGAL_MEDIA_OWNER: "Maria Muster, Wien" }).isConfigured,
    true,
    "a value from the environment counts like one from the owner console",
  );
});

test("the cockpit: missing data and open points are yellow, never red", () => {
  const missing = checkLegal({ ownerConfig: { company: { ...COMPLETE, mediaOwner: "", effectiveDate: "" } }, env: {} });
  assert.equal(missing.state, "warn");
  assert.equal(missing.summary, "2 Pflichtangaben fehlen: Medieninhaber mit Wohnort bzw. Sitz, Gültig ab.");
  assert.match(missing.detail, /✕ fehlt: Gültig ab \(Nutzungsbedingungen\)/);

  const open = checkLegal({ ownerConfig: { company: COMPLETE }, env: {} });
  assert.equal(open.state, "warn");
  assert.match(open.summary, /^5 Punkte sind offen/);

  const done = checkLegal({ ownerConfig: { company: { ...COMPLETE, legalNotApplicable: DOES_NOT_APPLY } }, env: {} });
  assert.equal(done.state, "ok");
  assert.deepEqual(OWNER_STATUS_CHECKS.find((check) => check.key === "legal"), { key: "legal", label: "Rechtliches", area: "company" });
});
