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
    for (let i = 0; i < 50; i += 1) {
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

  // Four processes with 50 writes each: every single write must survive (#223).
  await Promise.all(["a", "b", "c", "d"].map((prefix) => execFileAsync(
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
      timeout: 60000,
    }
  )));

  const payload = JSON.parse(await fs.readFile(tempDashboardFile, "utf8"));
  assert.equal(Object.keys(payload.oauthStates || {}).length, 200);
  for (const prefix of ["a", "b", "c", "d"]) {
    assert.equal(payload.oauthStates[`${prefix}-0`]?.language, "de");
    assert.equal(payload.oauthStates[`${prefix}-49`]?.origin, "https://app.example");
  }
});

test("a store file that cannot be read is never replaced by the older backup", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-dashboard-strict-"));
  const storeFile = path.join(tempDir, "dashboard.json");
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const moduleUrl = pathToFileURL(path.join(repoRoot, "src", "dashboard-store.js")).href;
  // Newest state in the store, an older one in the backup; the store stays
  // unreadable (EACCES) for the whole write attempt.
  const script = `
    const fs = (await import("node:fs")).default;
    const file = process.env.OMNIFM_DASHBOARD_FILE;
    fs.writeFileSync(file, JSON.stringify({ oauthStates: { newest: { nextPage: "dashboard", language: "de", origin: "https://a.example", createdAt: 1, expiresAt: 9999999999 } } }));
    fs.writeFileSync(file + ".bak", JSON.stringify({ oauthStates: {} }));
    const mod = await import(process.env.M);
    const original = fs.readFileSync;
    fs.readFileSync = function (target, ...rest) {
      if (String(target) === file) { const e = new Error("EACCES"); e.code = "EACCES"; throw e; }
      return original.call(this, target, ...rest);
    };
    let threw = false;
    try {
      mod.setDashboardOauthState("later", { nextPage: "dashboard", language: "de", origin: "https://a.example", createdAt: 1, expiresAt: 9999999999 });
    } catch { threw = true; }
    fs.readFileSync = original;
    console.log(JSON.stringify({ threw, stored: Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).oauthStates) }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    env: { ...process.env, OMNIFM_DASHBOARD_FILE: storeFile, M: moduleUrl },
    timeout: 20000,
  });
  const result = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(result.threw, true, "the write fails loudly");
  assert.deepEqual(result.stored, ["newest"], "the newer entry is still there");
});
