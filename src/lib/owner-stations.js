// ============================================================
// OmniFM: the owner console's station catalogue on the Node API (#288)
// ============================================================
// The Node twin of backend/routers/admin_stations.py: list with health,
// stream test, create/update, delete (archived first) and the health check
// on demand. Same rules and answers as FastAPI; outbound requests go through
// safeFetch, which also refuses redirects into the local network.
import { safeFetch, validateOutboundUrlWithDns } from "./safe-outbound-http.js";
import { parseIntLike } from "./owner-licenses.js";

export const STATION_KEY = /^[a-z0-9][a-z0-9._-]{1,48}$/;
export const VALID_STATION_TIERS = Object.freeze(["free", "pro", "ultimate"]);
const AUDIO_TYPES = ["audio", "mpeg", "ogg", "aac", "octet-stream"];

const clip = (value, max) => {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};

export class OwnerStationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** station_catalog_fields(): kept as typed, only https links and #RRGGBB colours. */
export function stationCatalogFields(raw = {}) {
  const https = (value) => {
    const text = String(value ?? "").trim();
    if (!text || text.length > 500) return "";
    try {
      const url = new URL(text);
      return url.protocol === "https:" && url.host ? text : "";
    } catch {
      return "";
    }
  };
  const color = /^#?([0-9a-fA-F]{6})$/.exec(String(raw.color ?? "").trim());
  const fields = {
    genre: clip(raw.genre || raw.category || "", 80) || "Radio",
    country: clip(raw.country || "", 60),
    language: clip(raw.language || "", 40),
    color: color ? `#${color[1].toUpperCase()}` : "",
    logo: https(raw.logo),
    homepage: https(raw.homepage),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}

/** validate_custom_station_url(): http(s), no credentials, no local or private host (DNS included). */
export async function validateStationUrl(url) {
  const value = String(url ?? "").trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "URL-Format ungültig." };
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return { ok: false, error: "URL-Format ungültig." };
  if (parsed.username || parsed.password) return { ok: false, error: "URLs mit Benutzername/Passwort sind nicht erlaubt." };
  const checked = await validateOutboundUrlWithDns(value, { allowedProtocols: ["http:", "https:"] });
  return checked.ok ? { ok: true } : { ok: false, error: checked.error || "Lokale/private Hosts sind nicht erlaubt." };
}

/** A GET of the first bytes: reachable, and does it send audio? (_probe_station_url) */
export async function probeStationUrl(url, { timeoutMs = 5000, fetchImpl = safeFetch } = {}) {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Range: "bytes=0-2047", "User-Agent": "OmniFM-StreamTest/1.0", "Icy-MetaData": "1" },
      redirect: "follow",
      timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    const contentType = String(response.headers?.get?.("content-type") || "");
    const icyName = response.headers?.get?.("icy-name") || null;
    const icyBitrate = response.headers?.get?.("icy-br") || null;
    try { await response.body?.cancel?.(); } catch { /* the stream is closed either way */ }
    const reachable = response.status < 400;
    const isAudio = AUDIO_TYPES.some((type) => contentType.toLowerCase().includes(type)) || Boolean(icyName);
    const discordOk = reachable && isAudio;
    return { ok: discordOk, reachable, discordOk, isAudioStream: isAudio, status: response.status, latencyMs, contentType, icyName, bitrate: icyBitrate };
  } catch (err) {
    const timedOut = err?.code === "OUTBOUND_TIMEOUT" || err?.name === "AbortError" || err?.name === "TimeoutError";
    const reason = String(err?.message || err || "");
    return { ok: false, reachable: false, discordOk: false, status: 0, latencyMs: Date.now() - started, message: timedOut ? "timeout" : clip(reason, 80), timedOut, reason };
  }
}

/** POST /api/admin/stations/test: the answer the owner console shows. */
export async function testStationStream(url, options = {}) {
  const check = await validateStationUrl(url);
  if (!check.ok) throw new OwnerStationError(400, check.error || "URL ungültig.");
  const probe = await probeStationUrl(url, { timeoutMs: 6000, ...options });
  if (probe.status === 0) {
    return probe.timedOut
      ? { ok: false, reachable: false, message: "Zeitüberschreitung – Stream nicht erreichbar.", latencyMs: probe.latencyMs }
      : { ok: false, reachable: false, message: `Fehler: ${clip(probe.reason, 120)}` };
  }
  return {
    ok: probe.ok,
    reachable: probe.reachable,
    isAudioStream: probe.isAudioStream,
    status: probe.status,
    contentType: probe.contentType,
    icyName: probe.icyName,
    bitrate: probe.bitrate,
    latencyMs: probe.latencyMs,
    message: probe.ok ? "Stream erreichbar und liefert Audio." : (probe.reachable ? "Erreichbar, aber kein eindeutiger Audio-Stream." : `HTTP ${probe.status}`),
  };
}

/** POST /api/admin/stations: validates and builds the document to store. */
export async function buildStationDocument(body = {}) {
  const key = String(body.key || "").trim().toLowerCase();
  const name = body.name ? clip(body.name, 80) : "";
  const url = String(body.url || "").trim();
  const tier = String(body.tier || "free").trim().toLowerCase();
  const genre = body.genre ? clip(body.genre, 60) : "Radio";
  if (!STATION_KEY.test(key)) throw new OwnerStationError(400, "Ungültiger Key (a-z, 0-9, . _ -, 2-49 Zeichen).");
  if (!name) throw new OwnerStationError(400, "Name erforderlich.");
  if (!VALID_STATION_TIERS.includes(tier)) throw new OwnerStationError(400, "Tier muss free, pro oder ultimate sein.");
  const check = await validateStationUrl(url);
  if (!check.ok) throw new OwnerStationError(400, check.error || "Stream-URL ungültig.");
  const extra = stationCatalogFields({ ...body, genre });
  const doc = { key, name, url, tier, genre };
  // An emptied field is stored empty, like FastAPI.
  for (const field of ["country", "language", "color", "logo", "homepage"]) doc[field] = extra[field] || "";
  return doc;
}

/** GET /api/admin/stations/list: the catalogue with each station's health. */
export async function stationListResponse(db, stationHealthConfig = {}) {
  let rows = [];
  if (db) {
    try {
      const healthByKey = new Map((await db.collection("station_health").find({}, { projection: { _id: 0 } }).toArray())
        .filter((doc) => String(doc.key || ""))
        .map((doc) => [String(doc.key), doc]));
      const stations = await db.collection("stations").find({ key: { $not: /^custom:/ } }, { projection: { _id: 0 } }).sort({ tier: 1, name: 1 }).toArray();
      rows = stations.map((doc) => ({
        key: doc.key, name: doc.name, url: doc.url, tier: doc.tier || "free", genre: doc.genre || "Radio",
        country: doc.country || "", language: doc.language || "", color: doc.color || "", logo: doc.logo || "",
        homepage: doc.homepage || "", isDefault: Boolean(doc.is_default), updatedAt: doc.updated_at ?? null,
        health: healthByKey.get(String(doc.key || "")) ?? null,
      }));
    } catch {
      rows = [];
    }
  }
  const health = rows.map((row) => row.health).filter((entry) => entry && typeof entry === "object");
  return {
    stations: rows,
    count: rows.length,
    healthSummary: {
      automatic: stationHealthConfig.enabled !== false,
      intervalMs: Math.max(2000, parseIntLike(stationHealthConfig.intervalMs ?? 5000, 5000)),
      batchSize: Math.max(1, Math.min(10, parseIntLike(stationHealthConfig.batchSize ?? 2, 2))),
      checked: health.length,
      up: health.filter((entry) => entry.status === "up").length,
      down: health.filter((entry) => entry.status === "down" && parseIntLike(entry.consecutiveFailures, 0) >= 2).length,
      pending: Math.max(0, rows.length - health.length),
    },
  };
}

/** POST /api/admin/stations/health: checks up to 25 stations now and stores the result. */
export async function runStationHealth(db, keys, { probe = probeStationUrl, now = () => Date.now() } = {}) {
  const requested = Array.isArray(keys) ? keys.map((key) => String(key).trim().toLowerCase()).filter(Boolean) : [];
  const query = requested.length ? { key: { $in: requested.slice(0, 25) } } : { key: { $not: /^custom:/ } };
  const stations = (await db.collection("stations").find(query, { projection: { _id: 0, key: 1, url: 1 } }).limit(25).toArray()).filter((row) => row.url);
  const results = {};
  // Only what FastAPI's _probe_station_url stores, so both write the same health documents.
  const healthFields = ({ ok, reachable, discordOk, status, latencyMs, message }) => ({
    ok, reachable, discordOk, status, latencyMs, ...(message === undefined ? {} : { message }),
  });
  // At most 10 at a time, like FastAPI's thread pool.
  for (let index = 0; index < stations.length; index += 10) {
    const batch = stations.slice(index, index + 10);
    // eslint-disable-next-line no-await-in-loop -- batches of 10 on purpose
    const probed = await Promise.all(batch.map((row) => probe(row.url).catch((err) => ({ ok: false, reachable: false, message: clip(err?.message || err, 80) }))));
    batch.forEach((row, position) => { results[row.key] = healthFields(probed[position]); });
  }
  const health = db.collection("station_health");
  const incidents = db.collection("runtime_incidents");
  await Promise.all(Object.entries(results).map(async ([key, result]) => {
    const previous = (await health.findOne({ key }, { projection: { _id: 0 } })) || {};
    const ok = Boolean(result.discordOk || result.ok);
    const failures = ok ? 0 : parseIntLike(previous.consecutiveFailures, 0) + 1;
    const successes = ok ? parseIntLike(previous.consecutiveSuccesses, 0) + 1 : 0;
    const stamp = new Date(now()).toISOString();
    const doc = {
      ...result,
      key,
      status: ok ? "up" : "down",
      responseTimeMs: result.latencyMs ?? null,
      lastCheckedAt: now(),
      checkedAt: stamp,
      updatedAt: stamp,
      consecutiveFailures: failures,
      consecutiveSuccesses: successes,
      error: ok ? null : result.message || (result.status ? `HTTP ${result.status}` : "nicht erreichbar"),
    };
    await health.updateOne({ key }, { $set: doc }, { upsert: true });
    Object.assign(result, doc);
    if (failures === 2) {
      await incidents.insertOne({ at: stamp, severity: "warning", source: "station-health", message: clip(`Sender ${key} ist offline: ${doc.error}`, 240), resolved: false });
    } else if (ok && previous.status === "down" && parseIntLike(previous.consecutiveFailures, 0) >= 2) {
      await incidents.insertOne({ at: stamp, severity: "info", source: "station-health", message: clip(`Sender ${key} ist wieder erreichbar`, 240), resolved: true });
    }
  }));
  return { results, count: Object.keys(results).length, truncated: requested.length > 25 };
}
