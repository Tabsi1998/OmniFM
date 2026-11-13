import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStationAlert,
  createStationOutageAlerter,
  isStationOutageConfirmed,
  stationAlertSettings,
  STATION_COCKPIT_URL,
} from "../src/services/operator-alerts.js";
import { applyOperatorAlertSettingsToEnv } from "../src/services/operator-alert-settings.js";
import { buildOperatorPayload, operatorAllowedMentions } from "../src/services/operator-webhook.js";
import { checkStation } from "../src/services/station-health.js";
import { mp3Frames, withStreamServer } from "./support/stream-probe-server.mjs";

// #550: a catalog station that stays out reaches the operator webhook once,
// bundled with the others, and once more when it plays again.

const MINUTE = 60_000;
const START = 1_700_000_000_000;
const SETTINGS = { confirmChecks: 3, confirmMs: 15 * MINUTE, cooldownMs: 15 * MINUTE };

function down(key, { failures = 3, forMs = 20 * MINUTE, at = START, reachable = false, error = "Timeout nach 8000 ms", ...rest } = {}) {
  return {
    key, name: `Sender ${key}`, status: "down", reachable, error,
    consecutiveFailures: failures, downSince: at - forMs, lastCheckedAt: at, outageAlerted: false, ...rest,
  };
}

function up(key, rest = {}) {
  return { key, name: `Sender ${key}`, status: "up", consecutiveFailures: 0, downSince: null, lastCheckedAt: START, outageAlerted: false, ...rest };
}

function alerter({ env = {}, at = START } = {}) {
  const sent = [];
  const time = { at };
  const instance = createStationOutageAlerter({
    env,
    now: () => time.at,
    send: async (key, embed) => { sent.push({ key, embed }); },
  });
  return { sent, time, flush: (entries) => instance.flush(entries) };
}

test("an outage counts only after enough checks over enough time", () => {
  assert.equal(isStationOutageConfirmed(down("a", { failures: 3, forMs: 15 * MINUTE }), SETTINGS), true);
  assert.equal(isStationOutageConfirmed(down("a", { failures: 2, forMs: 40 * MINUTE }), SETTINGS), false, "two checks are a wobble");
  assert.equal(isStationOutageConfirmed(down("a", { failures: 5, forMs: 10 * MINUTE }), SETTINGS), false, "ten minutes are a wobble");
  assert.equal(isStationOutageConfirmed(up("a"), SETTINGS), false);
});

test("the limits come from the environment, with defaults", () => {
  assert.deepEqual(stationAlertSettings({}), SETTINGS);
  assert.deepEqual(stationAlertSettings({
    OPERATOR_STATION_ALERT_CHECKS: "5", OPERATOR_STATION_ALERT_MIN_MS: "600000", OPERATOR_STATION_ALERT_COOLDOWN_MS: "60000",
  }), { confirmChecks: 5, confirmMs: 10 * MINUTE, cooldownMs: MINUTE });
});

test("every confirmed outage and every return goes out in one message", async () => {
  const { sent, flush } = alerter();
  const marks = await flush([
    down("a"),
    down("b", { reachable: true, error: "HTTP 403 (Zugriff verweigert)" }),
    down("c", { reachable: true, error: "Kein Audio (HTML-Seite)" }),
    down("wobble", { failures: 2 }),
    up("back", { outageAlerted: true }),
    up("fine"),
  ]);
  assert.equal(sent.length, 1);
  const text = sent[0].embed.description;
  assert.match(text, /\*\*Sender a\*\* \(`a`\): offline – Timeout nach 8000 ms/);
  assert.match(text, /\*\*Sender b\*\* \(`b`\): nicht spielbar – HTTP 403 \(Zugriff verweigert\)/);
  assert.match(text, /\*\*Sender c\*\* \(`c`\): nicht spielbar – Kein Audio \(HTML-Seite\)/);
  assert.match(text, /Wieder spielbar \(1\)[\s\S]*\*\*Sender back\*\*/);
  assert.doesNotMatch(text, /wobble|Sender fine/);
  assert.ok(text.includes(STATION_COCKPIT_URL), "links the station cockpit of the owner console");
  assert.match(STATION_COCKPIT_URL, /\/admin\?section=stations$/);
  assert.deepEqual(marks, [
    { key: "a", outageAlerted: true },
    { key: "b", outageAlerted: true },
    { key: "c", outageAlerted: true },
    { key: "back", outageAlerted: false },
  ]);
});

test("a station out for 15 minutes alerts once, and once more when it is back", async () => {
  const { sent, time, flush } = alerter();
  const failing = async () => { throw new Error("connect failed"); };
  let entry;
  const run = async (fetchImpl) => {
    entry = await checkStation("gone", "Gone FM", "http://radio.test/gone", { fetchImpl, previous: entry, now: time.at });
    for (const mark of await flush([entry])) entry.outageAlerted = mark.outageAlerted;
    time.at += 5 * MINUTE;
  };

  // eslint-disable-next-line no-await-in-loop -- the checks follow each other in time
  for (let check = 0; check < 3; check += 1) await run(failing); // 0, 5, 10 min
  assert.equal(sent.length, 0, "three checks within ten minutes stay quiet");
  await run(failing); // 15 min
  assert.equal(sent.length, 1);
  assert.match(sent[0].embed.title, /ausgefallen/);
  assert.match(sent[0].embed.description, /Gone FM\*\* \(`gone`\): offline – connect failed/);
  // eslint-disable-next-line no-await-in-loop -- the checks follow each other in time
  for (let check = 0; check < 4; check += 1) await run(failing);
  assert.equal(sent.length, 1, "no second alert while it stays out");

  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(mp3Frames());
  }, async (playing) => {
    await run(playing);
    assert.equal(sent.length, 2);
    assert.match(sent[1].embed.description, /Wieder spielbar \(1\)[\s\S]*Gone FM/);
    time.at += 30 * MINUTE;
    await run(playing);
  });
  assert.equal(sent.length, 2, "exactly one return line");
});

test("the health check keeps when an outage started and whether it was reported", async () => {
  const failing = async () => { throw new Error("connect failed"); };
  const first = await checkStation("keep", "Keep FM", "http://radio.test/keep", { fetchImpl: failing, now: START });
  assert.equal(first.downSince, START);
  assert.equal(first.outageAlerted, false);
  const second = await checkStation("keep", "Keep FM", "http://radio.test/keep", {
    fetchImpl: failing, previous: { ...first, outageAlerted: true }, now: START + 5 * MINUTE,
  });
  assert.deepEqual([second.downSince, second.outageAlerted, second.consecutiveFailures], [START, true, 2]);
});

test("a short wobble reports nothing", async () => {
  const { sent, flush } = alerter();
  await flush([down("a", { failures: 2, forMs: 5 * MINUTE })]);
  await flush([up("a")]);
  assert.equal(sent.length, 0);
});

test("within the cooldown new outages wait and go out together afterwards", async () => {
  const { sent, time, flush } = alerter();
  assert.equal((await flush([down("a")])).length, 1);
  time.at += 5 * MINUTE;
  assert.deepEqual(await flush([down("a", { outageAlerted: true }), down("b")]), [], "nothing marked while waiting");
  assert.equal(sent.length, 1);
  time.at += 10 * MINUTE;
  assert.deepEqual(await flush([down("a", { outageAlerted: true }), down("b"), down("c")]), [
    { key: "b", outageAlerted: true },
    { key: "c", outageAlerted: true },
  ]);
  assert.equal(sent.length, 2);
});

test("switched off in the environment nothing is sent and nothing is marked as sent", async () => {
  const { sent, flush } = alerter({ env: { OPERATOR_ALERT_STATIONS: "0" } });
  const marks = await flush([down("a"), up("old", { outageAlerted: true })]);
  assert.equal(sent.length, 0);
  assert.deepEqual(marks, [{ key: "old", outageAlerted: false }], "an old outage is closed quietly");
});

test("the owner console switch turns the station alerts off", async () => {
  const env = applyOperatorAlertSettingsToEnv({ stationOutages: false }, {});
  assert.equal(env.OPERATOR_ALERT_STATIONS, "0");
  const { sent, flush } = alerter({ env });
  await flush([down("a")]);
  assert.equal(sent.length, 0);
  assert.equal(applyOperatorAlertSettingsToEnv({ stationOutages: true }, {}).OPERATOR_ALERT_STATIONS, "1");
});

test("after a restart a reported outage is not reported again", async () => {
  // What the health document holds after the restart: outageAlerted is stored.
  const { sent, flush } = alerter();
  assert.deepEqual(await flush([down("a", { outageAlerted: true, failures: 9, forMs: 60 * MINUTE })]), []);
  assert.equal(sent.length, 0);
});

test("many stations are cut to Discord's limits with 'und N weitere'", () => {
  const long = "Ein sehr langer Sendername mit **Sternchen** und `Backticks` ".repeat(4);
  const many = Array.from({ length: 200 }, (_, index) => down(`station-${index}`, { name: `${long}${index}`, error: "x".repeat(300) }));
  const back = Array.from({ length: 150 }, (_, index) => up(`back-${index}`, { name: `${long}${index}` }));
  const embed = buildStationAlert({ down: many, back }, { now: START });
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096, `description has ${embed.description.length} characters`);
  const total = embed.title.length + embed.description.length + (embed.fields || []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  assert.ok(total <= 6000 - 200, "room for the footer");
  const [, shownDown, moreDown] = embed.description.match(/Ausgefallen \(200\)\*\*\n([\s\S]*?)… und (\d+) weitere/) || [];
  assert.ok(shownDown, "the outage list is cut");
  assert.equal(shownDown.trim().split("\n").length + Number(moreDown), 200);
  assert.match(embed.description, /Wieder spielbar \(150\)[\s\S]*… und \d+ weitere/);
  assert.ok(embed.description.includes(STATION_COCKPIT_URL), "the link survives the cut");
  assert.doesNotMatch(embed.description, /\*\*Sternchen\*\*/, "names cannot break the formatting");
});

test("the alert pings the configured mention and nobody else", () => {
  const embed = buildStationAlert({ down: [down("a", { name: "@everyone <@&1> FM" })], back: [] }, { now: START });
  const role = buildOperatorPayload(embed, { mention: "<@&123456789012345678>" });
  assert.equal(role.content, "<@&123456789012345678>");
  assert.deepEqual(role.allowed_mentions, { parse: [], users: [], roles: ["123456789012345678"] });
  assert.deepEqual(operatorAllowedMentions("<@!42> <@43>"), { parse: [], users: ["42", "43"], roles: [] });
  assert.deepEqual(operatorAllowedMentions("@here"), { parse: ["everyone"], users: [], roles: [] });
  const none = buildOperatorPayload(embed, { mention: "" });
  assert.equal(none.content, undefined);
  assert.deepEqual(none.allowed_mentions, { parse: [], users: [], roles: [] });
  assert.equal(none.embeds[0].description, embed.description);
});

test("after a restart the stored mark keeps an outage from being reported twice (MongoDB)", {
  skip: !String(process.env.MONGO_URL || "").trim(),
}, async (t) => {
  const { close: closeDb, connect: connectDb, getDb } = await import("../src/lib/db.js");
  const health = await import("../src/services/station-health.js");
  await connectDb();
  t.after(async () => {
    await getDb().collection("station_health").deleteMany({ key: /^restart-/ }).catch(() => null);
    await closeDb().catch(() => null);
  });

  await health.recordStationHealth(down("restart-a"));
  const before = alerter();
  await health.reportStationAlerts(before);
  assert.equal(before.sent.length, 1);
  const stored = await getDb().collection("station_health").findOne({ key: "restart-a" });
  assert.equal(stored.outageAlerted, true, "the mark is in the health document");

  // A new module instance is a new process: an empty report, read from MongoDB.
  const restarted = await import("../src/services/station-health.js?restart");
  await restarted.hydrateHealthReport();
  const after = alerter();
  await restarted.reportStationAlerts(after);
  assert.equal(after.sent.length, 0, "no second outage alert after the restart");

  await restarted.recordStationHealth(up("restart-a", { outageAlerted: true }));
  await restarted.reportStationAlerts(after);
  assert.equal(after.sent.length, 1);
  assert.match(after.sent[0].embed.description, /Wieder spielbar \(1\)/);
  assert.equal((await getDb().collection("station_health").findOne({ key: "restart-a" })).outageAlerted, false);
});
