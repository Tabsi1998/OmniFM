// The Discord Activity in the voice channel (#308, prototype).
//   GET  /api/activity/config  the app's client ID for the Embedded App SDK
//   POST /api/activity/token   { code } from the SDK's authorize: the access token for the
//                              SDK's authenticate, and a session for this Activity (one hour)
//   GET  /api/activity/now?guildId=&channelId=   what plays in that voice channel and who
//                              listens there; only for someone in that voice channel right now
// The app is the commander's (the same as the dashboard's login). Sessions
// live in memory as hashes only; nothing about the person is stored.
import { createHash, randomBytes } from "node:crypto";

import { log } from "../../lib/logging.js";
import { stationImagePath } from "../../lib/public-images.js";
import { collectChannelNowPlaying } from "../helpers/runtime-status.js";

const API = "https://discord.com/api/v10";
const SESSION_MS = 60 * 60 * 1000;
const SESSION_LIMIT = 5000;
const LISTENER_LIMIT = 30;
const REFRESH_MS = 10_000;
const SNOWFLAKE = /^\d{17,22}$/;

const hashOf = (token) => createHash("sha256").update(String(token)).digest("hex");

/** The Activity's own address inside Discord: https://<client id>.discordsays.com. */
export function activityOrigin(env = process.env) {
  const clientId = String(env.DISCORD_CLIENT_ID || "").trim();
  return SNOWFLAKE.test(clientId) ? `https://${clientId}.discordsays.com` : "";
}

/** A request of the Activity, from its own address inside Discord, to /api/activity. */
export function isActivityRequest(req, pathname, env = process.env) {
  const origin = activityOrigin(env);
  return Boolean(origin) && String(pathname || "").startsWith("/api/activity/") && String(req?.headers?.origin || "").trim() === origin;
}

/**
 * @param {{ sendJson: Function, methodNotAllowed: Function, fetchImpl?: typeof fetch,
 *   now?: () => number, env?: Record<string, string | undefined> }} deps
 */
export function createActivityRoutes({ sendJson, methodNotAllowed, fetchImpl = fetch, now = () => Date.now(), env = process.env }) {
  /** @type {Map<string, { userId: string, expiresAt: number }>} hash of the session -> who */
  const sessions = new Map();

  function openSession(userId) {
    const at = now();
    for (const [hash, session] of sessions) if (session.expiresAt <= at) sessions.delete(hash);
    while (sessions.size >= SESSION_LIMIT) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString("base64url");
    sessions.set(hashOf(token), { userId, expiresAt: at + SESSION_MS });
    return token;
  }

  function sessionOf(req) {
    const header = String(req.headers.authorization || "");
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1] || "";
    const session = token ? sessions.get(hashOf(token)) : null;
    if (!session || session.expiresAt <= now()) return null;
    return session;
  }

  async function exchange(code) {
    const response = await fetchImpl(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: String(env.DISCORD_CLIENT_ID || ""),
        client_secret: String(env.DISCORD_CLIENT_SECRET || ""),
        grant_type: "authorization_code",
        code: String(code || ""),
      }),
    });
    if (!response.ok) throw new Error(`discord_token_failed:${response.status}`);
    const accessToken = String((await response.json())?.access_token || "");
    if (!accessToken) throw new Error("discord_token_missing");
    const me = await fetchImpl(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!me.ok) throw new Error(`discord_user_failed:${me.status}`);
    const userId = String((await me.json())?.id || "");
    if (!SNOWFLAKE.test(userId)) throw new Error("discord_user_missing");
    return { accessToken, userId };
  }

  return async function handleActivityRoutes({ req, res, requestUrl, readJsonBody, runtimes = [] }) {
    const path = requestUrl.pathname;
    if (!path.startsWith("/api/activity/")) return false;
    const clientId = String(env.DISCORD_CLIENT_ID || "").trim();
    const configured = SNOWFLAKE.test(clientId) && Boolean(String(env.DISCORD_CLIENT_SECRET || "").trim());

    if (path === "/api/activity/config") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      if (!configured) {
        sendJson(res, 503, { error: "not_configured" });
        return true;
      }
      sendJson(res, 200, { clientId });
      return true;
    }

    if (path === "/api/activity/token") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      if (!configured) {
        sendJson(res, 503, { error: "not_configured" });
        return true;
      }
      let body;
      try {
        body = await readJsonBody({ maxBytes: 4096 });
      } catch {
        sendJson(res, 400, { error: "bad_request" });
        return true;
      }
      const code = String(body?.code || "").trim();
      if (!code || code.length > 200) {
        sendJson(res, 400, { error: "no_code" });
        return true;
      }
      try {
        const { accessToken, userId } = await exchange(code);
        sendJson(res, 200, { access_token: accessToken, session: openSession(userId), expiresIn: SESSION_MS / 1000 });
      } catch (err) {
        log("WARN", `[activity] Anmeldung fehlgeschlagen: ${err?.message || err}`);
        sendJson(res, 502, { error: "discord_refused" });
      }
      return true;
    }

    if (path === "/api/activity/now") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const session = sessionOf(req);
      if (!session) {
        sendJson(res, 401, { error: "no_session" });
        return true;
      }
      const guildId = String(requestUrl.searchParams.get("guildId") || "");
      const channelId = String(requestUrl.searchParams.get("channelId") || "");
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) {
        sendJson(res, 400, { error: "bad_channel" });
        return true;
      }
      const commander = (Array.isArray(runtimes) ? runtimes : []).find((runtime) => runtime?.role === "commander") || null;
      const guild = commander?.client?.guilds?.cache?.get(guildId) || null;
      if (!guild) {
        sendJson(res, 404, { error: "no_guild" });
        return true;
      }
      // Only someone in this voice channel right now sees what plays there.
      if (String(guild.voiceStates?.cache?.get(session.userId)?.channelId || "") !== channelId) {
        sendJson(res, 403, { error: "not_in_channel" });
        return true;
      }
      const channel = guild.channels?.cache?.get(channelId) || null;
      const listeners = [];
      for (const member of channel?.members?.values?.() || []) {
        if (member?.user?.bot) continue;
        listeners.push({
          id: String(member.id),
          name: String(member.displayName || member.user?.globalName || member.user?.username || "?"),
          avatarUrl: typeof member.displayAvatarURL === "function" ? member.displayAvatarURL({ size: 64, extension: "png" }) : null,
        });
        if (listeners.length >= LISTENER_LIMIT) break;
      }
      const streams = collectChannelNowPlaying(runtimes, guildId, channelId).map((stream) => ({
        ...stream,
        logoUrl: stream.stationKey ? stationImagePath(stream.stationKey) : null,
      }));
      sendJson(res, 200, {
        guildName: String(guild.name || ""),
        channelName: String(channel?.name || ""),
        streams,
        listeners,
        refreshMs: REFRESH_MS,
      });
      return true;
    }

    sendJson(res, 404, { error: "not_found" });
    return true;
  };
}
