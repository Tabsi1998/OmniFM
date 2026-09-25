import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveBash() {
  if (process.platform === "win32") {
    return process.env.OMNIFM_TEST_BASH || "C:\\Program Files\\Git\\bin\\bash.exe";
  }
  return process.env.OMNIFM_TEST_BASH || "bash";
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "OmniFM Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "OmniFM Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

async function git(cwd, ...args) {
  const { stdout } = await execFile("git", ["-c", "init.defaultBranch=main", "-c", "core.autocrlf=false", ...args], {
    cwd, env: { ...process.env, ...GIT_ENV },
  });
  return stdout.trim();
}

// Production checkout of a tiny repository with the real staging script; the
// start.sh of the repository only records that it ran.
async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-staging-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const remote = path.join(base, "remote.git");
  const production = path.join(base, "production");
  const staging = path.join(base, "staging");
  await git(base, "init", "--bare", "-q", remote);
  await git(base, "clone", "-q", remote, production);
  await fs.mkdir(path.join(production, "scripts"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "staging.sh"), path.join(production, "scripts", "staging.sh"));
  await fs.writeFile(path.join(production, "start.sh"), "#!/usr/bin/env bash\necho \"started $(pwd)\" >> start.log\n", { mode: 0o755 });
  await fs.writeFile(path.join(production, ".gitignore"), "backend/.env\nfrontend/.env\ninstance.env\nstart.log\n");
  await git(production, "add", "-A");
  await git(production, "commit", "-q", "-m", "base");
  await git(production, "push", "-q", "origin", "HEAD:main");
  await fs.mkdir(path.join(production, "backend"), { recursive: true });
  await fs.writeFile(path.join(production, "backend", ".env"),
    "MONGO_URL=mongodb://127.0.0.1:27017\nDB_NAME=omnifm\nAPI_ADMIN_TOKEN=production-secret\nOPERATOR_WEBHOOK_URL=https://discord.com/api/webhooks/1/prod\n");
  return { base, remote, production, staging };
}

async function staging(env, production, ...args) {
  try {
    const result = await execFile(resolveBash(), [path.join(production, "scripts", "staging.sh"), ...args], {
      cwd: production, env: { ...process.env, ...GIT_ENV, ...env },
    });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function envOf(text) {
  return Object.fromEntries(text.split("\n").filter((line) => /^[A-Z_]+=/.test(line)).map((line) => line.split(/=(.*)/s).slice(0, 2)));
}

test("setup writes a separate instance: own units, ports, database and owner token, no production alerts", async (t) => {
  const { production, staging: dir } = await setup(t);
  const env = { OMNIFM_STAGING_DIR: dir };
  const result = await staging(env, production, "setup", "--domain", "staging.example.test");
  assert.equal(result.code, 0, result.stderr);

  const instance = envOf(await fs.readFile(path.join(dir, "instance.env"), "utf8"));
  assert.deepEqual(instance, { OMNIFM_INSTANCE: "staging", FRONTEND_PORT: "3100", BACKEND_PORT: "8101" });

  const backend = envOf(await fs.readFile(path.join(dir, "backend", ".env"), "utf8"));
  assert.equal(backend.DB_NAME, "omnifm_staging");
  assert.equal(backend.MONGO_URL, "mongodb://127.0.0.1:27017");
  assert.match(backend.API_ADMIN_TOKEN, /^[0-9a-f]{48}$/);
  assert.equal(backend.OMNIFM_NODE_API_PORT, "8102");
  assert.equal(backend.PUBLIC_WEB_URL, "https://staging.example.test");
  assert.equal(backend.OPERATOR_WEBHOOK_URL, undefined, "staging never alerts into the production channel");
  assert.equal((await fs.readFile(path.join(dir, "frontend", ".env"), "utf8")).trim(), "REACT_APP_BACKEND_URL=");

  const again = await staging(env, production, "setup");
  assert.notEqual(again.code, 0, "a second setup never overwrites staging");
  assert.match(again.stderr, /gibt es schon/);
});

test("deploy puts a pushed branch on staging and starts it there, production stays", async (t) => {
  const { base, remote, production, staging: dir } = await setup(t);
  const env = { OMNIFM_STAGING_DIR: dir };
  assert.equal((await staging(env, production, "setup", "--domain", "staging.example.test")).code, 0);
  const productionHead = await git(production, "rev-parse", "HEAD");

  const developer = path.join(base, "developer");
  await git(base, "clone", "-q", remote, developer);
  await git(developer, "checkout", "-q", "-b", "feature/try-me");
  await fs.writeFile(path.join(developer, "feature.txt"), "new\n");
  await git(developer, "add", "-A");
  await git(developer, "commit", "-q", "-m", "try me");
  await git(developer, "push", "-q", "origin", "feature/try-me");
  const featureHead = await git(developer, "rev-parse", "HEAD");

  const result = await staging(env, production, "deploy", "feature/try-me");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await git(dir, "rev-parse", "HEAD"), featureHead);
  assert.match(await fs.readFile(path.join(dir, "start.log"), "utf8"), /started/);
  assert.equal(await git(production, "rev-parse", "HEAD"), productionHead, "production is untouched");
  await assert.rejects(fs.access(path.join(production, "start.log")), "production did not start");
});
