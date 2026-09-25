import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { normalizeStationCatalogFields, normalizeStationColor, normalizeHttpsUrl } from "../src/lib/station-fields.js";
import { normalizeStationsData } from "../src/stations-store.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../stations.json", import.meta.url), "utf8"));
const stations = Object.entries(catalog.stations);

test("every catalog station has a real genre and a colour (#267)", () => {
  assert.equal(stations.length, 120);
  for (const [key, station] of stations) {
    assert.ok(station.genre && station.genre !== "Radio", `${key}: genre`);
    assert.match(station.color || "", /^#[0-9A-F]{6}$/, `${key}: colour`);
  }
  const genres = new Set(stations.map(([, station]) => station.genre));
  assert.ok(genres.size >= 10 && genres.size <= 30, `${genres.size} genres keep the browser filter usable`);
});

test("logos and homepages are https links only", () => {
  const withLogo = stations.filter(([, station]) => station.logo);
  assert.ok(withLogo.length >= 10, "the SomaFM channels carry their official logo");
  for (const [key, station] of stations) {
    for (const field of ["logo", "homepage"]) {
      if (station[field]) assert.match(station[field], /^https:\/\//, `${key}: ${field}`);
    }
  }
});

test("the catalog audit fixes are in: no police scanner, no dead streams", () => {
  const urls = new Map(stations.map(([key, station]) => [key, station.url]));
  assert.ok(![...urls.values()].some((url) => /somafm\.com\/scanner|somafm\.com\/7soul|iloveradio103|lw2\.mp3\.tb-group/.test(url)));
  assert.equal(urls.get("pro_tech_20"), "https://stream.technolovers.fm/dark-techno");
});

test("catalog fields are cleaned: bad colours and non-https links are dropped", () => {
  assert.equal(normalizeStationColor("7c3aed"), "#7C3AED");
  assert.equal(normalizeStationColor("#abc"), "");
  assert.equal(normalizeHttpsUrl("http://example.com/logo.png"), "");
  assert.equal(normalizeHttpsUrl("javascript:alert(1)"), "");
  assert.deepEqual(normalizeStationCatalogFields({
    genre: "Techno", color: "red", logo: "http://x/logo.png", homepage: "https://example.com/", country: "DE",
  }), { genre: "Techno", country: "DE", homepage: "https://example.com/" });
  assert.deepEqual(normalizeStationCatalogFields({}), { genre: "Radio" });
});

test("the station store keeps the catalog fields instead of dropping them", () => {
  const data = normalizeStationsData(catalog);
  assert.deepEqual(data.stations.groovesalad, {
    name: "Groove Salad",
    url: "https://ice4.somafm.com/groovesalad-128-mp3",
    tier: "free",
    genre: "Ambient",
    country: "US",
    color: "#14B8A6",
    logo: "https://api.somafm.com/logos/512/groovesalad512.png",
    homepage: "https://somafm.com/groovesalad/",
  });
});
