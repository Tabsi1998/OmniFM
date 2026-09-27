// ============================================================
// OmniFM: the public entry forwards what needs the running bots (#290)
// ============================================================
// The dashboard, the Discord login, share cards, station logos and the owner
// cockpit read the bots' Discord caches, so the Node API of the commander
// answers them (127.0.0.1:8002). The public entry on :8001 passes those
// requests on unchanged, like FastAPI's proxy_to_node_api() did (#195): the
// caller's address is appended to X-Forwarded-For so the commander limits the
// browser and not this process, a same-origin Origin is dropped (the
// commander's CSRF header still guards every change), a foreign one is passed
// on so the commander rejects it. Bodies and answers are streamed as they are,
// every Set-Cookie included.
import http from "node:http";
import net from "node:net";

export const RUNTIME_PREFIXES = Object.freeze(["/api/auth", "/api/dashboard", "/api/share", "/api/station-logos", "/api/owner"]);
export const RUNTIME_UNAVAILABLE = "Das Dashboard startet gerade neu. Bitte in ein paar Sekunden erneut versuchen.";

// Hop-by-hop headers stay on each connection. Length and encoding are kept:
// the bytes pass through untouched.
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "trailers",
  "transfer-encoding", "upgrade", "host",
]);

export function isRuntimePath(pathname) {
  return RUNTIME_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** build_node_proxy_headers(): the request headers for the commander. */
export function forwardRequestHeaders(headers, { clientIp = "", scheme = "http" } = {}) {
  const forwarded = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) forwarded[key.toLowerCase()] = value;
  }
  const host = String(headers?.host || "").trim();
  const origin = String(headers?.origin || "").trim();
  if (origin && host) {
    try {
      if (new URL(origin).host.toLowerCase() === host.toLowerCase()) delete forwarded.origin;
    } catch {
      // A malformed Origin goes on; the commander refuses it.
    }
  }
  const chain = String(headers?.["x-forwarded-for"] || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (clientIp) chain.push(String(clientIp));
  if (chain.length) forwarded["x-forwarded-for"] = chain.join(", ");
  if (!forwarded["x-forwarded-proto"]) forwarded["x-forwarded-proto"] = scheme;
  if (host) forwarded["x-forwarded-host"] = host;
  return forwarded;
}

function answerUnavailable(res, securityHeaders) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(503, {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": "5",
  });
  res.end(JSON.stringify({ error: RUNTIME_UNAVAILABLE, retryable: true }));
}

/**
 * Passes one request to the commander's Node API and its answer back. A
 * commander that is restarting gives 503 with Retry-After, like FastAPI.
 */
export function forwardToRuntime(req, res, target, { securityHeaders = {}, readTimeoutMs = 60_000, connectTimeoutMs = 3_000 } = {}) {
  const base = new URL(target);
  const clientIp = req.socket?.remoteAddress || "";
  const scheme = req.socket?.encrypted ? "https" : "http";
  const upstream = http.request({
    protocol: base.protocol,
    hostname: base.hostname,
    port: base.port || 80,
    method: req.method,
    path: req.url,
    headers: forwardRequestHeaders(req.headers, { clientIp, scheme }),
  }, (answer) => {
    const headers = {};
    for (const [key, value] of Object.entries(answer.headers)) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
    }
    res.writeHead(answer.statusCode || 502, headers);
    answer.pipe(res);
  });

  let connected = false;
  const connectTimer = setTimeout(() => { if (!connected) upstream.destroy(new Error("connect timeout")); }, connectTimeoutMs);
  const markConnected = () => {
    connected = true;
    clearTimeout(connectTimer);
  };
  upstream.on("socket", (socket) => {
    // A kept-alive socket is connected already and sends no "connect".
    if (socket.connecting) socket.once("connect", markConnected);
    else markConnected();
  });
  upstream.setTimeout(readTimeoutMs, () => upstream.destroy(new Error("read timeout")));
  upstream.on("error", () => {
    clearTimeout(connectTimer);
    answerUnavailable(res, securityHeaders);
  });
  upstream.on("close", () => clearTimeout(connectTimer));
  req.pipe(upstream);
}

const reachability = { at: 0, target: "", value: false };

/** Whether the commander's Node API answers, cached for ten seconds (health only, like FastAPI). */
export async function runtimeApiReachable(target, { now = Date.now() } = {}) {
  if (reachability.target === target && now - reachability.at < 10_000) return reachability.value;
  const base = new URL(target);
  const value = await new Promise((resolve) => {
    const socket = net.connect({ host: base.hostname, port: Number(base.port || 80) });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
  Object.assign(reachability, { at: now, target, value });
  return value;
}
