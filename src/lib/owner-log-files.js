import fs from "node:fs";
import path from "node:path";

import { rootDir } from "./logging.js";

const DEFAULT_TAIL_BYTES = 80_000;
const MAX_TAIL_BYTES = 300_000;
const DEFAULT_MAX_LINES = 300;
const MAX_LINES = 1000;
const LOG_FILE_RE = /^(bot|error)(?:-[0-9T.-]+Z?)?\.log$/i;
const SENSITIVE_KEY_RE = /(token|secret|password|pass|api[_-]?key|authorization|cookie)/i;

function resolveOwnerLogsDir() {
  const explicit = String(process.env.OMNIFM_OWNER_LOGS_DIR || process.env.LOGS_DIR || "").trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(rootDir, explicit);
  return path.join(rootDir, "logs");
}

function isAllowedLogFileName(fileName) {
  const name = path.basename(String(fileName || ""));
  return name === String(fileName || "") && LOG_FILE_RE.test(name);
}

function redactLogLine(line) {
  return String(line || "")
    .replace(/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]")
    .replace(/\b([A-Za-z0-9_.-]*(?:token|secret|password|pass|api[_-]?key|authorization|cookie)[A-Za-z0-9_.-]*)=("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]")
    .replace(/\b([A-Za-z0-9_.-]*(?:token|secret|password|pass|api[_-]?key)[A-Za-z0-9_.-]*):("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1:[redacted]");
}

function parseLogLine(line) {
  const redacted = redactLogLine(line).slice(0, 4000);
  const match = redacted.match(/^\[([^\]]+)]\s+\[([^\]]+)]\s+(.*)$/);
  if (!match) {
    return { timestamp: null, level: "INFO", message: redacted };
  }
  return {
    timestamp: match[1],
    level: match[2],
    message: match[3],
  };
}

function normalizeTailOptions({ bytes = DEFAULT_TAIL_BYTES, lines = DEFAULT_MAX_LINES } = {}) {
  const safeBytes = Math.min(
    MAX_TAIL_BYTES,
    Math.max(1024, Number.parseInt(String(bytes || DEFAULT_TAIL_BYTES), 10) || DEFAULT_TAIL_BYTES)
  );
  const safeLines = Math.min(
    MAX_LINES,
    Math.max(1, Number.parseInt(String(lines || DEFAULT_MAX_LINES), 10) || DEFAULT_MAX_LINES)
  );
  return { bytes: safeBytes, lines: safeLines };
}

async function getOwnerLogFilesSnapshot() {
  const logsDir = resolveOwnerLogsDir();
  const entries = await fs.promises.readdir(logsDir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (!entry?.isFile?.() || !isAllowedLogFileName(entry.name)) continue;
    const filePath = path.join(logsDir, entry.name);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) continue;
    files.push({
      name: entry.name,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      kind: entry.name.toLowerCase().startsWith("error") ? "error" : "bot",
      current: ["bot.log", "error.log"].includes(entry.name.toLowerCase()),
    });
  }

  files.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return String(b.modifiedAt).localeCompare(String(a.modifiedAt));
  });

  return {
    generatedAt: new Date().toISOString(),
    logsDir,
    files,
    total: files.length,
  };
}

async function getOwnerLogFileSnapshot(fileName, options = {}) {
  const name = path.basename(String(fileName || ""));
  if (!isAllowedLogFileName(name)) {
    const err = new Error("Logdatei ist nicht erlaubt.");
    err.statusCode = 404;
    throw err;
  }

  const logsDir = resolveOwnerLogsDir();
  const filePath = path.join(logsDir, name);
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(logsDir);
  if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) {
    const err = new Error("Logdatei ist nicht erlaubt.");
    err.statusCode = 404;
    throw err;
  }

  const stat = await fs.promises.stat(resolvedPath).catch(() => null);
  if (!stat?.isFile?.()) {
    const err = new Error("Logdatei nicht gefunden.");
    err.statusCode = 404;
    throw err;
  }

  const { bytes, lines } = normalizeTailOptions(options);
  const start = Math.max(0, stat.size - bytes);
  const length = stat.size - start;
  const handle = await fs.promises.open(resolvedPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const rawLines = buffer.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    const selectedLines = rawLines.slice(-lines);
    return {
      generatedAt: new Date().toISOString(),
      name,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      truncated: start > 0 || rawLines.length > selectedLines.length,
      tailBytes: bytes,
      maxLines: lines,
      lines: selectedLines.map(parseLogLine),
    };
  } finally {
    await handle.close();
  }
}

export {
  getOwnerLogFileSnapshot,
  getOwnerLogFilesSnapshot,
  isAllowedLogFileName,
  redactLogLine,
  resolveOwnerLogsDir,
};
