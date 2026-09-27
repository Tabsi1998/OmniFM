#!/usr/bin/env node
// One address for the website under test (#294), like the reverse proxy in
// production: /api goes to the Node API, everything else to `serve` with
// serve.json. The Playwright smoke and Lighthouse open this address.
//
//   node scripts/local-site-proxy.mjs <port> <static-url> <api-url>
import http from "node:http";

const [port, staticBase, apiBase] = process.argv.slice(2);
if (!port || !staticBase || !apiBase) {
  console.error("usage: node scripts/local-site-proxy.mjs <port> <static-url> <api-url>");
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const target = new URL(req.url, (req.url || "").startsWith("/api/") ? apiBase : staticBase);
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (answer) => {
    res.writeHead(answer.statusCode || 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("upstream unavailable");
  });
  req.pipe(upstream);
});
server.listen(Number(port), "127.0.0.1", () => console.log(`site on http://127.0.0.1:${port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
