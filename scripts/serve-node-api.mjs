#!/usr/bin/env node
// Starts only the Node API (src/api/server.js), without Discord, so the local
// check can drive FastAPI's forwarding of /api/auth and /api/dashboard to it
// (#195). Production never runs this: there the commander starts the same
// server. Set OMNIFM_RUNTIME_DATA_DIR to a scratch folder, or the stores write
// into the repository.
// Like the commander (src/entrypoints/shared.js, commander.js): MongoDB and
// the stores first, so the owner and dashboard routes see real data (#288).
if (String(process.env.MONGO_URL || "").trim()) {
  const { connect } = await import("../src/lib/db.js");
  await connect();
}
const { initPremiumStore, getServerLicense } = await import("../src/premium-store.js");
const { initStationsStore } = await import("../src/stations-store.js");
const { initCustomStationsStore } = await import("../src/custom-stations.js");
const { initCommandPermissionsStore } = await import("../src/command-permissions-store.js");
const { initScheduledEventsStore } = await import("../src/scheduled-events-store.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
await initPremiumStore();
await initStationsStore();
await initCustomStationsStore();
await initCommandPermissionsStore();
await initScheduledEventsStore();
setLicenseProvider((serverId) => {
  const license = getServerLicense(serverId);
  if (!license) return null;
  return {
    plan: license.plan || license.tier || "free",
    active: Boolean(license.active) && !license.expired,
    seats: Math.max(1, Number(license.seats || 1) || 1),
  };
});

const { startWebServer } = await import("../src/api/server.js");

const server = startWebServer([]);
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
