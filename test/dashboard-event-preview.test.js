import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardEventConflicts, buildDashboardSchedulePreviewRows } from "../src/api/helpers/events.js";

// The event preview of the server dashboard: the next runs in the server's
// time zone, and a clash only in the same voice channel (from FastAPI's unit
// tests, #291).
const VOICE = "123456789012345678";
const vienna = (day, hour = 20, minute = 0) => Date.parse(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+02:00`);

test("a weekday schedule runs Monday to Friday, in local time", () => {
  const rows = buildDashboardSchedulePreviewRows({
    runAtMs: vienna(4), durationMs: 90 * 60 * 1000, repeat: "weekdays", timeZone: "Europe/Vienna",
  }, 3);
  assert.deepEqual(rows.map((row) => row.startsAtLocal), ["2026-09-04T20:00", "2026-09-07T20:00", "2026-09-08T20:00"]);
  assert.equal(rows[0].endsAtLocal, "2026-09-04T21:30");
});

test("an overlap in the same voice channel is an error; another channel is no clash", () => {
  const existing = (id, name, voiceChannelId) => ({
    id, name, voiceChannelId, runAtMs: vienna(8, 20, 30), durationMs: 60 * 60 * 1000, repeat: "none", timeZone: "Europe/Vienna", enabled: true,
  });
  const conflicts = buildDashboardEventConflicts({
    id: "candidate", name: "Candidate Show", voiceChannelId: VOICE, runAtMs: vienna(8), durationMs: 60 * 60 * 1000, repeat: "none", timeZone: "Europe/Vienna",
  }, [existing("same-channel", "Existing Show", VOICE), existing("other-channel", "Other Channel", "987654321098765432")]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, "error");
  assert.equal(conflicts[0].eventId, "same-channel");
  assert.match(conflicts[0].message, /Existing Show/);
});
