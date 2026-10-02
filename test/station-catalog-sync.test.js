import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  catalogUpdatesFor,
  fillStationCatalogFields,
  purgeDemoData,
  seedStationsIfEmpty,
} from "../src/lib/station-catalog-sync.js";
import { normalizeStationCatalogFields } from "../src/lib/station-fields.js";

// What FastAPI's start did to the station catalogue until #291, now
// scripts/database.mjs prepare: the shipped stations into an empty MongoDB,
// the catalogue fields the owner left empty, the stream fixes only where
// the old value is still stored.
const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeDb(collections = {}) {
  const data = Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const rowsOf = (name) => (data[name] ||= []);
  const matches = (row, query) => Object.entries(query).every(([field, wanted]) => {
    if (wanted && typeof wanted === "object" && "$in" in wanted) return wanted.$in.includes(row[field]);
    if (wanted && typeof wanted === "object" && "$regex" in wanted) return new RegExp(wanted.$regex, wanted.$options).test(String(row[field] ?? ""));
    return row[field] === wanted;
  });
  return {
    data,
    collection: (name) => ({
      countDocuments: async (query = {}) => rowsOf(name).filter((row) => matches(row, query)).length,
      find: (query = {}) => ({ toArray: async () => rowsOf(name).filter((row) => matches(row, query)) }),
      updateOne: async (filter, update) => {
        const row = rowsOf(name).find((candidate) => matches(candidate, filter));
        if (row) Object.assign(row, update.$set);
        return { matchedCount: row ? 1 : 0 };
      },
      bulkWrite: async (operations) => {
        let upsertedCount = 0;
        for (const { updateOne: { filter, update } } of operations) {
          if (rowsOf(name).some((row) => matches(row, filter))) continue;
          rowsOf(name).push({ _id: `id-${rowsOf(name).length}`, ...update.$setOnInsert });
          upsertedCount += 1;
        }
        return { upsertedCount };
      },
      deleteMany: async (query) => {
        const before = rowsOf(name).length;
        data[name] = rowsOf(name).filter((row) => !matches(row, query));
        return { deletedCount: before - data[name].length };
      },
    }),
  };
}

test("catalogue fields are cleaned: only https links and #RRGGBB colours", () => {
  assert.deepEqual(normalizeStationCatalogFields({
    genre: "Techno", color: "7c3aed", logo: "http://x/logo.png", homepage: "https://example.com/", country: "DE", language: "",
  }), { genre: "Techno", color: "#7C3AED", homepage: "https://example.com/", country: "DE" });
  assert.deepEqual(normalizeStationCatalogFields({}), { genre: "Radio" });
});

test("the start fills only what the owner left empty", () => {
  const stored = { key: "pro_tech_02", url: "https://stream.technolovers.fm/hypertechno", genre: "Radio", color: "#123456" };
  const fileEntry = { genre: "Techno", color: "#7C3AED", country: "DE" };
  assert.deepEqual(catalogUpdatesFor(stored, fileEntry), { genre: "Techno", country: "DE" });
  assert.equal("genre" in catalogUpdatesFor({ ...stored, genre: "Hard Techno" }, fileEntry), false);
  assert.deepEqual(catalogUpdatesFor({ key: "x", genre: "Radio" }, {}), {}, "Radio for Radio is no change");
});

test("a broken stream is replaced only where its old URL is still stored", () => {
  const scanner = { key: "pro_tech_20", url: "https://ice4.somafm.com/scanner-128-mp3", genre: "Techno" };
  assert.equal(catalogUpdatesFor(scanner, { genre: "Techno" }).url, "https://stream.technolovers.fm/dark-techno");
  assert.equal("url" in catalogUpdatesFor({ ...scanner, url: "https://my.own/stream" }, { genre: "Techno" }), false);
});

test("#325: corrections only where the old value is still stored", () => {
  const stored = { key: "pro_tech_16", name: "Deep Underground", genre: "Techno", color: "#7C3AED", url: "https://x" };
  assert.deepEqual(catalogUpdatesFor(stored, { genre: "House", color: "#06B6D4" }), { name: "Deep Tech House", genre: "House", color: "#06B6D4" });
  assert.equal("name" in catalogUpdatesFor({ ...stored, name: "Vereins-Techno" }, { genre: "House" }), false);

  const reggae = { key: "reggaeradio", url: "http://streams.bigfm.de/bigfm-reggaevibes-128-mp3", country: "DE", genre: "Reggae & Dancehall" };
  assert.equal(catalogUpdatesFor(reggae, { genre: "Reggae & Dancehall" }).url, "https://ice1.somafm.com/reggae-128-mp3");

  // The two that played another station's stream get one that matches their name.
  const drill = { key: "pro_urban_04", name: "Drill Beats", url: "http://streams.bigfm.de/bigfm-rapfeature-128-mp3?usid=0-0-H-M-D-60", language: "de", genre: "Hip Hop & Rap" };
  const updates = catalogUpdatesFor(drill, { genre: "Hip Hop & Rap" });
  assert.equal(updates.url, "https://stream.laut.fm/drill");
  assert.equal(updates.language, "");
  assert.equal("url" in catalogUpdatesFor({ ...drill, url: "https://my.own/drill" }, { genre: "Hip Hop & Rap" }), false);
});

test("an empty catalogue gets the shipped stations, a filled one stays as it is", async () => {
  const shipped = {
    defaultStationKey: "lounge",
    stations: {
      lounge: { name: "Lounge", url: "https://example.com/lounge", tier: "free", genre: "Chill", color: "06b6d4" },
      rock: { name: "Rock", url: "https://example.com/rock", tier: "pro" },
    },
  };
  const now = new Date("2026-10-11T08:00:00Z");
  const empty = fakeDb();
  assert.equal(await seedStationsIfEmpty(empty, shipped, { now }), 2);
  assert.deepEqual(empty.data.stations.map(({ _id, ...row }) => row), [
    { key: "lounge", name: "Lounge", url: "https://example.com/lounge", tier: "free", genre: "Chill", color: "#06B6D4", is_default: true, created_at: now.toISOString() },
    { key: "rock", name: "Rock", url: "https://example.com/rock", tier: "pro", genre: "Radio", is_default: false, created_at: now.toISOString() },
  ]);

  const owned = fakeDb({ stations: [{ key: "own", name: "Vereinsradio", url: "https://club.example/live" }] });
  assert.equal(await seedStationsIfEmpty(owned, shipped), 0);
  assert.deepEqual(owned.data.stations.map((row) => row.key), ["own"], "the owner's catalogue is never topped up");
});

test("the fill touches only the stations that need it, and only once", async () => {
  const db = fakeDb({ stations: [
    { _id: 1, key: "pro_tech_20", url: "https://ice4.somafm.com/scanner-128-mp3", genre: "Techno" },
    { _id: 2, key: "lounge", url: "https://example.com/lounge", genre: "Chill" },
  ] });
  const shipped = { stations: { pro_tech_20: { genre: "Techno" }, lounge: { genre: "Chill" } } };
  assert.equal(await fillStationCatalogFields(db, shipped, { now: new Date("2026-10-11T08:00:00Z") }), 1);
  assert.equal(db.data.stations[0].url, "https://stream.technolovers.fm/dark-techno");
  assert.equal(db.data.stations[0].updated_at, "2026-10-11T08:00:00.000Z");
  assert.equal("updated_at" in db.data.stations[1], false);
  assert.equal(await fillStationCatalogFields(db, shipped), 0, "the second start changes nothing");
});

test("demo licences of old test setups go, real ones stay", async () => {
  const db = fakeDb({
    licenses: [{ _licenseId: "demo-pro-1" }, { _licenseId: "OMNI-AAAA-BBBB-CCCC" }],
    server_entitlements: [{ _serverId: "DEMO-guild" }, { _serverId: "123456789012345678" }],
    processed_sessions: [{ _sessionId: "demo-session" }],
  });
  assert.equal(await purgeDemoData(db), 1);
  assert.deepEqual(db.data.licenses, [{ _licenseId: "OMNI-AAAA-BBBB-CCCC" }]);
  assert.deepEqual(db.data.server_entitlements, [{ _serverId: "123456789012345678" }]);
  assert.deepEqual(db.data.processed_sessions, []);
});

test("scripts/database.mjs waits for MongoDB and prepares a fresh database, twice without change", async (t) => {
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const { MongoClient } = await import("mongodb");
  const dbName = `${String(process.env.DB_NAME || "omnifm_test").trim()}_prepare`;
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  t.after(async () => {
    await client.db(dbName).dropDatabase().catch(() => null);
    await client.close();
  });
  await client.db(dbName).dropDatabase();
  await client.db(dbName).collection("licenses").insertOne({ _licenseId: "demo-old" });

  const env = { ...process.env, MONGO_URL: mongoUrl, DB_NAME: dbName };
  const run = (...args) => execFile(process.execPath, ["scripts/database.mjs", ...args], { cwd: ROOT, env });
  await run("wait", "5");
  const first = await run("prepare");
  const shipped = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "stations.json"), "utf8")).stations).length;
  assert.match(first.stdout, new RegExp(`Senderkatalog: ${shipped} Sender aus stations.json angelegt`));
  assert.match(first.stdout, /Demo-Lizenzen entfernt: 1\./);
  assert.equal(await client.db(dbName).collection("stations").countDocuments(), shipped);
  const second = await run("prepare");
  assert.equal(second.stdout.trim(), "", "nothing left to do");
  assert.match((await run("status")).stdout, new RegExp(`MongoDB antwortet[\\s\\S]*${dbName}: \\d+ Collections`));
});
