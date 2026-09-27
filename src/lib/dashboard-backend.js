// Which process answers what (#195, #290).
//
// OMNIFM_PUBLIC_BACKEND picks the public entry on :8001: "node" (default since
// #290) is src/entrypoints/api.js, "fastapi" the previous Uvicorn service,
// kept as the way back. Either way the public entry forwards /api/auth,
// /api/dashboard and the other paths that need the running bots to the Node
// API of the commander. That one listens on 127.0.0.1 only and trusts the
// forwarded client address of the local entry.
//
// OMNIFM_DASHBOARD_BACKEND only matters with the FastAPI entry: "fastapi"
// lets FastAPI's own dashboard routes answer and keeps the commander API off.

const DEFAULT_NODE_API_PORT = 8002;
const LOOPBACK_PROXIES = ["127.0.0.1", "::1"];

function resolvePublicBackend(env = process.env) {
  return String(env.OMNIFM_PUBLIC_BACKEND || "node").trim().toLowerCase() === "fastapi" ? "fastapi" : "node";
}

function resolveDashboardBackend(env = process.env) {
  // The Node entry has no dashboard of its own: the commander always answers it.
  if (resolvePublicBackend(env) === "node") return "node";
  return String(env.OMNIFM_DASHBOARD_BACKEND || "fastapi").trim().toLowerCase() === "node" ? "node" : "fastapi";
}

function resolveNodeApiPort(env = process.env) {
  const parsed = Number.parseInt(String(env.OMNIFM_NODE_API_PORT || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_NODE_API_PORT;
}

function originOf(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/**
 * Sets the environment of the bot process for the chosen dashboard backend.
 * Returns what it decided, for the start log.
 */
function configureDashboardBackend(env = process.env, { redirectUri = "" } = {}) {
  if (resolveDashboardBackend(env) !== "node") {
    env.WEB_SERVER_ENABLED = "0";
    return { backend: "fastapi", enabled: false };
  }

  const port = resolveNodeApiPort(env);
  env.WEB_SERVER_ENABLED = "1";
  // Only the public entry on the same machine may reach it, whatever backend/.env says.
  env.WEB_BIND = "127.0.0.1";
  env.WEB_INTERNAL_PORT = String(port);
  env.TRUST_PROXY_HEADERS = "1";
  const trusted = new Set(String(env.TRUSTED_PROXY_IPS || "").split(",").map((item) => item.trim()).filter(Boolean));
  for (const address of LOOPBACK_PROXIES) trusted.add(address);
  env.TRUSTED_PROXY_IPS = [...trusted].join(",");
  // FastAPI sends users back to PUBLIC_WEB_URL after the Discord login and
  // falls back to the origin of the OAuth redirect URI; the Node API does the same.
  if (!originOf(env.PUBLIC_WEB_URL) && originOf(redirectUri)) {
    env.PUBLIC_WEB_URL = originOf(redirectUri);
  }
  return { backend: "node", enabled: true, port, publicBackend: resolvePublicBackend(env) };
}

export {
  DEFAULT_NODE_API_PORT,
  configureDashboardBackend,
  resolveDashboardBackend,
  resolveNodeApiPort,
  resolvePublicBackend,
};
