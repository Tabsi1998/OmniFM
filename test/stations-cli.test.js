import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

// `npm run stations` (#298): every change is saved before the next one and
// before the CLI exits, and with MongoDB it edits the catalogue the bot uses.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-stations-cli-"));
after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 }));

function runCli(args, { env = {} } = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, "src/stations-cli.js"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    // An empty MONGO_URL keeps a backend/.env of this machine out of the file test.
    env: { ...process.env, NODE_ENV: "test", OMNIFM_RUNTIME_DATA_DIR: dataDir, MONGO_URL: "", ...env },
  });
}

// Answers each prompt once it shows, as a person types after the question.
function driveWizard(answers) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "src/stations-cli.js"), "wizard"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "test", OMNIFM_RUNTIME_DATA_DIR: dataDir, MONGO_URL: "" },
    });
    const pending = [...answers];
    let output = "";
    let answeredUpTo = 0;
    const onOutput = (chunk) => {
      output += chunk;
      const prompt = /(Auswahl|Name|URL|Key \(optional\)): $/.exec(output);
      if (prompt && prompt.index >= answeredUpTo && pending.length) {
        answeredUpTo = output.length;
        child.stdin.write(`${pending.shift()}\n`);
      }
    };
    child.stdout.setEncoding("utf8").on("data", onOutput);
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
}

test("the wizard saves two changes in one session", async () => {
  const result = await driveWizard([
    "2", "First FM", "https://example.com/one.mp3", "firstfm",
    "2", "Second FM", "https://example.com/two.mp3", "secondfm",
    "8",
  ]);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /Fehler/, "the second change failed");
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "stations.json"), "utf8"));
  assert.equal(saved.stations.firstfm?.name, "First FM");
  assert.equal(saved.stations.secondfm?.name, "Second FM");
});

test("with MongoDB a change lands in the catalogue the bot reads", { skip: !hasMongoConfig }, async () => {
  const dbName = `omnifm_stations_cli_${process.pid}`;
  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  try {
    const result = runCli(["add", "Mongo FM", "https://example.com/mongo.mp3", "mongofm"], {
      env: { MONGO_URL: process.env.MONGO_URL, DB_NAME: dbName },
    });
    assert.equal(result.status, 0, result.stderr);
    const station = await client.db(dbName).collection("stations").findOne({ key: "mongofm" });
    assert.equal(station?.name, "Mongo FM");
  } finally {
    await client.db(dbName).dropDatabase().catch(() => null);
    await client.close();
  }
});
