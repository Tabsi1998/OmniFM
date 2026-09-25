import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const nav = await import("../frontend/src/lib/ownerNavigation.js");
const { OWNER_STATUS_CHECKS } = await import("../src/services/owner-status/checks.js");

const configSource = fs.readFileSync(new URL("../frontend/src/components/OwnerConfig.js", import.meta.url), "utf8");
const adminSource = fs.readFileSync(new URL("../frontend/src/components/OwnerAdmin.js", import.meta.url), "utf8");

test("six areas, every page in exactly one of them, the duplicates gone", () => {
  assert.deepEqual(nav.OWNER_AREAS.map((area) => area.label), ["Cockpit", "Server & Lizenzen", "Sender", "Bots & Discord", "Einstellungen", "Protokolle"]);
  const ids = nav.OWNER_PAGES.map((page) => page.id);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], "no page in two areas");
  assert.ok(!ids.includes("integrations"), "the integration list lives in the cockpit only");
  assert.ok(!ids.includes("system"), "the system settings are spread over their pages");
  assert.doesNotMatch(adminSource, /overview-integrations|integrations-config/, "no second integration list in the overview");
  assert.equal(nav.areaOfPage("does-not-exist"), "cockpit");
});

test("every setting on exactly one page: each field once, each system part has its page", () => {
  const fieldIds = [...configSource.matchAll(/testid="(cfg-[a-z0-9-]+)"/g)].map((match) => match[1])
    .filter((id) => !id.endsWith("-save"));
  const twice = fieldIds.filter((id, index) => fieldIds.indexOf(id) !== index);
  assert.deepEqual(twice, [], "a field id appears twice in the settings");
  const parts = [...configSource.matchAll(/show\('([a-z]+)'\)/g)].map((match) => match[1]);
  const cfgPages = nav.OWNER_PAGES.filter((page) => nav.systemPartOf(page.id)).map((page) => nav.systemPartOf(page.id));
  assert.deepEqual([...parts].sort(), [...cfgPages].sort(), "every part of the system settings has its page and no page is empty");
});

test("the cockpit's 'Einstellen' leads to a real page", () => {
  const ids = new Set(nav.OWNER_PAGES.map((page) => page.id));
  for (const check of OWNER_STATUS_CHECKS) {
    if (check.area !== null) assert.ok(ids.has(check.area), `${check.key} leads to ${check.area}`);
  }
});

test("the search finds a setting by what people type", () => {
  const find = (query) => nav.searchOwnerPages(query).map((page) => page.id);
  assert.ok(find("smtp").includes("cfg-email"));
  assert.ok(find("Stripe").includes("payments"));
  assert.ok(find("top.gg").includes("cfg-directories"));
  assert.ok(find("redirect").includes("cfg-login"));
  assert.ok(find("impressum").includes("company"));
  assert.deepEqual(find("x"), [], "one letter finds nothing yet");
});
