import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getFileStoreLockPath, withFileStoreLock } from "../src/lib/file-store-lock.js";

async function makeTempStore() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-lock-"));
  return {
    tempDir,
    filePath: path.join(tempDir, "store.json"),
  };
}

async function writeOwner(lockDir, owner) {
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, "owner"), JSON.stringify(owner), "utf8");
  const oldDate = new Date(Date.now() - 120000);
  await fs.utimes(lockDir, oldDate, oldDate);
}

test("file store lock can recover stale locks from dead owners", async (t) => {
  const { tempDir, filePath } = await makeTempStore();
  const lockDir = getFileStoreLockPath(filePath);

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await writeOwner(lockDir, {
    id: "dead-owner",
    pid: 999999999,
    createdAt: new Date(Date.now() - 120000).toISOString(),
    filePath,
  });

  const value = withFileStoreLock(filePath, () => "acquired", {
    timeoutMs: 1000,
    staleMs: 50,
    retryMs: 5,
  });

  assert.equal(value, "acquired");
});

test("file store lock retries transient mkdir permission errors", async (t) => {
  const { tempDir, filePath } = await makeTempStore();
  const lockDir = getFileStoreLockPath(filePath);
  const originalMkdirSync = fsSync.mkdirSync;
  let injected = false;

  t.after(async () => {
    fsSync.mkdirSync = originalMkdirSync;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  fsSync.mkdirSync = function mkdirSyncWithTransientError(target, options) {
    if (!injected && target === lockDir) {
      injected = true;
      const error = new Error("transient lock permission error");
      error.code = "EPERM";
      throw error;
    }
    return originalMkdirSync.call(this, target, options);
  };

  const value = withFileStoreLock(filePath, () => "acquired", {
    timeoutMs: 1000,
    retryMs: 5,
  });

  assert.equal(value, "acquired");
  assert.equal(injected, true);
});

test("file store lock keeps stale-looking locks when the owner process is alive", async (t) => {
  const { tempDir, filePath } = await makeTempStore();
  const lockDir = getFileStoreLockPath(filePath);

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await writeOwner(lockDir, {
    id: "live-owner",
    pid: process.pid,
    createdAt: new Date(Date.now() - 120000).toISOString(),
    filePath,
  });

  assert.throws(
    () => withFileStoreLock(filePath, () => "blocked", {
      timeoutMs: 50,
      staleMs: 10,
      retryMs: 5,
    }),
    /Timed out waiting for file-store lock/
  );
});

test("file store lock cleanup does not remove a lock owned by another process", async (t) => {
  const { tempDir, filePath } = await makeTempStore();
  const lockDir = getFileStoreLockPath(filePath);

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  withFileStoreLock(filePath, () => {
    fsSync.writeFileSync(path.join(lockDir, "owner"), JSON.stringify({
      id: "new-owner",
      pid: process.pid,
      createdAt: new Date().toISOString(),
      filePath,
    }), "utf8");
  });

  assert.equal(await fs.stat(lockDir).then((stat) => stat.isDirectory()), true);
});

test("file store lock cleanup keeps ownerless replacement locks for stale recovery", async (t) => {
  const { tempDir, filePath } = await makeTempStore();
  const lockDir = getFileStoreLockPath(filePath);

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  withFileStoreLock(filePath, () => {
    fsSync.rmSync(lockDir, { recursive: true, force: true });
    fsSync.mkdirSync(lockDir);
  });

  assert.equal(await fs.stat(lockDir).then((stat) => stat.isDirectory()), true);
});
