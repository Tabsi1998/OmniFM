// The dashboard's "Problem melden" (#436): the same way as /problem in
// Discord. POST /api/dashboard/reports?serverId=... { kind, text, consent }.
// The report is kept; the commander posts it to the private team channel, at
// once when it runs in this process (production), else at its next round.
// Without a team channel it stays an incident in the owner console. The
// answer is a code ({ ok } or { ok: false, reason }), so that the dashboard
// says it in the visitor's language.
import { getTier } from "../../core/entitlements.js";
import { REPORT_COOLDOWN_MS, REPORT_TEXT_MIN, cleanReportText, isReportKind } from "../../lib/problem-reports.js";
import { claimReport, createProblemReport } from "../../problem-reports-store.js";
import { notePostFailure, postReportToTeam, recordReportIncident, reportSettings, ringReportsDoorbell } from "../../services/problem-reports.js";

// One report per person and five minutes, like in Discord.
const lastReportAt = new Map();

export function createDashboardReportsRouteHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getDashboardSession,
    getLocalizedJsonBodyError,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    sendJson,
    sendLocalizedError,
  } = deps;

  return async function handleDashboardReportsRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;
    if (requestUrl.pathname !== "/api/dashboard/reports") return false;
    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }
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
    let body;
    try {
      body = await readJsonBody({ maxBytes: 16 * 1024 });
    } catch (err) {
      const status = Number(err?.status || 400);
      sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
      return true;
    }
    const kind = String(body?.kind || "");
    const text = cleanReportText(body?.text);
    if (!isReportKind(kind) || text.length < REPORT_TEXT_MIN) {
      sendJson(res, 400, { ok: false, reason: "text" });
      return true;
    }
    const userId = String(session.user?.id || "");
    const now = Date.now();
    if (userId && now - (lastReportAt.get(userId) || 0) < REPORT_COOLDOWN_MS) {
      sendJson(res, 200, { ok: false, reason: "cooldown" });
      return true;
    }
    if (userId) lastReportAt.set(userId, now);

    const report = {
      kind,
      text,
      source: "dashboard",
      consent: { public: body?.consent?.public === true, notify: body?.consent?.notify === true },
      language: language === "de" ? "de" : "en",
      guild: { id: guildInfo.id, name: guildInfo.name },
      plan: getTier(guildInfo.id),
      reporter: { userId, name: session.user?.globalName || session.user?.username || "" },
    };
    const settings = reportSettings();
    const created = settings.teamChannelId
      ? await createProblemReport(report, { now }).catch((err) => ({ error: String(err?.message || err) }))
      : { error: "unconfigured" };
    if (!created.report) {
      // Nothing to Discord; the owner console keeps it.
      await recordReportIncident(report, created.error);
      sendJson(res, 200, { ok: false, reason: "unavailable" });
      return true;
    }
    const commander = (Array.isArray(runtimes) ? runtimes : []).find((runtime) => runtime?.role === "commander" && runtime.client);
    let waiting = false;
    if (commander) {
      const claimed = await claimReport(created.report._id, { now }).catch(() => null);
      if (claimed) {
        const result = await postReportToTeam(commander.client, claimed, { settings, now })
          .catch((err) => ({ ok: false, reason: "send", error: String(err?.message || err) }));
        if (!result.ok) {
          waiting = true;
          await notePostFailure(claimed, result).catch(() => null);
        }
      }
    } else {
      ringReportsDoorbell();
    }
    sendJson(res, 200, { ok: true, waiting });
    return true;
  };
}
