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

// A server checkout of a tiny repository with the real update.sh; backups and
// start.sh are stand-ins. A second clone plays the developer who pushes v2.
async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-rollback-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const remote = path.join(base, "remote.git");
  const server = path.join(base, "server");
  const developer = path.join(base, "developer");
  await git(base, "init", "--bare", "-q", remote);
  await git(base, "clone", "-q", remote, server);
  await fs.mkdir(path.join(server, "scripts"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "update.sh"), path.join(server, "update.sh"));
  await fs.writeFile(path.join(server, "scripts", "backup-runtime-data.sh"), "exit 0\n");
  await fs.writeFile(path.join(server, "scripts", "backup-mongodb.sh"), "exit 0\n");
  await fs.writeFile(path.join(server, "start.sh"), "#!/usr/bin/env bash\necho started >> start.log\n", { mode: 0o755 });
  await fs.writeFile(path.join(server, "version.txt"), "v1\n");
  await fs.writeFile(path.join(server, ".gitignore"), "backend/\n.update-backups/\nstart.log\nrun/\n");
  await git(server, "add", "-A");
  await git(server, "commit", "-q", "-m", "v1");
  await git(server, "push", "-q", "origin", "HEAD:main");
  await git(server, "branch", "-q", "--set-upstream-to=origin/main");
  await fs.mkdir(path.join(server, "backend"), { recursive: true });
  await fs.writeFile(path.join(server, "backend", ".env"), "MONGO_URL=\nDB_NAME=omnifm_test\n");

  await git(base, "clone", "-q", remote, developer);
  await fs.writeFile(path.join(developer, "version.txt"), "v2\n");
  await git(developer, "commit", "-q", "-am", "v2");
  await git(developer, "push", "-q", "origin", "HEAD:main");
  return { server };
}

async function run(server, ...args) {
  const env = { ...process.env, ...GIT_ENV, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}` };
  try {
    const pending = execFile(resolveBash(), [path.join(server, "update.sh"), ...args], { cwd: server, env, timeout: 60_000 });
    // No terminal: the rollback question reads end-of-input and must stop.
    pending.child.stdin.end();
    const result = await pending;
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("an update is recorded and --rollback returns to the code before it", async (t) => {
  const { server } = await setup(t);
  const v1 = await git(server, "rev-parse", "HEAD");

  const update = await run(server);
  assert.equal(update.code, 0, update.stderr);
  assert.equal((await fs.readFile(path.join(server, "version.txt"), "utf8")).trim(), "v2");
  const v2 = await git(server, "rev-parse", "HEAD");
  const history = await fs.readFile(path.join(server, ".update-backups", "update-history.log"), "utf8");
  assert.match(history, new RegExp(`^\\S+ ${v1} ${v2}$`, "m"));

  const rollback = await run(server, "--rollback", "--yes");
  assert.equal(rollback.code, 0, rollback.stderr);
  assert.equal(await git(server, "rev-parse", "HEAD"), v1);
  assert.equal((await fs.readFile(path.join(server, "version.txt"), "utf8")).trim(), "v1");
  assert.match(await fs.readFile(path.join(server, "start.log"), "utf8"), /started\nstarted/, "restarted after update and rollback");
  assert.match(await fs.readFile(path.join(server, ".update-backups", "update-history.log"), "utf8"), new RegExp(`${v2} ${v1} rollback$`, "m"));

  // The next update brings v2 back: a rollback lasts until the fix arrives.
  assert.equal((await run(server)).code, 0);
  assert.equal(await git(server, "rev-parse", "HEAD"), v2);
});

test("without a recorded update --rollback refuses and changes nothing", async (t) => {
  const { server } = await setup(t);
  const before = await git(server, "rev-parse", "HEAD");
  const result = await run(server, "--rollback", "--yes");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /kein Update/);
  assert.equal(await git(server, "rev-parse", "HEAD"), before);
});

test("--rollback asks first and does nothing without a yes", async (t) => {
  const { server } = await setup(t);
  assert.equal((await run(server)).code, 0);
  const updated = await git(server, "rev-parse", "HEAD");
  const result = await run(server, "--rollback");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Abgebrochen/);
  assert.equal(await git(server, "rev-parse", "HEAD"), updated);
});
