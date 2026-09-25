import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-panel-design-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const design = await import("../src/lib/panel-design.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const { buildPanelPreview, buildPanelPreviewInput } = await import("../src/bot/now-playing/panel-preview.js");
const { createDashboardPanelDesignRouteHandler } = await import("../src/api/routes/dashboard-panel-design.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const preview = await import("../frontend/src/lib/discordPreview.js");

const PRO_GUILD = "111111111111111111";
const FREE_GUILD = "222222222222222222";
setLicenseProvider((serverId) => (String(serverId) === PRO_GUILD ? { plan: "pro", active: true, seats: 1 } : null));

const MINIMAL = { accentColor: "#ff0000", showRecent: false, buttons: Object.fromEntries(design.PANEL_DESIGN_BUTTONS.map(({ key }) => [key, false])) };
const toJson = (payload) => payload.components.map((component) => component.toJSON());

test("the design: defaults, colours from the dashboard, the standard look without Premium", () => {
  assert.deepEqual(design.normalizePanelDesign(null), design.DEFAULT_PANEL_DESIGN);
  assert.equal(design.DEFAULT_PANEL_DESIGN.showRecent, true);
  assert.ok(Object.values(design.DEFAULT_PANEL_DESIGN.buttons).every(Boolean), "everything on by default");
  assert.equal(design.normalizePanelDesign({ accentColor: "#FF0000" }).accentColor, 0xff0000);
  assert.equal(design.normalizePanelDesign({ accentColor: "red" }).accentColor, null);
  assert.equal(design.isDefaultPanelDesign({ buttons: { share: true } }), true);
  assert.notEqual(design.panelDesignSignature(MINIMAL), design.panelDesignSignature({}));
  assert.equal(design.effectivePanelDesign(MINIMAL, "free").accentColor, null, "Free keeps the standard look");
  assert.equal(design.effectivePanelDesign(MINIMAL, "ultimate").accentColor, 0xff0000);
});

test("the panel follows the design; Pause and Stop stay, no empty row", () => {
  const full = buildPanelPreview({ design: {} });
  assert.deepEqual(preview.listButtons(full).filter((id) => id.startsWith("np:") || id.startsWith("omnifm")).length > 5, true);
  const minimal = buildPanelPreview({ design: MINIMAL });
  assert.deepEqual(preview.listButtons(minimal), ["np:toggle", "np:stop"]);
  const box = minimal.components[0];
  assert.equal(box.accent_color, 0xff0000);
  assert.ok(box.components.filter((node) => node.type === 1).every((row) => row.components.length > 0), "Discord refuses empty rows");
  assert.doesNotMatch(JSON.stringify(minimal), /Zuletzt/);
  assert.match(JSON.stringify(full), /Zuletzt/);
});

test("preview and real panel come from the same builder: the same JSON", async () => {
  const chosen = { ...MINIMAL, buttons: { ...MINIMAL.buttons, share: true, volume: true } };
  const sent = [];
  const handler = createDashboardPanelDesignRouteHandler({
    getDashboardRequestTranslator: () => ({ language: "de" }),
    getDashboardSession: () => ({ session: { user: { id: "42" } } }),
    getLocalizedJsonBodyError: () => "bad",
    languagePick: (language, de, en) => (language === "de" ? de : en),
    methodNotAllowed: () => sent.push({ status: 405 }),
    resolveDashboardGuildForSession: (_session, id) => ({ id }),
    sendJson: (_res, status, body) => sent.push({ status, body }),
    sendLocalizedError: (_res, status, _language, de) => sent.push({ status, body: { error: de } }),
    loadSettings: async () => ({}),
    saveSettings: async () => ({ ok: true }),
  });
  const call = (method, pathname, body) => handler({
    req: { method, headers: {} },
    res: {},
    requestUrl: new URL(`https://omnifm.xyz${pathname}?serverId=${PRO_GUILD}`),
    readJsonBody: async () => body,
    runtimes: [],
  });
  await call("POST", "/api/dashboard/panel-design/preview", { design: chosen });
  const expected = toJson(buildNowPlayingPanel(buildPanelPreviewInput({ design: design.normalizePanelDesign(chosen), language: "de", planTier: "pro" })));
  assert.deepEqual(sent.at(-1).body.preview.components, expected);

  // The bot's panel on a server with this design saved shows the same buttons.
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-np", name: "OmniFM 1" };
  runtime.client = { user: { id: "bot-np", displayAvatarURL: () => null }, guilds: { cache: new Map() } };
  runtime.guildState = new Map();
  runtime.guildSettingsCache = new Map([[PRO_GUILD, { loadedAt: Date.now(), value: { panelDesign: chosen } }]]);
  runtime.resolveGuildLanguage = () => "de";
  runtime.getApplicationId = () => null;
  runtime.role = "worker";
  const real = runtime.buildNowPlayingPanelPayload(
    PRO_GUILD,
    { name: "OmniFM Lounge", key: "lounge", genre: "Chillout" },
    { displayTitle: "Nightwave - Sunset Drive", artist: "Nightwave", title: "Sunset Drive" },
    { stationKey: "lounge", phase: "playing", listenerCount: 3, volume: 80 },
  );
  assert.deepEqual(preview.listButtons({ components: toJson(real) }).filter((id) => id.startsWith("np:")), preview.listButtons({ components: expected }).filter((id) => id.startsWith("np:")));
  assert.equal(toJson(real)[0].accent_color, 0xff0000);
});

test("saving needs Pro; the standard look is stored as nothing; trying works on Free", async () => {
  const saves = [];
  const sent = [];
  const handler = createDashboardPanelDesignRouteHandler({
    getDashboardRequestTranslator: () => ({ language: "en" }),
    getDashboardSession: () => ({ session: { user: { id: "42" } } }),
    getLocalizedJsonBodyError: () => "bad",
    languagePick: (language, de, en) => (language === "de" ? de : en),
    methodNotAllowed: () => sent.push({ status: 405 }),
    resolveDashboardGuildForSession: (_session, id) => ({ id }),
    sendJson: (_res, status, body) => sent.push({ status, body }),
    sendLocalizedError: (_res, status) => sent.push({ status }),
    loadSettings: async () => ({ panelDesign: MINIMAL }),
    saveSettings: async (guildId, updates, options = {}) => { saves.push({ guildId, updates, options }); return { ok: true }; },
  });
  const call = (guildId, method, pathname, body) => handler({
    req: { method, headers: {} },
    res: {},
    requestUrl: new URL(`https://omnifm.xyz${pathname}?serverId=${guildId}`),
    readJsonBody: async () => body,
    runtimes: [],
  });

  await call(FREE_GUILD, "PUT", "/api/dashboard/panel-design", { design: MINIMAL });
  assert.equal(sent.at(-1).status, 403);
  assert.equal(saves.length, 0);
  await call(FREE_GUILD, "POST", "/api/dashboard/panel-design/preview", { design: MINIMAL });
  assert.equal(sent.at(-1).status, 200, "Free sees the preview");
  await call(FREE_GUILD, "GET", "/api/dashboard/panel-design");
  assert.equal(sent.at(-1).body.canSave, false);
  assert.deepEqual(sent.at(-1).body.buttons.map((entry) => entry.label), design.PANEL_DESIGN_BUTTONS.map((entry) => entry.en));

  await call(PRO_GUILD, "PUT", "/api/dashboard/panel-design", { design: MINIMAL });
  assert.equal(sent.at(-1).status, 200);
  assert.equal(saves.at(-1).updates.panelDesign.accentColor, 0xff0000);
  await call(PRO_GUILD, "PUT", "/api/dashboard/panel-design", { design: {} });
  assert.deepEqual(saves.at(-1).options.unset, ["panelDesign"]);
  await call(PRO_GUILD, "DELETE", "/api/dashboard/panel-design");
  assert.equal(sent.at(-1).status, 405);
});

test("the dashboard draws Discord's text as parts, never as HTML", () => {
  const lines = preview.parseDiscordMarkdown("-# <a:omnifm_equalizer_v1:111111111111111111> LIVE · OmniFM\n## Sunset Drive\n> Hinweis **fett** [MusicBrainz](https://musicbrainz.org/x)\n<script>alert(1)</script>");
  assert.deepEqual(lines.map((line) => line.kind), ["subtext", "h2", "quote", "text"]);
  assert.deepEqual(lines[0].parts[0], { type: "emoji", name: "omnifm_equalizer_v1", id: "111111111111111111", animated: true });
  assert.deepEqual(lines[2].parts.filter((part) => part.type !== "text"), [
    { type: "bold", text: "fett" },
    { type: "link", text: "MusicBrainz", url: "https://musicbrainz.org/x" },
  ]);
  assert.deepEqual(lines[3].parts, [{ type: "text", text: "<script>alert(1)</script>" }]);
  assert.equal(preview.accentHex(0x10b981), "#10b981");
});
