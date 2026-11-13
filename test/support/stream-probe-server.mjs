// Test helpers for the stream audio probe (#538): audio bytes, a local HTTP
// server, and the real safeFetch pointed at it. safeFetch refuses local
// addresses, so the DNS answer is a public one and only the connection itself
// is pinned to the local server; redirects, the lenient parser and the body
// handling stay the real ones.
import { once } from "node:events";
import http from "node:http";

import { requestPinnedTarget, safeFetch } from "../../src/lib/safe-outbound-http.js";

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz: 417 bytes per frame. */
export function mp3Frames(count = 4) {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

/** ADTS AAC-LC, 44.1 kHz, stereo: 200 bytes per frame. */
export function aacFrames(count = 4) {
  const frame = Buffer.alloc(200);
  frame.set([0xff, 0xf1, 0x50, 0x80, 200 >> 3, ((200 & 7) << 5) | 0x1f, 0xfc]);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

export const HTML_PAGE = Buffer.from(`<!doctype html><html><head><title>Radio</title></head><body>${"<p>Bitte anmelden.</p>".repeat(40)}</body></html>`);

/**
 * Runs fn with a fetch that sends every request for http://radio.test/... to
 * a local server with the given handler.
 * @param {http.RequestListener} handler
 * @param {(fetchImpl: Function, state: { requests: Array<{ method: string, url: string, headers: any }> }) => Promise<any>} fn
 */
export async function withStreamServer(handler, fn) {
  const state = { requests: [] };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    state.requests.push({ method: req.method, url: req.url, headers: req.headers });
    handler(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const fetchImpl = (url, options = {}) => safeFetch(url, {
    ...options,
    lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
    requestImpl: (target, request) => requestPinnedTarget({
      url: new URL(`${target.url.pathname}${target.url.search}`, `http://127.0.0.1:${port}`),
      hostname: "127.0.0.1",
      address: "127.0.0.1",
      family: 4,
    }, request),
  });
  try {
    return await fn(fetchImpl, state);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    await once(server, "close");
  }
}
