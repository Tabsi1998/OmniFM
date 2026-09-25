import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ButtonStyle, MessageFlags } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-station-browser-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const {
  buildBrowserEntries,
  buildStationBrowserPayload,
  colorSquare,
  filterBrowserEntries,
  parsePickTarget,
  pickCustomId,
} = await import("../src/bot/station-browser.js");
const ui = await import("../src/discord/ui/index.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { handleRuntimePanelInteraction } = await import("../src/bot/runtime-panels.js");
const { STATIONS_COMPONENT_PREFIX } = await import("../src/bot/runtime-links.js");

const t = (de) => de;
const catalog = JSON.parse(fs.readFileSync(new URL("../stations.json", import.meta.url), "utf8")).stations;

function tree(payload) {
  return payload.components[0].toJSON();
}

function sections(box) {
  return box.components.filter((component) => component.type === 9);
}

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === 10) out.push(node.content);
  for (const child of node.components || []) texts(child, out);
  if (node.accessory) texts(node.accessory, out);
  return out;
}

test("free servers see their stations first, the rest locked behind Premium", () => {
  const entries = buildBrowserEntries({ stations: catalog, guildTier: "free" });
  assert.equal(entries.length, 120);
  const firstLocked = entries.findIndex((entry) => entry.locked);
  assert.ok(firstLocked > 0 && entries.slice(firstLocked).every((entry) => entry.locked), "available ones first");
  assert.equal(entries.filter((entry) => !entry.locked).length, 20);
  assert.equal(buildBrowserEntries({ stations: catalog, guildTier: "ultimate" }).filter((entry) => entry.locked).length, 0);
});

test("genre and search narrow the list", () => {
  const entries = buildBrowserEntries({ stations: catalog, guildTier: "pro" });
  const techno = filterBrowserEntries(entries, { genre: "Techno" });
  assert.ok(techno.length >= 10 && techno.every((entry) => entry.genre === "Techno"));
  const groove = filterBrowserEntries(entries, { query: "GROOVE" });
  assert.ok(groove.some((entry) => entry.key === "groovesalad"));
  assert.ok(groove.every((entry) => /groove/i.test(entry.name)), "case does not matter");
  assert.ok(filterBrowserEntries(entries, { query: "lounge" }).length >= 2, "the genre matches too");
});

test("a page: five stations with a play button, genre menu, navigation, brand line", () => {
  const entries = buildBrowserEntries({ stations: catalog, guildTier: "free" });
  const payload = buildStationBrowserPayload({
    t, prefix: "st:", session: { id: "s1", data: { page: 0 } }, entries, planName: "Free", premiumUrl: "https://omnifm.xyz/premium",
  });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const box = tree(payload);
  const rows = sections(box);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].accessory.custom_id, `st:pick:s1:${entries[0].key}`);
  assert.equal(rows[0].accessory.style, ButtonStyle.Primary);
  const selects = box.components.filter((component) => component.type === 1).flatMap((row) => row.components).filter((component) => component.type === 3);
  assert.equal(selects[0].options[0].label, "Alle Genres");
  assert.ok(selects[0].options.length <= 25);
  assert.match(texts(box)[0], /Plan: \*\*Free\*\* · 120 Sender/);
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

test("a locked station links to Premium instead of playing", () => {
  const entries = buildBrowserEntries({ stations: catalog, guildTier: "free" });
  const lastPage = Math.ceil(entries.length / 5) - 1;
  const box = tree(buildStationBrowserPayload({
    t, prefix: "st:", session: { id: "s1", data: { page: lastPage } }, entries, planName: "Free", premiumUrl: "https://omnifm.xyz/premium",
  }));
  const accessory = sections(box)[0].accessory;
  assert.equal(accessory.style, ButtonStyle.Link);
  assert.equal(accessory.url, "https://omnifm.xyz/premium");
  assert.equal(accessory.emoji.name, "🔒");
});

test("an empty result says what to do and offers to show everything again", () => {
  const entries = buildBrowserEntries({ stations: catalog, guildTier: "free" });
  const box = tree(buildStationBrowserPayload({
    t, prefix: "st:", session: { id: "s1", data: { query: "zzzz-nothing" } }, entries, planName: "Free", premiumUrl: "https://omnifm.xyz",
  }));
  assert.match(texts(box).join("\n"), /Keine Sender gefunden/);
  const buttons = box.components.filter((component) => component.type === 1).flatMap((row) => row.components);
  assert.ok(buttons.some((button) => button.custom_id === "st:reset:s1"));
});

test("play button ids carry session and station, also custom stations with a colon", () => {
  assert.deepEqual(parsePickTarget("abc123:custom:my-station"), { sessionId: "abc123", stationKey: "custom:my-station" });
  assert.equal(pickCustomId("p:", "s", "x".repeat(200)), null, "too long for Discord");
  assert.equal(colorSquare("#7C3AED"), "🟪");
  assert.equal(colorSquare("#EF4444"), "🟥");
  assert.equal(colorSquare(null), "⬛");
});

function createRuntime() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-browser", name: "OmniFM DJ" };
  runtime.client = { user: { id: "bot-browser" }, guilds: { cache: new Map() } };
  runtime.guildState = new Map();
  runtime.interactiveUiSessions = new Map();
  runtime.resolveGuildLanguage = () => "de";
  runtime.resolveInteractionLanguage = () => "de";
  runtime.createInteractionTranslator = () => ({ t: (de) => de, language: "de" });
  runtime.getApplicationId = () => "app-commander";
  return runtime;
}

function interaction(runtime, customId, extra = {}) {
  const calls = [];
  return {
    calls,
    guildId: "guild-browser",
    user: { id: "user-1" },
    member: { voice: { channelId: null } },
    applicationId: "app-commander",
    customId,
    message: { flags: { has: (flag) => flag === MessageFlags.IsComponentsV2 } },
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    async update(payload) { calls.push(["update", payload]); },
    async reply(payload) { calls.push(["reply", payload]); },
    async showModal(modal) { calls.push(["modal", modal]); },
    ...extra,
  };
}

test("choosing a genre, searching and closing all happen in the same message", async () => {
  const runtime = createRuntime();
  const session = runtime.createInteractiveUiSession("stations", { guildId: "guild-browser", userId: "user-1", data: { page: 3 } });

  const select = interaction(runtime, `${STATIONS_COMPONENT_PREFIX}genre:${session.id}`, {
    isStringSelectMenu: () => true,
    values: ["Ambient"],
  });
  assert.equal(await handleRuntimePanelInteraction(runtime, select), true);
  const [kind, payload] = select.calls[0];
  assert.equal(kind, "update");
  assert.equal(payload.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
  assert.equal(runtime.getInteractiveUiSession(session.id).data.page, 0, "a new genre starts on page one");

  const search = interaction(runtime, `${STATIONS_COMPONENT_PREFIX}search:${session.id}`);
  await handleRuntimePanelInteraction(runtime, search);
  assert.equal(search.calls[0][0], "modal");

  const submit = interaction(runtime, `${STATIONS_COMPONENT_PREFIX}searchform:${session.id}`, {
    isModalSubmit: () => true,
    fields: { getTextInputValue: () => "drone" },
  });
  await handleRuntimePanelInteraction(runtime, submit);
  assert.match(texts(tree(submit.calls[0][1])).join("\n"), /Drone Zone/);

  const close = interaction(runtime, `${STATIONS_COMPONENT_PREFIX}close:${session.id}`);
  await handleRuntimePanelInteraction(runtime, close);
  assert.equal(close.calls[0][1].flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2, "closing a V2 message stays V2");
  assert.equal(runtime.getInteractiveUiSession(session.id), null);
});

test("play without a voice channel opens the quick start as its own message", async () => {
  const runtime = createRuntime();
  const session = runtime.createInteractiveUiSession("stations", { guildId: "guild-browser", userId: "user-1", data: {} });
  const click = interaction(runtime, `${STATIONS_COMPONENT_PREFIX}pick:${session.id}:groovesalad`, {
    guild: { channels: { cache: new Map() }, members: { me: null } },
  });
  await handleRuntimePanelInteraction(runtime, click);
  const [kind, payload] = click.calls[0];
  assert.equal(kind, "reply", "a new message, the browser stays");
  assert.equal(payload.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
});

test("an expired browser answers in Components V2 on a V2 message", async () => {
  const runtime = createRuntime();
  const click = interaction(runtime, `${STATIONS_COMPONENT_PREFIX}page-next:gone`);
  await handleRuntimePanelInteraction(runtime, click);
  const [kind, payload] = click.calls[0];
  assert.equal(kind, "update");
  assert.equal(payload.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
  assert.match(texts(tree(payload)).join("\n"), /Sitzung abgelaufen/);
});
