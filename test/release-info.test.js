import assert from "node:assert/strict";
import test from "node:test";

import { buildReleaseInfo, normalizeStatus } from "../src/lib/release-info.js";

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("release info prefers explicit deployment metadata", () => {
  const restoreEnv = setEnv({
    OMNIFM_RELEASE_SHA: "abcdef1234567890",
    OMNIFM_RELEASE_BRANCH: "main",
    OMNIFM_DEPLOYED_AT: "2026-06-10T18:00:00.000Z",
    OMNIFM_LAST_DEPLOY_STATUS: "ok",
    OMNIFM_LAST_LIVE_SMOKE_STATUS: "failure",
  });

  try {
    const info = buildReleaseInfo({
      frontendBuildStamp: "2026-06-10T17:00:00.000Z",
      webRootSource: "frontend/build",
    });

    assert.equal(info.appVersion, "3.0.0");
    assert.equal(info.commit, "abcdef123456");
    assert.equal(info.commitFull, "abcdef1234567890");
    assert.equal(info.branch, "main");
    assert.equal(info.deployedAt, "2026-06-10T18:00:00.000Z");
    assert.equal(info.frontendBuildStamp, "2026-06-10T17:00:00.000Z");
    assert.equal(info.webRootSource, "frontend/build");
    assert.equal(info.lastDeployStatus, "success");
    assert.equal(info.lastLiveSmokeStatus, "failed");
    assert.match(info.releaseGate.preflight, /release-gate\.mjs --preflight/);
    assert.match(info.releaseGate.rollback, /release-process\.md#rollback/);
  } finally {
    restoreEnv();
  }
});

test("release status normalization keeps operator labels stable", () => {
  assert.equal(normalizeStatus("green"), "success");
  assert.equal(normalizeStatus("error"), "failed");
  assert.equal(normalizeStatus("in_progress"), "running");
  assert.equal(normalizeStatus("disabled"), "skipped");
  assert.equal(normalizeStatus(""), "unknown");
});
