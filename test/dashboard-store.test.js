import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dashboardFile = path.join(repoRoot, "dashboard.json");
const dashboardBackupFile = path.join(repoRoot, "dashboard.json.bak");
const execFileAsync = promisify(execFile);

async function snapshotFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath),
    };
  } catch {
    return {
      exists: false,
      content: null,
    };
  }
}

async function restoreFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await fs.writeFile(filePath, snapshot.content);
    return;
  }
  await fs.rm(filePath, { force: true });
}

test("dashboard oauth state preserves the selected language", async (t) => {
  const dashboardSnapshot = await snapshotFile(dashboardFile);
  const dashboardBackupSnapshot = await snapshotFile(dashboardBackupFile);

  t.after(async () => {
    await restoreFile(dashboardFile, dashboardSnapshot);
    await restoreFile(dashboardBackupFile, dashboardBackupSnapshot);
  });

  await fs.rm(dashboardFile, { force: true });
  await fs.rm(dashboardBackupFile, { force: true });

  const moduleUrl = new URL(`../src/dashboard-store.js?oauth-language=${Date.now()}`, import.meta.url);
  const dashboardStore = await import(moduleUrl);
  const token = `oauth-state-${Date.now()}`;

  dashboardStore.setDashboardOauthState(token, {
    nextPage: "settings",
    language: "de",
    origin: "https://app.example",
    createdAt: 1,
    expiresAt: 9999999999,
  });

  const popped = dashboardStore.popDashboardOauthState(token);

  assert.equal(popped?.language, "de");
  assert.equal(popped?.origin, "https://app.example");
  assert.equal(popped?.nextPage, "settings");
});

test("dashboard file store keeps concurrent oauth writes from separate processes", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-dashboard-concurrency-"));
  const tempDashboardFile = path.join(tempDir, "dashboard.json");
  const dashboardModuleUrl = pathToFileURL(path.join(repoRoot, "src", "dashboard-store.js")).href;
  const writerScript = `
    const mod = await import(process.env.OMNIFM_DASHBOARD_MODULE_URL);
    const prefix = process.env.OMNIFM_TEST_PREFIX;
    for (let i = 0; i < 25; i += 1) {
      mod.setDashboardOauthState(prefix + "-" + i, {
        nextPage: "dashboard",
        language: i % 2 === 0 ? "de" : "en",
        origin: "https://app.example",
        createdAt: 1,
        expiresAt: 9999999999
      });
    }
  `;

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await Promise.all(["a", "b"].map((prefix) => execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", writerScript],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OMNIFM_DASHBOARD_FILE: tempDashboardFile,
        OMNIFM_DASHBOARD_MODULE_URL: dashboardModuleUrl,
        OMNIFM_TEST_PREFIX: prefix,
      },
      timeout: 20000,
    }
  )));

  const payload = JSON.parse(await fs.readFile(tempDashboardFile, "utf8"));
  assert.equal(Object.keys(payload.oauthStates || {}).length, 50);
  assert.equal(payload.oauthStates["a-0"]?.language, "de");
  assert.equal(payload.oauthStates["a-24"]?.origin, "https://app.example");
  assert.equal(payload.oauthStates["b-0"]?.language, "de");
  assert.equal(payload.oauthStates["b-24"]?.origin, "https://app.example");
});
