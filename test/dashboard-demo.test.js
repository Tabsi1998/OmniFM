import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The dashboard preview (#432) answers from example data in the page. They
// must look like the server's answers, or the preview shows something the
// real dashboard never would: each plan's rights and numbers, the stations,
// the settings, the events and the panel designer's preview.
process.env.OMNIFM_RUNTIME_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-dashboard-demo-"));

const demo = await import("../frontend/src/lib/dashboardDemo.js");
const { applyPanelDesign } = await import("../frontend/src/lib/panelDesignDemo.js");
const { PLAN_ORDER } = await import("../src/config/plan-features.js");
const { getPlanCapabilities, getPlanLimits } = await import("../src/core/entitlements.js");
const settingsRoute = await import("../src/api/routes/dashboard-settings.js");
const { normalizeWeeklyDigestConfig, buildWeeklyDigestMeta } = await import("../src/lib/weekly-digest.js");
const { buildResolvedVoiceGuardConfig } = await import("../src/lib/voice-guard.js");
const { buildDashboardIncidentAlertsResponse, buildDashboardExportsWebhookResponse } = await import("../src/api/helpers/license.js");
const { buildDashboardFailoverChainPreview, buildDashboardFallbackStationPreview, resolveDashboardFailoverChain } = await import("../src/api/helpers/stations.js");
const { getPrimaryFailoverStation } = await import("../src/lib/failover-chain.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { buildDashboardEventResponse } = await import("../src/api/helpers/events.js");
const { getRepeatLabel } = await import("../src/lib/event-time.js");
const { buildDemoPanel } = await import("../src/bot/demo-messages.js");

const catalogue = JSON.parse(fs.readFileSync(new URL("../stations.json", import.meta.url), "utf8")).stations;
const byId = Object.fromEntries(demo.DEMO_GUILDS.map((guild) => [guild.id, guild]));
setLicenseProvider((id) => (byId[id] ? { active: true, plan: byId[id].plan, seats: 1 } : null));

const answer = (request, route, options) => request(route, options);

test("each plan's rights and numbers are the plan file's, like the server builds them", async () => {
  for (const plan of PLAN_ORDER) assert.deepEqual(demo.demoCapabilities(plan), getPlanCapabilities(plan, { apiShape: true }), plan);
  const request = demo.createDemoApi({ language: () => "en" });
  const session = await answer(request, "/api/auth/session");
  assert.deepEqual(session.guilds.map((guild) => guild.tier), ["ultimate", "pro", "free"]);
  for (const guild of session.guilds) {
    const { seats, ...limits } = guild.limits;
    assert.deepEqual(limits, getPlanLimits(guild.tier), guild.name);
    assert.equal(typeof seats, "number");
    assert.equal(guild.dashboardEnabled, guild.tier !== "free");
  }
});

test("the stations are real ones of the catalogue, with the catalogue's name, genre and plan", () => {
  for (const [plan, rows] of Object.entries(demo.DEMO_STATIONS)) {
    for (const [key, name, genre] of rows) {
      assert.ok(catalogue[key], `${key} is in stations.json`);
      assert.equal(catalogue[key].name, name, key);
      assert.equal(catalogue[key].genre, genre, key);
      assert.equal(catalogue[key].tier || "free", plan, key);
    }
  }
});

test("the settings are what the server answers for the same stored settings", async () => {
  const now = Date.now();
  for (const guild of demo.DEMO_GUILDS) {
    const settings = demo.demoStoredSettings(guild.id);
    const weeklyDigest = { ...normalizeWeeklyDigestConfig(settings.weeklyDigest || {}, "de"), language: "de" };
    const failoverChain = resolveDashboardFailoverChain(settings);
    const fallbackStation = getPrimaryFailoverStation(failoverChain, settings.fallbackStation || "");
    const server = {
      weeklyDigest,
      weeklyDigestMeta: buildWeeklyDigestMeta(weeklyDigest, { lastSentAt: null }),
      failoverChain,
      failoverChainPreview: buildDashboardFailoverChainPreview(guild.id, failoverChain, fallbackStation),
      fallbackStation,
      fallbackStationPreview: buildDashboardFallbackStationPreview(guild.id, fallbackStation),
      incidentAlerts: buildDashboardIncidentAlertsResponse(settings.incidentAlerts || {}),
      exportsWebhook: buildDashboardExportsWebhookResponse(settings.exportsWebhook || {}),
      voiceGuard: buildResolvedVoiceGuardConfig(settings.voiceGuard || {}, { featureEnabled: demo.demoCapabilities(guild.plan).voiceGuard }),
      voiceStatus: settingsRoute.buildDashboardVoiceStatusResponse(settings),
      favorites: settingsRoute.buildDashboardFavoritesResponse(settings, guild.plan),
      serverLanguage: settingsRoute.buildDashboardLanguageResponse(guild.id),
      serverTimeZone: settingsRoute.buildDashboardTimeZoneResponse(settings),
      seasonDecor: { ...settingsRoute.buildDashboardSeasonDecorResponse(guild.id, settings, { owner: {} }), current: null },
    };
    const shown = demo.demoSettingsAnswer(guild.id, { language: "de", now });
    for (const [key, value] of Object.entries(server)) {
      // The preview shows a recap that went out last week; the stored example has none.
      const expected = key === "weeklyDigestMeta" ? { ...value, lastSentAt: shown.weeklyDigestMeta.lastSentAt } : value;
      assert.deepEqual(shown[key], expected, `${guild.name}: ${key}`);
    }
  }
});

test("the events look like the server's, with its local time and its repeat labels", async () => {
  const request = demo.createDemoApi({ language: () => "de" });
  const answers = await Promise.all(demo.DEMO_GUILDS.map((guild) => answer(request, `/api/dashboard/events?serverId=${guild.id}`)));
  for (const [index, { events }] of answers.entries()) {
    assert.ok(events.length >= 1, demo.DEMO_GUILDS[index].name);
    for (const event of events) {
      const server = buildDashboardEventResponse({
        id: event.id, name: event.title, stationKey: event.stationKey, runAtMs: event.runAtMs, timeZone: event.timezone,
        voiceChannelId: event.channelId, textChannelId: event.textChannelId, enabled: event.enabled, repeat: event.repeat,
        durationMs: event.durationMs, announceMessage: event.announceMessage, createDiscordEvent: event.createDiscordEvent,
        discordScheduledEventId: event.discordScheduledEventId, createdByUserId: event.createdByUserId, createdAt: event.createdAt,
      });
      for (const key of Object.keys(server)) assert.ok(key in event, `${event.id}: ${key}`);
      assert.equal(event.startsAtLocal, server.startsAtLocal, event.id);
      assert.equal(event.repeatLabelDe, getRepeatLabel(event.repeat, "de", { runAtMs: event.runAtMs, timeZone: event.timezone }), event.id);
      assert.equal(event.repeatLabelEn, getRepeatLabel(event.repeat, "en", { runAtMs: event.runAtMs, timeZone: event.timezone }), event.id);
      assert.ok(event.runAtMs > Date.now(), `${event.id} lies ahead`);
    }
  }
  // Free has one event, like its plan.
  assert.equal((await answer(request, "/api/dashboard/events?serverId=900000000000000103")).events.length, 1);
});

test("the panel designer's preview leaves out what the bot leaves out", () => {
  const off = (key) => ({ buttons: { [key]: false } });
  const designs = [
    {}, off("volume"), off("stations"), off("favorites"), off("save"), off("links"), off("share"), off("report"),
    { showRecent: false }, { accentColor: 0x22c55e },
    { showRecent: false, accentColor: 0xff6b00, buttons: { volume: false, favorites: false, links: false, report: false } },
    { buttons: { volume: false, stations: false, favorites: false, save: false, links: false, share: false, report: false } },
  ];
  for (const language of ["de", "en"]) {
    const standard = buildDemoPanel(language);
    for (const design of designs) {
      assert.deepEqual(applyPanelDesign(standard, design), buildDemoPanel(language, design), `${language} ${JSON.stringify(design)}`);
    }
  }
});

test("the preview keeps nothing: every change gets a plain answer, and nothing is asked of the server", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => { asked.push(String(url)); throw new Error("the preview must not ask the server"); });
  const panels = { de: buildDemoPanel("de"), en: buildDemoPanel("en") };
  const request = demo.createDemoApi({ language: () => "de", panels });
  const guild = "900000000000000101";
  await Promise.all([
    [`/api/dashboard/perms?serverId=${guild}`, "PUT"],
    [`/api/dashboard/custom-stations?serverId=${guild}`, "POST"],
    [`/api/dashboard/events?serverId=${guild}`, "POST"],
    [`/api/dashboard/events/demo-lofi-night?serverId=${guild}`, "DELETE"],
    [`/api/dashboard/settings?serverId=${guild}`, "PUT"],
    [`/api/dashboard/panel-design?serverId=${guild}`, "PUT"],
    ["/api/dashboard/playback/stop", "POST"],
  ].map(([route, method]) => assert.rejects(answer(request, route, { method, body: "{}" }), (error) => error.demo === true && /nichts gespeichert/.test(error.message), `${method} ${route}`)));
  await assert.rejects(answer(request, `/api/dashboard/exports/stats?serverId=${guild}`), /gibt es in der Vorschau nicht/);
  // Previews show something and keep nothing.
  const { preview } = await answer(request, `/api/dashboard/panel-design/preview?serverId=${guild}`, { method: "POST", body: JSON.stringify({ design: { showRecent: false } }) });
  assert.deepEqual(preview, buildDemoPanel("de", { showRecent: false }));
  await Promise.all(["/api/auth/session", `/api/dashboard/license?serverId=${guild}`, `/api/dashboard/stats/detail?serverId=${guild}`, `/api/dashboard/playback?serverId=${guild}`].map((route) => answer(request, route)));
  assert.deepEqual(asked, []);
});
