import fs from "node:fs";

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

function isLockStale(lockDir, staleMs) {
  try {
    const stat = fs.statSync(lockDir);
    return Date.now() - stat.mtimeMs > staleMs;
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
  const timeoutMs = Math.max(1, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const staleMs = Math.max(timeoutMs, Number(options.staleMs || DEFAULT_STALE_MS));
  const retryMs = Math.max(1, Number(options.retryMs || DEFAULT_RETRY_MS));
  const startedAt = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(
        `${lockDir}/owner`,
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          filePath,
        }),
        "utf8"
      );
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
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; stale-lock handling covers process crashes
    }
  }
}

export function getFileStoreLockPath(filePath) {
  return getLockDir(filePath);
}
