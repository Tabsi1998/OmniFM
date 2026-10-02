#!/usr/bin/env node
// Route contract (#195): every /api path the frontend calls must exist in the
// Node API (src/api), the only backend since FastAPI is gone (#291). The
// public entry answers part of it itself and passes the rest to the commander;
// both run the same route modules.
//
//   node scripts/check-api-routes.mjs          check, exit 1 on a missing route
//   node scripts/check-api-routes.mjs --list   also print every path
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

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

function existsInNode(apiPath, source) {
  // Literal paths appear as strings; a parameter segment is matched by the
  // literal prefix before it (the Node routes split the rest themselves).
  const literal = apiPath.split("/:param")[0];
  return source.includes(`"${literal}"`) || source.includes(`'${literal}'`)
    || source.includes(`"${literal}/"`) || source.includes(`\`${literal}/`);
}

const list = process.argv.includes("--list");
const source = nodeRouteSource();
const missing = [];
for (const [apiPath, file] of [...frontendPaths()].sort(([a], [b]) => a.localeCompare(b))) {
  const ok = existsInNode(apiPath, source);
  if (list) console.log(`${ok ? "ok     " : "MISSING"} ${apiPath}`);
  if (!ok) missing.push(`${apiPath} (called in ${file})`);
}

if (missing.length) {
  console.error(`${missing.length} frontend API paths have no route in the Node API:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log("every frontend API path has a route in the Node API");
