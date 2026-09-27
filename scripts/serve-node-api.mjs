#!/usr/bin/env node
// Starts only the Node API (src/api/server.js), without Discord, for the local
// check: it stands in for the commander's Node API behind the public entry
// (#195, #290) and answers the contract suite (#287). Production runs
// src/entrypoints/api.js as the public entry and the commander for the rest.
// Set OMNIFM_RUNTIME_DATA_DIR to a scratch folder, or the stores write into
// the repository.
const { initApiStores } = await import("../src/entrypoints/api-stores.js");
await initApiStores({ attempts: 1 });

const { startWebServer } = await import("../src/api/server.js");

const server = startWebServer([]);
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
