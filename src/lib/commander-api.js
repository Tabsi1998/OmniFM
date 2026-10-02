// The commander's Node API behind the public entry (#195, #290).
//
// src/entrypoints/api.js answers :8001 and forwards /api/auth, /api/dashboard
// and the other paths that need the running bots to the Node API of the
// commander. That one listens on 127.0.0.1 only and trusts the forwarded
// client address of the local entry. Since #291 there is no other public
// entry: OMNIFM_PUBLIC_BACKEND and OMNIFM_DASHBOARD_BACKEND of older
// installations are ignored.

const DEFAULT_NODE_API_PORT = 8002;
const LOOPBACK_PROXIES = ["127.0.0.1", "::1"];

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
 * Sets the environment of the commander for its Node API behind the public
 * entry. Returns the port, for the start log.
 */
function configureCommanderApi(env = process.env, { redirectUri = "" } = {}) {
  const port = resolveNodeApiPort(env);
  env.WEB_SERVER_ENABLED = "1";
  // Only the public entry on the same machine may reach it, whatever backend/.env says.
  env.WEB_BIND = "127.0.0.1";
  env.WEB_INTERNAL_PORT = String(port);
  env.TRUST_PROXY_HEADERS = "1";
  const trusted = new Set(String(env.TRUSTED_PROXY_IPS || "").split(",").map((item) => item.trim()).filter(Boolean));
  for (const address of LOOPBACK_PROXIES) trusted.add(address);
  env.TRUSTED_PROXY_IPS = [...trusted].join(",");
  // After the Discord login users go back to PUBLIC_WEB_URL; without one, to
  // the origin of the OAuth redirect URI.
  if (!originOf(env.PUBLIC_WEB_URL) && originOf(redirectUri)) {
    env.PUBLIC_WEB_URL = originOf(redirectUri);
  }
  return { port };
}

export {
  DEFAULT_NODE_API_PORT,
  configureCommanderApi,
  resolveNodeApiPort,
};
