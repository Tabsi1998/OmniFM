import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType, ComponentType, MessageFlags, PermissionFlagsBits } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-forms-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const forms = await import("../src/bot/forms.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { countGuildStations, getGuildStations } = await import("../src/custom-stations.js");
const { listScheduledEvents } = await import("../src/scheduled-events-store.js");
const { getRecentRuntimeIncidents, describeRuntimeIncident } = await import("../src/runtime-incidents-store.js");
const { buildRepeatChoices } = await import("../src/commands.js");

const de = (german) => german;
const GUILD = "123456789012345678";
const VOICE = "223456789012345678";
const USER = "323456789012345678";
let plan = "ultimate";
setLicenseProvider((serverId) => (String(serverId) === GUILD ? { plan, active: true, seats: 1 } : null));

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  return out;
}
const allText = (payload) => (payload.components || []).flatMap((component) => texts(component)).join("\n")
  + (payload.embeds || []).map((embed) => JSON.stringify(embed.toJSON ? embed.toJSON() : embed)).join("\n");

/** What a submitted form hands the bot: text values, select values, channels, files. */
function formFields({ text = {}, select = {}, channels = {}, files = {} } = {}) {
  return {
    getTextInputValue: (id) => text[id] ?? "",
    getStringSelectValues: (id) => select[id] ?? [],
    getSelectedChannels: (id) => (channels[id] ? { first: () => channels[id] } : null),
    getUploadedFiles: (id) => (files[id] ? { first: () => files[id] } : null),
  };
}

function submit(customId, fields, extra = {}) {
  const calls = [];
  const interaction = {
    calls,
    customId,
    fields,
    guildId: GUILD,
    user: { id: USER },
    memberPermissions: { has: (bit) => bit === PermissionFlagsBits.ManageGuild },
    deferred: false,
    replied: false,
    isModalSubmit: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    async reply(payload) { interaction.replied = true; calls.push(["reply", payload]); },
    async deferReply() { interaction.deferred = true; calls.push(["deferReply"]); },
    async editReply(payload) { calls.push(["editReply", payload]); },
    async showModal(modal) { calls.push(["modal", modal]); },
    ...extra,
  };
  return interaction;
}

const last = (interaction) => interaction.calls.filter(([kind]) => kind !== "deferReply").at(-1)[1];

function commander() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-commander", name: "OmniFM DJ" };
  runtime.role = "commander";
  runtime.resolveInteractionLanguage = () => "de";
  runtime.resolveGuildLanguage = () => "de";
  runtime.workerManager = { getInvitedWorkers: () => [{}] };
  return runtime;
}

// ---- the forms themselves ----

test("the three forms: fields, choices and Discord's limits", () => {
  const station = forms.buildStationFormModal({ t: de, genres: ["Ambient", "Techno"] }).toJSON();
  assert.equal(station.custom_id, forms.STATION_FORM_ID);
  assert.deepEqual(station.components.map((block) => block.component.custom_id), ["name", "url", "genre", "key", "logo"]);
  assert.equal(station.components.length, 5, "Discord allows five fields");
  assert.equal(station.components[4].component.type, ComponentType.FileUpload);
  assert.equal(station.components[4].component.required, false);
  assert.deepEqual(station.components[2].component.options.map((option) => option.value), ["Ambient", "Techno", "__other__"]);

  const event = forms.buildEventFormModal({ t: de, repeatChoices: buildRepeatChoices(), language: "de" }).toJSON();
  assert.equal(event.components.length, 5, "Discord allows five fields");
  const voice = event.components[2].component;
  assert.equal(voice.type, ComponentType.ChannelSelect);
  assert.deepEqual(voice.channel_types, [ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
  assert.equal(event.components[4].component.options[0].label, "Einmalig");

  const report = forms.buildProblemReportModal({ t: de }).toJSON();
  assert.equal(report.custom_id, "np:reportform");
  assert.deepEqual(report.components[0].component.options.map((option) => option.label), ["Kein Ton", "Falscher Sender", "Hängt oder stockt", "Etwas anderes"]);
  assert.equal(report.components[1].component.required, false);
});

test("reading the station form: key from the name, broken input named", () => {
  assert.deepEqual(forms.readStationForm(formFields({ text: { name: "Mein Vereinsradio!", url: "https://stream.example.com/live" }, select: { genre: ["Ambient"] } })), {
    ok: true, station: { key: "mein-vereinsradio", name: "Mein Vereinsradio!", url: "https://stream.example.com/live", genre: "Ambient" }, logo: null,
  });
  assert.equal(forms.readStationForm(formFields({ text: { name: "X", url: "https://a.b" } })).error, "name");
  assert.equal(forms.readStationForm(formFields({ text: { name: "Radio", url: "ftp://a.b/x" } })).error, "url");
  assert.equal(forms.readStationForm(formFields({ text: { name: "Radio", url: "kein link" } })).error, "url");
  assert.equal(forms.readStationForm(formFields({ text: { name: "!!", url: "https://a.b" } })).error, "key");
  assert.equal(forms.readStationForm(formFields({ text: { name: "Radio", url: "https://a.b", key: "eigener" }, select: { genre: ["__other__"] } })).station.genre, "");
});

// ---- add a station ----

test("the station form: opening saves nothing, a dead stream saves nothing, a live one is saved", async () => {
  plan = "ultimate";
  const runtime = commander();

  const open = submit("", null, { isModalSubmit: () => false, options: { getString: () => null } });
  await runtime.openStationForm(open);
  assert.equal(open.calls[0][0], "modal", "the form opens");
  assert.equal(countGuildStations(GUILD), 0, "closing the form (cancel) leaves nothing behind");

  const invalid = submit(forms.STATION_FORM_ID, formFields({ text: { name: "Radio", url: "no url" } }));
  await runtime.handleFormSubmit(invalid);
  assert.match(allText(last(invalid)), /http:\/\/ oder https:\/\//);

  const dead = submit(forms.STATION_FORM_ID, formFields({ text: { name: "Totes Radio", url: "https://dead.example.com/stream" } }));
  await runtime.handleStationFormSubmit(dead, { testStream: async () => ({ ok: false, error: "HTTP 404" }) });
  assert.match(allText(last(dead)), /Stream antwortet nicht[\s\S]*HTTP 404[\s\S]*Nichts gespeichert/);
  assert.equal(countGuildStations(GUILD), 0);

  const live = submit(forms.STATION_FORM_ID, formFields({ text: { name: "Vereinsradio", url: "https://1.1.1.1/live" }, select: { genre: ["Ambient"] } }));
  await runtime.handleStationFormSubmit(live, { testStream: async () => ({ ok: true }) });
  assert.match(allText(last(live)), /Sender gespeichert[\s\S]*vereinsradio/);
  const saved = getGuildStations(GUILD).vereinsradio;
  assert.equal(saved.name, "Vereinsradio");
  assert.equal(saved.genre, "Ambient");

  plan = "pro";
  const notUltimate = submit(forms.STATION_FORM_ID, formFields({ text: { name: "Zweites", url: "https://stream.example.com/2" } }));
  await runtime.handleFormSubmit(notUltimate);
  assert.match(allText(last(notUltimate)), /Premium nötig[\s\S]*Ultimate/);
  plan = "ultimate";
});

// ---- plan an event ----

function eventServer() {
  const me = { id: "bot-me" };
  const voice = {
    id: VOICE,
    guildId: GUILD,
    name: "Radio",
    type: ChannelType.GuildVoice,
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    toString: () => `<#${VOICE}>`,
  };
  const guild = { id: GUILD, name: "Club", members: { me }, channels: { cache: new Map([[VOICE, voice]]), fetch: async () => null } };
  return { guild, voice };
}

test("the event form runs through /event create's checks and saves the event", async () => {
  plan = "pro";
  const runtime = commander();
  const { guild, voice } = eventServer();
  const stationKey = "groovesalad";

  const noVoice = submit(forms.EVENT_FORM_ID, formFields({ text: { name: "Morgenshow", station: stationKey, start: "01.10.2030 20:00" }, select: { repeat: ["weekly"] } }), { guild });
  await runtime.handleFormSubmit(noVoice);
  assert.match(allText(last(noVoice)), /Voice- oder Stage-Channel fehlt/);

  const badStart = submit(forms.EVENT_FORM_ID, formFields({ text: { name: "Morgenshow", station: stationKey, start: "irgendwann" }, select: { repeat: ["weekly"] }, channels: { voice } }), { guild });
  await runtime.handleFormSubmit(badStart);
  assert.match(allText(last(badStart)), /Zeitfenster ungültig|Invalid event window/);

  const badStation = submit(forms.EVENT_FORM_ID, formFields({ text: { name: "Morgenshow", station: "gibt-es-nicht", start: "01.10.2030 20:00" }, select: { repeat: ["none"] }, channels: { voice } }), { guild });
  await runtime.handleFormSubmit(badStation);
  assert.match(allText(last(badStation)), /Sender prüfen/);
  assert.equal(listScheduledEvents({ guildId: GUILD }).length, 0, "nothing saved so far");

  const ok = submit(forms.EVENT_FORM_ID, formFields({ text: { name: "Morgenshow", station: stationKey, start: "01.10.2030 20:00" }, select: { repeat: ["weekly"] }, channels: { voice } }), { guild });
  await runtime.handleFormSubmit(ok);
  const [event] = listScheduledEvents({ guildId: GUILD });
  assert.equal(event.name, "Morgenshow");
  assert.equal(event.stationKey, stationKey);
  assert.equal(event.voiceChannelId, VOICE);
  assert.equal(event.repeat, "weekly");
  assert.equal(last(ok).flags, MessageFlags.Ephemeral);
});

test("/event form only for server managers", async () => {
  plan = "pro";
  const runtime = commander();
  const stranger = submit("", null, {
    isModalSubmit: () => false,
    memberPermissions: { has: () => false },
    options: { getSubcommand: () => "form" },
  });
  const { handleEventCommand } = await import("../src/bot/runtime-event-command.js");
  await handleEventCommand(runtime, stranger);
  assert.equal(stranger.calls[0][0], "reply");
  const manager = submit("", null, { isModalSubmit: () => false, options: { getSubcommand: () => "form" } });
  await handleEventCommand(runtime, manager);
  assert.equal(manager.calls[0][0], "modal");
});

// ---- report a problem ----

test("a problem report becomes a server incident with station and playback history", async () => {
  const worker = Object.create(BotRuntime.prototype);
  worker.config = { id: "bot-2", name: "OmniFM 1" };
  worker.role = "worker";
  worker.resolveInteractionLanguage = () => "de";
  worker.guildState = new Map([[GUILD, {
    currentStationKey: "groovesalad",
    currentStationName: "Groove Salad",
    playbackPhaseHistory: [
      { from: "playing", to: "recovering", reason: "stall", at: Date.now() - 60_000 },
      { from: "recovering", to: "playing", reason: "", at: Date.now() - 30_000 },
    ],
  }]]);
  worker.getCurrentListenerCount = () => 3;

  const button = submit("np:report", null, { isModalSubmit: () => false });
  await worker.handleNowPlayingControl(button);
  assert.equal(button.calls[0][0], "modal", "the button opens the form");

  const empty = submit("np:reportform", formFields({ text: { detail: "x" } }));
  await worker.handleNowPlayingControl(empty);
  assert.match(allText(last(empty)), /Bitte auswählen/);

  const report = submit("np:reportform", formFields({ select: { reason: ["no_sound"] }, text: { detail: "Seit 5 Minuten   still" } }));
  await worker.handleNowPlayingControl(report);
  assert.match(allText(last(report)), /Danke für die Meldung[\s\S]*Kein Ton[\s\S]*Dein Name wird nicht gespeichert/);

  const [incident] = await getRecentRuntimeIncidents(GUILD, 5);
  assert.equal(incident.eventKey, "listener_report");
  assert.equal(incident.payload.reason, "no_sound");
  assert.equal(incident.payload.detail, "Seit 5 Minuten still");
  assert.equal(incident.payload.previousStationName, "Groove Salad");
  assert.deepEqual(incident.payload.phaseHistory, ["playing → recovering (stall)", "recovering → playing"]);
  assert.equal(JSON.stringify(incident).includes(USER), false, "nobody's id is stored");
  assert.equal(describeRuntimeIncident("listener_report", incident.payload, "Club"), "Club: Hörer meldet kein Ton bei Groove Salad: Seit 5 Minuten still");

  const again = submit("np:reportform", formFields({ select: { reason: ["stuck"] } }));
  await worker.handleNowPlayingControl(again);
  assert.match(allText(last(again)), /Schon gemeldet/);
  assert.equal((await getRecentRuntimeIncidents(GUILD, 5)).length, 1, "one report per person in five minutes");
});
