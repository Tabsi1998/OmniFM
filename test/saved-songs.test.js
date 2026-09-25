import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-saved-songs-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.DB_NAME = `omnifm_saved_songs_${process.pid}_${Date.now()}`;

const store = await import("../src/saved-songs-store.js");
const saved = await import("../src/bot/saved-songs.js");
const ui = await import("../src/discord/ui/index.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { buildCommandsJson } = await import("../src/commands.js");

const de = (german) => german;
const USER = "123456789012345678";
const OTHER = "223456789012345678";
const GUILD = "323456789012345678";

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  if (json.accessory) texts(json.accessory, out);
  return out;
}

function nodes(node, type, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === type) out.push(json);
  for (const child of json.components || []) nodes(child, type, out);
  if (json.accessory) nodes(json.accessory, type, out);
  return out;
}

const allText = (payload) => payload.components.flatMap((component) => texts(component)).join("\n");
const buttons = (payload) => payload.components.flatMap((component) => nodes(component, 2));
const selects = (payload) => payload.components.flatMap((component) => nodes(component, 3));

const SONG = {
  artist: "Energy 52",
  title: "Café del Mar",
  displayTitle: "Energy 52 - Café del Mar",
  stationKey: "groovesalad",
  stationName: "Groove Salad",
  artworkUrl: "https://is1.example/cover.jpg",
};

test("one song is one key, whatever the case, accents or punctuation", () => {
  const key = store.savedSongTrackKey({ artist: "Energy 52", title: "Café del Mar" });
  assert.equal(key, "energy 52|cafe del mar");
  assert.equal(store.savedSongTrackKey({ artist: "ENERGY-52", title: "Cafe Del Mar!" }), "energy 52|cafe del mar");
  assert.equal(store.savedSongTrackKey({ displayTitle: "Only A Title" }), "only a title");
  assert.equal(store.buildSavedSong({ stationName: "Groove Salad" }), null, "no title, nothing to save");
  assert.equal(store.buildSavedSong({ ...SONG, artworkUrl: "http://plain.example/x.jpg" }).artworkUrl, null, "only https covers");
});

test("the search links are plain searches at the four services", () => {
  const links = saved.musicSearchLinks(SONG);
  assert.deepEqual(links.map((link) => link.label), ["Spotify", "Apple Music", "YouTube Music", "Deezer"]);
  const query = encodeURIComponent("Energy 52 Café del Mar");
  assert.equal(links[0].url, `https://open.spotify.com/search/${query}`);
  assert.equal(links[1].url, `https://music.apple.com/search?term=${query}`);
  assert.equal(links[2].url, `https://music.youtube.com/search?q=${query}`);
  assert.equal(links[3].url, `https://www.deezer.com/search/${query}`);
});

test("the song card shows cover, title, artist, station, time and the links", () => {
  const savedAt = new Date("2026-09-25T10:00:00Z");
  const card = saved.buildSongCard({ t: de, song: SONG, savedAt });
  const payload = ui.message(card);
  const body = allText(payload);
  assert.match(body, /## Café del Mar\nEnergy 52/);
  assert.match(body, /Groove Salad · <t:1790330400:f>/);
  assert.equal(nodes(card, 11)[0].media.url, SONG.artworkUrl);
  assert.deepEqual(buttons(payload).map((button) => button.label), ["Spotify", "Apple Music", "YouTube Music", "Deezer"]);
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

test("the list pages ten songs, offers a delete menu and 'delete all'", () => {
  const songs = Array.from({ length: 25 }, (_, index) => ({
    id: `id-${index}`, title: `Song ${index}`, artist: "Artist", displayTitle: `Artist - Song ${index}`, stationName: "Groove Salad", savedAt: new Date(),
  }));
  const payload = saved.buildSavedSongsListPayload({ t: de, songs, page: 1 });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const body = allText(payload);
  assert.match(body, /25 von höchstens 50/);
  assert.match(body, /\*\*11\.\*\* Song 10 – Artist/);
  assert.doesNotMatch(body, /Song 20/);
  const [menu] = selects(payload);
  assert.equal(menu.custom_id, "omnifm:saved:delete:1");
  assert.equal(menu.options.length, 10);
  assert.deepEqual(buttons(payload).map((button) => button.custom_id), [
    "omnifm:saved:page:0", "omnifm:saved:position", "omnifm:saved:page:2", "omnifm:saved:clear:1",
  ]);
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);

  const empty = saved.buildSavedSongsListPayload({ t: de, songs: [] });
  assert.match(allText(empty), /Noch nichts gemerkt/);
  assert.equal(selects(empty).length, 0);
  assert.equal(buttons(empty).length, 0);
});

test("/merkliste is 'saved' with the German name 'merkliste'", () => {
  const command = buildCommandsJson().find((entry) => entry.name === "saved");
  assert.ok(command);
  assert.equal(command.name_localizations?.de, "merkliste");
});

// ---- the runtime side: a worker with a song on air, a person clicking ----

function buildWorker(meta = { artist: SONG.artist, title: SONG.title, displayTitle: SONG.displayTitle, artworkUrl: SONG.artworkUrl }) {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM 1" };
  runtime.guildState = new Map([[GUILD, { currentMeta: meta, currentStationKey: "groovesalad", currentStationName: "Groove Salad" }]]);
  runtime.getResolvedCurrentStation = () => ({ station: { name: "Groove Salad" } });
  runtime.resolveInteractionLanguage = () => "de";
  return runtime;
}

function click(customId, { dm = "open", values = null } = {}) {
  const calls = [];
  const dms = [];
  const interaction = {
    calls,
    dms,
    customId,
    values,
    guildId: GUILD,
    applicationId: null,
    deferred: false,
    replied: false,
    user: {
      id: USER,
      send: async (payload) => {
        if (dm === "closed") throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
        dms.push(payload);
      },
    },
    isStringSelectMenu: () => Array.isArray(values),
    deferReply: async (options) => { interaction.deferred = true; calls.push(["deferReply", options]); },
    editReply: async (payload) => { calls.push(["editReply", payload]); },
    reply: async (payload) => { interaction.replied = true; calls.push(["reply", payload]); },
    update: async (payload) => { calls.push(["update", payload]); },
  };
  return interaction;
}

const answer = (interaction) => interaction.calls.filter(([kind]) => kind !== "deferReply").at(-1)[1];

test("without a title on air there is nothing to save", async () => {
  const runtime = buildWorker({ displayTitle: "", artist: "", title: "" });
  const interaction = click("np:save");
  await runtime.handleNowPlayingControl(interaction);
  assert.match(allText(answer(interaction)), /Gerade kein Titel/);
});

test("without MongoDB the button says so instead of failing", async () => {
  const interaction = click("np:save");
  await buildWorker().handleNowPlayingControl(interaction);
  assert.match(allText(answer(interaction)), /Nicht gemerkt[\s\S]*nicht erreichbar/);
  assert.equal(interaction.dms.length, 0);
});

test("saving, the list and deleting against a real MongoDB", async (t) => {
  if (!String(process.env.MONGO_URL || "").trim()) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const dbModule = await import("../src/lib/db.js");
  await dbModule.connect();
  const database = dbModule.getDb();
  const collection = database.collection(store.SAVED_SONGS_COLLECTION);
  t.after(async () => {
    await database.dropDatabase().catch(() => null);
    await dbModule.close();
  });

  await t.test("the button saves, sends the card by DM and saves a double click once", async () => {
    const runtime = buildWorker();
    const first = click("np:save");
    await runtime.handleNowPlayingControl(first);
    assert.equal(first.calls[0][0], "deferReply");
    assert.equal(first.dms.length, 1, "the card goes by DM");
    assert.match(allText(first.dms[0]), /## Café del Mar/);
    assert.match(allText(answer(first)), /Gemerkt[\s\S]*Direktnachrichten/);

    const second = click("np:save");
    await runtime.handleNowPlayingControl(second);
    assert.match(allText(answer(second)), /Schon gemerkt/);
    assert.equal(second.dms.length, 0, "no second card");

    await Promise.all([runtime.handleNowPlayingControl(click("np:save")), runtime.handleNowPlayingControl(click("np:save"))]);
    assert.equal(await collection.countDocuments({ userId: USER }), 1);
  });

  await t.test("closed DMs: the card comes privately in the channel", async () => {
    await collection.deleteMany({});
    const interaction = click("np:save", { dm: "closed" });
    await buildWorker().handleNowPlayingControl(interaction);
    const body = allText(answer(interaction));
    assert.match(body, /## Café del Mar/);
    assert.match(body, /Direktnachrichten sind zu/);
    assert.equal(await collection.countDocuments({ userId: USER }), 1);
  });

  await t.test("the list shows the songs; one is deleted with the menu", async () => {
    const runtime = buildWorker();
    const command = click("");
    await runtime.handleSavedSongsCommand(command);
    const list = answer(command);
    assert.match(allText(list), /1 von höchstens 50/);
    assert.match(allText(list), /Café del Mar – Energy 52/);
    const [song] = await store.listSavedSongs(USER);

    // someone else cannot delete it
    assert.deepEqual(await store.deleteSavedSong(OTHER, song.id), { ok: true, deleted: 0 });

    const remove = click("omnifm:saved:delete:0", { values: [song.id] });
    await runtime.handleSavedSongsComponent(remove);
    assert.equal(remove.calls[0][0], "update");
    assert.equal(remove.calls[0][1].flags, MessageFlags.IsComponentsV2);
    assert.match(allText(remove.calls[0][1]), /Noch nichts gemerkt/);
    assert.equal(await collection.countDocuments({ userId: USER }), 0);
  });

  await t.test("at most 50 songs; the oldest go first", async () => {
    const start = Date.parse("2026-09-01T00:00:00Z");
    for (let index = 0; index < 52; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await store.saveSong(USER, { artist: "Artist", title: `Song ${index}` }, { now: new Date(start + index * 1000) });
    }
    const songs = await store.listSavedSongs(USER);
    assert.equal(songs.length, 50);
    assert.equal(await collection.countDocuments({ userId: USER }), 50);
    assert.equal(songs[0].title, "Song 51");
    assert.equal(songs.at(-1).title, "Song 2");
  });

  await t.test("'delete all' asks first; afterwards nothing of the person is in MongoDB", async () => {
    await store.saveSong(OTHER, { artist: "Other", title: "Stays" });
    const runtime = buildWorker();
    const ask = click("omnifm:saved:clear:0");
    await runtime.handleSavedSongsComponent(ask);
    assert.match(allText(ask.calls[0][1]), /Alle 50 Songs werden gelöscht/);

    const cancel = click("omnifm:saved:clearno:0");
    await runtime.handleSavedSongsComponent(cancel);
    assert.match(allText(cancel.calls[0][1]), /50 von höchstens 50/);

    const confirm = click("omnifm:saved:clearyes:0");
    await runtime.handleSavedSongsComponent(confirm);
    assert.match(allText(confirm.calls[0][1]), /50 Songs gelöscht/);
    assert.equal(await collection.countDocuments({ userId: USER }), 0);
    assert.equal(await collection.countDocuments({ userId: OTHER }), 1, "only the person's own songs go");
  });
});
