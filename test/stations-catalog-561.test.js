import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

import { applyStationCatalogMigrations, STATION_CATALOG_MIGRATIONS } from "../src/stations-store.js";
import { CATALOG_549_MIGRATIONS, CATALOG_561_MIGRATIONS } from "../src/station-catalog-migrations.js";

// #561: the Hardcore Radio stream (pro_hard_03) only answers HTTP 401, so the
// catalog station is now Happy Hardcore of rautemusik (192 kbit/s MP3, https).

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(fs.readFileSync(path.join(repoRoot, "stations.json"), "utf8"));
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const OLD_URL = "http://shoutcast1.hardcoreradio.nl/";
const migration = CATALOG_561_MIGRATIONS.find((entry) => entry.id === "2026-11-13-catalog-561-pro_hard_03");

test("seed: pro_hard_03 is the Happy Hardcore replacement, same key, plan and genre", () => {
  const station = seed.stations.pro_hard_03;
  assert.equal(station.name, "Happy Hardcore");
  assert.equal(station.url, "https://streams.rautemusik.fm/happyhardcore/mp3-192/");
  assert.equal(station.tier, "pro");
  assert.equal(station.genre, "Hardstyle & Hardcore");
  assert.equal(station.country, "DE");
  assert.equal(station.homepage, "https://www.rm.fm/happyhardcore");
  assert.equal(JSON.stringify(seed).includes("hardcoreradio.nl"), false);
  const urls = Object.values(seed.stations).map((entry) => entry.url);
  assert.equal(urls.filter((url) => url === station.url).length, 1, "the replacement is not in the catalog twice");
});

test("the #561 row has its own id series and ends exactly at the seed station", () => {
  assert.ok(migration, "row for pro_hard_03");
  assert.equal(CATALOG_561_MIGRATIONS.length, 1);
  assert.equal(CATALOG_549_MIGRATIONS.some((entry) => entry.key === "prohard03"), false);
  assert.equal(new Set(STATION_CATALOG_MIGRATIONS.map((entry) => entry.id)).size, STATION_CATALOG_MIGRATIONS.length);
  assert.deepEqual([...migration.keys], ["prohard03", "pro_hard_03"]);
  assert.equal(migration.fromUrl, OLD_URL);
  assert.equal(migration.toUrl, seed.stations.pro_hard_03.url);
  assert.deepEqual({ ...migration.set }, { name: "Happy Hardcore", country: "DE", homepage: "https://www.rm.fm/happyhardcore" });
});

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

function fakeMarkers(initial = []) {
  const markers = new Map(initial.map((id) => [id, { _id: id }]));
  return {
    markers,
    async findOne(filter) { return markers.get(filter._id) || null; },
    async insertOne(document) { markers.set(document._id, document); return { acknowledged: true }; },
  };
}

test("#561 migration: changes only the exact old URL (sanitized and raw key), operator edits stay", async () => {
  const documents = [
    { key: "prohard03", name: "Hardcore", url: OLD_URL, country: "NL", tier: "pro" },
    { key: "pro_hard_03", name: "Hardcore (raw key)", url: OLD_URL, country: "NL" },
    { key: "prohard03", name: "Own", url: "https://operator.example/own.mp3", country: "NL" },
    { key: "someoneelse", name: "Other", url: OLD_URL },
  ];
  await applyStationCatalogMigrations(fakeStations(documents), fakeMarkers());
  for (const index of [0, 1]) {
    assert.equal(documents[index].name, "Happy Hardcore");
    assert.equal(documents[index].url, seed.stations.pro_hard_03.url);
    assert.equal(documents[index].country, "DE");
    assert.equal(documents[index].homepage, "https://www.rm.fm/happyhardcore");
  }
  assert.equal(documents[0].tier, "pro");
  assert.deepEqual(documents[2], { key: "prohard03", name: "Own", url: "https://operator.example/own.mp3", country: "NL" });
  assert.equal(documents[3].url, OLD_URL);
});

test("#561 migration: runs where every #549 marker is already set, and only once", async () => {
  const documents = [{ key: "prohard03", name: "Hardcore", url: OLD_URL, country: "NL" }];
  const stations = fakeStations(documents);
  const markers = fakeMarkers(STATION_CATALOG_MIGRATIONS.filter((entry) => entry !== migration).map((entry) => entry.id));
  const first = await applyStationCatalogMigrations(stations, markers);
  assert.deepEqual(first.applied.map((entry) => entry.id), [migration.id]);
  assert.equal(documents[0].url, seed.stations.pro_hard_03.url);
  assert.ok(markers.markers.has(migration.id));

  documents[0].url = OLD_URL; // going back is not overwritten again
  const second = await applyStationCatalogMigrations(stations, markers);
  assert.equal(second.applied.length, 0);
  assert.equal(documents[0].url, OLD_URL);
});

let client = null;
let database = null;
after(async () => {
  if (database) await database.dropDatabase().catch(() => null);
  if (client) await client.close().catch(() => null);
});

test("#561 migration against MongoDB", { skip: !hasMongoConfig }, async () => {
  client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  database = client.db(`omnifm_catalog561_test_${process.pid}`);
  const stations = database.collection("stations");
  await stations.insertMany([
    { key: "prohard03", name: "Hardcore", url: OLD_URL, country: "NL" },
    { key: "prohard04", name: "Frenchcore", url: seed.stations.pro_hard_04.url },
  ]);
  const markers = database.collection("stations_catalog_migrations");
  await markers.insertMany(STATION_CATALOG_MIGRATIONS.filter((entry) => entry !== migration).map((entry) => ({ _id: entry.id })));
  await applyStationCatalogMigrations(stations, markers);
  await applyStationCatalogMigrations(stations, markers);

  const replaced = await stations.findOne({ key: "prohard03" }, { projection: { _id: 0 } });
  assert.deepEqual(replaced, {
    key: "prohard03", name: "Happy Hardcore", url: seed.stations.pro_hard_03.url, country: "DE", homepage: "https://www.rm.fm/happyhardcore",
  });
  assert.equal((await stations.findOne({ key: "prohard04" })).name, "Frenchcore");
  assert.equal(await markers.countDocuments({ _id: migration.id }), 1);
});
