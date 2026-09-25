import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-help-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { buildHelpPayload, HELP_SECTIONS, HELP_SECTION_SELECT_ID } = await import("../src/bot/help-panel.js");
const ui = await import("../src/discord/ui/index.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { INFO_COMMANDS } = await import("../src/bot/commands/info-commands.js");
const { INVITE_COMPONENT_ID_OPEN } = await import("../src/bot/runtime-links.js");

const de = (german) => german;
const en = (_german, english) => english;
const urls = { dashboard: "https://omnifm.xyz/dashboard", website: "https://omnifm.xyz", support: "https://discord.gg/x", premium: "https://omnifm.xyz/premium" };

function tree(payload) {
  return payload.components[0].toJSON();
}

function rowComponents(box) {
  return box.components.filter((component) => component.type === 1).flatMap((row) => row.components);
}

test("every help topic is a private panel with a topic menu and a button that does something", () => {
  for (const section of HELP_SECTIONS) {
    const payload = buildHelpPayload({ t: de, section, plan: { name: "Pro", bitrate: "128k", maxBots: 8 }, urls });
    assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, section);
    assert.deepEqual(ui.checkDiscordLimits(payload).problems, [], section);
    const components = rowComponents(tree(payload));
    const select = components.find((component) => component.type === 3);
    assert.equal(select.custom_id, HELP_SECTION_SELECT_ID);
    assert.equal(select.options.length, HELP_SECTIONS.length);
    assert.equal(select.options.find((option) => option.default)?.value, section);
    const actionButtons = components.filter((component) => component.type === 2 && component.label !== "Dashboard" && component.label !== "Website");
    assert.ok(actionButtons.some((component) => component.custom_id || component.url), `${section}: a button that starts something`);
  }
});

test("the overview shows the plan and the three steps, in English too", () => {
  const german = tree(buildHelpPayload({ t: de, plan: { name: "Pro", bitrate: "128k", maxBots: 8 }, urls, guildName: "Testserver" }));
  const text = JSON.stringify(german);
  assert.match(text, /OmniFM-Hilfe/);
  assert.match(text, /Plan: \*\*Pro\*\* · 128k Audio · 8 Worker/);
  assert.match(text, /Geh in einen Sprachkanal/);
  const english = JSON.stringify(tree(buildHelpPayload({ t: en, section: "troubleshooting", plan: {}, urls })));
  assert.match(english, /No sound\?/);
});

function createRuntime() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-help", name: "OmniFM DJ" };
  runtime.client = { user: { id: "bot-help" }, guilds: { cache: new Map() } };
  runtime.resolveInteractionLanguage = () => "de";
  runtime.createInteractionTranslator = () => ({ t: de, language: "de" });
  return runtime;
}

test("/help answers with the panel and keeps its flags", async () => {
  const runtime = createRuntime();
  const answers = [];
  runtime.respondInteraction = async (_interaction, payload) => { answers.push(payload); };
  await INFO_COMMANDS.help({ runtime, interaction: { guildId: null, commandName: "help" } });
  assert.equal(answers[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
});

test("the topic menu switches the page in the same message", async () => {
  const runtime = createRuntime();
  const updates = [];
  const handled = await runtime.handleHelpComponentInteraction({
    customId: HELP_SECTION_SELECT_ID,
    isStringSelectMenu: () => true,
    values: ["events"],
    guildId: null,
    async update(payload) { updates.push(payload); },
  });
  assert.equal(handled, true);
  assert.match(JSON.stringify(tree(updates[0])), /event create/);
});

test("the invite button on a Components V2 message opens the menu as its own message", async () => {
  const runtime = createRuntime();
  runtime.role = "commander";
  runtime.workerManager = {};
  runtime.buildInviteMenuPayload = async () => ({ content: "invite menu" });
  const calls = [];
  await runtime.handleInviteComponentInteraction({
    customId: INVITE_COMPONENT_ID_OPEN,
    guildId: "guild-1",
    message: { flags: { has: (flag) => flag === MessageFlags.IsComponentsV2 } },
    isRepliable: () => true,
    async deferReply(options) { calls.push(["deferReply", options]); },
    async deferUpdate() { calls.push(["deferUpdate"]); },
    async editReply(payload) { calls.push(["editReply", payload]); },
  });
  assert.deepEqual(calls.map(([name]) => name), ["deferReply", "editReply"]);
});
