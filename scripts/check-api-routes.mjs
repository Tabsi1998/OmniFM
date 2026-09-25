#!/usr/bin/env node
// Route contract (#195): every /api path the frontend calls must exist in the
// backend that answers it in production. /api/auth and /api/dashboard go to
// the Node API (src/api), FastAPI forwards them there; every other path is a
// FastAPI route in backend/server.py or backend/routers/.
//
//   node scripts/check-api-routes.mjs          check, exit 1 on a missing route
//   node scripts/check-api-routes.mjs --list   also print where each path lives
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// The prefixes FastAPI forwards to the Node API, read from backend/server.py
// so this check and the proxy can never disagree.
function nodePrefixes() {
  const source = fs.readFileSync(path.join(root, "backend", "server.py"), "utf8");
  const tuple = /NODE_PROXY_PREFIXES\s*=\s*\(([^)]*)\)/.exec(source)?.[1] || "";
  const prefixes = [...tuple.matchAll(/"([^"]+)"/g)].map((match) => `${match[1].replace(/\/+$/, "")}/`);
  return prefixes.length ? prefixes : ["/api/auth/", "/api/dashboard/"];
}
const NODE_PREFIXES = nodePrefixes();

function walk(directory, extensions, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, extensions, found);
    else if (extensions.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

/** Paths as the frontend writes them; a template placeholder becomes ":param". */
function frontendPaths() {
  const paths = new Map();
  for (const file of walk(path.join(root, "frontend", "src"), new Set([".js", ".jsx", ".ts", ".tsx"]))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/.]*(?:\$\{[^}]*\}[A-Za-z0-9_\-/.]*)*)/g)) {
      let apiPath = match[1].replace(/\$\{[^}]*\}/g, ":param").replace(/\/+$/, "");
      // "/api/dashboard/" + something built at runtime: only the prefix is known.
      if (apiPath === "/api/dashboard" || apiPath === "/api/auth") continue;
      apiPath = apiPath.replace(/\?.*$/, "");
      if (!paths.has(apiPath)) paths.set(apiPath, path.relative(root, file).split(path.sep).join("/"));
    }
  }
  return paths;
}

function nodeRouteSource() {
  return walk(path.join(root, "src", "api"), new Set([".js"]))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

/** FastAPI route patterns as regular expressions. */
function fastapiRoutes() {
  // server.py and the route modules it includes (backend/routers/, #200).
  const routerDir = path.join(root, "backend", "routers");
  const files = [path.join(root, "backend", "server.py")]
    .concat(fs.existsSync(routerDir) ? walk(routerDir, new Set([".py"])) : []);
  const text = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const routes = [];
  for (const match of text.matchAll(/@(?:app|router)\.(?:get|post|put|patch|delete|api_route)\("([^"]+)"/g)) {
    const pattern = `^${match[1].replace(/[.]/g, "\\.").replace(/\{[^}]+\}/g, "[^/]+")}$`;
    routes.push({ route: match[1], regex: new RegExp(pattern) });
  }
  return routes;
}

function existsInNode(apiPath, source) {
  // Literal paths appear as strings; a parameter segment is matched by the
  // literal prefix before it (the Node routes split the rest themselves).
  const literal = apiPath.split("/:param")[0];
  return source.includes(`"${literal}"`) || source.includes(`'${literal}'`)
    || source.includes(`"${literal}/"`) || source.includes(`\`${literal}/`);
}

function existsInFastapi(apiPath, routes) {
  const concrete = apiPath.replace(/:param/g, "x");
  return routes.some((entry) => entry.regex.test(concrete));
}

const list = process.argv.includes("--list");
const nodeSource = nodeRouteSource();
const routes = fastapiRoutes();
const missing = [];
for (const [apiPath, file] of [...frontendPaths()].sort(([a], [b]) => a.localeCompare(b))) {
  const viaNode = NODE_PREFIXES.some((prefix) => `${apiPath}/`.startsWith(prefix));
  const ok = viaNode ? existsInNode(apiPath, nodeSource) : existsInFastapi(apiPath, routes);
  if (list) console.log(`${ok ? "ok     " : "MISSING"} ${viaNode ? "node   " : "fastapi"} ${apiPath}`);
  if (!ok) missing.push(`${apiPath} (${viaNode ? "Node API" : "FastAPI"}, called in ${file})`);
}

if (missing.length) {
  console.error(`${missing.length} frontend API paths have no backend route:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log("every frontend API path has a backend route");
