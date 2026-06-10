import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { rootDir } from "./logging.js";

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    return String(packageJson?.version || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function runGit(args) {
  try {
    const result = spawnSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 2500,
    });
    if (result.status !== 0) return "";
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function firstEnvValue(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function normalizeStatus(value, fallback = "unknown") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["success", "ok", "passed", "green"].includes(normalized)) return "success";
  if (["failed", "failure", "error", "red"].includes(normalized)) return "failed";
  if (["running", "pending", "in_progress"].includes(normalized)) return "running";
  if (["skipped", "disabled"].includes(normalized)) return "skipped";
  return normalized.slice(0, 40);
}

function buildReleaseInfo({ frontendBuildStamp = null, webRootSource = "" } = {}) {
  const fullSha = firstEnvValue(["OMNIFM_RELEASE_SHA", "GITHUB_SHA", "COMMIT_SHA"])
    || runGit(["rev-parse", "HEAD"]);
  const branch = firstEnvValue(["OMNIFM_RELEASE_BRANCH", "GITHUB_REF_NAME", "BRANCH_NAME"])
    || runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const deployedAt = firstEnvValue(["OMNIFM_DEPLOYED_AT", "RELEASE_DEPLOYED_AT"]);
  const lastDeployStatus = normalizeStatus(firstEnvValue(["OMNIFM_LAST_DEPLOY_STATUS", "RELEASE_STATUS"]));
  const lastLiveSmokeStatus = normalizeStatus(firstEnvValue(["OMNIFM_LAST_LIVE_SMOKE_STATUS", "LIVE_SMOKE_STATUS"]));

  return {
    appVersion: readPackageVersion(),
    commit: fullSha ? fullSha.slice(0, 12) : "unknown",
    commitFull: fullSha || "unknown",
    branch: branch || "unknown",
    frontendBuildStamp: frontendBuildStamp || null,
    webRootSource: webRootSource || "",
    deployedAt: deployedAt || null,
    lastDeployStatus,
    lastLiveSmokeStatus,
    releaseGate: {
      preflight: "scripts/release-gate.mjs --preflight",
      postDeploy: "scripts/release-gate.mjs --post-deploy --base-url <url>",
      rollback: "docs/release-process.md#rollback",
    },
    generatedAt: new Date().toISOString(),
  };
}

export {
  buildReleaseInfo,
  normalizeStatus,
};
