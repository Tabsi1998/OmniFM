// ============================================================
// OmniFM Radio (#572): Abfrage der AzuraCast-API.
// Liefert einen einheitlichen Zustand für Katalog, Live-Erkennung und
// Anzeigen. Fällt die API aus, kommt { ok: false } zurück, nie ein Fehler.
// ============================================================

import { safeFetch } from "../lib/safe-outbound-http.js";
import { getOmnifmRadioConfig } from "./omnifm-radio-config.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_MS = 10_000;
const MAX_BODY_BYTES = 256 * 1024;

let fetchImpl = safeFetch;
let cached = null;

export function setOmnifmRadioFetchForTests(fn) {
  fetchImpl = typeof fn === "function" ? fn : safeFetch;
  cached = null;
}

export function clearOmnifmRadioApiCache() {
  cached = null;
}

function text(value, max = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isoOrNull(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number * 1000).toISOString();
}

// AzuraCast /api/nowplaying/<station> → OmniFM-Zustand
export function normalizeAzuracastNowPlaying(payload, { now = Date.now() } = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const live = data.live && typeof data.live === "object" ? data.live : {};
  const song = data.now_playing?.song && typeof data.now_playing.song === "object" ? data.now_playing.song : {};
  const isLive = live.is_live === true;
  return {
    ok: true,
    online: data.is_online !== false,
    isLive,
    streamerName: isLive ? text(live.streamer_name, 100) : "",
    liveSince: isLive ? isoOrNull(live.broadcast_start) : null,
    title: text(song.title),
    artist: text(song.artist),
    songText: text(song.text),
    listeners: Math.max(0, Number.parseInt(String(data.listeners?.current ?? 0), 10) || 0),
    fetchedAt: new Date(now).toISOString(),
  };
}

async function readJson(response) {
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) throw new Error("AzuraCast-Antwort zu groß");
  return JSON.parse(body);
}

export async function fetchOmnifmRadioNowPlaying({
  config = getOmnifmRadioConfig(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheMs = DEFAULT_CACHE_MS,
  force = false,
  now = Date.now(),
} = {}) {
  if (!config.enabled) return { ok: false, reason: "disabled" };
  if (!force && cached && cached.url === config.nowPlayingUrl && now - cached.at < cacheMs) {
    return cached.value;
  }
  let value;
  try {
    const response = await fetchImpl(config.nowPlayingUrl, {
      headers: { accept: "application/json" },
      timeoutMs,
      redirect: "error",
    });
    if (!response.ok) {
      value = { ok: false, reason: `http_${response.status}` };
    } else {
      value = normalizeAzuracastNowPlaying(await readJson(response), { now });
    }
  } catch (error) {
    value = { ok: false, reason: text(error?.code || error?.name || "error", 60) };
  }
  cached = { url: config.nowPlayingUrl, at: now, value };
  return value;
}
