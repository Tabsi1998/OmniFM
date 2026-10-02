import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The bot's panels in all nine languages (#477): they build (discord.js checks
// the length of every label), stay within Discord's limits and leave no
// {placeholder} unfilled.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-languages-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { BOT_LANGUAGES, botTranslator } = await import("../src/lib/bot-i18n.js");
const { buildHelpPayload, HELP_SECTIONS } = await import("../src/bot/help-panel.js");
const { buildWelcomePayload } = await import("../src/bot/setup-wizard.js");
const { buildPersonalDataPayload, buildErasePersonalDataConfirm } = await import("../src/bot/personal-data-panel.js");
const ui = await import("../src/discord/ui/index.js");

const urls = { dashboard: "https://omnifm.xyz/dashboard", guide: "https://omnifm.xyz/start", website: "https://omnifm.xyz", support: "https://discord.gg/x", premium: "https://omnifm.xyz/premium" };
const counts = { savedSongs: 3, votes: 2, dashboardLogins: 1, pollsStarted: 1, eventsCreated: 1, dashboardChanges: 4, stationSuggestions: 1, reports: 1, easterEggs: 2, linkedRoles: 1, supportRoles: 1, ownerConsoleLogins: 1 };

function payloads(language) {
  const t = botTranslator(language);
  return [
    ...HELP_SECTIONS.map((section) => [`help ${section}`, buildHelpPayload({ t, language, section, plan: { name: "Pro", bitrate: "128k", maxBots: 8 }, urls })]),
    ["welcome", buildWelcomePayload({ t, guildName: "Testserver", urls })],
    ["mydata", buildPersonalDataPayload({ t, counts, listening: { counting: true, hours: 12 } })],
    ["mydata erase", buildErasePersonalDataConfirm({ t, counts })],
  ];
}

test("the panels build in every language, within Discord's limits, every placeholder filled", () => {
  for (const language of BOT_LANGUAGES) {
    for (const [name, payload] of payloads(language)) {
      assert.deepEqual(ui.checkDiscordLimits(payload).problems, [], `${language} ${name}`);
      const text = JSON.stringify(payload.components.map((component) => (typeof component.toJSON === "function" ? component.toJSON() : component)));
      assert.doesNotMatch(text, /\{[a-z][A-Za-z]*\}/, `${language} ${name}: a placeholder without a value`);
    }
  }
});

test("a French server reads French in the panels", () => {
  const help = JSON.stringify(buildHelpPayload({ t: botTranslator("fr"), language: "fr", plan: { name: "Pro" }, urls }).components[0].toJSON());
  assert.match(help, /Vue d'ensemble/);
  assert.match(help, /Rejoins un salon vocal/);
  const mydata = JSON.stringify(buildPersonalDataPayload({ t: botTranslator("fr"), counts }).components[0].toJSON());
  assert.match(mydata, /Tes données chez OmniFM|Chansons enregistrées/);
});
