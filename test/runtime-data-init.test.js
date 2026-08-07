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

test("runtime initializer migrates legacy JSON and split directories without overwriting runtime data", async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-runtime-init-"));
  const initScript = path.join(sandbox, "init-data.sh");
  const runtimeDir = path.join(sandbox, "runtime-data");

  await fs.copyFile(path.join(repoRoot, "init-data.sh"), initScript);
  await fs.writeFile(path.join(sandbox, "stations.json"), '{"stations":{"seed":{"name":"Seed"}}}\n', "utf8");
  await fs.writeFile(path.join(sandbox, "owner-audit.json"), '{"version":1,"events":[{"action":"legacy"}]}\n', "utf8");
  await fs.mkdir(path.join(sandbox, "bot-state"), { recursive: true });
  await fs.mkdir(path.join(sandbox, "song-history"), { recursive: true });
  await fs.mkdir(path.join(sandbox, "logs"), { recursive: true });
  await fs.writeFile(path.join(sandbox, "bot-state", "bot-1.json"), '{"guilds":{}}\n', "utf8");
  await fs.writeFile(path.join(sandbox, "song-history", "guild-1.json"), '{"guilds":{}}\n', "utf8");
  await fs.writeFile(path.join(sandbox, "logs", "bot.log"), "legacy log\n", "utf8");

  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  const env = { ...process.env };
  delete env.OMNIFM_HOST_RUNTIME_DATA_DIR;
  await execFile(resolveBash(), [initScript], { cwd: sandbox, env });

  assert.match(await fs.readFile(path.join(runtimeDir, "owner-audit.json"), "utf8"), /legacy/);
  assert.match(await fs.readFile(path.join(runtimeDir, "stations.json"), "utf8"), /Seed/);
  assert.equal(await fs.readFile(path.join(runtimeDir, "bot-state", "bot-1.json"), "utf8"), '{"guilds":{}}\n');
  assert.equal(await fs.readFile(path.join(runtimeDir, "song-history", "guild-1.json"), "utf8"), '{"guilds":{}}\n');
  assert.equal(await fs.readFile(path.join(runtimeDir, "logs", "bot.log"), "utf8"), "legacy log\n");

  await fs.writeFile(path.join(runtimeDir, "owner-audit.json"), '{"version":1,"events":[{"action":"runtime"}]}\n', "utf8");
  await execFile(resolveBash(), [initScript], { cwd: sandbox, env });
  assert.match(await fs.readFile(path.join(runtimeDir, "owner-audit.json"), "utf8"), /runtime/);
  assert.doesNotMatch(await fs.readFile(path.join(runtimeDir, "owner-audit.json"), "utf8"), /legacy/);
});
