// ============================================================
// OmniFM: the owner console's settings in MongoDB (#288)
// ============================================================
// The Node twin of backend/services/config.py, so the Node API can answer
// the owner console with the same data and the same rules:
// - sections company, plans, discord, payments, marketing, system in
//   owner_config {_id: "global"}, defaults from src/config/owner-config-defaults.json;
// - secrets leave the API masked ("••••••••" plus "<key>Set": true) and a
//   masked or blank value sent back never replaces the stored secret;
// - settings configured in the environment before the owner console existed
//   show up there until the owner saves the section.
import fs from "node:fs";

import { getDb, isConnected } from "./db.js";
import { RECOVERY_SETTINGS } from "../config/recovery-settings.js";

export const OWNER_CONFIG_ID = "global";
export const SECRET_MASK = "•".repeat(8);
export const SECRET_CONFIG_FIELDS = new Set(["token", "secretKey", "webhookSecret", "secret", "clientSecret", "password", "apiKey", "webhookUrl"]);

const DEFAULTS = JSON.parse(fs.readFileSync(new URL("../config/owner-config-defaults.json", import.meta.url), "utf8"));
DEFAULTS.system.streamRecovery = Object.fromEntries(RECOVERY_SETTINGS.map((entry) => [entry.key, entry.default]));
export const DEFAULT_OWNER_CONFIG = Object.freeze(DEFAULTS);
export const OWNER_CONFIG_SECTIONS = Object.freeze(Object.keys(DEFAULTS));

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isMasked = (value) => value === "" || value === null || value === undefined || value === SECRET_MASK
  || (typeof value === "string" && value.startsWith("•"));

export function deepMerge(base, override) {
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(base[key])) deepMerge(base[key], value);
    else base[key] = value;
  }
  return base;
}

export async function loadOwnerConfigRaw({ db = isConnected() ? getDb() : null } = {}) {
  if (!db) return {};
  try {
    const found = (await db.collection("owner_config").findOne({ _id: OWNER_CONFIG_ID })) || {};
    delete found._id;
    return found;
  } catch {
    return {};
  }
}

/** The section with its defaults filled in, from the raw document. */
export function configSectionFrom(raw, name) {
  const fallback = DEFAULT_OWNER_CONFIG[name];
  const stored = raw?.[name];
  if (isObject(fallback)) {
    const merged = clone(fallback);
    if (isObject(stored)) deepMerge(merged, stored);
    return merged;
  }
  if (stored !== undefined && stored !== null) return stored;
  return fallback !== undefined ? clone(fallback) : {};
}

/**
 * Keeps a stored secret when the incoming value is blank or masked. Lists of
 * objects (workers, providers) are matched by clientId or name, never by
 * position, so reordering cannot move a secret to another entry.
 */
export function mergeConfigSecrets(current, incoming) {
  const blankNewSecrets = (item) => {
    if (isObject(item)) {
      for (const [key, value] of Object.entries(item)) {
        if (SECRET_CONFIG_FIELDS.has(key) && isMasked(value)) item[key] = "";
      }
    }
    return item;
  };
  if (isObject(incoming) && isObject(current)) {
    for (const [key, value] of Object.entries(incoming)) {
      if (SECRET_CONFIG_FIELDS.has(key) && isMasked(value)) incoming[key] = current[key] ?? "";
      else if ((isObject(value) || Array.isArray(value)) && key in current) incoming[key] = mergeConfigSecrets(current[key], value);
      else if (isObject(value) || Array.isArray(value)) blankNewSecrets(value);
    }
    return incoming;
  }
  if (Array.isArray(incoming) && Array.isArray(current)) {
    const keyOf = (entry) => (isObject(entry) ? String(entry.clientId || entry.name || "").trim() : null);
    const byKey = new Map();
    for (const entry of current) {
      const key = keyOf(entry);
      if (key && !byKey.has(key)) byKey.set(key, entry);
    }
    incoming.forEach((item, index) => {
      if (!isObject(item)) return;
      const match = byKey.get(keyOf(item));
      incoming[index] = isObject(match) ? mergeConfigSecrets(match, item) : blankNewSecrets(item);
    });
    return incoming;
  }
  return incoming;
}

export function maskConfigSecrets(value) {
  if (Array.isArray(value)) return value.map(maskConfigSecrets);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_CONFIG_FIELDS.has(key) && typeof entry === "string" && entry) {
      out[key] = SECRET_MASK;
      out[`${key}Set`] = true;
    } else {
      out[key] = isObject(entry) || Array.isArray(entry) ? maskConfigSecrets(entry) : entry;
    }
  }
  return out;
}

/** Drops the API-only "<secret>Set" flags before saving. */
export function stripSecretMarkers(value) {
  if (Array.isArray(value)) return value.map(stripSecretMarkers);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !(key.endsWith("Set") && SECRET_CONFIG_FIELDS.has(key.slice(0, -3))))
    .map(([key, entry]) => [key, stripSecretMarkers(entry)]));
}

export function configBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

// Like Python's int(str): "5000" yes, "5.5" or "abc" no.
const toInt = (value) => {
  const text = String(value).trim();
  if (!/^[+-]?\d+$/.test(text)) throw new TypeError("not a whole number");
  return Number.parseInt(text, 10);
};
const toStr = (value) => String(value);

/** Owner values of system.streamRecovery, clamped to the bounds the bot uses; others dropped. */
export function normalizeStreamRecovery(values) {
  if (!isObject(values)) return {};
  const normalized = {};
  for (const entry of RECOVERY_SETTINGS) {
    const raw = values[entry.key];
    if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") continue;
    const number = Math.trunc(Number(raw));
    if (!Number.isFinite(number)) continue;
    normalized[entry.key] = Math.max(Number(entry.min), Math.min(Number(entry.max), number));
  }
  return normalized;
}

function fillFromEnv(target, storedGroup, fields, env) {
  for (const [key, [envKey, convert]] of Object.entries(fields)) {
    const envValue = env[envKey];
    if (key in storedGroup || envValue === undefined || envValue === null || envValue === "") continue;
    try {
      target[key] = convert(envValue);
    } catch {
      // A value the environment cannot express is left out, like FastAPI does.
    }
  }
}

/** system with the settings from the environment the owner never saved, like effective_system_config(). */
export function effectiveSystemConfig(raw, env = process.env) {
  const config = configSectionFrom(raw, "system");
  const stored = raw?.system || {};
  const groups = {
    discordOAuth: { clientId: ["DISCORD_CLIENT_ID", toStr], clientSecret: ["DISCORD_CLIENT_SECRET", toStr], redirectUri: ["DISCORD_REDIRECT_URI", toStr], scopes: ["DISCORD_OAUTH_SCOPES", toStr] },
    smtp: { host: ["SMTP_HOST", toStr], port: ["SMTP_PORT", toInt], secure: ["SMTP_SECURE", configBool], user: ["SMTP_USER", toStr], password: ["SMTP_PASS", toStr], from: ["SMTP_FROM", toStr] },
    operatorAlerts: { webhookUrl: ["OPERATOR_WEBHOOK_URL", toStr], mention: ["OPERATOR_WEBHOOK_MENTION", toStr] },
    audioRecognition: { enabled: ["NOW_PLAYING_RECOGNITION_ENABLED", configBool], apiKey: ["ACOUSTID_API_KEY", toStr] },
    songHistory: { enabled: ["SONG_HISTORY_ENABLED", configBool], maxPerGuild: ["SONG_HISTORY_MAX_PER_GUILD", toInt] },
    stationHealth: {
      enabled: ["STATION_HEALTH_ENABLED", configBool], intervalMs: ["STATION_HEALTH_INTERVAL_MS", toInt],
      batchSize: ["STATION_HEALTH_BATCH_SIZE", toInt], concurrency: ["STATION_HEALTH_CONCURRENCY", toInt],
      timeoutMs: ["STATION_HEALTH_TIMEOUT_MS", toInt],
    },
    streamRecovery: Object.fromEntries(RECOVERY_SETTINGS.map((entry) => [entry.key, [entry.env, toInt]])),
  };
  for (const [group, fields] of Object.entries(groups)) {
    config[group] = isObject(config[group]) ? config[group] : {};
    fillFromEnv(config[group], stored[group] || {}, fields, env);
  }
  if (!("enabled" in (stored.smtp || {})) && env.SMTP_HOST) config.smtp.enabled = true;

  const directories = {
    discordBotList: {
      enabled: ["DISCORDBOTLIST_ENABLED", configBool], token: ["DISCORDBOTLIST_TOKEN", toStr], botId: ["DISCORDBOTLIST_BOT_ID", toStr],
      slug: ["DISCORDBOTLIST_SLUG", toStr], webhookSecret: ["DISCORDBOTLIST_WEBHOOK_SECRET", toStr], statsScope: ["DISCORDBOTLIST_STATS_SCOPE", toStr],
    },
    botsGG: { enabled: ["BOTSGG_ENABLED", configBool], token: ["BOTSGG_TOKEN", toStr], botId: ["BOTSGG_BOT_ID", toStr], statsScope: ["BOTSGG_STATS_SCOPE", toStr] },
    topGG: {
      enabled: ["TOPGG_ENABLED", configBool], token: ["TOPGG_TOKEN", toStr], botId: ["TOPGG_BOT_ID", toStr],
      webhookSecret: ["TOPGG_WEBHOOK_SECRET", toStr], statsScope: ["TOPGG_STATS_SCOPE", toStr],
    },
  };
  config.botDirectories = isObject(config.botDirectories) ? config.botDirectories : {};
  for (const [directory, fields] of Object.entries(directories)) {
    config.botDirectories[directory] = isObject(config.botDirectories[directory]) ? config.botDirectories[directory] : {};
    fillFromEnv(config.botDirectories[directory], stored.botDirectories?.[directory] || {}, fields, env);
  }
  return config;
}

/** payments with a Stripe key from the environment until the owner saves one, like effective_payments_config(). */
export function effectivePaymentsConfig(raw, env = process.env) {
  const config = configSectionFrom(raw, "payments");
  const storedStripe = raw?.payments?.stripe || {};
  const stripe = isObject(config.stripe) ? config.stripe : (config.stripe = {});
  const envKey = String(env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY || "").trim();
  const envWebhook = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!("secretKey" in storedStripe) && envKey) stripe.secretKey = envKey;
  if (!("webhookSecret" in storedStripe) && envWebhook) stripe.webhookSecret = envWebhook;
  if (!("enabled" in storedStripe) && envKey) stripe.enabled = true;
  if (!("mode" in storedStripe) && envKey) stripe.mode = envKey.startsWith("sk_live_") ? "live" : "test";
  return config;
}

/** GET /api/admin/config, the shape the owner console reads. */
export function ownerConfigResponse(raw, env = process.env) {
  return {
    company: configSectionFrom(raw, "company"),
    plans: configSectionFrom(raw, "plans"),
    discord: maskConfigSecrets(configSectionFrom(raw, "discord")),
    payments: maskConfigSecrets(effectivePaymentsConfig(raw, env)),
    marketing: configSectionFrom(raw, "marketing"),
    system: maskConfigSecrets(effectiveSystemConfig(raw, env)),
    recoverySettings: RECOVERY_SETTINGS,
    env: { stripeEnvKey: Boolean(String(env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY || "").trim()) },
  };
}

/** What save_config_section() stores for a section: merged, secrets kept, recovery clamped. */
export function mergedSectionForSave(raw, name, data, env = process.env) {
  let next = stripSecretMarkers(data);
  const current = name === "system" ? effectiveSystemConfig(raw, env)
    : name === "payments" ? effectivePaymentsConfig(raw, env)
      : raw?.[name];
  if ((isObject(next) || Array.isArray(next)) && current !== undefined && current !== null) {
    if (isObject(next) && isObject(current)) next = deepMerge(clone(current), next);
    next = mergeConfigSecrets(current, next);
  }
  if (name === "system" && isObject(next) && "streamRecovery" in next) next.streamRecovery = normalizeStreamRecovery(next.streamRecovery);
  return next;
}

/** The fresh section as PUT answers it (secrets masked for discord, payments and system). */
export function sectionResponse(raw, name, env = process.env) {
  const fresh = name === "system" ? effectiveSystemConfig(raw, env)
    : name === "payments" ? effectivePaymentsConfig(raw, env)
      : configSectionFrom(raw, name);
  return ["discord", "payments", "system"].includes(name) ? maskConfigSecrets(fresh) : fresh;
}
