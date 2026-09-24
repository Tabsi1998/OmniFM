#!/usr/bin/env node
// Starts only the Node API (src/api/server.js), without Discord, so the local
// check can drive FastAPI's forwarding of /api/auth and /api/dashboard to it
// (#195). Production never runs this: there the commander starts the same
// server. Set OMNIFM_RUNTIME_DATA_DIR to a scratch folder, or the stores write
// into the repository.
const { startWebServer } = await import("../src/api/server.js");

const server = startWebServer([]);
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
