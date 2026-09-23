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

test("split runtime health keeps real resources separate per bot process", () => {
  const commander = fakeRuntime();
  const worker = {
    ...fakeRuntime(),
    remote: true,
    role: "worker",
    config: { clientId: "1476192449721274473", id: "worker-1", index: 2, name: "OmniFM 1" },
    getRuntimeMetrics: () => ({
      pid: 222,
      host: "omnifm",
      cpuPct: 7.5,
      memoryRssMb: 144.2,
      memoryHeapUsedMb: 80.1,
      uptimeSec: 900,
      nodeVersion: "v22.23.2",
    }),
  };
  const nodes = buildRuntimeHealthNodes([commander, worker], {
    resourceModel: "split-processes",
    localProcessMetrics: {
      pid: 111,
      host: "omnifm",
      cpuPct: 2.5,
      memoryRssMb: 120.4,
      memoryHeapUsedMb: 60.2,
      uptimeSec: 1_000,
      nodeVersion: "v22.23.2",
    },
  });

  assert.deepEqual(nodes.map((node) => node.pid), [111, 222]);
  assert.deepEqual(nodes.map((node) => node.ramMb), [120.4, 144.2]);
  assert.deepEqual(nodes.map((node) => node.cpuPct), [2.5, 7.5]);
  assert.deepEqual(nodes.map((node) => node.resourceScope), ["node-process", "node-process"]);
});

test("the log shipper sends only lines it has not sent yet and retries after a failed insert", async () => {
  const { createRuntimeLogShipper } = await import("../src/services/runtime-health-reporter.js");
  const lines = [
    { seq: 1, at: "2026-09-24T10:00:00.000Z", level: "INFO", source: "Worker 2", message: "eins" },
    { seq: 2, at: "2026-09-24T10:00:01.000Z", level: "WARN", source: "Worker 2", message: "zwei" },
  ];
  const inserted = [];
  let failNext = false;
  const database = {
    collection(name) {
      assert.equal(name, "runtime_logs");
      return {
        async insertMany(rows) {
          if (failNext) {
            failNext = false;
            throw new Error("not primary");
          }
          inserted.push(...rows);
        },
      };
    },
  };
  const ship = createRuntimeLogShipper({
    processLabel: "worker-2",
    getDatabase: () => database,
    connected: () => true,
    readLogs: (seq) => lines.filter((line) => line.seq > seq),
  });

  assert.equal(await ship(), 2);
  assert.deepEqual(inserted.map((row) => [row.message, row.process]), [["eins", "worker-2"], ["zwei", "worker-2"]]);
  assert.equal(await ship(), 0, "nothing new, nothing sent");

  lines.push({ seq: 3, at: "2026-09-24T10:00:02.000Z", level: "ERROR", source: "Worker 2", message: "drei" });
  failNext = true;
  assert.equal(await ship(), 0, "failed insert");
  assert.equal(await ship(), 1, "the same line is sent on the next tick");
  assert.deepEqual(inserted.map((row) => row.message), ["eins", "zwei", "drei"]);
});

test("recent logs carry sequence numbers for incremental shipping", async () => {
  const logging = await import("../src/lib/logging.js");
  const before = logging.getRecentLogs(1)[0]?.seq || 0;
  logging.log("INFO", "[Seq Test] erste Zeile");
  logging.log("INFO", "[Seq Test] zweite Zeile");
  const since = logging.getRecentLogsSince(before);
  const own = since.filter((entry) => entry.source === "Seq Test");
  assert.deepEqual(own.map((entry) => entry.message), ["erste Zeile", "zweite Zeile"]);
  assert.ok(own[1].seq > own[0].seq);
});

test("the health nodes keep only active servers, the directory keeps all of them", async () => {
  const { splitGuildDirectory, createGuildDirectoryWriter } = await import("../src/services/runtime-health-reporter.js");
  const roles = [{ id: "r1", name: "DJ", color: "#94a3b8", position: 3 }];
  const voiceChannels = [{ id: "v1", name: "Radio", position: 0 }];
  const nodes = [
    {
      name: "Commander",
      guildIds: ["g1", "g2"],
      guildDetails: [
        { id: "g1", guildId: "g1", name: "One", memberCount: 40, iconUrl: "https://cdn.example.test/1.png", roles, voiceChannels, textChannels: [], playing: true, stationKey: "alpha" },
        { id: "g2", guildId: "g2", name: "Two", memberCount: 9, iconUrl: null, roles: [], voiceChannels: [], textChannels: [], playing: false },
      ],
    },
    { name: "Worker", guildIds: ["g1"], guildDetails: [{ id: "g1", guildId: "g1", name: "One", memberCount: 41, roles: [], voiceChannels: [], textChannels: [] }] },
  ];
  const { nodes: slim, directory } = splitGuildDirectory(nodes);
  assert.deepEqual(slim[0].guildIds, ["g1", "g2"], "membership stays");
  assert.deepEqual(slim[0].guildDetails.map((detail) => detail.guildId), ["g1"], "only the playing server");
  assert.equal("roles" in slim[0].guildDetails[0], false);
  assert.equal(slim[0].guildDetails[0].stationKey, "alpha");
  assert.deepEqual(slim[1].guildDetails, [], "an idle worker sends no details");
  assert.deepEqual([...directory.keys()], ["g1", "g2"]);
  assert.deepEqual(directory.get("g1"), { name: "One", memberCount: 41, iconUrl: "https://cdn.example.test/1.png", roles, voiceChannels, textChannels: [] });
  assert.equal(directory.get("g2").name, "Two");

  const writes = [];
  const deletes = [];
  const database = {
    collection(name) {
      assert.equal(name, "runtime_guild_directory");
      return {
        async bulkWrite(ops) { writes.push(ops.map((op) => op.replaceOne.filter._id)); },
        async deleteMany(filter) { deletes.push(filter); },
      };
    },
  };
  const writeDirectory = createGuildDirectoryWriter({ getDatabase: () => database, refreshMs: 60_000 });
  assert.equal(await writeDirectory(directory, 1_000_000), 2, "first write");
  assert.equal(await writeDirectory(directory, 1_005_000), 0, "unchanged, no write");
  const renamed = new Map(directory);
  renamed.set("g1", { ...directory.get("g1"), roles: [{ ...roles[0], name: "Radio-DJ" }] });
  assert.equal(await writeDirectory(renamed, 1_010_000), 1, "a renamed role is written");
  assert.equal(await writeDirectory(renamed, 1_070_000), 2, "full refresh");
  assert.deepEqual(writes, [["g1", "g2"], ["g1"], ["g1", "g2"]]);
  assert.equal(deletes.length, 2, "stale servers are removed on each full refresh");
});
