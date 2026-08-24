// ============================================================
// OmniFM: Logging System
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeDataPath } from "./runtime-data-path.js";
import { redactSensitiveData, redactSensitiveText } from "./redact-sensitive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const legacyWebDir = path.join(rootDir, "web");
const frontendBuildDir = path.join(rootDir, "frontend", "build");
const frontendBuildIndex = path.join(frontendBuildDir, "index.html");
const legacyWebIndex = path.join(legacyWebDir, "index.html");
const hasFrontendBuild = fs.existsSync(frontendBuildIndex);
const hasLegacyWeb = fs.existsSync(legacyWebIndex);
const allowLegacyWebFallback = String(process.env.WEB_ALLOW_LEGACY_FALLBACK ?? "0") === "1";
const strictFrontendBuild = String(process.env.WEB_STRICT_FRONTEND_BUILD ?? "0") === "1";
if (!hasFrontendBuild && strictFrontendBuild && !(allowLegacyWebFallback && hasLegacyWeb)) {
  throw new Error(
    "frontend/build/index.html fehlt. Bitte React-Frontend bauen oder nur fuer Notfaelle WEB_ALLOW_LEGACY_FALLBACK=1 setzen."
  );
}
const webDir = hasFrontendBuild
  ? frontendBuildDir
  : (allowLegacyWebFallback && hasLegacyWeb ? legacyWebDir : frontendBuildDir);
const webRootSource = hasFrontendBuild
  ? "frontend/build"
  : (allowLegacyWebFallback && hasLegacyWeb
      ? "web (legacy fallback via WEB_ALLOW_LEGACY_FALLBACK=1)"
      : "frontend/build (missing, build required)");
let frontendBuildStamp = null;
try {
  const stat = fs.statSync(frontendBuildIndex);
  frontendBuildStamp = stat?.mtime?.toISOString?.() || null;
} catch {
  frontendBuildStamp = null;
}
function isTestRun() {
  return String(process.env.NODE_TEST_CONTEXT || "").toLowerCase() === "child"
    || process.argv.some((arg) => /\.test\.[cm]?js$/i.test(String(arg || "")));
}

function resolveLogsDir() {
  const explicit = String(process.env.LOGS_DIR || "").trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(rootDir, explicit);
  }
  if (isTestRun()) {
    return resolveRuntimeDataPath("logs/test");
  }
  return resolveRuntimeDataPath("logs");
}

const logsDir = resolveLogsDir();
const logFile = path.join(logsDir, "bot.log");
const errorLogFile = path.join(logsDir, "error.log");
const maxLogSizeBytes = Number(process.env.LOG_MAX_MB || "5") * 1024 * 1024;
const logRotateCheckIntervalMs = Number(process.env.LOG_ROTATE_CHECK_MS || "5000");
const logPruneCheckIntervalMs = Number(process.env.LOG_PRUNE_CHECK_MS || "600000");
const maxRotatedLogFiles = Math.max(
  1,
  Number.parseInt(String(process.env.LOG_MAX_FILES || "30"), 10) || 30
);
const maxRotatedLogDays = Math.max(
  1,
  Number.parseInt(String(process.env.LOG_MAX_DAYS || "14"), 10) || 14
);
const repeatedLogCooldownMs = Math.max(
  1_000,
  Number.parseInt(String(process.env.LOG_REPEAT_COOLDOWN_MS || "300000"), 10) || 300000
);

let logWriteQueue = Promise.resolve();
const lastLogRotateCheckAt = new Map();
const lastLogPruneCheckAt = new Map();
const repeatedLogState = new Map();
const errorObservers = new Set();
const logTargets = [
  { filePath: logFile, rotatedPrefix: "bot" },
  { filePath: errorLogFile, rotatedPrefix: "error" },
];

async function ensureLogsDir() {
  await fs.promises.mkdir(logsDir, { recursive: true });
}

async function rotateLogIfNeeded(filePath, rotatedPrefix) {
  const now = Date.now();
  const lastCheckedAt = lastLogRotateCheckAt.get(rotatedPrefix) || 0;
  if (now - lastCheckedAt < logRotateCheckIntervalMs) return;
  lastLogRotateCheckAt.set(rotatedPrefix, now);

  try {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) return;
    const size = stat.size;
    if (size < maxLogSizeBytes) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotated = path.join(logsDir, `${rotatedPrefix}-${stamp}.log`);
    await fs.promises.rename(filePath, rotated);
  } catch {
    // ignore
  }
}

async function pruneRotatedLogsIfNeeded(rotatedPrefix) {
  const now = Date.now();
  const lastCheckedAt = lastLogPruneCheckAt.get(rotatedPrefix) || 0;
  if (now - lastCheckedAt < logPruneCheckIntervalMs) return;
  lastLogPruneCheckAt.set(rotatedPrefix, now);

  const retentionMs = maxRotatedLogDays * 24 * 60 * 60 * 1000;
  try {
    const entries = await fs.promises.readdir(logsDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
      if (!entry?.isFile?.()) continue;
      if (!new RegExp(`^${rotatedPrefix}-.*\\.log$`, "i").test(entry.name)) continue;
      const filePath = path.join(logsDir, entry.name);
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat) continue;
      files.push({ filePath, mtimeMs: stat.mtimeMs });
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let index = 0; index < files.length; index++) {
      const info = files[index];
      const olderThanLimit = now - info.mtimeMs > retentionMs;
      const exceedsCountLimit = index >= maxRotatedLogFiles;
      if (!olderThanLimit && !exceedsCountLimit) continue;
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.unlink(info.filePath).catch(() => null);
    }
  } catch {
    // ignore
  }
}

function normalizeLogLines(ts, level, message) {
  const rawLines = redactSensitiveText(message).replace(/\r\n/g, "\n").split("\n");
  const lines = rawLines.length > 0 ? rawLines : [""];
  return lines.map((line) => `[${ts}] [${level}] ${line}`);
}

function clipLogText(value, maxLength = 400) {
  const text = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

function formatLogValue(value, { maxLength = 240 } = {}) {
  const safeValue = redactSensitiveData(value);
  if (safeValue === undefined || safeValue === null) return "";
  if (typeof safeValue === "string") {
    const text = clipLogText(safeValue, maxLength);
    if (!text) return "";
    return /^[A-Za-z0-9_./:@%+,\-=]+$/.test(text) ? text : JSON.stringify(text);
  }
  if (typeof safeValue === "number" || typeof safeValue === "boolean" || typeof safeValue === "bigint") {
    return String(safeValue);
  }
  if (safeValue instanceof Date) {
    return safeValue.toISOString();
  }
  if (Array.isArray(safeValue)) {
    return formatLogValue(
      safeValue
        .map((entry) => formatLogValue(entry, { maxLength: Math.max(40, Math.floor(maxLength / 3)) }))
        .filter(Boolean)
        .join(","),
      { maxLength }
    );
  }
  try {
    return formatLogValue(JSON.stringify(safeValue), { maxLength });
  } catch {
    return clipLogText(String(safeValue), maxLength);
  }
}

function formatLogContext(context = {}) {
  if (!context || typeof context !== "object") return "";
  return Object.entries(context)
    .filter(([_, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const normalizedValue = formatLogValue(value);
      return normalizedValue ? `${String(key).trim()}=${normalizedValue}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

function splitStackLines(stack) {
  return redactSensitiveText(stack)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function getErrorMetadataEntries(err) {
  if (!err || typeof err !== "object") return [];

  const entries = [];
  const seenKeys = new Set();
  const preferredKeys = [
    "code",
    "status",
    "statusCode",
    "retryable",
    "retryAfterMs",
    "errno",
    "syscall",
    "address",
    "port",
    "path",
    "method",
    "endpoint",
    "url",
    "source",
    "scope",
    "command",
    "signal",
  ];

  for (const key of preferredKeys) {
    const value = err[key];
    if (value === undefined || value === null || value === "") continue;
    entries.push([key, value]);
    seenKeys.add(key);
  }

  for (const [key, value] of Object.entries(err)) {
    if (seenKeys.has(key)) continue;
    if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
    if (value === undefined || value === null || value === "") continue;
    const type = typeof value;
    const isSimpleObject = Array.isArray(value) || value instanceof Date;
    if (type === "function") continue;
    if (type === "object" && !isSimpleObject) continue;
    entries.push([key, value]);
  }

  return entries;
}

function normalizeErrorLike(err) {
  if (err instanceof Error) {
    const summary = redactSensitiveText(`${err.name || "Error"}: ${err.message || String(err)}`);
    const stackLines = splitStackLines(err.stack);
    if (stackLines.length > 0 && stackLines[0].trim() === summary.trim()) {
      stackLines.shift();
    }
    return {
      summary,
      stackLines,
      metadataEntries: getErrorMetadataEntries(err),
      cause: err.cause,
    };
  }

  if (err && typeof err === "object") {
    const name = clipLogText(err.name || err.constructor?.name || "Error", 80) || "Error";
    const message = clipLogText(err.message || JSON.stringify(redactSensitiveData(err)), 500) || "unknown";
    const summary = `${name}: ${message}`;
    const stackLines = splitStackLines(err.stack);
    if (stackLines.length > 0 && stackLines[0].trim() === summary.trim()) {
      stackLines.shift();
    }
    return {
      summary,
      stackLines,
      metadataEntries: getErrorMetadataEntries(err),
      cause: err.cause,
    };
  }

  return {
    summary: clipLogText(String(err || "unknown error"), 500) || "unknown error",
    stackLines: [],
    metadataEntries: [],
    cause: null,
  };
}

function buildErrorLogMessage(summary, err, {
  context = null,
  maxCauseDepth = 4,
  includeStack = true,
} = {}) {
  const lines = [clipLogText(summary, 500) || "Error"];
  const contextLine = formatLogContext(context || {});
  if (contextLine) {
    lines.push(`context ${contextLine}`);
  }

  const normalized = normalizeErrorLike(err);
  if (normalized.summary) {
    lines.push(`error ${normalized.summary}`);
  }
  const metadataLine = formatLogContext(Object.fromEntries(normalized.metadataEntries));
  if (metadataLine) {
    lines.push(`errorMeta ${metadataLine}`);
  }
  if (includeStack) {
    for (const stackLine of normalized.stackLines) {
      lines.push(`stack ${stackLine}`);
    }
  }

  const seenCauses = new Set();
  let depth = 0;
  let currentCause = normalized.cause;
  while (currentCause && depth < Math.max(0, maxCauseDepth)) {
    if (typeof currentCause === "object") {
      if (seenCauses.has(currentCause)) {
        lines.push(`cause[${depth + 1}] circular`);
        break;
      }
      seenCauses.add(currentCause);
    }
    depth += 1;
    const normalizedCause = normalizeErrorLike(currentCause);
    lines.push(`cause[${depth}] ${normalizedCause.summary}`);
    const causeMetaLine = formatLogContext(Object.fromEntries(normalizedCause.metadataEntries));
    if (causeMetaLine) {
      lines.push(`cause[${depth}].meta ${causeMetaLine}`);
    }
    if (includeStack) {
      for (const stackLine of normalizedCause.stackLines) {
        lines.push(`cause[${depth}].stack ${stackLine}`);
      }
    }
    currentCause = normalizedCause.cause;
  }

  return redactSensitiveText(lines.join("\n"));
}

function queueLogWrite(lines, { includeErrorLog = false } = {}) {
  const payload = `${lines.join("\n")}\n`;
  logWriteQueue = logWriteQueue
    .then(async () => {
      await ensureLogsDir();
      for (const target of logTargets) {
        // eslint-disable-next-line no-await-in-loop
        await rotateLogIfNeeded(target.filePath, target.rotatedPrefix);
        // eslint-disable-next-line no-await-in-loop
        await pruneRotatedLogsIfNeeded(target.rotatedPrefix);
      }
      await fs.promises.appendFile(logFile, payload, "utf8");
      if (includeErrorLog) {
        await fs.promises.appendFile(errorLogFile, payload, "utf8");
      }
    })
    .catch(() => {
      // ignore
    });
}

const _recentLogs = [];
const _recentLogsMax = 60;

function pushRecentLog(ts, level, message) {
  let source = "runtime";
  let msg = String(message || "");
  const m = msg.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (m) { source = m[1]; msg = m[2]; }
  _recentLogs.push({ at: ts, level, source, message: msg.slice(0, 240) });
  if (_recentLogs.length > _recentLogsMax) _recentLogs.shift();
}

function getRecentLogs(limit = 40) {
  const n = Math.max(1, Math.min(_recentLogsMax, limit));
  return _recentLogs.slice(-n).reverse();
}

function log(level, message) {
  const ts = new Date().toISOString();
  const lines = normalizeLogLines(ts, level, redactSensitiveText(message));
  pushRecentLog(ts, level, redactSensitiveText(message));
  for (const line of lines) {
    if (level === "ERROR") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  queueLogWrite(lines, { includeErrorLog: level === "ERROR" });
}

function logError(summary, err, { context = null, level = "ERROR", includeStack = true } = {}) {
  const safeSummary = redactSensitiveText(summary);
  const safeErr = redactSensitiveData(err);
  const safeContext = context && typeof context === "object" ? redactSensitiveData(context) : null;
  const message = buildErrorLogMessage(safeSummary, safeErr, { context: safeContext, includeStack });
  log(level, message);
  const event = {
    timestamp: new Date().toISOString(),
    summary: String(safeSummary || "").trim() || "Error",
    err: safeErr,
    context: safeContext,
    level: String(level || "ERROR").trim().toUpperCase() || "ERROR",
    includeStack: includeStack !== false,
    message,
  };
  for (const observer of errorObservers) {
    try {
      Promise.resolve(observer(event)).catch(() => null);
    } catch {
      // ignore observer failures
    }
  }
  return message;
}

function logWithCooldown(level, key, message, cooldownMs = repeatedLogCooldownMs) {
  const normalizedMessage = redactSensitiveText(message);
  const normalizedKey = redactSensitiveText(key).trim();
  if (!normalizedKey || cooldownMs <= 0) {
    log(level, normalizedMessage);
    return true;
  }

  const now = Date.now();
  const previous = repeatedLogState.get(normalizedKey);
  if (previous && previous.message === normalizedMessage && (now - previous.loggedAt) < cooldownMs) {
    return false;
  }

  repeatedLogState.set(normalizedKey, {
    message: normalizedMessage,
    loggedAt: now,
  });
  log(level, normalizedMessage);
  return true;
}

function logStoreLoadError(storeKey, filePath, err, cooldownMs = repeatedLogCooldownMs) {
  const label = String(storeKey || "store").trim() || "store";
  const resolvedPath = String(filePath || "").trim();
  const message = buildErrorLogMessage(`[${label}] Load error`, err, {
    context: {
      store: label,
      file: resolvedPath,
    },
    includeStack: false,
  });
  return logWithCooldown("ERROR", `store-load:${label}:${resolvedPath}`, message, cooldownMs);
}

function shouldLogFfmpegStderrLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;

  const mode = String(process.env.FFMPEG_STDERR_VERBOSITY || "warn").trim().toLowerCase();
  if (mode === "all" || mode === "debug" || mode === "info") return true;
  if (mode === "off" || mode === "none") return false;

  const lc = text.toLowerCase();
  const noisyDecodeLine = lc.includes("error while decoding stream")
    || lc.includes("error decoding aac frame header")
    || lc.includes("invalid band type")
    || lc.includes("pulse data corrupt or invalid")
    || lc.includes("not yet implemented in ffmpeg, patches welcome");
  if (noisyDecodeLine) return false;
  const noisyBrokenPipeLine = lc.includes("broken pipe")
    || lc.includes("error writing trailer of pipe")
    || lc.includes("error closing file pipe");
  if (noisyBrokenPipeLine) return false;

  return lc.includes("error")
    || lc.includes("failed")
    || lc.includes("invalid")
    || lc.includes("warn")
    || lc.includes("timed out")
    || lc.includes("http error")
    || lc.includes("reconnect");
}

function getLogWriteQueue() {
  return logWriteQueue;
}

function resetLogCooldownStateForTests() {
  repeatedLogState.clear();
}

function onLoggedError(observer) {
  if (typeof observer !== "function") {
    return () => {};
  }
  errorObservers.add(observer);
  return () => {
    errorObservers.delete(observer);
  };
}

export {
  buildErrorLogMessage,
  formatLogContext,
  log,
  logError,
  onLoggedError,
  logWithCooldown,
  logStoreLoadError,
  shouldLogFfmpegStderrLine,
  getLogWriteQueue,
  getRecentLogs,
  resetLogCooldownStateForTests,
  rootDir,
  webDir,
  webRootSource,
  frontendBuildStamp,
  logsDir,
};
