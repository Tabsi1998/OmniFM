import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("stop script reclaims an orphaned OmniFM runtime from its own checkout", {
  skip: process.platform === "win32" ? "requires Linux /proc process metadata" : false,
}, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-stop-orphan-"));
  let orphan;
  try {
    await fs.copyFile(path.join(repoRoot, "stop.sh"), path.join(tempRoot, "stop.sh"));
    orphan = spawn("bash", ["-lc", "exec -a 'node src/index.js' sleep 120"], {
      cwd: tempRoot,
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      orphan.once("spawn", resolve);
      orphan.once("error", reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    execFileSync("bash", ["stop.sh"], { cwd: tempRoot, stdio: "pipe" });
    await new Promise((resolve) => orphan.once("exit", resolve));
    assert.throws(() => process.kill(orphan.pid, 0), { code: "ESRCH" });
  } finally {
    if (orphan?.pid) {
      try { process.kill(orphan.pid, "SIGKILL"); } catch { /* already stopped */ }
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
