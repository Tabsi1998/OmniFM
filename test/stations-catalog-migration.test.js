import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyStationCatalogMigrations,
  migrateStationsFileCatalog,
  STATION_CATALOG_MIGRATIONS,
} from "../src/stations-store.js";

const [tomorrowlandMigration] = STATION_CATALOG_MIGRATIONS;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFile = promisify(execFileCallback);

function createStationsCollection(documents, { failUpdate = null } = {}) {
  const calls = [];

  return {
    calls,
    async updateMany(filter, update, ...options) {
      calls.push({ type: "updateMany", filter, update, options });
      if (failUpdate) throw failUpdate;

      let matchedCount = 0;
      let modifiedCount = 0;
      for (const document of documents) {
        const matchingKeys = Array.isArray(filter.key?.$in) ? filter.key.$in : [filter.key];
        if (!matchingKeys.includes(document.key) || document.url !== filter.url) continue;
        matchedCount += 1;
        document.url = update.$set.url;
        modifiedCount += 1;
      }
      return { acknowledged: true, matchedCount, modifiedCount };
    },
  };
}

function createMigrationsCollection({ markerIds = [], alwaysReportMissing = false, insertAcknowledged = true } = {}) {
  const markers = new Map(markerIds.map((id) => [id, { _id: id }]));
  const calls = [];

  return {
    calls,
    markers,
    async findOne(filter) {
      calls.push({ type: "findOne", filter });
      if (alwaysReportMissing) return null;
      return markers.get(filter._id) || null;
    },
    async insertOne(document) {
      calls.push({ type: "insertOne", document });
      if (markers.has(document._id)) {
        const duplicate = new Error("E11000 duplicate key error");
        duplicate.code = 11000;
        throw duplicate;
      }
      if (!insertAcknowledged) {
        return { acknowledged: false, insertedId: document._id };
      }
      markers.set(document._id, document);
      return { acknowledged: true, insertedId: document._id };
    },
  };
}

test("all shipped station catalogs use the current Tomorrowland Anthems endpoint", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "stations.json"), "utf8"));
  const proCatalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "stations.pro.json"), "utf8"));
  const proAnthems = proCatalog.find((station) => station.id === "pro_tml_03");

  assert.equal(
    catalog.stations.pro_tml_03.url,
    "https://playerservices.streamtheworld.com/api/livestream-redirect/OWR_ANTHEMS.mp3"
  );
  assert.equal(proAnthems?.name, "Tomorrowland - Anthems");
  assert.equal(proAnthems?.streamURL, tomorrowlandMigration.toUrl);
  assert.equal(
    JSON.stringify({ catalog, proCatalog }).includes(tomorrowlandMigration.fromUrl),
    false,
    "shipped catalog files must not retain the retired endpoint"
  );
});

test("catalog migration changes only the known stale Tomorrowland URL", async () => {
  const documents = [
    { key: "protml03", url: tomorrowlandMigration.fromUrl, name: "Tomorrowland - Anthems" },
    { key: "pro_tml_03", url: tomorrowlandMigration.fromUrl, name: "Legacy raw catalog key" },
    { key: "protml03", url: "https://operator.example/anthem-override.mp3", name: "Operator override" },
    { key: "pro_tml_03", url: "https://operator.example/raw-key-override.mp3", name: "Raw key override" },
    { key: "anotherstation", url: tomorrowlandMigration.fromUrl, name: "Different station" },
  ];
  const stations = createStationsCollection(documents);
  const migrations = createMigrationsCollection();

  const result = await applyStationCatalogMigrations(stations, migrations);

  assert.equal(documents[0].url, tomorrowlandMigration.toUrl);
  assert.equal(documents[1].url, tomorrowlandMigration.toUrl);
  assert.equal(documents[2].url, "https://operator.example/anthem-override.mp3");
  assert.equal(documents[3].url, "https://operator.example/raw-key-override.mp3");
  assert.equal(documents[4].url, tomorrowlandMigration.fromUrl);
  assert.deepEqual(stations.calls[0], {
    type: "updateMany",
    filter: {
      key: { $in: ["protml03", "pro_tml_03"] },
      url: tomorrowlandMigration.fromUrl,
    },
    update: { $set: { url: tomorrowlandMigration.toUrl } },
    options: [],
  });
  assert.equal(migrations.markers.size, 1);
  assert.equal(migrations.markers.get(tomorrowlandMigration.id).matchedCount, 2);
  assert.equal(migrations.markers.get(tomorrowlandMigration.id).modifiedCount, 2);
  assert.deepEqual(migrations.markers.get(tomorrowlandMigration.id).keys, ["protml03", "pro_tml_03"]);
  assert.equal(result.applied[0].markerWritten, true);
});

test("catalog migration does not run again after its completion marker exists", async () => {
  const documents = [{ key: "protml03", url: tomorrowlandMigration.fromUrl }];
  const stations = createStationsCollection(documents);
  const migrations = createMigrationsCollection({ markerIds: [tomorrowlandMigration.id] });

  const result = await applyStationCatalogMigrations(stations, migrations);

  assert.equal(stations.calls.length, 0);
  assert.equal(migrations.calls.filter((call) => call.type === "insertOne").length, 0);
  assert.deepEqual(result, {
    applied: [],
    skipped: [{ id: tomorrowlandMigration.id, reason: "already-applied" }],
  });
});

test("catalog migration never writes its marker when the catalog update fails", async () => {
  const stations = createStationsCollection([], { failUpdate: new Error("MongoDB unavailable") });
  const migrations = createMigrationsCollection();

  await assert.rejects(
    () => applyStationCatalogMigrations(stations, migrations),
    /MongoDB unavailable/
  );

  assert.equal(migrations.calls.filter((call) => call.type === "insertOne").length, 0);
  assert.equal(migrations.markers.size, 0);
});

test("catalog migration does not report completion when MongoDB does not acknowledge the marker", async () => {
  const documents = [{ key: "protml03", url: tomorrowlandMigration.fromUrl }];
  const stations = createStationsCollection(documents);
  const migrations = createMigrationsCollection({ insertAcknowledged: false });

  await assert.rejects(
    () => applyStationCatalogMigrations(stations, migrations),
    /konnte nicht als abgeschlossen markiert werden/
  );

  assert.equal(documents[0].url, tomorrowlandMigration.toUrl);
  assert.equal(migrations.markers.size, 0);
});

test("concurrent startup attempts remain idempotent and accept a duplicate marker", async () => {
  const documents = [{ key: "protml03", url: tomorrowlandMigration.fromUrl }];
  const stations = createStationsCollection(documents);
  const migrations = createMigrationsCollection({ alwaysReportMissing: true });

  const results = await Promise.all([
    applyStationCatalogMigrations(stations, migrations),
    applyStationCatalogMigrations(stations, migrations),
  ]);

  assert.equal(documents[0].url, tomorrowlandMigration.toUrl);
  assert.equal(migrations.markers.size, 1);
  assert.equal(
    results.filter((result) => result.applied[0]?.markerWritten).length,
    1,
    "exactly one startup writes the completion marker"
  );
  assert.equal(stations.calls.length, 2);
  assert.ok(results.every((result) => result.applied.length === 1));
});

test("file fallback migration updates only the stale URL and preserves raw catalog fields", async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omnifm-stations-file-migration-"));
  const stationsFile = path.join(tempDir, "stations.json");
  const catalog = {
    defaultStationKey: "pro_tml_03",
    locked: true,
    operatorMetadata: { keep: "all raw root fields" },
    stations: {
      pro_tml_03: {
        name: "Tomorrowland - Anthems",
        url: tomorrowlandMigration.fromUrl,
        tier: "pro",
        customMetadata: { source: "legacy catalog" },
      },
      protml03: {
        name: "Operator override",
        url: "https://operator.example/anthem-override.mp3",
        tier: "ultimate",
        customMetadata: { preserve: true },
      },
      other: {
        name: "Other station",
        url: tomorrowlandMigration.fromUrl,
        tier: "free",
      },
    },
  };

  t.after(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  await fsPromises.writeFile(stationsFile, JSON.stringify(catalog, null, 2), "utf8");

  const firstResult = migrateStationsFileCatalog(stationsFile);
  const migrated = JSON.parse(await fsPromises.readFile(stationsFile, "utf8"));
  const serializedAfterFirstMigration = await fsPromises.readFile(stationsFile, "utf8");
  const secondResult = migrateStationsFileCatalog(stationsFile);

  assert.deepEqual(firstResult, { changed: true, matchedCount: 1 });
  assert.equal(migrated.stations.pro_tml_03.url, tomorrowlandMigration.toUrl);
  assert.deepEqual(migrated.stations.pro_tml_03.customMetadata, { source: "legacy catalog" });
  assert.deepEqual(migrated.stations.protml03, catalog.stations.protml03);
  assert.deepEqual(migrated.stations.other, catalog.stations.other);
  assert.deepEqual(migrated.operatorMetadata, catalog.operatorMetadata);
  assert.deepEqual(secondResult, { changed: false, matchedCount: 0 });
  assert.equal(await fsPromises.readFile(stationsFile, "utf8"), serializedAfterFirstMigration);
  assert.equal(fs.existsSync(`${stationsFile}.lock`), false);
});

test("file fallback migration remains safe for concurrent worker processes", async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omnifm-stations-file-concurrency-"));
  const stationsFile = path.join(tempDir, "stations.json");
  const stationsModuleUrl = pathToFileURL(path.join(repoRoot, "src", "stations-store.js")).href;
  const workerScript = `
    const { migrateStationsFileCatalog } = await import(process.env.OMNIFM_STATIONS_STORE_MODULE_URL);
    migrateStationsFileCatalog(process.env.OMNIFM_TEST_STATIONS_FILE);
  `;
  const catalog = {
    stations: {
      pro_tml_03: {
        name: "Tomorrowland - Anthems",
        url: tomorrowlandMigration.fromUrl,
        tier: "pro",
        keep: "this raw field survives concurrent migration",
      },
      protml03: {
        name: "Operator override",
        url: "https://operator.example/anthem-override.mp3",
        tier: "pro",
      },
    },
  };

  t.after(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  await fsPromises.writeFile(stationsFile, JSON.stringify(catalog, null, 2), "utf8");
  await Promise.all(Array.from({ length: 4 }, () => execFile(
    process.execPath,
    ["--input-type=module", "-e", workerScript],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OMNIFM_STATIONS_STORE_MODULE_URL: stationsModuleUrl,
        OMNIFM_TEST_STATIONS_FILE: stationsFile,
      },
      timeout: 20000,
    }
  )));

  const migrated = JSON.parse(await fsPromises.readFile(stationsFile, "utf8"));
  const entries = await fsPromises.readdir(tempDir);

  assert.equal(migrated.stations.pro_tml_03.url, tomorrowlandMigration.toUrl);
  assert.equal(migrated.stations.pro_tml_03.keep, "this raw field survives concurrent migration");
  assert.equal(migrated.stations.protml03.url, "https://operator.example/anthem-override.mp3");
  assert.equal(entries.some((entry) => entry.includes(".tmp-") || entry.endsWith(".lock")), false);
});
