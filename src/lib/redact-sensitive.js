// ============================================================
// OmniFM: Secret-safe diagnostic output
// ============================================================

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;
const MAX_URL_LENGTH = 180;

// The surrounding key name is deliberately broad. Redacting a harmless
// diagnostic value is safer than exposing a credential in an operator view.
const SENSITIVE_KEY_FRAGMENT = String.raw`(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|admin[_-]?token|client[_-]?secret|private[_-]?key|authorization|proxy[_-]?authorization|credential|password|passwd|passphrase|secret|token|cookie|session(?:[_-]?(?:id|token|key))?)`;
const SENSITIVE_KEY_NAME = String.raw`[A-Za-z0-9_-]*${SENSITIVE_KEY_FRAGMENT}[A-Za-z0-9_-]*`;
const SENSITIVE_KEY_RE = new RegExp(`^${SENSITIVE_KEY_NAME}$`, "i");
const SENSITIVE_ASSIGNMENT_RE = new RegExp(
  `((?:["']?)${SENSITIVE_KEY_NAME}(?:["']?)\\s*(?:=|:)\\s*)(?:\\[redacted\\]|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}&\\]]+)`,
  "gi"
);
const SENSITIVE_NAMED_VALUE_RE = new RegExp(
  `(\\b${SENSITIVE_KEY_NAME}\\b\\s+(?:is\\s+)?)(\\[redacted\\]|(?:"(?:\\\\.|[^"\\\\])*")|(?:'(?:\\\\.|[^'\\\\])*')|[^\\s,;}&\\]]+)`,
  "gi"
);
const AUTH_HEADER_RE = /((?:proxy-)?authorization\s*[:=]\s*)(?:(?:bearer|bot|basic)\s+)?[^\s,;]+/gi;
const AUTH_SCHEME_RE = /\b(Bearer|Bot|Basic)\s+[A-Za-z0-9._~+/=-]{6,}\b/gi;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`\\]+/gi;

function clipText(value, maxLength = MAX_URL_LENGTH) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key ?? "").trim());
}

function sanitizeUrlForLog(rawUrl) {
  const text = String(rawUrl ?? "").trim();
  if (!text) return "-";

  try {
    const parsed = new URL(text);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    if (parsed.search) parsed.search = "?...";
    if (parsed.hash) parsed.hash = "";
    return parsed.toString();
  } catch {
    // Do not preserve a query string or user-info from a malformed URL. Those
    // are common places for credentials in third-party stream diagnostics.
    const withoutFragment = text.split("#", 1)[0];
    const withoutQuery = withoutFragment.split("?", 1)[0];
    const withoutUserInfo = withoutQuery.replace(/(\/\/)[^/\s@]+@/g, "$1***@");
    return clipText(withoutUserInfo || "-");
  }
}

function redactSensitiveText(value) {
  let text = String(value ?? "");
  if (!text) return text;

  text = text.replace(URL_RE, (url) => sanitizeUrlForLog(url));
  text = text.replace(AUTH_SCHEME_RE, `$1 ${REDACTED}`);
  text = text.replace(AUTH_HEADER_RE, `$1${REDACTED}`);
  text = text.replace(SENSITIVE_ASSIGNMENT_RE, `$1${REDACTED}`);
  text = text.replace(SENSITIVE_NAMED_VALUE_RE, `$1${REDACTED}`);
  return text;
}

function redactSensitiveData(value, { maxDepth = MAX_DEPTH } = {}) {
  const seen = new WeakSet();

  const redactValue = (current, depth) => {
    if (current === null || current === undefined) return current;
    if (typeof current === "string") return redactSensitiveText(current);
    if (typeof current === "number" || typeof current === "boolean" || typeof current === "bigint") return current;
    if (typeof current === "symbol" || typeof current === "function") return String(current);
    if (current instanceof Date) return current.toISOString();
    if (Buffer.isBuffer(current) || ArrayBuffer.isView(current)) return `[binary ${current.byteLength} bytes]`;
    if (depth >= Math.max(1, Number(maxDepth) || MAX_DEPTH)) return "[truncated]";
    if (typeof current !== "object") return redactSensitiveText(current);
    if (seen.has(current)) return "[circular]";
    seen.add(current);

    if (Array.isArray(current)) {
      return current.map((entry) => redactValue(entry, depth + 1));
    }

    const result = {};
    if (current instanceof Error) {
      result.name = redactSensitiveText(current.name || "Error");
      result.message = redactSensitiveText(current.message || String(current));
      if (current.stack) result.stack = redactSensitiveText(current.stack);
      if (current.cause !== undefined) result.cause = redactValue(current.cause, depth + 1);
    }

    for (const [key, entry] of Object.entries(current)) {
      if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
      result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1);
    }
    return result;
  };

  return redactValue(value, 0);
}

export {
  REDACTED,
  isSensitiveKey,
  redactSensitiveData,
  redactSensitiveText,
  sanitizeUrlForLog,
};
