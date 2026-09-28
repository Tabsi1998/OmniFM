import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #303: the community suggests stations, the owner decides, the person who
// sent one hears about it. The queue lives in MongoDB; those parts skip
// without MONGO_URL.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-suggestions-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const { MAX_PENDING_PER_PERSON, readSuggestionInput, streamUrlKey, suggestionHealth } = await import("../src/lib/station-suggestions.js");
const { buildSuggestionAnswer, checkFromProbe } = await import("../src/services/station-suggestions.js");
const { SUGGESTION_FORM_ID } = await import("../src/bot/forms.js");
const { BotRuntime } = await import("../src/bot/runtime.js");

const created = [];
const createdStations = [];

after(async () => {
  if (hasMongoConfig) {
    const { getDb, isConnected, close } = await import("../src/lib/db.js");
    if (isConnected()) {
      await getDb().collection("station_suggestions").deleteMany({ _id: { $in: created } }).catch(() => null);
      await getDb().collection("stations").deleteMany({ key: { $in: createdStations } }).catch(() => null);
    }
    await close().catch(() => null);
  }
  fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 });
});

const random = () => Math.random().toString(36).slice(2, 10);
function snowflake() {
  return String(100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)));
}
// A public IP address: the owner's accept checks the URL without a DNS lookup.
const streamUrl = () => `http://8.8.8.8:8000/omnifm-suggest-${random()}.mp3`;

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  return out;
}
const allText = (payload) => (payload.components || []).flatMap((component) => texts(component)).join("\n");

async function mongo() {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  return getDb();
}

// ---- the rules ----

test("one key per stream: scheme, www, default port, trailing slash and host case do not count", () => {
  const key = streamUrlKey("http://radio.example/live");
  assert.equal(key, "radio.example/live");
  for (const same of ["HTTPS://www.Radio.example:443/live/", "http://radio.example:80/live", "https://RADIO.example/live//"]) {
    assert.equal(streamUrlKey(same), key, same);
  }
  assert.notEqual(streamUrlKey("http://radio.example:8000/live"), key, "another port is another stream");
  assert.notEqual(streamUrlKey("http://radio.example/live?mount=hq"), key, "another mount is another stream");
  assert.notEqual(streamUrlKey("http://radio.example/Live"), key, "the path keeps its case");
  for (const broken of ["", "kein link", "ftp://radio.example/live", "file:///etc/passwd", null]) {
    assert.equal(streamUrlKey(broken), "", String(broken));
  }
});

test("reading a suggestion: what is missing is named, the rest is trimmed", () => {
  assert.deepEqual(readSuggestionInput({ name: "x", url: "https://a.example/live" }), { error: "name" });
  assert.deepEqual(readSuggestionInput({ name: "Radio", url: "ftp://a.example/live" }), { error: "url" });
  assert.deepEqual(readSuggestionInput({ name: "Radio", url: "https://a.example/live", homepage: "http://a.example" }), { error: "homepage" });
  const { suggestion } = readSuggestionInput({
    name: "  Radio   Paradise  ", url: " https://www.a.example/live/ ", genre: "Rock", homepage: "https://a.example", note: "Läuft\n\nseit Jahren",
  });
  assert.deepEqual(suggestion, {
    name: "Radio Paradise", url: "https://www.a.example/live/", urlKey: "a.example/live", genre: "Rock", homepage: "https://a.example", note: "Läuft seit Jahren",
  });
  assert.equal(readSuggestionInput({ name: "R".repeat(90), url: "https://a.example/live" }).suggestion.name.length, 60);
});

test("stream health over 24 hours: older checks and broken dates do not count", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const hoursAgo = (hours) => new Date(now - hours * 3_600_000);
  assert.deepEqual(suggestionHealth([], now), { checks: 0, ok: 0, share: null });
  assert.deepEqual(suggestionHealth([
    { at: hoursAgo(1), ok: true },
    { at: hoursAgo(2).toISOString(), ok: true },
    { at: hoursAgo(3), ok: false },
    { at: hoursAgo(30), ok: false },
    { at: "gestern", ok: false },
  ], now), { checks: 3, ok: 2, share: 67 });
});

test("a probe as the queue keeps it; the answer to the person in their language", () => {
  assert.deepEqual(checkFromProbe({ ok: true, isAudioStream: true, bitrate: "128", latencyMs: 210 }), { ok: true, audio: true, bitrate: 128, latencyMs: 210, error: "" });
  assert.deepEqual(checkFromProbe({ ok: false, status: 404 }), { ok: false, audio: false, bitrate: null, latencyMs: null, error: "HTTP 404" });
  assert.equal(checkFromProbe({ ok: false, message: "timeout" }).error, "timeout");
  assert.equal(checkFromProbe({}).error, "no answer");

  const accepted = allText(buildSuggestionAnswer({ name: "Groove FM", status: "accepted", stationKey: "groove-fm", submitter: { language: "de" } }));
  assert.match(accepted, /Groove FM/);
  assert.match(accepted, /im Katalog/);
  assert.match(accepted, /groove-fm/);
  const rejected = allText(buildSuggestionAnswer({ name: "Groove FM", status: "rejected", decisionNote: "Der Stream bricht oft ab.", submitter: { language: "en" } }));
  assert.match(rejected, /does not go into the catalogue/);
  assert.match(rejected, /Reason: Der Stream bricht oft ab\./);
  assert.doesNotMatch(allText(buildSuggestionAnswer({ name: "Groove FM", status: "rejected", submitter: { language: "en" } })), /Reason/);
});

// ---- /suggest-station in Discord ----

function commander() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-commander", name: "OmniFM DJ" };
  runtime.role = "commander";
  runtime.resolveInteractionLanguage = () => "de";
  runtime.resolveGuildLanguage = () => "de";
  return runtime;
}

function submission(text, userId = snowflake()) {
  const calls = [];
  const interaction = {
    calls,
    customId: SUGGESTION_FORM_ID,
    fields: { getTextInputValue: (id) => text[id] ?? "" },
    guildId: snowflake(),
    user: { id: userId, username: "hoererin", globalName: "Hörerin" },
    deferred: false,
    replied: false,
    isModalSubmit: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    async reply(payload) { interaction.replied = true; calls.push(["reply", payload]); },
    async deferReply(options) { interaction.deferred = true; calls.push(["deferReply", options]); },
    async editReply(payload) { calls.push(["editReply", payload]); },
    async followUp(payload) { calls.push(["followUp", payload]); },
    async showModal(modal) { calls.push(["modal", modal]); },
  };
  return interaction;
}
const answer = (interaction) => allText(interaction.calls.filter(([kind]) => kind !== "deferReply").at(-1)[1]);

test("the form opens, and a link without a stream saves nothing", async () => {
  const runtime = commander();
  const open = submission({});
  await runtime.openSuggestionForm(open);
  assert.equal(open.calls[0][0], "modal");
  assert.equal(open.calls[0][1].toJSON().custom_id, SUGGESTION_FORM_ID);

  // Through the form router, with a link that is no URL at all: no request goes out.
  const broken = submission({ name: "Radio", url: "kein link" });
  await runtime.handleFormSubmit(broken);
  assert.equal(broken.calls[0][0], "deferReply", "acknowledged before the test");
  assert.match(answer(broken), /Kein Stream gefunden/);
  assert.match(answer(broken), /Nichts gespeichert/);

  const silent = submission({ name: "Radio", url: streamUrl() });
  await runtime.handleSuggestionFormSubmit(silent, { testStream: async () => ({ ok: false, message: "HTTP 404" }) });
  assert.match(answer(silent), /HTTP 404/);
});

test("a live stream goes into the queue; the same stream again and a fourth one per person do not", { skip: !hasMongoConfig }, async () => {
  const db = await mongo();
  const runtime = commander();
  const person = snowflake();
  const url = streamUrl();
  const live = async () => ({ ok: true, isAudioStream: true, bitrate: "192", latencyMs: 120 });

  const first = submission({ name: "Groove FM", url, genre: "Chill", note: "Läuft bei uns jeden Abend" }, person);
  await runtime.handleSuggestionFormSubmit(first, { testStream: live });
  assert.match(answer(first), /Danke für den Vorschlag/);
  const stored = await db.collection("station_suggestions").findOne({ url });
  assert.ok(stored);
  created.push(stored._id);
  assert.equal(stored.status, "pending");
  assert.deepEqual(stored.submitter, { userId: person, userName: "Hörerin", guildId: first.guildId, language: "de" });
  assert.equal(stored.checks.length, 1, "the test at submit time counts as the first check");
  assert.equal(stored.checks[0].bitrate, 192);

  // Someone else with the same stream, written differently.
  const again = submission({ name: "Groove", url: url.replace("http://", "HTTPS://").replace(".mp3", ".mp3/") }, snowflake());
  await runtime.handleSuggestionFormSubmit(again, { testStream: live });
  assert.match(answer(again), /schon jemand vorgeschlagen/);

  for (let index = 0; index < MAX_PENDING_PER_PERSON - 1; index += 1) {
    const more = submission({ name: `Radio ${index}`, url: streamUrl() }, person);
    // eslint-disable-next-line no-await-in-loop -- one after the other, like a person
    await runtime.handleSuggestionFormSubmit(more, { testStream: live });
    // eslint-disable-next-line no-await-in-loop
    created.push(...(await db.collection("station_suggestions").find({ "submitter.userId": person }).toArray()).map((doc) => doc._id));
  }
  const tooMany = submission({ name: "Radio zu viel", url: streamUrl() }, person);
  await runtime.handleSuggestionFormSubmit(tooMany, { testStream: live });
  assert.match(answer(tooMany), new RegExp(`schon ${MAX_PENDING_PER_PERSON} Vorschläge`));
  assert.equal(await db.collection("station_suggestions").countDocuments({ "submitter.userId": person }), MAX_PENDING_PER_PERSON);
});

test("a stream already in the catalogue is named instead of queued", { skip: !hasMongoConfig }, async () => {
  await mongo();
  const { createStationSuggestion } = await import("../src/station-suggestions-store.js");
  const catalog = { known: { name: "Known FM", url: "https://www.known.example/live/" } };
  assert.deepEqual(await createStationSuggestion({ name: "Known", url: "http://known.example/live" }, { userId: snowflake() }, { catalog }), { error: "in-catalog", station: "Known FM" });
  assert.deepEqual(await createStationSuggestion({ name: "Known", url: "nope" }, {}, { catalog }), { error: "url" });
});

// ---- the owner decides ----

function routes() {
  const audits = [];
  return import("../src/api/routes/admin-suggestion-routes.js").then(({ createAdminSuggestionRoutes }) => {
    const handle = createAdminSuggestionRoutes({
      sendJson: (res, status, payload) => Object.assign(res, { status, payload }),
      methodNotAllowed: (res) => Object.assign(res, { status: 405 }),
      auditOwnerAction: (req, entry) => audits.push(entry),
      readRequestBody: async (req) => JSON.stringify(req.body || {}),
    });
    const call = async (method, pathname, body) => {
      const res = {};
      const handled = await handle({ req: { method, body, ownerIdentity: { actor: "Olli Owner" } }, res, requestUrl: new URL(`http://127.0.0.1${pathname}`) });
      return { handled, ...res };
    };
    return { call, audits };
  });
}

test("owner console: accept takes the station into the catalogue, reject tells why, both only once", { skip: !hasMongoConfig }, async () => {
  const db = await mongo();
  const { createStationSuggestion, suggestionsToNotify } = await import("../src/station-suggestions-store.js");
  const { call, audits } = await routes();
  const person = snowflake();
  const one = await createStationSuggestion({ name: "Groove FM", url: streamUrl(), genre: "Chill" }, { userId: person, userName: "Hörerin", language: "en" });
  const two = await createStationSuggestion({ name: "Talk FM", url: streamUrl() }, { userId: person, userName: "Hörerin" });
  created.push(one.suggestion._id, two.suggestion._id);

  assert.equal((await call("GET", "/api/other")).handled, false);
  const list = await call("GET", "/api/admin/station-suggestions");
  const view = list.payload.suggestions.find((row) => row.id === one.suggestion._id);
  assert.equal(view.from, "Hörerin");
  assert.equal(view.status, "pending");
  assert.ok(!JSON.stringify(list.payload).includes(person), "the owner console never sees the Discord ID");
  assert.equal((await call("DELETE", "/api/admin/station-suggestions")).status, 405);

  const key = `test-suggest-${random()}`;
  createdStations.push(key);
  const accepted = await call("POST", `/api/admin/station-suggestions/${one.suggestion._id}/accept`, { key, tier: "free", color: "14b8a6" });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
  const station = await db.collection("stations").findOne({ key });
  assert.equal(station.name, "Groove FM");
  assert.equal(station.genre, "Chill");
  assert.equal(station.color, "#14B8A6");
  assert.equal(station.is_default, false);
  const decided = await db.collection("station_suggestions").findOne({ _id: one.suggestion._id });
  assert.equal(decided.status, "accepted");
  assert.equal(decided.stationKey, key);
  assert.equal(decided.decidedBy, "Olli Owner");
  assert.ok(decided.expiresAt instanceof Date, "a decided suggestion goes after 180 days");
  assert.deepEqual(decided.notify, { pending: true });
  assert.equal(audits.at(-1).action, "suggestion.accept");

  assert.equal((await call("POST", `/api/admin/station-suggestions/${one.suggestion._id}/accept`, { key: `${key}-2` })).status, 409, "decided is decided");
  assert.equal((await call("POST", "/api/admin/station-suggestions/0123456789abcdef/reject", {})).status, 404);
  const taken = await call("POST", `/api/admin/station-suggestions/${two.suggestion._id}/accept`, { key });
  assert.equal(taken.status, 409);
  assert.match(taken.payload.error, /gibt es im Katalog schon/);
  const badKey = await call("POST", `/api/admin/station-suggestions/${two.suggestion._id}/accept`, { key: "!" });
  assert.equal(badKey.status, 400);

  const rejected = await call("POST", `/api/admin/station-suggestions/${two.suggestion._id}/reject`, { note: "Nur Werbung." });
  assert.equal(rejected.status, 200);
  const turnedDown = await db.collection("station_suggestions").findOne({ _id: two.suggestion._id });
  assert.equal(turnedDown.status, "rejected");
  assert.equal(turnedDown.decisionNote, "Nur Werbung.");
  assert.equal(turnedDown.stationKey, null);
  assert.equal(audits.at(-1).action, "suggestion.reject");
  assert.equal(await db.collection("stations").countDocuments({ key: `${key}-2` }), 0);

  const queued = (await suggestionsToNotify({ limit: 500 })).map((doc) => doc._id);
  assert.ok(queued.includes(one.suggestion._id) && queued.includes(two.suggestion._id));
});

test("the commander checks pending streams and answers each person once", { skip: !hasMongoConfig }, async () => {
  const db = await mongo();
  const { createStationSuggestion, decideStationSuggestion, forgetStationSuggestionSubmitter } = await import("../src/station-suggestions-store.js");
  const { checkPendingSuggestions, sendSuggestionAnswers } = await import("../src/services/station-suggestions.js");
  const reachable = snowflake();
  const closed = snowflake();
  const gone = snowflake();
  const url = streamUrl();
  const pending = await createStationSuggestion({ name: "Check FM", url }, { userId: reachable, userName: "a" });
  const toReachable = await createStationSuggestion({ name: "Yes FM", url: streamUrl() }, { userId: reachable, userName: "a", language: "en" });
  const toClosed = await createStationSuggestion({ name: "No FM", url: streamUrl() }, { userId: closed, userName: "b" });
  const toGone = await createStationSuggestion({ name: "Gone FM", url: streamUrl() }, { userId: gone, userName: "c" });
  created.push(pending.suggestion._id, toReachable.suggestion._id, toClosed.suggestion._id, toGone.suggestion._id);

  const probed = [];
  await checkPendingSuggestions({ probe: async (target) => { probed.push(target); return target === url ? { ok: true, isAudioStream: true } : { ok: false, status: 503 }; } });
  assert.ok(probed.includes(url));
  const checked = await db.collection("station_suggestions").findOne({ _id: pending.suggestion._id });
  assert.equal(checked.checks.at(-1).ok, true);

  await decideStationSuggestion(toReachable.suggestion._id, { status: "accepted", stationKey: "yes-fm" });
  await decideStationSuggestion(toClosed.suggestion._id, { status: "rejected", note: "Kein Stream." });
  await decideStationSuggestion(toGone.suggestion._id, { status: "rejected" });
  // The person deleted their data in between: nobody to tell, nothing to send.
  assert.equal(await forgetStationSuggestionSubmitter(gone), 1);

  const sent = [];
  const runtime = {
    client: {
      users: {
        fetch: async (id) => ({
          send: async (payload) => {
            if (id === closed) throw new Error("Cannot send messages to this user");
            sent.push([id, allText(payload)]);
          },
        }),
      },
    },
  };
  await sendSuggestionAnswers(runtime);
  const mine = sent.filter(([id]) => [reachable, closed, gone].includes(id));
  assert.equal(mine.length, 1);
  assert.equal(mine[0][0], reachable);
  assert.match(mine[0][1], /Yes FM/);
  assert.match(mine[0][1], /is now on OmniFM/);
  const byId = async (id) => db.collection("station_suggestions").findOne({ _id: id });
  assert.equal((await byId(toReachable.suggestion._id)).notify.delivered, true);
  assert.equal((await byId(toClosed.suggestion._id)).notify.delivered, false, "a closed DM is marked, not tried again");
  assert.equal((await byId(toGone.suggestion._id)).notify, undefined);

  sent.length = 0;
  await sendSuggestionAnswers(runtime);
  assert.equal(sent.filter(([id]) => [reachable, closed, gone].includes(id)).length, 0, "once only");
});
