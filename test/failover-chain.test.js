import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_FAILOVER_CHAIN_LENGTH,
  buildFailoverCandidateChain,
  getPrimaryFailoverStation,
  normalizeFailoverChain,
} from "../src/lib/failover-chain.js";

test("normalizeFailoverChain deduplicates, trims, and enforces the max length", () => {
  const chain = normalizeFailoverChain([
    " ROCK ",
    "rock",
    "custom:nightshift",
    "",
    "jazz",
    "pop",
    "news",
    "talk",
    "electro",
  ]);

  assert.deepEqual(chain, [
    "rock",
    "custom:nightshift",
    "jazz",
    "pop",
    "news",
  ]);
  assert.equal(chain.length, MAX_FAILOVER_CHAIN_LENGTH);
});

test("buildFailoverCandidateChain merges configured, legacy, and automatic fallbacks", () => {
  const chain = buildFailoverCandidateChain({
    currentStationKey: "rock",
    configuredChain: ["custom:nightshift", "rock", "pop"],
    fallbackStation: "jazz",
    automaticFallbackKey: "news",
  });

  assert.deepEqual(chain, ["custom:nightshift", "pop", "jazz", "news"]);
});

test("getPrimaryFailoverStation prefers the configured chain and falls back to legacy", () => {
  assert.equal(getPrimaryFailoverStation(["custom:nightshift", "pop"], "jazz"), "custom:nightshift");
  assert.equal(getPrimaryFailoverStation([], "jazz"), "jazz");
  assert.equal(getPrimaryFailoverStation([], ""), "");
});

// ---- #413: an automatic fallback on every plan ----

const { automaticFallbackKeys } = await import("../src/lib/failover-chain.js");

test("automatic fallbacks: the same genre first, then a related one, then any other station", () => {
  const stations = {
    rock1: { genre: "Rock" },
    jazz1: { genre: "Jazz" },
    metal1: { genre: "Metal" },
    rock2: { genre: "Rock" },
    pop1: { genre: "Pop & Charts" },
    indie1: { genre: "Indie & Alternative" },
    "custom:mine": { genre: "Rock" },
  };
  assert.deepEqual(automaticFallbackKeys({ currentKey: "rock1", genre: "Rock", stations }), ["rock2", "metal1", "indie1"]);
  assert.deepEqual(automaticFallbackKeys({ currentKey: "rock1", genre: "rock", stations, downKeys: new Set(["rock2"]) }), ["metal1", "indie1", "jazz1"], "a station found down is skipped");
  assert.deepEqual(automaticFallbackKeys({ currentKey: "jazz1", genre: "Jazz", stations, limit: 2 }), ["rock1", "metal1"], "no related genre: any other, in catalogue order");
  assert.deepEqual(automaticFallbackKeys({ currentKey: "x", genre: "", stations: {} }), []);
  assert.ok(!automaticFallbackKeys({ currentKey: "rock1", genre: "Rock", stations, limit: 10 }).some((key) => key.startsWith("custom:")), "never someone's own station");
});

test("the server's own chain comes before the automatic fallbacks, five at most", () => {
  assert.deepEqual(
    buildFailoverCandidateChain({ currentStationKey: "alpha", configuredChain: ["beta"], automaticKeys: ["gamma", "beta", "alpha", "delta"] }),
    ["beta", "gamma", "delta"],
  );
  assert.equal(buildFailoverCandidateChain({ configuredChain: ["a", "b", "c", "d", "e"], automaticKeys: ["f"] }).length, MAX_FAILOVER_CHAIN_LENGTH);
});

test("a Free server finds a fallback in the real catalogue for every one of its stations", async () => {
  const { loadStations, filterStationsByTier } = await import("../src/stations-store.js");
  const catalog = loadStations().stations;
  const free = filterStationsByTier(catalog, "free");
  assert.equal(Object.keys(free).length, 20);
  for (const [key, station] of Object.entries(free)) {
    const fallbacks = automaticFallbackKeys({ currentKey: key, genre: station.genre, stations: free });
    assert.equal(fallbacks.length, 3, key);
    assert.ok(fallbacks.every((candidate) => free[candidate]), `${key}: only Free stations`);
  }
  const chill = Object.entries(free).find(([, station]) => station.genre === "Chillout");
  if (chill) {
    const [first] = automaticFallbackKeys({ currentKey: chill[0], genre: "Chillout", stations: free });
    assert.ok(["Ambient", "Lounge", "Lo-Fi"].includes(free[first].genre), "Chillout falls back to something calm");
  }
});

test("the down list comes from MongoDB at most once a minute; a failed read keeps the last one", async () => {
  const { downStationKeys, resetDownStationKeysForTests, automaticFallbackKeysForGuild } = await import("../src/bot/automatic-fallback.js");
  resetDownStationKeysForTests();
  let reads = 0;
  let broken = false;
  const db = {
    collection: (name) => ({
      find: (filter) => ({
        toArray: async () => {
          reads += 1;
          if (broken) throw new Error("connection lost");
          assert.equal(name, "station_health");
          assert.deepEqual(filter, { status: "down", consecutiveFailures: { $gte: 2 } });
          return [{ key: "Alpha" }];
        },
      }),
    }),
  };
  assert.deepEqual([...await downStationKeys({ now: 1_000, db })], ["alpha"]);
  assert.deepEqual([...await downStationKeys({ now: 30_000, db })], ["alpha"]);
  assert.equal(reads, 1, "cached for a minute");
  broken = true;
  assert.deepEqual([...await downStationKeys({ now: 70_000, db })], ["alpha"], "a failed read keeps the last list");
  resetDownStationKeysForTests();

  // A Free server (no license) only gets Free stations.
  const { loadStations } = await import("../src/stations-store.js");
  const [freeKey] = Object.entries(loadStations().stations).find(([, station]) => (station.tier || "free") === "free");
  const keys = await automaticFallbackKeysForGuild("123456789012345678", { key: freeKey, station: null });
  assert.equal(keys.length, 3);
  assert.ok(keys.every((key) => (loadStations().stations[key].tier || "free") === "free"));
});
