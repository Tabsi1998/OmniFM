import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";

test("start migration preserves root settings and imports legacy backend configuration", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-start-migration-"));
  try {
    await fs.mkdir(path.join(tempRoot, "backend"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "run"), { recursive: true });
    const binDir = path.join(tempRoot, "bin");
    await fs.mkdir(binDir);
    await fs.writeFile(path.join(binDir, "node"), "#!/usr/bin/env bash\nif [[ \"${1:-}\" == \"-p\" ]]; then echo 22; exit 0; fi\nexit 1\n", "utf8");
    await fs.chmod(path.join(binDir, "node"), 0o755);
    await fs.copyFile(path.join(repoRoot, "start.sh"), path.join(tempRoot, "start.sh"));
    await fs.copyFile(path.join(repoRoot, ".env.example"), path.join(tempRoot, ".env.example"));

    const example = await fs.readFile(path.join(repoRoot, ".env.example"), "utf8");
    await fs.writeFile(path.join(tempRoot, ".env"), `${example}\nAPI_ADMIN_TOKEN=root-value\n`, "utf8");
    await fs.writeFile(path.join(tempRoot, "backend", ".env"), [
      "BOT_1_TOKEN=live-discord-token",
      "BOT_1_CLIENT_ID=123456789012345678",
      "DISCORD_CLIENT_ID=987654321098765432",
      "MONGO_URL=mongodb://live-db:27017",
      "API_ADMIN_TOKEN=legacy-value",
    ].join("\n"), "utf8");

    // The script exits before installing dependencies when it sees this live
    // PID. That lets this test exercise only the safe migration path.
    await fs.writeFile(path.join(tempRoot, "run", "omnifm.pid"), String(process.pid), "utf8");
    const bashBinDir = process.platform === "win32"
      ? binDir.replace(/^([A-Z]):/i, (_, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, "/")
      : binDir;
    assert.throws(() => execFileSync(bash, ["start.sh"], {
      cwd: tempRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${bashBinDir}:${process.env.PATH}` },
    }));

    const migrated = await fs.readFile(path.join(tempRoot, ".env"), "utf8");
    assert.match(migrated, /^BOT_1_TOKEN=live-discord-token$/m);
    assert.match(migrated, /^BOT_1_CLIENT_ID=123456789012345678$/m);
    assert.match(migrated, /^DISCORD_CLIENT_ID=987654321098765432$/m);
    assert.match(migrated, /^MONGO_URL=mongodb:\/\/live-db:27017$/m);
    assert.match(migrated, /^API_ADMIN_TOKEN=root-value$/m);

    const backups = await fs.readdir(path.join(tempRoot, ".update-backups"));
    assert.equal(backups.length, 1);
    const saved = await fs.readdir(path.join(tempRoot, ".update-backups", backups[0]));
    assert.deepEqual(saved.sort(), ["backend.env", "root.env"]);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
