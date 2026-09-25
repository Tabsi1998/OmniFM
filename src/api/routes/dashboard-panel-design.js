// The look of the now-playing panel per server (#281).
//   GET  /api/dashboard/panel-design?serverId=...          design, buttons, preview
//   PUT  /api/dashboard/panel-design?serverId=...          { design } saves (Pro and Ultimate)
//   POST /api/dashboard/panel-design/preview?serverId=...  { design } preview only, saves nothing
// The preview is the real panel (panel-preview.js), so everyone with the
// dashboard sees what their choice looks like; saving needs Premium.
import { getTier } from "../../core/entitlements.js";
import { recordOwnerAudit } from "../../lib/owner-audit-store.js";
import { updateGuildSettings } from "../../lib/guild-settings.js";
import {
  PANEL_DESIGN_BUTTONS,
  canCustomizePanel,
  isDefaultPanelDesign,
  normalizePanelDesign,
} from "../../lib/panel-design.js";
import { buildPanelPreview } from "../../bot/now-playing/panel-preview.js";
import { loadDashboardGuildSettings } from "./dashboard-guild-settings.js";

const BODY_MAX_BYTES = 16 * 1024;

export function createDashboardPanelDesignRouteHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getDashboardSession,
    getLocalizedJsonBodyError,
    languagePick,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    sendJson,
    sendLocalizedError,
    saveSettings = updateGuildSettings,
    loadSettings = loadDashboardGuildSettings,
  } = deps;

  function commanderOf(runtimes) {
    return (Array.isArray(runtimes) ? runtimes : []).find((runtime) => runtime?.role === "commander") || null;
  }

  /** The example panel as the server would get it: its language, a worker's emojis, its favourites. */
  async function previewFor(runtimes, guildId, design, fallbackLanguage) {
    const commander = commanderOf(runtimes);
    const tier = getTier(guildId);
    const worker = commander?.workerManager?.getInvitedWorkers?.(guildId, tier)?.[0] || null;
    await commander?.loadGuildSettingsCached?.(guildId).catch(() => null);
    return buildPanelPreview({
      design,
      language: commander?.resolveGuildLanguage?.(guildId) || fallbackLanguage,
      applicationId: worker?.getApplicationId?.() || commander?.getApplicationId?.() || null,
      planTier: tier,
      favorites: commander?.getVisibleFavoriteStations?.(guildId) || null,
      workerName: worker?.config?.name || "OmniFM",
    });
  }

  async function readDesign(req, res, readJsonBody, language) {
    try {
      const body = await readJsonBody({ maxBytes: BODY_MAX_BYTES });
      return normalizePanelDesign(body?.design);
    } catch (err) {
      const status = Number(err?.status || 400);
      sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
      return null;
    }
  }

  return async function handleDashboardPanelDesignRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;
    const isPreview = requestUrl.pathname === "/api/dashboard/panel-design/preview";
    if (requestUrl.pathname !== "/api/dashboard/panel-design" && !isPreview) return false;

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
    const canSave = canCustomizePanel(getTier(guildId));

    if (isPreview) {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      const design = await readDesign(req, res, readJsonBody, language);
      if (!design) return true;
      sendJson(res, 200, { preview: await previewFor(runtimes, guildId, design, language) });
      return true;
    }

    if (req.method === "GET") {
      const settings = await loadSettings(guildId);
      const design = normalizePanelDesign(settings?.panelDesign);
      sendJson(res, 200, {
        serverId: guildId,
        canSave,
        design,
        buttons: PANEL_DESIGN_BUTTONS.map((entry) => ({ key: entry.key, label: languagePick(language, entry.de, entry.en) })),
        preview: await previewFor(runtimes, guildId, design, language),
      });
      return true;
    }
    if (req.method !== "PUT") {
      methodNotAllowed(res, ["GET", "PUT"]);
      return true;
    }
    if (!canSave) {
      sendLocalizedError(res, 403, language, "Das Panel-Design gibt es mit Pro und Ultimate.", "The panel design comes with Pro and Ultimate.");
      return true;
    }
    const design = await readDesign(req, res, readJsonBody, language);
    if (!design) return true;
    // The standard look is stored as nothing, so the field only exists when someone changed it.
    const result = isDefaultPanelDesign(design)
      ? await saveSettings(guildId, {}, { unset: ["panelDesign"] })
      : await saveSettings(guildId, { panelDesign: design });
    if (!result?.ok) {
      sendLocalizedError(res, 503, language, "Speichern ging gerade nicht, bitte gleich noch einmal.", "Saving failed right now, please try again in a moment.");
      return true;
    }
    // Panels in this process update at their next refresh; workers elsewhere within 30 seconds.
    for (const runtime of Array.isArray(runtimes) ? runtimes : []) runtime?.invalidateGuildSettingsCache?.(guildId);
    const actor = String(session?.user?.id || session?.userId || "dashboard");
    recordOwnerAudit({
      action: "guild.panelDesign.update",
      status: "success",
      actor: `dashboard:${actor}`,
      target: guildId,
      summary: "Panel-Design geändert",
      metadata: { design },
    });
    sendJson(res, 200, { success: true, serverId: guildId, canSave, design, preview: await previewFor(runtimes, guildId, design, language) });
    return true;
  };
}
