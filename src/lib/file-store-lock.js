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
    // The lock vanished or is being deleted right now (Windows reports EPERM
    // for a directory with a pending delete). Neither makes it stale: removing
    // it here could delete a lock another process has just created (#223).
    // The caller simply tries mkdir again.
    return false;
  }
}

function readLockOwner(lockDir, { attempts = 1 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return fs.readFileSync(`${lockDir}/owner`, "utf8").trim();
    } catch (err) {
      // Windows reports a file a scanner or the indexer holds for a moment as
      // busy; only those are worth another look.
      if (!["EBUSY", "EPERM", "EACCES"].includes(err?.code) || attempt === attempts - 1) return "";
      sleepSync(10 * (attempt + 1));
    }
  }
  return "";
}

function isRetryableLockError(err) {
  return ["ENOENT", "EBUSY", "EPERM", "EACCES"].includes(err?.code);
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
      if (err?.code === "EEXIST") {
        if (isLockStale(lockDir, staleMs)) {
          try {
            fs.rmSync(lockDir, { recursive: true, force: true });
            continue;
          } catch {
            // another process may have cleaned it up first
          }
        }
      } else if (!isRetryableLockError(err)) {
        throw err;
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
      // A briefly unreadable owner file must not leave the lock behind: every
      // other writer would then wait until its timeout (#223).
      const owner = parseLockOwner(readLockOwner(lockDir, { attempts: 6 }));
      if (owner.id === ownerId) {
        fs.rmSync(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      }
    } catch {
      // best-effort cleanup; stale-lock handling covers process crashes
    }
  }
}

const TRANSIENT_READ_ERRORS = new Set(["EBUSY", "EPERM", "EACCES", "EMFILE"]);

/**
 * Reads a store file. A missing file returns null; a file that is briefly
 * locked by another process, a virus scanner or the Windows indexer is read
 * again instead. Treating such a moment as "file missing" made stores fall back
 * to their older backup and write that back, losing every change since (#223).
 */
export function readStoreFileWithRetry(filePath, { attempts = 10, retryMs = 20 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") return null;
      lastError = err;
      if (!TRANSIENT_READ_ERRORS.has(err?.code)) throw err;
      sleepSync(retryMs * (attempt + 1));
    }
  }
  throw lastError;
}

const RETRYABLE_FILE_WRITE_ERRORS = new Set(["EBUSY", "EPERM", "EACCES", "ENOENT"]);

/**
 * Runs a file write or rename again when Windows briefly holds the target:
 * renaming onto a file another process just opened fails with EPERM/EBUSY
 * there, while Linux replaces it atomically (#223).
 */
export function withFileWriteRetry(operation, { attempts = 8, retryMs = 25 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return operation();
    } catch (err) {
      lastError = err;
      if (!RETRYABLE_FILE_WRITE_ERRORS.has(err?.code) || attempt === attempts - 1) throw err;
      sleepSync(retryMs * (attempt + 1));
    }
  }
  throw lastError;
}

export function getFileStoreLockPath(filePath) {
  return getLockDir(filePath);
}
