import fs from "node:fs";
import path from "node:path";

import { rootDir } from "./logging.js";

const ENV_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const MAX_VALUE_LENGTH = 2000;

const GROUPS = [
  {
    id: "web",
    title: "Web & Sprache",
    description: "Domain, Public URL, CORS/Checkout-Origins und Standard-Sprache.",
    fields: [
      { key: "WEB_DOMAIN", label: "Web-Domain", type: "domain", example: "omnifm.xyz" },
      { key: "PUBLIC_WEB_URL", label: "Public Web URL", type: "url", example: "https://omnifm.xyz" },
      { key: "CORS_ALLOWED_ORIGINS", label: "Erlaubte CORS Origins", type: "origin-list", example: "https://omnifm.xyz" },
      { key: "CHECKOUT_RETURN_ORIGINS", label: "Checkout Return Origins", type: "origin-list", example: "https://omnifm.xyz" },
      { key: "DEFAULT_LANGUAGE", label: "Standardsprache", type: "enum", values: ["de", "en"], example: "de" },
      { key: "PRO_TRIAL_ENABLED", label: "Pro Trial aktiv", type: "boolean", example: "1" },
    ],
  },
  {
    id: "legal",
    title: "Impressum",
    description: "Betreiber- und Impressumsdaten fuer die oeffentlichen Rechtstexte.",
    fields: [
      { key: "LEGAL_PRODUCT_NAME", label: "Produktname", type: "text", example: "OmniFM" },
      { key: "LEGAL_PROVIDER_NAME", label: "Anbieter/Firma", type: "text", example: "IT-Tabelander" },
      { key: "LEGAL_LEGAL_FORM", label: "Rechtsform", type: "text", example: "Kleinunternehmen" },
      { key: "LEGAL_REPRESENTATIVE", label: "Vertretungsbefugte Person", type: "text" },
      { key: "LEGAL_STREET_ADDRESS", label: "Strasse/Hausnummer", type: "text" },
      { key: "LEGAL_POSTAL_CODE", label: "PLZ", type: "text" },
      { key: "LEGAL_CITY", label: "Ort", type: "text" },
      { key: "LEGAL_COUNTRY", label: "Land", type: "text", example: "Austria" },
      { key: "LEGAL_EMAIL", label: "E-Mail", type: "email" },
      { key: "LEGAL_PHONE", label: "Telefon", type: "text" },
      { key: "LEGAL_WEBSITE", label: "Webseite", type: "url" },
      { key: "LEGAL_BUSINESS_PURPOSE", label: "Taetigkeitsbereich", type: "text" },
      { key: "LEGAL_COMMERCIAL_REGISTER_NUMBER", label: "Firmenbuchnummer", type: "text" },
      { key: "LEGAL_COMMERCIAL_REGISTER_COURT", label: "Firmenbuchgericht", type: "text" },
      { key: "LEGAL_VAT_ID", label: "UID-Nummer", type: "text" },
      { key: "LEGAL_SUPERVISORY_AUTHORITY", label: "Aufsichtsbehoerde", type: "text" },
      { key: "LEGAL_CHAMBER", label: "Kammer/Berufsverband", type: "text" },
      { key: "LEGAL_PROFESSION", label: "Berufsbezeichnung", type: "text" },
      { key: "LEGAL_PROFESSION_RULES", label: "Berufsrecht/Regelwerk", type: "text" },
      { key: "LEGAL_EDITORIAL_RESPONSIBLE", label: "Redaktionell verantwortlich", type: "text" },
      { key: "LEGAL_MEDIA_OWNER", label: "Medieninhaber", type: "text" },
      { key: "LEGAL_MEDIA_LINE", label: "Blattlinie", type: "text" },
    ],
  },
  {
    id: "privacy",
    title: "Datenschutz",
    description: "Kontakt, Hosting und Beschwerdestelle fuer die Datenschutzerklaerung.",
    fields: [
      { key: "PRIVACY_CONTACT_EMAIL", label: "Datenschutz E-Mail", type: "email" },
      { key: "PRIVACY_CONTACT_PHONE", label: "Datenschutz Telefon", type: "text" },
      { key: "PRIVACY_DPO_NAME", label: "Datenschutzkontakt Name", type: "text" },
      { key: "PRIVACY_DPO_EMAIL", label: "Datenschutzkontakt E-Mail", type: "email" },
      { key: "PRIVACY_HOSTING_PROVIDER", label: "Hosting Anbieter", type: "text" },
      { key: "PRIVACY_HOSTING_LOCATION", label: "Hosting Standort", type: "text" },
      { key: "PRIVACY_ADDITIONAL_RECIPIENTS", label: "Weitere Empfaenger", type: "text" },
      { key: "PRIVACY_CUSTOM_NOTE", label: "Zusaetzlicher Hinweis", type: "text" },
      { key: "PRIVACY_AUTHORITY_NAME", label: "Beschwerdebehoerde", type: "text" },
      { key: "PRIVACY_AUTHORITY_WEBSITE", label: "Website Beschwerdebehoerde", type: "url" },
    ],
  },
  {
    id: "terms",
    title: "Nutzungsbedingungen",
    description: "Kontakt- und Rechtsdaten fuer die Terms-Seite.",
    fields: [
      { key: "TERMS_CONTACT_EMAIL", label: "Terms Kontakt E-Mail", type: "email" },
      { key: "TERMS_SUPPORT_URL", label: "Support/Webseiten URL", type: "url" },
      { key: "TERMS_EFFECTIVE_DATE", label: "Gueltig ab", type: "date" },
      { key: "TERMS_GOVERNING_LAW", label: "Anwendbares Recht", type: "text" },
      { key: "TERMS_CUSTOM_NOTE", label: "Zusaetzlicher Hinweis", type: "text" },
    ],
  },
  {
    id: "runtime",
    title: "Betrieb",
    description: "Log-Rotation, Docker-Prune und Discord Command-Registrierung.",
    fields: [
      { key: "LOG_MAX_MB", label: "Max Loggroesse MB", type: "integer", min: 1, max: 1024, example: "5" },
      { key: "LOG_MAX_FILES", label: "Max rotierte Logdateien", type: "integer", min: 1, max: 365, example: "30" },
      { key: "LOG_MAX_DAYS", label: "Log-Aufbewahrung Tage", type: "integer", min: 1, max: 3650, example: "14" },
      { key: "AUTO_DOCKER_PRUNE", label: "Docker Cleanup automatisch", type: "boolean", example: "1" },
      { key: "DOCKER_BUILDER_PRUNE_UNTIL", label: "Docker Build Cache Alter", type: "text", example: "168h" },
      { key: "COMMAND_REGISTRATION_MODE", label: "Command Registrierung", type: "enum", values: ["guild", "global", "hybrid"], example: "guild" },
      { key: "SYNC_GUILD_COMMANDS_ON_BOOT", label: "Guild Commands beim Start syncen", type: "boolean", example: "1" },
      { key: "PERIODIC_GUILD_COMMAND_SYNC_MS", label: "Periodischer Command Sync ms", type: "integer", min: 0, max: 86400000, example: "3600000" },
      { key: "GUILD_COMMAND_SYNC_RETRIES", label: "Command Sync Retries", type: "integer", min: 0, max: 20, example: "3" },
      { key: "GUILD_COMMAND_SYNC_RETRY_MS", label: "Command Sync Retry ms", type: "integer", min: 0, max: 600000, example: "5000" },
      { key: "CLEAN_GLOBAL_COMMANDS_ON_BOOT", label: "Globale Commands beim Start bereinigen", type: "boolean", example: "0" },
      { key: "CLEAN_GUILD_COMMANDS_ON_BOOT", label: "Guild Commands beim Start bereinigen", type: "boolean", example: "0" },
      { key: "CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT", label: "Worker Guild Commands bereinigen", type: "boolean", example: "0" },
    ],
  },
];

const SECRET_FIELDS = [
  { group: "Owner", key: "API_ADMIN_TOKEN", label: "Owner API Token" },
  { group: "Owner", key: "ADMIN_API_TOKEN", label: "Legacy Owner API Token" },
  { group: "Discord", key: "BOT_TOKEN", label: "Discord Bot Token" },
  { group: "Discord", key: "DISCORD_CLIENT_SECRET", label: "Discord OAuth Secret" },
  { group: "Stripe", key: "STRIPE_SECRET_KEY", label: "Stripe Secret Key" },
  { group: "Stripe", key: "STRIPE_WEBHOOK_SECRET", label: "Stripe Webhook Secret" },
  { group: "Mail", key: "SMTP_PASS", label: "SMTP Passwort" },
  { group: "Vote Plattformen", key: "DISCORDBOTLIST_WEBHOOK_SECRET", label: "DiscordBotList Webhook Secret" },
  { group: "Vote Plattformen", key: "BOTSGG_WEBHOOK_SECRET", label: "Bots.gg Webhook Secret" },
  { group: "Vote Plattformen", key: "TOPGG_WEBHOOK_SECRET", label: "Top.gg Webhook Secret" },
  { group: "Audio", key: "ACOUSTID_API_KEY", label: "AcoustID API Key" },
];

const FIELD_BY_KEY = new Map(GROUPS.flatMap((group) => group.fields.map((field) => [field.key, { ...field, group: group.id }])));
const SECRET_KEYS = new Set(SECRET_FIELDS.map((field) => field.key));

function resolveEnvFilePath() {
  const explicit = String(process.env.OMNIFM_ENV_FILE || "").trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(rootDir, explicit);
  return path.join(rootDir, ".env");
}

function stripUnsafeValueCharacters(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\r\n\u0000]/g, " ")
    .trim();
}

function parseEnvContent(content) {
  const values = {};
  const lines = String(content || "").split(/\n/).map((line) => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    const match = normalized.match(ENV_LINE_RE);
    if (!match) return { raw: normalized, key: null, value: null };
    values[match[1]] = match[2];
    return { raw: normalized, key: match[1], value: match[2] };
  });
  return { lines, values };
}

function readEnvFile(envFile = resolveEnvFilePath()) {
  try {
    const content = fs.readFileSync(envFile, "utf8");
    return { envFile, exists: true, ...parseEnvContent(content) };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { envFile, exists: false, lines: [], values: {} };
    }
    throw err;
  }
}

function getFileWritableState(envFile) {
  try {
    if (fs.existsSync(envFile)) {
      fs.accessSync(envFile, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    }
    fs.accessSync(path.dirname(envFile), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readEffectiveValue(values, key) {
  if (Object.prototype.hasOwnProperty.call(values, key)) {
    return { value: values[key], source: "env-file" };
  }
  if (process.env[key] != null) {
    return { value: String(process.env[key]), source: "process" };
  }
  return { value: "", source: "empty" };
}

function validateUrl(value, key) {
  if (!value) return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} muss eine gueltige URL sein.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${key} muss mit http:// oder https:// beginnen.`);
  }
  return parsed.toString().replace(/\/$/, parsed.pathname === "/" && !parsed.search && !parsed.hash ? "" : "/");
}

function validateOriginList(value, key) {
  if (!value) return "";
  const origins = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const normalized = origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`${key} enthaelt eine ungueltige Origin: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`${key} erlaubt nur http/https Origins.`);
    }
    return parsed.origin;
  });
  return Array.from(new Set(normalized)).join(",");
}

function validateDomain(value, key) {
  if (!value) return "";
  const normalized = value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(normalized) || normalized.includes("..")) {
    throw new Error(`${key} muss eine Domain ohne Pfad sein.`);
  }
  return normalized;
}

function validateEmail(value, key) {
  if (!value) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${key} muss eine gueltige E-Mail-Adresse sein.`);
  }
  return value;
}

function normalizeBoolean(value, key) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "j", "ja", "on"].includes(normalized)) return "1";
  if (["0", "false", "no", "n", "nein", "off"].includes(normalized)) return "0";
  throw new Error(`${key} muss 1/0 bzw. true/false sein.`);
}

function validateInteger(value, key, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === "") return "";
  if (!/^-?\d+$/.test(value)) throw new Error(`${key} muss eine ganze Zahl sein.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${key} muss zwischen ${min} und ${max} liegen.`);
  }
  return String(number);
}

function normalizeConfigValue(field, rawValue) {
  const value = stripUnsafeValueCharacters(rawValue);
  if (value.length > MAX_VALUE_LENGTH) throw new Error(`${field.key} ist zu lang.`);
  if (value.includes("#")) throw new Error(`${field.key} darf kein # enthalten, weil .env sonst uneindeutig wird.`);

  if (field.type === "url") return validateUrl(value, field.key);
  if (field.type === "origin-list") return validateOriginList(value, field.key);
  if (field.type === "domain") return validateDomain(value, field.key);
  if (field.type === "email") return validateEmail(value, field.key);
  if (field.type === "boolean") return value ? normalizeBoolean(value, field.key) : "";
  if (field.type === "integer") return validateInteger(value, field.key, field);
  if (field.type === "enum") {
    const normalized = value.toLowerCase();
    if (!field.values.includes(normalized)) {
      throw new Error(`${field.key} muss einer dieser Werte sein: ${field.values.join(", ")}.`);
    }
    return normalized;
  }
  if (field.type === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field.key} muss im Format YYYY-MM-DD sein.`);
  }
  return value;
}

function serializeEnvLines(parsed, updates) {
  const seen = new Set();
  const lines = parsed.lines.map((line) => {
    if (!line.key || !Object.prototype.hasOwnProperty.call(updates, line.key)) return line.raw;
    seen.add(line.key);
    return `${line.key}=${updates[line.key]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue;
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

function buildSnapshot(parsed = readEnvFile(), { updatedKeys = [] } = {}) {
  const envFile = parsed.envFile;
  return {
    generatedAt: new Date().toISOString(),
    envFile: {
      path: envFile,
      exists: parsed.exists,
      writable: getFileWritableState(envFile),
    },
    restartRequired: updatedKeys.length > 0,
    updatedKeys,
    groups: GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      fields: group.fields.map((field) => {
        const effective = readEffectiveValue(parsed.values, field.key);
        return {
          ...field,
          value: effective.value,
          source: effective.source,
          editable: true,
          secret: false,
        };
      }),
    })),
    secrets: SECRET_FIELDS.map((field) => {
      const effective = readEffectiveValue(parsed.values, field.key);
      return {
        ...field,
        configured: effective.value.trim().length > 0,
        source: effective.source,
        editable: false,
        secret: true,
      };
    }),
  };
}

function getOwnerConfigSnapshot() {
  return buildSnapshot(readEnvFile());
}

function patchOwnerConfig(input) {
  const body = input && typeof input === "object" ? input : {};
  const values = body.values && typeof body.values === "object" ? body.values : body;
  const updates = {};
  const rejected = [];

  for (const [key, rawValue] of Object.entries(values)) {
    if (SECRET_KEYS.has(key)) {
      rejected.push(`${key} ist geheim und kann in diesem Schritt nur als Status angezeigt werden.`);
      continue;
    }
    const field = FIELD_BY_KEY.get(key);
    if (!field) {
      rejected.push(`${key} ist keine erlaubte Owner-Einstellung.`);
      continue;
    }
    updates[key] = normalizeConfigValue(field, rawValue);
  }

  if (rejected.length) {
    const err = new Error(rejected.join(" "));
    err.statusCode = 400;
    throw err;
  }

  const parsed = readEnvFile();
  const envFile = parsed.envFile;
  fs.mkdirSync(path.dirname(envFile), { recursive: true });

  if (parsed.exists) {
    fs.copyFileSync(envFile, `${envFile}.bak-owner`);
  }

  const content = serializeEnvLines(parsed, updates);
  const tmpFile = `${envFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpFile, envFile);

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }

  return buildSnapshot(readEnvFile(envFile), { updatedKeys: Object.keys(updates) });
}

export {
  GROUPS as OWNER_CONFIG_GROUPS,
  SECRET_FIELDS as OWNER_CONFIG_SECRET_FIELDS,
  getOwnerConfigSnapshot,
  patchOwnerConfig,
  resolveEnvFilePath,
};
