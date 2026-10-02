import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioPlayerStatus } from "@discordjs/voice";

// The servers' jingles (#309, Ultimate): uploaded in the dashboard, brought
// to one loudness by ffmpeg, kept as PCM and mixed over the music when
// someone switches the station, on the full hour, or from the dashboard's
// button. The stored parts skip without MONGO_URL.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-jingles-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.OMNIFM_OWNER_AUDIT_FILE = path.join(scratchDir, "owner-audit.json");
process.env.DB_NAME = `omnifm_jingles_${process.pid}_${Date.now()}`;
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const audio = await import("../src/lib/jingle-audio.js");
const { JingleMixer } = await import("../src/lib/jingle-mixer.js");
const { prepareJingle } = await import("../src/services/jingle-processing.js");
const { createDashboardJingleRouteHandler, createJingleUploadLimiter } = await import("../src/api/routes/dashboard-jingle.js");
const { sendJson, methodNotAllowed } = await import("../src/lib/api-helpers.js");
const { setLicenseProvider, serverHasCapability } = await import("../src/core/entitlements.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { WorkerBridgeService } = await import("../src/bot/worker-bridge-service.js");

const GUILD = "123456789012345678";
let plan = "ultimate";
setLicenseProvider((serverId) => (String(serverId) === GUILD ? { plan, active: true, seats: 1 } : null));

after(async () => {
  if (hasMongoConfig) {
    const { getDb, isConnected, close } = await import("../src/lib/db.js");
    if (isConnected()) await getDb().dropDatabase().catch(() => null);
    await close().catch(() => null);
  }
  fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 });
});

/** Stereo PCM of `ms` milliseconds with every sample at `value`. */
function pcmOf(ms, value = 1000) {
  const buffer = Buffer.alloc(Math.round((ms / 1000) * 48_000) * 4);
  for (let index = 0; index < buffer.length / 2; index += 1) buffer.writeInt16LE(value, index * 2);
  return buffer;
}

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]);

// ---- the pure part ----

test("a jingle file is known by its first bytes, not by its name", () => {
  const head = (text, rest = 12) => Buffer.concat([Buffer.from(text, "latin1"), Buffer.alloc(rest)]);
  assert.equal(audio.sniffAudioFormat(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(4)])), "wav");
  assert.equal(audio.sniffAudioFormat(head("OggS")), "ogg");
  assert.equal(audio.sniffAudioFormat(head("fLaC")), "flac");
  assert.equal(audio.sniffAudioFormat(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(4)])), "mov");
  assert.equal(audio.sniffAudioFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.alloc(12)])), "matroska");
  assert.equal(audio.sniffAudioFormat(MP3), "mp3");
  assert.equal(audio.sniffAudioFormat(Buffer.from([0xff, 0xfb, 0x90, 0x64, ...Buffer.alloc(12)])), "mp3", "an MPEG frame without a tag");
  assert.equal(audio.sniffAudioFormat(Buffer.from([0xff, 0xf1, 0x50, 0x80, ...Buffer.alloc(12)])), null, "AAC in ADTS is not taken");
  assert.equal(audio.sniffAudioFormat(head("#EXTM3U\n")), null, "a playlist never reaches ffmpeg");
  assert.equal(audio.sniffAudioFormat(head("<svg")), null);
  assert.equal(audio.sniffAudioFormat(Buffer.from("RIFF")), null, "too short");
});

test("the upload arrives as a data URL or base64, within 6 MB", () => {
  const file = Buffer.from("OggS-and-more");
  assert.deepEqual(audio.decodeUpload(`data:audio/ogg;base64,${file.toString("base64")}`), { ok: true, file });
  assert.deepEqual(audio.decodeUpload(file.toString("base64")), { ok: true, file });
  assert.equal(audio.decodeUpload("").error, "empty");
  assert.equal(audio.decodeUpload("data:audio/ogg;base64,@@@").error, "invalid");
  assert.equal(audio.decodeUpload(Buffer.alloc(30).toString("base64"), { maxBytes: 20 }).error, "size");
  assert.equal(audio.cleanJingleName("C:\\Users\\me\\Station ID.mp3"), "Station ID.mp3");
  assert.equal(audio.cleanJingleName("../../etc/passwd"), "passwd");
  assert.equal(audio.cleanJingleName("a\u0000b\nc"), "abc");
  assert.equal(audio.cleanJingleName("x".repeat(200)).length, audio.JINGLE_NAME_MAX);
  assert.equal(audio.cleanJingleName(""), "Jingle");
});

test("the stored PCM plays in the dashboard as a WAV of the same length", () => {
  const pcm = pcmOf(500, 7);
  const wav = audio.wavFromPcm(pcm);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("latin1", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.toString("latin1", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt16LE(20), 1, "PCM");
  assert.equal(wav.readUInt16LE(22), 2, "stereo");
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt32LE(28), 192_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(audio.pcmDurationMs(pcm), 500);
});

test("the switches: on a station switch unless turned off, on the hour only when turned on", () => {
  assert.deepEqual(audio.normalizeJingleSettings(undefined), { onSwitch: true, onHour: false });
  assert.deepEqual(audio.normalizeJingleSettings({ onSwitch: false, onHour: true }), { onSwitch: false, onHour: true });
  assert.deepEqual(audio.normalizeJingleSettings({ onHour: "yes" }), { onSwitch: true, onHour: false });
});

test("the full hour in the server's time zone, during its first minute only", () => {
  const at = (iso, zone) => audio.fullHourKey(new Date(iso), zone);
  assert.equal(at("2026-10-02T12:00:20Z", "Europe/Vienna"), "2026-10-02T14", "summer time: UTC+2");
  assert.equal(at("2026-12-02T13:00:59Z", "Europe/Vienna"), "2026-12-02T14", "winter time: UTC+1");
  assert.equal(at("2026-10-02T12:01:00Z", "Europe/Vienna"), null, "one minute later");
  assert.equal(at("2026-10-02T12:30:05Z", "Asia/Kolkata"), "2026-10-02T18", "UTC+5:30");
  assert.equal(at("2026-10-02T12:00:05Z", "Asia/Kolkata"), null, "half past in India");
  assert.equal(at("2026-10-02T12:00:05Z", "Not/AZone"), "2026-10-02T14", "an unknown zone counts as Vienna");
  // 25 October 2026: 03:00 summer time becomes 02:00 again; the hour that comes twice plays once.
  assert.equal(at("2026-10-25T00:00:10Z", "Europe/Vienna"), "2026-10-25T02");
  assert.equal(at("2026-10-25T01:00:10Z", "Europe/Vienna"), "2026-10-25T02");
  assert.equal(audio.mayBeFullHourSomewhere(new Date("2026-10-02T12:45:30Z")), true, "Nepal's full hour");
  assert.equal(audio.mayBeFullHourSomewhere(new Date("2026-10-02T12:07:00Z")), false);
});

test("loudnorm's numbers: read from the end of ffmpeg's output; silence reads as not audible", () => {
  const output = `[Parsed_loudnorm_0 @ 0x55] \n{\n\t"input_i" : "-23.52",\n\t"input_tp" : "-5.67",\n\t"input_lra" : "6.20",\n\t"input_thresh" : "-33.85",\n\t"output_i" : "-14.21",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "0.21"\n}\n`;
  const stats = audio.parseLoudnormStats(`size=N/A {not json}\n${output}`);
  assert.deepEqual(stats, { inputI: -23.52, inputTp: -5.67, inputLra: 6.2, inputThresh: -33.85, targetOffset: 0.21 });
  assert.equal(audio.isAudible(stats), true);
  assert.equal(audio.isAudible(audio.parseLoudnormStats(output.replace("-23.52", "-inf"))), false);
  assert.equal(audio.isAudible(audio.parseLoudnormStats(output.replace("-23.52", "-75.00"))), false);
  assert.equal(audio.parseLoudnormStats("no numbers"), null);
  assert.equal(audio.loudnormFilter(), "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json");
  assert.equal(
    audio.loudnormFilter(stats),
    "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-23.52:measured_TP=-5.67:measured_LRA=6.20:measured_thresh=-33.85:offset=0.21:linear=true:print_format=summary",
  );
});

// ---- ffmpeg ----

const LOUDNORM_OUTPUT = '{\n "input_i" : "-20.00",\n "input_tp" : "-3.00",\n "input_lra" : "5.00",\n "input_thresh" : "-30.00",\n "target_offset" : "0.10"\n}';

function fakeFfmpeg({ decodedMs = 4000, measure = LOUDNORM_OUTPUT, decodeCode = 0 } = {}) {
  const calls = [];
  const run = async (args, input) => {
    calls.push({ args, input });
    if (calls.length === 1) return { code: decodeCode, stdout: decodeCode ? Buffer.alloc(0) : pcmOf(decodedMs), stderr: "" };
    if (calls.length === 2) return { code: 0, stdout: Buffer.alloc(0), stderr: measure };
    return { code: 0, stdout: Buffer.concat([pcmOf(decodedMs, 3000), Buffer.from([1, 2])]), stderr: "" };
  };
  return { calls, run };
}

test("ffmpeg reads the file once, with its own demuxer and nothing but its input; two passes bring it to -14 LUFS", async () => {
  const { calls, run } = fakeFfmpeg({ decodedMs: 4000 });
  const prepared = await prepareJingle(MP3, { run });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.durationMs, 4000);
  assert.equal(prepared.pcm.length % 4, 0, "whole stereo frames only");
  assert.equal(calls.length, 3);

  const [decode, measure, apply] = calls;
  assert.equal(decode.input, MP3, "only the first run sees the upload");
  const pairs = (args) => args.map((arg, index) => `${arg} ${args[index + 1]}`);
  assert.ok(pairs(decode.args).includes("-protocol_whitelist pipe"), "no other files or URLs");
  assert.ok(pairs(decode.args).includes("-f mp3"), "the demuxer of the first bytes, no probing");
  assert.ok(decode.args.indexOf("-f") < decode.args.indexOf("-i"), "forced for the input");
  assert.ok(pairs(decode.args).includes("-t 10.5"), "decoding stops after the limit");
  assert.equal(measure.input.length, pcmOf(4000).length, "the measuring gets the decoded PCM, not the file");
  assert.equal(apply.input, measure.input);
  assert.ok(measure.args.includes("loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json"));
  assert.ok(pairs(measure.args).includes("-f s16le"), "the measuring reads the decoded PCM");
  const filters = apply.args[apply.args.indexOf("-af") + 1];
  assert.match(filters, /measured_I=-20\.00:measured_TP=-3\.00:measured_LRA=5\.00:measured_thresh=-30\.00:offset=0\.10:linear=true/);
  assert.match(filters, /afade=t=in:st=0:d=0\.02,afade=t=out:st=3\.980:d=0\.02$/);
});

test("too long, too short, silent, unreadable or of an unknown kind: refused, with nothing more run", async () => {
  const long = fakeFfmpeg({ decodedMs: 10_500 });
  assert.deepEqual(await prepareJingle(MP3, { run: long.run }), { ok: false, error: "too-long" });
  assert.equal(long.calls.length, 1);
  assert.equal((await prepareJingle(MP3, { run: fakeFfmpeg({ decodedMs: 10_200 }).run })).ok, true, "a codec's few ms over 10 s are fine");
  assert.deepEqual(await prepareJingle(MP3, { run: fakeFfmpeg({ decodedMs: 300 }).run }), { ok: false, error: "too-short" });
  assert.deepEqual(await prepareJingle(MP3, { run: fakeFfmpeg({ measure: LOUDNORM_OUTPUT.replace("-20.00", "-inf") }).run }), { ok: false, error: "silent" });
  assert.deepEqual(await prepareJingle(MP3, { run: fakeFfmpeg({ decodeCode: 1 }).run }), { ok: false, error: "unreadable" });
  const unknown = fakeFfmpeg();
  assert.deepEqual(await prepareJingle(Buffer.from("#EXTM3U\nhttp://example.test/a.mp3\n"), { run: unknown.run }), { ok: false, error: "format" });
  assert.equal(unknown.calls.length, 0, "ffmpeg never sees it");
});

test("at most two uploads are worked on at once", async () => {
  const waiting = [];
  const run = (args) => new Promise((resolve) => waiting.push(() => resolve(args.includes("pipe:1")
    ? { code: 0, stdout: pcmOf(1000), stderr: "" }
    : { code: 0, stdout: Buffer.alloc(0), stderr: LOUDNORM_OUTPUT })));
  const first = prepareJingle(MP3, { run });
  const second = prepareJingle(MP3, { run });
  assert.deepEqual(await prepareJingle(MP3, { run }), { ok: false, error: "busy" });
  while (waiting.length) {
    waiting.shift()();
    // eslint-disable-next-line no-await-in-loop -- let the next run start
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
});

// ---- the dashboard ----

function jingleRoute({ bots = [], prepare, limiter } = {}) {
  const stored = { jingle: null, settings: {} };
  const audits = [];
  const invalidated = [];
  const handle = createDashboardJingleRouteHandler({
    getDashboardRequestTranslator: () => ({ language: "de" }),
    getDashboardSession: (req) => ({ session: req.headers.anonymous ? null : { user: { id: "user-7" } } }),
    getLocalizedJsonBodyError: () => "bad body",
    languagePick: (language, de) => de,
    methodNotAllowed,
    resolveDashboardGuildForSession: () => ({ id: GUILD }),
    sendJson,
    sendLocalizedError: (res, status, language, de) => sendJson(res, status, { error: de }),
    serverHasCapability,
    store: {
      save: async (guildId, jingle, { now = 1_700_000_000_000 } = {}) => {
        stored.jingle = { ...jingle, updatedAt: now };
        return { ok: true, info: { name: jingle.name, durationMs: jingle.durationMs, bytes: jingle.pcm.length, updatedAt: now } };
      },
      info: async () => (stored.jingle ? { name: stored.jingle.name, durationMs: stored.jingle.durationMs, bytes: stored.jingle.pcm.length, updatedAt: stored.jingle.updatedAt } : null),
      pcm: async () => (stored.jingle ? { pcm: stored.jingle.pcm, updatedAt: stored.jingle.updatedAt } : null),
      remove: async () => {
        const had = Boolean(stored.jingle);
        stored.jingle = null;
        return had;
      },
    },
    prepare: prepare || (async () => ({ ok: true, pcm: pcmOf(2500), durationMs: 2500 })),
    loadSettings: async () => stored.settings,
    saveSettings: async (guildId, settings) => {
      stored.settings = { ...stored.settings, jingle: settings };
      return true;
    },
    audit: (entry) => audits.push(entry),
    limiter: limiter || createJingleUploadLimiter(),
    findBots: async () => bots,
  });
  const call = async (method, pathname, { body, headers = {} } = {}) => {
    const res = {
      status: 0, headers: {}, raw: null, body: null,
      writeHead(status, head = {}) { this.status = status; Object.assign(this.headers, head); },
      setHeader(name, value) { this.headers[name] = value; },
      end(payload) {
        this.raw = payload ?? null;
        const type = String(this.headers["Content-Type"] || "");
        this.body = payload && type.includes("json") ? JSON.parse(payload) : null;
      },
    };
    const handled = await handle({
      req: { method, headers },
      res,
      requestUrl: new URL(`http://localhost${pathname}?serverId=${GUILD}`),
      readJsonBody: async () => body,
      runtimes: [{ invalidateGuildSettingsCache: (guildId) => invalidated.push(guildId) }],
    });
    return { handled, ...res };
  };
  return { call, stored, audits, invalidated };
}

test("the dashboard: Ultimate uploads, Pro sees the lock; every change is in the owner audit", async () => {
  const { call, stored, audits } = jingleRoute();
  assert.equal((await call("GET", "/api/dashboard/other")).handled, false);
  assert.equal((await call("GET", "/api/dashboard/jingle", { headers: { anonymous: "1" } })).status, 401);

  plan = "pro";
  const locked = await call("GET", "/api/dashboard/jingle");
  assert.equal(locked.status, 200);
  assert.deepEqual(locked.body, {
    serverId: GUILD,
    available: false,
    limits: { maxMs: 10_000, fileBytes: 6 * 1024 * 1024 },
    jingle: null,
    settings: { onSwitch: true, onHour: false },
  });
  const refused = await call("PUT", "/api/dashboard/jingle", { body: { name: "id.mp3", data: MP3.toString("base64") } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "Eigene Jingles gibt es mit Ultimate.");

  plan = "ultimate";
  const uploaded = await call("PUT", "/api/dashboard/jingle", { body: { name: "C:\\fakepath\\Station ID.mp3", data: `data:audio/mpeg;base64,${MP3.toString("base64")}` } });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.available, true);
  assert.deepEqual(uploaded.body.jingle, { name: "Station ID.mp3", durationMs: 2500, bytes: pcmOf(2500).length, updatedAt: 1_700_000_000_000 });
  assert.equal(audits.at(-1).action, "guild.jingle.upload");
  assert.equal(audits.at(-1).actor, "dashboard:user-7");
  assert.equal(audits.at(-1).summary, "Jingle hochgeladen: Station ID.mp3 (2,5 s)");

  // A downgrade keeps the jingle to listen to and to delete.
  plan = "pro";
  const listened = await call("GET", "/api/dashboard/jingle/audio");
  assert.equal(listened.status, 200);
  assert.equal(listened.headers["Content-Type"], "audio/wav");
  assert.equal(listened.raw.length, 44 + stored.jingle.pcm.length);
  const deleted = await call("DELETE", "/api/dashboard/jingle");
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.jingle, null);
  assert.equal(audits.at(-1).action, "guild.jingle.delete");
  assert.equal((await call("GET", "/api/dashboard/jingle/audio")).status, 404);
  plan = "ultimate";
});

test("the dashboard says what is wrong with a file, and allows ten uploads an hour", async () => {
  const errors = ["format", "too-long", "silent", "busy"];
  const { call } = jingleRoute({
    prepare: async () => ({ ok: false, error: errors.shift() }),
    limiter: createJingleUploadLimiter({ limit: 5, now: () => 0 }),
  });
  const upload = (data = MP3.toString("base64")) => call("PUT", "/api/dashboard/jingle", { body: { name: "x", data } });
  assert.equal((await upload()).body.error, "Erlaubt sind MP3, WAV, OGG/Opus, FLAC, M4A und WebM.");
  assert.equal((await upload()).body.error, "Der Jingle darf höchstens 10 Sekunden lang sein.");
  assert.equal((await upload()).body.error, "In der Datei ist nichts zu hören.");
  const busy = await upload();
  assert.equal(busy.status, 503);
  const empty = await upload("");
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, "Es kam keine Datei an.");
  const tooMany = await upload();
  assert.equal(tooMany.status, 429);
  assert.match(tooMany.body.error, /in 60 Minuten/);
});

test("the switches are saved for the server, its bots read them anew", async () => {
  const { call, stored, audits, invalidated } = jingleRoute();
  const saved = await call("PUT", "/api/dashboard/jingle/settings", { body: { onHour: true } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.settings, { onSwitch: true, onHour: true });
  assert.deepEqual(stored.settings.jingle, { onSwitch: true, onHour: true });
  assert.deepEqual(invalidated, [GUILD]);
  assert.equal(audits.at(-1).summary, "Jingle: Senderwechsel an, volle Stunde an");
  await call("PUT", "/api/dashboard/jingle/settings", { body: { onSwitch: false, onHour: "no" } });
  assert.deepEqual(stored.settings.jingle, { onSwitch: false, onHour: true }, "only real switches change");
  assert.equal((await call("GET", "/api/dashboard/jingle/settings")).status, 405);
});

test("listening in: the whole WAV or the part a browser asks for", async () => {
  const { call } = jingleRoute();
  await call("PUT", "/api/dashboard/jingle", { body: { name: "id.mp3", data: MP3.toString("base64") } });
  const size = 44 + pcmOf(2500).length;
  const part = await call("GET", "/api/dashboard/jingle/audio", { headers: { range: "bytes=0-1" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers["Content-Range"], `bytes 0-1/${size}`);
  assert.equal(part.raw.toString("latin1"), "RI");
  const tail = await call("GET", "/api/dashboard/jingle/audio", { headers: { range: "bytes=-4" } });
  assert.equal(tail.headers["Content-Range"], `bytes ${size - 4}-${size - 1}/${size}`);
  const beyond = await call("GET", "/api/dashboard/jingle/audio", { headers: { range: `bytes=${size}-` } });
  assert.equal(beyond.status, 416);
  const whole = await call("GET", "/api/dashboard/jingle/audio");
  assert.equal(whole.headers["Accept-Ranges"], "bytes");
  assert.equal(whole.headers["Cache-Control"], "private, no-store");
});

test("the button plays the jingle on every bot that plays on the server", async () => {
  const played = [];
  const bot = (name, answer) => ({ playJingleFromDashboard: async (guildId) => { played.push([name, guildId]); return answer; } });
  assert.equal((await jingleRoute().call("POST", "/api/dashboard/jingle/play")).status, 409, "nothing plays");
  const both = await jingleRoute({ bots: [bot("one", { ok: true }), bot("two", { ok: true })] }).call("POST", "/api/dashboard/jingle/play");
  assert.deepEqual(both.body, { ok: true, played: 2 });
  assert.deepEqual(played, [["one", GUILD], ["two", GUILD]]);
  const none = await jingleRoute({ bots: [bot("one", { ok: false, error: "none" })] }).call("POST", "/api/dashboard/jingle/play");
  assert.equal(none.status, 404);
  const paused = await jingleRoute({ bots: [bot("one", { ok: false, error: "paused" })] }).call("POST", "/api/dashboard/jingle/play");
  assert.equal(paused.body.error, "Die Wiedergabe ist gerade pausiert.");
  plan = "free";
  assert.equal((await jingleRoute({ bots: [bot("one", { ok: true })] }).call("POST", "/api/dashboard/jingle/play")).status, 403);
  plan = "ultimate";
});

test("split mode: the button reaches the worker process through the bridge", async () => {
  const calls = [];
  const service = new WorkerBridgeService({ config: { id: "w" }, playJingleFromDashboard: async (guildId) => { calls.push(guildId); return { ok: true }; } },
    { bridge: {}, doorbell: { isDoorbellConnected: () => false, onDoorbell: () => () => {} } });
  assert.deepEqual(await service.executeCommand({ type: "playJingle", payload: { guildId: GUILD } }), { ok: true });
  assert.deepEqual(calls, [GUILD]);
});

// ---- the bot ----

function playingRuntime({ settings = { jingle: { onSwitch: true, onHour: true } }, samples = new Int16Array(960).fill(500), status = AudioPlayerStatus.Playing } = {}) {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM 1" };
  runtime.guildState = new Map();
  runtime.jingleCache = new Map();
  runtime.jingleClockTimer = null;
  runtime.loadGuildSettingsCached = async () => settings;
  runtime.loadGuildJingleSamples = async () => samples;
  const mixer = new JingleMixer();
  const plays = [];
  const play = mixer.play.bind(mixer);
  mixer.play = (jingle, options) => {
    plays.push(options);
    return play(jingle, options);
  };
  const state = { currentStationKey: "groove", jingleMixer: mixer, player: { state: { status } }, lastJingleAt: 0, jingleHourKey: null };
  runtime.guildState.set(GUILD, state);
  return { runtime, state, mixer, plays };
}

test("the bot plays the jingle only on Ultimate, while it plays, with the switch on and nothing else running", async () => {
  const { runtime, state, mixer, plays } = playingRuntime();
  assert.deepEqual(await runtime.playGuildJingle(GUILD, { reason: "switch", now: 5 }), { ok: true });
  assert.deepEqual(plays, [{ fadeIn: false }], "before the first music the station starts under the jingle");
  assert.equal(state.lastJingleAt, 5);
  assert.deepEqual(await runtime.playGuildJingle(GUILD, { reason: "test" }), { ok: false, error: "busy" });

  mixer.write(Buffer.alloc(4 * 48_000));
  mixer.read();
  assert.equal(mixer.busy, false, "one second of music later the short jingle is over");
  assert.deepEqual(await runtime.playJingleFromDashboard(GUILD), { ok: true });
  assert.deepEqual(plays.at(-1), { fadeIn: true }, "over running music it fades down");

  assert.equal((await playingRuntime({ settings: { jingle: { onSwitch: false } } }).runtime.playGuildJingle(GUILD, { reason: "switch" })).error, "off");
  assert.equal((await playingRuntime({ settings: {} }).runtime.playGuildJingle(GUILD, { reason: "hour" })).error, "off", "the hour waits for its switch");
  assert.equal((await playingRuntime({ settings: { jingle: { onSwitch: false } } }).runtime.playGuildJingle(GUILD, { reason: "test" })).ok, true, "the button ignores the switches");
  assert.equal((await playingRuntime({ status: AudioPlayerStatus.Paused }).runtime.playGuildJingle(GUILD)).error, "paused");
  assert.equal((await playingRuntime({ status: AudioPlayerStatus.Buffering }).runtime.playGuildJingle(GUILD)).ok, true, "a station that is still loading gets it");
  assert.equal((await playingRuntime({ samples: null }).runtime.playGuildJingle(GUILD)).error, "none");
  const opus = playingRuntime();
  opus.state.jingleMixer = null;
  assert.equal((await opus.runtime.playGuildJingle(GUILD)).error, "unsupported");
  plan = "pro";
  assert.equal((await playingRuntime().runtime.playGuildJingle(GUILD)).error, "plan");
  plan = "ultimate";
});

test("the full hour: once per hour in the server's zone, not right after another jingle, again when it was busy", async () => {
  const { runtime, state, mixer, plays } = playingRuntime();
  assert.equal(await runtime.runJingleClock(new Date("2026-10-02T11:59:50Z")), 0, "not yet");
  assert.equal(await runtime.runJingleClock(new Date("2026-10-02T12:00:05Z")), 1, "14:00 in Vienna");
  assert.equal(state.jingleHourKey, "2026-10-02T14");
  mixer.write(Buffer.alloc(4 * 48_000));
  mixer.read();
  assert.equal(await runtime.runJingleClock(new Date("2026-10-02T12:00:20Z")), 0, "once per hour");
  assert.equal(plays.length, 1);

  const busy = playingRuntime();
  busy.mixer.play(new Int16Array(96_000));
  assert.equal(await busy.runtime.runJingleClock(new Date("2026-10-02T12:00:05Z")), 0);
  assert.equal(busy.state.jingleHourKey, null, "busy: the next tick tries again");
  busy.mixer.write(Buffer.alloc(4 * 48_000 * 2));
  busy.mixer.read();
  assert.equal(await busy.runtime.runJingleClock(new Date("2026-10-02T12:00:20Z")), 1);

  const recent = playingRuntime();
  recent.state.lastJingleAt = Date.parse("2026-10-02T11:59:30Z");
  assert.equal(await recent.runtime.runJingleClock(new Date("2026-10-02T12:00:05Z")), 0, "a switch half a minute ago was enough");
  assert.equal(recent.state.jingleHourKey, "2026-10-02T14");

  const india = playingRuntime({ settings: { timeZone: "Asia/Kolkata", jingle: { onHour: true } } });
  assert.equal(await india.runtime.runJingleClock(new Date("2026-10-02T12:00:05Z")), 0, "half past in India");
  assert.equal(await india.runtime.runJingleClock(new Date("2026-10-02T12:30:05Z")), 1, "18:00 in India");

  const off = playingRuntime({ settings: { jingle: { onHour: false } } });
  assert.equal(await off.runtime.runJingleClock(new Date("2026-10-02T12:00:05Z")), 0);
});

test("the clock runs on every bot and stops with it", () => {
  const { runtime } = playingRuntime();
  runtime.startJingleClock();
  const timer = runtime.jingleClockTimer;
  assert.ok(timer);
  runtime.startJingleClock();
  assert.equal(runtime.jingleClockTimer, timer, "one clock per bot");
  runtime.stopJingleClock();
  assert.equal(runtime.jingleClockTimer, null);
});

// ---- stored ----

test("stored: one jingle per server, the sound only when asked for, the bot's copy follows a new upload", { skip: !hasMongoConfig }, async () => {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  const store = await import("../src/jingles-store.js");
  const pcm = pcmOf(1000, 1234);
  const saved = await store.saveGuildJingle(GUILD, { pcm, durationMs: 1000, name: "id.mp3" }, { now: 1000 });
  assert.deepEqual(saved, { ok: true, info: { name: "id.mp3", durationMs: 1000, bytes: pcm.length, updatedAt: 1000 } });
  assert.deepEqual(await store.getGuildJingleInfo(GUILD), saved.info);
  const raw = await getDb().collection("guild_jingles").findOne({ _id: GUILD });
  assert.equal(raw.guildId, GUILD, "found by the server's data deletion");
  assert.equal("userId" in raw || "uploadedBy" in raw, false, "nobody's ID is kept with it");
  assert.deepEqual((await store.getGuildJinglePcm(GUILD)).pcm, pcm);

  const runtime = Object.create(BotRuntime.prototype);
  runtime.jingleCache = new Map();
  const first = await runtime.loadGuildJingleSamples(GUILD);
  assert.equal(first[0], 1234);
  assert.equal(await runtime.loadGuildJingleSamples(GUILD), first, "the same upload comes from memory");
  await store.saveGuildJingle(GUILD, { pcm: pcmOf(1000, 99), durationMs: 1000, name: "new.mp3" }, { now: 2000 });
  assert.equal((await runtime.loadGuildJingleSamples(GUILD))[0], 99, "a new upload is loaded");

  assert.equal(await store.deleteGuildJingle(GUILD), true);
  assert.equal(await store.getGuildJingleInfo(GUILD), null);
  assert.equal(await runtime.loadGuildJingleSamples(GUILD), null);
  assert.equal(runtime.jingleCache.has(GUILD), false, "a deleted jingle leaves memory too");
  assert.equal((await store.saveGuildJingle("not-a-server", { pcm, durationMs: 1, name: "x" })).ok, false);
});
