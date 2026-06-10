import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function expectIncludes(text, needle, label) {
  assert.equal(text.includes(needle), true, label ?? `Expected to find ${needle}`);
}

function expectMatches(text, pattern, label) {
  assert.match(text, pattern, label);
}

test("github automation files and docs stay in sync", async () => {
  const requiredFiles = [
    ".github/workflows/ci.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/dependency-review.yml",
    ".github/workflows/live-smoke.yml",
    ".github/workflows/nightly.yml",
    ".github/dependabot.yml",
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
  ];

  for (const file of requiredFiles) {
    assert.equal(await exists(file), true, `${file} is missing`);
  }

  const ci = await readText(".github/workflows/ci.yml");
  expectIncludes(ci, "concurrency:", "ci concurrency missing");
  expectIncludes(ci, "workflow_dispatch:", "ci workflow_dispatch missing");
  expectIncludes(ci, "node-version: [22, 24]", "ci matrix missing Node 22/24");
  expectMatches(ci, /actions\/upload-artifact@v\d+/, "ci artifact upload missing");
  expectIncludes(ci, "mongo-smoke:", "ci mongo smoke job missing");
  expectIncludes(ci, "frontend-build:", "ci frontend job missing");
  expectIncludes(ci, "docker-build:", "ci docker job missing");
  expectIncludes(ci, "npm run test:repo-hygiene", "ci repo hygiene check missing");
  expectIncludes(ci, "Python backend under backend/ is archived legacy/reference code", "ci legacy Python decision missing");

  const nightly = await readText(".github/workflows/nightly.yml");
  expectIncludes(nightly, "schedule:", "nightly schedule missing");
  expectIncludes(nightly, "workflow_dispatch:", "nightly dispatch missing");
  expectIncludes(nightly, "node-version: [22, 24]", "nightly matrix missing Node 22/24");
  expectMatches(nightly, /actions\/upload-artifact@v\d+/, "nightly artifact upload missing");
  expectIncludes(nightly, "recovery-focus:", "nightly recovery job missing");

  const liveSmoke = await readText(".github/workflows/live-smoke.yml");
  expectIncludes(liveSmoke, "schedule:", "live smoke schedule missing");
  expectIncludes(liveSmoke, "workflow_dispatch:", "live smoke dispatch missing");
  expectIncludes(liveSmoke, "https://omnifm.xyz", "live smoke default domain missing");
  expectIncludes(liveSmoke, "OMNIFM_LIVE_ADMIN_TOKEN", "live smoke secret missing");
  expectIncludes(liveSmoke, "scripts/phase6-live-check.mjs", "live smoke script missing");
  expectIncludes(liveSmoke, "--skip-logs", "live smoke should skip local Docker log scan in GitHub Actions");
  expectIncludes(liveSmoke, "skip_authenticated_api", "live smoke public-only diagnostic input missing");
  expectMatches(liveSmoke, /actions\/upload-artifact@v\d+/, "live smoke artifact upload missing");

  const liveCheck = await readText("scripts/phase6-live-check.mjs");
  expectIncludes(liveCheck, "inspectCoreRoutes", "live check core route inspection missing");
  expectIncludes(liveCheck, "/api/health", "live check health API missing");
  expectIncludes(liveCheck, "/api/stations", "live check stations API missing");
  expectIncludes(liveCheck, "/api/bots", "live check bots API missing");
  expectIncludes(liveCheck, "/api/legal", "live check legal API missing");
  expectIncludes(liveCheck, "/app.js", "live check legacy app asset probe missing");
  expectIncludes(liveCheck, "/styles.css", "live check legacy stylesheet probe missing");

  const releaseGate = await readText("scripts/release-gate.mjs");
  expectIncludes(releaseGate, "--preflight", "release gate preflight option missing");
  expectIncludes(releaseGate, "--post-deploy", "release gate post-deploy option missing");
  expectIncludes(releaseGate, "--rollback-plan", "release gate rollback plan option missing");
  expectIncludes(releaseGate, "dependency audit", "release gate audit assessment missing");
  expectIncludes(releaseGate, "phase6-live-check.mjs", "release gate live smoke hook missing");

  const releaseProcess = await readText("docs/release-process.md");
  expectIncludes(releaseProcess, "npm run release:preflight", "release process preflight command missing");
  expectIncludes(releaseProcess, "Rollback", "release process rollback section missing");
  expectIncludes(releaseProcess, "OMNIFM_LAST_LIVE_SMOKE_STATUS", "release process live smoke metadata missing");

  const packageJson = await readText("package.json");
  expectIncludes(packageJson, "release:preflight", "package release preflight script missing");
  expectIncludes(packageJson, "release:postdeploy", "package release postdeploy script missing");
  expectIncludes(packageJson, "release:rollback-plan", "package release rollback script missing");

  const dockerfile = await readText("Dockerfile");
  expectIncludes(dockerfile, "FROM node:24-slim AS frontend-builder", "Docker frontend builder must stay on Node 24");
  expectIncludes(dockerfile, "FROM node:22-slim", "Docker runtime image missing");

  const codeql = await readText(".github/workflows/codeql.yml");
  expectIncludes(codeql, "workflow_dispatch:", "codeql workflow_dispatch missing");
  expectIncludes(codeql, "schedule:", "codeql schedule missing");
  expectIncludes(codeql, "code-scanning/alerts", "codeql preflight missing");
  expectIncludes(codeql, "Code scanning unavailable", "codeql skip notice missing");
  expectIncludes(codeql, "github/codeql-action/init@v4", "codeql init missing");
  expectIncludes(codeql, "github/codeql-action/analyze@v4", "codeql analyze missing");

  const dependencyReview = await readText(".github/workflows/dependency-review.yml");
  expectIncludes(dependencyReview, "Dependency review disabled", "dependency review disabled notice missing");
  assert.equal(
    dependencyReview.includes("actions/dependency-review-action@v4"),
    false,
    "dependency review action should not run on this repo"
  );

  const dependabot = await readText(".github/dependabot.yml");
  expectIncludes(dependabot, "package-ecosystem: github-actions", "dependabot actions config missing");
  expectIncludes(dependabot, "directory: /frontend", "dependabot frontend config missing");
  expectIncludes(dependabot, "dependency-name: \"react\"", "dependabot React major ignore missing");
  expectIncludes(dependabot, "dependency-name: \"react-dom\"", "dependabot ReactDOM major ignore missing");
  expectIncludes(dependabot, "version-update:semver-major", "dependabot major-version ignore policy missing");

  const codeowners = await readText(".github/CODEOWNERS");
  expectIncludes(codeowners, "* @Tabsi1998", "CODEOWNERS default owner missing");
  expectIncludes(codeowners, "/.github/ @Tabsi1998", "CODEOWNERS GitHub owner missing");
  expectIncludes(codeowners, "/src/ @Tabsi1998", "CODEOWNERS src owner missing");

  const issueConfig = await readText(".github/ISSUE_TEMPLATE/config.yml");
  expectIncludes(issueConfig, "blank_issues_enabled: false", "issue template config should disable blank issues");

  const bugTemplate = await readText(".github/ISSUE_TEMPLATE/bug_report.yml");
  expectIncludes(bugTemplate, "title: \"[Bug]: \"", "bug issue template missing title prefix");

  const featureTemplate = await readText(".github/ISSUE_TEMPLATE/feature_request.yml");
  expectIncludes(featureTemplate, "title: \"[Feature]: \"", "feature issue template missing title prefix");

  const readme = await readText("README.md");
  expectIncludes(readme, "## GitHub Automation", "README GitHub automation section missing");
  expectIncludes(readme, "Recommended required checks for `main`", "README required checks note missing");
  expectIncludes(readme, "`ci`", "README required ci check missing");
  expectIncludes(readme, "`codeql`", "README codeql check missing");
  expectIncludes(readme, "npm run test:repo-hygiene", "README repo hygiene check missing");
  expectIncludes(readme, "https://github.com/Tabsi1998/OmniFM.git", "README canonical remote missing");
  expectIncludes(readme, "`stations.json` is intentionally versioned", "README station catalog ownership missing");
  expectIncludes(readme, "OMNIFM_RUN_LEGACY_BACKEND_TESTS=1", "README legacy Python opt-in missing");
  expectIncludes(readme, "VOICE_CHANNEL_STATUS_REFRESH_MS", "README voice channel refresh setting missing");
  expectIncludes(readme, "Release, Update, and Rollback Process", "README release process docs link missing");

  const backendReadme = await readText("backend/README.md");
  expectIncludes(backendReadme, "archived as a legacy/reference implementation", "backend README legacy status missing");
  expectIncludes(backendReadme, "not part of the CI release gate", "backend README CI status missing");
  expectIncludes(backendReadme, "OMNIFM_RUN_LEGACY_BACKEND_TESTS=1", "backend README opt-in missing");

  const backendRequirements = await readText("backend/requirements.txt");
  expectIncludes(backendRequirements, "Legacy/reference backend only", "backend requirements legacy note missing");
  for (const packageName of ["fastapi", "uvicorn", "python-dotenv", "pymongo", "requests", "pytest"]) {
    expectMatches(backendRequirements, new RegExp(`^${packageName}==`, "m"), `backend requirements missing ${packageName}`);
  }
  assert.equal(
    backendRequirements.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).length,
    6,
    "backend requirements should stay minimal"
  );

  const backendConftest = await readText("backend/tests/conftest.py");
  expectIncludes(backendConftest, "OMNIFM_RUN_LEGACY_BACKEND_TESTS", "backend tests opt-in guard missing");
  expectIncludes(backendConftest, "pytest.exit", "backend tests should not silently skip by default");

  const envExample = await readText(".env.example");
  expectIncludes(envExample, "VOICE_CHANNEL_STATUS_ENABLED=1", "voice channel status flag missing");
  expectIncludes(envExample, "VOICE_CHANNEL_STATUS_TEMPLATE=🔊 | 24/7 {station}", "voice channel status template missing");
  expectIncludes(envExample, "VOICE_CHANNEL_STATUS_REFRESH_MS=900000", "voice channel status refresh missing");
  expectIncludes(envExample, "VOICE_STATE_RECONCILE_ENABLED=1", "voice reconcile flag missing");
  expectIncludes(envExample, "VOICE_STATE_RECONCILE_MS=30000", "voice reconcile interval missing");
  expectIncludes(envExample, "VOICE_MOVE_POLICY=return", "voice move policy missing");
  expectIncludes(envExample, "VOICE_MOVE_CONFIRMATIONS=2", "voice move confirmations missing");
  expectIncludes(envExample, "VOICE_MOVE_RETURN_COOLDOWN_MS=15000", "voice move return cooldown missing");
  expectIncludes(envExample, "VOICE_MOVE_WINDOW_MS=120000", "voice move window missing");
  expectIncludes(envExample, "VOICE_MOVE_MAX_EVENTS_PER_WINDOW=4", "voice move max events missing");
  expectIncludes(envExample, "VOICE_MOVE_ESCALATION=disconnect", "voice move escalation missing");
  expectIncludes(envExample, "VOICE_MOVE_ESCALATION_COOLDOWN_MS=600000", "voice move escalation cooldown missing");
  expectIncludes(envExample, "STREAM_RESTART_BASE_MS=1000", "stream restart base missing");
  expectIncludes(envExample, "STREAM_RESTART_MAX_MS=120000", "stream restart max missing");
  expectIncludes(envExample, "STREAM_ERROR_COOLDOWN_THRESHOLD=8", "stream cooldown threshold missing");
  expectIncludes(envExample, "STREAM_ERROR_COOLDOWN_MS=60000", "stream cooldown ms missing");
  expectIncludes(envExample, "VOICE_RECONNECT_MAX_MS=120000", "voice reconnect max missing");
});
