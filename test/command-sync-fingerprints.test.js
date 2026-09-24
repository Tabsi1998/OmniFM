import test from "node:test";
import assert from "node:assert/strict";

import { syncGuildCommandsSafe } from "../src/discord/syncGuildCommandsSafe.js";
import {
  EMPTY_COMMANDS_HASH,
  commandPayloadHash,
  createCommandFingerprintStore,
} from "../src/discord/commandFingerprints.js";

process.env.GUILD_COMMAND_SYNC_JOIN_DELAY_MS = "0";
process.env.GUILD_COMMAND_SYNC_READY_DELAY_MS = "0";
process.env.GUILD_COMMAND_SYNC_RETRY_DELAY_MS = "5000";

function fakeDiscord(guildIds, { failOnce = [] } = {}) {
  const puts = [];
  const failing = new Set(failOnce);
  const guilds = new Map(guildIds.map((id) => [id, { id }]));
  return {
    puts,
    client: {
      isReady: () => true,
      user: { id: "app-1" },
      guilds: { cache: guilds, fetch: async () => guilds },
    },
    rest: {
      async put(route) {
        const guildId = route.split(":")[1];
        if (failing.delete(guildId)) {
          const error = new Error("boom");
          error.status = 500;
          throw error;
        }
        puts.push(guildId);
      },
    },
    routes: { applicationGuildCommands: (applicationId, guildId) => `${applicationId}:${guildId}` },
  };
}

function memoryStore() {
  return createCommandFingerprintStore({ getDatabase: () => null, connected: () => false });
}

const COMMANDS = [{ name: "play", description: "Play a station" }];

async function sync(discord, fingerprints, source = "periodic", commands = COMMANDS, extra = {}) {
  return syncGuildCommandsSafe({
    ...discord,
    commands,
    botLabel: "OmniFM Test",
    source,
    logFn: () => {},
    fingerprints,
    ...extra,
  });
}

test("an unchanged command list is written once, not on every periodic sync", async () => {
  const discord = fakeDiscord(["g1", "g2"]);
  const fingerprints = memoryStore();

  const first = await sync(discord, fingerprints, "startup");
  assert.deepEqual(discord.puts, ["g1", "g2"]);
  assert.equal(first.ok, 2);

  const second = await sync(discord, fingerprints, "periodic");
  const third = await sync(discord, fingerprints, "periodic");
  assert.deepEqual(discord.puts, ["g1", "g2"], "no PUT while nothing changed");
  assert.equal(second.reason, "unchanged");
  assert.equal(third.unchanged, 2);
});

test("a changed command list, a new server and a forced sync write again", async () => {
  const discord = fakeDiscord(["g1", "g2"]);
  const fingerprints = memoryStore();
  await sync(discord, fingerprints, "startup");
  discord.puts.length = 0;

  await sync(discord, fingerprints, "periodic", [...COMMANDS, { name: "stop", description: "Stop" }]);
  assert.deepEqual(discord.puts, ["g1", "g2"], "every server gets the new list");

  discord.puts.length = 0;
  discord.client.guilds.cache.set("g3", { id: "g3" });
  await sync(discord, fingerprints, "periodic", [...COMMANDS, { name: "stop", description: "Stop" }]);
  assert.deepEqual(discord.puts, ["g3"], "only the new server");

  discord.puts.length = 0;
  await sync(discord, fingerprints, "join", [...COMMANDS, { name: "stop", description: "Stop" }], { guildIds: ["g1"] });
  assert.deepEqual(discord.puts, ["g1"], "a join always writes");

  discord.puts.length = 0;
  await sync(discord, fingerprints, "periodic", [...COMMANDS, { name: "stop", description: "Stop" }], { force: true });
  assert.deepEqual(discord.puts, ["g1", "g2", "g3"], "force writes everywhere");
});

test("a server whose PUT failed is written again on the next run", async () => {
  const discord = fakeDiscord(["g1", "g2"], { failOnce: ["g2"] });
  const fingerprints = memoryStore();
  const originalTries = process.env.GUILD_COMMAND_SYNC_TRIES;
  process.env.GUILD_COMMAND_SYNC_TRIES = "1";
  try {
    const first = await sync(discord, fingerprints, "periodic");
    assert.equal(first.failed, 1);
    await sync(discord, fingerprints, "periodic");
    assert.deepEqual(discord.puts, ["g1", "g2"], "g2 again, g1 not");
  } finally {
    if (originalTries === undefined) delete process.env.GUILD_COMMAND_SYNC_TRIES;
    else process.env.GUILD_COMMAND_SYNC_TRIES = originalTries;
  }
});

test("fingerprints survive a restart through MongoDB", async () => {
  const rows = new Map();
  const database = {
    collection(name) {
      assert.equal(name, "guild_command_sync");
      return {
        find: (filter) => ({
          toArray: async () => [...rows.values()].filter((row) => row.applicationId === filter.applicationId),
        }),
        async bulkWrite(ops) {
          for (const op of ops) rows.set(op.updateOne.filter._id, { ...op.updateOne.update.$set });
        },
      };
    },
  };
  const before = createCommandFingerprintStore({ getDatabase: () => database, connected: () => true });
  await before.save("app-1", ["g1", "g2"], commandPayloadHash(COMMANDS));

  const afterRestart = createCommandFingerprintStore({ getDatabase: () => database, connected: () => true });
  const known = await afterRestart.load("app-1", ["g1", "g2", "g3"]);
  assert.equal(known.get("g1"), commandPayloadHash(COMMANDS));
  assert.equal(known.has("g3"), false);
  assert.notEqual(EMPTY_COMMANDS_HASH, commandPayloadHash(COMMANDS));
});
