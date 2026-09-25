// The bot's own look per server in the dashboard (#280, Ultimate).
//   GET  /api/dashboard/bot-profile?serverId=...  the workers on the server and their look
//   PUT  /api/dashboard/bot-profile?serverId=...  { slot, avatar?, banner?, bio? } or { slot, reset: true }
// Every change goes into the owner audit.
import { getDb, isConnected } from "../../lib/db.js";
import { getTier } from "../../core/entitlements.js";
import { recordOwnerAudit } from "../../lib/owner-audit-store.js";
import { loadDashboardGuildSettings } from "./dashboard-guild-settings.js";
import {
  BOT_PROFILE_AVATAR_MAX_BYTES,
  BOT_PROFILE_BANNER_MAX_BYTES,
  BOT_PROFILE_BIO_MAX,
  createProfileChangeLimiter,
  summarizeProfileChange,
  validateBotProfileInput,
} from "../../lib/bot-profile.js";

const BODY_MAX_BYTES = 8 * 1024 * 1024;

export function createDashboardBotProfileRouteHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getDashboardSession,
    getLocalizedJsonBodyError,
    languagePick,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    sendJson,
    sendLocalizedError,
    limiter = createProfileChangeLimiter(),
  } = deps;

  function commanderOf(runtimes) {
    return (Array.isArray(runtimes) ? runtimes : []).find((runtime) => runtime?.role === "commander") || null;
  }

  function describeWorkers(commander, guildId, profiles) {
    const workers = commander?.workerManager?.getInvitedWorkers?.(guildId, getTier(guildId)) || [];
    return workers.map((worker) => {
      const slot = Number(commander.workerManager.getWorkerSlot?.(worker) || worker?.workerSlot || worker?.config?.index || 0);
      const stored = profiles?.[slot] || null;
      return {
        slot,
        name: worker?.config?.name || `Worker ${slot}`,
        avatarUrl: worker?.getGuildBotAvatarUrl?.(guildId) || null,
        custom: {
          avatar: stored?.avatar === true,
          banner: stored?.banner === true,
          bio: stored?.bio || "",
        },
        updatedAt: stored?.updatedAt || null,
      };
    }).filter((worker) => worker.slot > 0);
  }

  return async function handleDashboardBotProfileRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;
    if (requestUrl.pathname !== "/api/dashboard/bot-profile") return false;

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
    const available = getTier(guildId) === "ultimate";
    const commander = commanderOf(runtimes);
    const settings = await loadDashboardGuildSettings(guildId);
    const profiles = settings?.botProfiles && typeof settings.botProfiles === "object" ? settings.botProfiles : {};

    if (req.method === "GET") {
      sendJson(res, 200, {
        serverId: guildId,
        available,
        limits: { avatarBytes: BOT_PROFILE_AVATAR_MAX_BYTES, bannerBytes: BOT_PROFILE_BANNER_MAX_BYTES, bioLength: BOT_PROFILE_BIO_MAX },
        workers: describeWorkers(commander, guildId, profiles),
      });
      return true;
    }
    if (req.method !== "PUT") {
      methodNotAllowed(res, ["GET", "PUT"]);
      return true;
    }
    if (!available) {
      sendLocalizedError(res, 403, language, "Eigenes Bot-Aussehen gibt es mit Ultimate.", "A custom bot look comes with Ultimate.");
      return true;
    }

    let body;
    try {
      body = await readJsonBody({ maxBytes: BODY_MAX_BYTES });
    } catch (err) {
      const status = Number(err?.status || 400);
      sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
      return true;
    }
    const input = validateBotProfileInput(body);
    if (!input.ok) {
      const messages = {
        slot: ["Unbekannter Worker.", "Unknown worker."],
        invalid: ["Das Bild ließ sich nicht lesen.", "The picture could not be read."],
        format: ["Erlaubt sind PNG, JPG, GIF und WebP.", "PNG, JPG, GIF and WebP are allowed."],
        size: input.field === "bio"
          ? [`Die Bio darf höchstens ${BOT_PROFILE_BIO_MAX} Zeichen haben.`, `The bio may have at most ${BOT_PROFILE_BIO_MAX} characters.`]
          : ["Das Bild ist zu groß (Avatar 2 MB, Banner 4 MB).", "The picture is too large (avatar 2 MB, banner 4 MB)."],
        empty: ["Es gibt nichts zu ändern.", "There is nothing to change."],
      };
      const [de, en] = messages[input.error] || messages.invalid;
      sendJson(res, 400, { error: languagePick(language, de, en), field: input.field });
      return true;
    }

    const worker = commander?.workerManager?.getWorkerByIndex?.(input.slot, { prefer: "slot" }) || null;
    const invited = commander?.workerManager?.getInvitedWorkers?.(guildId, getTier(guildId)) || [];
    if (!worker || !invited.includes(worker)) {
      sendLocalizedError(res, 404, language, "Dieser Worker ist nicht auf dem Server.", "This worker is not on the server.");
      return true;
    }
    const allowed = limiter.take(`${guildId}:${input.slot}`);
    if (!allowed.ok) {
      const minutes = Math.max(1, Math.ceil(allowed.retryAfterMs / 60_000));
      sendJson(res, 429, {
        error: languagePick(language, `Discord erlaubt nur wenige Änderungen hintereinander. Bitte in ${minutes} Minuten noch einmal.`, `Discord allows only a few changes in a row. Please try again in ${minutes} minutes.`),
      });
      return true;
    }

    const result = await worker.applyGuildBotProfile(guildId, input.changes);
    const actor = String(session?.user?.id || session?.userId || "dashboard");
    recordOwnerAudit({
      action: input.reset ? "guild.botProfile.reset" : "guild.botProfile.update",
      status: result?.ok ? "success" : "failed",
      actor: `dashboard:${actor}`,
      target: `${guildId}/worker-${input.slot}`,
      summary: input.reset ? "Bot-Aussehen zurückgesetzt" : `Bot-Aussehen geändert: ${Object.keys(input.changes).join(", ")}`,
      metadata: { fields: Object.keys(input.changes), error: result?.ok ? null : result?.error || null },
    });
    if (!result?.ok) {
      sendJson(res, 502, {
        error: languagePick(language, `Discord hat die Änderung abgelehnt: ${result?.error || "unbekannt"}`, `Discord refused the change: ${result?.error || "unknown"}`),
      });
      return true;
    }

    const next = input.reset ? null : summarizeProfileChange(profiles[input.slot] || {}, input.changes, { by: actor });
    if (isConnected() && getDb()) {
      const path = `botProfiles.${input.slot}`;
      await getDb().collection("guild_settings").updateOne(
        { guildId },
        next ? { $set: { guildId, [path]: next } } : { $unset: { [path]: "" } },
        { upsert: Boolean(next) }
      );
      // No profile left: the field goes, so the downgrade check skips the server.
      await getDb().collection("guild_settings").updateOne({ guildId, botProfiles: {} }, { $unset: { botProfiles: "" } });
    }
    const updatedProfiles = { ...profiles };
    if (next) updatedProfiles[input.slot] = next;
    else delete updatedProfiles[input.slot];
    sendJson(res, 200, {
      success: true,
      serverId: guildId,
      available,
      workers: describeWorkers(commander, guildId, updatedProfiles),
    });
    return true;
  };
}
