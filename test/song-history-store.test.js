import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  appendSongHistory,
  clearSongHistory,
  getSongHistory,
} from "../src/song-history-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const storeFile = path.join(repoRoot, "song-history.json");
const storeBackupFile = `${storeFile}.bak`;
const splitHistoryDir = path.join(repoRoot, "song-history");

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function snapshotPath(targetPath) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-song-history-"));
  const snapshotPathname = path.join(tempRoot, path.basename(targetPath));
  const exists = await pathExists(targetPath);
  if (exists) {
    await fs.cp(targetPath, snapshotPathname, { recursive: true });
  }
  return { exists, tempRoot, snapshotPathname };
}

async function restorePath(targetPath, snapshot) {
  await fs.rm(targetPath, { recursive: true, force: true });
  if (snapshot.exists) {
    await fs.cp(snapshot.snapshotPathname, targetPath, { recursive: true });
  }
  await fs.rm(snapshot.tempRoot, { recursive: true, force: true });
}

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("split song history writes per bot and reads aggregated guild history", async () => {
  const snapshots = [
    await snapshotPath(storeFile),
    await snapshotPath(storeBackupFile),
    await snapshotPath(splitHistoryDir),
  ];
  const restoreEnv = setEnv({
    BOT_PROCESS_ROLE: "worker",
    BOT_PROCESS_INDEX: "1",
  });

  const guildId = "123456789012345678";
  const botOneId = "111111111111111111";
  const botTwoId = "222222222222222222";

  try {
    await fs.rm(storeFile, { force: true });
    await fs.rm(storeBackupFile, { force: true });
    await fs.rm(splitHistoryDir, { recursive: true, force: true });
    await fs.mkdir(splitHistoryDir, { recursive: true });

    assert.equal(
      appendSongHistory(guildId, {
        botId: botOneId,
        displayTitle: "Track A",
        timestampMs: 1_000,
      }).saved,
      true
    );
    assert.equal(await pathExists(path.join(splitHistoryDir, `${botOneId}.json`)), true);
    assert.equal(await pathExists(path.join(splitHistoryDir, `${guildId}.json`)), false);

    assert.equal(
      appendSongHistory(guildId, {
        botId: botTwoId,
        displayTitle: "Track B",
        timestampMs: 2_000,
      }).saved,
      true
    );

    const history = getSongHistory(guildId, { limit: 10 });
    assert.deepEqual(history.map((entry) => entry.displayTitle), ["Track B", "Track A"]);
    assert.deepEqual(new Set(history.map((entry) => entry.botId)), new Set([botOneId, botTwoId]));

    assert.equal(clearSongHistory(guildId), true);
    assert.deepEqual(getSongHistory(guildId, { limit: 10 }), []);
  } finally {
    restoreEnv();
    await restorePath(storeFile, snapshots[0]);
    await restorePath(storeBackupFile, snapshots[1]);
    await restorePath(splitHistoryDir, snapshots[2]);
  }
});
