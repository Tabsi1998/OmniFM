import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle, MessageFlags } from "discord.js";

import * as ui from "../src/discord/ui/index.js";
import { PLAYBACK_COMMANDS } from "../src/bot/commands/playback-commands.js";

function json(payload) {
  return payload.components.map((component) => component.toJSON());
}

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === 10) out.push(node.content);
  for (const child of node.components || []) texts(child, out);
  if (node.accessory) texts(node.accessory, out);
  return out;
}

test("a panel is one container with accent, heading, body, actions and the brand line", () => {
  const payload = ui.reply(ui.panel({
    accent: 0x123456,
    title: "Bot-Status",
    subtitle: ui.statusLine(["OmniFM 1", "", null, "Mein Server"]),
    body: [ui.text(ui.field("Status", "läuft"))],
    footer: "/status",
  }));
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const [box] = json(payload);
  assert.equal(box.type, 17);
  assert.equal(box.accent_color, 0x123456);
  const lines = texts(box);
  assert.equal(lines[0], "## Bot-Status\nOmniFM 1 · Mein Server");
  assert.equal(lines[1], "**Status**\nläuft");
  assert.match(lines.at(-1), /^-# OmniFM( · v\d+\.\d+\.\d+)?.* · \/status$/);
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

test("a message for a channel is not ephemeral", () => {
  assert.equal(ui.message(ui.panel({ title: "x" })).flags, MessageFlags.IsComponentsV2);
});

test("notices take the colour and icon of their kind; an unknown kind is info", () => {
  const error = json(ui.reply(ui.notice("error", { title: "Rechte fehlen", body: "Verbinden fehlt." })))[0];
  assert.equal(error.accent_color, ui.UI_COLORS.error);
  assert.match(texts(error)[0], /^## ⛔ Rechte fehlen/);
  assert.equal(json(ui.reply(ui.notice("nonsense", { title: "x" })))[0].accent_color, ui.UI_COLORS.info);
});

test("a list pages its items and disables the buttons at both ends", () => {
  const items = Array.from({ length: 25 }, (_, index) => `Sender ${index + 1}`);
  const first = ui.list({ title: "Sender", items, page: 0, customId: (page) => `stations:${page}` });
  assert.equal(first.pages, 3);
  const firstRow = first.container.toJSON().components.find((component) => component.type === 1);
  assert.deepEqual(firstRow.components.map((button) => button.disabled === true), [true, true, false]);
  assert.equal(firstRow.components[1].label, "1 / 3");

  const beyond = ui.list({ title: "Sender", items, page: 99, customId: (page) => `stations:${page}` });
  assert.equal(beyond.page, 2, "a page past the end shows the last page");
  const lastRow = beyond.container.toJSON().components.find((component) => component.type === 1);
  assert.deepEqual(lastRow.components.map((button) => button.disabled === true), [false, true, true]);
  assert.match(texts(beyond.container.toJSON()).join("\n"), /- Sender 25/);
});

test("a dangerous confirmation uses the danger button and error colour", () => {
  const box = ui.confirm({ title: "Alles löschen?", confirmId: "yes", cancelId: "no", danger: true }).toJSON();
  assert.equal(box.accent_color, ui.UI_COLORS.error);
  const row = box.components.find((component) => component.type === 1);
  assert.equal(row.components[0].style, ButtonStyle.Danger);
  assert.equal(row.components[1].custom_id, "no");
});

test("the limit check counts every nested component and the shared text budget", () => {
  const crowded = ui.reply(ui.container({ blocks: Array.from({ length: 45 }, (_, index) => `Zeile ${index}`) }));
  assert.match(ui.checkDiscordLimits(crowded).problems[0], /46 components/);

  const long = ui.reply(ui.container({ blocks: [ui.text("a".repeat(2500)), ui.text("b".repeat(2500))] }));
  assert.match(ui.checkDiscordLimits(long).problems[0], /5000 characters/);

  const clipped = ui.text("x".repeat(5000)).toJSON().content;
  assert.equal(clipped.length, 4000);
  assert.ok(clipped.endsWith("…"));
});

test("icons use the app emojis of the application that sends, otherwise Unicode", (t) => {
  t.after(() => ui.clearAppEmojis());
  assert.equal(ui.icon("play"), "▶️");
  ui.registerAppEmojis("111", [
    { logicalName: "play", id: "9001", name: "omnifm_play" },
    { logicalName: "equalizer", id: "9002", name: "omnifm_eq", animated: true },
  ]);
  assert.equal(ui.icon("play", "111"), "<:omnifm_play:9001>");
  assert.equal(ui.icon("equalizer", "111"), "<a:omnifm_eq:9002>");
  assert.equal(ui.icon("play", "222"), "▶️", "another worker has its own emojis");
  assert.deepEqual(ui.componentEmoji("play", "111"), { id: "9001", name: "omnifm_play", animated: false });
  assert.deepEqual(ui.componentEmoji("pause", "111"), { name: "⏸️" });
  assert.equal(ui.icon("unknown"), "");
});

test("a Components V2 message is recognised from a flags bitfield or number", () => {
  assert.equal(ui.isComponentsV2Message({ flags: { has: (flag) => flag === MessageFlags.IsComponentsV2 } }), true);
  assert.equal(ui.isComponentsV2Message({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }), true);
  assert.equal(ui.isComponentsV2Message({ flags: MessageFlags.Ephemeral }), false);
  assert.equal(ui.isComponentsV2Message(null), false);
});

test("/status answers with the design system: private, within Discord's limits, with its actions", async () => {
  const replies = [];
  const state = {
    connection: { joinConfig: { channelId: "123456789012345678" }, state: { status: "ready" } },
    player: { state: { status: "playing" } },
    currentStationName: "Groove Salad",
    shouldReconnect: true,
  };
  const runtime = {
    role: "commander",
    workerManager: {},
    async resolveStreamingRuntimeForInteraction() {
      return {
        state,
        runtime: { config: { name: "OmniFM 1" }, client: { isReady: () => true }, getCurrentListenerCount: () => 4 },
      };
    },
  };
  const interaction = {
    guildId: "999",
    guild: { name: "Testserver" },
    async reply(payload) { replies.push(payload); },
  };
  await PLAYBACK_COMMANDS.status({ runtime, interaction, t: (de) => de, language: "de" });

  assert.equal(replies.length, 1);
  const [payload] = replies;
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.equal(payload.embeds, undefined, "no embeds on a Components V2 message");
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
  const [box] = json(payload);
  const allText = texts(box).join("\n");
  assert.match(allText, /## Bot-Status\nOmniFM 1 · Testserver/);
  assert.match(allText, /Groove Salad/);
  const buttons = box.components.filter((component) => component.type === 1).flatMap((row) => row.components);
  assert.ok(buttons.some((button) => button.custom_id && /work/i.test(button.custom_id)), "the worker button is there");
});
