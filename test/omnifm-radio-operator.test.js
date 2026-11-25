import test from "node:test";
import assert from "node:assert/strict";

// The operator hears about every OmniFM Radio show (#592): one message when
// DJ Tabsi goes live, one when the show ends, each with its own switch.
import { alertRadioLive, buildRadioLiveAlert, formatShowDuration } from "../src/services/operator-alerts.js";
import { applyOperatorAlertSettingsToEnv } from "../src/services/operator-alert-settings.js";

const MINUTE = 60_000;
const start = { type: "start", show: { streamerName: "DJ Tabsi", title: "Abendshow", startedAt: "2026-11-25T20:00:00.000Z", source: "webhook" } };
const end = {
  type: "end",
  show: { ...start.show, endedAt: "2026-11-25T21:12:00.000Z", durationMs: 72 * MINUTE },
};

test("show lengths read like a person would say them", () => {
  assert.equal(formatShowDuration(72 * MINUTE), "1 h 12 min");
  assert.equal(formatShowDuration(60 * MINUTE), "1 h");
  assert.equal(formatShowDuration(5 * MINUTE), "5 min");
  assert.equal(formatShowDuration(125 * MINUTE + 20_000), "2 h 5 min");
  assert.equal(formatShowDuration(20_000), "unter 1 min");
  assert.equal(formatShowDuration(-5), "unter 1 min");
});

test("the start message names the DJ and the title", () => {
  const { key, embed } = buildRadioLiveAlert(start);
  assert.equal(embed.title, "🔴 Live gestartet: DJ Tabsi – Abendshow");
  assert.match(key, /^radio-live-start:/);
  assert.equal(buildRadioLiveAlert({ type: "start", show: { ...start.show, title: "" } }).embed.title, "🔴 Live gestartet: DJ Tabsi");
  assert.equal(buildRadioLiveAlert({ type: "start", show: { ...start.show, streamerName: "", title: "" } }).embed.title, "🔴 Live gestartet");
});

test("the end message says how long the show was", () => {
  const { key, embed } = buildRadioLiveAlert(end);
  assert.equal(embed.title, "Sendung beendet nach 1 h 12 min");
  assert.match(embed.description, /DJ Tabsi – Abendshow/);
  assert.notEqual(key, buildRadioLiveAlert(start).key, "start and end never swallow each other");
});

test("a test show says so first, also in a push preview", () => {
  const { embed } = buildRadioLiveAlert({ type: "start", show: { ...start.show, source: "test" } });
  assert.ok(embed.title.startsWith("🧪 Test-Sendung: "), embed.title);
  assert.equal(embed.title, "🧪 Test-Sendung: 🔴 Live gestartet: DJ Tabsi – Abendshow");
  assert.match(embed.description, /Test-Sendung/);
  const ended = buildRadioLiveAlert({ type: "end", show: { ...end.show, source: "test" } });
  assert.equal(ended.embed.title, "🧪 Test-Sendung: Sendung beendet nach 1 h 12 min");
  assert.doesNotMatch(buildRadioLiveAlert(start).embed.title, /Test/);
  assert.doesNotMatch(buildRadioLiveAlert(start).embed.description || "", /Test-Sendung/);
});

test("DJ names from AzuraCast cannot format or overflow the message", () => {
  const { embed } = buildRadioLiveAlert({ type: "start", show: { ...start.show, streamerName: "**DJ** `x`", title: "y".repeat(400) } });
  assert.ok(embed.title.length <= 256, "Discord allows 256 characters in a title");
  assert.match(embed.title, /\\\*\\\*DJ\\\*\\\* \\`x\\`/);
});

test("the operator message goes out once per event and can be switched off", async () => {
  const sent = [];
  const send = async (key, embed) => { sent.push({ key, embed }); return true; };
  assert.equal(await alertRadioLive(start, {}, send), true);
  assert.equal(await alertRadioLive(end, {}, send), true);
  assert.deepEqual(sent.map((entry) => entry.embed.title), ["🔴 Live gestartet: DJ Tabsi – Abendshow", "Sendung beendet nach 1 h 12 min"]);

  const off = applyOperatorAlertSettingsToEnv({ radioLive: false }, {});
  assert.equal(off.OPERATOR_ALERT_RADIO_LIVE, "0");
  assert.equal(await alertRadioLive(start, off, send), false);
  assert.equal(sent.length, 2);
});
