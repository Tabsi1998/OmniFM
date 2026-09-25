import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType, PermissionFlagsBits } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-stage-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { validateDiscordScheduledEventPermissions, pickScheduledEventWorker } = await import("../src/bot/runtime-events.js");
const { validateStageEventSpeakers } = await import("../src/bot/stage-moderator.js");

const MODERATOR = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers];
const BASIC = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];

// Rights live in the channel (Discord's "Stage moderators"), not on the server role.
function stageSetup(channelRights) {
  const members = Object.fromEntries(Object.keys(channelRights).map((id) => [id, {
    id,
    permissions: { has: (flag) => flag === PermissionFlagsBits.CreateEvents },
  }]));
  const channel = {
    id: "700000000000000001",
    type: ChannelType.GuildStageVoice,
    toString: () => "<#700000000000000001>",
    permissionsFor: (member) => ({ has: (flag) => (channelRights[member?.id] || []).includes(flag) }),
  };
  const guild = {
    id: "600000000000000001",
    members: { me: members.commander, cache: new Map(), fetch: async (id) => members[id] || null },
    channels: { cache: new Map([[channel.id, channel]]) },
  };
  return { guild, channel };
}

function worker(id, slot) {
  return { config: { name: `OmniFM ${slot}` }, slot, getApplicationId: () => id };
}

function commander(workers) {
  return {
    role: "commander",
    config: { name: "OmniFM" },
    workerManager: {
      getInvitedWorkers: () => workers,
      getAvailableWorkers: () => [...workers],
      getWorkerSlot: (w) => w.slot,
      findFreeWorker: () => workers[0] || null,
    },
  };
}

test("a Stage moderator in the channel may create the server event, server role or not", () => {
  const ok = stageSetup({ commander: [...BASIC, ...MODERATOR] });
  assert.equal(validateDiscordScheduledEventPermissions({ config: { name: "OmniFM" } }, ok.guild, ok.channel, "de"), null);

  const missing = stageSetup({ commander: BASIC });
  const message = validateDiscordScheduledEventPermissions({ config: { name: "OmniFM" } }, missing.guild, missing.channel, "de");
  assert.match(message, /Stage-Moderator/);
  assert.match(message, /Stage-Moderatoren → den Bot hinzufügen/);
});

test("planning in a Stage channel needs one playing bot that may speak there", async () => {
  const withSpeaker = stageSetup({ commander: BASIC, w1: BASIC, w2: [...BASIC, ...MODERATOR] });
  const runtime = commander([worker("w1", 1), worker("w2", 2)]);
  assert.equal(await validateStageEventSpeakers(runtime, withSpeaker.guild, withSpeaker.channel, "pro", "en"), null);

  const silent = stageSetup({ commander: BASIC, w1: BASIC, w2: BASIC });
  const message = await validateStageEventSpeakers(runtime, silent.guild, silent.channel, "pro", "en");
  assert.match(message, /OmniFM 1, OmniFM 2 may not speak/);
  assert.match(message, /Stage Moderators → add the bot/);
});

test("at the start the worker that is Stage moderator plays, not the first free one", async () => {
  const { guild } = stageSetup({ commander: BASIC, w1: BASIC, w2: [...BASIC, ...MODERATOR] });
  const runtime = commander([worker("w1", 1), worker("w2", 2)]);
  const picked = await pickScheduledEventWorker(runtime, guild, { guildId: guild.id, voiceChannelId: "700000000000000001" }, "pro");
  assert.equal(picked.config.name, "OmniFM 2");
});
