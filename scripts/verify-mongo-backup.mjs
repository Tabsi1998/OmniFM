#!/usr/bin/env node
// Restore check of a MongoDB backup (#259): restores the archive into a
// throw-away database, compares every collection's document count with what
// mongodump reported when it wrote the archive, then drops the copy.
//
//   node scripts/verify-mongo-backup.mjs [archive]   (default: newest archive)
//
// Reads MONGO_URL and DB_NAME from the environment or backend/.env. The
// result is written to .update-backups/mongodb/.last-restore-check.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BACKUP_DIR = path.join(ROOT, ".update-backups", "mongodb");
export const RESULT_FILE = ".last-restore-check.json";

/** Document counts per collection from a mongodump log. */
export function parseDumpLog(text, dbName) {
  const counts = {};
  const pattern = /done dumping ([^\s.]+)\.(\S+) \((\d+) documents?\)/g;
  for (const [, db, collection, count] of String(text || "").matchAll(pattern)) {
    if (dbName && db !== dbName) continue;
    counts[collection] = Number(count);
  }
  return counts;
}

/** Differences between the counts mongodump reported and the restored copy. */
export function compareCounts(expected, actual) {
  const problems = [];
  for (const [collection, count] of Object.entries(expected)) {
    const restored = actual[collection];
    if (restored === undefined) problems.push(`${collection}: missing in the restored copy`);
    else if (restored !== count) problems.push(`${collection}: ${restored} documents restored, ${count} dumped`);
  }
  return problems;
}

export function newestArchive(directory = BACKUP_DIR) {
  if (!fs.existsSync(directory)) return null;
  const archives = fs.readdirSync(directory)
    .filter((name) => /^mongodb-.+\.archive\.gz$/.test(name))
    .map((name) => ({ name, time: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  return archives.length ? path.join(directory, archives[0].name) : null;
}

function runMongorestore({ archive, mongoUrl, dbName, scratchName }) {
  // The connection string goes through a private config file, never the
  // process list (same as scripts/backup-mongodb.sh).
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-restore-check-"));
  const configFile = path.join(configDir, "mongo-tools.yml");
  fs.writeFileSync(configFile, `uri: ${JSON.stringify(mongoUrl)}\n`, { mode: 0o600 });
  const args = [
    `--config=${configFile}`,
    `--archive=${archive}`,
    "--gzip",
    `--nsInclude=${dbName}.*`,
    `--nsFrom=${dbName}.*`,
    `--nsTo=${scratchName}.*`,
    "--drop",
    "--stopOnError",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.OMNIFM_MONGORESTORE || "mongorestore", args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => {
      fs.rmSync(configDir, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new Error(`mongorestore exited with ${code}`));
    });
  });
}

/**
 * Restores `archive` into `<db>_restorecheck`, compares, drops the copy.
 * `restore` can be replaced in tests; it must fill the scratch database.
 */
export async function runRestoreCheck({
  archive,
  mongoUrl,
  dbName,
  scratchName = `${dbName}_restorecheck`,
  restore = runMongorestore,
  now = () => new Date(),
}) {
  // The copy is dropped before and after the check: it must never be the
  // production database.
  if (!scratchName || scratchName === dbName) {
    throw new Error(`the restore check database must differ from ${dbName}`);
  }
  const logFile = `${archive}.log`;
  const expected = fs.existsSync(logFile) ? parseDumpLog(fs.readFileSync(logFile, "utf8"), dbName) : null;
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const scratch = client.db(scratchName);
  try {
    await scratch.dropDatabase();
    await restore({ archive, mongoUrl, dbName, scratchName });
    const names = (await scratch.listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith("system."));
    const counts = await Promise.all(names.map((name) => scratch.collection(name).countDocuments({})));
    const actual = Object.fromEntries(names.map((name, index) => [name, counts[index]]));
    const problems = expected ? compareCounts(expected, actual) : [];
    if (!expected && Object.keys(actual).length === 0) problems.push("the restored copy is empty");
    return {
      at: now().toISOString(),
      archive: path.basename(archive),
      ok: problems.length === 0,
      collections: Object.keys(actual).length,
      documents: Object.values(actual).reduce((sum, count) => sum + count, 0),
      comparedWithDumpLog: Boolean(expected),
      problems,
    };
  } finally {
    await scratch.dropDatabase().catch(() => {});
    await client.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dotenv.config({ path: path.join(ROOT, "backend", ".env"), quiet: true });
  const archive = process.argv[2] ? path.resolve(process.argv[2]) : newestArchive();
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  const dbName = String(process.env.DB_NAME || "").trim();
  if (!archive) {
    console.error("[ERROR] No MongoDB backup archive found.");
    process.exit(1);
  }
  if (!mongoUrl || !dbName) {
    console.error("[ERROR] MONGO_URL and DB_NAME are required (environment or backend/.env).");
    process.exit(1);
  }
  try {
    // A MongoDB user limited to its own database cannot create the default
    // scratch database; OMNIFM_RESTORE_CHECK_DB names one it may use.
    const scratchName = String(process.env.OMNIFM_RESTORE_CHECK_DB || "").trim() || undefined;
    const result = await runRestoreCheck({ archive, mongoUrl, dbName, scratchName });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(archive), RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    if (result.ok) {
      console.log(`[OK] Restore check: ${result.archive} restored ${result.collections} collections, ${result.documents} documents${result.comparedWithDumpLog ? ", counts match the dump" : ""}.`);
    } else {
      console.error(`[ERROR] Restore check of ${result.archive} failed:\n  ${result.problems.join("\n  ")}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`[ERROR] Restore check failed: ${error.message}`);
    process.exit(1);
  }
}
