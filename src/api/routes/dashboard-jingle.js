// The server's jingle in the dashboard (#309, Ultimate).
//   GET    /api/dashboard/jingle?serverId=...           what is stored, the switches, whether the plan has it
//   PUT    /api/dashboard/jingle?serverId=...           { name, data } a new jingle; data: the file as data URL or base64
//   DELETE /api/dashboard/jingle?serverId=...           deletes it
//   PUT    /api/dashboard/jingle/settings?serverId=...  { onSwitch, onHour }
//   GET    /api/dashboard/jingle/audio?serverId=...     the stored jingle as WAV, to listen in
//   POST   /api/dashboard/jingle/play?serverId=...      plays it now wherever OmniFM plays on the server
// Listening in and deleting stay possible after a downgrade; the rest is
// Ultimate. Uploads, deletions and the switches go into the owner audit.
import { getDb, isConnected } from "../../lib/db.js";
import { getCommonSecurityHeaders } from "../../lib/api-helpers.js";
import { recordOwnerAudit } from "../../lib/owner-audit-store.js";
import {
  JINGLE_MAX_MS,
  JINGLE_UPLOAD_MAX_BYTES,
  cleanJingleName,
  decodeUpload,
  normalizeJingleSettings,
  wavFromPcm,
} from "../../lib/jingle-audio.js";
import { prepareJingle } from "../../services/jingle-processing.js";
import { deleteGuildJingle, getGuildJingleInfo, getGuildJinglePcm, saveGuildJingle } from "../../jingles-store.js";
import { loadDashboardGuildSettings } from "./dashboard-guild-settings.js";
import { playingBots } from "./dashboard-playback.js";

const BASE = "/api/dashboard/jingle";
const SETTINGS_PATH = "/api/dashboard/jingle/settings";
const AUDIO_PATH = "/api/dashboard/jingle/audio";
const PLAY_PATH = "/api/dashboard/jingle/play";
const PATHS = new Set([BASE, SETTINGS_PATH, AUDIO_PATH, PLAY_PATH]);
// The file travels as base64 in JSON: a third more, plus the name.
const BODY_MAX_BYTES = Math.ceil((JINGLE_UPLOAD_MAX_BYTES * 4) / 3) + 64 * 1024;
const UPLOADS_PER_HOUR = 10;

/** Uploads per server and hour, in memory: every upload costs three ffmpeg runs. */
export function createJingleUploadLimiter({ limit = UPLOADS_PER_HOUR, windowMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const seen = new Map();
  return {
    take(key) {
      const at = now();
      const recent = (seen.get(key) || []).filter((time) => at - time < windowMs);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return { ok: false, retryAfterMs: windowMs - (at - recent[0]) };
      }
      recent.push(at);
      seen.set(key, recent);
      return { ok: true, retryAfterMs: 0 };
    },
  };
}

async function saveJingleSettings(guildId, settings) {
  if (!isConnected() || !getDb()) return false;
  await getDb().collection("guild_settings").updateOne({ guildId }, { $set: { guildId, jingle: settings } }, { upsert: true });
  return true;
}

/** The WAV, whole or the part a Range header asks for: Safari plays audio only from servers that can do both. */
function sendWav(req, res, wav) {
  const headers = { ...getCommonSecurityHeaders(), "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
  let start = 0;
  let end = wav.length - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else {
      start = Math.max(0, wav.length - Number(range[2]));
    }
    if (start > end) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${wav.length}` });
      res.end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${wav.length}`;
  }
  const body = wav.subarray(start, end + 1);
  res.writeHead(status, { ...headers, "Content-Length": String(body.length) });
  res.end(req.method === "HEAD" ? undefined : body);
}

const UPLOAD_ERRORS = {
  empty: [400, "Es kam keine Datei an.", "No file arrived."],
  invalid: [400, "Die Datei kam nicht vollständig an.", "The file did not arrive in full."],
  size: [413, "Die Datei ist zu groß (höchstens 6 MB).", "The file is too large (6 MB at most)."],
  format: [400, "Erlaubt sind MP3, WAV, OGG/Opus, FLAC, M4A und WebM.", "MP3, WAV, OGG/Opus, FLAC, M4A and WebM are allowed."],
  unreadable: [400, "Die Datei ließ sich nicht als Audio lesen.", "The file could not be read as audio."],
  "too-long": [400, "Der Jingle darf höchstens 10 Sekunden lang sein.", "The jingle may be 10 seconds long at most."],
  "too-short": [400, "Der Jingle muss mindestens eine halbe Sekunde lang sein.", "The jingle has to be at least half a second long."],
  silent: [400, "In der Datei ist nichts zu hören.", "There is nothing to hear in the file."],
  busy: [503, "Gerade werden andere Jingles verarbeitet. Bitte gleich noch einmal.", "Other jingles are being processed right now. Please try again in a moment."],
};

export function createDashboardJingleRouteHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getDashboardSession,
    getLocalizedJsonBodyError,
    languagePick,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
    store = { save: saveGuildJingle, info: getGuildJingleInfo, pcm: getGuildJinglePcm, remove: deleteGuildJingle },
    prepare = prepareJingle,
    loadSettings = loadDashboardGuildSettings,
    saveSettings = saveJingleSettings,
    audit = recordOwnerAudit,
    limiter = createJingleUploadLimiter(),
    findBots = playingBots,
  } = deps;

  return async function handleDashboardJingleRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes = [] } = context;
    const path = requestUrl.pathname;
    if (!PATHS.has(path)) return false;

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    const { session } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }
    const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guildInfo) {
      sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
      return true;
    }
    const guildId = guildInfo.id;
    const available = serverHasCapability(guildId, "jingles") === true;
    const actor = `dashboard:${String(session?.user?.id || session?.userId || "dashboard")}`;
    const fail = (status, de, en) => {
      sendJson(res, status, { error: languagePick(language, de, en) });
      return true;
    };
    const readBody = async (maxBytes) => {
      try {
        return { body: await readJsonBody({ maxBytes }) };
      } catch (err) {
        const status = Number(err?.status || 400);
        sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
        return null;
      }
    };
    const answer = async (extra = {}) => {
      const [jingle, settings] = await Promise.all([
        store.info(guildId).catch(() => null),
        loadSettings(guildId).catch(() => null),
      ]);
      sendJson(res, 200, {
        serverId: guildId,
        available,
        limits: { maxMs: JINGLE_MAX_MS, fileBytes: JINGLE_UPLOAD_MAX_BYTES },
        jingle,
        settings: normalizeJingleSettings(settings?.jingle),
        ...extra,
      });
      return true;
    };
    const ultimateOnly = () => fail(403, "Eigene Jingles gibt es mit Ultimate.", "Your own jingles come with Ultimate.");

    if (path === AUDIO_PATH) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, ["GET", "HEAD"]);
        return true;
      }
      const stored = await store.pcm(guildId).catch(() => null);
      if (!stored) return fail(404, "Es ist kein Jingle gespeichert.", "No jingle is stored.");
      sendWav(req, res, wavFromPcm(stored.pcm));
      return true;
    }

    if (path === PLAY_PATH) {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      if (!available) return ultimateOnly();
      const bots = await findBots(runtimes, guildId);
      if (!bots.length) return fail(409, "OmniFM spielt auf diesem Server gerade nichts.", "OmniFM is not playing anything on this server right now.");
      const results = await Promise.all(bots.map((bot) => Promise.resolve(bot.playJingleFromDashboard?.(guildId))
        .catch((err) => ({ ok: false, error: String(err?.message || err) }))));
      const played = results.filter((result) => result?.ok).length;
      if (played) {
        sendJson(res, 200, { ok: true, played });
        return true;
      }
      const errors = results.map((result) => result?.error);
      if (errors.includes("none")) return fail(404, "Es ist kein Jingle gespeichert.", "No jingle is stored.");
      if (errors.includes("busy")) return fail(409, "Der Jingle läuft gerade schon.", "The jingle is already playing.");
      if (errors.every((error) => error === "paused")) return fail(409, "Die Wiedergabe ist gerade pausiert.", "Playback is paused right now.");
      if (errors.every((error) => error === "unsupported")) {
        return fail(409, "Dieser Bot spielt ohne Mischpult (TRANSCODE_MODE=opus).", "This bot plays without the mixer (TRANSCODE_MODE=opus).");
      }
      return fail(502, "Der Bot hat nicht geantwortet. Später noch einmal versuchen.", "The bot did not answer. Try again later.");
    }

    if (path === SETTINGS_PATH) {
      if (req.method !== "PUT") {
        methodNotAllowed(res, ["PUT"]);
        return true;
      }
      if (!available) return ultimateOnly();
      const read = await readBody(4096);
      if (!read) return true;
      const current = normalizeJingleSettings((await loadSettings(guildId).catch(() => null))?.jingle);
      const next = {
        onSwitch: typeof read.body?.onSwitch === "boolean" ? read.body.onSwitch : current.onSwitch,
        onHour: typeof read.body?.onHour === "boolean" ? read.body.onHour : current.onHour,
      };
      if (!(await saveSettings(guildId, next))) return fail(503, "Speichern geht gerade nicht.", "Saving is not possible right now.");
      for (const runtime of runtimes) runtime?.invalidateGuildSettingsCache?.(guildId);
      const word = (on) => (on ? "an" : "aus");
      audit({
        action: "guild.jingle.settings",
        status: "success",
        actor,
        target: guildId,
        summary: `Jingle: Senderwechsel ${word(next.onSwitch)}, volle Stunde ${word(next.onHour)}`,
        metadata: next,
      });
      return answer({ success: true });
    }

    if (req.method === "GET") return answer();

    if (req.method === "DELETE") {
      const removed = await store.remove(guildId).catch(() => false);
      if (removed) {
        audit({ action: "guild.jingle.delete", status: "success", actor, target: guildId, summary: "Jingle gelöscht", metadata: {} });
      }
      return answer({ success: true });
    }

    if (req.method !== "PUT") {
      methodNotAllowed(res, ["GET", "PUT", "DELETE"]);
      return true;
    }
    if (!available) return ultimateOnly();
    const allowed = limiter.take(guildId);
    if (!allowed.ok) {
      const minutes = Math.max(1, Math.ceil(allowed.retryAfterMs / 60_000));
      return fail(429, `Zu viele Uploads in einer Stunde. Bitte in ${minutes} Minuten noch einmal.`, `Too many uploads in an hour. Please try again in ${minutes} minutes.`);
    }
    const read = await readBody(BODY_MAX_BYTES);
    if (!read) return true;
    const upload = decodeUpload(read.body?.data);
    const prepared = upload.ok ? await prepare(upload.file) : upload;
    if (!prepared.ok) {
      const [status, de, en] = UPLOAD_ERRORS[prepared.error] || UPLOAD_ERRORS.unreadable;
      return fail(status, de, en);
    }
    const name = cleanJingleName(read.body?.name);
    const saved = await store.save(guildId, { pcm: prepared.pcm, durationMs: prepared.durationMs, name }).catch(() => ({ ok: false }));
    if (!saved.ok) return fail(503, "Speichern geht gerade nicht.", "Saving is not possible right now.");
    const seconds = (prepared.durationMs / 1000).toFixed(1).replace(".", ",");
    audit({
      action: "guild.jingle.upload",
      status: "success",
      actor,
      target: guildId,
      summary: `Jingle hochgeladen: ${name} (${seconds} s)`,
      metadata: { durationMs: prepared.durationMs, bytes: prepared.pcm.length },
    });
    return answer({ success: true });
  };
}
