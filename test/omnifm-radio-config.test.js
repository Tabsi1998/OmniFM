import test from "node:test";
import assert from "node:assert/strict";

import { getOmnifmRadioConfig, isOmnifmRadioVisibleForGuild } from "../src/services/omnifm-radio-config.js";
import { getRecentLogs } from "../src/lib/logging.js";

test("OmniFM Radio defaults point at the own AzuraCast station and stay private", () => {
  const config = getOmnifmRadioConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.streamUrl, "https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3");
  assert.equal(config.nowPlayingUrl, "https://radio.omnifm.xyz/api/nowplaying/omnifm_radio");
  assert.equal(config.stationKey, "omnifm-radio");
  assert.equal(config.isPublic, false);
  assert.deepEqual(config.testGuildIds, []);
});

test("OmniFM Radio settings come from the environment", () => {
  const config = getOmnifmRadioConfig({
    OMNIFM_RADIO_BASE_URL: "https://radio.example.test/",
    OMNIFM_RADIO_STATION: "test_station",
    OMNIFM_RADIO_PUBLIC: "1",
    OMNIFM_RADIO_TEST_GUILD_IDS: "123456789012345678, nope ,123456789012345678;234567890123456789",
  });
  assert.equal(config.streamUrl, "https://radio.example.test/listen/test_station/radio.mp3");
  assert.equal(config.nowPlayingUrl, "https://radio.example.test/api/nowplaying/test_station");
  assert.equal(config.isPublic, true);
  assert.deepEqual(config.testGuildIds, ["123456789012345678", "234567890123456789"]);
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_STREAM_URL: "https://cdn.example.test/live.mp3" }).streamUrl, "https://cdn.example.test/live.mp3");
});

test("until the music rights are settled only test servers see OmniFM Radio", () => {
  const privateConfig = getOmnifmRadioConfig({ OMNIFM_RADIO_TEST_GUILD_IDS: "123456789012345678" });
  assert.equal(isOmnifmRadioVisibleForGuild("123456789012345678", privateConfig), true);
  assert.equal(isOmnifmRadioVisibleForGuild("999999999999999999", privateConfig), false);
  assert.equal(isOmnifmRadioVisibleForGuild("", privateConfig), false);
  assert.equal(isOmnifmRadioVisibleForGuild(null, getOmnifmRadioConfig({ OMNIFM_RADIO_PUBLIC: "1" })), true);
  assert.equal(isOmnifmRadioVisibleForGuild("123456789012345678", getOmnifmRadioConfig({ OMNIFM_RADIO_PUBLIC: "1", OMNIFM_RADIO_ENABLED: "0" })), false);
});

test("the switches understand 1/true/yes/on and 0/false/no/off, in any case", () => {
  for (const value of ["1", "true", "TRUE", "yes", "Yes", "on", "ON"]) {
    assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_PUBLIC: value }).isPublic, true, value);
  }
  for (const value of ["0", "false", "False", "no", "NO", "off", "Off"]) {
    assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_ENABLED: value }).enabled, false, value);
  }
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_ENABLED: " " }).enabled, true, "empty keeps the default");
});

test("an invalid OMNIFM_RADIO_STATION_KEY falls back to omnifm-radio, with one warning", () => {
  const warnings = () => getRecentLogs(500)
    .filter((entry) => entry.level === "WARN" && entry.message.includes("OMNIFM_RADIO_STATION_KEY")).length;
  const before = warnings();
  const invalid = ["custom:radio", "omnifm radio", "omnifm_radio", "ömnifm", "-radio", "x".repeat(60)];
  for (const value of invalid) {
    assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_STATION_KEY: value }).stationKey, "omnifm-radio", value);
  }
  const afterFirst = warnings();
  assert.equal(afterFirst - before, invalid.length, "one warning per wrong value");
  getOmnifmRadioConfig({ OMNIFM_RADIO_STATION_KEY: "custom:radio" });
  getOmnifmRadioConfig({ OMNIFM_RADIO_STATION_KEY: "custom:radio" });
  assert.equal(warnings(), afterFirst, "not again on every read of the settings");
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_STATION_KEY: "OmniFM-Live" }).stationKey, "omnifm-live", "upper case is lowered, as before");
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_STATION_KEY: "radio2" }).stationKey, "radio2");
});
