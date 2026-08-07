import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { log, rootDir } from "./logging.js";
import { withFileStoreLock } from "./file-store-lock.js";
import { resolveRuntimeDataPath } from "./runtime-data-path.js";

const MAX_AUDIT_EVENTS = 500;
const DEFAULT_AUDIT_LIMIT = 100;
const MAX_TEXT_LENGTH = 500;
const SENSITIVE_KEY_RE = /(token|secret|password|pass|api[_-]?key|authorization|cookie)/i;

class OwnerAuditCorruptionError extends Error {
  constructor(filePath, cause) {
    super(`Owner audit file is corrupt: ${filePath}`);
    this.name = "OwnerAuditCorruptionError";
    this.filePath = filePath;
    this.cause = cause;
  }
}

function resolveOwnerAuditFilePath() {
  const explicit = String(process.env.OMNIFM_OWNER_AUDIT_FILE || "").trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(rootDir, explicit);
  return resolveRuntimeDataPath("owner-audit.json");
}

function emptyAuditState() {
  return { version: 1, events: [] };
}

function sanitizeText(value, maxLen = MAX_TEXT_LENGTH) {
  return String(value ?? "")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\r\n\u0000]/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizeValue(key, value, depth = 0) {
  if (SENSITIVE_KEY_RE.test(String(key || ""))) return "[redacted]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeValue("", entry, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 3) return "[object]";
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([childKey, childValue]) => [sanitizeText(childKey, 120), sanitizeValue(childKey, childValue, depth + 1)])
    );
  }
  return sanitizeText(value);
}

function normalizeAuditEvent(rawEvent) {
  const source = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  const action = sanitizeText(source.action || "owner.unknown", 120);
  const status = ["success", "failed", "denied", "info"].includes(source.status) ? source.status : "info";
  return {
    id: sanitizeText(source.id || randomUUID(), 80),
    timestamp: sanitizeText(source.timestamp || new Date().toISOString(), 40),
    action,
    status,
    actor: sanitizeText(source.actor || "owner", 120),
    target: sanitizeText(source.target || "", 200),
    summary: sanitizeText(source.summary || action, 300),
    metadata: sanitizeValue("metadata", source.metadata || {}),
  };
}

function readAuditState(filePath = resolveOwnerAuditFilePath()) {
  if (!fs.existsSync(filePath)) return emptyAuditState();
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    throw new OwnerAuditCorruptionError(filePath, new Error("file is empty"));
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.events)) {
      throw new Error("expected an object with an events array");
    }
    const events = parsed.events;
    return {
      version: 1,
      events: events.map((event) => normalizeAuditEvent(event)).slice(-MAX_AUDIT_EVENTS),
    };
  } catch (err) {
    throw new OwnerAuditCorruptionError(filePath, err);
  }
}

function quarantineCorruptAuditFile(filePath, cause) {
  const quarantinedPath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
  fs.renameSync(filePath, quarantinedPath);
  try {
    fs.chmodSync(quarantinedPath, 0o600);
  } catch {
    // Best effort only: the original file mode is preserved if chmod is unavailable.
  }
  log("ERROR", `[owner-audit] Corrupt audit file quarantined as ${path.basename(quarantinedPath)}: ${cause?.message || "invalid JSON"}`);
  return quarantinedPath;
}

function writeAuditState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const events = Array.isArray(state?.events) ? state.events.slice(-MAX_AUDIT_EVENTS) : [];
  const payload = JSON.stringify({ version: 1, events }, null, 2) + "\n";
  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  fs.writeFileSync(tmpFile, payload, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpFile, filePath);
}

function recordOwnerAudit(event) {
  const filePath = resolveOwnerAuditFilePath();
  return withFileStoreLock(filePath, () => {
    let state;
    try {
      state = readAuditState(filePath);
    } catch (err) {
      if (!(err instanceof OwnerAuditCorruptionError)) throw err;
      const quarantinedPath = quarantineCorruptAuditFile(filePath, err.cause);
      state = emptyAuditState();
      state.events.push(normalizeAuditEvent({
        action: "owner.audit.integrity.recovered",
        status: "failed",
        summary: "Corrupt owner audit file was quarantined before recording a new event.",
        metadata: { quarantinedFile: path.basename(quarantinedPath) },
      }));
    }
    const normalized = normalizeAuditEvent(event);
    state.events.push(normalized);
    writeAuditState(filePath, state);
    return normalized;
  });
}

function getOwnerAuditSnapshot({ limit = DEFAULT_AUDIT_LIMIT } = {}) {
  const filePath = resolveOwnerAuditFilePath();
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit || DEFAULT_AUDIT_LIMIT), 10) || DEFAULT_AUDIT_LIMIT));
  let state;
  let integrity = null;
  try {
    state = readAuditState(filePath);
  } catch (err) {
    if (!(err instanceof OwnerAuditCorruptionError)) throw err;
    log("ERROR", `[owner-audit] Audit history is unavailable until it is recovered: ${err.cause?.message || "invalid JSON"}`);
    state = emptyAuditState();
    integrity = {
      status: "corrupt",
      message: "The audit history is corrupt and will be quarantined before the next audit write.",
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    file: filePath,
    total: state.events.length,
    events: state.events.slice().reverse().slice(0, safeLimit),
    ...(integrity ? { integrity } : {}),
  };
}

function resetOwnerAuditForTests() {
  const filePath = resolveOwnerAuditFilePath();
  try {
    fs.rmSync(filePath, { force: true });
    fs.rmSync(`${filePath}.lock`, { recursive: true, force: true });
  } catch {}
}

export {
  getOwnerAuditSnapshot,
  recordOwnerAudit,
  resetOwnerAuditForTests,
  resolveOwnerAuditFilePath,
};
