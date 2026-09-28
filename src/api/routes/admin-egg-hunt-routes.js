// Owner API: the Easter egg hunt (#429). GET /api/admin/egg-hunt lists per
// server the top three of the last year with eggs (?year=2027 for another),
// prepared for a reward later, for example a free month. Only the server,
// the Discord IDs and the counts; nothing is decided here.
import { eggTopByServer } from "../../easter-eggs-store.js";

export function createAdminEggHuntRoutes({ sendJson, methodNotAllowed }) {
  return async function handleAdminEggHuntRoutes(context) {
    const { req, res, requestUrl } = context;
    if (requestUrl?.pathname !== "/api/admin/egg-hunt") return false;
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }
    const asked = Number.parseInt(requestUrl.searchParams.get("year") || "", 10);
    const { year, servers } = await eggTopByServer({ year: asked >= 2026 && asked <= 2200 ? asked : null });
    sendJson(res, 200, {
      year,
      servers: servers.map((server) => ({
        guildId: server.guildId,
        name: server.name || null,
        finders: server.finders,
        eggs: server.eggs,
        top: server.top.map((row) => ({ userId: row.userId, count: row.count, rank: row.rank })),
      })),
    });
    return true;
  };
}
