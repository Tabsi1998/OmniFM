// ============================================================
// OmniFM: MongoDB and the stores for a Node API without Discord
// ============================================================
// The public entry (api.js, #290) and the local check's scripts/serve-node-api.mjs
// answer from the same data as the commander (src/entrypoints/shared.js):
// MongoDB first, then every store, then the licence lookup of the entitlements.

export async function initApiStores({ env = process.env, attempts = 10, retryMs = 3000, log = console.log } = {}) {
  const { MONGO_REQUIRED_MESSAGE, fileStoresAllowed } = await import("../lib/store-policy.js");
  // Production keeps its data in MongoDB only (#292): without it the start stops here.
  if (!String(env.MONGO_URL || "").trim() && !fileStoresAllowed(env)) throw new Error(MONGO_REQUIRED_MESSAGE);
  if (String(env.MONGO_URL || "").trim()) {
    const { connect } = await import("../lib/db.js");
    // MongoDB may still be starting after a reboot; systemd restarts us after that.
    for (let attempt = 1; ; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one attempt after the other on purpose
        await connect();
        break;
      } catch (err) {
        if (attempt >= attempts) throw err;
        log(`[OmniFM] MongoDB noch nicht erreichbar (${attempt}/${attempts}): ${err?.message || err}`);
        // eslint-disable-next-line no-await-in-loop -- waiting between attempts
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
  }
  const { initPremiumStore, getServerLicense } = await import("../premium-store.js");
  const { initStationsStore } = await import("../stations-store.js");
  const { initCustomStationsStore } = await import("../custom-stations.js");
  const { initCommandPermissionsStore } = await import("../command-permissions-store.js");
  const { initScheduledEventsStore } = await import("../scheduled-events-store.js");
  const { setLicenseProvider } = await import("../core/entitlements.js");
  const { initCouponStore } = await import("../coupon-store.js");
  const { initProviderStores } = await import("../lib/provider-stores.js");
  const { initDashboardStore } = await import("../dashboard-store.js");
  await initPremiumStore();
  await initCouponStore();
  await initProviderStores();
  await initDashboardStore();
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
}
