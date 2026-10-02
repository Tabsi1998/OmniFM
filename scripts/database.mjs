#!/usr/bin/env node
// MongoDB for start.sh and update.sh, with Node alone (#291).
//
//   node scripts/database.mjs wait [seconds]   until MongoDB answers (default 60); exit 1 if it never does
//   node scripts/database.mjs prepare          the station catalogue and demo leftovers, see src/lib/station-catalog-sync.js
//   node scripts/database.mjs status           MongoDB's answer and the collections per database
//
// MONGO_URL and DB_NAME come from the environment or backend/.env.
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadBackendEnv, mongoTarget } from "../src/entrypoints/owner-env.mjs";
import { fillStationCatalogFields, purgeDemoData, seedStationsIfEmpty } from "../src/lib/station-catalog-sync.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYSTEM_DATABASES = new Set(["admin", "config", "local"]);

async function ping(url) {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

async function wait(url, seconds) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one attempt after the other until the deadline
      await (await ping(url)).close();
      return true;
    } catch {
      if (Date.now() >= deadline) return false;
      // eslint-disable-next-line no-await-in-loop -- see above
      await sleep(1000);
    }
  }
}

function shippedStations() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "stations.json"), "utf8"));
  } catch (error) {
    console.error(`Warnung: stations.json nicht lesbar (${error.message}); der Senderkatalog bleibt, wie er ist.`);
    return { stations: {} };
  }
}

/** Each step on its own: a failed one is named and the deployment goes on, as before #291. */
async function prepare(url, dbName) {
  const client = await ping(url);
  const db = client.db(dbName);
  const shipped = shippedStations();
  const steps = [
    ["Senderkatalog anlegen", async () => {
      const added = await seedStationsIfEmpty(db, shipped);
      if (added) console.log(`Senderkatalog: ${added} Sender aus stations.json angelegt (MongoDB war leer).`);
    }],
    ["Senderkatalog ergänzen", async () => {
      const changed = await fillStationCatalogFields(db, shipped);
      if (changed) console.log(`Senderkatalog: ${changed} Sender ergänzt oder korrigiert.`);
    }],
    ["Demo-Lizenzen entfernen", async () => {
      const removed = await purgeDemoData(db);
      if (removed) console.log(`Demo-Lizenzen entfernt: ${removed}.`);
    }],
  ];
  try {
    for (const [name, step] of steps) {
      try {
        // eslint-disable-next-line no-await-in-loop -- the steps run in order
        await step();
      } catch (error) {
        console.error(`Warnung: ${name} fehlgeschlagen: ${error.message}`);
      }
    }
  } finally {
    await client.close();
  }
}

async function status(url) {
  const client = await ping(url);
  try {
    console.log(`MongoDB antwortet (${url.split("@").pop()})`);
    const { databases } = await client.db("admin").admin().listDatabases({ nameOnly: true });
    for (const name of databases.map((entry) => entry.name).sort()) {
      if (SYSTEM_DATABASES.has(name)) continue;
      // eslint-disable-next-line no-await-in-loop -- a few databases
      const collections = await client.db(name).listCollections({}, { nameOnly: true }).toArray();
      console.log(`  ${name}: ${collections.length} Collections`);
    }
  } finally {
    await client.close();
  }
}

const backendEnv = loadBackendEnv();
const { url, dbName } = mongoTarget(process.env, backendEnv);
const [command, argument] = process.argv.slice(2);
try {
  if (command === "wait") {
    const seconds = Number.parseInt(argument || "60", 10);
    process.exit(await wait(url, Number.isFinite(seconds) && seconds > 0 ? seconds : 60) ? 0 : 1);
  } else if (command === "prepare") {
    await prepare(url, dbName);
  } else if (command === "status") {
    await status(url);
  } else {
    console.error("Nutzung: node scripts/database.mjs wait [Sekunden] | prepare | status");
    process.exit(2);
  }
} catch (error) {
  console.error(`MongoDB nicht erreichbar: ${error.message}`);
  process.exit(1);
}
