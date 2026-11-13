import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #524: a restore must not run while the systemd services, the nightly backup
// or another backup/restore of the same database are running.
const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveBash() {
  if (process.platform === "win32") {
    return process.env.OMNIFM_TEST_BASH || "C:\\Program Files\\Git\\bin\\bash.exe";
  }
  return process.env.OMNIFM_TEST_BASH || "bash";
}

async function writeExecutable(filePath, contents) {
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o755);
}

// The real backup-mongodb.sh with stand-ins for python3, the MongoDB tools,
// systemctl and flock. OMNIFM_FAKE_UNIT_STATES lists unit=state pairs; the
// stub prints the state and exits like systemctl is-active (0 only for active
// and reloading, else 3). OMNIFM_FAKE_FLOCK_BUSY=1: the lock stays taken;
// =briefly: only the non-blocking attempt fails.
async function sandbox(t, { fakeFlock = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-restore-guard-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "scripts");
  const bin = path.join(root, "fake-bin");
  const trace = path.join(root, "trace.log");
  await fs.mkdir(scripts, { recursive: true });
  await fs.mkdir(path.join(root, "backend"), { recursive: true });
  await fs.mkdir(path.join(root, "run"), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await Promise.all(["backup-mongodb.sh", "instance-env.sh"].map((name) =>
    fs.copyFile(path.join(repoRoot, "scripts", name), path.join(scripts, name))));
  await fs.writeFile(path.join(root, "backend", ".env"),
    "MONGO_URL=mongodb://127.0.0.1:27017\nDB_NAME=omnifm_test\n", "utf8");
  await writeExecutable(path.join(bin, "python3"), "#!/usr/bin/env bash\nprintf 'uri: \"%s\"\\n' \"$(cat)\"\n");
  await writeExecutable(path.join(bin, "mongodump"), `#!/usr/bin/env bash
for arg in "$@"; do case "$arg" in --archive=*) archive="\${arg#--archive=}" ;; esac; done
printf 'fake' | gzip -c > "$archive"
`);
  await writeExecutable(path.join(bin, "mongorestore"),
    "#!/usr/bin/env bash\nprintf 'mongorestore %s\\n' \"$*\" >> \"$OMNIFM_FAKE_TRACE\"\n");
  await writeExecutable(path.join(bin, "systemctl"), `#!/usr/bin/env bash
[ "$1" = "is-active" ] || exit 3
state=inactive
for pair in $OMNIFM_FAKE_UNIT_STATES; do
  [ "\${pair%%=*}.service" = "\${!#}" ] && state="\${pair#*=}"
done
[ "$2" = "--quiet" ] || echo "$state"
case "$state" in active|reloading) exit 0 ;; *) exit 3 ;; esac
`);
  if (fakeFlock) {
    await writeExecutable(path.join(bin, "flock"),
      `#!/usr/bin/env bash
printf 'flock %s\\n' "$*" >> "$OMNIFM_FAKE_TRACE"
case "\${OMNIFM_FAKE_FLOCK_BUSY:-}:$1" in 1:*|briefly:-n) exit 1 ;; esac
`);
  }
  const archive = path.join(root, "old.archive.gz");
  execFileSync(resolveBash(), ["-c", `printf old | gzip -c > "${archive.replaceAll("\\", "/")}"`]);
  return { root, bin, trace, archive };
}

async function restore({ root, bin, trace, archive }, env = {}, prefix = "") {
  const script = `${prefix}bash scripts/backup-mongodb.sh restore "$1" --force`;
  try {
    const result = await execFile(resolveBash(), ["-c", script, "restore", archive.replaceAll("\\", "/")], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`, OMNIFM_FAKE_TRACE: trace, ...env },
    });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function restored(trace) {
  return (await fs.readFile(trace, "utf8").catch(() => "")).includes("mongorestore");
}

test("restore runs when every OmniFM process is stopped and takes the backup lock", async (t) => {
  const box = await sandbox(t);
  const result = await restore(box);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(await restored(box.trace));
  assert.match(await fs.readFile(box.trace, "utf8"), /^flock -n \d+$/m);
});

// Restart=always units sit in activating between two starts and in
// deactivating while they shut down; both still touch the database.
for (const [unit, state] of [["omnifm-backend", "active"], ["omnifm-bot", "active"], ["omnifm-frontend", "active"],
  ["omnifm-bot", "activating"], ["omnifm-backend", "deactivating"]]) {
  test(`restore stops while the systemd unit ${unit} is ${state}`, async (t) => {
    const box = await sandbox(t);
    const result = await restore(box, { OMNIFM_FAKE_UNIT_STATES: `${unit}=${state}` });
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`${unit}.*\\./stop\\.sh`));
    assert.equal(await restored(box.trace), false);
  });
}

// omnifm-backup.service is Type=oneshot: activating for as long as it runs.
test("restore stops while the nightly backup service is running", async (t) => {
  const box = await sandbox(t);
  const result = await restore(box, { OMNIFM_FAKE_UNIT_STATES: "omnifm-backup=activating" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /omnifm-backup.*finished/);
  assert.equal(await restored(box.trace), false);
});

test("a staging checkout checks its own units", async (t) => {
  const box = await sandbox(t);
  await fs.writeFile(path.join(box.root, "instance.env"), "OMNIFM_INSTANCE=staging\n");
  const result = await restore(box, { OMNIFM_FAKE_UNIT_STATES: "omnifm-staging-bot=active omnifm-bot=inactive" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /omnifm-staging-bot/);
});

test("restore stops while a process from run/*.pid is alive", async (t) => {
  const box = await sandbox(t);
  const result = await restore(box, {},
    "sleep 30 >/dev/null 2>&1 & echo $! > run/bot.pid; trap 'kill $!' EXIT; ");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\.\/stop\.sh/);
  assert.equal(await restored(box.trace), false);
});

test("restore stops while another backup or restore holds the lock", async (t) => {
  const box = await sandbox(t);
  const result = await restore(box, { OMNIFM_FAKE_FLOCK_BUSY: "1" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Another MongoDB backup or restore is running/);
  assert.equal(await restored(box.trace), false);
});

async function create(box, env = {}) {
  return execFile(resolveBash(), ["scripts/backup-mongodb.sh", "create"], {
    cwd: box.root,
    env: { ...process.env, PATH: `${box.bin}${path.delimiter}${process.env.PATH || ""}`, OMNIFM_FAKE_TRACE: box.trace, ...env },
  });
}

test("create waits for a running backup or restore instead of failing at once", async (t) => {
  const box = await sandbox(t);
  const result = await create(box, { OMNIFM_FAKE_FLOCK_BUSY: "briefly" });
  assert.match(result.stdout, /Waiting up to 30 minutes/);
  assert.match(result.stdout, /MongoDB backup created/);
  assert.match(await fs.readFile(box.trace, "utf8"), /^flock -n \d+\nflock -w 1800 \d+$/m);
});

test("create takes a free lock without waiting", async (t) => {
  const box = await sandbox(t);
  const result = await create(box);
  assert.doesNotMatch(result.stdout, /Waiting/);
  assert.equal((await fs.readFile(box.trace, "utf8")).trim(), "flock -n 9");
});

// One run as root must not lock the service user out of the next backup.
test("the lock file stays readable for other users", { skip: process.platform === "win32" && "no POSIX modes" }, async (t) => {
  const box = await sandbox(t);
  await create(box);
  const { mode } = await fs.stat(path.join(box.root, ".update-backups", "mongodb", ".backup.lock"));
  assert.equal(mode & 0o777, 0o644);
});

const realFlock = (() => {
  try {
    execFileSync(resolveBash(), ["-c", "command -v flock"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("with the real flock a running backup blocks the restore", { skip: !realFlock && "flock is not installed" }, async (t) => {
  const box = await sandbox(t, { fakeFlock: false });
  const lock = ".update-backups/mongodb/.backup.lock";
  const result = await restore(box, {},
    `mkdir -p .update-backups/mongodb; flock ${lock} sleep 30 & holder=$!; trap 'kill $holder' EXIT; sleep 1; `);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Another MongoDB backup or restore is running/);
  assert.equal(await restored(box.trace), false);
});
