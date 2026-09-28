import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags, PermissionFlagsBits } from "discord.js";

// #301 part 2: the year review as cards in Discord. Every plan pages
// through them; the picture and the channel post come with Pro, the post
// from 1 December to 31 January and only from managers.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-review-cards-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const panel = await import("../src/bot/year-review-panel.js");
const { buildYearReview } = await import("../src/lib/year-review.js");
const { renderYearReviewCard } = await import("../src/lib/share-card.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { resetYearReviewAnnouncementsForTests } = await import("../src/bot/runtime-methods/year-review.js");
const ui = await import("../src/discord/ui/index.js");

const GUILD = "123456789012345678";
const HOUR = 3_600_000;
const de = (german) => german;
const at = (iso) => Date.parse(iso);

function sampleReview() {
  const months = [];
  const dailyByMonth = {};
  for (let index = 4; index <= 9; index += 1) {
    const month = `2026-${String(index).padStart(2, "0")}`;
    const hours = new Array(24).fill(0);
    hours[20] = 6 * HOUR;
    hours[8] = 1 * HOUR;
    months.push({
      month,
      listeningMs: 10 * HOUR,
      sessions: 4,
      stations: [{ key: "groove", name: "Groove Salad", ms: 7 * HOUR }, { key: "rock", name: "Rock Antenne", ms: 3 * HOUR }],
      genres: [{ genre: "Chill", ms: 7 * HOUR }, { genre: "Rock", ms: 3 * HOUR }],
      hours,
      longest: { ms: 9.5 * HOUR, stationKey: "groove", stationName: "Groove Salad", startedAt: new Date(Date.UTC(2026, 6, 3, 18)) },
      songs: index === 9 ? [{ trackKey: "a|one", title: "Band - One", plays: 12 }] : [],
      songsFrom: index === 9 ? new Date(Date.UTC(2026, 8, 7)) : null,
    });
    dailyByMonth[month] = 10 * HOUR;
  }
  dailyByMonth["2026-02"] = 5 * HOUR;
  return buildYearReview(months, { year: 2026, dailyByMonth });
}

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  if (json.accessory) texts(json.accessory, out);
  return out;
}
function buttons(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 2) out.push(json);
  for (const child of json.components || []) buttons(child, out);
  return out;
}
const allText = (payload) => (payload.components || []).flatMap((component) => texts(component)).join("\n");
const allButtons = (payload) => (payload.components || []).flatMap((component) => buttons(component));

test("which year the review shows: December and January the whole year, otherwise the year so far", () => {
  assert.deepEqual(panel.reviewYearOf(at("2026-09-28T12:00:00Z")), { year: 2026, final: false });
  assert.deepEqual(panel.reviewYearOf(at("2026-11-30T23:30:00Z")), { year: 2026, final: true }, "German time is already December");
  assert.deepEqual(panel.reviewYearOf(at("2027-01-31T12:00:00Z")), { year: 2026, final: true });
  assert.deepEqual(panel.reviewYearOf(at("2027-02-01T12:00:00Z")), { year: 2027, final: false });
  assert.deepEqual(panel.parseYearReviewCustomId(panel.yearReviewCustomId("page", 3)), { action: "page", page: 3 });
  assert.equal(panel.parseYearReviewCustomId("omnifm:review:position:1"), null, "the page number button does nothing");
  assert.equal(panel.parseYearReviewCustomId("omnifm:review:page:99").page, panel.YEAR_REVIEW_PAGES.length - 1);
});

test("the five cards: hours per month, stations, songs, times, and the share buttons", () => {
  const review = sampleReview();
  const now = at("2026-09-28T12:00:00Z");
  const page = (index, extra = {}) => panel.buildYearReviewPage({ t: de, language: "de", review, page: index, guildName: "Radio Club", now, ...extra });

  const overview = page(0);
  assert.ok(overview.flags & MessageFlags.Ephemeral);
  assert.match(allText(overview), /Radio Club: euer Jahr 2026 bisher/);
  assert.match(allText(overview), /65 Stunden Radio/, "the daily stats give the whole year");
  assert.match(allText(overview), /Feb +█+░* 5 h/);
  assert.doesNotMatch(allText(overview), /Okt/, "the year so far ends with this month");
  assert.match(allText(overview), /seit April/);
  const [back, position, next] = allButtons(overview);
  assert.equal(back.disabled, true);
  assert.equal(position.label, "1 / 5");
  assert.equal(next.custom_id, "omnifm:review:page:1");

  assert.match(allText(page(1)), /1\. \*\*Groove Salad\*\* · 42 h[\s\S]*Chill 70 %/);
  assert.match(allText(page(2)), /Band - One\*\* · 12×[\s\S]*seit 7\. September/);
  const time = allText(page(3));
  assert.match(time, /zwischen \*\*20 und 21 Uhr\*\*/);
  assert.match(time, /Abend +18–24 █{10}/);
  assert.match(time, /Längste Sitzung:\*\* 9,5 h mit Groove Salad am 3\. Juli/);

  const freeShare = allButtons(page(4));
  assert.equal(freeShare.find((button) => button.custom_id === "omnifm:review:image:0").disabled, true);
  assert.match(allText(page(4)), /ab Pro/);
  const paidShare = allButtons(page(4, { paid: true, final: true }));
  assert.equal(paidShare.find((button) => button.custom_id === "omnifm:review:image:0").disabled, false);
  assert.equal(paidShare.find((button) => button.custom_id === "omnifm:review:announce:0").disabled, false);
  assert.equal(allButtons(page(4, { paid: true, final: false })).find((button) => button.custom_id === "omnifm:review:announce:0").disabled, true, "the post waits for December");
  assert.match(allText(page(0, { final: true })), /euer Jahr 2026\n|euer Jahr 2026$/m);

  for (let index = 0; index < panel.YEAR_REVIEW_PAGES.length; index += 1) {
    assert.deepEqual(ui.checkDiscordLimits(page(index, { paid: true, final: true })).problems, [], `page ${index}`);
  }
  const empty = panel.buildYearReviewPage({ t: de, review: { year: 2026, listeningHours: 0, topStations: [], topSongs: [] } });
  assert.match(allText(empty), /Noch keine Hörzeit 2026/);
  assert.equal(allButtons(empty).length, 0);
});

test("the post in the channel is public and opens the cards for anyone; the picture is a PNG", async () => {
  const review = sampleReview();
  const post = panel.buildYearReviewAnnouncement({ t: de, language: "de", review, guildName: "Radio Club" });
  assert.equal(post.flags & MessageFlags.Ephemeral, 0);
  assert.match(allText(post), /unser Jahr 2026[\s\S]*65 Stunden Radio[\s\S]*Top-Sender: \*\*Groove Salad\*\*[\s\S]*20 Uhr/);
  assert.deepEqual(allButtons(post).map((button) => button.custom_id), ["omnifm:review:open:0"]);

  const png = await renderYearReviewCard({ guildName: "Radio Club", year: 2026, hours: 65, topStation: "Groove Salad", topSong: "Band - One", busiestHour: 20, t: de });
  assert.equal(Buffer.from(png).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

// ---- in Discord ----

let plan = "free";
setLicenseProvider((serverId) => (String(serverId) === GUILD ? (plan === "free" ? null : { plan, active: true, seats: 1 }) : null));

function commander() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-commander", name: "OmniFM DJ" };
  runtime.role = "commander";
  runtime.resolveInteractionLanguage = () => "de";
  runtime.resolveGuildLanguage = () => "de";
  return runtime;
}

function fakeInteraction(customId = "", { manager = false } = {}) {
  const calls = [];
  const channel = { sent: [], send: async (payload) => { channel.sent.push(payload); } };
  const interaction = {
    calls,
    channel,
    customId,
    guildId: GUILD,
    guild: { id: GUILD, name: "Radio Club" },
    user: { id: "323456789012345678" },
    memberPermissions: { has: (bit) => manager && bit === PermissionFlagsBits.ManageGuild },
    deferred: false,
    replied: false,
    isButton: () => Boolean(customId),
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    async reply(payload) { interaction.replied = true; calls.push(["reply", payload]); },
    async deferReply(options) { interaction.deferred = true; calls.push(["deferReply", options]); },
    async editReply(payload) { calls.push(["editReply", payload]); },
    async followUp(payload) { calls.push(["followUp", payload]); },
    async update(payload) { calls.push(["update", payload]); },
  };
  return interaction;
}
const lastPayload = (interaction) => interaction.calls.filter(([kind]) => kind !== "deferReply").at(-1)[1];

test("/jahresrueckblick pages through the cards; picture and post by plan, month and role", async () => {
  resetYearReviewAnnouncementsForTests();
  const runtime = commander();
  const review = sampleReview();
  const september = { now: at("2026-09-28T12:00:00Z"), loadReview: async () => review, renderCard: async () => Buffer.from("png") };
  const december = { ...september, now: at("2026-12-05T12:00:00Z") };

  plan = "free";
  const command = fakeInteraction();
  await runtime.handleYearReviewCommand(command, september);
  assert.equal(command.calls[0][0], "deferReply");
  assert.match(allText(lastPayload(command)), /65 Stunden Radio/);

  const next = fakeInteraction(panel.yearReviewCustomId("page", 2));
  assert.equal(await runtime.handleYearReviewComponent(next, september), true);
  assert.equal(next.calls[0][0], "update");
  assert.match(allText(next.calls[0][1]), /Eure Songs/);

  const freeImage = fakeInteraction(panel.yearReviewCustomId("image"));
  await runtime.handleYearReviewComponent(freeImage, september);
  assert.match(allText(lastPayload(freeImage)), /ab Pro/);

  plan = "pro";
  const image = fakeInteraction(panel.yearReviewCustomId("image"));
  await runtime.handleYearReviewComponent(image, september);
  assert.equal(lastPayload(image).files.length, 1);

  const tooEarly = fakeInteraction(panel.yearReviewCustomId("announce"), { manager: true });
  await runtime.handleYearReviewComponent(tooEarly, september);
  assert.match(allText(lastPayload(tooEarly)), /1\. Dezember/);
  assert.equal(tooEarly.channel.sent.length, 0);

  const notManager = fakeInteraction(panel.yearReviewCustomId("announce"));
  await runtime.handleYearReviewComponent(notManager, december);
  assert.match(allText(lastPayload(notManager)), /Server verwalten/);

  const post = fakeInteraction(panel.yearReviewCustomId("announce"), { manager: true });
  await runtime.handleYearReviewComponent(post, december);
  assert.equal(post.channel.sent.length, 1);
  assert.match(allText(post.channel.sent[0]), /unser Jahr 2026/);
  const again = fakeInteraction(panel.yearReviewCustomId("announce"), { manager: true });
  await runtime.handleYearReviewComponent(again, december);
  assert.equal(again.channel.sent.length, 0, "not twice within six hours");
  assert.match(allText(lastPayload(again)), /gerade erst/);

  // Anyone opens the cards from the post, privately.
  const open = fakeInteraction(panel.yearReviewCustomId("open"));
  await runtime.handleYearReviewComponent(open, december);
  assert.equal(open.calls[0][0], "deferReply");
  assert.match(allText(lastPayload(open)), /euer Jahr 2026/);
  plan = "free";
});
