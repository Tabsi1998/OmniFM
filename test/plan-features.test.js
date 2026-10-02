import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { botTranslator } from "../src/lib/bot-i18n.js";

// #413: one file says what Free, Pro and Ultimate can do; the bot, the API
// and the website read it, and every plan check names something it knows.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-plans-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const {
  COMMAND_PLANS, PLAN_CAPABILITIES, PLAN_FEATURES, PLAN_LIMITS, PLAN_ORDER, planCardLines, planRequirementText,
} = await import("../src/config/plan-features.js");
const { PLANS } = await import("../src/config/plans.js");
const { buildCommandsJson } = await import("../src/commands.js");
const { planSummaryLine, catalogPlanContext } = await import("../src/bot/plan-texts.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const ui = await import("../src/discord/ui/index.js");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const de = botTranslator("de");
const context = { freeStations: 20, allStations: 120 };

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("every plan check names a capability of the plan file; the old feature switches are gone", () => {
  const known = new Set(Object.keys(PLAN_CAPABILITIES));
  const unknown = [];
  let checks = 0;
  for (const file of sourceFiles(path.join(repoRoot, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:serverHasCapability|requireCapability|hasCapability)\([^()"]*,\s*"([a-z_]+)"\)/g)) {
      checks += 1;
      if (!known.has(match[1])) unknown.push(`${path.relative(repoRoot, file)}: ${match[1]}`);
    }
    assert.doesNotMatch(text, /\brequireFeature\(|\bserverHasFeature\(|\bcheckFeatureAccess\(/, path.relative(repoRoot, file));
  }
  assert.ok(checks >= 20, `found ${checks} plan checks`);
  assert.deepEqual(unknown, []);
  assert.equal(fs.existsSync(path.join(repoRoot, "src/commands/play-url.js")), false, "the dead /play url file is gone");
});

test("the capabilities: valid first plans, unique API names, and the plans built from them", () => {
  const apiKeys = Object.values(PLAN_CAPABILITIES).map((entry) => entry.apiKey);
  assert.equal(new Set(apiKeys).size, apiKeys.length);
  for (const [key, entry] of Object.entries(PLAN_CAPABILITIES)) {
    assert.ok(PLAN_ORDER.includes(entry.minPlan), key);
    assert.ok(entry.de && entry.en, key);
    for (const plan of PLAN_ORDER) {
      assert.equal(PLANS[plan].capabilities[key], PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(entry.minPlan), `${plan} ${key}`);
    }
  }
  assert.equal("license_workspace" in PLAN_CAPABILITIES, false);
  assert.equal(PLANS.pro.maxBots, PLAN_LIMITS.pro.maxBots);
  assert.equal(PLANS.ultimate.limits.customStations, 50);
  assert.equal(planRequirementText("role_permissions", "de"), "**Rollenrechte** gibt es ab OmniFM **Pro**.");
  assert.equal(planRequirementText("custom_station_urls", "en"), "**Your own stations** comes with OmniFM **Ultimate** and above.");
});

test("the plan of each slash command: Free unless named, and only commands that exist", () => {
  const names = new Set(buildCommandsJson().map((command) => command.name));
  for (const command of Object.keys(COMMAND_PLANS)) assert.ok(names.has(command), command);
  assert.equal(COMMAND_PLANS.now, undefined, "/now is Free");
  assert.equal(COMMAND_PLANS.history, undefined, "/history is Free (5 songs)");
  assert.equal(COMMAND_PLANS.event, undefined, "/event is Free (one event)");
  assert.equal(COMMAND_PLANS.perm, "pro");
  assert.equal(COMMAND_PLANS.addstation, "ultimate");
});

test("the plan cards: Free lists everything, Pro and Ultimate only what they add", () => {
  for (const feature of PLAN_FEATURES) {
    for (const plan of PLAN_ORDER) {
      assert.equal(feature.de(plan, context) === null, feature.en(plan, context) === null, `${feature.key} ${plan}: both languages or none`);
    }
  }
  const free = planCardLines("free", { language: "de", context });
  assert.equal(free.intro, null);
  assert.ok(free.lines.includes("20 Sender aus dem Katalog"));
  assert.ok(free.lines.includes("1 geplantes Radio-Event"));
  assert.ok(free.lines.includes("Now-Playing-Panel mit Knöpfen, auch mit /now"));
  assert.ok(!free.lines.some((line) => /Rollenrechte|eigene Sender|Live-Ansicht/i.test(line)));
  // #413 part 3: the dashboard's basics are Free, the rest of it Pro.
  assert.ok(free.lines.includes("Web-Dashboard: was läuft wo, Sender wechseln oder stoppen, Sprache"));

  const pro = planCardLines("pro", { language: "de", context });
  assert.equal(pro.intro, "Alles aus Free, dazu:");
  assert.ok(pro.lines.includes("Alle 120 Sender des Katalogs"));
  assert.ok(pro.lines.includes("Ausfall-Meldungen in einen Discord-Kanal"));
  assert.ok(pro.lines.includes("Geplante Radio-Events ohne Grenze"));
  assert.ok(pro.lines.includes("Web-Dashboard mit Live-Ansicht, Statistik und allen Einstellungen"));
  assert.ok(!pro.lines.includes("Voice Guard: der Bot bleibt in seinem Kanal"), "what Free has already is not repeated");

  const ultimate = planCardLines("ultimate", { language: "en", context });
  assert.equal(ultimate.intro, "Everything in Pro, plus:");
  assert.ok(ultimate.lines.includes("Up to 50 stations of your own with logo"));
  assert.ok(ultimate.lines.includes("10 favourite stations as buttons in the panel"));
  assert.ok(!ultimate.lines.some((line) => /stations$/i.test(line) && /All 120/.test(line)), "no second 'all stations' line: Ultimate has the same catalogue");
  // Honest: no Ultimate-only stations, and 320k is not sold as more than the station sends.
  const everything = PLAN_ORDER.flatMap((plan) => [...planCardLines(plan, { language: "de", context }).lines, ...planCardLines(plan, { language: "en", context }).lines]);
  assert.ok(!everything.some((line) => /Ultimate-Sender|Ultimate stations/i.test(line)));
  assert.ok(everything.includes("Audio bis 320k, so gut wie der Sender liefert"));

  assert.equal(planCardLines("pro", { language: "de" }).lines[0], "Alle Sender des Katalogs", "without numbers the line still reads");
});

test("/help and /premium say the same as the website", () => {
  assert.deepEqual(catalogPlanContext({ a: { tier: "free" }, b: { tier: "pro" }, c: {} }), { freeStations: 2, allStations: 3 });
  const line = planSummaryLine("pro", "de", context);
  assert.match(line, /^\*\*Pro:\*\* Alle 120 Sender des Katalogs · 8 Sprachkanäle gleichzeitig/);
  assert.doesNotMatch(line, /Panel selbst gestalten/, "only the highlights");
  assert.match(planSummaryLine("ultimate", "en", context), /^\*\*Ultimate:\*\* 16 voice channels at once .*Up to 50 stations of your own/);
});

test("/now answers on Free, and the panel carries ten favourites in two rows", async () => {
  setLicenseProvider(() => null);
  const { INFO_COMMANDS } = await import("../src/bot/commands/info-commands.js");
  const replies = [];
  const interaction = { guildId: "123456789012345678", reply: async (payload) => replies.push(payload) };
  const runtime = {
    resolveStreamingRuntimeForInteraction: async () => ({ runtime: {}, state: {} }),
    getResolvedCurrentStation: () => null,
  };
  await INFO_COMMANDS.now({ runtime, interaction, t: de, language: "de" });
  const text = JSON.stringify(replies[0]);
  assert.doesNotMatch(text, /ist Pro/);
  assert.match(text, /Station nicht mehr verfügbar/, "it went on to look for the station");

  const favorites = Array.from({ length: 10 }, (_, index) => ({ key: `station-${index}`, name: `Sender ${index}`, color: "#14B8A6" }));
  const payload = buildNowPlayingPanel({
    t: de,
    station: { name: "Sender 0", key: "station-0" },
    track: { hasTrack: true, title: "Song", artist: "Band", displayTitle: "Band - Song" },
    playback: { phase: "playing" },
    favorites,
    failover: { active: true, desiredName: "Wunschsender", currentName: "Sender 0" },
    searchQuery: "Band Song",
  });
  const rows = [];
  const walk = (node) => {
    const json = typeof node?.toJSON === "function" ? node.toJSON() : node;
    if (!json || typeof json !== "object") return;
    if (json.type === 1) rows.push((json.components || []).map((component) => component.custom_id || component.url));
    for (const child of json.components || []) walk(child);
  };
  for (const component of payload.components) walk(component);
  const favoriteRows = rows.filter((row) => row.some((id) => String(id).startsWith("np:fav:")));
  assert.deepEqual(favoriteRows.map((row) => row.length), [5, 5]);
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, [], "within Discord's limits with every button");
});
