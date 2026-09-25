// ============================================================
// OmniFM: which web address is the public one
// ============================================================
// Installations carry addresses that only work inside the house:
// start.sh writes http://<LAN-IP>:8001, .env.example has localhost:8081.
// Links that leave the server (the Discord login, share links, dashboard
// buttons in Discord) need the public address, so a public candidate always
// wins over localhost, 127.x, 10.x, 172.16-31.x, 192.168.x and *.local.
// Only when no candidate is public (development, a pure LAN setup) the
// first local one is used.

/** "https://host[:port]" of an http(s) URL, else "". */
export function originOf(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/** WEB_DOMAIN ("omnifm.xyz", also with scheme or path) as https origin, else "". */
export function webDomainOrigin(rawDomain) {
  const domain = String(rawDomain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!domain || /[\s\\]/.test(domain)) return "";
  return originOf(`https://${domain}`);
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127);
}

/** Can a browser anywhere reach this origin? */
export function isPublicOrigin(origin) {
  const normalized = originOf(origin);
  if (!normalized) return false;
  const hostname = new URL(normalized).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  if (!hostname.includes(".") && !hostname.includes(":")) return false;
  if (isPrivateIpv4(hostname)) return false;
  if (hostname.includes(":")) {
    // IPv6: loopback, unique local (fc00::/7), link local (fe80::/10)
    if (hostname === "::1" || /^f[cd]/.test(hostname) || /^fe[89ab]/.test(hostname)) return false;
  }
  return true;
}

/** The first public origin of the candidates, else the first valid one, else "". */
export function pickPublicOrigin(candidates) {
  const origins = (candidates || []).map(originOf).filter(Boolean);
  return origins.find(isPublicOrigin) || origins[0] || "";
}

/**
 * Start of the bot: when PUBLIC_WEB_URL only works inside the house (the
 * LAN address start.sh writes) and a public address is known (WEB_DOMAIN,
 * the redirect URI stored in the owner console), links use the public one.
 * Returns { from, to } when it changed something, else null.
 */
export function preferPublicWebsiteUrl(env = process.env, { storedRedirectUri = "" } = {}) {
  const current = originOf(env.PUBLIC_WEB_URL);
  if (current && isPublicOrigin(current)) return null;
  const candidate = pickPublicOrigin([webDomainOrigin(env.WEB_DOMAIN), storedRedirectUri, env.DISCORD_REDIRECT_URI]);
  if (!candidate || !isPublicOrigin(candidate)) return null;
  env.PUBLIC_WEB_URL = candidate;
  return { from: current || "", to: candidate };
}
