import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { rootDir } from "./logging.js";
import { withFileStoreLock } from "./file-store-lock.js";

const MAX_AUDIT_EVENTS = 500;
const DEFAULT_AUDIT_LIMIT = 100;
const MAX_TEXT_LENGTH = 500;
const SENSITIVE_KEY_RE = /(token|secret|password|pass|api[_-]?key|authorization|cookie)/i;

function resolveOwnerAuditFilePath() {
  const explicit = String(process.env.OMNIFM_OWNER_AUDIT_FILE || "").trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(rootDir, explicit);
  return path.join(rootDir, "owner-audit.json");
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
  try {
    if (!fs.existsSync(filePath)) return emptyAuditState();
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyAuditState();
    const parsed = JSON.parse(raw);
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    return {
      version: 1,
      events: events.map((event) => normalizeAuditEvent(event)).slice(-MAX_AUDIT_EVENTS),
    };
  } catch {
    return emptyAuditState();
  }
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
    const state = readAuditState(filePath);
    const normalized = normalizeAuditEvent(event);
    state.events.push(normalized);
    writeAuditState(filePath, state);
    return normalized;
  });
}

function getOwnerAuditSnapshot({ limit = DEFAULT_AUDIT_LIMIT } = {}) {
  const filePath = resolveOwnerAuditFilePath();
  const state = readAuditState(filePath);
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit || DEFAULT_AUDIT_LIMIT), 10) || DEFAULT_AUDIT_LIMIT));
  return {
    generatedAt: new Date().toISOString(),
    file: filePath,
    total: state.events.length,
    events: state.events.slice().reverse().slice(0, safeLimit),
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
