#!/usr/bin/env node
// Records the website's live demos as video clips for Discord announcements
// and social media (#431), one round of each scene at 1280 × 720, and the
// tour through the dashboard preview (#432):
//
//   node scripts/record-demo-clips.mjs [--site http://127.0.0.1:4173] [--lang de,en]
//
// Needs the built website running (for example `npm run build` and
// `npx vite preview --port 4173` in frontend/). Writes
// .local-testing/demo-clips/<scene>-<lang>.webm and, when ffmpeg is on the
// PATH, an .mp4 next to it (H.264, starts fast, plays everywhere).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".local-testing", "demo-clips");
const SCENES = ["commander", "worker", "play", "panel", "dashboard"];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const site = option("site", "http://127.0.0.1:4173").replace(/\/$/, "");
const languages = option("lang", "de,en").split(",").map((code) => code.trim()).filter(Boolean);
const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

/** One round of one scene in one language: a WebM, and an MP4 with ffmpeg. */
async function record(browser, scene, language) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    locale: language,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(`${site}/?demo=${scene}&lang=${language}`, { waitUntil: "networkidle" });
  const figure = page.getByTestId(`demo-${scene}`);
  await figure.waitFor();
  // The tour starts once the dashboard in its frame is there.
  if (scene === "dashboard") await page.waitForSelector('[data-testid="dashboard-tour"][data-ready="true"]', { timeout: 30_000 });
  // The MP4 leaves out the moment the page takes to load.
  const lead = ((Date.now() - started) / 1000).toFixed(2);
  const round = Number(await figure.getAttribute("data-round-ms")) || 10_000;
  // One whole round and a moment of the next start.
  await page.waitForTimeout(round + 600);
  const video = page.video();
  await context.close();
  const webm = path.join(OUT, `${scene}-${language}.webm`);
  fs.renameSync(await video.path(), webm);
  if (ffmpeg) {
    const mp4 = webm.replace(/\.webm$/, ".mp4");
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-ss", lead, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4], { stdio: "inherit" });
  }
  console.log(`recorded ${path.relative(ROOT, webm)}${ffmpeg ? " (+ .mp4)" : ""}`);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const language of languages) {
    for (const scene of SCENES) {
      // eslint-disable-next-line no-await-in-loop -- one recording after the other keeps the videos smooth
      await record(browser, scene, language);
    }
  }
} finally {
  await browser.close();
}
if (!ffmpeg) console.log("ffmpeg is not on the PATH: the clips are WebM (Discord plays them too); with ffmpeg they are also written as MP4.");
