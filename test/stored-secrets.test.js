import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  SecretKeyError, checkStoredSecrets, decryptStoredSecrets, describeOwnerSecrets, encryptStoredSecrets,
  openOwnerSecrets, resealLinkedRoleTokens, sealOwnerSecrets,
} from "../src/lib/stored-secrets.js";
import { decryptToken, encryptToken, parseTokenKey, tokenKeysFrom } from "../src/lib/token-crypto.js";
import { loadOwnerConfig, updateEnvFile } from "../src/entrypoints/owner-env.mjs";

// The owner console's secrets sealed in MongoDB (#284): bot tokens, OAuth and
// SMTP secrets, API keys and webhooks as "enc:v1:..." with OMNIFM_TOKEN_KEY.
const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = randomBytes(32);
const OTHER = randomBytes(32);

const ownerConfig = () => ({
  _id: "global",
  discord: {
    commander: { name: "OmniFM", clientId: "100000000000000001", token: "commander-token" },
    workers: [{ clientId: "100000000000000002", token: "worker-token", tier: "pro" }, { clientId: "100000000000000003", token: "" }],
  },
  system: {
    discordOAuth: { clientId: "100000000000000001", clientSecret: "oauth-secret", scopes: "identify guilds" },
    smtp: { host: "mail.example", password: "smtp-password" },
    operatorAlerts: { webhookUrl: "https://discord.com/api/webhooks/1/hook", mention: "<@1>" },
    botDirectories: { topGG: { token: "topgg-token", webhookSecret: "topgg-webhook" } },
  },
  company: { name: "OmniFM" },
  updatedAt: new Date("2026-10-11T08:00:00Z"),
});
const PLAIN = ["commander-token", "worker-token", "oauth-secret", "smtp-password", "https://discord.com/api/webhooks/1/hook", "topgg-token", "topgg-webhook"];

test("sealed: every secret field, nothing else; opened: the same document again", () => {
  const sealed = sealOwnerSecrets(ownerConfig(), KEY);
  const text = JSON.stringify(sealed);
  for (const secret of PLAIN) assert.ok(!text.includes(secret), `${secret} is not in the sealed document`);
  assert.match(sealed.discord.commander.token, /^enc:v1:/);
  assert.equal(sealed.discord.workers[1].token, "", "an empty secret stays empty");
  assert.equal(sealed.system.operatorAlerts.mention, "<@1>");
  assert.equal(sealed.company.name, "OmniFM");
  assert.ok(sealed.updatedAt instanceof Date, "a date stays a date");
  assert.deepEqual(sealOwnerSecrets(sealed, KEY), sealed, "sealed values are not sealed twice");

  const { doc, failed } = openOwnerSecrets(sealed, [KEY]);
  assert.deepEqual(failed, []);
  assert.deepEqual(doc, ownerConfig());
  assert.deepEqual(openOwnerSecrets(ownerConfig(), [KEY]).doc, ownerConfig(), "plain values of an older installation are taken as they are");
});

test("another key opens nothing: the secrets count as empty and are named", () => {
  const sealed = sealOwnerSecrets(ownerConfig(), KEY);
  const { doc, failed } = openOwnerSecrets(sealed, [OTHER]);
  assert.equal(doc.discord.commander.token, "");
  assert.deepEqual(failed.sort(), [
    "discord.commander.token", "discord.workers.0.token", "system.botDirectories.topGG.token", "system.botDirectories.topGG.webhookSecret",
    "system.discordOAuth.clientSecret", "system.operatorAlerts.webhookUrl", "system.smtp.password",
  ]);
  assert.deepEqual(describeOwnerSecrets(sealed, [OTHER]).unopenable.length, 7);
  assert.throws(() => sealOwnerSecrets(ownerConfig(), null), SecretKeyError, "without a key nothing secret is stored, not even in plain text");
  assert.deepEqual(sealOwnerSecrets({ company: { name: "x" } }, null), { company: { name: "x" } }, "nothing secret, no key needed");
});

test("during a key change the previous key still opens, and the report says so", () => {
  const env = { OMNIFM_TOKEN_KEY: OTHER.toString("hex"), OMNIFM_TOKEN_KEY_PREVIOUS: KEY.toString("base64") };
  const keys = tokenKeysFrom(env);
  assert.equal(keys.length, 2);
  const sealed = sealOwnerSecrets(ownerConfig(), KEY);
  assert.deepEqual(openOwnerSecrets(sealed, keys).failed, []);
  const report = describeOwnerSecrets(sealed, keys);
  assert.deepEqual([report.sealed, report.previousKey.length, report.plain.length, report.unopenable.length], [0, 7, 0, 0]);
  assert.equal(decryptToken(encryptToken("x", KEY), keys), "x");
  assert.deepEqual(tokenKeysFrom({ OMNIFM_TOKEN_KEY: "short" }), []);
});

test("the owner cockpit: green when all is sealed, yellow while plain, red when the key does not fit", async () => {
  const { checkSecrets } = await import("../src/services/owner-status/checks.js");
  const db = (doc) => ({ collection: () => ({ findOne: async () => doc }) });
  const env = { OMNIFM_TOKEN_KEY: KEY.toString("hex") };
  const sealed = sealOwnerSecrets(ownerConfig(), KEY);
  assert.deepEqual([(await checkSecrets({ db: db(sealed), env })).state, (await checkSecrets({ db: db(sealed), env })).summary],
    ["ok", "Alle 7 Geheimnisse (Bot-Tokens, Passwörter, Schlüssel) liegen verschlüsselt in MongoDB."]);
  const plain = await checkSecrets({ db: db(ownerConfig()), env });
  assert.equal(plain.state, "warn");
  assert.match(plain.summary, /7 Geheimnisse noch unverschlüsselt/);
  assert.equal((await checkSecrets({ db: db(ownerConfig()), env: {} })).state, "warn", "without a key: yellow, ./update.sh makes one");
  const wrong = await checkSecrets({ db: db(sealed), env: { OMNIFM_TOKEN_KEY: OTHER.toString("hex") } });
  assert.equal(wrong.state, "fail");
  assert.match(wrong.detail, /discord\.commander\.token/);
  assert.equal((await checkSecrets({ db: db(null), env })).state, "ok", "nothing stored yet");
});

test("backend/.env changes one entry at a time and keeps everything else", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "# OmniFM\r\nMONGO_URL=mongodb://x\r\nOMNIFM_TOKEN_KEY=old\r\nDB_NAME=omnifm\r\nOMNIFM_TOKEN_KEY=again\r\n");
  updateEnvFile(file, { OMNIFM_TOKEN_KEY: "new", OMNIFM_TOKEN_KEY_PREVIOUS: "old" });
  assert.equal(fs.readFileSync(file, "utf8"), "# OmniFM\r\nMONGO_URL=mongodb://x\r\nOMNIFM_TOKEN_KEY=new\r\nDB_NAME=omnifm\r\nOMNIFM_TOKEN_KEY_PREVIOUS=old\r\n");
  updateEnvFile(file, { OMNIFM_TOKEN_KEY_PREVIOUS: null });
  assert.equal(fs.readFileSync(file, "utf8"), "# OmniFM\r\nMONGO_URL=mongodb://x\r\nOMNIFM_TOKEN_KEY=new\r\nDB_NAME=omnifm\r\n");
  assert.deepEqual(fs.readdirSync(dir), [".env"], "no temporary file is left");
  fs.rmSync(dir, { recursive: true, force: true });
});

async function scratchDb(t, suffix) {
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    t.skip("MongoDB is not configured for this test run");
    return null;
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  const name = `${String(process.env.DB_NAME || "omnifm_test").trim()}_${suffix}`;
  const db = client.db(name);
  await db.dropDatabase();
  t.after(async () => {
    await db.dropDatabase().catch(() => null);
    await client.close();
  });
  return { db, name, mongoUrl };
}

test("the migration seals the plain secrets in MongoDB once; a rollback opens them again", async (t) => {
  const scratch = await scratchDb(t, "secrets");
  if (!scratch) return;
  const { db } = scratch;
  await db.collection("owner_config").insertOne(ownerConfig());

  assert.deepEqual((await checkStoredSecrets(db, [KEY])).plain.length, 7);
  assert.equal(await encryptStoredSecrets(db, { key: KEY, keys: [KEY] }), 7);
  const stored = await db.collection("owner_config").findOne({ _id: "global" });
  const dump = JSON.stringify(stored);
  for (const secret of PLAIN) assert.ok(!dump.includes(secret), `${secret} is gone from MongoDB`);
  assert.equal(stored.company.name, "OmniFM", "the rest of the document stays");
  assert.equal(await encryptStoredSecrets(db, { key: KEY, keys: [KEY] }), 0, "the second start changes nothing");

  await assert.rejects(encryptStoredSecrets(db, { key: OTHER, keys: [OTHER] }), SecretKeyError, "a key that does not fit seals nothing");
  assert.equal(await decryptStoredSecrets(db, [KEY]), 7);
  assert.equal((await db.collection("owner_config").findOne({ _id: "global" })).discord.commander.token, "commander-token");
});

test("the bot start refuses secrets its key does not open, instead of starting without tokens", async (t) => {
  const scratch = await scratchDb(t, "secrets_start");
  if (!scratch) return;
  await scratch.db.collection("owner_config").insertOne(sealOwnerSecrets(ownerConfig(), KEY));
  const opened = await loadOwnerConfig({ url: scratch.mongoUrl, dbName: scratch.name, keys: [KEY] });
  assert.equal(opened.discord.commander.token, "commander-token");
  await assert.rejects(loadOwnerConfig({ url: scratch.mongoUrl, dbName: scratch.name, keys: [OTHER] }), (error) => error.name === "SecretKeyError"
    && /discord\.commander\.token/.test(error.message));
});

test("the linked roles' tokens are sealed again with the new key; unknown ones stay", async (t) => {
  const scratch = await scratchDb(t, "secrets_linked");
  if (!scratch) return;
  const linked = scratch.db.collection("linked_roles");
  await linked.insertMany([
    { _id: "1", accessToken: encryptToken("a1", KEY), refreshToken: encryptToken("r1", KEY) },
    { _id: "2", accessToken: encryptToken("a2", OTHER), refreshToken: encryptToken("r2", OTHER) },
  ]);
  const fresh = randomBytes(32);
  assert.equal(await resealLinkedRoleTokens(scratch.db, { key: fresh, keys: [fresh, KEY] }), 1);
  const [one, two] = await linked.find({}).sort({ _id: 1 }).toArray();
  assert.deepEqual([decryptToken(one.accessToken, [fresh]), decryptToken(one.refreshToken, [fresh])], ["a1", "r1"]);
  assert.equal(decryptToken(two.accessToken, [OTHER]), "a2", "a token no key opens stays; its owner connects again");
});

test("scripts/database.mjs: check, seal and change the key, also after an interruption", async (t) => {
  const scratch = await scratchDb(t, "secrets_script");
  if (!scratch) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-key-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, `MONGO_URL=${scratch.mongoUrl}\nDB_NAME=${scratch.name}\nOMNIFM_TOKEN_KEY=${KEY.toString("hex")}\n`);
  const env = { ...process.env };
  for (const name of ["MONGO_URL", "DB_NAME", "OMNIFM_TOKEN_KEY", "OMNIFM_TOKEN_KEY_PREVIOUS"]) delete env[name];
  const run = (...args) => execFile(process.execPath, ["scripts/database.mjs", "--env-file", envFile, ...args], { cwd: ROOT, env });
  const keyOf = (name) => parseTokenKey(Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter(Boolean).map((line) => line.split("=")))[name]);
  await scratch.db.collection("owner_config").insertOne(ownerConfig());
  await scratch.db.collection("linked_roles").insertOne({ _id: "1", accessToken: encryptToken("a1", KEY), refreshToken: encryptToken("r1", KEY) });

  await run("check-secrets");
  assert.match((await run("encrypt-secrets")).stdout, /Geheimnisse verschlüsselt: 7\./);

  assert.match((await run("rotate-key")).stdout, /Neuer Schlüssel aktiv: 7 Geheimnisse und 1 Linked-Roles-Konten/);
  const rotated = keyOf("OMNIFM_TOKEN_KEY");
  assert.ok(rotated && !rotated.equals(KEY), "a new key in the file");
  assert.equal(keyOf("OMNIFM_TOKEN_KEY_PREVIOUS"), null, "the old key is gone once everything is sealed again");
  const stored = await scratch.db.collection("owner_config").findOne({ _id: "global" });
  assert.deepEqual(openOwnerSecrets(stored, [rotated]).failed, []);
  assert.equal(openOwnerSecrets(stored, [KEY]).failed.length, 7, "the old key opens nothing any more");

  // An interrupted change: the new key and the old one in the file, the values still under the old one.
  const stale = sealOwnerSecrets(ownerConfig(), rotated);
  await scratch.db.collection("owner_config").replaceOne({ _id: "global" }, stale);
  const next = randomBytes(32);
  updateEnvFile(envFile, { OMNIFM_TOKEN_KEY: next.toString("hex"), OMNIFM_TOKEN_KEY_PREVIOUS: rotated.toString("hex") });
  await run("check-secrets");
  await run("rotate-key");
  assert.ok(keyOf("OMNIFM_TOKEN_KEY").equals(next), "the change is finished with the key it began with");
  assert.equal(keyOf("OMNIFM_TOKEN_KEY_PREVIOUS"), null);
  assert.deepEqual(openOwnerSecrets(await scratch.db.collection("owner_config").findOne({ _id: "global" }), [next]).failed, []);

  // A key that opens nothing stops the deployment before the switch.
  updateEnvFile(envFile, { OMNIFM_TOKEN_KEY: randomBytes(32).toString("hex") });
  await assert.rejects(run("check-secrets"), (error) => error.code === 1 && /öffnet diese Geheimnisse in MongoDB nicht/.test(error.stderr));
});
