import test from "node:test";
import assert from "node:assert/strict";

import { getOmnifmRadioConfig, isOmnifmRadioVisibleForGuild } from "../src/services/omnifm-radio-config.js";

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
