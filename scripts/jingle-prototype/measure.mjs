// ============================================================
// OmniFM: the jingle prototype (#309), the measurement
// ============================================================
// Plays a test radio through the bot's audio chain, one minute per way,
// takes a packet every 20 ms like discord.js's AudioPlayer, and counts the
// packets that were not ready (dropouts) and the CPU of node and ffmpeg:
//   today    ffmpeg -> Ogg Opus -> discord.js (decode, volume, encode)
//   pcm      ffmpeg -> PCM -> discord.js (volume, encode)
//   jingle   ffmpeg -> PCM -> jingle mixer -> discord.js, a jingle every 15 s
// Then how long a station switch stays silent today (new connection until
// the first packet): the time a jingle played from memory would fill.
// The ffmpeg arguments are the bot's (src/services/stream.js, the stable
// profile). Needs Linux with ffmpeg, like the server; run-in-docker.sh.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { StreamType, createAudioResource } from "@discordjs/voice";
import { JingleMixer, SAMPLE_RATE, toSamples } from "./jingle-mixer.mjs";

// --seconds per way, --every seconds between jingles, --switches against the
// test radio, --stations real stream URLs separated by commas ("" skips them).
const { values: options } = parseArgs({
  options: {
    seconds: { type: "string", default: "60" },
    every: { type: "string", default: "15" },
    switches: { type: "string", default: "5" },
    stations: {
      type: "string",
      // Real stations from the catalog, from four different hosts.
      default: [
        "https://ice4.somafm.com/groovesalad-128-mp3",
        "https://streams.ilovemusic.de/iloveradio1.mp3",
        "http://streams.bigfm.de/bigfm-charts-128-mp3",
        "https://stream.laut.fm/blues",
      ].join(","),
    },
  },
});
const SECONDS = Number(options.seconds) || 60;
const JINGLE_EVERY_S = Number(options.every) || 15;
const SWITCHES = Number(options.switches) || 5;
const REAL_STATIONS = String(options.stations).split(",").map((url) => url.trim()).filter(Boolean);
const BITRATE_KBPS = 128;
// Linux counts CPU time in clock ticks, 100 per second (getconf CLK_TCK).
const CLOCK_TICKS = 100;
const PCM_BYTES_PER_SECOND = SAMPLE_RATE * 4;

const INPUT_ARGS = [
  "-loglevel", "warning",
  "-fflags", "+genpts+discardcorrupt",
  "-probesize", "131072",
  "-analyzeduration", "2000000",
  "-thread_queue_size", "2048",
  "-rtbufsize", "64M",
  "-max_delay", "400000",
  "-i", "pipe:0",
  "-ar", "48000",
  "-ac", "2",
  "-vn",
  "-af", "aresample=async=1:first_pts=0",
  "-flush_packets", "0",
];
const OPUS_ARGS = [
  "-c:a", "libopus", "-b:a", "192k", "-vbr", "on", "-compression_level", "5", "-frame_duration", "20",
  "-application", "lowdelay", "-packet_loss", "3", "-cutoff", "20000", "-f", "ogg", "pipe:1",
];
const PCM_ARGS = ["-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

/** Four minutes of "music" (two tones, pink noise, a tremolo) as an MP3, and a three-second jingle as PCM. */
async function makeMedia(dir) {
  const music = path.join(dir, "music.mp3");
  const jingle = path.join(dir, "jingle.pcm");
  await run("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=196:duration=240",
    "-f", "lavfi", "-i", "sine=frequency=247:duration=240",
    "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.08:duration=240",
    "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3,tremolo=f=1.5:d=0.4,aformat=channel_layouts=stereo",
    "-ar", "44100", "-b:a", `${BITRATE_KBPS}k`, "-id3v2_version", "0", "-write_xing", "0", music,
  ]);
  await run("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=3",
    "-af", "tremolo=f=6:d=0.7,afade=t=in:d=0.1,afade=t=out:st=2.6:d=0.4",
    "-ac", "2", "-ar", "48000", "-f", "s16le", jingle,
  ]);
  return { music, jingle };
}

/** A radio like Icecast: two seconds at once, then in real time. */
function startRadio(file) {
  const data = fs.readFileSync(file);
  const bytesPerSecond = (BITRATE_KBPS * 1000) / 8;
  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "audio/mpeg", "icy-name": "OmniFM Test FM" });
    const started = performance.now();
    let sent = 0;
    const pump = () => {
      const due = Math.min(data.length, Math.floor(bytesPerSecond * 2 + ((performance.now() - started) / 1000) * bytesPerSecond));
      if (due > sent) {
        response.write(data.subarray(sent, due));
        sent = due;
      }
      if (sent >= data.length) {
        clearInterval(timer);
        response.end();
      }
    };
    const timer = setInterval(pump, 50);
    pump();
    response.on("close", () => clearInterval(timer));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const close = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => { server.close(() => resolve()); });
  };
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      resolve({ url: `http://127.0.0.1:${port}/stream`, close });
    });
  });
}

/** CPU seconds a process has used so far, from /proc. */
function cpuSecondsOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS;
  } catch {
    return Number.NaN;
  }
}

/** The bot's chain for one way: the stream through ffmpeg into a discord.js resource. */
async function openStream(url, way, mixer = null) {
  const response = await fetch(url, { headers: { "User-Agent": "OmniFM/3.0" } });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const child = spawn("ffmpeg", [...INPUT_ARGS, ...(way === "today" ? OPUS_ARGS : PCM_ARGS)], { stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.on("error", () => {});
  const input = Readable.fromWeb(/** @type {import("node:stream/web").ReadableStream} */ (response.body));
  // Closing the stream at the end of a run is no error.
  input.on("error", () => {});
  input.pipe(child.stdin);
  const source = mixer ? child.stdout.pipe(mixer) : child.stdout;
  const resource = createAudioResource(source, {
    inputType: way === "today" ? StreamType.OggOpus : StreamType.Raw,
    inlineVolume: true,
  });
  resource.volume.setVolume(0.8);
  const close = () => {
    child.kill("SIGKILL");
    input.destroy();
    resource.playStream.destroy();
  };
  return { resource, child, close };
}

async function firstPacket(resource, openedAt, way) {
  for (;;) {
    if (resource.read()) return performance.now() - openedAt;
    if (performance.now() - openedAt > 20_000) throw new Error(`${way}: no packet after 20 s`);
    // eslint-disable-next-line no-await-in-loop -- waiting for the stream, a few milliseconds at a time
    await delay(2);
  }
}

/** One way for SECONDS: dropouts, CPU and, with the mixer, how late the jingle is heard. */
async function measureWay(radio, way, jingleSamples) {
  const mixer = way === "jingle" ? new JingleMixer({ duck: 0.3, fadeMs: 250 }) : null;
  let mixedBytes = 0;
  mixer?.on("data", (chunk) => { mixedBytes += chunk.length; });
  const openedAt = performance.now();
  const { resource, child, close } = await openStream(radio.url, way, mixer);
  const startupMs = await firstPacket(resource, openedAt, way);

  const cpuBefore = process.cpuUsage();
  const ffmpegBefore = cpuSecondsOf(child.pid);
  const start = performance.now();
  const jingleMs = (jingleSamples.length / 2 / SAMPLE_RATE) * 1000;
  let next = start;
  let packets = 1;
  let dropouts = 0;
  let streak = 0;
  let longest = 0;
  let jingles = 0;
  let jingleDropouts = 0;
  let jingleUntil = 0;
  const lateness = [];
  const ticks = Math.round((SECONDS * 1000) / 20);
  for (let tick = 1; tick <= ticks; tick += 1) {
    next += 20;
    const wait = next - performance.now();
    // eslint-disable-next-line no-await-in-loop -- one packet every 20 ms, like the player
    if (wait > 0) await delay(wait);
    const elapsed = performance.now() - start;
    if (mixer && elapsed >= (jingles + 1) * JINGLE_EVERY_S * 1000) {
      mixer.play(jingleSamples);
      jingles += 1;
      jingleUntil = elapsed + jingleMs + 500;
      // What the mixer has passed on but the player has not taken yet is heard before the jingle.
      lateness.push(Math.max(0, (mixedBytes / PCM_BYTES_PER_SECOND) * 1000 - packets * 20));
    }
    if (resource.read()) {
      packets += 1;
      streak = 0;
    } else {
      dropouts += 1;
      streak += 1;
      longest = Math.max(longest, streak);
      if (elapsed < jingleUntil) jingleDropouts += 1;
    }
  }
  const wall = (performance.now() - start) / 1000;
  const cpu = process.cpuUsage(cpuBefore);
  const ffmpegCpu = cpuSecondsOf(child.pid) - ffmpegBefore;
  close();
  return {
    way,
    startupMs,
    packets,
    dropouts,
    longestDropoutMs: longest * 20,
    jingles,
    jingleDropouts,
    jingleLateMs: lateness.length ? lateness.reduce((sum, value) => sum + value, 0) / lateness.length : null,
    nodeCpuPct: ((cpu.user + cpu.system) / 1e6 / wall) * 100,
    ffmpegCpuPct: (ffmpegCpu / wall) * 100,
  };
}

/**
 * How long a station switch stays silent today: a new connection until its
 * first packet. Against the test radio that is the chain alone; against real
 * stations the network and the station's first burst come on top.
 */
async function measureSwitches(url, times = SWITCHES) {
  const results = [];
  for (let index = 0; index < times; index += 1) {
    const openedAt = performance.now();
    try {
      // eslint-disable-next-line no-await-in-loop -- one switch after the other
      const { resource, close } = await openStream(url, "today");
      // eslint-disable-next-line no-await-in-loop
      results.push(await firstPacket(resource, openedAt, "switch"));
      close();
    } catch (error) {
      results.push(Number.NaN);
      console.log(`  ${url}: ${error?.message || error}`);
    }
  }
  return results;
}

const fmt = (value, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "–");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-jingle-"));
  try {
    const media = await makeMedia(dir);
    const jingleSamples = toSamples(fs.readFileSync(media.jingle));
    const radio = await startRadio(media.music);
    const results = [];
    for (const way of ["today", "pcm", "jingle"]) {
      console.log(`measuring ${way} for ${SECONDS} s ...`);
      // eslint-disable-next-line no-await-in-loop -- the ways run one after the other, so they do not share the CPU
      results.push(await measureWay(radio, way, jingleSamples));
    }
    const switches = await measureSwitches(radio.url);
    const real = [];
    for (const url of REAL_STATIONS) {
      console.log(`measuring a switch to ${url} ...`);
      // eslint-disable-next-line no-await-in-loop -- one station after the other
      real.push({ url, times: await measureSwitches(url, 3) });
    }
    await radio.close();

    console.log("");
    console.log(`| Way | Dropouts (of ${Math.round((SECONDS * 1000) / 20)} packets) | Longest | Node CPU | ffmpeg CPU | First packet | Jingles | Dropouts in jingles | Jingle heard after |`);
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const row of results) {
      console.log(`| ${row.way} | ${row.dropouts} | ${row.longestDropoutMs} ms | ${fmt(row.nodeCpuPct, 1)} % | ${fmt(row.ffmpegCpuPct, 1)} % | ${fmt(row.startupMs)} ms | ${row.jingles || "–"} | ${row.jingles ? row.jingleDropouts : "–"} | ${row.jingleLateMs === null ? "–" : `${fmt(row.jingleLateMs)} ms`} |`);
    }
    console.log("");
    console.log(`Station switch today, new connection until the first packet (${SWITCHES}x): ${switches.map((value) => `${fmt(value)} ms`).join(", ")}`);
    for (const station of real) {
      console.log(`  real station ${station.url}: ${station.times.map((value) => `${fmt(value)} ms`).join(", ")}`);
    }
    console.log(`CPU in % of one core (${os.cpus()[0]?.model || "unknown CPU"}, ${os.cpus().length} cores); Node includes the test radio and this loop.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

await main();
