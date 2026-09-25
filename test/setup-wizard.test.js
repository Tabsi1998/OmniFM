import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-setup-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const wizard = await import("../src/bot/setup-wizard.js");
const ui = await import("../src/discord/ui/index.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { buildStationCatalog } = await import("../src/bot/runtime-panels.js");
const { getNowPlayingCandidateIds } = await import("../src/lib/now-playing-target.js");
const { normalizeGuildSettings } = await import("../src/lib/guild-settings.js");
const { scoreOnboardingChannel } = await import("../src/bot/runtime-methods/onboarding.js");

const de = (german) => german;
const en = (_german, english) => english;
const GUILD_ID = "123456789012345678";
const VOICE_ID = "223456789012345678";
const STAGE_ID = "323456789012345678";
const TEXT_ID = "423456789012345678";
const GENERAL_ID = "523456789012345678";

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  if (json.accessory) texts(json.accessory, out);
  return out;
}

function nodes(node, type, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === type) out.push(json);
  for (const child of json.components || []) nodes(child, type, out);
  if (json.accessory) nodes(json.accessory, type, out);
  return out;
}

const allText = (payload) => payload.components.flatMap((component) => texts(component)).join("\n");
const buttons = (payload) => payload.components.flatMap((component) => nodes(component, 2));
const selects = (payload) => payload.components.flatMap((component) => nodes(component, 3));

function perms(missing = []) {
  return { has: (bit) => !missing.includes(bit) };
}

test("setup custom ids parse back and ignore foreign or unknown ones", () => {
  assert.deepEqual(wizard.parseSetupCustomId(wizard.setupCustomId("voice", "abc")), { action: "voice", sessionId: "abc" });
  assert.equal(wizard.parseSetupCustomId("omnifm:setup:delete:abc"), null);
  assert.equal(wizard.parseSetupCustomId("omnifm:setup:start"), null);
  assert.equal(wizard.parseSetupCustomId("omnifm:play:start:abc"), null);
});

test("missing permissions are named like in the Discord client; a stage needs no Speak", () => {
  const noSpeak = perms([PermissionFlagsBits.Speak]);
  assert.deepEqual(wizard.missingPermissionLabels(noSpeak, wizard.voiceChannelPermissions(ChannelType.GuildVoice), de), ["Sprechen"]);
  assert.deepEqual(wizard.missingPermissionLabels(noSpeak, wizard.voiceChannelPermissions(ChannelType.GuildStageVoice), de), []);
  const nothing = perms([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]);
  assert.deepEqual(wizard.missingPermissionLabels(nothing, wizard.voiceChannelPermissions(ChannelType.GuildVoice), en), ["View Channel", "Connect", "Speak"]);
  assert.deepEqual(wizard.missingPermissionLabels(null, wizard.PANEL_CHANNEL_PERMISSIONS, de), ["Kanal ansehen", "Nachrichten senden", "Links einbetten"]);
});

test("the welcome is a public Components V2 message with the setup button", () => {
  const payload = wizard.buildWelcomePayload({ t: de, guildName: "Club", urls: { dashboard: "https://omnifm.xyz/?page=dashboard", support: "https://discord.gg/x" } });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  const body = allText(payload);
  assert.match(body, /Danke für die Einladung/);
  assert.match(body, /① Sprachkanal wählen\n② Sender wählen\n③ Kanal fürs Now-Playing-Panel wählen/);
  assert.match(body, /Server verwalten/);
  const ids = buttons(payload).map((button) => button.custom_id || button.url);
  assert.deepEqual(ids, [wizard.SETUP_COMPONENT_ID_OPEN, wizard.SETUP_COMPONENT_ID_HELP, "https://omnifm.xyz/?page=dashboard", "https://discord.gg/x"]);
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

function manyOptions(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({ label: `${prefix} ${index}`, value: `${prefix}-${index}` }));
}

test("the setup shows the worker invite first and cannot start without a worker", () => {
  const payload = wizard.buildSetupWizardPayload({
    t: de,
    sessionId: "s1",
    guildName: "Club",
    view: {
      worker: { ready: false, inviteUrl: "https://discord.com/oauth2/authorize?client_id=1" },
      voice: { options: manyOptions("v", 25) },
      station: { options: manyOptions("s", 25) },
      panel: { options: manyOptions("p", 25) },
    },
  });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const body = allText(payload);
  assert.match(body, /⬜ ① Sprachkanal {2}→ {2}⬜ ② Sender {2}→ {2}⬜ ③ Panel-Kanal/);
  assert.match(body, /Zuerst: einen Worker einladen/);
  const invite = buttons(payload).find((button) => button.label === "Worker einladen");
  assert.equal(invite.url, "https://discord.com/oauth2/authorize?client_id=1");
  const start = buttons(payload).find((button) => button.custom_id === "omnifm:setup:start:s1");
  assert.equal(start.disabled, true);
  assert.deepEqual(selects(payload).map((select) => select.custom_id), ["omnifm:setup:voice:s1", "omnifm:setup:station:s1", "omnifm:setup:panel:s1"]);
  // Three full menus, the invite and five buttons still fit Discord's limits.
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

test("a missing permission in step ① says exactly which one and blocks the start", () => {
  const payload = wizard.buildSetupWizardPayload({
    t: de,
    sessionId: "s1",
    view: {
      worker: { ready: true, name: "OmniFM 1" },
      voice: { options: manyOptions("v", 2), selectedId: VOICE_ID, missing: ["Verbinden", "Sprechen"] },
      station: { options: manyOptions("s", 2), selectedKey: "s-0", selectedName: "Groove Salad" },
      panel: { options: manyOptions("p", 2) },
    },
    urls: { permissionsHelp: "https://omnifm.xyz/faq" },
  });
  const body = allText(payload);
  assert.match(body, /⚠️ ① Sprachkanal {2}→ {2}✅ ② Sender/);
  assert.match(body, new RegExp(`In <#${VOICE_ID}> fehlt mir: \\*\\*Verbinden, Sprechen\\*\\*`));
  assert.equal(buttons(payload).find((button) => button.custom_id === "omnifm:setup:start:s1").disabled, true);
  assert.ok(buttons(payload).some((button) => button.url === "https://omnifm.xyz/faq"));
});

test("with voice channel and station chosen the radio can start", () => {
  const payload = wizard.buildSetupWizardPayload({
    t: en,
    sessionId: "s1",
    view: {
      worker: { ready: true, name: "OmniFM 1" },
      voice: { options: manyOptions("v", 2), selectedId: VOICE_ID, missing: [] },
      station: { options: manyOptions("s", 2), selectedKey: "s-0", selectedName: "Groove Salad" },
      panel: { options: manyOptions("p", 2), selectedId: wizard.SETUP_PANEL_AUTO },
    },
  });
  const body = allText(payload);
  assert.match(body, /✅ ① Voice channel {2}→ {2}✅ ② Station {2}→ {2}✅ ③ Panel channel/);
  assert.match(body, /OmniFM 1 has the permissions it needs/);
  assert.match(body, /Automatic: in the voice channel's chat/);
  assert.equal(buttons(payload).find((button) => button.custom_id === "omnifm:setup:start:s1").disabled === true, false);
});

test("the last view says it runs and where the panel appears", () => {
  const payload = wizard.buildSetupDonePayload({
    t: de,
    workerName: "OmniFM 1",
    stationName: "Groove Salad",
    voiceChannelId: VOICE_ID,
    panelChannelId: TEXT_ID,
    urls: { dashboard: "https://omnifm.xyz/?page=dashboard" },
    quickstartId: "omnifm:play:open",
  });
  const body = allText(payload);
  assert.match(body, /Läuft! 🎉/);
  assert.match(body, new RegExp(`OmniFM 1 spielt jetzt \\*\\*Groove Salad\\*\\* in <#${VOICE_ID}>`));
  assert.match(body, new RegExp(`Panel erscheint in <#${TEXT_ID}>`));
  assert.equal(payload.components[0].toJSON().accent_color, ui.UI_COLORS.success);
  assert.ok(buttons(payload).some((button) => button.custom_id === "omnifm:play:open"));
});

// ---- the runtime side: fake commander, one worker, one server ----

function channel(id, name, type, rawPosition, permissionsFor) {
  return {
    id,
    name,
    type,
    rawPosition,
    isVoiceBased: () => type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice,
    permissionsFor,
  };
}

function buildWorld({ voiceMissing = [PermissionFlagsBits.Speak] } = {}) {
  const me = { id: "worker-me" };
  const channels = new Map([
    [VOICE_ID, channel(VOICE_ID, "Radio", ChannelType.GuildVoice, 3, () => perms(voiceMissing))],
    [STAGE_ID, channel(STAGE_ID, "Bühne", ChannelType.GuildStageVoice, 4, () => perms([PermissionFlagsBits.Speak]))],
    [TEXT_ID, channel(TEXT_ID, "musik", ChannelType.GuildText, 1, () => perms())],
    [GENERAL_ID, channel(GENERAL_ID, "general", ChannelType.GuildText, 0, () => perms([PermissionFlagsBits.SendMessages]))],
  ]);
  const guild = { id: GUILD_ID, name: "Club", channels: { cache: channels }, members: { me } };
  const plays = [];
  const worker = {
    config: { name: "OmniFM 1", index: 1 },
    client: { guilds: { cache: new Map([[GUILD_ID, guild]]) } },
    resolveBotMember: async (target) => target.members.me,
    validateVoiceChannelAccess: async () => ({ ok: true }),
    clearScheduledEventPlaybackInGuild() {},
    playInGuild: async (...args) => {
      plays.push(args);
      return { ok: true, workerName: "OmniFM 1" };
    },
  };
  const runtime = Object.create(BotRuntime.prototype);
  runtime.interactiveUiSessions = new Map();
  runtime.guildSettingsCache = new Map();
  runtime.role = "commander";
  runtime.config = { name: "Commander" };
  runtime.client = { guilds: { cache: new Map([[GUILD_ID, guild]]) }, application: { id: null } };
  runtime.resolveInteractionLanguage = () => "de";
  runtime.loadGuildSettingsCached = async () => ({});
  runtime.workerManager = {
    workers: [worker],
    findFreeWorker: () => worker,
    getInvitedWorkers: () => [worker],
    getWorkerByIndex: () => worker,
    findStreamingWorkerByChannel: () => null,
    findConnectedWorkerByChannel: async () => null,
    refreshRemoteStates: async () => null,
  };
  return { runtime, guild, worker, plays };
}

function interactionFor(guild, customId = "", { values = null, manager = true } = {}) {
  const calls = [];
  return {
    calls,
    customId,
    values,
    guildId: GUILD_ID,
    guild,
    user: { id: "user-1" },
    member: { voice: { channelId: null } },
    memberPermissions: { has: (bit) => manager && bit === PermissionFlagsBits.ManageGuild },
    isStringSelectMenu: () => Array.isArray(values),
    isButton: () => !Array.isArray(values),
    deferUpdate: async () => { calls.push(["deferUpdate"]); },
    deferReply: async (options) => { calls.push(["deferReply", options]); },
    editReply: async (payload) => { calls.push(["editReply", payload]); },
    update: async (payload) => { calls.push(["update", payload]); },
    reply: async (payload) => { calls.push(["reply", payload]); },
  };
}

const lastPayload = (interaction) => interaction.calls.filter(([kind]) => kind === "editReply" || kind === "update").at(-1)[1];

test("only server managers get the setup", async () => {
  const { runtime, guild } = buildWorld();
  const payload = await runtime.openSetupWizard(interactionFor(guild, "", { manager: false }));
  assert.match(allText(payload), /Nur für Server-Verwalter/);
  assert.match(allText(payload), /Server verwalten/);
  assert.equal(runtime.interactiveUiSessions.size, 0);
});

test("the setup runs from voice channel to station to a running radio without a command", async () => {
  const { runtime, guild, plays } = buildWorld();
  const opened = await runtime.openSetupWizard(interactionFor(guild));
  assert.equal(opened.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const [session] = runtime.interactiveUiSessions.values();
  assert.equal(session.type, "setup");

  // The panel menu offers "automatic" and the channels the worker can post in.
  const panelMenu = selects(opened).find((select) => select.custom_id === `omnifm:setup:panel:${session.id}`);
  assert.deepEqual(panelMenu.options.map((option) => option.value), [wizard.SETUP_PANEL_AUTO, TEXT_ID]);

  // ① the voice channel: the worker may not speak there, the setup says so
  const voice = interactionFor(guild, `omnifm:setup:voice:${session.id}`, { values: [VOICE_ID] });
  await runtime.handleSetupComponentInteraction(voice);
  assert.equal(voice.calls[0][0], "deferUpdate");
  assert.match(allText(lastPayload(voice)), /fehlt mir: \*\*Sprechen\*\*/);
  assert.equal(lastPayload(voice).flags, MessageFlags.IsComponentsV2);

  // a stage needs no Speak: step ① is fine
  const stage = interactionFor(guild, `omnifm:setup:voice:${session.id}`, { values: [STAGE_ID] });
  await runtime.handleSetupComponentInteraction(stage);
  assert.match(allText(lastPayload(stage)), /Die Rechte für OmniFM 1 passen/);

  // ② the station
  const stationKey = buildStationCatalog(GUILD_ID).entries[0].key;
  const station = interactionFor(guild, `omnifm:setup:station:${session.id}`, { values: [stationKey] });
  await runtime.handleSetupComponentInteraction(station);
  const startButton = buttons(lastPayload(station)).find((button) => button.custom_id === `omnifm:setup:start:${session.id}`);
  assert.equal(startButton.disabled === true, false);

  // start: the worker plays, the view says "Läuft!"
  const start = interactionFor(guild, `omnifm:setup:start:${session.id}`);
  await runtime.handleSetupComponentInteraction(start);
  assert.equal(plays.length, 1);
  assert.deepEqual(plays[0].slice(0, 3), [GUILD_ID, STAGE_ID, stationKey]);
  assert.match(allText(lastPayload(start)), /Läuft! 🎉/);
  assert.equal(runtime.interactiveUiSessions.size, 0);
});

test("step ③ is saved for the server; without a database the setup says it", async () => {
  const { runtime, guild } = buildWorld();
  await runtime.openSetupWizard(interactionFor(guild));
  const [session] = runtime.interactiveUiSessions.values();
  runtime.guildSettingsCache.set(GUILD_ID, { loadedAt: Date.now(), value: {} });
  const panel = interactionFor(guild, `omnifm:setup:panel:${session.id}`, { values: [TEXT_ID] });
  await runtime.handleSetupComponentInteraction(panel);
  assert.equal(runtime.getInteractiveUiSession(session.id).data.panelChannelId, TEXT_ID);
  assert.equal(runtime.guildSettingsCache.has(GUILD_ID), false);
  const body = allText(lastPayload(panel));
  assert.match(body, /Nicht gespeichert/);
  assert.match(body, new RegExp(`Das Panel erscheint in <#${TEXT_ID}>`));
});

test("an expired setup answers in place instead of failing", async () => {
  const { runtime, guild } = buildWorld();
  const stale = interactionFor(guild, "omnifm:setup:start:gone");
  assert.equal(await runtime.handleSetupComponentInteraction(stale), true);
  assert.equal(stale.calls[0][0], "update");
  assert.match(allText(stale.calls[0][1]), /Nicht mehr gültig/);
});

test("the welcome goes to the system channel or a bot/team channel, never to #general", async () => {
  const { runtime } = buildWorld();
  runtime.resolveBotMember = async () => ({ id: "me" });
  const sendable = () => perms();
  const general = channel("1", "general", ChannelType.GuildText, 0, sendable);
  const bots = channel("2", "bot-commands", ChannelType.GuildText, 5, sendable);
  const withBots = { systemChannel: null, channels: { cache: new Map([["1", general], ["2", bots]]) } };
  assert.equal(await runtime.resolveOnboardingChannel(withBots), bots);
  const onlyGeneral = { systemChannel: null, channels: { cache: new Map([["1", general]]) } };
  assert.equal(await runtime.resolveOnboardingChannel(onlyGeneral), null);
  const system = channel("3", "willkommen", ChannelType.GuildText, 9, sendable);
  assert.equal(await runtime.resolveOnboardingChannel({ systemChannel: system, channels: { cache: new Map() } }), system);
  assert.equal(scoreOnboardingChannel({ name: "allgemein" }), 0);
});

test("the panel channel from the setup comes first for the now-playing panel", () => {
  const ids = getNowPlayingCandidateIds(
    { connection: { joinConfig: { channelId: "voice-1" } }, lastChannelId: "voice-1" },
    { systemChannelId: "system-1" },
    { configuredChannelId: "panel-1" },
  );
  assert.deepEqual(ids, ["panel-1", "voice-1", "system-1"]);
});

test("a stored panel channel is a Discord id or nothing", () => {
  assert.equal(normalizeGuildSettings({ nowPlayingChannelId: TEXT_ID }).nowPlayingChannelId, TEXT_ID);
  assert.equal("nowPlayingChannelId" in normalizeGuildSettings({ nowPlayingChannelId: "abc" }), false);
});
