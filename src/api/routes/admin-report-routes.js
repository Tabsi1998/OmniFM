// Owner API: the reports from Discord (#436, #437). GET lists the open ones
// (with ?all=1 the decided ones too) with links to the card in the team
// channel and to the forum post. Deciding happens on the card in Discord;
// the owner console shows where things stand. The person's Discord ID is
// never shown here, only the name, and only when they asked to hear back.
import { getDb, isConnected } from "../../lib/db.js";
import { listProblemReports } from "../../problem-reports-store.js";

const iso = (value) => (value instanceof Date ? value.toISOString() : value || null);
const discordLink = (...parts) => (parts.every(Boolean) ? `https://discord.com/channels/${parts.join("/")}` : null);

/** What the owner console shows of a report. */
export function ownerReportView(doc) {
  const text = String(doc.text || "");
  return {
    id: doc._id,
    kind: doc.kind,
    text: text.length > 300 ? `${text.slice(0, 299)}…` : text,
    source: doc.source || "command",
    status: doc.status || "new",
    createdAt: iso(doc.createdAt),
    decidedAt: iso(doc.decidedAt),
    decidedBy: doc.decidedBy?.name || null,
    server: doc.guild?.name || null,
    station: doc.station?.name || null,
    plan: doc.plan || "free",
    public: doc.consent?.public === true,
    from: doc.reporter?.name || null,
    delivered: doc.dispatch?.state === "posted",
    teamLink: discordLink(doc.team?.guildId, doc.team?.channelId, doc.team?.messageId),
    forumLink: discordLink(doc.team?.guildId, doc.forum?.threadId),
  };
}

export function createAdminReportRoutes({ sendJson, methodNotAllowed }) {
  return async function handleAdminReportRoutes(context) {
    const { req, res, requestUrl } = context;
    if (requestUrl?.pathname !== "/api/admin/reports") return false;
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }
    const includeClosed = requestUrl.searchParams.get("all") === "1";
    const rows = isConnected() && getDb() ? await listProblemReports({ includeClosed }) : [];
    sendJson(res, 200, {
      reports: rows.map((row) => ownerReportView(row)),
      open: rows.filter((row) => ["new", "in-progress"].includes(row.status)).length,
    });
    return true;
  };
}
