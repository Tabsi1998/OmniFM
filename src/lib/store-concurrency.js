export const STORE_CONCURRENCY_REGISTRY = [
  {
    store: "bot-state",
    files: ["bot-state/<botId>.json", "bot-state.json"],
    scope: "per-bot in split mode",
    runtimeOwner: "owning commander/worker process",
    splitSafety: "split-file",
    protection: "split files per bot plus legacy migration",
  },
  {
    store: "song-history",
    files: ["song-history/<botId>.json", "song-history.json"],
    scope: "per-bot in split mode",
    runtimeOwner: "owning commander/worker process",
    splitSafety: "split-file",
    protection: "split files per bot plus legacy migration",
  },
  {
    store: "dashboard",
    files: ["dashboard.json"],
    scope: "global",
    runtimeOwner: "MongoDB: logins by the commander, read by the public entry (#292)",
    splitSafety: "mongo-source",
    protection: "one document per login (token hashed), OAuth state and server telemetry; TTL for expiry; the locked JSON file without MongoDB",
  },
  {
    store: "premium",
    files: ["premium.json"],
    scope: "global",
    runtimeOwner: "commander/API/payment process",
    splitSafety: "commander-owned",
    protection: "workers read; commander owns mutations and split startup requires MongoDB",
  },
  {
    store: "custom-stations",
    files: ["custom-stations.json"],
    scope: "global",
    runtimeOwner: "MongoDB shared by FastAPI and commander",
    splitSafety: "mongo-source",
    protection: "MongoDB is canonical in production; JSON is one-time migration and local fallback",
  },
  {
    store: "scheduled-events",
    files: ["scheduled-events.json"],
    scope: "global",
    runtimeOwner: "MongoDB shared by FastAPI and commander",
    splitSafety: "mongo-source",
    protection: "MongoDB is canonical in production; JSON is one-time migration and local fallback",
  },
  {
    store: "command-permissions",
    files: ["command-permissions.json"],
    scope: "global",
    runtimeOwner: "MongoDB shared by FastAPI and commander",
    splitSafety: "mongo-source",
    protection: "MongoDB is canonical in production; JSON is one-time migration and local fallback",
  },
  {
    store: "listening-stats",
    files: ["listening-stats.json"],
    scope: "global analytics",
    runtimeOwner: "MongoDB in split mode",
    splitSafety: "mongo-source",
    protection: "MongoDB is the split source of truth; JSON is migration/local fallback",
  },
  {
    store: "stations",
    files: ["stations.json"],
    scope: "global catalog",
    runtimeOwner: "commander/admin or CLI maintenance",
    splitSafety: "commander-owned",
    protection: "runtime reads everywhere; writes should not run from parallel CLI while containers are active",
  },
  {
    store: "coupons",
    files: ["coupons.json"],
    scope: "global billing/offers",
    runtimeOwner: "MongoDB shared by the public entry and the commander (#292)",
    splitSafety: "mongo-source",
    protection: "one document per offer and per redemption; JSON is one-time migration and local fallback",
  },
  {
    store: "provider-directory",
    files: ["discordbotlist.json", "botsgg.json", "topgg.json", "vote-events.json"],
    scope: "global provider sync",
    runtimeOwner: "MongoDB: webhooks in the public entry, sync loops in the commander (#292)",
    splitSafety: "mongo-source",
    protection: "state documents set field by field; one document per vote, totals with $inc; JSON is one-time migration and local fallback",
  },
  {
    store: "incidents",
    files: ["operator-incidents.json", "runtime-incidents.json"],
    scope: "process/global diagnostics",
    runtimeOwner: "MongoDB where available, otherwise local process fallback",
    splitSafety: "mongo-or-local-fallback",
    protection: "runtime incidents prefer MongoDB; operator incidents are diagnostic fallback data",
  },
  {
    store: "owner-audit",
    files: ["owner-audit.json"],
    scope: "global operator audit trail",
    runtimeOwner: "MongoDB owner_audit in production (#292); the locked file in development",
    splitSafety: "mongo-source",
    protection: "production writes owner_audit only, where the owner console reads it; the locked file without MongoDB",
  },
  {
    store: "guild-languages",
    files: ["guild-languages.json"],
    scope: "global language per server",
    runtimeOwner: "MongoDB: /language in the commander, read by every process (#292)",
    splitSafety: "mongo-source",
    protection: "one document per server, refreshed every 10 s in every process; JSON is one-time migration and local fallback",
  },
];

export function isSplitRuntime(env = process.env) {
  const deploymentMode = String(env.OMNIFM_DEPLOYMENT_MODE || "").trim().toLowerCase();
  const role = String(env.BOT_PROCESS_ROLE || "").trim().toLowerCase();
  return deploymentMode === "split" || role === "commander" || role === "worker";
}

export function getStoreConcurrencyReport({
  env = process.env,
  mongoConnected = false,
  requireMongo = false,
} = {}) {
  const splitRuntime = isSplitRuntime(env);
  const warnings = [];

  if (splitRuntime && !mongoConnected) {
    warnings.push({
      code: requireMongo ? "split_mongo_required" : "split_file_fallback",
      severity: requireMongo ? "critical" : "warning",
      message: requireMongo
        ? "Split runtime requires MongoDB; refusing unsafe shared file fallback."
        : "Split-like runtime is using file fallbacks. Keep global store mutations commander-owned or enable MongoDB.",
    });
  }

  const unsafeGlobalStores = STORE_CONCURRENCY_REGISTRY.filter((entry) => (
    entry.scope.startsWith("global")
    && !["locked-file", "commander-owned", "mongo-source"].includes(entry.splitSafety)
  ));

  if (splitRuntime && unsafeGlobalStores.length > 0) {
    warnings.push({
      code: "split_store_review_required",
      severity: "warning",
      message: `Review split ownership for global stores: ${unsafeGlobalStores.map((entry) => entry.store).join(", ")}.`,
    });
  }

  return {
    splitRuntime,
    mongoConnected: Boolean(mongoConnected),
    requireMongo: Boolean(requireMongo),
    stores: STORE_CONCURRENCY_REGISTRY.map((entry) => ({ ...entry })),
    warnings,
  };
}

/**
 * @param {{ log?: Function, env?: Record<string, string | undefined>,
 *   mongoConnected?: boolean, requireMongo?: boolean }} [options]
 */
export function logStoreConcurrencyReport({
  log,
  env = process.env,
  mongoConnected = false,
  requireMongo = false,
} = {}) {
  const report = getStoreConcurrencyReport({ env, mongoConnected, requireMongo });
  if (typeof log !== "function") return report;

  const splitLabel = report.splitRuntime ? "split" : "monolith";
  const mongoLabel = report.mongoConnected ? "mongo-connected" : "file-fallback";
  log("INFO", `[StoreConcurrency] topology=${splitLabel} persistence=${mongoLabel} stores=${report.stores.length}`);

  for (const warning of report.warnings) {
    log(warning.severity === "critical" ? "ERROR" : "WARN", `[StoreConcurrency] ${warning.code}: ${warning.message}`);
  }

  return report;
}
