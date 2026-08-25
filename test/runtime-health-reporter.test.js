import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeHealthNodes } from "../src/services/runtime-health-reporter.js";

function fakeRuntime({ dashboardThrows = false } = {}) {
  const guild = {
    id: "1342542257747923004",
    name: "OmniFM",
    memberCount: 42,
    roles: { cache: new Map() },
    channels: { cache: new Map() },
    iconURL: () => "https://cdn.example.test/icon.png",
  };
  return {
    role: "commander",
    config: { clientId: "1476192449721274472", index: 1, name: "OmniFM DJ" },
    client: {
      isReady: () => true,
      guilds: { cache: new Map([[guild.id, guild]]) },
      voice: { adapters: new Map() },
      ws: { ping: 23 },
      user: { tag: "OmniFM#0001" },
    },
    collectStats: () => ({ servers: 1, users: 42, connections: 1, listeners: 7 }),
    getDashboardStatus: () => {
      if (dashboardThrows) throw new Error("temporary status failure");
      return {
        guildDetails: [{
          guildId: guild.id,
          playing: true,
          voiceConnected: true,
          stationKey: "rockradio",
          stationName: "Rock Radio",
          listenerCount: 7,
        }],
      };
    },
  };
}

test("runtime health exposes per-bot Discord and stream metrics", () => {
  const [node] = buildRuntimeHealthNodes([fakeRuntime()]);
  assert.equal(node.status, "online");
  assert.equal(node.guilds, 1);
  assert.equal(node.listeners, 7);
  assert.equal(node.guildDetails[0].id, "1342542257747923004");
  assert.equal(node.guildDetails[0].guildId, "1342542257747923004");
  assert.equal(node.guildDetails[0].stationName, "Rock Radio");
  assert.equal(node.guildDetails[0].playing, true);
});

test("guild directory survives a temporary dashboard status failure", () => {
  const [node] = buildRuntimeHealthNodes([fakeRuntime({ dashboardThrows: true })]);
  assert.equal(node.guildDetails.length, 1);
  assert.equal(node.guildDetails[0].name, "OmniFM");
  assert.equal(node.guildDetails[0].playing, false);
});
