#!/usr/bin/env node
// Writes frontend/serve.json, the configuration of the static website server
// (`serve build --config ../serve.json`), from src/config/security-headers.js.
//
//   node scripts/write-serve-config.mjs          write the file
//   node scripts/write-serve-config.mjs --check  fail if the file is out of date
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVITY_FRAME_ANCESTORS, buildContentSecurityPolicy, buildWebsiteSecurityHeaders } from "../src/config/security-headers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SERVE_CONFIG_PATH = path.join(ROOT, "frontend", "serve.json");

function toHeaderList(headers) {
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}

export function buildServeConfig() {
  const {
    "X-Frame-Options": frameOptions,
    "Content-Security-Policy": contentSecurityPolicy,
    ...common
  } = buildWebsiteSecurityHeaders();
  return {
    rewrites: [
      // The Discord Activity (#308) is a page of its own, build/activity/index.html.
      // serve picks header rules by the file it sends, so only a file of its own
      // can have its own frame rules.
      { source: "/activity", destination: "/activity/index.html" },
      // Page paths of the single-page app never contain a dot, files always do.
      // Only page paths get index.html; a missing file stays a 404 instead of
      // being answered with the start page.
      { source: "/:path([^.]+)", destination: "/index.html" },
    ],
    headers: [
      {
        source: "**",
        headers: toHeaderList({
          ...common,
          // index.html and the files next to it: ask the server each time, so
          // a new release is picked up at once.
          "Cache-Control": "no-cache",
        }),
      },
      {
        // Every file but the Activity's may never be shown in a frame.
        source: "!activity/**",
        headers: toHeaderList({ "X-Frame-Options": frameOptions, "Content-Security-Policy": contentSecurityPolicy }),
      },
      {
        // The Discord Activity (#308): Discord shows it in its client, nobody else may frame it.
        source: "activity/**",
        headers: toHeaderList({ "Content-Security-Policy": buildContentSecurityPolicy({ "frame-ancestors": ACTIVITY_FRAME_ANCESTORS }) }),
      },
      {
        // Vite puts a content hash into every file name below assets/.
        source: "assets/**",
        headers: toHeaderList({ "Cache-Control": "public, max-age=31536000, immutable" }),
      },
      {
        source: "favicon.ico",
        headers: toHeaderList({ "Content-Type": "image/x-icon" }),
      },
    ],
  };
}

export function renderServeConfig() {
  return `${JSON.stringify(buildServeConfig(), null, 2)}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = renderServeConfig();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(SERVE_CONFIG_PATH) ? fs.readFileSync(SERVE_CONFIG_PATH, "utf8") : "";
    if (current !== expected) {
      console.error("frontend/serve.json is out of date. Run: node scripts/write-serve-config.mjs");
      process.exit(1);
    }
    console.log("frontend/serve.json matches src/config/security-headers.js");
  } else {
    fs.writeFileSync(SERVE_CONFIG_PATH, expected);
    console.log(`wrote ${path.relative(ROOT, SERVE_CONFIG_PATH)}`);
  }
}
