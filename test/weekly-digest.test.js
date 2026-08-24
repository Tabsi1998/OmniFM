import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWeeklyDigestEmbedData,
  buildWeeklyDigestMeta,
  buildWeeklyDigestPreview,
  computeNextWeeklyDigestRunAt,
  normalizeWeeklyDigestConfig,
  shouldSendWeeklyDigest,
} from "../src/lib/weekly-digest.js";

test("normalizeWeeklyDigestConfig clamps values and limits language", () => {
  const config = normalizeWeeklyDigestConfig({
    enabled: true,
    channelId: " 123 ",
    dayOfWeek: 99,
    hour: -2,
    language: "fr",
  });

  assert.deepEqual(config, {
    enabled: true,
    channelId: "123",
    dayOfWeek: 6,
    hour: 0,
    language: "de",
  });
});

test("computeNextWeeklyDigestRunAt picks the upcoming weekly slot", () => {
  const runAt = computeNextWeeklyDigestRunAt(
    { dayOfWeek: 1, hour: 9 },
    new Date(2026, 2, 8, 10, 15, 0)
  );

  const parsed = new Date(runAt);
  assert.equal(parsed.getDay(), 1);
  assert.equal(parsed.getHours(), 9);
});

test("shouldSendWeeklyDigest only allows configured slots and suppresses duplicate sends", () => {
  const config = normalizeWeeklyDigestConfig({
    enabled: true,
    channelId: "523456789012345678",
    dayOfWeek: 0,
    hour: 10,
    language: "en",
  });
  const now = new Date(2026, 2, 8, 10, 5, 0);

  assert.equal(shouldSendWeeklyDigest(config, { now }), true);
  assert.equal(
    shouldSendWeeklyDigest(config, {
      now,
      lastSentAt: new Date(2026, 2, 8, 9, 20, 0).toISOString(),
    }),
    false
  );

  const meta = buildWeeklyDigestMeta(config, {
    now,
    lastSentAt: new Date(2026, 2, 1, 10, 0, 0).toISOString(),
  });
  assert.equal(meta.ready, true);
  assert.equal(meta.channelConfigured, true);
  const nextRun = new Date(meta.nextRunAt);
  assert.equal(nextRun.getDay(), 0);
  assert.equal(nextRun.getHours(), 10);
  assert.equal(new Date(meta.lastSentAt).getDay(), 0);
});

test("buildWeeklyDigestPreview summarizes weekly stats and top stations", () => {
  const preview = buildWeeklyDigestPreview({
    guildName: "OmniFM Test Guild",
    channelId: "523456789012345678",
    channelName: "announcements",
    language: "en",
    stats: {
      totalListeningMs: 9 * 60 * 60 * 1000,
      totalSessions: 33,
      stationStarts: {
        rock: 7,
        jazz: 3,
      },
      stationNames: {
        rock: "Rock FM",
        jazz: "Jazz FM",
      },
    },
    dailyStats: [
      { totalStarts: 4, totalListeningMs: 3 * 60 * 60 * 1000, totalSessions: 10, peakListeners: 5 },
      { totalStarts: 6, totalListeningMs: 2 * 60 * 60 * 1000, totalSessions: 8, peakListeners: 7 },
    ],
    now: new Date("2026-03-09T10:00:00.000Z"),
  });

  assert.equal(preview.title, "Weekly radio report");
  assert.equal(preview.channelName, "announcements");
  assert.equal(preview.summary.weekStarts, 10);
  assert.equal(preview.summary.weekSessions, 18);
  assert.equal(preview.summary.weekPeak, 7);
  assert.equal(preview.topStations[0].stationName, "Rock FM");
  assert.match(preview.fields[0].value, /h|m/);
});

test("buildWeeklyDigestEmbedData maps preview fields into an embed payload", () => {
  const embed = buildWeeklyDigestEmbedData({
    guildName: "OmniFM Test Guild",
    language: "de",
    stats: {
      totalListeningMs: 60 * 60 * 1000,
      totalSessions: 4,
      stationStarts: {},
    },
    dailyStats: [
      { totalStarts: 2, totalListeningMs: 45 * 60 * 1000, totalSessions: 3, peakListeners: 2 },
    ],
    now: new Date("2026-03-09T10:00:00.000Z"),
  });

  assert.equal(embed.color, 0xFF6B00);
  assert.equal(embed.footer.text, "OmniFM Weekly Digest");
  assert.equal(embed.title, "Woechentlicher Radio-Report");
  assert.ok(Array.isArray(embed.fields));
  assert.equal(embed.fields.length, 7);
});
