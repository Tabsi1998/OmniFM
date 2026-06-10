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
    runtimeOwner: "commander/API process",
    splitSafety: "locked-file",
    protection: "inter-process lock around dashboard session, OAuth, and telemetry writes",
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
    runtimeOwner: "commander/API process",
    splitSafety: "commander-owned",
    protection: "runtime mutations go through the commander/dashboard path",
  },
  {
    store: "scheduled-events",
    files: ["scheduled-events.json"],
    scope: "global",
    runtimeOwner: "commander/API process",
    splitSafety: "commander-owned",
    protection: "event scheduling runs from commander/dashboard path",
  },
  {
    store: "command-permissions",
    files: ["command-permissions.json"],
    scope: "global",
    runtimeOwner: "commander/API process",
    splitSafety: "commander-owned",
    protection: "permission writes run through commander commands/dashboard path",
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
    runtimeOwner: "commander/API or CLI maintenance",
    splitSafety: "commander-owned",
    protection: "checkout/admin mutations belong to the commander path",
  },
  {
    store: "provider-directory",
    files: ["discordbotlist.json", "botsgg.json", "topgg.json", "vote-events.json"],
    scope: "global provider sync",
    runtimeOwner: "commander sync process",
    splitSafety: "commander-owned",
    protection: "provider sync loops run in the commander process",
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
    store: "guild-languages",
    files: ["guild-languages.json"],
    scope: "global legacy language fallback",
    runtimeOwner: "commander/command process",
    splitSafety: "commander-owned",
    protection: "legacy fallback; language resolution is normalized at runtime",
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
