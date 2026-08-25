#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { redactSensitiveText } from "../src/lib/redact-sensitive.js";

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
    "unsafe-token-argument": false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current.startsWith("--")) continue;
    if (current === "--admin-token" || current.startsWith("--admin-token=")) {
      args["unsafe-token-argument"] = true;
      if (current === "--admin-token" && !String(argv[index + 1] || "").startsWith("--")) index += 1;
      continue;
    }
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
  console.log("  OMNIFM_LIVE_ADMIN_TOKEN=... node scripts/release-gate.mjs --post-deploy --base-url https://omnifm.xyz");
  console.log("  OMNIFM_LIVE_ADMIN_TOKEN=... node scripts/release-gate.mjs --all --base-url https://omnifm.xyz");
  console.log("  node scripts/release-gate.mjs --rollback-plan");
  console.log("");
  console.log("Preflight checks: clean worktree, npm test, frontend build, npm audit, update.sh doctor.");
  console.log("Post-deploy checks: scripts/phase6-live-check.mjs against the public URL.");
}

function log(level, message) {
  console.log(`[${level}] ${redactSensitiveText(message)}`);
}

function runStep(label, command, args, { dryRun = false, allowFailure = false, env = {} } = {}) {
  const printable = redactSensitiveText([command, ...args].join(" "));
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

function resolveAdminToken() {
  return String(
    process.env.OMNIFM_LIVE_ADMIN_TOKEN
    || process.env.OMNIFM_ADMIN_TOKEN
    || process.env.API_ADMIN_TOKEN
    || process.env.ADMIN_API_TOKEN
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
  const adminToken = resolveAdminToken();
  const liveArgs = ["scripts/phase6-live-check.mjs", "--base-url", baseUrl];
  if (!adminToken) {
    liveArgs.push("--skip-api");
    log("WARN", "admin token missing; post-deploy falls back to public-only live smoke.");
  }
  if (args["skip-logs"]) {
    liveArgs.push("--skip-logs");
  }

  return runStep("post-deploy live smoke", "node", liveArgs, {
    dryRun: args["dry-run"],
    env: adminToken ? { OMNIFM_LIVE_ADMIN_TOKEN: adminToken } : {},
  });
}

function printRollbackPlan() {
  console.log(`
Rollback plan:

1. Stop risky rollout activity.
   - Do not run additional update or CLI write operations.
   - Capture current commit: git rev-parse --short HEAD.

2. Roll code back.
   - git fetch origin
   - git checkout <known-good-commit-or-tag>
   - ./start.sh

3. Runtime files.
   - Restore JSON runtime files from the latest verified backup only when the incident is data-related.
   - Keep stations.json under Git ownership; do not overwrite it from runtime backups unless explicitly intended.

4. MongoDB and migrations.
   - Prefer forward fixes for already-applied Mongo changes.
   - If a backup restore is required, run ./stop.sh first, restore Mongo, then run ./start.sh.

5. Verification.
   - OMNIFM_LIVE_ADMIN_TOKEN="$API_ADMIN_TOKEN" node scripts/release-gate.mjs --post-deploy --base-url https://omnifm.xyz
   - Check /admin, /api/health, the live-smoke workflow, and logs/backend.log, logs/frontend.log, logs/bot.log.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["unsafe-token-argument"]) {
    log("FAIL", "--admin-token is not accepted because command-line arguments can expose credentials. Set OMNIFM_LIVE_ADMIN_TOKEN instead.");
    process.exitCode = 1;
    return;
  }
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
