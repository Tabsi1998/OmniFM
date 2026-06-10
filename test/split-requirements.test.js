import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  analyzeSplitRequirements,
  parseEnvText,
} from "../scripts/check-split-requirements.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function analyze(text, options = {}) {
  return analyzeSplitRequirements(parseEnvText(text), {
    hasSplitCompose: true,
    ...options,
  });
}

test("split mode requires MongoDB configuration before startup", () => {
  const result = analyze(`
BOT_1_TOKEN=commander
BOT_2_TOKEN=worker
COMMANDER_BOT_INDEX=1
OMNIFM_DEPLOYMENT_MODE=split
MONGO_ENABLED=0
MONGO_URL=
`);

  assert.equal(result.ok, false);
  assert.equal(result.mode, "split");
  assert.equal(result.messages.some((message) => message.code === "split_mongo_required"), true);
});

test("split mode passes when MongoDB is explicitly configured", () => {
  const result = analyze(`
BOT_1_TOKEN=commander
BOT_2_TOKEN=worker
COMMANDER_BOT_INDEX=1
OMNIFM_DEPLOYMENT_MODE=split
MONGO_URL=mongodb://mongodb:27017
`);

  assert.equal(result.ok, true);
  assert.equal(result.mongoConfigured, true);
  assert.equal(result.messages.some((message) => message.code === "split_mongo_configured"), true);
});

test("auto mode inherits split MongoDB requirement when multiple bots exist", () => {
  const result = analyze(`
BOT_1_TOKEN=commander
BOT_2_TOKEN=worker
COMMANDER_BOT_INDEX=1
OMNIFM_DEPLOYMENT_MODE=auto
MONGO_ENABLED=0
`);

  assert.equal(result.ok, false);
  assert.equal(result.mode, "split");
  assert.equal(result.messages.find((message) => message.code === "split_mongo_required")?.severity, "fail");
});

test("monolith mode can intentionally run with file fallback stores", () => {
  const result = analyze(`
BOT_1_TOKEN=commander
COMMANDER_BOT_INDEX=1
OMNIFM_DEPLOYMENT_MODE=monolith
MONGO_ENABLED=0
`);

  assert.equal(result.ok, true);
  assert.equal(result.mode, "monolith");
  assert.equal(result.messages.find((message) => message.code === "monolith_file_fallback")?.severity, "warn");
});

test("invalid commander index fails before split startup", () => {
  const result = analyze(`
BOT_1_TOKEN=commander
BOT_2_TOKEN=worker
COMMANDER_BOT_INDEX=9
OMNIFM_DEPLOYMENT_MODE=split
MONGO_URL=mongodb://mongodb:27017
`);

  assert.equal(result.ok, false);
  assert.equal(result.messages.some((message) => message.code === "commander_index_invalid"), true);
});

test("split requirements CLI returns actionable failure text", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-split-"));
  const envFile = path.join(tempDir, ".env");
  await fs.writeFile(envFile, [
    "BOT_1_TOKEN=commander",
    "BOT_2_TOKEN=worker",
    "COMMANDER_BOT_INDEX=1",
    "OMNIFM_DEPLOYMENT_MODE=split",
    "MONGO_ENABLED=0",
    "MONGO_URL=",
    "",
  ].join("\n"));

  try {
    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/check-split-requirements.mjs", "--env-file", envFile], {
        cwd: repoRoot,
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stdout, /FAIL: Split mode requires MongoDB/i);
        return true;
      }
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
