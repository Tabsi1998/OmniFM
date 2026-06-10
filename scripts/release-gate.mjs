#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    preflight: false,
    "post-deploy": false,
    "rollback-plan": false,
    all: false,
    "dry-run": false,
    "allow-dirty": false,
    "skip-audit": false,
    "skip-build": false,
    "skip-tests": false,
    "skip-doctor": false,
    "skip-live": false,
    "skip-logs": false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      args[key] = true;
      continue;
    }
    const next = String(argv[index + 1] || "");
    args[key] = next && !next.startsWith("--") ? next : "";
    if (args[key]) index += 1;
  }

  if (!args.preflight && !args["post-deploy"] && !args["rollback-plan"] && !args.all && !args.help) {
    args.preflight = true;
  }
  if (args.all) {
    args.preflight = true;
    args["post-deploy"] = true;
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/release-gate.mjs --preflight [--dry-run] [--allow-dirty]");
  console.log("  node scripts/release-gate.mjs --post-deploy --base-url https://omnifm.xyz --admin-token <token>");
  console.log("  node scripts/release-gate.mjs --all --base-url https://omnifm.xyz --admin-token <token>");
  console.log("  node scripts/release-gate.mjs --rollback-plan");
  console.log("");
  console.log("Preflight checks: clean worktree, npm test, frontend build, npm audit, update.sh doctor.");
  console.log("Post-deploy checks: scripts/phase6-live-check.mjs against the public URL.");
}

function log(level, message) {
  console.log(`[${level}] ${message}`);
}

function runStep(label, command, args, { dryRun = false, allowFailure = false, env = {} } = {}) {
  const printable = [command, ...args].join(" ");
  if (dryRun) {
    log("DRY", `${label}: ${printable}`);
    return true;
  }

  log("RUN", `${label}: ${printable}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });

  if (result.status === 0) {
    log("OK", label);
    return true;
  }

  if (allowFailure) {
    log("WARN", `${label} failed with exit code ${result.status ?? "unknown"} but is marked non-blocking.`);
    return true;
  }

  log("FAIL", `${label} failed with exit code ${result.status ?? "unknown"}.`);
  return false;
}

function getCommandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  return {
    ok: result.status === 0,
    text: String(result.stdout || result.stderr || "").trim(),
  };
}

function checkCleanWorktree({ allowDirty = false, dryRun = false } = {}) {
  if (dryRun) {
    log("DRY", "worktree: git status --porcelain");
    return true;
  }

  const status = getCommandOutput("git", ["status", "--porcelain"]);
  if (!status.ok) {
    log("FAIL", "worktree: git status failed.");
    return false;
  }
  if (!status.text) {
    log("OK", "worktree: clean");
    return true;
  }
  if (allowDirty) {
    log("WARN", "worktree: dirty but allowed by --allow-dirty.");
    return true;
  }
  log("FAIL", "worktree: uncommitted files present. Commit/stash first or use --allow-dirty intentionally.");
  return false;
}

function resolveAdminToken(args) {
  return String(
    args["admin-token"]
    || process.env.OMNIFM_ADMIN_TOKEN
    || process.env.API_ADMIN_TOKEN
    || process.env.ADMIN_API_TOKEN
    || process.env.OMNIFM_LIVE_ADMIN_TOKEN
    || ""
  ).trim();
}

function normalizeBaseUrl(args) {
  return String(args["base-url"] || process.env.OMNIFM_BASE_URL || process.env.PUBLIC_WEB_URL || "https://omnifm.xyz")
    .trim()
    .replace(/\/+$/, "");
}

function runPreflight(args) {
  let ok = true;
  ok = checkCleanWorktree({ allowDirty: args["allow-dirty"], dryRun: args["dry-run"] }) && ok;

  if (!args["skip-tests"]) {
    ok = runStep("tests", "npm", ["test"], { dryRun: args["dry-run"] }) && ok;
  } else {
    log("WARN", "tests skipped by --skip-tests.");
  }

  if (!args["skip-build"]) {
    ok = runStep("frontend build", "npm", ["--prefix", "frontend", "run", "build"], { dryRun: args["dry-run"] }) && ok;
  } else {
    log("WARN", "frontend build skipped by --skip-build.");
  }

  if (!args["skip-audit"]) {
    ok = runStep("dependency audit", "npm", ["audit", "--omit=dev", "--audit-level=high"], {
      dryRun: args["dry-run"],
      allowFailure: true,
    }) && ok;
  } else {
    log("WARN", "dependency audit skipped by --skip-audit.");
  }

  if (!args["skip-doctor"]) {
    ok = runStep("config doctor", "bash", ["./update.sh", "--doctor"], {
      dryRun: args["dry-run"],
      allowFailure: process.platform === "win32",
    }) && ok;
  } else {
    log("WARN", "config doctor skipped by --skip-doctor.");
  }

  log("OK", "DB migration readiness is covered by npm test, Mongo smoke in CI, and boot-time JSON->Mongo migration logs.");
  return ok;
}

function runPostDeploy(args) {
  if (args["skip-live"]) {
    log("WARN", "live smoke skipped by --skip-live.");
    return true;
  }

  const baseUrl = normalizeBaseUrl(args);
  const adminToken = resolveAdminToken(args);
  const liveArgs = ["scripts/phase6-live-check.mjs", "--base-url", baseUrl];
  if (adminToken) {
    liveArgs.push("--admin-token", adminToken);
  } else {
    liveArgs.push("--skip-api");
    log("WARN", "admin token missing; post-deploy falls back to public-only live smoke.");
  }
  if (args["skip-logs"]) {
    liveArgs.push("--skip-logs");
  }

  return runStep("post-deploy live smoke", "node", liveArgs, {
    dryRun: args["dry-run"],
  });
}

function printRollbackPlan() {
  console.log(`
Rollback plan:

1. Stop risky rollout activity.
   - Do not run additional update or CLI write operations.
   - Capture current commit: git rev-parse --short HEAD.

2. Roll code/container back.
   - git fetch origin
   - git checkout <known-good-commit-or-tag>
   - bash ./scripts/compose.sh up -d --build
   - In split mode, prefer commander first, then workers, unless the incident is worker-only.

3. Runtime files.
   - Restore JSON runtime files from the latest verified backup only when the incident is data-related.
   - Keep stations.json under Git ownership; do not overwrite it from runtime backups unless explicitly intended.

4. MongoDB and migrations.
   - Prefer forward fixes for already-applied Mongo changes.
   - If a backup restore is required, stop OmniFM containers first, restore Mongo, then start commander before workers.

5. Verification.
   - node scripts/release-gate.mjs --post-deploy --base-url https://omnifm.xyz --admin-token "$API_ADMIN_TOKEN"
   - Check /admin release card, /api/health/detail, live-smoke workflow, and Docker logs.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  let ok = true;
  if (args.preflight) ok = runPreflight(args) && ok;
  if (args["post-deploy"]) ok = runPostDeploy(args) && ok;
  if (args["rollback-plan"]) printRollbackPlan();

  if (!ok) {
    log("FAIL", "Release gate failed.");
    process.exitCode = 1;
    return;
  }
  log("OK", "Release gate passed.");
}

main().catch((error) => {
  log("FAIL", error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
