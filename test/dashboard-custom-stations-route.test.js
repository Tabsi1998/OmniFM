import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

// The dashboard route for a server's own stations (#541): an edit keeps the
// key, the logo and what the form did not send; it needs the same rights as
// every other change, and a refused URL leaves the station as it was.
const tempDir = await mkdtemp(path.join(os.tmpdir(), "omnifm-custom-route-"));
process.env.OMNIFM_CUSTOM_STATIONS_FILE = path.join(tempDir, "custom-stations.json");
const store = await import("../src/custom-stations.js");
const { createDashboardCustomStationsRouteHandler } = await import("../src/api/routes/dashboard-custom-stations.js");
const { mapDashboardCustomStation } = await import("../src/api/helpers/license.js");
const { clipText } = await import("../src/lib/helpers.js");
const { languagePick, translateCustomStationErrorMessage } = await import("../src/lib/language.js");

test.after(() => rm(tempDir, { recursive: true, force: true }));

const GUILD = "123456789012345678";
const OTHER_GUILD = "223456789012345678";

function route({ capabilities = ["dashboard_basic", "custom_station_urls"], signedIn = true } = {}) {
  const answers = [];
  const handle = createDashboardCustomStationsRouteHandler({
    addCustomStation: store.addGuildStation,
    clipText,
    getCustomStations: store.getGuildStations,
    getDashboardRequestTranslator: () => ({ language: "de" }),
    getDashboardSession: () => ({ session: signedIn ? { user: { id: "111111111111111111" } } : null }),
    languagePick,
    mapDashboardCustomStation,
    methodNotAllowed: (_res, methods) => answers.push({ status: 405, body: { methods } }),
    removeCustomStation: store.removeGuildStation,
    resolveDashboardGuildForSession: (_session, id) => (id === GUILD ? { id: GUILD, tier: "ultimate" } : null),
    sendJson: (_res, status, body) => answers.push({ status, body }),
    sendLocalizedError: (_res, status, _language, german) => answers.push({ status, body: { error: german } }),
    serverHasCapability: (_guildId, capability) => capabilities.includes(capability),
    translateCustomStationErrorMessage,
    updateCustomStation: store.updateGuildStation,
  });
  const send = async (method, body = null, { serverId = GUILD, query = "" } = {}) => {
    const handled = await handle({
      req: { method },
      res: {},
      requestUrl: new URL(`https://omnifm.test/api/dashboard/custom-stations?serverId=${serverId}${query}`),
      readJsonBody: async () => body,
    });
    assert.equal(handled, true);
    return answers.at(-1);
  };
  return { send };
}

test("an edit keeps the key, the logo, genre, folder and tags; only name and URL change (#541)", async () => {
  store.clearGuildStations(GUILD);
  const { send } = route();
  const created = await send("POST", { key: "nightwave", name: "Nightwave FM", url: "https://1.1.1.1/live", genre: "Synthwave", folder: "Night", tags: "night, synth" });
  assert.equal(created.status, 201);
  assert.equal(store.setGuildStationLogoVersion(GUILD, "nightwave", 1_700_000_000_000), true);
  const addedAt = store.getGuildStations(GUILD).nightwave.addedAt;

  // The dashboard sends key, name and URL only.
  const updated = await send("PUT", { key: "nightwave", name: "Nightwave Live", url: "https://1.0.0.1/stream.mp3" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.station.key, "nightwave");
  assert.equal(updated.body.station.name, "Nightwave Live");
  assert.equal(updated.body.station.url, "https://1.0.0.1/stream.mp3");
  assert.equal(updated.body.station.genre, "Synthwave");
  assert.equal(updated.body.station.folder, "Night");
  assert.deepEqual(updated.body.station.tags, ["night", "synth"]);
  assert.match(updated.body.station.logoUrl, /\/api\/station-logos\/123456789012345678\/nightwave\.png\?v=1700000000000$/);

  const stored = store.getGuildStations(GUILD);
  assert.deepEqual(Object.keys(stored), ["nightwave"], "no second station, no new key");
  assert.equal(stored.nightwave.logoUpdatedAt, 1_700_000_000_000);
  assert.equal(stored.nightwave.addedAt, addedAt);
});

test("a refused URL or an unknown key changes nothing (#541)", async () => {
  store.clearGuildStations(GUILD);
  const { send } = route();
  await send("POST", { key: "nightwave", name: "Nightwave FM", url: "https://1.1.1.1/live" });

  const privateTarget = await send("PUT", { key: "nightwave", name: "Nightwave FM", url: "http://127.0.0.1/stream" });
  assert.equal(privateTarget.status, 400);
  assert.match(privateTarget.body.error, /privat/i);
  const invalid = await send("PUT", { key: "nightwave", url: "ftp://radio.example/stream" });
  assert.equal(invalid.status, 400);
  assert.equal(store.getGuildStations(GUILD).nightwave.url, "https://1.1.1.1/live");

  const unknown = await send("PUT", { key: "does-not-exist", name: "X", url: "https://1.1.1.1/live" });
  assert.equal(unknown.status, 404);
  const noKey = await send("PUT", { name: "X", url: "https://1.1.1.1/live" });
  assert.equal(noKey.status, 400);
  assert.deepEqual(Object.keys(store.getGuildStations(GUILD)), ["nightwave"], "a missing key never creates a station");
});

test("only a signed-in admin of an Ultimate server may edit (#541)", async () => {
  store.clearGuildStations(GUILD);
  await route().send("POST", { key: "nightwave", name: "Nightwave FM", url: "https://1.1.1.1/live" });
  const edit = { key: "nightwave", name: "Hijacked", url: "https://1.0.0.1/other" };

  assert.equal((await route({ signedIn: false }).send("PUT", edit)).status, 401);
  assert.equal((await route().send("PUT", edit, { serverId: OTHER_GUILD })).status, 403, "a server the session does not manage");
  const pro = await route({ capabilities: ["dashboard_basic"] }).send("PUT", edit);
  assert.equal(pro.status, 403);
  assert.match(pro.body.error, /Ultimate/);
  assert.equal((await route({ capabilities: [] }).send("PUT", edit)).status, 403);
  assert.equal(store.getGuildStations(GUILD).nightwave.name, "Nightwave FM");
});
