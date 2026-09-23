import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monolithStatePath = path.join(repoRoot, "bot-state.json");
const monolithBackupPath = `${monolithStatePath}.bak`;


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

async function importFreshBotStateModule() {
  const moduleUrl = pathToFileURL(path.join(repoRoot, "src/bot-state.js"));
  moduleUrl.searchParams.set("cacheBust", `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

test("split bot state lazily migrates legacy monolith state on first access", async (t) => {
  const botId = "bot-7";
  const stateDirName = `bot-state-migration-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stateDirPath = path.join(repoRoot, stateDirName);
  const monolithStatePath = path.join(stateDirPath, "bot-state.json");
  const splitDirPath = path.join(stateDirPath, "split");
  const splitStatePath = path.join(splitDirPath, `${botId}.json`);
  const restoreEnv = setEnv({
    BOT_PROCESS_ROLE: "worker",
    BOT_STATE_SPLIT_DIR: splitDirPath,
    OMNIFM_BOT_STATE_FILE: monolithStatePath,
  });

  t.after(() => {
    restoreEnv();
    fs.rmSync(stateDirPath, { recursive: true, force: true });
  });

  fs.rmSync(stateDirPath, { recursive: true, force: true });
  fs.mkdirSync(stateDirPath, { recursive: true });
  fs.writeFileSync(monolithStatePath, JSON.stringify({
    [botId]: {
      "guild-1": {
        channelId: "voice-1",
        stationKey: "rock",
        stationName: "Rock FM",
        volume: 77,
        scheduledEventId: null,
        scheduledEventStopAtMs: 0,
        savedAt: "2026-04-02T12:00:00.000Z",
      },
    },
  }, null, 2), "utf8");

  const botStateModule = await importFreshBotStateModule();
  const migrated = botStateModule.getBotState(botId);

  assert.equal(migrated["guild-1"]?.channelId, "voice-1");
  assert.equal(migrated["guild-1"]?.stationKey, "rock");
  assert.equal(migrated["guild-1"]?.volume, 77);

  assert.equal(fs.existsSync(splitStatePath), true);
  const splitPayload = JSON.parse(fs.readFileSync(splitStatePath, "utf8"));
  assert.equal(splitPayload["guild-1"]?.stationName, "Rock FM");

  const remainingMonolithPayload = JSON.parse(fs.readFileSync(monolithStatePath, "utf8"));
  assert.deepEqual(remainingMonolithPayload, {});
});

test("an emptied split state never revives a stopped target from the shared legacy file", async (t) => {
  const botId = "bot-8";
  const stateDirName = `bot-state-revive-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stateDirPath = path.join(repoRoot, stateDirName);
  const monolithStatePath = path.join(stateDirPath, "bot-state.json");
  const splitDirPath = path.join(stateDirPath, "split");
  const splitStatePath = path.join(splitDirPath, `${botId}.json`);
  const restoreEnv = setEnv({
    BOT_PROCESS_ROLE: "worker",
    BOT_STATE_SPLIT_DIR: splitDirPath,
    OMNIFM_BOT_STATE_FILE: monolithStatePath,
  });

  t.after(() => {
    restoreEnv();
    fs.rmSync(stateDirPath, { recursive: true, force: true });
  });

  fs.rmSync(stateDirPath, { recursive: true, force: true });
  fs.mkdirSync(stateDirPath, { recursive: true });
  const staleEntry = {
    channelId: "voice-9",
    stationKey: "groovesalad",
    stationName: "Groove Salad",
    savedAt: "2026-09-01T12:00:00.000Z",
  };
  fs.writeFileSync(monolithStatePath, JSON.stringify({ [botId]: { "guild-9": staleEntry } }, null, 2), "utf8");

  const botStateModule = await importFreshBotStateModule();
  assert.equal(botStateModule.getBotState(botId)["guild-9"]?.stationKey, "groovesalad", "first access migrates");

  // /stop clears the only target: the split file stays as an empty object.
  botStateModule.clearBotGuild(botId, "guild-9");
  assert.equal(fs.existsSync(splitStatePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(splitStatePath, "utf8")), {});

  // A concurrent process that raced the migration writes the old entry back
  // into the shared file. The next start must not restore it.
  fs.writeFileSync(monolithStatePath, JSON.stringify({ [botId]: { "guild-9": staleEntry } }, null, 2), "utf8");
  const reloaded = await importFreshBotStateModule();
  assert.deepEqual(reloaded.getBotState(botId), {});
});
