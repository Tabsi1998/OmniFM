import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { botTranslator } from "../src/lib/bot-i18n.js";

// Season stations (#430, #443): the catalogue field, the rubric in the
// Discord browser and on the website, and /play weihnachten.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-season-stations-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
process.env.LOGS_DIR = path.join(dataDir, "logs");
fs.writeFileSync(path.join(dataDir, "stations.json"), JSON.stringify({
  defaultStationKey: "groove",
  stations: {
    groove: { name: "Groove Salad", url: "https://ice4.somafm.com/groovesalad-128-mp3", tier: "free", genre: "Ambient" },
    xmaslounge: { name: "Christmas Lounge", url: "https://ice4.somafm.com/christmas-128-mp3", tier: "free", genre: "Lounge", seasons: ["christmas", "summer"] },
    jollysoul: { name: "Jolly Ol' Soul", url: "https://ice4.somafm.com/jollysoul-128-mp3", tier: "pro", genre: "Soul", seasons: "christmas" },
    spooky: { name: "Spooky Radio", url: "https://example.org/spooky.mp3", tier: "pro", genre: "Rock", seasons: ["halloween"] },
  },
}));

const { normalizeStationSeasons, normalizeStationCatalogFields } = await import("../src/lib/station-fields.js");
const seasons = await import("../src/lib/seasons.js");
const { loadStations } = await import("../src/stations-store.js");
const { buildBrowserEntries, buildStationBrowserPayload, filterBrowserEntries, SEASON_RUBRIC } = await import("../src/bot/station-browser.js");
const { resolveStationForGuild } = await import("../src/bot/runtime-events.js");
const { buildPublicStationCatalog } = await import("../src/lib/public-stations.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");

const GUILD = "123456789012345678";
const de = botTranslator("de");

test("the catalogue field: Christmas, Easter or Halloween, each once; anything else goes", () => {
  assert.deepEqual(normalizeStationSeasons(["christmas", "Easter", "summer", "christmas"]), ["christmas", "easter"]);
  assert.deepEqual(normalizeStationSeasons("halloween, christmas"), ["halloween", "christmas"]);
  assert.deepEqual(normalizeStationSeasons(null), []);
  assert.equal("seasons" in normalizeStationCatalogFields({ seasons: [] }), false, "an empty list is left out");
  assert.deepEqual(normalizeStationCatalogFields({ seasons: ["easter"] }).seasons, ["easter"]);
  assert.deepEqual(loadStations().stations.xmaslounge.seasons, ["christmas"], "the stored catalogue keeps only real seasons");
});

test("which stations a season brings up, and the words /play understands", () => {
  const at = (iso) => seasons.stationSeasonFor(seasons.seasonAt(new Date(iso), "Europe/Vienna"));
  assert.equal(at("2026-12-06T12:00:00Z"), "christmas", "Advent");
  assert.equal(at("2026-12-28T12:00:00Z"), "christmas", "after Christmas");
  assert.equal(at("2026-10-31T12:00:00Z"), "halloween");
  assert.equal(at("2027-03-28T12:00:00Z"), "easter");
  assert.equal(at("2026-12-31T12:00:00Z"), null, "New Year has no rubric");
  assert.equal(seasons.stationSeasonFromWord("Weihnachten"), "christmas");
  assert.equal(seasons.stationSeasonFromWord("xmas"), "christmas");
  assert.equal(seasons.stationSeasonFromWord("ostern"), "easter");
  assert.equal(seasons.stationSeasonFromWord("halloween"), "halloween");
  assert.equal(seasons.stationSeasonFromWord("groove"), null);
});

test("Discord: in the season its stations come first and get a rubric; locked ones stay locked", () => {
  const stations = loadStations().stations;
  const entries = buildBrowserEntries({ stations, guildTier: "free", seasonTag: "christmas" });
  assert.deepEqual(entries.slice(0, 2).map((entry) => [entry.key, entry.seasonal, entry.locked]), [["xmaslounge", true, false], ["groove", false, false]]);
  const jolly = entries.find((entry) => entry.key === "jollysoul");
  assert.deepEqual([jolly.seasonal, jolly.locked], [true, true], "a Pro station stays locked on Free, with its plan hint");
  assert.deepEqual(filterBrowserEntries(entries, { genre: SEASON_RUBRIC }).map((entry) => entry.key).sort(), ["jollysoul", "xmaslounge"]);

  const payload = buildStationBrowserPayload({
    t: de, prefix: "st:", session: { id: "s1", data: { genre: SEASON_RUBRIC } }, entries, planName: "Free",
    premiumUrl: "https://omnifm.xyz/premium", seasonLabel: "🎄 Weihnachtsradio",
  });
  const json = JSON.stringify(payload.components.map((component) => component.toJSON()));
  assert.match(json, /🎄 Weihnachtsradio/);
  assert.match(json, /"value":"__season__"/);
  assert.match(json, /Christmas Lounge/);
  assert.doesNotMatch(json, /Groove Salad/, "the rubric shows only the season's stations");

  const outOfSeason = buildBrowserEntries({ stations, guildTier: "free" });
  assert.equal(outOfSeason.some((entry) => entry.seasonal), false);
  const plain = JSON.stringify(buildStationBrowserPayload({
    t: de, prefix: "st:", session: { id: "s1", data: {} }, entries: outOfSeason, planName: "Free", premiumUrl: "https://omnifm.xyz/premium",
  }).components.map((component) => component.toJSON()));
  assert.doesNotMatch(plain, /__season__/, "out of season no rubric");
});

test("/play weihnachten plays a Christmas station of the plan; without one it says why", () => {
  setLicenseProvider(() => null);
  const christmas = resolveStationForGuild({}, GUILD, "weihnachten", "de", { random: () => 0.99 });
  assert.equal(christmas.ok, true);
  assert.equal(christmas.key, "xmaslounge", "Free: only the free Christmas station");
  const halloween = resolveStationForGuild({}, GUILD, "halloween", "de");
  assert.deepEqual([halloween.ok, halloween.message], [false, "Dein Plan hat gerade keinen Halloween-Sender."]);
  const easter = resolveStationForGuild({}, GUILD, "easter", "en");
  assert.deepEqual([easter.ok, easter.message], [false, "The catalogue has no Easter station right now."]);
});

test("the website gets the season of each public station", () => {
  const catalog = buildPublicStationCatalog(loadStations());
  assert.deepEqual(catalog.stations.find((station) => station.key === "xmaslounge").seasons, ["christmas"]);
  assert.equal("seasons" in catalog.stations.find((station) => station.key === "groove"), false);
});
