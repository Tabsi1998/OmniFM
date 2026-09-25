import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PermissionFlagsBits } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-poll-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const poll = await import("../src/bot/station-poll.js");
const store = await import("../src/station-polls-store.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { buildCommandsJson } = await import("../src/commands.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");

const de = (german) => german;
const GUILD = "123456789012345678";
const VOICE = "223456789012345678";
const TEXT = "323456789012345678";
const catalog = JSON.parse(fs.readFileSync(new URL("../stations.json", import.meta.url), "utf8")).stations;
const FREE = Object.entries(catalog).filter(([, station]) => (station.tier || "free") === "free").map(([key, station]) => ({ key, name: station.name, genre: station.genre, color: station.color }));

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  return out;
}
const allText = (payload) => payload.components.flatMap((component) => texts(component)).join("\n");

setLicenseProvider(() => null);

test("stations come from a list (key or name, each once) or from a genre", () => {
  const entries = [
    { key: "groovesalad", name: "Groove Salad", genre: "Ambient" },
    { key: "dronezone", name: "Drone Zone", genre: "Ambient" },
    { key: "techno1", name: "Techno Bunker", genre: "Techno" },
  ];
  assert.deepEqual(poll.resolvePollStations("Groove Salad, dronezone, groove, nope", entries), {
    stations: [entries[0], entries[1]],
    unknown: ["nope"],
  });
  const ambient = poll.pickGenreStations(entries, "ambient", 5, () => 0.5);
  assert.deepEqual(ambient.map((entry) => entry.key).sort(), ["dronezone", "groovesalad"]);
  assert.equal(poll.pickGenreStations(entries, "", 10).length, 3);
});

test("the poll: whole hours for Discord, answers fit its limits", () => {
  const stations = [{ key: "a", name: "A".repeat(80), color: "#EF4444" }, { key: "b", name: "Bee" }];
  const short = poll.buildStationPollMessage({ t: de, stations, minutes: 5, endsAt: 1_800_000_000_000 });
  assert.equal(short.poll.duration, 1, "Discord runs at least an hour; OmniFM ends it itself");
  assert.equal(short.poll.allowMultiselect, false);
  assert.equal(short.poll.question.text, "Welcher Sender als Nächstes?");
  assert.equal(short.poll.answers[0].text.length, 55);
  assert.equal(short.poll.answers[0].emoji, "🟥");
  assert.match(short.content, /<t:1800000000:t>/);
  assert.equal(poll.buildStationPollMessage({ t: de, stations, minutes: 180, endsAt: 0 }).poll.duration, 3);
  assert.equal(poll.normalizePollMinutes("7"), 30, "only the offered durations");
});

test("who wins: most votes; a tie goes to the one that stood first; no votes changes nothing", () => {
  assert.deepEqual(poll.decideStationPollWinner([0, 0, 0]), { kind: "none" });
  assert.deepEqual(poll.decideStationPollWinner([1, 4, 2]), { kind: "winner", index: 1 });
  assert.deepEqual(poll.decideStationPollWinner([3, 1, 3]), { kind: "tie", index: 0, tied: [0, 2] });
  assert.deepEqual(poll.decideStationPollWinner([]), { kind: "none" });

  const stations = [{ key: "a", name: "Alpha" }, { key: "b", name: "Beta" }, { key: "c", name: "Gamma" }];
  const tie = allText(poll.buildStationPollResultPayload({ t: de, outcome: { kind: "tie", index: 0, tied: [0, 2] }, stations, switched: true }));
  assert.match(tie, /Gleichstand zwischen \*\*Alpha\*\* und \*\*Gamma\*\* – \*\*Alpha\*\* gewinnt, weil er zuerst in der Umfrage stand\. 📻 Jetzt läuft \*\*Alpha\*\*/);
  assert.match(allText(poll.buildStationPollResultPayload({ t: de, outcome: { kind: "none" }, stations, currentName: "Beta" })), /Niemand hat abgestimmt – es bleibt bei \*\*Beta\*\*/);
  assert.match(allText(poll.buildStationPollResultPayload({ t: de, outcome: { kind: "winner", index: 1 }, stations })), /\*\*Beta\*\* läuft schon/);
  assert.match(allText(poll.buildStationPollResultPayload({ t: de, outcome: { kind: "winner", index: 1 }, stations, error: "offline" })), /Wechsel hat nicht geklappt[\s\S]*offline/);
});

test("/poll is 'umfrage' in German and follows /perm", () => {
  const command = buildCommandsJson().find((entry) => entry.name === "poll");
  assert.equal(command.name_localizations?.de, "umfrage");
  assert.deepEqual(command.options.map((option) => option.name), ["stations", "genre", "count", "duration"]);
});

// ---- the commander with one streaming worker ----

function buildCommander({ playing = FREE[0].key } = {}) {
  const plays = [];
  const worker = {
    remote: true,
    config: { name: "OmniFM 1" },
    guildState: new Map([[GUILD, { currentStationKey: playing, currentStationName: "Now", connection: { joinConfig: { channelId: VOICE } } }]]),
    clearScheduledEventPlaybackInGuild() {},
    playInGuild: async (...args) => { plays.push(args); return { ok: true, workerName: "OmniFM 1" }; },
  };
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "Commander" };
  runtime.role = "commander";
  runtime.resolveGuildLanguage = () => "de";
  runtime.resolveInteractionLanguage = () => "de";
  runtime.workerManager = {
    workers: [worker],
    getStreamingWorkers: () => (worker.guildState.get(GUILD)?.currentStationKey ? [worker] : []),
    findStreamingWorkerByChannel: () => worker,
    findConnectedWorkerByChannel: async () => worker,
    findFreeWorker: () => null,
    getInvitedWorkers: () => [worker],
  };
  return { runtime, worker, plays };
}

function command({ manager = true, stations = null, genre = null, duration = "5" } = {}) {
  const calls = [];
  return {
    calls,
    guildId: GUILD,
    channelId: TEXT,
    user: { id: "423456789012345678" },
    member: { roles: { cache: new Map() } },
    memberPermissions: { has: (bit) => manager && (bit === PermissionFlagsBits.ManageGuild || bit === PermissionFlagsBits.Administrator) },
    options: {
      getString: (name) => ({ stations, genre, duration }[name] ?? null),
      getInteger: () => null,
    },
    async reply(payload) { calls.push(["reply", payload]); },
    async fetchReply() { return { id: "523456789012345678", channelId: TEXT }; },
  };
}

test("only managers (or a /perm role) start a poll; one per server; not without a stream", async (t) => {
  store.resetStationPollsForTests();
  t.after(() => store.resetStationPollsForTests());
  const { runtime } = buildCommander();
  const replies = [];
  runtime.respondInteraction = async (_interaction, payload) => { replies.push(payload); };
  runtime.armStationPoll = () => {};

  await runtime.handleStationPollCommand(command({ manager: false, stations: `${FREE[1].name}, ${FREE[2].name}` }));
  assert.match(allText(replies.at(-1)), /Nur für Verwalter oder DJs/);

  const started = command({ stations: `${FREE[1].name}, ${FREE[2].name}` });
  await runtime.handleStationPollCommand(started);
  assert.equal(started.calls[0][0], "reply");
  assert.deepEqual(started.calls[0][1].poll.answers.map((answer) => answer.text), [FREE[1].name.slice(0, 55), FREE[2].name.slice(0, 55)]);
  const saved = await store.getActiveStationPoll(GUILD);
  assert.equal(saved.voiceChannelId, VOICE);
  assert.deepEqual(saved.stations.map((station) => station.key), [FREE[1].key, FREE[2].key]);

  await runtime.handleStationPollCommand(command({ stations: `${FREE[3].name}, ${FREE[4].name}` }));
  assert.match(allText(replies.at(-1)), /Es läuft schon eine Umfrage/);

  store.resetStationPollsForTests();
  const idle = buildCommander({ playing: null });
  idle.runtime.respondInteraction = runtime.respondInteraction;
  await idle.runtime.handleStationPollCommand(command({ genre: FREE[0].genre }));
  assert.match(allText(replies.at(-1)), /Gerade läuft nichts/);
});

async function finishWith(counts, { playing = FREE[0].key, deleted = false } = {}) {
  store.resetStationPollsForTests();
  const { runtime, plays } = buildCommander({ playing });
  const replies = [];
  let ended = false;
  const answers = new Map(counts.map((count, index) => [index + 1, { voteCount: count }]));
  const message = {
    poll: { resultsFinalized: false, answers, end: async () => { ended = true; } },
    reply: async (payload) => { replies.push(payload); },
  };
  const channel = {
    messages: {
      fetch: async () => {
        if (deleted) throw Object.assign(new Error("Unknown Message"), { code: 10008 });
        return message;
      },
    },
  };
  runtime.client = { channels: { cache: new Map([[TEXT, channel]]) } };
  await store.saveActiveStationPoll({
    guildId: GUILD, channelId: TEXT, messageId: "523456789012345678", voiceChannelId: VOICE,
    stations: FREE.slice(0, 3).map((station) => ({ key: station.key, name: station.name })), endsAt: Date.now(),
  });
  const result = await runtime.finishStationPoll(GUILD, { wait: async () => {} });
  return { result, plays, replies, ended, stillStored: await store.getActiveStationPoll(GUILD) };
}

test("the end: the winner plays and it is said; the poll is closed and forgotten", async () => {
  const { result, plays, replies, ended, stillStored } = await finishWith([1, 5, 2]);
  assert.equal(ended, true, "a short poll is ended by OmniFM");
  assert.equal(result.outcome.kind, "winner");
  assert.deepEqual(plays[0].slice(0, 3), [GUILD, VOICE, FREE[1].key]);
  assert.match(allText(replies[0]), new RegExp(`Jetzt läuft \\*\\*${FREE[1].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*`));
  assert.equal(stillStored, null);
});

test("a tie, no votes, the winner already on air and a deleted poll", async () => {
  const tie = await finishWith([3, 1, 3], { playing: FREE[1].key });
  assert.equal(tie.result.outcome.kind, "tie");
  assert.equal(tie.plays[0][2], FREE[0].key, "the one that stood first wins");
  assert.match(allText(tie.replies[0]), /Gleichstand/);

  const none = await finishWith([0, 0, 0]);
  assert.equal(none.plays.length, 0);
  assert.match(allText(none.replies[0]), /Niemand hat abgestimmt/);

  const same = await finishWith([0, 0, 4], { playing: FREE[2].key });
  assert.equal(same.plays.length, 0);
  assert.match(allText(same.replies[0]), /läuft schon/);

  const gone = await finishWith([2, 0, 0], { deleted: true });
  assert.deepEqual(gone.result.outcome, { kind: "deleted" });
  assert.equal(gone.plays.length, 0);
  assert.equal(gone.replies.length, 0);
  assert.equal(gone.stillStored, null);
});

test("after a restart the stored poll is armed again and evaluated on time", async (t) => {
  store.resetStationPollsForTests();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  await store.saveActiveStationPoll({
    guildId: GUILD, channelId: TEXT, messageId: "523456789012345678", voiceChannelId: VOICE,
    stations: FREE.slice(0, 2).map((station) => ({ key: station.key, name: station.name })), endsAt: 1_000_000 + 15 * 60_000,
  });
  const { runtime } = buildCommander();
  const finished = [];
  runtime.finishStationPoll = async (guildId) => { finished.push(guildId); };
  await runtime.restoreStationPolls();
  t.mock.timers.tick(15 * 60_000 - 1);
  assert.deepEqual(finished, []);
  t.mock.timers.tick(1);
  assert.deepEqual(finished, [GUILD]);
  store.resetStationPollsForTests();
});
