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

// The real update.sh in a folder without Git and without systemd; backups,
// start.sh and the alert script are stand-ins that record what happened.
async function sandbox(t, { runtimeBackupFails = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-update-alerts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const trace = path.join(root, "trace.log").replaceAll("\\", "/");
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.mkdir(path.join(root, "backend"), { recursive: true });
  await fs.mkdir(path.join(root, "runtime-data"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "update.sh"), path.join(root, "update.sh"));
  await fs.writeFile(path.join(root, "backend", ".env"), "MONGO_URL=\nDB_NAME=omnifm_test\n");
  await fs.writeFile(path.join(root, "scripts", "backup-runtime-data.sh"), runtimeBackupFails ? "exit 1\n" : "exit 0\n");
  await fs.writeFile(path.join(root, "scripts", "backup-mongodb.sh"), "exit 0\n");
  await fs.writeFile(path.join(root, "start.sh"), `#!/usr/bin/env bash\necho start >> "${trace}"\n`, { mode: 0o755 });
  await fs.writeFile(
    path.join(root, "scripts", "notify-operator.mjs"),
    `import fs from "node:fs"; fs.appendFileSync(${JSON.stringify(trace)}, "alert " + process.argv.slice(2).join("|") + "\\n");\n`,
  );
  return { root, trace };
}

async function runUpdate(root) {
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}` };
  try {
    await execFile(resolveBash(), [path.join(root, "update.sh")], { cwd: root, env });
    return 0;
  } catch (error) {
    return error.code;
  }
}

async function alerts(trace) {
  const text = await fs.readFile(trace, "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.startsWith("alert "));
}

test("an update that stops sends exactly one failure alert with the step it stopped in", async (t) => {
  const { root, trace } = await sandbox(t, { runtimeBackupFails: true });
  assert.notEqual(await runUpdate(root), 0);
  const sent = await alerts(trace);
  assert.equal(sent.length, 1, sent.join("\n"));
  assert.match(sent[0], /^alert update-failed\|unbekannt\|unbekannt\|Runtime-Daten konnten nicht gesichert werden/);
});

test("a finished update sends exactly one success alert", async (t) => {
  const { root, trace } = await sandbox(t);
  assert.equal(await runUpdate(root), 0);
  const sent = await alerts(trace);
  assert.equal(sent.length, 1, sent.join("\n"));
  assert.match(sent[0], /^alert update-ok\|/);
  assert.match(await fs.readFile(trace, "utf8"), /^start$/m, "start.sh ran");
});
