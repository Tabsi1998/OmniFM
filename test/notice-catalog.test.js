import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ButtonStyle, MessageFlags } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-notices-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { NOTICE_CATALOG, NOTICE_CODES } = await import("../src/discord/ui/notice-catalog.js");
const { buildNoticePayload } = await import("../src/bot/commands/command-helpers.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const ui = await import("../src/discord/ui/index.js");
const { PLAY_COMPONENT_ID_OPEN, STATIONS_COMPONENT_ID_OPEN } = await import("../src/bot/runtime-links.js");

const de = (german) => german;
const en = (_german, english) => english;

function tree(payload) {
  return payload.components[0].toJSON();
}

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === 10) out.push(node.content);
  for (const child of node.components || []) texts(child, out);
  return out;
}

function buttons(box) {
  return box.components.filter((component) => component.type === 1).flatMap((row) => row.components);
}

test("every catalogued problem has a German and an English text", () => {
  assert.ok(NOTICE_CODES.length >= 10);
  for (const code of NOTICE_CODES) {
    const entry = NOTICE_CATALOG[code];
    assert.ok(ui.NOTICE_KINDS[entry.kind], `${code}: a known kind`);
    const [titleDe, titleEn] = entry.title;
    const [bodyDe, bodyEn] = entry.body({ missing: ["Verbinden"], station: "Groove Salad", tier: "Pro", command: "/perm", detail: "x" });
    for (const [label, value] of [["title de", titleDe], ["title en", titleEn], ["body de", bodyDe], ["body en", bodyEn]]) {
      assert.ok(String(value || "").trim(), `${code}: ${label}`);
    }
    assert.notEqual(bodyDe, bodyEn, `${code}: really translated`);
  }
});

test("a catalogued notice brings its fix button", () => {
  const cases = [
    ["not-in-voice", (button) => button.custom_id === PLAY_COMPONENT_ID_OPEN],
    ["station-offline", (button) => button.custom_id === STATIONS_COMPONENT_ID_OPEN],
    ["premium-required", (button) => button.style === ButtonStyle.Link && /upgrade|premium|omnifm/i.test(button.url)],
    ["missing-permissions", (button) => button.style === ButtonStyle.Link && /\/faq/.test(button.url)],
  ];
  for (const [code, isFix] of cases) {
    const box = tree(buildNoticePayload({ t: de, language: "de", code, params: { missing: ["Verbinden", "Sprechen"] } }));
    assert.ok(buttons(box).some(isFix), `${code}: fix button`);
  }
  const permissions = texts(tree(buildNoticePayload({ t: de, language: "de", code: "missing-permissions", params: { missing: ["Verbinden", "Sprechen"], channel: "#radio" } }))).join("\n");
  assert.match(permissions, /In #radio fehlt mir: \*\*Verbinden, Sprechen\*\*/);
  assert.match(texts(tree(buildNoticePayload({ t: en, language: "en", code: "guild-only" })))[0], /Servers only/);
});

test("one-off notices keep working: tone colour, title, text, fields and action rows", () => {
  const payload = buildNoticePayload({
    t: de,
    language: "de",
    tone: "danger",
    title: "✖ Pause fehlgeschlagen",
    description: "Kein Worker hat reagiert.",
    fields: [{ name: "Fehler", value: "Worker 2: timeout" }],
    quickActions: { includePlay: true, includeStations: true },
  });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const box = tree(payload);
  assert.equal(box.accent_color, ui.UI_COLORS.error);
  const all = texts(box).join("\n");
  assert.match(all, /## ✖ Pause fehlgeschlagen/);
  assert.match(all, /Kein Worker hat reagiert/);
  assert.match(all, /\*\*Fehler\*\*\nWorker 2: timeout/);
  assert.ok(buttons(box).some((button) => button.custom_id === PLAY_COMPONENT_ID_OPEN));
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

function runtimeWithAnswer() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.createInteractionTranslator = () => ({ t: de, language: "de" });
  return runtime;
}

test("a notice after a plain progress message replaces it instead of failing", async () => {
  const calls = [];
  const interaction = {
    deferred: false,
    replied: true,
    async editReply() { calls.push("edit"); throw new Error("Cannot convert to Components V2"); },
    async deleteReply() { calls.push("delete"); },
    async followUp(payload) { calls.push(["followUp", payload]); return { id: "new" }; },
  };
  const notice = buildNoticePayload({ t: de, language: "de", code: "failed" });
  await runtimeWithAnswer().respondInteraction(interaction, notice);
  assert.deepEqual(calls.slice(0, 2), ["edit", "delete"]);
  const [, sent] = calls[2];
  assert.equal(sent.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
  assert.equal(sent.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
});

test("a deferred reply takes the notice as its edit, flag included", async () => {
  const edits = [];
  const interaction = { deferred: true, replied: false, async editReply(payload) { edits.push(payload); } };
  await runtimeWithAnswer().respondInteraction(interaction, buildNoticePayload({ t: de, language: "de", code: "nothing-playing" }));
  assert.equal(edits[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(edits[0].content, undefined, "no error text replaces the notice");
});
