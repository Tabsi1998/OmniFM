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

async function writeExecutable(filePath, contents) {
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o755);
}

test("MongoDB backup keeps credentials private and restore creates a safety snapshot", async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-mongo-backup-"));
  const scriptsDir = path.join(sandbox, "scripts");
  const backendDir = path.join(sandbox, "backend");
  const binDir = path.join(sandbox, "fake-bin");
  const backupDir = path.join(sandbox, ".update-backups", "mongodb");
  const scriptPath = path.join(scriptsDir, "backup-mongodb.sh");
  const tracePath = path.join(sandbox, "tool-trace.log");
  const secret = "never-print-this-password";

  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(backendDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "backup-mongodb.sh"), scriptPath);
  await fs.writeFile(
    path.join(backendDir, ".env"),
    `MONGO_URL=mongodb://owner:${secret}@127.0.0.1:27017/?authSource=admin\nDB_NAME=omnifm_test\n`,
    "utf8",
  );
  await writeExecutable(path.join(binDir, "python3"), `#!/usr/bin/env bash
set -euo pipefail
uri="$(cat)"
printf 'uri: "%s"\\n' "$uri"
`);
  await writeExecutable(path.join(binDir, "mongodump"), `#!/usr/bin/env bash
set -euo pipefail
archive=""
config=""
for arg in "$@"; do
  case "$arg" in
    --archive=*) archive="\${arg#--archive=}" ;;
    --config=*) config="\${arg#--config=}" ;;
  esac
done
grep -q '${secret}' "$config"
printf 'fake omnifm bson archive' | gzip -c > "$archive"
printf 'mongodump %s\\n' "$*" >> "$OMNIFM_FAKE_TRACE"
`);
  await writeExecutable(path.join(binDir, "mongorestore"), `#!/usr/bin/env bash
set -euo pipefail
printf 'mongorestore %s\\n' "$*" >> "$OMNIFM_FAKE_TRACE"
`);

  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    OMNIFM_FAKE_TRACE: tracePath,
  };
  const bash = resolveBash();
  const created = await execFile(bash, [scriptPath, "create"], { cwd: sandbox, env });
  assert.doesNotMatch(`${created.stdout}${created.stderr}`, new RegExp(secret));

  let archives = (await fs.readdir(backupDir)).filter((name) => name.endsWith(".archive.gz"));
  assert.equal(archives.length, 1);
  const archivePath = path.join(backupDir, archives[0]);
  await fs.access(`${archivePath}.sha256`);
  await execFile(bash, [scriptPath, "verify", archivePath], { cwd: sandbox, env });

  await execFile(bash, [scriptPath, "restore", archivePath, "--force"], { cwd: sandbox, env });
  archives = (await fs.readdir(backupDir)).filter((name) => name.endsWith(".archive.gz"));
  assert.equal(archives.length, 2, "restore must create a separate safety backup first");

  const trace = await fs.readFile(tracePath, "utf8");
  assert.doesNotMatch(trace, new RegExp(secret));
  assert.match(trace, /mongorestore .*--drop .*--stopOnError/);
  assert.match(trace, /--nsInclude=omnifm_test\.\*/);
  const leftoverConfig = (await fs.readdir(backupDir)).some((name) => name.startsWith(".mongo-tools."));
  assert.equal(leftoverConfig, false, "private temporary MongoDB tool config must be removed");
});

test("update creates runtime and MongoDB snapshots before git pull", async () => {
  const updateScript = await fs.readFile(path.join(repoRoot, "update.sh"), "utf8");
  const runtimeBackupIndex = updateScript.indexOf('backup-runtime-data.sh" create');
  const mongoBackupIndex = updateScript.indexOf('backup-mongodb.sh" create');
  const pullIndex = updateScript.indexOf('log "Hole neuesten Stand (git pull)..."');

  assert.ok(runtimeBackupIndex >= 0);
  assert.ok(mongoBackupIndex >= 0);
  assert.ok(pullIndex > runtimeBackupIndex);
  assert.ok(pullIndex > mongoBackupIndex);
  assert.match(updateScript, /MongoDB konnte nicht gesichert werden[\s\S]*vor dem Pull abgebrochen/);
});
