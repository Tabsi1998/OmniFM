import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";

// OmniFM Radio (#593), what OmniFM 1 does in Discord: the live message with
// "Listen now", the edit at the end, and the button that brings OmniFM 1
// into the voice channel of whoever presses it, without switching anybody.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-radio-announce-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
process.env.LOGS_DIR = path.join(dataDir, "logs");
const TEST_GUILD = "111111111111111111";
const HIDDEN_GUILD = "222222222222222222";
process.env.OMNIFM_RADIO_TEST_GUILD_IDS = TEST_GUILD;
process.env.OMNIFM_RADIO_PUBLIC = "0";
delete process.env.OMNIFM_RADIO_ENABLED;
delete process.env.OMNIFM_RADIO_STATION_KEY;
fs.writeFileSync(path.join(dataDir, "stations.json"), JSON.stringify({
  defaultStationKey: "groove",
  stations: { groove: { name: "Groove Salad", url: "https://radio.example.test/groove.mp3", tier: "free", genre: "Ambient" } },
}));

const ui = await import("../src/discord/ui/index.js");
const { BOT_LANGUAGES, botTranslator } = await import("../src/lib/bot-i18n.js");
const {
  RADIO_LISTEN_ID,
  buildRadioEndedPayload,
  buildRadioLivePayload,
} = await import("../src/bot/omnifm-radio-announce-messages.js");
const { radioAnnounceMethods } = await import("../src/bot/runtime-methods/radio-announce.js");

const KEY = "omnifm-radio";
const SYSTEM = "333333333333333333";
const OTHER_TEXT = "444444444444444444";
const ROLE = "555555555555555555";
const VOICE = "666666666666666666";
const OTHER_VOICE = "777777777777777777";
const ME = "888888888888888888";
const SHOW = { streamerName: "DJ Tabsi", title: "Abendshow", startedAt: "2026-11-25T20:00:00.000Z", source: "webhook" };

/** Every text and button label of a payload, in order. */
function textOf(payload) {
  const parts = [];
  const visit = (node) => {
    const json = typeof node?.toJSON === "function" ? node.toJSON() : node;
    if (!json || typeof json !== "object") return;
    if (json.type === 10) parts.push(json.content);
    if (json.type === 2) parts.push(`[${json.label}]`);
    for (const child of json.components || []) visit(child);
    if (json.accessory) visit(json.accessory);
  };
  for (const component of payload.components || []) visit(component);
  return parts.join("\n");
}

function buttonsOf(payload) {
  const buttons = [];
  const visit = (node) => {
    const json = typeof node?.toJSON === "function" ? node.toJSON() : node;
    if (!json || typeof json !== "object") return;
    if (json.type === 2) buttons.push(json);
    for (const child of json.components || []) visit(child);
    if (json.accessory) visit(json.accessory);
  };
  for (const component of payload.components || []) visit(component);
  return buttons;
}

// ---------------------------------------------------------------- messages

test("the live message: who is live, the show, Listen now; a ping only for the chosen role", () => {
  const t = botTranslator("de");
  const plain = buildRadioLivePayload({ t, show: SHOW });
  assert.match(textOf(plain), /DJ Tabsi ist live auf OmniFM Radio/);
  assert.match(textOf(plain), /Abendshow/);
  assert.deepEqual(buttonsOf(plain).map((button) => [button.label, button.custom_id]), [["Jetzt hören", RADIO_LISTEN_ID]]);
  assert.deepEqual(plain.allowedMentions, { parse: [] }, "nobody is pinged");
  assert.ok(plain.flags & MessageFlags.IsComponentsV2);
  assert.equal(plain.flags & MessageFlags.Ephemeral, 0, "public");

  const withRole = buildRadioLivePayload({ t, show: SHOW, roleId: ROLE });
  assert.match(textOf(withRole), new RegExp(`<@&${ROLE}>`));
  assert.deepEqual(withRole.allowedMentions, { parse: [], roles: [ROLE] }, "exactly that role, never @everyone");

  const nameless = buildRadioLivePayload({ t, show: { ...SHOW, streamerName: "", title: "" } });
  assert.match(textOf(nameless), /Live auf OmniFM Radio/);
  assert.doesNotMatch(textOf(nameless), /ist live/);
});

test("DJ name and title cannot format, mention or ping", () => {
  const t = botTranslator("en");
  const payload = buildRadioLivePayload({
    t,
    show: { ...SHOW, streamerName: "**Big** @everyone <@&123456789012345678>", title: "__Party__ @here\n## fake heading" },
  });
  const text = textOf(payload);
  assert.doesNotMatch(text, /\*\*Big\*\*/, "markdown is escaped");
  assert.doesNotMatch(text, /<@&123456789012345678>/, "no fake role pill");
  assert.doesNotMatch(text, /\n## fake/, "no line breaks from the title");
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test("the live and the ended message stay inside Discord's limits in all nine languages", () => {
  const worst = {
    ...SHOW,
    source: "test",
    streamerName: "D".repeat(100),
    title: "Ü".repeat(300),
    endedAt: "2026-11-25T21:12:00.000Z",
    durationMs: 72 * 60 * 1000,
  };
  for (const language of BOT_LANGUAGES) {
    const t = botTranslator(language);
    for (const payload of [buildRadioLivePayload({ t, show: worst, roleId: ROLE }), buildRadioEndedPayload({ t, show: worst })]) {
      assert.deepEqual(ui.checkDiscordLimits(payload).problems, [], language);
    }
  }
});

test("the ended message thanks the listeners, without button and without ping", () => {
  const payload = buildRadioEndedPayload({ t: botTranslator("de"), show: { ...SHOW, endedAt: "2026-11-25T21:12:00.000Z" } });
  assert.match(textOf(payload), /Sendung vorbei – danke fürs Zuhören/);
  assert.match(textOf(payload), /DJ Tabsi/);
  assert.deepEqual(buttonsOf(payload), []);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

// ---------------------------------------------------------------- posting

function permissions(...flags) {
  const set = new Set(flags);
  return { has: (flag) => set.has(flag) };
}
const WRITE = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

function textChannel(id, { perms = WRITE, type = ChannelType.GuildText } = {}) {
  const channel = {
    id,
    name: `channel-${id.slice(0, 3)}`,
    type,
    sent: [],
    edited: [],
    permissionsFor: () => permissions(...perms),
    async send(payload) {
      channel.sent.push(payload);
      return { id: `9${channel.sent.length}` };
    },
    messages: {
      async edit(messageId, payload) {
        channel.edited.push({ messageId, payload });
        return { id: messageId };
      },
    },
  };
  return channel;
}

function fakeRuntime({ guildId = TEST_GUILD, channels = [], systemChannelId = SYSTEM, roles = [ROLE], voiceMembers = {} } = {}) {
  const cache = new Map(channels.map((channel) => [channel.id, channel]));
  for (const [voiceId, members] of Object.entries(voiceMembers)) {
    cache.set(voiceId, { id: voiceId, type: ChannelType.GuildVoice, name: "Radio", members: new Map(members.map((member) => [member.id, member])) });
  }
  const guild = {
    id: guildId,
    name: "Club",
    get systemChannel() { return cache.get(systemChannelId) || null; },
    channels: { cache, fetch: async (id) => cache.get(id) || null },
    roles: { cache: new Map(roles.map((id) => [id, { id, name: "Radio-Fans" }])) },
    members: { me: { id: ME }, fetch: async () => null },
  };
  const runtime = Object.assign(Object.create(radioAnnounceMethods), {
    config: { id: "bot-2", name: "OmniFM 1" },
    role: "worker",
    workerSlot: 1,
    client: { application: { id: ME }, user: { id: ME }, guilds: { cache: new Map([[guildId, guild]]) } },
    guildState: new Map(),
    plays: [],
    resolveBotMember: async () => ({ id: ME }),
    resolveGuildLanguage: () => "de",
    createInteractionTranslator: () => ({ language: "de", isDe: true, t: botTranslator("de") }),
    getGuildAccess: () => ({ allowed: true }),
    replyAccessDenied: async (interaction) => interaction.reply({ content: "denied" }),
    checkCommandRolePermission: () => ({ ok: true }),
    validateVoiceChannelAccess: async () => ({ ok: true }),
    clearScheduledEventPlaybackInGuild: () => {},
    async playInGuild(...args) {
      runtime.plays.push(args);
      return { ok: true, workerName: "OmniFM 1" };
    },
  });
  return { runtime, guild };
}

test("OmniFM 1 posts to the system channel by default and says where", async () => {
  const system = textChannel(SYSTEM);
  const { runtime } = fakeRuntime({ channels: [system] });
  const result = await runtime.postRadioAnnouncement(TEST_GUILD, { show: SHOW });
  assert.deepEqual(result, { ok: true, channelId: SYSTEM, messageId: "91" });
  assert.match(textOf(system.sent[0]), /DJ Tabsi ist live/);
});

test("the chosen channel and role; a role that is gone is not mentioned", async () => {
  const chosen = textChannel(OTHER_TEXT, { type: ChannelType.GuildAnnouncement });
  const { runtime } = fakeRuntime({ channels: [textChannel(SYSTEM), chosen] });
  await runtime.postRadioAnnouncement(TEST_GUILD, { channelId: OTHER_TEXT, roleId: ROLE, show: SHOW });
  assert.deepEqual(chosen.sent[0].allowedMentions, { parse: [], roles: [ROLE] });

  await runtime.postRadioAnnouncement(TEST_GUILD, { channelId: OTHER_TEXT, roleId: "999999999999999999", show: SHOW });
  assert.deepEqual(chosen.sent[1].allowedMentions, { parse: [] });
});

test("no channel, a channel that is gone or missing rights: skipped, nothing sent", async () => {
  const { runtime: noSystem } = fakeRuntime({ systemChannelId: null });
  assert.deepEqual(await noSystem.postRadioAnnouncement(TEST_GUILD, { show: SHOW }), { ok: false, reason: "no-channel" });

  const { runtime: gone } = fakeRuntime({ channels: [textChannel(SYSTEM)] });
  assert.deepEqual(await gone.postRadioAnnouncement(TEST_GUILD, { channelId: OTHER_TEXT, show: SHOW }), { ok: false, reason: "no-channel" });

  for (const missing of WRITE) {
    const channel = textChannel(SYSTEM, { perms: WRITE.filter((flag) => flag !== missing) });
    const { runtime } = fakeRuntime({ channels: [channel] });
    // eslint-disable-next-line no-await-in-loop -- one missing right after the other
    assert.deepEqual(await runtime.postRadioAnnouncement(TEST_GUILD, { show: SHOW }), { ok: false, reason: "missing-permissions" });
    assert.equal(channel.sent.length, 0);
  }

  const voiceLike = textChannel(SYSTEM, { type: ChannelType.GuildVoice });
  const { runtime: voice } = fakeRuntime({ channels: [voiceLike] });
  assert.deepEqual(await voice.postRadioAnnouncement(TEST_GUILD, { show: SHOW }), { ok: false, reason: "no-channel" });

  const refusing = textChannel(SYSTEM);
  refusing.send = async () => { throw Object.assign(new Error("Missing Permissions"), { code: 50013 }); };
  const { runtime: refused } = fakeRuntime({ channels: [refusing] });
  assert.deepEqual(await refused.postRadioAnnouncement(TEST_GUILD, { show: SHOW }), { ok: false, reason: "50013" }, "Discord says no: skipped, no throw");

  const { runtime: elsewhere } = fakeRuntime({ guildId: HIDDEN_GUILD });
  assert.deepEqual(await elsewhere.postRadioAnnouncement(TEST_GUILD, { show: SHOW }), { ok: false, reason: "not-in-guild" });
});

test("the end edits the posted message in place", async () => {
  const system = textChannel(SYSTEM);
  const { runtime } = fakeRuntime({ channels: [system] });
  const result = await runtime.endRadioAnnouncement(TEST_GUILD, { channelId: SYSTEM, messageId: "91", show: { ...SHOW, endedAt: "2026-11-25T21:00:00.000Z" } });
  assert.deepEqual(result, { ok: true });
  assert.equal(system.edited[0].messageId, "91");
  assert.match(textOf(system.edited[0].payload), /Sendung vorbei/);
  assert.equal(system.sent.length, 0, "no second message");

  system.messages.edit = async () => { throw Object.assign(new Error("Unknown Message"), { code: 10008 }); };
  assert.deepEqual(await runtime.endRadioAnnouncement(TEST_GUILD, { channelId: SYSTEM, messageId: "91", show: SHOW }), { ok: false, reason: "10008" });
});

// ---------------------------------------------------------------- Listen now

function interaction({ guildId = TEST_GUILD, guild, voiceChannelId = VOICE } = {}) {
  const answers = [];
  const event = {
    guildId,
    guild,
    customId: RADIO_LISTEN_ID,
    user: { id: "123123123123123123" },
    member: { voice: { channelId: voiceChannelId } },
    deferred: false,
    replied: false,
    answers,
    isButton: () => true,
    async reply(payload) { event.replied = true; answers.push(payload); },
    async deferReply(payload) { event.deferred = true; answers.push({ deferred: payload }); },
    async editReply(payload) { answers.push(payload); },
  };
  return event;
}

const lastAnswer = (event) => textOf(event.answers.at(-1));

test("Listen now: OmniFM 1 comes into the presser's voice channel with OmniFM Radio", async () => {
  const { runtime, guild } = fakeRuntime({ voiceMembers: { [VOICE]: [] } });
  const event = interaction({ guild });
  assert.equal(await runtime.handleRadioListenButton(event), true);
  assert.equal(runtime.plays.length, 1);
  const [guildId, channelId, stationKey, stationsData] = runtime.plays[0];
  assert.deepEqual([guildId, channelId, stationKey], [TEST_GUILD, VOICE, KEY]);
  assert.ok(stationsData.stations[KEY], "through the server's own catalog");
  assert.ok(event.answers[0].deferred.flags & MessageFlags.Ephemeral, "only the presser sees it (the answer edits the private defer)");
  assert.match(lastAnswer(event), /OmniFM Radio/);
});

test("Listen now outside a voice channel: a short hint, nothing plays", async () => {
  const { runtime, guild } = fakeRuntime();
  const event = interaction({ guild, voiceChannelId: null });
  await runtime.handleRadioListenButton(event);
  assert.equal(runtime.plays.length, 0);
  assert.match(lastAnswer(event), /Sprachkanal/);
  assert.ok(event.answers.at(-1).flags & MessageFlags.Ephemeral);
});

test("Listen now where OmniFM Radio is hidden, or without the /play right: refused", async () => {
  const hidden = fakeRuntime({ guildId: HIDDEN_GUILD, voiceMembers: { [VOICE]: [] } });
  const refused = interaction({ guildId: HIDDEN_GUILD, guild: hidden.guild });
  await hidden.runtime.handleRadioListenButton(refused);
  assert.equal(hidden.runtime.plays.length, 0);
  assert.match(lastAnswer(refused), /OmniFM Radio/);

  const locked = fakeRuntime({ voiceMembers: { [VOICE]: [] } });
  locked.runtime.checkCommandRolePermission = (_interaction, command) => ({ ok: command !== "play", message: "Nur mit der DJ-Rolle." });
  const noRight = interaction({ guild: locked.guild });
  await locked.runtime.handleRadioListenButton(noRight);
  assert.equal(locked.runtime.plays.length, 0);
  assert.match(lastAnswer(noRight), /Nur mit der DJ-Rolle/);
});

test("Listen now never switches anybody: OmniFM 1 busy elsewhere or another OmniFM bot in the channel", async () => {
  const busy = fakeRuntime({ voiceMembers: { [VOICE]: [] } });
  busy.runtime.guildState.set(TEST_GUILD, { currentStationKey: "groove", connection: { joinConfig: { channelId: OTHER_VOICE } } });
  const elsewhere = interaction({ guild: busy.guild });
  await busy.runtime.handleRadioListenButton(elsewhere);
  assert.equal(busy.runtime.plays.length, 0, "the other channel keeps its station");
  assert.match(lastAnswer(elsewhere), new RegExp(`<#${OTHER_VOICE}>`));

  busy.runtime.guildState.set(TEST_GUILD, { currentStationKey: KEY, connection: { joinConfig: { channelId: VOICE } } });
  const already = interaction({ guild: busy.guild });
  await busy.runtime.handleRadioListenButton(already);
  assert.equal(busy.runtime.plays.length, 0);
  assert.match(lastAnswer(already), /läuft/i);

  process.env.BOT_1_TOKEN = "token-1";
  process.env.BOT_1_CLIENT_ID = "100000000000000001";
  process.env.BOT_3_TOKEN = "token-3";
  process.env.BOT_3_CLIENT_ID = "100000000000000003";
  try {
    const shared = fakeRuntime({ voiceMembers: { [VOICE]: [{ id: "100000000000000003", user: { id: "100000000000000003", bot: true }, displayName: "OmniFM 2" }] } });
    const occupied = interaction({ guild: shared.guild });
    await shared.runtime.handleRadioListenButton(occupied);
    assert.equal(shared.runtime.plays.length, 0, "the other OmniFM bot keeps going");
    assert.match(lastAnswer(occupied), /OmniFM 2/);
  } finally {
    for (const name of ["BOT_1_TOKEN", "BOT_1_CLIENT_ID", "BOT_3_TOKEN", "BOT_3_CLIENT_ID"]) delete process.env[name];
  }
});

// ---------------------------------------------------------------- the bridge

test("split mode: the commander's post and edit reach OmniFM 1 through the worker bridge", async () => {
  const { WorkerBridgeService } = await import("../src/bot/worker-bridge-service.js");
  const { RemoteWorkerHandle } = await import("../src/bot/remote-worker-handle.js");
  const calls = [];
  const service = new WorkerBridgeService({
    config: { id: "bot-2" },
    postRadioAnnouncement: async (...args) => { calls.push(["post", ...args]); return { ok: true, channelId: SYSTEM, messageId: "91" }; },
    endRadioAnnouncement: async (...args) => { calls.push(["end", ...args]); return { ok: true }; },
  }, { bridge: {}, doorbell: { isDoorbellConnected: () => false, onDoorbell: () => () => {} } });
  const post = { channelId: "", roleId: ROLE, show: SHOW };
  assert.deepEqual(await service.executeCommand({ type: "radioAnnounce", payload: { guildId: TEST_GUILD, ...post } }), { ok: true, channelId: SYSTEM, messageId: "91" });
  const end = { channelId: SYSTEM, messageId: "91", show: SHOW };
  assert.deepEqual(await service.executeCommand({ type: "radioAnnounceEnd", payload: { guildId: TEST_GUILD, ...end } }), { ok: true });
  assert.deepEqual(calls, [["post", TEST_GUILD, post], ["end", TEST_GUILD, end]]);

  const handle = new RemoteWorkerHandle({ id: "bot-2", name: "OmniFM 1" });
  const sent = [];
  handle.sendCommand = async (type, payload) => { sent.push([type, payload]); return { ok: true }; };
  await handle.postRadioAnnouncement(TEST_GUILD, post);
  await handle.endRadioAnnouncement(TEST_GUILD, end);
  assert.deepEqual(sent, [["radioAnnounce", { guildId: TEST_GUILD, ...post }], ["radioAnnounceEnd", { guildId: TEST_GUILD, ...end }]]);
});

test("the button under the message reaches the Listen now handler", async () => {
  const { menuMethods } = await import("../src/bot/runtime-methods/menus.js");
  const runtime = { handled: 0, async handleRadioListenButton() { runtime.handled += 1; return true; } };
  assert.equal(await menuMethods.handleComponentInteraction.call(runtime, { customId: RADIO_LISTEN_ID, isButton: () => true }), true);
  assert.equal(runtime.handled, 1);
});

// ---------------------------------------------------------------- races

test("two Listen now clicks from different channels at once: OmniFM 1 plays in one, the other is told, nobody is switched", async () => {
  const { BotRuntime } = await import("../src/bot/runtime.js");
  const { guild } = fakeRuntime({ voiceMembers: { [VOICE]: [], [OTHER_VOICE]: [] } });
  const runtime = Object.create(BotRuntime.prototype);
  const connects = [];
  const snapshots = [];
  Object.assign(runtime, {
    config: { id: "bot-2", name: "OmniFM 1" },
    role: "worker",
    workerSlot: 1,
    client: { application: { id: ME }, user: { id: ME }, guilds: { cache: new Map([[TEST_GUILD, guild]]) } },
    guildState: new Map(),
    getState(guildId) {
      if (!runtime.guildState.has(guildId)) runtime.guildState.set(guildId, { volume: 100, channelVolumes: {} });
      return runtime.guildState.get(guildId);
    },
    resolveBotMember: async () => ({ id: ME }),
    resolveGuildLanguage: () => "de",
    createInteractionTranslator: () => ({ language: "de", isDe: true, t: botTranslator("de") }),
    getGuildAccess: () => ({ allowed: true }),
    checkCommandRolePermission: () => ({ ok: true }),
    validateVoiceChannelAccess: async () => ({ ok: true }),
    refreshVoiceGuardSettings: async () => null,
    clearRestoreRetry: () => {},
    clearScheduledEventPlayback: () => {},
    updatePresence: () => {},
    publishWorkerSnapshot: async () => { snapshots.push(Date.now()); },
    // Joining a voice channel takes a moment: the second click arrives meanwhile.
    async ensureVoiceConnectionForChannel(_guildId, channelId, state) {
      connects.push(channelId);
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      state.connection = { joinConfig: { channelId } };
      return { channel: { type: ChannelType.GuildVoice } };
    },
    async playStation(state, _stations, key) {
      state.currentStationKey = key;
    },
  });
  const first = interaction({ guild, voiceChannelId: VOICE });
  const second = interaction({ guild, voiceChannelId: OTHER_VOICE });
  await Promise.all([runtime.handleRadioListenButton(first), runtime.handleRadioListenButton(second)]);
  assert.deepEqual(connects, [VOICE], "one join, no switch to the second channel");
  assert.equal(runtime.guildState.get(TEST_GUILD).connection.joinConfig.channelId, VOICE);
  assert.match(lastAnswer(first), /spielt jetzt OmniFM Radio/);
  assert.match(lastAnswer(second), new RegExp(`<#${VOICE}>`), "the second is told where OmniFM 1 plays");
  assert.equal(snapshots.length, 1, "the commander learns at once that OmniFM 1 is busy");
});

test("split mode: the worker can publish its snapshot right after Listen now", async () => {
  const { WorkerBridgeService } = await import("../src/bot/worker-bridge-service.js");
  const published = [];
  const runtime = { config: { id: "bot-2" }, buildStatusSnapshot: () => ({}), client: { guilds: { cache: new Map() } } };
  new WorkerBridgeService(runtime, {
    bridge: { publishWorkerSnapshot: async (id) => { published.push(id); } },
    doorbell: { isDoorbellConnected: () => false, onDoorbell: () => () => {} },
  });
  await runtime.publishWorkerSnapshot();
  assert.deepEqual(published, ["bot-2"]);
});
