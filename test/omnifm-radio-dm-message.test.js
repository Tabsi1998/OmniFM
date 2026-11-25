import test from "node:test";
import assert from "node:assert/strict";

// OmniFM Radio DMs (#594): the DM itself and its buttons. Short, in the
// server's language, a link to the public player, and "Abbestellen" that
// works with any restart in between (no session behind the button).
import { MessageFlags } from "discord.js";
import { checkDiscordLimits } from "../src/discord/ui/index.js";
import { BOT_LANGUAGES } from "../src/lib/bot-i18n.js";
import {
  buildRadioDmMessage,
  handleRadioDmComponent,
  parseRadioDmCustomId,
} from "../src/bot/omnifm-radio-dm-message.js";
import { createOmnifmRadioDmStore } from "../src/omnifm-radio-dm-store.js";

const CONFIG = { baseUrl: "https://radio.omnifm.xyz", station: "omnifm_radio" };
const SHOW = { streamerName: "DJ Tabsi", title: "Abendshow", startedAt: "2026-11-25T20:00:00.000Z", source: "webhook" };
const USER = "400000000000000001";

function walk(payload, visit) {
  const go = (node) => {
    if (!node || typeof node !== "object") return;
    const json = typeof node.toJSON === "function" ? node.toJSON() : node;
    visit(json);
    for (const child of json.components || []) go(child);
    if (json.accessory) go(json.accessory);
  };
  for (const component of payload?.components || []) go(component);
}
const textOf = (payload) => {
  const parts = [];
  walk(payload, (json) => { if (json.type === 10) parts.push(json.content); });
  return parts.join("\n");
};
const buttonsOf = (payload) => {
  const found = [];
  walk(payload, (json) => { if (json.type === 2) found.push(json); });
  return found;
};

test("the DM says who is live and what the show is, with the public player and a way out", () => {
  const payload = buildRadioDmMessage({ show: SHOW, language: "de", config: CONFIG, guildName: "Lion Squad" });
  const text = textOf(payload);
  assert.match(text, /DJ Tabsi ist live auf OmniFM Radio/);
  assert.match(text, /Abendshow/);
  assert.match(text, /Lion Squad/, "it says why the person gets it");
  const [listen, unsubscribe] = buttonsOf(payload);
  assert.equal(listen.label, "Jetzt hören");
  assert.equal(listen.url, "https://radio.omnifm.xyz/public/omnifm_radio");
  assert.equal(unsubscribe.label, "Abbestellen");
  assert.equal(unsubscribe.custom_id, "omnifm:radiodm:unsub:de");
  assert.deepEqual(payload.allowedMentions, { parse: [] }, "nobody is pinged");
  assert.equal(payload.flags & MessageFlags.Ephemeral, 0);
  assert.ok(payload.flags & MessageFlags.IsComponentsV2);
});

test("without a DJ or a title the DM still reads well", () => {
  const text = textOf(buildRadioDmMessage({ show: { ...SHOW, streamerName: "", title: "" }, language: "de", config: CONFIG }));
  assert.match(text, /OmniFM Radio ist jetzt live/);
  assert.doesNotMatch(text, /\n\n\n/);
  assert.equal(textOf(buildRadioDmMessage({ show: SHOW, language: "en", config: CONFIG })).includes("DJ Tabsi is live on OmniFM Radio"), true);
});

test("the other seven languages come from the tables", () => {
  const payload = buildRadioDmMessage({ show: SHOW, language: "fr", config: CONFIG });
  assert.match(textOf(payload), /DJ Tabsi est en direct sur OmniFM Radio/);
  assert.deepEqual(buttonsOf(payload).map((button) => button.label), ["Écouter maintenant", "Se désabonner"]);
});

test("names and titles from AzuraCast cannot format the DM or mention anybody", () => {
  const show = { ...SHOW, streamerName: "**DJ** @everyone", title: "<@123456789012345678> `x` __y__" };
  const text = textOf(buildRadioDmMessage({ show, language: "de", config: CONFIG, guildName: "@here *Server*" }));
  assert.match(text, /\\\*\\\*DJ\\\*\\\*/);
  assert.doesNotMatch(text, /@everyone|@here/);
  assert.doesNotMatch(text, /<@\d/);
  assert.match(text, /\\`x\\`/);
});

test("a test DM says it is a test", () => {
  assert.match(textOf(buildRadioDmMessage({ show: { ...SHOW, source: "test" }, language: "de", config: CONFIG })), /🧪/);
  assert.doesNotMatch(textOf(buildRadioDmMessage({ show: SHOW, language: "de", config: CONFIG })), /🧪/);
});

test("in all nine languages, with the longest names, the DM fits Discord's limits", () => {
  const show = { streamerName: "D".repeat(100), title: "T".repeat(300), startedAt: SHOW.startedAt, source: "test" };
  for (const language of BOT_LANGUAGES) {
    const payload = buildRadioDmMessage({ show, language, config: CONFIG, guildName: "G".repeat(100) });
    assert.deepEqual(checkDiscordLimits(payload).problems, [], language);
    assert.ok(buttonsOf(payload).every((button) => String(button.label).length <= 80), `${language}: button labels`);
    assert.equal(buttonsOf(payload)[1].custom_id, `omnifm:radiodm:unsub:${language}`);
  }
});

test("the button ids carry the action and the language, nothing else", () => {
  assert.deepEqual(parseRadioDmCustomId("omnifm:radiodm:unsub:fr"), { action: "unsub", language: "fr" });
  assert.deepEqual(parseRadioDmCustomId("omnifm:radiodm:resub:nl"), { action: "resub", language: "nl" });
  assert.deepEqual(parseRadioDmCustomId("omnifm:radiodm:unsub:xx"), { action: "unsub", language: "en" });
  assert.equal(parseRadioDmCustomId("omnifm:radiodm:wipe:de"), null);
  assert.equal(parseRadioDmCustomId("omnifm:report:done:abc"), null);
});

function click(customId, { userId = USER } = {}) {
  const calls = { update: [], reply: [] };
  return {
    calls,
    customId,
    user: { id: userId },
    guildId: null,
    isButton: () => true,
    update: async (payload) => { calls.update.push(payload); },
    reply: async (payload) => { calls.reply.push(payload); },
  };
}

test("Abbestellen and Wieder abonnieren work without a session, also after a restart", async () => {
  const store = createOmnifmRadioDmStore({ getDatabase: () => null, mongoRequested: () => false });
  const unsubscribe = click("omnifm:radiodm:unsub:en");
  assert.equal(await handleRadioDmComponent(unsubscribe, { store, now: () => 1_000 }), true);
  assert.equal((await store.get(USER)).unsubscribed, true);
  const unsubscribed = unsubscribe.calls.update[0];
  assert.ok(unsubscribed, "the DM itself changes");
  assert.match(textOf(unsubscribed), /Unsubscribed/);
  assert.deepEqual(buttonsOf(unsubscribed).map((button) => button.custom_id), ["omnifm:radiodm:resub:en"]);
  assert.deepEqual(checkDiscordLimits(unsubscribed).problems, []);

  const resubscribe = click("omnifm:radiodm:resub:en");
  assert.equal(await handleRadioDmComponent(resubscribe, { store, now: () => 2_000 }), true);
  const person = await store.get(USER);
  assert.deepEqual({ unsubscribed: person.unsubscribed, subscribed: person.subscribed }, { unsubscribed: false, subscribed: true });
  const subscribed = resubscribe.calls.update[0];
  assert.deepEqual(buttonsOf(subscribed).map((button) => button.custom_id), ["omnifm:radiodm:unsub:en"]);
  assert.deepEqual(checkDiscordLimits(subscribed).problems, []);
});

test("when the choice cannot be stored the DM stays and the person hears it did not work", async () => {
  const store = { setSubscribed: async () => { throw new Error("MongoDB ist nicht verbunden."); } };
  const interaction = click("omnifm:radiodm:unsub:de");
  assert.equal(await handleRadioDmComponent(interaction, { store }), true);
  assert.equal(interaction.calls.update.length, 0);
  assert.equal(interaction.calls.reply.length, 1);
  assert.ok(interaction.calls.reply[0].flags & MessageFlags.Ephemeral, "only the person sees it");
  assert.match(textOf(interaction.calls.reply[0]), /Hat nicht geklappt/);
});

test("the commander's button routing hands the DM buttons to this handler", async () => {
  const { menuMethods } = await import("../src/bot/runtime-methods/menus.js");
  const interaction = click("omnifm:radiodm:unsub:de", { userId: "400000000000000002" });
  interaction.isStringSelectMenu = () => false;
  interaction.isModalSubmit = () => false;
  const handled = await menuMethods.handleComponentInteraction.call({ config: { name: "OmniFM 1" } }, interaction);
  assert.equal(handled, true);
  assert.equal(interaction.calls.update.length, 1, "a DM has no server: no guild check stands in the way");
});

test("other buttons are not this handler's", async () => {
  const store = { setSubscribed: async () => assert.fail("nothing stored") };
  assert.equal(await handleRadioDmComponent(click("omnifm:radiodm:wipe:de"), { store }), false);
});
