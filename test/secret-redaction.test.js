import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  REDACTED,
  redactSensitiveData,
  redactSensitiveText,
  sanitizeUrlForLog,
} from "../src/lib/redact-sensitive.js";
import { logError, onLoggedError } from "../src/lib/logging.js";
import { redactOwnerJobOutput } from "../src/lib/owner-job-runner.js";

const SECRET_VALUES = [
  "omni-secret-token-123456789",
  "query-secret-987654321",
  "password-secret-abcdef",
];

function assertDoesNotContainSecret(value) {
  const text = String(value);
  for (const secret of SECRET_VALUES) {
    assert.doesNotMatch(text, new RegExp(secret, "i"));
  }
}

test("central secret redaction removes credentials from text, URLs, and structured values", () => {
  const rawText = [
    `Authorization: Bearer ${SECRET_VALUES[0]}`,
    `url=https://operator:${SECRET_VALUES[2]}@radio.example/live?access_token=${SECRET_VALUES[1]}#fragment`,
    `apiToken=${SECRET_VALUES[0]}`,
  ].join(" ");
  const redactedText = redactSensitiveText(rawText);
  assertDoesNotContainSecret(redactedText);
  assert.match(redactedText, /Authorization: \[redacted]/i);
  assert.match(redactedText, /\?\.\.\./);

  const structured = redactSensitiveData({
    accessToken: SECRET_VALUES[0],
    url: `https://radio.example/live?token=${SECRET_VALUES[1]}`,
    nested: { password: SECRET_VALUES[2] },
  });
  assert.deepEqual(structured.accessToken, REDACTED);
  assert.deepEqual(structured.nested.password, REDACTED);
  assertDoesNotContainSecret(JSON.stringify(structured));

  const safeUrl = sanitizeUrlForLog(`https://user:${SECRET_VALUES[2]}@radio.example/live?token=${SECRET_VALUES[1]}#fragment`);
  assert.equal(safeUrl, "https://***:***@radio.example/live?...");
});

test("logging observers and owner-job output never retain secret-bearing diagnostics", () => {
  let observed = null;
  const unsubscribe = onLoggedError((event) => {
    observed = event;
  });

  try {
    const error = new Error(`provider failed: token=${SECRET_VALUES[0]}`);
    error.endpoint = `https://api.example/test?access_token=${SECRET_VALUES[1]}`;
    const message = logError(`Webhook secret=${SECRET_VALUES[2]}`, error, {
      context: {
        authorization: `Bearer ${SECRET_VALUES[0]}`,
        nested: { password: SECRET_VALUES[2] },
      },
      includeStack: true,
    });

    assert.ok(observed);
    assertDoesNotContainSecret(message);
    assertDoesNotContainSecret(JSON.stringify(observed));

    const jobOutput = redactOwnerJobOutput(
      `\u001b[31mfailed url=https://radio.example/live?token=${SECRET_VALUES[1]} Authorization: Bearer ${SECRET_VALUES[0]}\u001b[0m`
    );
    assertDoesNotContainSecret(jobOutput);
    assert.doesNotMatch(jobOutput, /\u001b\[/);
  } finally {
    unsubscribe();
  }
});

test("release diagnostics reject token command-line arguments without echoing them", () => {
  const sentinel = SECRET_VALUES[0];
  const release = spawnSync(process.execPath, [
    "scripts/release-gate.mjs",
    "--post-deploy",
    "--dry-run",
    "--admin-token",
    sentinel,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(release.status, 1);
  assertDoesNotContainSecret(`${release.stdout}\n${release.stderr}`);

  const dryRun = spawnSync(process.execPath, [
    "scripts/release-gate.mjs",
    "--post-deploy",
    "--dry-run",
    "--skip-logs",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, OMNIFM_LIVE_ADMIN_TOKEN: sentinel },
  });
  assert.equal(dryRun.status, 0);
  assertDoesNotContainSecret(`${dryRun.stdout}\n${dryRun.stderr}`);
  assert.doesNotMatch(`${dryRun.stdout}\n${dryRun.stderr}`, /--admin-token/);

  const phase6 = spawnSync(process.execPath, [
    "scripts/phase6-live-check.mjs",
    "--admin-token",
    sentinel,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(phase6.status, 1);
  assertDoesNotContainSecret(`${phase6.stdout}\n${phase6.stderr}`);
});
