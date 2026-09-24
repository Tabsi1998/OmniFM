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

test("runtime data backup restores a staged archive and leaves no staging directory", async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-runtime-backup-"));
  const scriptsDir = path.join(sandbox, "scripts");
  const runtimeDir = path.join(sandbox, "runtime-data");
  const backupDir = path.join(sandbox, ".update-backups", "runtime-data");
  const scriptPath = path.join(scriptsDir, "backup-runtime-data.sh");
  const ownerAuditPath = path.join(runtimeDir, "owner-audit.json");

  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "backup-runtime-data.sh"), scriptPath);
  await fs.writeFile(ownerAuditPath, '{"version":1,"events":[{"action":"before"}]}\n', "utf8");

  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  const bash = resolveBash();
  await execFile(bash, [scriptPath, "create"], { cwd: sandbox });
  const archives = (await fs.readdir(backupDir)).filter((name) => name.endsWith(".tar.gz"));
  assert.equal(archives.length, 1);

  if (process.platform !== "win32") {
    assert.equal((await fs.stat(backupDir)).mode & 0o777, 0o700, "backup directory must be private");
    assert.equal((await fs.stat(path.join(backupDir, archives[0]))).mode & 0o777, 0o600, "backup archive must be private");
    const checksumPath = path.join(backupDir, `${archives[0]}.sha256`);
    try {
      assert.equal((await fs.stat(checksumPath)).mode & 0o777, 0o600, "backup checksum must be private");
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
  }

  await fs.writeFile(ownerAuditPath, '{"version":1,"events":[{"action":"after"}]}\n', "utf8");
  const archiveArg = path.join(".update-backups", "runtime-data", archives[0]).split(path.sep).join("/");
  await execFile(bash, [scriptPath, "restore", archiveArg, "--force"], { cwd: sandbox });

  const restored = await fs.readFile(ownerAuditPath, "utf8");
  assert.match(restored, /before/);
  assert.doesNotMatch(restored, /after/);

  const entries = await fs.readdir(sandbox);
  assert.equal(entries.some((name) => name.startsWith(".runtime-data-restore.")), false);
  assert.equal(entries.some((name) => name.startsWith("runtime-data.pre-restore-")), true);
});

async function makeBackupSandbox(t, fakeTarExit) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-runtime-live-"));
  const scriptsDir = path.join(sandbox, "scripts");
  const runtimeDir = path.join(sandbox, "runtime-data");
  const binDir = path.join(sandbox, "bin");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(path.join(runtimeDir, "dashboard.json.lock"), { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "backup-runtime-data.sh"), path.join(scriptsDir, "backup-runtime-data.sh"));
  await fs.writeFile(path.join(runtimeDir, "bot-state.json"), "{\"guilds\":{}}\n", "utf8");
  await fs.writeFile(path.join(runtimeDir, "dashboard.json.tmp-123-456"), "half written", "utf8");
  await fs.writeFile(path.join(runtimeDir, "dashboard.json.lock", "owner"), "{}", "utf8");
  // A tar in front of the real one: it archives normally, then reports the exit
  // code a running bot causes (1) or a real failure (2) for the create call.
  await fs.writeFile(path.join(binDir, "tar"), [
    "#!/usr/bin/env bash",
    "PATH=\"${PATH#*:}\" tar \"$@\"",
    "status=$?",
    "case \" $* \" in *\" -czf \"*) exit ${FAKE_TAR_EXIT:-$status} ;; esac",
    "exit $status",
    "",
  ].join("\n"), { mode: 0o755 });
  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });
  const binPath = binDir.split(path.sep).join("/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  const run = () => execFile(resolveBash(), ["-c", `export PATH="${binPath}:$PATH"; bash scripts/backup-runtime-data.sh create`], {
    cwd: sandbox,
    env: { ...process.env, FAKE_TAR_EXIT: String(fakeTarExit) },
    timeout: 60_000,
  });
  return { sandbox, run };
}

test("a backup of data the running bot writes succeeds with a warning and leaves out temp files", async (t) => {
  const { sandbox, run } = await makeBackupSandbox(t, 1);
  const { stderr } = await run();
  assert.match(stderr, /\[WARN\] Runtime data changed while it was archived/);
  const backupDir = path.join(sandbox, ".update-backups", "runtime-data");
  const archives = (await fs.readdir(backupDir)).filter((name) => name.endsWith(".tar.gz"));
  assert.equal(archives.length, 1);
  const { stdout } = await execFile("tar", ["-tzf", archives[0]], { cwd: backupDir });
  assert.match(stdout, /runtime-data\/bot-state\.json/);
  assert.doesNotMatch(stdout, /tmp-123-456/, "a half written temp file stays out");
  assert.doesNotMatch(stdout, /dashboard\.json\.lock/, "a lock folder stays out");
});

test("a real tar failure still stops the backup and leaves no archive", async (t) => {
  const { sandbox, run } = await makeBackupSandbox(t, 2);
  await assert.rejects(run(), /tar failed with exit 2/);
  const backupDir = path.join(sandbox, ".update-backups", "runtime-data");
  const leftovers = await fs.readdir(backupDir);
  assert.deepEqual(leftovers, [], "no archive and no temp archive");
});
