import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logError } from "../src/lib/logging.js";
import {
  buildOperatorIncidentSummaryLines,
  getRecentOperatorIncidents,
  installOperatorIncidentRecorder,
  logRecentOperatorIncidentSummary,
  recordOperatorIncident,
  resetOperatorIncidentStateForTests,
  summarizeRecentOperatorIncidents,
} from "../src/operator-incidents-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const storePath = path.join(repoRoot, "operator-incidents.json");
const backupPath = `${storePath}.bak`;

function snapshotOptionalFile(filePath) {
  try {
    return {
      exists: true,
      content: fs.readFileSync(filePath),
    };
  } catch {
    return { exists: false, content: null };
  }
}

function restoreOptionalFile(filePath, snapshot) {
  if (snapshot?.exists) {
    fs.writeFileSync(filePath, snapshot.content);
    return;
  }
  fs.rmSync(filePath, { force: true });
}

test("operator incidents persist normalized fallback entries", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);

  try {
    resetOperatorIncidentStateForTests();

    const stored = await recordOperatorIncident({
      timestamp: "2026-04-21T10:00:00.000Z",
      level: "critical",
      summary: "Worker queue failed",
      message: "Queue worker could not renew lease.",
      source: "worker-manager",
      entry: "worker.js",
      errorCode: "LEASE_TIMEOUT",
      context: {
        source: "worker-manager",
        guildId: "123456789012345678",
      },
      stackLines: ["Error: Worker queue failed", "at worker-manager.js:10:5"],
    });

    assert.equal(stored?.level, "CRITICAL");
    assert.equal(stored?.source, "worker-manager");
    assert.equal(stored?.context?.guildId, "123456789012345678");

    const incidents = await getRecentOperatorIncidents(10);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].summary, "Worker queue failed");
    assert.equal(incidents[0].stackLines.length, 2);
  } finally {
    resetOperatorIncidentStateForTests();
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});

test("operator incidents redact direct secret-bearing input before persistence", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);
  const secret = "operator-incident-secret-123456";

  try {
    resetOperatorIncidentStateForTests();

    const stored = await recordOperatorIncident({
      timestamp: "2026-04-21T10:00:00.000Z",
      summary: `Worker token=${secret} failed`,
      message: `Endpoint https://api.example/status?access_token=${secret}`,
      context: {
        apiToken: secret,
        authorization: `Bearer ${secret}`,
      },
      stackLines: [`Error: password=${secret}`],
    });

    assert.ok(stored);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(secret));
    const incidents = await getRecentOperatorIncidents(10);
    assert.doesNotMatch(JSON.stringify(incidents), new RegExp(secret));
  } finally {
    resetOperatorIncidentStateForTests();
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});

test("operator incident recorder subscribes to logError and deduplicates repeated incidents", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);
  const unsubscribe = installOperatorIncidentRecorder({ entry: "operator-test.js" });

  try {
    resetOperatorIncidentStateForTests();

    logError("[Test] Runtime healthcheck failed", new Error("MongoDB is not connected."), {
      context: {
        source: "dashboard-settings",
        route: "/api/dashboard/settings",
      },
      includeStack: false,
    });
    logError("[Test] Runtime healthcheck failed", new Error("MongoDB is not connected."), {
      context: {
        source: "dashboard-settings",
        route: "/api/dashboard/settings",
      },
      includeStack: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const incidents = await getRecentOperatorIncidents(10);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].summary, "[Test] Runtime healthcheck failed");
    assert.equal(incidents[0].source, "dashboard-settings");
    assert.equal(incidents[0].entry, "operator-test.js");
  } finally {
    unsubscribe();
    resetOperatorIncidentStateForTests();
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});

test("operator incident summaries aggregate recent incidents for owner-facing logs", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);

  try {
    resetOperatorIncidentStateForTests();
    const now = Date.now();

    await recordOperatorIncident({
      timestamp: new Date(now - (3 * 60 * 60 * 1000)).toISOString(),
      level: "error",
      summary: "Mongo ping failed",
      source: "db",
    });
    await recordOperatorIncident({
      timestamp: new Date(now - (2 * 60 * 60 * 1000)).toISOString(),
      level: "warn",
      summary: "Mongo ping failed",
      source: "db",
    });
    await recordOperatorIncident({
      timestamp: new Date(now - (60 * 60 * 1000)).toISOString(),
      level: "critical",
      summary: "Worker queue stalled",
      source: "worker-manager",
    });

    const summary = await summarizeRecentOperatorIncidents({
      sinceMs: 7 * 24 * 60 * 60 * 1000,
      limit: 20,
    });

    assert.equal(summary.total, 3);
    assert.equal(summary.levels.find((entry) => entry.key === "CRITICAL")?.count, 1);
    assert.equal(summary.levels.find((entry) => entry.key === "ERROR")?.count, 1);
    assert.equal(summary.levels.find((entry) => entry.key === "WARN")?.count, 1);
    assert.equal(summary.sources.find((entry) => entry.key === "db")?.count, 2);
    assert.equal(summary.sources.find((entry) => entry.key === "worker-manager")?.count, 1);
    assert.equal(summary.summaries.find((entry) => entry.key === "Mongo ping failed")?.count, 2);
    assert.equal(summary.summaries.find((entry) => entry.key === "Worker queue stalled")?.count, 1);

    const lines = buildOperatorIncidentSummaryLines(summary, { label: "Owner summary" });
    assert.equal(lines.length >= 3, true);
    assert.match(lines[0], /Owner summary/);
    assert.match(lines[1], /levels/i);
    assert.match(lines[2], /sources/i);
  } finally {
    resetOperatorIncidentStateForTests();
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});

test("operator incident summary logger writes nothing when there are no recent incidents", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);

  try {
    resetOperatorIncidentStateForTests();
    const lines = [];

    const summary = await logRecentOperatorIncidentSummary({
      sinceMs: 60_000,
      logger(level, message) {
        lines.push({ level, message });
      },
    });

    assert.equal(summary.total, 0);
    assert.deepEqual(lines, []);
  } finally {
    resetOperatorIncidentStateForTests();
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});
