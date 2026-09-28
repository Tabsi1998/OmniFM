import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Easter egg hunt (#429): from Palm Sunday to Easter Monday about every
// eighth song brings an egg into the panel; whoever clicks first gets it, a
// golden one counts five, one egg per person and song. /ostereier shows the
// server's board, the owner console the top three per server. The parts
// with the stored eggs skip without MONGO_URL.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-eggs-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const eggs = await import("../src/lib/easter-eggs.js");
const { buildEggBoard, eggAnswer, eggSignature } = await import("../src/bot/easter-eggs.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const { checkDiscordLimits } = await import("../src/discord/ui/index.js");
const { buildCommandsJson } = await import("../src/commands.js");
const { setOwnerSettingsForTests } = await import("../src/lib/owner-settings-cache.js");
const { easterEggMethods } = await import("../src/bot/runtime-methods/easter-eggs.js");
const { createAdminEggHuntRoutes } = await import("../src/api/routes/admin-egg-hunt-routes.js");

const GUILD = "123456789012345678";
const OTHER_GUILD = "223456789012345678";
const de = (german) => german;
const en = (_german, english) => english;

// Fresh servers for the stored eggs, so runs never meet.
const run = String(Date.now()).slice(-9);
const storedGuilds = [];
function freshGuild() {
  const id = `7${run}${String(storedGuilds.length).padStart(8, "0")}`;
  storedGuilds.push(id);
  return id;
}

after(async () => {
  setOwnerSettingsForTests({});
  if (hasMongoConfig) {
    const { getDb, isConnected, close } = await import("../src/lib/db.js");
    if (isConnected()) {
      await getDb().collection("easter_eggs").deleteMany({ guildId: { $in: storedGuilds } }).catch(() => null);
      await getDb().collection("easter_egg_claims").deleteMany({ guildId: { $in: storedGuilds } }).catch(() => null);
    }
    await close().catch(() => null);
  }
  fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 });
});

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  return out;
}
const allText = (payload) => (payload.components || []).flatMap((component) => texts(component)).join("\n");

const on = (iso, options = {}) => eggs.eggHuntFor({ now: new Date(iso), guildId: GUILD, ...options });

test("the hunt runs from Palm Sunday to Easter Monday in the server's time", () => {
  // 2027: Palm Sunday 21 March, Easter Sunday 28 March, Easter Monday 29 March.
  assert.equal(on("2027-03-20T22:59:00Z"), null, "the Saturday before, 23:59 in Vienna");
  assert.deepEqual(on("2027-03-20T23:00:00Z"), { year: 2027, test: false }, "Palm Sunday, midnight in Vienna");
  assert.deepEqual(on("2027-03-29T21:59:00Z"), { year: 2027, test: false }, "Easter Monday, 23:59 summer time");
  assert.equal(on("2027-03-29T22:00:00Z"), null, "the Tuesday after");
  const newYork = { settings: { timeZone: "America/New_York" } };
  assert.equal(on("2027-03-21T03:00:00Z", newYork), null, "still Saturday in New York");
  assert.deepEqual(on("2027-03-21T05:00:00Z", newYork), { year: 2027, test: false });

  const during = "2027-03-24T12:00:00Z";
  assert.equal(on(during, { settings: { seasonDecor: { parts: { eggHunt: false } } } }), null, "the server switched the egg hunt off");
  assert.equal(on(during, { settings: { seasonDecor: { seasons: { easter: false } } } }), null, "the server switched Easter off");
  assert.equal(on(during, { owner: { enabled: { easter: false } } }), null, "the owner switched Easter off");

  // The owner's Easter test: any day, only on the servers it names; the server's own switch still wins.
  const testing = { owner: { test: { preview: "easter-soon", guildIds: [GUILD] } } };
  assert.deepEqual(on("2026-10-05T12:00:00Z", testing), { year: 2026, test: true });
  assert.equal(eggs.eggHuntFor({ now: new Date("2026-10-05T12:00:00Z"), guildId: OTHER_GUILD, ...testing }), null);
  assert.equal(on("2026-10-05T12:00:00Z", { owner: { test: { preview: "halloween-soon", guildIds: [GUILD] } } }), null);
  assert.equal(on("2026-10-05T12:00:00Z", { ...testing, settings: { seasonDecor: { parts: { eggHunt: false } } } }), null);
});

test("the next hunt, and when a year's eggs are deleted", () => {
  assert.deepEqual(eggs.nextEggHunt(new Date("2026-09-29T12:00:00Z")), { year: 2027, month: 3, day: 21 });
  assert.deepEqual(eggs.nextEggHunt(new Date("2027-03-24T12:00:00Z")), { year: 2028, month: 4, day: 9 }, "during a hunt: the one after");
  // 30 days after Easter Monday (29 March 2027).
  assert.equal(eggs.eggExpiry(2027, Date.parse("2027-03-25T12:00:00Z")).toISOString(), "2027-04-29T00:00:00.000Z");
  // An egg of the owner's test in October stays a month, not a moment.
  assert.equal(eggs.eggExpiry(2026, Date.parse("2026-10-05T12:00:00Z")).toISOString(), "2026-11-04T12:00:00.000Z");
});

test("the dice: about one song in eight, one egg in twenty golden; the test mode rolls more often", () => {
  const dice = (...values) => (max) => {
    const value = values.shift();
    assert.ok(value < max);
    return value;
  };
  assert.equal(eggs.rollEgg({ random: dice(1) }), null);
  const plain = eggs.rollEgg({ random: dice(0, 3) });
  assert.equal(plain.golden, false);
  assert.match(plain.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(eggs.rollEgg({ random: dice(0, 0) }).golden, true);
  assert.notEqual(eggs.rollEgg({ random: () => 0 }).id, eggs.rollEgg({ random: () => 0 }).id);

  const chances = (test) => {
    const seen = [];
    eggs.rollEgg({ test, random: (max) => { seen.push(max); return 0; } });
    return seen;
  };
  assert.deepEqual(chances(false), [8, 20]);
  assert.deepEqual(chances(true), [2, 4]);

  let found = 0;
  for (let song = 0; song < 8000; song += 1) if (eggs.rollEgg()) found += 1;
  assert.ok(found > 800 && found < 1200, `${found} eggs in 8000 songs`);

  assert.equal(eggs.eggPoints({ golden: true }), 5);
  assert.equal(eggs.eggPoints({ golden: false }), 1);
  assert.equal(eggs.songKey(" Artist - Song "), eggs.songKey("artist - song"));
  assert.notEqual(eggs.songKey("Artist - Song"), eggs.songKey("Artist - Other"));
  assert.equal(eggs.songKey(""), "");
  assert.deepEqual(eggs.rankRows([{ count: 12 }, { count: 9 }, { count: 9 }, { count: 4 }]).map((row) => row.rank), [1, 2, 2, 4]);
});

test("the panel shows the egg, a golden one, and \"Found\" once somebody has it", () => {
  const base = {
    t: de, applicationId: null, workerName: "OmniFM 1", planTier: "ultimate",
    station: { name: "Groove Salad", key: "groove", genre: "Ambient", tier: "free" },
    track: { hasTrack: true, headline: "Song", artist: "Artist", album: "Album" },
    playback: { phase: "playing", paused: false, listeners: 3, volume: 80, channelId: "323456789012345678" },
    notices: {},
  };
  const json = (easterEgg) => JSON.stringify(buildNowPlayingPanel({ ...base, easterEgg }).components[0].toJSON());
  const open = json({ id: "abcdefghijkl", golden: false, foundAt: 0 });
  assert.match(open, /"custom_id":"np:egg:abcdefghijkl"/);
  assert.match(open, /Ein Osterei!/);
  assert.match(json({ id: "abcdefghijkl", golden: true, foundAt: 0 }), /Ein goldenes Ei!/);
  const found = json({ id: "abcdefghijkl", golden: false, foundAt: 1 });
  assert.match(found, /"label":"Gefunden"/);
  assert.match(found, /"disabled":true/);
  assert.doesNotMatch(json(null), /np:egg:/);

  // The fullest panel (Ultimate favourites, backup station, song links) keeps within Discord's limits with the egg.
  const favorites = Array.from({ length: 10 }, (_, index) => ({ key: `fav${index}`, name: `Favourite ${index}`, color: "#22c55e" }));
  const fullest = buildNowPlayingPanel({
    ...base,
    favorites,
    searchQuery: "Artist Song",
    musicBrainzUrl: "https://musicbrainz.org/recording/x",
    recent: ["One", "Two", "Three"],
    notices: { serverMuted: true, failover: { active: true, desiredName: "Wanted FM", currentName: "Groove Salad" } },
    easterEgg: { id: "abcdefghijkl", golden: true, foundAt: 0 },
  });
  assert.deepEqual(checkDiscordLimits(fullest).problems, []);

  assert.equal(eggSignature(null), "");
  assert.notEqual(eggSignature({ id: "x", foundAt: 0 }), eggSignature({ id: "x", foundAt: 5 }), "a found egg redraws the panel");
});

test("the finder's answer is private and says the count; refusals say why", () => {
  const won = eggAnswer({ t: de, result: { ok: true, count: 3 } });
  assert.ok(won.flags & 64, "ephemeral");
  assert.match(won.content, /Du hast ein Ei gefunden! \(3 dieses Jahr\)/);
  assert.match(won.content, /`\/ostereier`/);
  assert.match(eggAnswer({ t: de, result: { ok: true, count: 8 }, golden: true }).content, /goldenes Ei gefunden! Es zählt 5\. \(8 dieses Jahr\)/);
  assert.match(eggAnswer({ t: en, result: { ok: true, count: 1 } }).content, /You found an egg! \(1 this year\)/);
  const refusals = { taken: /Zu spät/, gone: /Der Song ist schon vorbei/, song: /Für diesen Song hast du schon ein Ei/, over: /Ostereiersuche ist vorbei/, bot: /Bots suchen keine Eier/, error: /geht gerade nicht/ };
  for (const [reason, pattern] of Object.entries(refusals)) {
    assert.match(eggAnswer({ t: de, result: { ok: false, reason } }).content, pattern, reason);
  }
});

test("/ostereier: the top ten with shared places, one's own place, and what comes next", () => {
  const [a, b, c, d] = ["111111111111111111", "222222222222222222", "333333333333333333", "444444444444444444"];
  const board = {
    year: 2027,
    top: [{ userId: a, count: 12, rank: 1 }, { userId: b, count: 9, rank: 2 }, { userId: c, count: 9, rank: 2 }, { userId: d, count: 1, rank: 4 }],
    own: { count: 9, rank: 2 },
    finders: 4,
  };
  const payload = buildEggBoard({ t: de, board, running: true });
  assert.ok(payload.flags & 64, "only for whoever asks");
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  const text = allText(payload);
  assert.match(text, /Ostereiersuche 2027/);
  assert.match(text, new RegExp(`🥇 <@${a}> · 12 Eier`));
  assert.match(text, new RegExp(`🥈 <@${b}> · 9 Eier`));
  assert.match(text, new RegExp(`🥈 <@${c}> · 9 Eier`));
  assert.match(text, new RegExp(`\\*\\*4\\.\\*\\* <@${d}> · 1 Ei`));
  assert.match(text, /Dein Platz: 2 · 9 Eier/);
  assert.match(text, /jeder achte Song/);
  assert.match(allText(buildEggBoard({ t: en, board, running: true })), /Your place: 2 · 9 eggs/);

  const empty = allText(buildEggBoard({ t: de, board: null, next: { year: 2027, month: 3, day: 21 } }));
  assert.match(empty, /Hier hat noch niemand ein Ei gefunden/);
  assert.match(empty, /Du hast noch kein Ei gefunden/);
  assert.match(empty, new RegExp(`Palmsonntag, <t:${Date.UTC(2027, 2, 21, 12) / 1000}:D>`));
  assert.match(allText(buildEggBoard({ t: de, board, off: true })), /auf diesem Server ausgeschaltet/);
});

test("/ostereier is /eggs in English, with its description in all nine languages", () => {
  const command = buildCommandsJson().find((entry) => entry.name === "eggs");
  assert.ok(command, "registered");
  assert.equal(command.name_localizations?.de, "ostereier");
  for (const locale of ["de", "fr", "es-ES", "it", "pl", "tr", "pt-BR", "nl"]) {
    const description = command.description_localizations?.[locale];
    assert.ok(description && description !== command.description, locale);
  }
});

test("without MongoDB a song brings no egg, not even during the hunt", () => {
  setOwnerSettingsForTests({ seasons: { test: { preview: "easter-soon", guildIds: [GUILD] } } });
  const runtime = { ...easterEggMethods, getCachedGuildSettings: () => ({}) };
  const state = {};
  assert.equal(runtime.rollEasterEgg(GUILD, state, "Artist - Song", { random: () => 0 }), null);
  assert.equal(state.easterEgg, null);
  setOwnerSettingsForTests({});
});

function fakeRuntime(guildId) {
  const refreshed = [];
  const runtime = {
    ...easterEggMethods,
    config: { name: "OmniFM 1" },
    guildState: new Map([[guildId, {}]]),
    getCachedGuildSettings: () => ({}),
    getApplicationId: () => null,
    createInteractionTranslator: () => ({ t: de, language: "de" }),
    updateNowPlayingEmbed: async (_guildId, _state, options) => { refreshed.push(options); },
  };
  return { runtime, refreshed, state: runtime.guildState.get(guildId) };
}

function click(guildId, userId, answers, { bot = false } = {}) {
  const record = async (payload) => { answers.push({ userId, content: payload.content }); };
  return {
    guildId,
    guild: { name: "Eierclub" },
    user: { id: userId, bot },
    locale: "de",
    reply: record,
    deferReply: async () => {},
    editReply: record,
  };
}

test("ten people click one egg at once: exactly one gets it, the panel then says Found", { skip: !hasMongoConfig }, async () => {
  const { connect } = await import("../src/lib/db.js");
  await connect();
  const guildId = freshGuild();
  setOwnerSettingsForTests({ seasons: { test: { preview: "easter-greeting", guildIds: [guildId] } } });
  const { runtime, refreshed, state } = fakeRuntime(guildId);
  const now = Date.now();
  const egg = runtime.rollEasterEgg(guildId, state, "Artist - Song", { now, random: (max) => (max === 4 ? 1 : 0) });
  assert.equal(egg.golden, false);
  assert.equal(egg.year, new Date(now).getFullYear());

  const answers = [];
  const people = Array.from({ length: 10 }, (_, index) => `9${String(index).padStart(2, "0")}${run}${"0".repeat(6)}`);
  await Promise.all(people.map((userId) => runtime.handleEasterEggClick(click(guildId, userId, answers), egg.id)));
  const winners = answers.filter((answer) => /Du hast ein Ei gefunden! \(1 dieses Jahr\)/.test(answer.content));
  assert.equal(winners.length, 1, JSON.stringify(answers));
  assert.equal(answers.filter((answer) => /Zu spät/.test(answer.content)).length, 9);
  assert.ok(state.easterEgg.foundAt > 0);
  assert.deepEqual(refreshed.at(-1), { force: true }, "the panel is redrawn at once");

  // Afterwards: too late; an old button: gone; a bot: no egg.
  const late = [];
  await runtime.handleEasterEggClick(click(guildId, people[0], late), egg.id);
  await runtime.handleEasterEggClick(click(guildId, people[0], late), "oldeggoldegg");
  await runtime.handleEasterEggClick(click(guildId, people[0], late, { bot: true }), egg.id);
  assert.match(late[0].content, /Zu spät/);
  assert.match(late[1].content, /Der Song ist schon vorbei/);
  assert.match(late[2].content, /Bots suchen keine Eier/);

  // /ostereier: the winner is first.
  const boards = [];
  await runtime.handleEggHuntCommand({
    guildId,
    user: { id: winners[0].userId },
    deferReply: async () => {},
    editReply: async (payload) => { boards.push(payload); },
  }, { now: new Date(now) });
  const board = allText(boards[0]);
  assert.match(board, new RegExp(`🥇 <@${winners[0].userId}> · 1 Ei`));
  assert.match(board, /Dein Platz: 1 · 1 Ei/);
  assert.equal(boards[0].flags & 64, 0, "an edited reply carries no ephemeral flag");
  setOwnerSettingsForTests({});
});

test("stored eggs: one per person and song, golden counts five, shared places, the owner's top three", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const store = await import("../src/easter-eggs-store.js");
  const guildId = freshGuild();
  const [a, b, c, d] = ["1", "2", "3", "4"].map((digit) => `${digit}${run}${"0".repeat(8)}`);
  const now = Date.now();
  const claim = (eggId, userId, extra = {}) => store.claimEgg({ eggId, guildId, guildName: "Eierclub", userId, year: 2027, song: "songA", now, ...extra });

  assert.deepEqual(await claim("e1", a), { ok: true, count: 1 });
  assert.deepEqual(await claim("e1", b), { ok: false, reason: "taken" });
  // The same song in a second panel: a takes no second egg; it stays for b.
  assert.deepEqual(await claim("e2", a), { ok: false, reason: "song" });
  assert.deepEqual(await claim("e2", b), { ok: true, count: 1 });
  // The same song twenty minutes later is a new song.
  assert.deepEqual(await claim("e3", a, { now: now + 20 * 60_000 }), { ok: true, count: 2 });
  assert.deepEqual(await claim("e4", c, { points: 5, song: "songB" }), { ok: true, count: 5 });
  assert.deepEqual(await claim("e5", d, { song: "songC" }), { ok: true, count: 1 });
  assert.deepEqual(await claim("e6", d, { song: "songD" }), { ok: true, count: 2 });

  const board = await store.eggBoard(guildId, 2027, { userId: d });
  assert.deepEqual(board.top.map((row) => [row.userId, row.count, row.rank]), [[c, 5, 1], [a, 2, 2], [d, 2, 2], [b, 1, 4]]);
  assert.deepEqual(board.own, { count: 2, rank: 2 });
  assert.equal(board.finders, 4);
  assert.equal(await store.latestEggYear(guildId), 2027);
  const kept = await getDb().collection("easter_eggs").findOne({ guildId, userId: a });
  assert.equal(kept.expiresAt.toISOString(), "2027-04-29T00:00:00.000Z", "30 days after Easter Monday");
  assert.deepEqual(Object.keys(kept).sort(), ["_id", "count", "expiresAt", "guildId", "guildName", "lastFoundAt", "lastSong", "userId", "year"]);

  const top = await store.eggTopByServer({ year: 2027 });
  assert.deepEqual(top.servers.find((server) => server.guildId === guildId), {
    guildId, name: "Eierclub", finders: 4, eggs: 10,
    top: [{ userId: c, count: 5, rank: 1 }, { userId: a, count: 2, rank: 2 }, { userId: d, count: 2, rank: 2 }],
  });

  // The owner console's route: the same, without names of people.
  const sent = [];
  const handle = createAdminEggHuntRoutes({ sendJson: (_res, status, body) => sent.push({ status, body }), methodNotAllowed: (_res, allowed) => sent.push({ status: 405, allowed }) });
  const requestUrl = new URL("http://localhost/api/admin/egg-hunt?year=2027");
  assert.equal(await handle({ req: { method: "GET" }, res: {}, requestUrl }), true);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].body.year, 2027);
  assert.deepEqual(sent[0].body.servers.find((server) => server.guildId === guildId)?.top.map((row) => row.userId), [c, a, d]);
  assert.equal(await handle({ req: { method: "POST" }, res: {}, requestUrl }), true);
  assert.deepEqual(sent[1], { status: 405, allowed: ["GET"] });
  assert.equal(await handle({ req: { method: "GET" }, res: {}, requestUrl: new URL("http://localhost/api/admin/other") }), false);

  // /mydata: the person's eggs, and "delete everything".
  assert.deepEqual((await store.listEggsOfFinder(a)).map((entry) => [entry.guildId, entry.year, entry.count]), [[guildId, 2027, 2]]);
  assert.equal(await store.forgetEggFinder(a), 1);
  assert.deepEqual((await store.eggBoard(guildId, 2027)).top.map((row) => row.userId), [c, d, b]);
});
