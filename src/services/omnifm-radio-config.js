// ============================================================
// OmniFM Radio (#572): gemeinsame Einstellungen des eigenen Senders.
// AzuraCast sendet, OmniFM spielt den Stream wie jeden Katalog-Sender.
// Eine Quelle für Katalog (#591), Live-Erkennung (#592) und Meldungen.
//
// Konfiguration in .env (alle optional):
//   OMNIFM_RADIO_ENABLED=1            0 schaltet den Sender ganz ab
//   OMNIFM_RADIO_BASE_URL=https://radio.omnifm.xyz
//   OMNIFM_RADIO_STATION=omnifm_radio  Kurzname der AzuraCast-Station
//   OMNIFM_RADIO_STREAM_URL=           Standard: <BASE>/listen/<STATION>/radio.mp3
//   OMNIFM_RADIO_STATION_KEY=omnifm-radio  Key im OmniFM-Katalog
//   OMNIFM_RADIO_PUBLIC=0              1 = für alle Server sichtbar
//   OMNIFM_RADIO_TEST_GUILD_IDS=       Server-IDs (Komma), die ihn vorher sehen
// ============================================================

const DEFAULT_BASE_URL = "https://radio.omnifm.xyz";
const DEFAULT_STATION = "omnifm_radio";
const DEFAULT_STATION_KEY = "omnifm-radio";

function flag(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
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
    stationKey: String(env.OMNIFM_RADIO_STATION_KEY || "").trim().toLowerCase() || DEFAULT_STATION_KEY,
    nowPlayingUrl: `${baseUrl}/api/nowplaying/${encodeURIComponent(station)}`,
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
