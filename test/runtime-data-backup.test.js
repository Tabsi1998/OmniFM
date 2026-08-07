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
