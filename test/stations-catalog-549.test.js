import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

import { applyStationCatalogMigrations, STATION_CATALOG_MIGRATIONS } from "../src/stations-store.js";
import { CATALOG_549_MIGRATIONS } from "../src/station-catalog-migrations.js";

// Catalog clean-up #549: the shipped seed and the live migration that follows it.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(fs.readFileSync(path.join(repoRoot, "stations.json"), "utf8"));
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

// Reachable only over http (checked 12 Nov 2026); every other stream must be https.
const HTTP_ONLY_ALLOW_LIST = new Set([
  "pro_tech_05", "pro_tech_08", "pro_tech_09", "pro_tech_14", "pro_hard_03", "pro_house_09",
]);

test("seed catalog: no SomaFM, no http except the allow-list, no token, no tracking tail", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "stations.json"), "utf8");
  assert.equal(/somafm/i.test(raw), false, "SomaFM blocks non-browser clients");

  const httpKeys = [];
  for (const [key, station] of Object.entries(seed.stations)) {
    if (station.url.startsWith("http://")) httpKeys.push(key);
    assert.equal(station.url.includes("rj-tok="), false, `${key}: expiring token`);
    assert.equal(station.url.includes("?ref="), false, `${key}: tracking tail`);
    assert.equal(/\/mp3-192\/streams?\.(sunshine-live|radiobob)\.de\/?$/.test(station.url), false, `${key}: path remnant`);
  }
  assert.deepEqual(httpKeys.sort(), [...HTTP_ONLY_ALLOW_LIST].sort());
});

test("every #549 migration ends exactly at the seed station", () => {
  assert.ok(CATALOG_549_MIGRATIONS.length > 0);
  const ids = new Set();
  for (const migration of CATALOG_549_MIGRATIONS) {
    assert.equal(ids.has(migration.id), false, `duplicate id ${migration.id}`);
    ids.add(migration.id);
    const seedKey = migration.keys.find((key) => seed.stations[key]);
    assert.ok(seedKey, `${migration.id}: key not in seed`);
    const station = seed.stations[seedKey];
    assert.equal(station.url, migration.toUrl, migration.id);
    assert.notEqual(migration.fromUrl, migration.toUrl, migration.id);
    for (const [field, value] of Object.entries(migration.set || {})) assert.equal(station[field], value, `${migration.id}.${field}`);
    for (const field of migration.unset || []) assert.equal(field in station, false, `${migration.id}.${field}`);
  }
});

test("keys list the sanitized form first, and the raw seed key when it differs", () => {
  const migration = CATALOG_549_MIGRATIONS.find((entry) => entry.id.endsWith("-pro_edm_02"));
  assert.deepEqual([...migration.keys], ["proedm02", "pro_edm_02"]);
  const plain = CATALOG_549_MIGRATIONS.find((entry) => entry.id.endsWith("-groovesalad"));
  assert.deepEqual([...plain.keys], ["groovesalad"]);
});

// A small stand-in for the stations collection that understands $set and $unset.
function fakeStations(documents) {
  return {
    async updateMany(filter, update) {
      let matchedCount = 0;
      for (const document of documents) {
        if (!filter.key.$in.includes(document.key) || document.url !== filter.url) continue;
        matchedCount += 1;
        Object.assign(document, update.$set);
        for (const field of Object.keys(update.$unset || {})) delete document[field];
      }
      return { acknowledged: true, matchedCount, modifiedCount: matchedCount };
    },
  };
}

function fakeMarkers() {
  const markers = new Map();
  return {
    markers,
    async findOne(filter) { return markers.get(filter._id) || null; },
    async insertOne(document) { markers.set(document._id, document); return { acknowledged: true }; },
  };
}

const groove = CATALOG_549_MIGRATIONS.find((entry) => entry.id.endsWith("-groovesalad"));
const bigfm = CATALOG_549_MIGRATIONS.find((entry) => entry.id.endsWith("-pro_edm_02"));

test("#549 migration: replaces a SomaFM row, sets name/country/homepage, unsets the logo", async () => {
  const documents = [
    { key: "groovesalad", name: "Groove Salad", url: groove.fromUrl, country: "US", logo: "https://api.somafm.com/logos/512/groovesalad512.png", homepage: "https://somafm.com/groovesalad/", tier: "free" },
  ];
  await applyStationCatalogMigrations(fakeStations(documents), fakeMarkers());
  assert.deepEqual(documents[0], {
    key: "groovesalad", name: seed.stations.groovesalad.name, url: seed.stations.groovesalad.url,
    country: seed.stations.groovesalad.country, homepage: seed.stations.groovesalad.homepage, tier: "free",
  });
});

test("#549 migration: only exact old URLs change, operator edits stay, other stations stay", async () => {
  const documents = [
    { key: "groovesalad", name: "My own name", url: "https://operator.example/own.mp3", logo: "https://operator.example/logo.png" },
    { key: "proedm02", name: "bigFM EDM", url: bigfm.fromUrl },
    { key: "pro_edm_02", name: "bigFM EDM (raw key)", url: bigfm.fromUrl },
    { key: "someoneelse", name: "Other", url: bigfm.fromUrl },
  ];
  await applyStationCatalogMigrations(fakeStations(documents), fakeMarkers());
  assert.deepEqual(documents[0], { key: "groovesalad", name: "My own name", url: "https://operator.example/own.mp3", logo: "https://operator.example/logo.png" });
  assert.equal(documents[1].url, bigfm.toUrl);
  assert.equal(documents[1].name, "bigFM EDM", "URL-only migration keeps other fields");
  assert.equal(documents[2].url, bigfm.toUrl);
  assert.equal(documents[3].url, bigfm.fromUrl);
});

test("#549 migration: runs once per station, each with its own marker", async () => {
  const documents = [{ key: "proedm02", url: bigfm.fromUrl }];
  const stations = fakeStations(documents);
  const markers = fakeMarkers();
  const first = await applyStationCatalogMigrations(stations, markers);
  assert.equal(first.applied.length, STATION_CATALOG_MIGRATIONS.length);
  assert.ok(markers.markers.has(bigfm.id));
  assert.equal(markers.markers.size, STATION_CATALOG_MIGRATIONS.length);

  documents[0].url = bigfm.fromUrl; // going back to the old URL is not overwritten again
  const second = await applyStationCatalogMigrations(stations, markers);
  assert.equal(second.applied.length, 0);
  assert.equal(documents[0].url, bigfm.fromUrl);
});

let client = null;
let database = null;
after(async () => {
  if (database) await database.dropDatabase().catch(() => null);
  if (client) await client.close().catch(() => null);
});

test("#549 migration against MongoDB: $set and $unset apply together", { skip: !hasMongoConfig }, async () => {
  client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  database = client.db(`omnifm_catalog549_test_${process.pid}`);
  const stations = database.collection("stations");
  await stations.insertMany([
    { key: "groovesalad", name: "Groove Salad", url: groove.fromUrl, country: "US", logo: "https://api.somafm.com/logos/512/groovesalad512.png", homepage: "https://somafm.com/groovesalad/" },
    { key: "dronezone", name: "Drone Zone", url: "https://operator.example/own.mp3", logo: "https://operator.example/logo.png" },
    { key: "proedm02", name: "bigFM EDM", url: bigfm.fromUrl },
  ]);
  const markers = database.collection("stations_catalog_migrations");
  await applyStationCatalogMigrations(stations, markers);
  await applyStationCatalogMigrations(stations, markers);

  const groovesalad = await stations.findOne({ key: "groovesalad" }, { projection: { _id: 0 } });
  assert.deepEqual(groovesalad, {
    key: "groovesalad", name: seed.stations.groovesalad.name, url: seed.stations.groovesalad.url,
    country: seed.stations.groovesalad.country, homepage: seed.stations.groovesalad.homepage,
  });
  const drone = await stations.findOne({ key: "dronezone" }, { projection: { _id: 0 } });
  assert.equal(drone.url, "https://operator.example/own.mp3");
  assert.equal(drone.logo, "https://operator.example/logo.png");
  assert.equal((await stations.findOne({ key: "proedm02" })).url, bigfm.toUrl);
  assert.equal(await markers.countDocuments({ _id: groove.id }), 1);
});

// File fallback (no MongoDB, or runtime-data/stations.json preferred): same rows.
async function runFileMigration(catalog) {
  const { migrateStationsFileCatalog } = await import("../src/stations-store.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-549-file-"));
  const file = path.join(dir, "stations.json");
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2), "utf8");
  const first = migrateStationsFileCatalog(file);
  const afterFirst = fs.readFileSync(file, "utf8");
  const second = migrateStationsFileCatalog(file);
  const result = { first, second, data: JSON.parse(afterFirst), unchanged: fs.readFileSync(file, "utf8") === afterFirst };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test("#549 file fallback: replaced station, URL-only change, operator override, second run", async () => {
  const { first, second, data, unchanged } = await runFileMigration({
    defaultStationKey: "groovesalad",
    stations: {
      groovesalad: { name: "Groove Salad", url: groove.fromUrl, tier: "free", country: "US", logo: "https://api.somafm.com/logos/512/groovesalad512.png", homepage: "https://somafm.com/groovesalad/", note: "keep" },
      dronezone: { name: "Own Drone", url: "https://operator.example/own.mp3", tier: "free", logo: "https://operator.example/logo.png" },
      pro_edm_02: { name: "bigFM EDM", url: bigfm.fromUrl, tier: "pro" },
      other: { name: "Other", url: bigfm.fromUrl, tier: "free" },
    },
  });
  assert.deepEqual(first, { changed: true, matchedCount: 2 });
  assert.deepEqual(data.stations.groovesalad, {
    name: seed.stations.groovesalad.name, url: seed.stations.groovesalad.url, tier: "free",
    country: seed.stations.groovesalad.country, homepage: seed.stations.groovesalad.homepage, note: "keep",
  });
  assert.deepEqual(data.stations.dronezone, { name: "Own Drone", url: "https://operator.example/own.mp3", tier: "free", logo: "https://operator.example/logo.png" });
  assert.deepEqual(data.stations.pro_edm_02, { name: "bigFM EDM", url: bigfm.toUrl, tier: "pro" });
  assert.equal(data.stations.other.url, bigfm.fromUrl);
  assert.deepEqual(second, { changed: false, matchedCount: 0 });
  assert.equal(unchanged, true);
});
