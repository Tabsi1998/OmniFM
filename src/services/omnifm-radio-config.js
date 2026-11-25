// ============================================================
// OmniFM Radio (#572): gemeinsame Einstellungen des eigenen Senders.
// AzuraCast sendet, OmniFM spielt den Stream wie jeden Katalog-Sender.
// Eine Quelle für Katalog (#591), Live-Erkennung (#592) und Meldungen.
//
// Konfiguration in .env (alle optional):
//   OMNIFM_RADIO_ENABLED=1            0 schaltet den Sender ganz ab (auch true/false, yes/no, on/off)
//   OMNIFM_RADIO_BASE_URL=https://radio.omnifm.xyz
//   OMNIFM_RADIO_STATION=omnifm_radio  Kurzname der AzuraCast-Station
//   OMNIFM_RADIO_STREAM_URL=           Standard: <BASE>/listen/<STATION>/radio.mp3
//   OMNIFM_RADIO_STATION_KEY=omnifm-radio  Key im OmniFM-Katalog
//   OMNIFM_RADIO_PUBLIC=0              1 = für alle Server sichtbar
//   OMNIFM_RADIO_TEST_GUILD_IDS=       Server-IDs (Komma), die ihn vorher sehen
// ============================================================

import { log } from "../lib/logging.js";

const DEFAULT_BASE_URL = "https://radio.omnifm.xyz";
const DEFAULT_STATION = "omnifm_radio";
const DEFAULT_STATION_KEY = "omnifm-radio";
// Kleinbuchstaben, Ziffern und "-": kein "custom:", kein "_" (#591).
const STATION_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;
const warnedStationKeys = new Set();

function flag(value, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function stationKeyFrom(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return DEFAULT_STATION_KEY;
  if (STATION_KEY_PATTERN.test(raw)) return raw;
  // Die Einstellungen werden oft gelesen: die Warnung kommt nur einmal je Wert.
  if (!warnedStationKeys.has(raw)) {
    warnedStationKeys.add(raw);
    log("WARN", `OMNIFM_RADIO_STATION_KEY "${raw.slice(0, 60)}" ist ungültig (a-z, 0-9, -); OmniFM nimmt "${DEFAULT_STATION_KEY}".`);
  }
  return DEFAULT_STATION_KEY;
}

function trimSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function parseIdList(value) {
  return [...new Set(
    String(value || "")
      .split(/[\s,;]+/)
      .map((id) => id.trim())
      .filter((id) => /^\d{15,22}$/.test(id))
  )];
}

// #599: where the server reaches AzuraCast in its own network; only the origin counts.
function internalOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function getOmnifmRadioConfig(env = process.env) {
  const baseUrl = trimSlash(env.OMNIFM_RADIO_BASE_URL) || DEFAULT_BASE_URL;
  const station = String(env.OMNIFM_RADIO_STATION || "").trim() || DEFAULT_STATION;
  const streamUrl = String(env.OMNIFM_RADIO_STREAM_URL || "").trim()
    || `${baseUrl}/listen/${encodeURIComponent(station)}/radio.mp3`;
  return Object.freeze({
    enabled: flag(env.OMNIFM_RADIO_ENABLED, true),
    baseUrl,
    station,
    streamUrl,
    stationKey: stationKeyFrom(env.OMNIFM_RADIO_STATION_KEY),
    nowPlayingUrl: `${baseUrl}/api/nowplaying/${encodeURIComponent(station)}`,
    internalUrl: internalOrigin(env.OMNIFM_RADIO_INTERNAL_URL),
    isPublic: flag(env.OMNIFM_RADIO_PUBLIC, false),
    testGuildIds: Object.freeze(parseIdList(env.OMNIFM_RADIO_TEST_GUILD_IDS)),
  });
}

// Solange die Musikrechte (AKM/LSG) nicht geklärt sind, sehen den Sender
// nur die Test-Server. Ohne guildId (z. B. öffentliche Website) nur, wenn er
// öffentlich ist.
export function isOmnifmRadioVisibleForGuild(guildId, config = getOmnifmRadioConfig()) {
  if (!config.enabled) return false;
  if (config.isPublic) return true;
  const id = String(guildId || "").trim();
  return Boolean(id) && config.testGuildIds.includes(id);
}

// Live-Erkennung (#592): Webhook-Geheimnis, Abfrage-Takt und Gnadenfrist.
// Ein Geheimnis unter 16 Zeichen schützt kaum; dann bleibt der Webhook aus.
const MIN_WEBHOOK_SECRET_LENGTH = 16;
const DEFAULT_POLL_MS = 30_000;
const MIN_POLL_MS = 5_000;
const DEFAULT_GRACE_MS = 60_000;

function nonNegativeInt(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const number = Number.parseInt(raw, 10);
  return Number.isSafeInteger(number) ? number : fallback;
}

export function getOmnifmRadioLiveSettings(env = process.env) {
  const secret = String(env.OMNIFM_RADIO_WEBHOOK_SECRET || "").trim();
  const tooShort = secret.length > 0 && secret.length < MIN_WEBHOOK_SECRET_LENGTH;
  const pollMs = nonNegativeInt(env.OMNIFM_RADIO_POLL_MS, DEFAULT_POLL_MS);
  return Object.freeze({
    webhookSecret: tooShort ? "" : secret,
    webhookSecretTooShort: tooShort,
    pollMs: pollMs > 0 ? Math.max(MIN_POLL_MS, pollMs) : DEFAULT_POLL_MS,
    graceMs: nonNegativeInt(env.OMNIFM_RADIO_LIVE_GRACE_MS, DEFAULT_GRACE_MS),
  });
}
