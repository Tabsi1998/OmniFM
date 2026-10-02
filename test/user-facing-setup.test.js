import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSetupStatusSummary,
  buildVoiceChannelAccessMessage,
} from "../src/lib/user-facing-setup.js";
import { botTranslator } from "../src/lib/bot-i18n.js";

test("setup status summary points to inviting the first worker", () => {
  const summary = buildSetupStatusSummary({
    commanderReady: true,
    invitedWorkerCount: 0,
    maxWorkerSlots: 8,
    voiceChannelCount: 2,
    t: botTranslator("en"),
  });

  assert.equal(summary.command, "/invite");
  assert.match(summary.nextTitle, /invite the first worker/i);
  assert.equal(summary.checklist.length, 3);
});

test("setup status summary points to /play once workers and channels exist", () => {
  const summary = buildSetupStatusSummary({
    commanderReady: true,
    invitedWorkerCount: 1,
    maxWorkerSlots: 8,
    voiceChannelCount: 3,
    t: botTranslator("en"),
  });

  assert.equal(summary.command, "/play");
  assert.match(summary.nextBody, /join a voice channel/i);
});

test("voice channel access message stays actionable for missing speak permission", () => {
  const message = buildVoiceChannelAccessMessage({
    issue: "speak_missing",
    channelLabel: "#radio-live",
    workerName: "Worker 2",
    t: botTranslator("en"),
  });

  assert.match(message, /Worker 2/i);
  assert.match(message, /radio-live/i);
  assert.match(message, /Speak/i);
});
