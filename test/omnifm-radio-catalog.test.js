import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { botTranslator } from "../src/lib/bot-i18n.js";

// OmniFM Radio as a fixed catalog station (#591): never stored, added for the
// servers that may see it, first in their lists; the key is reserved.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-radio-catalog-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
process.env.LOGS_DIR = path.join(dataDir, "logs");
process.env.NOW_PLAYING_RECOGNITION_ENABLED = "0";

const TEST_GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const KEY = "omnifm-radio";
const STREAM_URL = "https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3";

process.env.OMNIFM_RADIO_TEST_GUILD_IDS = TEST_GUILD;
process.env.OMNIFM_RADIO_PUBLIC = "0";
delete process.env.OMNIFM_RADIO_ENABLED;
delete process.env.OMNIFM_RADIO_STATION_KEY;
delete process.env.OMNIFM_RADIO_STREAM_URL;
delete process.env.OMNIFM_RADIO_BASE_URL;
delete process.env.OMNIFM_RADIO_STATION;

fs.writeFileSync(path.join(dataDir, "stations.json"), JSON.stringify({
  defaultStationKey: "groove",
  stations: {
    groove: { name: "Groove Salad", url: "https://radio.example.test/groove.mp3", tier: "free", genre: "Ambient" },
    rockradio: { name: "Rock Radio", url: "https://radio.example.test/rock.mp3", tier: "free", genre: "Rock" },
    zenradio: { name: "Zen Radio", url: "https://radio.example.test/zen.mp3", tier: "free", genre: "Ambient" },
    jazzpro: { name: "Jazz Pro", url: "https://radio.example.test/jazz.mp3", tier: "pro", genre: "Jazz" },
    // A catalog row must never stand in for OmniFM Radio.
    "omnifm-radio": { name: "Fake OmniFM", url: "https://fake.example.test/stream.mp3", tier: "free", genre: "Pop" },
    // Nor a row under another key that plays the OmniFM Radio server.
    sneakyradio: { name: "Sneaky Radio", url: "https://RADIO.omnifm.xyz/listen/omnifm_radio/radio.aac?x=1", tier: "free", genre: "Pop" },
  },
}));

const { loadStations, filterStationsByTier, STATION_CATALOG_MIGRATIONS } = await import("../src/stations-store.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { resolveStationForGuild, normalizeStationReference } = await import("../src/bot/runtime-events.js");
const { buildStationCatalog, buildRuntimeStationsBrowserPayload } = await import("../src/bot/runtime-panels.js");
const { handleRuntimeAutocomplete } = await import("../src/bot/runtime-interactions.js");
const { buildDashboardFallbackStationPreview } = await import("../src/api/helpers/stations.js");
const { createDashboardStationsRouteHandler } = await import("../src/api/routes/dashboard-stations.js");
const { buildPublicStationCatalog } = await import("../src/lib/public-stations.js");
const { automaticFallbackKeysForGuild, resetDownStationKeysForTests } = await import("../src/bot/automatic-fallback.js");
const { buildStationDocument } = await import("../src/lib/owner-stations.js");
const { addGuildStation, updateGuildStation, validateCustomStationUrl } = await import("../src/custom-stations.js");
const { translateCustomStationErrorMessage } = await import("../src/lib/language.js");
const { isOmnifmRadioKey, isOmnifmRadioUrl } = await import("../src/services/omnifm-radio-station.js");
const { fetchStationSnapshot } = await import("../src/services/omnifm-radio-now-playing.js");
const { setOmnifmRadioFetchForTests, clearOmnifmRadioApiCache } = await import("../src/services/omnifm-radio-api.js");
const { setNowPlayingFetchImplementationForTests, clearNowPlayingSnapshotCache } = await import("../src/services/now-playing.js");

setLicenseProvider(() => null);

const runtimeStub = {
  normalizeStationReference: (raw) => normalizeStationReference(null, raw),
  createInteractionTranslator: () => ({ t: botTranslator("en"), language: "en" }),
};

function withEnv(patch, fn) {
  const before = Object.fromEntries(Object.keys(patch).map((name) => [name, process.env[name]]));
  Object.assign(process.env, patch);
  const restore = () => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function freeStationsOf(guildId) {
  return filterStationsByTier(loadStations().stations, "free", { guildId });
}

async function autocompleteValues(guildId) {
  let answer = null;
  await handleRuntimeAutocomplete({
    getGuildAccess: () => ({ allowed: true }),
    checkCommandRolePermission: () => ({ ok: true }),
  }, {
    guildId,
    commandName: "play",
    options: { getFocused: () => ({ name: "station", value: "" }) },
    respond: async (items) => { answer = items; },
  });
  return answer.map((item) => item.value);
}

async function dashboardFreeKeys(guildId) {
  let body = null;
  const handler = createDashboardStationsRouteHandler({
    filterStationsByTier,
    loadStations,
    getCustomStations: () => ({}),
    getDashboardRequestTranslator: () => ({ language: "en" }),
    getDashboardSession: () => ({ session: { id: "session" } }),
    mapDashboardCustomStation: (key, station) => ({ key, ...station }),
    methodNotAllowed: () => { throw new Error("unexpected method answer"); },
    resolveDashboardGuildForSession: () => ({ id: guildId, tier: "free" }),
    sendJson: (_res, _status, payload) => { body = payload; },
    sendLocalizedError: () => { throw new Error("unexpected error answer"); },
    serverHasCapability: () => true,
  });
  await handler({ req: { method: "GET" }, res: {}, requestUrl: new URL(`http://localhost/api/dashboard/stations?serverId=${guildId}`) });
  return body.free.map((station) => station.key);
}

function browserJson(guildId) {
  const payload = buildRuntimeStationsBrowserPayload(runtimeStub, { guildId, applicationId: "1" }, { id: "s1", data: {} });
  return JSON.stringify(payload.components.map((component) => component.toJSON()));
}

test("while OMNIFM_RADIO_PUBLIC=0 a test server gets OmniFM Radio, first in every list", async () => {
  const stations = freeStationsOf(TEST_GUILD);
  assert.equal(Object.keys(stations)[0], KEY);
  const { logo, ...station } = stations[KEY];
  assert.deepEqual(station, {
    name: "OmniFM Radio",
    url: STREAM_URL,
    tier: "free",
    genre: "OmniFM",
    homepage: "https://radio.omnifm.xyz",
  });
  assert.match(logo, /^https:\/\/.+\/brand\/omnifm-discord-avatar-192\.png$/);

  assert.equal(buildStationCatalog(TEST_GUILD).entries[0].key, KEY, "play wizard");
  assert.equal((await autocompleteValues(TEST_GUILD))[0], KEY, "/play autocomplete");
  assert.equal((await dashboardFreeKeys(TEST_GUILD))[0], KEY, "dashboard station list");
  assert.match(browserJson(TEST_GUILD), /OmniFM Radio/, "/stations browser");
  assert.ok(browserJson(TEST_GUILD).indexOf("OmniFM Radio") < browserJson(TEST_GUILD).indexOf("Groove Salad"), "browser: first");
  assert.equal(buildDashboardFallbackStationPreview(TEST_GUILD, KEY).valid, true, "may be chosen as the server's own fallback");

  const played = resolveStationForGuild(runtimeStub, TEST_GUILD, KEY, "en");
  assert.equal(played.ok, true, "/play, dashboard, events and favourites resolve it");
  assert.equal(played.station.url, STREAM_URL);
  assert.equal(played.stations.stations[KEY].name, "OmniFM Radio", "the worker gets it with the scoped catalog");
});

test("while OMNIFM_RADIO_PUBLIC=0 other servers and the website do not get OmniFM Radio, not even by its key", async () => {
  assert.equal(KEY in freeStationsOf(OTHER_GUILD), false);
  assert.equal(KEY in filterStationsByTier(loadStations().stations, "ultimate"), false, "without a server: the catalog only");
  assert.equal(buildStationCatalog(OTHER_GUILD).entries.some((entry) => entry.key === KEY), false);
  assert.equal((await autocompleteValues(OTHER_GUILD)).includes(KEY), false);
  assert.equal((await dashboardFreeKeys(OTHER_GUILD)).includes(KEY), false);
  assert.doesNotMatch(browserJson(OTHER_GUILD), /OmniFM Radio/);
  assert.equal(buildDashboardFallbackStationPreview(OTHER_GUILD, KEY).valid, false);
  assert.equal(resolveStationForGuild(runtimeStub, OTHER_GUILD, KEY, "en").ok, false, "typing the key does not play it");
  assert.equal(buildPublicStationCatalog(loadStations()).stations.some((station) => station.key === KEY), false);
});

test("with OMNIFM_RADIO_PUBLIC=1 every server and the website get OmniFM Radio first", () => withEnv({ OMNIFM_RADIO_PUBLIC: "1" }, () => {
  assert.equal(Object.keys(freeStationsOf(OTHER_GUILD))[0], KEY);
  assert.equal(resolveStationForGuild(runtimeStub, OTHER_GUILD, KEY, "en").ok, true);
  const site = buildPublicStationCatalog(loadStations());
  assert.deepEqual(
    site.stations.map((station) => station.key),
    [KEY, "groove", "rockradio", "zenradio", "jazzpro"],
    "first, then the catalog in its usual order"
  );
  assert.equal(site.freeStations, 4);
}));

test("OMNIFM_RADIO_ENABLED=0 hides OmniFM Radio everywhere, even when public", () => withEnv({ OMNIFM_RADIO_PUBLIC: "1", OMNIFM_RADIO_ENABLED: "0" }, () => {
  assert.equal(KEY in freeStationsOf(TEST_GUILD), false);
  assert.equal(resolveStationForGuild(runtimeStub, TEST_GUILD, KEY, "en").ok, false);
  assert.equal(buildPublicStationCatalog(loadStations()).stations.some((station) => station.key === KEY), false);
}));

test("the automatic fallback never picks OmniFM Radio, not even on a test server", async () => {
  resetDownStationKeysForTests();
  // Same genre would put it first if it were a candidate.
  const keys = await automaticFallbackKeysForGuild(TEST_GUILD, { key: "groove", station: { genre: "OmniFM" } });
  assert.deepEqual(keys, ["rockradio", "zenradio"], "the other Free stations of the catalog, in catalog order");
});

test("nobody can put a station of their own under the OmniFM Radio key", async () => {
  assert.equal(isOmnifmRadioKey("omnifm-radio"), true);
  assert.equal(isOmnifmRadioKey("OmniFM_Radio"), true, "the catalog drops - and _, so these become the same key");
  assert.equal(isOmnifmRadioKey("groove"), false);

  const catalog = loadStations().stations;
  assert.equal(Object.values(catalog).some((station) => station.name === "Fake OmniFM"), false, "a catalog row with the key is ignored");
  assert.equal(Object.keys(catalog).length, 4);

  for (const key of ["omnifm-radio", "omnifm_radio"]) {
    // eslint-disable-next-line no-await-in-loop -- two keys, one after the other
    await assert.rejects(
      buildStationDocument({ key, name: "Fake", url: "https://radio.example.test/fake.mp3" }),
      (error) => error.status === 400 && /OmniFM Radio/.test(error.message),
      `owner editor refuses ${key}`
    );
  }

  const added = await addGuildStation(TEST_GUILD, KEY, "Fake", "https://radio.example.test/fake.mp3");
  assert.equal(added.error, "Station mit Key 'omnifm-radio' existiert bereits.");
  const updated = await updateGuildStation(TEST_GUILD, KEY, "Fake", "https://radio.example.test/fake.mp3");
  assert.equal(updated.error, "Station mit Key 'omnifm-radio' existiert bereits.");

  assert.equal(
    STATION_CATALOG_MIGRATIONS.some((migration) => [migration.key, ...(migration.keys || [])].some((key) => isOmnifmRadioKey(key))),
    false,
    "no catalog migration touches the key"
  );
});

const RADIO_URL_ERROR = "Diese Adresse gehört zu OmniFM Radio und kann kein eigener Sender sein.";

test("nobody can play the OmniFM Radio server under another key: custom station, editor, catalog", async () => {
  const radioUrls = [
    STREAM_URL,
    "https://radio.omnifm.xyz/listen/omnifm_radio/radio.aac?bitrate=64",
    "https://RADIO.OmniFM.XYZ/radio.mp3",
    "http://radio.omnifm.xyz:8000/public/omnifm_radio",
  ];
  for (const url of radioUrls) {
    assert.equal(isOmnifmRadioUrl(url), true, url);
    assert.deepEqual(validateCustomStationUrl(url), { ok: false, error: RADIO_URL_ERROR }, `playing a stored custom station: ${url}`);
    // eslint-disable-next-line no-await-in-loop -- one address after the other
    assert.equal((await addGuildStation(TEST_GUILD, "mine", "Mine", url)).error, RADIO_URL_ERROR, `/addstation: ${url}`);
    // eslint-disable-next-line no-await-in-loop -- one address after the other
    await assert.rejects(
      buildStationDocument({ key: "mine", name: "Mine", url }),
      (error) => error.status === 400 && /OmniFM Radio/.test(error.message),
      `owner editor: ${url}`
    );
  }
  assert.equal(isOmnifmRadioUrl("https://omnifm.xyz/brand/omnifm-mark.svg"), false, "the website is another host");
  assert.equal(isOmnifmRadioUrl("https://radio.example.test/groove.mp3"), false);
  assert.equal(isOmnifmRadioUrl("not a url"), false);
  assert.equal(validateCustomStationUrl("https://radio.example.test/groove.mp3").ok, true);

  withEnv({ OMNIFM_RADIO_PUBLIC: "1" }, () => {
    assert.equal(validateCustomStationUrl(STREAM_URL).ok, false, "also when public: then it is in the catalog anyway");
  });

  assert.equal(Object.values(loadStations().stations).some((station) => station.name === "Sneaky Radio"), false, "a catalog row with the address is ignored");

  assert.equal(translateCustomStationErrorMessage(RADIO_URL_ERROR, "en"), "This address belongs to OmniFM Radio and cannot be a custom station.");
  assert.notEqual(translateCustomStationErrorMessage(RADIO_URL_ERROR, "fr"), "This address belongs to OmniFM Radio and cannot be a custom station.");
});

const METAINT = 16;

function icyFetcher(streamTitle, calls) {
  return async (url) => {
    calls.push(url);
    const text = `StreamTitle='${streamTitle}';`;
    const blocks = Math.ceil(text.length / 16);
    const metadata = Buffer.alloc(blocks * 16, 0);
    metadata.write(text, "utf8");
    const bytes = Buffer.concat([Buffer.alloc(METAINT, 1), Buffer.from([blocks]), metadata, Buffer.alloc(METAINT, 1)]);
    const headers = new Map([["icy-metaint", String(METAINT)]]);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } }),
    };
  };
}

function azuracastAnswer(song) {
  return new Response(JSON.stringify({
    is_online: true,
    listeners: { current: 2 },
    live: { is_live: false, streamer_name: "", broadcast_start: null },
    now_playing: { song },
  }), { status: 200 });
}

test("now playing of OmniFM Radio comes from AzuraCast, from the stream's ICY title when the API fails", async (t) => {
  t.after(() => {
    setOmnifmRadioFetchForTests(null);
    setNowPlayingFetchImplementationForTests(null);
    clearNowPlayingSnapshotCache();
  });
  const streamCalls = [];
  setNowPlayingFetchImplementationForTests(icyFetcher("ICY Artist - ICY Song", streamCalls));

  clearNowPlayingSnapshotCache();
  setOmnifmRadioFetchForTests(async () => azuracastAnswer({ text: "API Artist - API Song", artist: "API Artist", title: "API Song" }));
  const fromApi = await fetchStationSnapshot(KEY, STREAM_URL, { includeCover: false });
  assert.deepEqual(
    [fromApi.artist, fromApi.title, fromApi.displayTitle, fromApi.metadataSource, fromApi.metadataStatus],
    ["API Artist", "API Song", "API Artist - API Song", "azuracast", "ok"]
  );
  assert.equal(streamCalls.length, 0, "the API answered: no stream connection for the title");

  clearNowPlayingSnapshotCache();
  setOmnifmRadioFetchForTests(async () => new Response("down", { status: 503 }));
  const fromIcy = await fetchStationSnapshot(KEY, STREAM_URL, { includeCover: false });
  assert.deepEqual([fromIcy.artist, fromIcy.title, fromIcy.metadataSource], ["ICY Artist", "ICY Song", "icy"]);
  assert.deepEqual(streamCalls, [STREAM_URL]);

  clearNowPlayingSnapshotCache();
  setOmnifmRadioFetchForTests(async () => azuracastAnswer({ text: "", artist: "", title: "" }));
  const emptyApi = await fetchStationSnapshot(KEY, STREAM_URL, { includeCover: false });
  assert.equal(emptyApi.title, "ICY Song", "an answer without a song falls back to ICY too");

  clearNowPlayingSnapshotCache();
  let apiCalls = 0;
  setOmnifmRadioFetchForTests(async () => { apiCalls += 1; return azuracastAnswer({ text: "API Artist - API Song" }); });
  const other = await fetchStationSnapshot("groove", "https://radio.example.test/groove.mp3", { includeCover: false });
  assert.equal(apiCalls, 0, "other stations never ask AzuraCast");
  assert.equal(other.title, "ICY Song");
  clearOmnifmRadioApiCache();
});
