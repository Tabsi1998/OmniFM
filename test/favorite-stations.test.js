import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ButtonStyle, MessageFlags, PermissionFlagsBits } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-favorites-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const favorites = await import("../src/lib/favorite-stations.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const { buildStationBrowserPayload, buildBrowserEntries } = await import("../src/bot/station-browser.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { handleRuntimePanelInteraction } = await import("../src/bot/runtime-panels.js");
const { STATIONS_COMPONENT_PREFIX } = await import("../src/bot/runtime-links.js");
const { normalizeGuildSettings } = await import("../src/lib/guild-settings.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const ui = await import("../src/discord/ui/index.js");

const de = (german) => german;
const catalog = JSON.parse(fs.readFileSync(new URL("../stations.json", import.meta.url), "utf8")).stations;
const FREE_KEYS = Object.entries(catalog).filter(([, station]) => (station.tier || "free") === "free").map(([key]) => key);

function nodes(node, type, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === type) out.push(json);
  for (const child of json.components || []) nodes(child, type, out);
  if (json.accessory) nodes(json.accessory, type, out);
  return out;
}
function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  if (json.accessory) texts(json.accessory, out);
  return out;
}
const allText = (payload) => payload.components.flatMap((component) => texts(component)).join("\n");

test("the plan decides how many favourites show: Free 3, Pro and Ultimate 5", () => {
  assert.equal(favorites.favoriteLimitForTier("free"), 3);
  assert.equal(favorites.favoriteLimitForTier("pro"), 5);
  assert.equal(favorites.favoriteLimitForTier("ultimate"), 5);
  assert.deepEqual(favorites.normalizeFavoriteStations([" a ", "a", "", "b", "c", "d", "e", "f"]), ["a", "b", "c", "d", "e"]);
});

test("a downgrade hides the extra favourites but keeps them", () => {
  const stored = ["a", "b", "c", "d", "e"];
  assert.deepEqual(favorites.visibleFavoriteKeys(stored, "free"), ["a", "b", "c"]);
  assert.deepEqual(favorites.visibleFavoriteKeys(stored, "pro"), stored, "back with the plan");
  assert.deepEqual(favorites.visibleFavoriteKeys(stored, "pro", (key) => key !== "b"), ["a", "c", "d", "e"], "stations no longer on the plan drop out");
  // Saving the same five on Free keeps them all; nothing is deleted.
  assert.deepEqual(favorites.applyFavoriteChange(stored, stored, "free"), { ok: true, list: stored, refused: [] });
  assert.deepEqual(favorites.applyFavoriteChange(stored, ["b", "a", "c", "d", "e"], "free").list, ["b", "a", "c", "d", "e"], "reordering is fine");
});

test("new favourites only fit below the plan's limit", () => {
  assert.deepEqual(favorites.applyFavoriteChange(["a", "b", "c"], ["a", "b", "c", "n"], "free"), { ok: false, list: ["a", "b", "c"], refused: ["n"] });
  assert.deepEqual(favorites.applyFavoriteChange(["a", "b"], ["a", "b", "n"], "free"), { ok: true, list: ["a", "b", "n"], refused: [] });
  assert.equal(favorites.applyFavoriteChange(["a", "b", "c"], ["a", "b", "c", "n", "m"], "pro").ok, true);
  assert.deepEqual(favorites.applyFavoriteChange([], ["a", "b", "c", "d", "e", "f"], "ultimate").refused, ["f"], "never more than five");
  // The star menu: the page's selection replaces the page's part only.
  assert.deepEqual(favorites.applyFavoritePageSelection(["a", "x"], { pageKeys: ["a", "b", "c"], selectedKeys: ["b"] }, "free").list, ["x", "b"]);
  assert.deepEqual(normalizeGuildSettings({ favoriteStations: ["a", "a", "b"] }).favoriteStations, ["a", "b"]);
  assert.equal("favoriteStations" in normalizeGuildSettings({ favoriteStations: [] }), false);
});

test("the panel shows the favourites as a row; the one on air is marked", () => {
  const payload = buildNowPlayingPanel({
    t: de,
    station: { name: "Groove Salad", key: "groovesalad" },
    track: { hasTrack: false },
    playback: { phase: "playing" },
    favorites: [
      { key: "groovesalad", name: "Groove Salad", color: "#14B8A6" },
      { key: "dronezone", name: "Drone Zone", color: "#7C3AED" },
      { key: "custom:vereinsradio", name: "Vereinsradio", color: null },
    ],
  });
  const buttons = nodes(payload.components[0], 2).filter((button) => String(button.custom_id || "").startsWith("np:fav:"));
  assert.deepEqual(buttons.map((button) => button.custom_id), ["np:fav:groovesalad", "np:fav:dronezone", "np:fav:custom:vereinsradio"]);
  assert.equal(buttons[0].style, ButtonStyle.Success);
  assert.equal(buttons[0].disabled, true, "the station on air cannot be picked again");
  assert.equal(buttons[1].emoji.name, "🟪");
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

function browserPayload(extra = {}) {
  return buildStationBrowserPayload({
    t: de,
    prefix: STATIONS_COMPONENT_PREFIX,
    session: { id: "s1", data: {} },
    entries: buildBrowserEntries({ stations: catalog, guildTier: "free" }),
    planName: "Free",
    premiumUrl: "https://omnifm.xyz/premium",
    ...extra,
  });
}

test("the star menu of the browser: only for server managers, with the favourites ticked", () => {
  assert.equal(nodes(browserPayload().components[0], 3).length, 1, "only the genre menu without the right");
  const payload = browserPayload({ canEditFavorites: true, favorites: [FREE_KEYS[0]], favoriteLimit: 3 });
  const star = nodes(payload.components[0], 3).find((select) => select.custom_id === `${STATIONS_COMPONENT_PREFIX}fav:s1`);
  assert.ok(star);
  assert.equal(star.min_values, 0);
  assert.equal(star.max_values, star.options.length);
  assert.match(star.placeholder, /höchstens 3/);
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

function createCommander() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-browser", name: "OmniFM DJ" };
  runtime.client = { user: { id: "bot-browser" }, guilds: { cache: new Map() } };
  runtime.guildState = new Map();
  runtime.guildSettingsCache = new Map();
  runtime.interactiveUiSessions = new Map();
  runtime.resolveGuildLanguage = () => "de";
  runtime.resolveInteractionLanguage = () => "de";
  runtime.createInteractionTranslator = () => ({ t: de, language: "de" });
  return runtime;
}

function starMenu(runtime, sessionId, values, { manager = true, options = values } = {}) {
  const calls = [];
  return {
    calls,
    guildId: "123456789012345678",
    user: { id: "user-1" },
    customId: `${STATIONS_COMPONENT_PREFIX}fav:${sessionId}`,
    values,
    component: { options: options.map((value) => ({ value })) },
    memberPermissions: { has: (bit) => manager && bit === PermissionFlagsBits.ManageGuild },
    message: { flags: { has: (flag) => flag === MessageFlags.IsComponentsV2 } },
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    async update(payload) { calls.push(["update", payload]); },
    async reply(payload) { calls.push(["reply", payload]); },
  };
}

test("ticking favourites in the browser saves them; above the limit it says why", async (t) => {
  setLicenseProvider(() => null); // Free
  t.after(() => setLicenseProvider(() => null));
  const runtime = createCommander();
  const saves = [];
  runtime.saveFavoriteStations = async (guildId, list) => { saves.push(list); return { ok: true, list }; };
  const page = FREE_KEYS.slice(0, 5);
  const session = runtime.createInteractiveUiSession("stations", {
    guildId: "123456789012345678", userId: "user-1", data: { favorites: [], canEditFavorites: true },
  });

  const pick = starMenu(runtime, session.id, page.slice(0, 2), { options: page });
  await handleRuntimePanelInteraction(runtime, pick);
  assert.deepEqual(saves.at(-1), page.slice(0, 2));
  assert.match(allText(pick.calls[0][1]), /Gespeichert: 2 Favoriten/);

  const tooMany = starMenu(runtime, session.id, page.slice(0, 4), { options: page });
  await handleRuntimePanelInteraction(runtime, tooMany);
  assert.deepEqual(saves.at(-1), page.slice(0, 3), "the fourth does not fit on Free");
  assert.match(allText(tooMany.calls[0][1]), /Mehr als 3 Favoriten gehen mit deinem Plan nicht/);

  const stranger = starMenu(runtime, session.id, page.slice(0, 1), { manager: false, options: page });
  await handleRuntimePanelInteraction(runtime, stranger);
  assert.equal(stranger.calls[0][0], "reply");
  assert.match(allText(stranger.calls[0][1]), /Server verwalten/);
});

test("a favourite button: the worker switches right there, under the /play rule", async () => {
  const worker = Object.create(BotRuntime.prototype);
  worker.config = { name: "OmniFM 1" };
  worker.guildState = new Map([["123456789012345678", { currentStationKey: "groovesalad", connection: { joinConfig: { channelId: "223456789012345678" } } }]]);
  worker.resolveInteractionLanguage = () => "de";
  const plays = [];
  worker.playInGuild = async (...args) => { plays.push(args); return { ok: true }; };
  const calls = [];
  const click = (key) => ({
    guildId: "123456789012345678",
    customId: `np:fav:${key}`,
    deferred: false,
    replied: false,
    async deferReply() { this.deferred = true; calls.push(["deferReply"]); },
    async editReply(payload) { calls.push(["editReply", payload]); },
    async reply(payload) { calls.push(["reply", payload]); },
  });

  worker.checkCommandRolePermission = () => ({ ok: false, message: "Nur DJs dürfen Sender wechseln." });
  await worker.handleNowPlayingControl(click(FREE_KEYS[1]));
  assert.equal(calls[0][0], "reply");
  assert.equal(plays.length, 0);

  worker.checkCommandRolePermission = () => ({ ok: true });
  await worker.handleNowPlayingControl(click(FREE_KEYS[1]));
  assert.deepEqual(plays[0].slice(0, 3), ["123456789012345678", "223456789012345678", FREE_KEYS[1]]);
  assert.match(allText(calls.at(-1)[1]), /Sender gewechselt/);

  await worker.handleNowPlayingControl(click("does-not-exist"));
  assert.match(allText(calls.at(-1)[1]), /Sender nicht gefunden/);
  assert.equal(plays.length, 1);
});
