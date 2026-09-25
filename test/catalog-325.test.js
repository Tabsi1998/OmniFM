import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-catalog-325-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { loadStations } = await import("../src/stations-store.js");

test("the catalog after #325: names that say what plays, no stream twice", () => {
  const { stations } = loadStations();
  assert.equal(Object.keys(stations).length, 120, "\"120 Sender\" and \"100+ Premium\" stay true");
  assert.equal(stations.technoradio.name, "Dance Radio");
  assert.equal(stations.protech19.name, "IDM & Glitch");
  assert.deepEqual([stations.prourban14.name, stations.prourban14.genre], ["2000er Hits", "Pop & Charts"]);
  assert.deepEqual([stations.protech16.name, stations.protech16.genre], ["Deep Tech House", "House"]);
  assert.equal(stations.reggaeradio.url, "https://ice1.somafm.com/reggae-128-mp3");
  assert.equal(stations.prourban04.url, "https://stream.laut.fm/drill", "Drill Beats plays drill, no longer Deutschrap");
  assert.equal(stations.prohard06.url, "https://stream.laut.fm/hardstyle", "Hard Dance is no second HardBase.FM");
  const urls = Object.values(stations).map((station) => station.url.replace(/\?.*$/, "").replace(/\/+$/, ""));
  const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
  assert.deepEqual(duplicates, [], "no stream twice in the catalog");
});

test("a stream that suddenly sends another name turns the cockpit's station tile yellow", async () => {
  const { trackStreamName } = await import("../src/services/station-health.js");
  const { checkStations } = await import("../src/services/owner-status/checks.js");
  const url = "https://ice4.somafm.com/scanner-128-mp3";
  const first = trackStreamName(null, "Night Warehouse", url, 1_000);
  assert.deepEqual(first, { streamName: "Night Warehouse", streamNameChange: null });
  const same = trackStreamName({ url, ...first }, "Night Warehouse", url, 2_000);
  assert.equal(same.streamNameChange, null);
  const changed = trackStreamName({ url, ...first }, "SF Police Scanner", url, 3_000);
  assert.deepEqual(changed.streamNameChange, { from: "Night Warehouse", to: "SF Police Scanner", at: 3_000 });
  assert.deepEqual(trackStreamName({ url, ...changed }, "", url, 4_000).streamNameChange, changed.streamNameChange, "an answer without a name keeps the note");
  assert.equal(trackStreamName({ url, ...changed }, "SF Police Scanner", url, 3_000 + 25 * 3_600_000).streamNameChange, null, "after a day the note goes");
  assert.equal(trackStreamName({ url, ...first }, "SomaFM Reggae", "https://ice1.somafm.com/reggae-128-mp3", 5_000).streamNameChange, null, "a new URL is no suspicious rename");

  const tile = await checkStations({ report: [
    { key: "protech20", name: "Night Warehouse", status: "up", consecutiveFailures: 0, streamNameChange: changed.streamNameChange },
    { key: "groovesalad", name: "Groove Salad", status: "up", consecutiveFailures: 0 },
  ] });
  assert.equal(tile.state, "warn");
  assert.match(tile.summary, /1 Stream heißt jetzt anders: Night Warehouse/);
  assert.match(tile.detail, /"Night Warehouse" → "SF Police Scanner"/);
});
