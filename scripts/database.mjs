#!/usr/bin/env node
// MongoDB for start.sh and update.sh, with Node alone (#291, #284).
//
//   node scripts/database.mjs wait [seconds]   until MongoDB answers (default 60); exit 1 if it never does
//   node scripts/database.mjs prepare          the station catalogue and demo leftovers, see src/lib/station-catalog-sync.js
//   node scripts/database.mjs status           MongoDB's answer and the collections per database
//   node scripts/database.mjs check-secrets    exit 1 when OMNIFM_TOKEN_KEY does not open the sealed secrets
//   node scripts/database.mjs encrypt-secrets  seals owner_config's plain secrets (src/lib/stored-secrets.js)
//   node scripts/database.mjs decrypt-secrets  stores them in plain text again, for a rollback to a version before #284
//   node scripts/database.mjs rotate-key       a new OMNIFM_TOKEN_KEY, everything sealed again with it
//
// MONGO_URL, DB_NAME and OMNIFM_TOKEN_KEY come from the environment or
// backend/.env; --env-file <path> names another file.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { BACKEND_ENV_FILE, loadBackendEnv, mongoTarget, readEnvFile, updateEnvFile } from "../src/entrypoints/owner-env.mjs";
import { fillStationCatalogFields, purgeDemoData, seedStationsIfEmpty } from "../src/lib/station-catalog-sync.js";
import {
  checkStoredSecrets, decryptStoredSecrets, encryptStoredSecrets, resealLinkedRoleTokens,
} from "../src/lib/stored-secrets.js";
import { parseTokenKey, tokenKeyFrom, tokenKeysFrom } from "../src/lib/token-crypto.js";

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

async function withDatabase(url, dbName, work) {
  const client = await ping(url);
  try {
    return await work(client.db(dbName), client);
  } finally {
    await client.close();
  }
}

/** Each step on its own: a failed one is named and the deployment goes on, as before #291. */
async function prepare(db) {
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
  for (const [name, step] of steps) {
    try {
      // eslint-disable-next-line no-await-in-loop -- the steps run in order
      await step();
    } catch (error) {
      console.error(`Warnung: ${name} fehlgeschlagen: ${error.message}`);
    }
  }
}

async function status(client, url) {
  console.log(`MongoDB antwortet (${url.split("@").pop()})`);
  const { databases } = await client.db("admin").admin().listDatabases({ nameOnly: true });
  for (const name of databases.map((entry) => entry.name).sort()) {
    if (SYSTEM_DATABASES.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop -- a few databases
    const collections = await client.db(name).listCollections({}, { nameOnly: true }).toArray();
    console.log(`  ${name}: ${collections.length} Collections`);
  }
}

/** Before the switch: a key that does not fit stops the deployment while the running version stays. */
async function checkSecrets(db) {
  const report = await checkStoredSecrets(db);
  if (!tokenKeyFrom() && (report.plain.length || report.unopenable.length)) {
    console.error("OMNIFM_TOKEN_KEY fehlt in backend/.env oder ist ungültig (32 Byte als Hex oder Base64).");
    return false;
  }
  if (report.unopenable.length) {
    console.error(`OMNIFM_TOKEN_KEY in backend/.env öffnet diese Geheimnisse in MongoDB nicht: ${report.unopenable.join(", ")}.`);
    console.error("Wurde der Schlüssel geändert? Den bisherigen Wert wieder eintragen (Kopie: .update-backups/).");
    return false;
  }
  return true;
}

/**
 * A new key: first written next to the old one (OMNIFM_TOKEN_KEY_PREVIOUS),
 * then everything sealed again, then the old one removed. An interrupted run
 * leaves both keys, and the next run finishes with the same new key.
 */
async function rotateKey(db, envFile) {
  const fileValues = readEnvFile(envFile);
  const current = parseTokenKey(fileValues.OMNIFM_TOKEN_KEY);
  const previous = parseTokenKey(fileValues.OMNIFM_TOKEN_KEY_PREVIOUS);
  if (!current) throw new Error(`OMNIFM_TOKEN_KEY fehlt in ${envFile}; ./start.sh legt einen an, dann ist kein Wechsel nötig.`);
  let key = current;
  if (!previous) {
    key = randomBytes(32);
    updateEnvFile(envFile, { OMNIFM_TOKEN_KEY_PREVIOUS: current.toString("hex"), OMNIFM_TOKEN_KEY: key.toString("hex") });
  }
  const keys = [key, previous || current];
  const secrets = await encryptStoredSecrets(db, { key, keys });
  const accounts = await resealLinkedRoleTokens(db, { key, keys });
  updateEnvFile(envFile, { OMNIFM_TOKEN_KEY_PREVIOUS: null });
  console.log(`Neuer Schlüssel aktiv: ${secrets} Geheimnisse und ${accounts} Linked-Roles-Konten neu verschlüsselt.`);
}

const args = process.argv.slice(2);
const envFileIndex = args.indexOf("--env-file");
const envFile = envFileIndex >= 0 ? path.resolve(args.splice(envFileIndex, 2)[1] || "") : BACKEND_ENV_FILE;
const backendEnv = loadBackendEnv(process.env, envFile);
const { url, dbName } = mongoTarget(process.env, backendEnv);
const [command, argument] = args;
try {
  if (command === "wait") {
    const seconds = Number.parseInt(argument || "60", 10);
    process.exit(await wait(url, Number.isFinite(seconds) && seconds > 0 ? seconds : 60) ? 0 : 1);
  } else if (command === "prepare") {
    await withDatabase(url, dbName, (db) => prepare(db));
  } else if (command === "status") {
    await withDatabase(url, dbName, (_db, client) => status(client, url));
  } else if (command === "check-secrets") {
    if (!await withDatabase(url, dbName, (db) => checkSecrets(db))) process.exit(1);
  } else if (command === "encrypt-secrets") {
    const sealed = await withDatabase(url, dbName, (db) => encryptStoredSecrets(db, { key: tokenKeyFrom(), keys: tokenKeysFrom() }));
    if (sealed) console.log(`Geheimnisse verschlüsselt: ${sealed}.`);
  } else if (command === "decrypt-secrets") {
    const opened = await withDatabase(url, dbName, (db) => decryptStoredSecrets(db));
    if (opened) console.log(`Geheimnisse wieder im Klartext gespeichert: ${opened}.`);
  } else if (command === "rotate-key") {
    await withDatabase(url, dbName, (db) => rotateKey(db, envFile));
  } else {
    console.error("Nutzung: node scripts/database.mjs [--env-file <Datei>] wait [Sekunden] | prepare | status | check-secrets | encrypt-secrets | decrypt-secrets | rotate-key");
    process.exit(2);
  }
} catch (error) {
  console.error(error?.name === "MongoServerSelectionError" ? `MongoDB nicht erreichbar: ${error.message}` : error.message);
  process.exit(1);
}
