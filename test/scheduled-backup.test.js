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

// A copy of the repository layout with the real scheduled-backup.sh and
// rotate-backups.mjs, and stand-ins for the backup scripts, the restore check
// and the alert, which record that they ran.
async function sandbox(t, { mongoFails = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-scheduled-backup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "scripts");
  const trace = path.join(root, "trace.log");
  await fs.mkdir(scripts, { recursive: true });
  await fs.mkdir(path.join(root, "runtime-data"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "scheduled-backup.sh"), path.join(scripts, "scheduled-backup.sh"));
  await fs.copyFile(path.join(repoRoot, "scripts", "rotate-backups.mjs"), path.join(scripts, "rotate-backups.mjs"));
  await fs.writeFile(path.join(scripts, "backup-runtime-data.sh"), `echo runtime >> "${trace.replaceAll("\\", "/")}"\n`);
  await fs.writeFile(
    path.join(scripts, "backup-mongodb.sh"),
    `echo mongodb >> "${trace.replaceAll("\\", "/")}"\n${mongoFails ? "exit 1\n" : ""}`,
  );
  const traceJs = JSON.stringify(trace);
  await fs.writeFile(path.join(scripts, "verify-mongo-backup.mjs"),
    `import fs from "node:fs"; fs.appendFileSync(${traceJs}, "restore-check\\n");\n`);
  await fs.writeFile(path.join(scripts, "notify-backup-failed.mjs"),
    `import fs from "node:fs"; fs.appendFileSync(${traceJs}, "alert " + process.argv.slice(2).join("|") + "\\n");\n`);
  return { root, trace };
}

async function run(root, env = {}) {
  try {
    const result = await execFile(resolveBash(), [path.join(root, "scripts", "scheduled-backup.sh")], {
      cwd: root,
      env: { ...process.env, OMNIFM_NODE: process.execPath, OMNIFM_BACKUP_REMOTE: "", ...env },
    });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("a good night backs up runtime data and MongoDB, rotates and runs the first restore check", async (t) => {
  const { root, trace } = await sandbox(t);
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await fs.readFile(trace, "utf8")).trim().split("\n"), ["runtime", "mongodb", "restore-check"]);
  assert.match(result.stdout, /Backup fertig/);
});

test("a failed step does not stop the others and ends in one alert and exit 1", async (t) => {
  const { root, trace } = await sandbox(t, { mongoFails: true });
  const result = await run(root, { OMNIFM_RESTORE_CHECK_DAYS: "0" });
  assert.equal(result.code, 1);
  const lines = (await fs.readFile(trace, "utf8")).trim().split("\n");
  assert.deepEqual(lines, ["runtime", "mongodb", "alert MongoDB sichern"]);
});

test("the restore check waits for its interval after a good check, and repeats a failed one", async (t) => {
  const { root, trace } = await sandbox(t);
  const marker = path.join(root, ".update-backups", "mongodb", ".last-restore-check.json");
  await fs.mkdir(path.dirname(marker), { recursive: true });

  await fs.writeFile(marker, '{\n  "ok": true\n}\n');
  await run(root);
  assert.ok(!(await fs.readFile(trace, "utf8")).includes("restore-check"), "a fresh good check is not repeated");

  await fs.writeFile(trace, "");
  await fs.writeFile(marker, '{\n  "ok": false\n}\n');
  await run(root);
  assert.ok((await fs.readFile(trace, "utf8")).includes("restore-check"), "a failed check runs again");
});
