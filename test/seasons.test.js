import test from "node:test";
import assert from "node:assert/strict";

// The seasons of the decorations (#425): Easter, Advent, Christmas and New
// Year for any year, in a server's time zone.
const seasons = await import("../src/lib/seasons.js");

const at = (iso, timeZone = "Europe/Vienna") => seasons.seasonAt(new Date(iso), timeZone);
const look = (iso, timeZone) => {
  const current = at(iso, timeZone);
  return current ? `${current.season}:${current.phase}${current.candles ? `:${current.candles}` : ""}` : null;
};

test("Easter Sunday by the computus, over many years", () => {
  const known = {
    1818: "03-22", 1943: "04-25", 2000: "04-23", 2011: "04-24", 2019: "04-21", 2024: "03-31", 2025: "04-20",
    2026: "04-05", 2027: "03-28", 2028: "04-16", 2038: "04-25", 2100: "03-28", 2285: "03-22",
  };
  for (const [year, date] of Object.entries(known)) {
    const easter = seasons.easterSunday(Number(year));
    assert.equal(`${String(easter.month).padStart(2, "0")}-${String(easter.day).padStart(2, "0")}`, date, `Easter ${year}`);
  }
  for (let year = 1900; year <= 2400; year += 1) {
    const { month, day } = seasons.easterSunday(year);
    const inRange = (month === 3 && day >= 22) || (month === 4 && day <= 25);
    assert.ok(inRange, `Easter ${year} lies between 22 March and 25 April`);
    assert.equal(new Date(Date.UTC(year, month - 1, day)).getUTCDay(), 0, `Easter ${year} is a Sunday`);
  }
});

test("the first Sunday of Advent lies between 27 November and 3 December", () => {
  assert.deepEqual(seasons.firstAdventSunday(2022), { year: 2022, month: 11, day: 27 });
  assert.deepEqual(seasons.firstAdventSunday(2023), { year: 2023, month: 12, day: 3 });
  assert.deepEqual(seasons.firstAdventSunday(2025), { year: 2025, month: 11, day: 30 });
  assert.deepEqual(seasons.firstAdventSunday(2026), { year: 2026, month: 11, day: 29 });
});

test("Easter runs from Palm Sunday to Easter Monday; the greeting starts on Easter Sunday", () => {
  assert.equal(look("2026-03-28T12:00:00Z"), null);
  assert.equal(look("2026-03-29T12:00:00Z"), "easter:soon");
  assert.equal(look("2026-04-04T12:00:00Z"), "easter:soon");
  assert.equal(look("2026-04-05T12:00:00Z"), "easter:greeting");
  assert.equal(look("2026-04-06T12:00:00Z"), "easter:greeting");
  assert.equal(look("2026-04-07T12:00:00Z"), null);
  // Leap year: Palm Sunday 2024 was 24 March, after 29 February.
  assert.equal(look("2024-02-29T12:00:00Z"), null);
  assert.equal(look("2024-03-23T12:00:00Z"), null);
  assert.equal(look("2024-03-24T12:00:00Z"), "easter:soon");
  assert.equal(look("2024-04-01T12:00:00Z"), "easter:greeting");
});

test("Advent lights one more candle every Sunday until 23 December", () => {
  assert.equal(look("2026-11-28T12:00:00Z"), null);
  assert.equal(look("2026-11-29T12:00:00Z"), "advent:candles:1");
  assert.equal(look("2026-12-05T12:00:00Z"), "advent:candles:1");
  assert.equal(look("2026-12-06T12:00:00Z"), "advent:candles:2");
  assert.equal(look("2026-12-13T12:00:00Z"), "advent:candles:3");
  assert.equal(look("2026-12-20T12:00:00Z"), "advent:candles:4");
  assert.equal(look("2026-12-23T12:00:00Z"), "advent:candles:4");
  // 2023: the fourth Sunday of Advent was 24 December, which already is Christmas.
  assert.equal(look("2023-12-23T12:00:00Z"), "advent:candles:3");
  assert.equal(look("2023-12-24T12:00:00Z"), "christmas:greeting");
});

test("Christmas greets from 24 to 26 December, then only the winter look until the 30th", () => {
  assert.equal(look("2026-12-24T12:00:00Z"), "christmas:greeting");
  assert.equal(look("2026-12-26T12:00:00Z"), "christmas:greeting");
  assert.equal(look("2026-12-27T12:00:00Z"), "christmas:winter");
  assert.equal(look("2026-12-30T12:00:00Z"), "christmas:winter");
});

test("New Year counts down to the server's midnight and greets on 1 January, in every time zone", () => {
  const vienna = at("2026-12-31T22:00:00Z");
  assert.deepEqual([vienna.season, vienna.phase, vienna.year, vienna.secondsToMidnight], ["newyear", "countdown", 2027, 3600]);

  // 23:30 UTC: already 2027 in Vienna and Tokyo, still 18:30 in New York.
  const moment = "2026-12-31T23:30:00Z";
  assert.deepEqual([at(moment).phase, at(moment).year], ["greeting", 2027]);
  assert.deepEqual([at(moment, "Asia/Tokyo").phase, at(moment, "Asia/Tokyo").year], ["greeting", 2027]);
  const newYork = at(moment, "America/New_York");
  assert.deepEqual([newYork.phase, newYork.year, newYork.secondsToMidnight], ["countdown", 2027, 5.5 * 3600]);

  assert.equal(look("2027-01-01T22:00:00Z"), "newyear:greeting", "23:00 in Vienna is still New Year's Day");
  assert.equal(look("2027-01-01T23:30:00Z"), null, "00:30 on 2 January in Vienna");
  assert.equal(look("2027-01-01T23:30:00Z", "America/New_York"), "newyear:greeting");
});

test("the next season to begin, for the dashboard", () => {
  const next = (iso) => seasons.nextSeasonStart(new Date(iso), "Europe/Vienna");
  assert.deepEqual(next("2026-09-28T12:00:00Z"), { season: "advent", year: 2026, month: 11, day: 29 });
  assert.deepEqual(next("2026-11-29T12:00:00Z"), { season: "christmas", year: 2026, month: 12, day: 24 }, "not the season that began today");
  assert.deepEqual(next("2026-12-31T12:00:00Z"), { season: "easter", year: 2027, month: 3, day: 21 });
  assert.deepEqual(next("2027-04-06T12:00:00Z"), { season: "advent", year: 2027, month: 11, day: 28 });
});

test("an unknown time zone counts as Vienna", () => {
  assert.equal(seasons.isValidTimeZone("Europe/Vienna"), true);
  assert.equal(seasons.isValidTimeZone("Mars/Olympus"), false);
  assert.equal(seasons.isValidTimeZone(""), false);
  assert.equal(look("2026-12-31T23:30:00Z", "Mars/Olympus"), "newyear:greeting");
});

test("the switches: everything on unless switched off, junk ignored", () => {
  const defaults = seasons.normalizeSeasonSettings(undefined);
  assert.ok(Object.values(defaults.seasons).every(Boolean) && Object.values(defaults.parts).every(Boolean));
  const some = seasons.normalizeSeasonSettings({ seasons: { advent: false, easter: "no" }, parts: { eggHunt: false, hack: false } });
  assert.deepEqual([some.seasons.advent, some.seasons.easter, some.parts.eggHunt, "hack" in some.parts], [false, true, false, false]);

  const owner = seasons.normalizeOwnerSeasons({
    enabled: { newyear: false },
    test: { preview: "advent-2", guildIds: ["123456789012345678", "123456789012345678", "nope", 42] },
  });
  assert.deepEqual(owner.enabled, { easter: true, advent: true, christmas: true, newyear: false });
  assert.deepEqual(owner.test, { preview: "advent-2", guildIds: ["123456789012345678"] });
  assert.equal(seasons.normalizeOwnerSeasons({ test: { preview: "summer" } }).test.preview, "");
});

test("a server shows the season unless the owner or the server switched it off; the test mode forces a look", () => {
  const guildId = "123456789012345678";
  const advent = new Date("2026-12-06T12:00:00Z");
  assert.equal(seasons.seasonForServer({ now: advent, guildId }).candles, 2);
  assert.equal(seasons.seasonForServer({ now: advent, guildId, owner: { enabled: { advent: false } } }), null);
  assert.equal(seasons.seasonForServer({ now: advent, guildId, server: { seasons: { advent: false } } }), null);
  assert.equal(seasons.seasonForServer({ now: new Date("2026-09-28T12:00:00Z"), guildId }), null);

  const test = { enabled: { easter: false }, test: { preview: "easter-greeting", guildIds: [guildId] } };
  const forced = seasons.seasonForServer({ now: new Date("2026-09-28T12:00:00Z"), guildId, owner: test, server: { parts: { eggHunt: false } } });
  assert.deepEqual([forced.season, forced.phase, forced.preview, forced.parts.eggHunt, forced.parts.panel], ["easter", "greeting", true, false, true]);
  assert.equal(seasons.seasonForServer({ now: new Date("2026-09-28T12:00:00Z"), guildId: "999999999999999999", owner: test }), null);

  const countdown = seasons.seasonForServer({
    now: new Date("2026-09-28T20:00:00Z"), guildId, timeZone: "Europe/Vienna",
    owner: { test: { preview: "newyear-countdown", guildIds: [guildId] } },
  });
  assert.deepEqual([countdown.phase, countdown.year, countdown.secondsToMidnight, countdown.timeZone], ["countdown", 2027, 7200, "Europe/Vienna"]);
});
