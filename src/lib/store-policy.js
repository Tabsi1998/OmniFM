// ============================================================
// OmniFM: where the data lives (#292)
// ============================================================
// Production keeps its data in MongoDB only: a second copy in runtime-data/
// could drift from it, and two processes writing one file overwrite each
// other. JSON files are for development and tests, or with
// OMNIFM_ALLOW_FILE_STORES=1 on purpose. The systemd units of production set
// NODE_ENV=production.

export function isProductionRuntime(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

/** May a store write its JSON file? Always outside production, inside only on request. */
export function fileStoresAllowed(env = process.env) {
  return !isProductionRuntime(env) || String(env.OMNIFM_ALLOW_FILE_STORES || "").trim() === "1";
}

/** The message a production start without MongoDB stops with. */
export const MONGO_REQUIRED_MESSAGE = "Produktion braucht MongoDB (MONGO_URL in backend/.env). Datei-Speicher sind nur für Entwicklung und Tests (OMNIFM_ALLOW_FILE_STORES=1).";
