#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runtimePaths = [
  ".env",
  "stations.json",
  "premium.json",
  "bot-state.json",
  "bot-state",
  "custom-stations.json",
  "command-permissions.json",
  "guild-languages.json",
  "song-history.json",
  "song-history",
  "dashboard.json",
  "listening-stats.json",
  "scheduled-events.json",
  "coupons.json",
  "discordbotlist.json",
  "botsgg.json",
  "topgg.json",
  "vote-events.json",
  "operator-incidents.json",
  "runtime-incidents.json",
];

function parseArgs(argv = []) {
  const args = {
    out: "",
    mongo: "auto",
    "include-logs": false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    if (key === "help" || key === "include-logs") {
      args[key] = true;
      continue;
    }
    if (key === "mongo") {
      args.mongo = "yes";
      continue;
    }
    if (key === "no-mongo") {
      args.mongo = "no";
      continue;
    }
    const next = String(argv[index + 1] || "");
    args[key] = next && !next.startsWith("--") ? next : "";
    if (args[key]) index += 1;
  }

  return args;
}

function buildTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/backup-runtime.mjs [--out .update-backups/runtime-YYYYMMDD-HHMMSS] [--mongo|--no-mongo] [--include-logs]");
}

function ensureInsideRepo(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return resolved;
  }
  return resolved;
}

async function copyRuntimePath(relativePath, backupRoot) {
  const source = path.join(repoRoot, relativePath);
  const stat = await fs.promises.stat(source).catch(() => null);
  if (!stat) {
    return { relativePath, copied: false, reason: "missing" };
  }

  const target = path.join(backupRoot, "runtime", relativePath);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.cp(source, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
    verbatimSymlinks: false,
  });

  return {
    relativePath,
    copied: true,
    type: stat.isDirectory() ? "directory" : "file",
  };
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      ...options,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "");
      if (stderr.length > 4_000) {
        stderr = stderr.slice(-4_000);
      }
    });

    child.on("error", (error) => {
      resolve({ ok: false, error: error?.message || String(error) });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, error: stderr.trim() });
    });
  });
}

async function commandExists(command) {
  const result = await runCommand(command, ["--version"]);
  return result.ok;
}

async function maybeDumpMongo(backupRoot, mode, env = process.env) {
  const mongoUrl = String(env.MONGO_URL || "").trim();
  if (mode === "no") {
    return { attempted: false, skipped: true, reason: "disabled" };
  }
  if (!mongoUrl) {
    return { attempted: false, skipped: true, reason: "MONGO_URL not set" };
  }
  if (!(await commandExists("mongodump"))) {
    if (mode === "yes") {
      return { attempted: true, ok: false, error: "mongodump was not found in PATH" };
    }
    return { attempted: false, skipped: true, reason: "mongodump not found" };
  }

  const dbName = String(env.DB_NAME || "radio_bot").trim() || "radio_bot";
  const archivePath = path.join(backupRoot, "mongodb.archive.gz");
  const result = await runCommand("mongodump", [
    "--uri",
    mongoUrl,
    "--db",
    dbName,
    `--archive=${archivePath}`,
    "--gzip",
  ]);

  return {
    attempted: true,
    ok: result.ok,
    archive: result.ok ? archivePath : null,
    error: result.ok ? null : (result.error || `mongodump exited with code ${result.code ?? "unknown"}`),
  };
}

async function createRuntimeBackup(options = {}) {
  dotenv.config({ path: path.join(repoRoot, ".env") });

  const backupRoot = ensureInsideRepo(
    options.out || path.join(repoRoot, ".update-backups", `runtime-${buildTimestamp()}`)
  );
  await fs.promises.mkdir(backupRoot, { recursive: true });

  const paths = options.includeLogs ? [...runtimePaths, "logs"] : runtimePaths;
  const copied = [];
  for (const relativePath of paths) {
    // eslint-disable-next-line no-await-in-loop
    copied.push(await copyRuntimePath(relativePath, backupRoot));
  }

  const mongo = await maybeDumpMongo(backupRoot, options.mongo || "auto");
  const manifest = {
    createdAt: new Date().toISOString(),
    repoRoot,
    backupRoot,
    copied,
    mongo,
  };

  await fs.promises.writeFile(
    path.join(backupRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const manifest = await createRuntimeBackup({
    out: args.out,
    mongo: args.mongo,
    includeLogs: args["include-logs"] === true,
  });

  const copiedCount = manifest.copied.filter((entry) => entry.copied).length;
  const skippedCount = manifest.copied.length - copiedCount;
  console.log(`Backup created: ${manifest.backupRoot}`);
  console.log(`Runtime paths copied: ${copiedCount}, skipped: ${skippedCount}`);
  if (manifest.mongo.ok) {
    console.log("MongoDB dump: ok");
  } else if (manifest.mongo.attempted) {
    console.log(`MongoDB dump: failed (${manifest.mongo.error})`);
    process.exitCode = 2;
  } else {
    console.log(`MongoDB dump: skipped (${manifest.mongo.reason})`);
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(`Backup failed: ${error?.message || String(error)}`);
    process.exitCode = 1;
  });
}

export {
  buildTimestamp,
  createRuntimeBackup,
  parseArgs,
};
