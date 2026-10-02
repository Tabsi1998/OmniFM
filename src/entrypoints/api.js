// ============================================================
// OmniFM: the public API on :8001 (#290)
// ============================================================
// The only public HTTP entry (M10, #291). It answers the owner
// console, the website (stations, prices, legal texts, stats), premium
// codes and the trial, and the bot list webhooks itself, from MongoDB. What
// needs the running bots (dashboard, Discord login, share cards, station
// logos, cockpit) goes to the Node API of the commander on 127.0.0.1.
//
//   node src/entrypoints/api.js --port 8001 [--host 0.0.0.0]
//
// Settings: backend/.env, then the owner console (MongoDB owner_config), the
// same two sources the bot starts from (owner-env.mjs).
import {
  applyOwnerSystemEnv,
  loadBackendEnv,
  loadOwnerConfig,
  mongoTarget,
  preferPublicAddress,
} from "./owner-env.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const backendEnv = loadBackendEnv();
const target = mongoTarget(process.env, backendEnv);
process.env.MONGO_URL = target.url;
process.env.DB_NAME = target.dbName;

let system = {};
try {
  system = (await loadOwnerConfig(target)).system || {};
} catch (err) {
  // initApiStores waits for MongoDB below; without the console the environment applies.
  console.warn(`[OmniFM] Owner-Config beim Start nicht lesbar (${target.url} / ${target.dbName}): ${err?.message || err}`);
}
await applyOwnerSystemEnv(system, process.env);
await preferPublicAddress(system, process.env);

// The port and address come from the command line: backend/.env may carry
// WEB_* values of the commander, and systemd lets the EnvironmentFile win.
process.env.WEB_SERVER_ENABLED = "1";
process.env.WEB_INTERNAL_PORT = String(argument("port", "8001"));
process.env.WEB_BIND = String(argument("host", "0.0.0.0"));

const { resolveNodeApiPort } = await import("../lib/commander-api.js");
const runtimeApi = String(process.env.OMNIFM_NODE_API_URL || "").trim().replace(/\/+$/, "")
  || `http://127.0.0.1:${resolveNodeApiPort(process.env)}`;

const { initApiStores } = await import("./api-stores.js");
await initApiStores();

const { startWebServer } = await import("../api/server.js");
const server = startWebServer([], { forwardRuntimeTo: runtimeApi });
console.log(`[OmniFM] Öffentliche Node-API auf ${process.env.WEB_BIND}:${process.env.WEB_INTERNAL_PORT}; Dashboard, Login und Cockpit gehen an ${runtimeApi}.`);

const stop = () => {
  server.close(async () => {
    const { close } = await import("../lib/db.js");
    await close().catch(() => {});
    process.exit(0);
  });
  // Open keep-alive connections must not hold the restart.
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
