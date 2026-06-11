import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getOwnerLogFileSnapshot,
  getOwnerLogFilesSnapshot,
  isAllowedLogFileName,
  redactLogLine,
  resolveOwnerLogsDir,
} from "../src/lib/owner-log-files.js";

test("owner log files only expose allowed OmniFM log names", () => {
  assert.equal(isAllowedLogFileName("bot.log"), true);
  assert.equal(isAllowedLogFileName("error-2026-06-11T06-00-00-000Z.log"), true);
  assert.equal(isAllowedLogFileName("../.env"), false);
  assert.equal(isAllowedLogFileName("owner-audit.json"), false);
  assert.equal(isAllowedLogFileName("anything.log"), false);
});

test("owner log file snapshots tail logs and redact sensitive values", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-logs-"));
  const previousLogsDir = process.env.OMNIFM_OWNER_LOGS_DIR;
  process.env.OMNIFM_OWNER_LOGS_DIR = dir;

  t.after(async () => {
    if (previousLogsDir == null) delete process.env.OMNIFM_OWNER_LOGS_DIR;
    else process.env.OMNIFM_OWNER_LOGS_DIR = previousLogsDir;
    await fs.rm(dir, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(dir, "bot.log"),
    [
      "[2026-06-11T06:00:00.000Z] [INFO] startup token=abc123456789012345",
      "[2026-06-11T06:00:01.000Z] [ERROR] failed Authorization:Bearer abcdefghijklmnop",
      "plain line secret=must-not-leak",
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(path.join(dir, "debug.log"), "must not be listed", "utf8");

  assert.equal(resolveOwnerLogsDir(), dir);
  const files = await getOwnerLogFilesSnapshot();
  assert.equal(files.total, 1);
  assert.equal(files.files[0].name, "bot.log");

  const snapshot = await getOwnerLogFileSnapshot("bot.log", { lines: 5, bytes: 2000 });
  assert.equal(snapshot.name, "bot.log");
  assert.equal(snapshot.lines.length, 3);
  assert.equal(snapshot.lines[0].level, "INFO");
  assert.equal(snapshot.lines[1].level, "ERROR");
  assert.doesNotMatch(JSON.stringify(snapshot), /abc123456789012345|must-not-leak/);
  assert.match(JSON.stringify(snapshot), /redacted/);
});

test("owner log file snapshots reject path traversal", async () => {
  await assert.rejects(
    () => getOwnerLogFileSnapshot("../.env"),
    /Logdatei ist nicht erlaubt/
  );
});

test("owner log redaction handles bearer and bot tokens", () => {
  const line = redactLogLine("headers Authorization=Bearer abcdefghijklmnop Bot abcdefghijklmnop");
  assert.doesNotMatch(line, /abcdefghijklmnop/);
  assert.match(line, /\[redacted]/);
});
