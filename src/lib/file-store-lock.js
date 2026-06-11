import fs from "node:fs";
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 30000;
const DEFAULT_RETRY_MS = 25;

function sleepSync(ms) {
  const delay = Math.max(1, Number(ms) || DEFAULT_RETRY_MS);
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, delay);
}

function getLockDir(filePath) {
  return `${filePath}.lock`;
}

function parseLockOwner(rawOwner) {
  try {
    const parsed = JSON.parse(String(rawOwner || ""));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isProcessAlive(pid) {
  const numericPid = Number.parseInt(String(pid || ""), 10);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function isLockStale(lockDir, staleMs) {
  try {
    const stat = fs.statSync(lockDir);
    if (Date.now() - stat.mtimeMs <= staleMs) return false;
    const owner = parseLockOwner(readLockOwner(lockDir));
    return !isProcessAlive(owner.pid);
  } catch {
    return true;
  }
}

function readLockOwner(lockDir) {
  try {
    return fs.readFileSync(`${lockDir}/owner`, "utf8").trim();
  } catch {
    return "";
  }
}

export function withFileStoreLock(filePath, fn, options = {}) {
  const lockDir = getLockDir(filePath);
  const ownerId = `${process.pid}:${Date.now()}:${randomUUID()}`;
  const timeoutMs = Math.max(1, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const staleMs = Math.max(timeoutMs, Number(options.staleMs || DEFAULT_STALE_MS));
  const retryMs = Math.max(1, Number(options.retryMs || DEFAULT_RETRY_MS));
  const startedAt = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      fs.mkdirSync(lockDir);
      try {
        fs.writeFileSync(
          `${lockDir}/owner`,
          JSON.stringify({
            id: ownerId,
            pid: process.pid,
            createdAt: new Date().toISOString(),
            filePath,
          }),
          "utf8"
        );
      } catch (ownerErr) {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {}
        if (["ENOENT", "EBUSY", "EPERM", "EACCES"].includes(ownerErr?.code)) {
          sleepSync(retryMs);
          continue;
        }
        throw ownerErr;
      }
      acquired = true;
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      if (isLockStale(lockDir, staleMs)) {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        } catch {
          // another process may have cleaned it up first
        }
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const owner = readLockOwner(lockDir);
        throw new Error(`Timed out waiting for file-store lock ${lockDir}${owner ? ` owner=${owner}` : ""}`);
      }
      sleepSync(retryMs);
    }
  }

  try {
    return fn();
  } finally {
    try {
      const owner = parseLockOwner(readLockOwner(lockDir));
      if (!owner.id || owner.id === ownerId) {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    } catch {
      // best-effort cleanup; stale-lock handling covers process crashes
    }
  }
}

export function getFileStoreLockPath(filePath) {
  return getLockDir(filePath);
}
