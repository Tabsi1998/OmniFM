import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Advent calendar (#428): a door a day from 1 to 24 December, private,
// in the opener's language, with a station tip the plan plays.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-advent-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const advent = await import("../src/bot/advent-calendar.js");
const { ADVENT_DOORS, ADVENT_LABELS, ADVENT_LANGUAGES } = await import("../src/config/advent-doors.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");

const GUILD = "123456789012345678";
const on = (iso, options = {}) => advent.adventDoorFor({ now: new Date(iso), guildId: GUILD, ...options });

test("24 doors, each in all nine languages; riddles carry their answer; labels complete", () => {
  assert.equal(ADVENT_DOORS.length, 24);
  for (const [index, door] of ADVENT_DOORS.entries()) {
    assert.ok(["fact", "saying", "riddle"].includes(door.kind), `door ${index + 1}`);
    for (const language of ADVENT_LANGUAGES) {
      const text = door.text[language];
      assert.ok(text && text.length <= 300, `door ${index + 1} ${language}`);
      if (door.kind === "riddle") assert.ok(door.answer?.[language], `answer of door ${index + 1} ${language}`);
    }
    if (door.kind !== "riddle") assert.equal(door.answer, undefined, `door ${index + 1} has no answer`);
  }
  const keys = Object.keys(ADVENT_LABELS.en).sort();
  for (const language of ADVENT_LANGUAGES) {
    assert.deepEqual(Object.keys(ADVENT_LABELS[language]).sort(), keys, language);
    assert.ok(ADVENT_LABELS[language].door.includes("{day}"), language);
  }
});

test("the door opens from 1 to 24 December in the server's time zone", () => {
  assert.equal(on("2026-11-30T12:00:00Z"), null);
  assert.equal(on("2026-12-01T12:00:00Z"), 1);
  assert.equal(on("2026-12-24T12:00:00Z"), 24, "the 24th is Christmas Eve, the last door");
  assert.equal(on("2026-12-25T12:00:00Z"), null);
  // 23:30 UTC on 30 November: already 1 December in Vienna, not yet in New York.
  assert.equal(on("2026-11-30T23:30:00Z"), 1);
  assert.equal(on("2026-11-30T23:30:00Z", { settings: { timeZone: "America/New_York" } }), null);
});

test("the switches: the part, the server's and the owner's Advent; the owner's test opens a door any day", () => {
  assert.equal(on("2026-12-05T12:00:00Z", { settings: { seasonDecor: { parts: { adventCalendar: false } } } }), null);
  assert.equal(on("2026-12-05T12:00:00Z", { settings: { seasonDecor: { seasons: { advent: false } } } }), null);
  assert.equal(on("2026-12-05T12:00:00Z", { owner: { enabled: { advent: false } } }), null);
  const test = { test: { preview: "advent-2", guildIds: [GUILD] } };
  assert.equal(on("2026-09-28T12:00:00Z", { owner: test }), 24, "a day past the 24th shows door 24");
  assert.equal(on("2026-10-03T12:00:00Z", { owner: test }), 3);
  assert.equal(on("2026-10-03T12:00:00Z", { owner: { test: { preview: "easter-soon", guildIds: [GUILD] } } }), null);
});

test("the opener's language, English for any other", () => {
  assert.equal(advent.adventLanguage("de"), "de");
  assert.equal(advent.adventLanguage("pt-BR"), "pt");
  assert.equal(advent.adventLanguage("es-419"), "es");
  assert.equal(advent.adventLanguage("en-GB"), "en");
  assert.equal(advent.adventLanguage("ja"), "en");
  assert.equal(advent.adventLanguage(undefined), "en");
});

test("the station tip: Christmas stations first, else wintry genres, the same for everybody that day", () => {
  const plain = { rock: { name: "Rock FM", genre: "Rock" }, ambient: { name: "Drone Zone", genre: "Ambient" }, jazz: { name: "Jazz Lounge", genre: "Jazz" } };
  assert.deepEqual(advent.adventStationTip(plain, 1), { key: "ambient", name: "Drone Zone", genre: "Ambient" });
  assert.equal(advent.adventStationTip(plain, 2).key, "jazz");
  assert.equal(advent.adventStationTip(plain, 3).key, "ambient", "round and round");
  const withChristmas = { ...plain, xmas: { name: "Christmas Lounge", genre: "Lounge", seasons: ["christmas"] } };
  assert.equal(advent.adventStationTip(withChristmas, 7).key, "xmas");
  assert.deepEqual(advent.adventStationTip({ rock: { name: "Rock FM", genre: "Rock" } }, 5).key, "rock");
  assert.equal(advent.adventStationTip({}, 5), null);
});

test("the door: surprise, answer as a spoiler, the tip with 'Play now' only for whoever may play", () => {
  const riddleDay = ADVENT_DOORS.findIndex((door) => door.kind === "riddle") + 1;
  const tip = { key: "xmas", name: "Christmas Lounge", genre: "Lounge" };
  const door = advent.buildAdventDoor({ day: riddleDay, language: "de", tip, canPlay: true });
  const json = JSON.stringify(door.components.map((component) => component.toJSON()));
  assert.ok(door.flags & 64, "only for whoever opened it (ephemeral)");
  assert.match(json, new RegExp(`Türchen ${riddleDay}`));
  assert.match(json, /Lösung: \|\|/);
  assert.match(json, /"custom_id":"np:fav:xmas"/);
  assert.match(json, /Jetzt spielen/);

  const noRight = JSON.stringify(advent.buildAdventDoor({ day: 1, language: "fr", tip, canPlay: false }).components.map((component) => component.toJSON()));
  assert.doesNotMatch(noRight, /np:fav:/, "no play button without the /play right");
  assert.match(noRight, /Case 1/);
  assert.match(noRight, /Station du jour/);
  const noTip = JSON.stringify(advent.buildAdventDoor({ day: 3, language: "en", tip: null }).components.map((component) => component.toJSON()));
  assert.match(noTip, /no station tip for your plan today/);
});

test("the panel gets the door button only while a door is open", () => {
  const base = {
    t: (de) => de, applicationId: null, workerName: "OmniFM 1", planTier: "free",
    station: { name: "Groove Salad", key: "groove", genre: "Ambient", tier: "free" },
    track: { hasTrack: true, headline: "Song", artist: "Artist" },
    playback: { phase: "playing", paused: false, listeners: 3 },
    notices: {},
  };
  const withDoor = JSON.stringify(buildNowPlayingPanel({ ...base, adventDoor: 5 }).components[0].toJSON());
  assert.match(withDoor, /"custom_id":"np:advent"/);
  assert.match(withDoor, /Türchen 5/);
  const without = JSON.stringify(buildNowPlayingPanel({ ...base, adventDoor: null }).components[0].toJSON());
  assert.doesNotMatch(without, /np:advent/);
});
