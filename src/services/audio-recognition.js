import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

import { log } from "../lib/logging.js";
import { clipText, parseEnvInt, waitMs } from "../lib/helpers.js";
import { sanitizeUrlForLog } from "../lib/redact-sensitive.js";
import { safeFetch } from "../lib/safe-outbound-http.js";

const RECOGNITION_ENABLED = String(process.env.NOW_PLAYING_RECOGNITION_ENABLED ?? "0").trim() !== "0";
const ACOUSTID_API_KEY = String(process.env.ACOUSTID_API_KEY || "").trim();
const MUSICBRAINZ_ENABLED = String(process.env.NOW_PLAYING_MUSICBRAINZ_ENABLED ?? "1").trim() !== "0";
const RECOGNITION_SAMPLE_SECONDS = parseEnvInt("NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS", 18, 8, 40);
const RECOGNITION_MIN_SECONDS = parseEnvInt("NOW_PLAYING_RECOGNITION_MIN_SECONDS", 10, 4, 20);
const RECOGNITION_CAPTURE_RETRIES = parseEnvInt("NOW_PLAYING_RECOGNITION_CAPTURE_RETRIES", 2, 1, 4);
const RECOGNITION_CAPTURE_SAMPLE_RATE = parseEnvInt("NOW_PLAYING_RECOGNITION_CAPTURE_SAMPLE_RATE", 44100, 11025, 48000);
const RECOGNITION_CAPTURE_CHANNELS = parseEnvInt("NOW_PLAYING_RECOGNITION_CAPTURE_CHANNELS", 2, 1, 2);
const RECOGNITION_TIMEOUT_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_TIMEOUT_MS", 28_000, 8_000, 60_000);
const RECOGNITION_CACHE_TTL_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_CACHE_TTL_MS", 90_000, 30_000, 10 * 60_000);
const RECOGNITION_FAILURE_TTL_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_FAILURE_TTL_MS", 180_000, 30_000, 30 * 60_000);
const RECOGNITION_STREAM_SOFT_FAILURE_TTL_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_STREAM_SOFT_FAILURE_TTL_MS", 180_000, 30_000, 30 * 60_000);
const RECOGNITION_SOFT_LOG_COOLDOWN_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_SOFT_LOG_COOLDOWN_MS", 10 * 60_000, 60_000, 60 * 60_000);
const RECOGNITION_NO_MATCH_LOG_COOLDOWN_MS = parseEnvInt(
  "NOW_PLAYING_RECOGNITION_NO_MATCH_LOG_COOLDOWN_MS",
  20 * 60_000,
  5 * 60_000,
  4 * 60 * 60_000
);
const MUSICBRAINZ_MIN_DELAY_MS = parseEnvInt("NOW_PLAYING_MUSICBRAINZ_MIN_DELAY_MS", 1100, 1000, 10_000);
const ACOUSTID_MIN_DELAY_MS = parseEnvInt("NOW_PLAYING_ACOUSTID_MIN_DELAY_MS", 350, 150, 5_000);
const RECOGNITION_SCORE_THRESHOLD = Math.max(
  0.1,
  Math.min(1, Number.parseFloat(String(process.env.NOW_PLAYING_RECOGNITION_SCORE_THRESHOLD || "0.55")) || 0.55)
);
const PUBLIC_WEB_URL = String(process.env.PUBLIC_WEB_URL || "").trim() || "https://omnifm.xyz";
const USER_AGENT = `OmniFM/3.0 (+${PUBLIC_WEB_URL})`;
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const recognitionCache = new Map();
const recognitionInFlight = new Map();
const recognitionSoftFailureLogCache = new Map();
let fpcalcAvailabilityPromise = null;
let nextAcoustIdRequestAt = 0;
let nextMusicBrainzRequestAt = 0;

function normalizeRecognitionValue(rawValue, maxLength = 200) {
  const text = clipText(String(rawValue || "").replace(/\s+/g, " ").trim(), maxLength);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === "-" || lower === "--" || lower === "unknown" || lower === "n/a") {
    return null;
  }
  return text;
}

function joinArtistNames(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const artistText = entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const name = normalizeRecognitionValue(entry.name || entry.artist?.name, 160) || "";
      const joinphrase = String(entry.joinphrase || "").slice(0, 12);
      return `${name}${joinphrase}`;
    })
    .join("")
    .trim();
  return normalizeRecognitionValue(artistText, 180);
}

function buildDisplayTitle(artist, title) {
  const cleanArtist = normalizeRecognitionValue(artist, 140);
  const cleanTitle = normalizeRecognitionValue(title, 180);
  if (cleanArtist && cleanTitle) return `${cleanArtist} - ${cleanTitle}`;
  return cleanTitle || cleanArtist || null;
}

function buildRecognitionCacheKey(url, existingTrack = null) {
  const normalizedUrl = String(url || "").trim().toLowerCase();
  const trackHint = normalizeRecognitionValue(
    existingTrack?.displayTitle || existingTrack?.title || existingTrack?.artist || "",
    120
  );
  return `${normalizedUrl}|${String(trackHint || "-").toLowerCase()}`;
}

function buildRecognitionStreamKey(url) {
  return String(url || "").trim().toLowerCase();
}

async function waitForProviderWindow(provider, minDelayMs) {
  const now = Date.now();
  let readyAt = provider === "musicbrainz" ? nextMusicBrainzRequestAt : nextAcoustIdRequestAt;
  if (readyAt > now) {
    await waitMs(readyAt - now);
  }
  readyAt = Date.now() + Math.max(0, Number(minDelayMs) || 0);
  if (provider === "musicbrainz") {
    nextMusicBrainzRequestAt = readyAt;
  } else {
    nextAcoustIdRequestAt = readyAt;
  }
}

function runProcess(command, args, { timeoutMs = 15_000, input = null } = {}) {
  return new Promise((resolve, reject) => {
    const hasInput = Boolean(input && typeof input.pipe === "function");
    const child = spawn(command, args, {
      stdio: [hasInput ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout = null;
    let onInputError = null;

    const stopInput = () => {
      if (!hasInput) return;
      try {
        input.unpipe?.(child.stdin);
      } catch {
        // ignore
      }
      if (!input.destroyed) {
        try {
          input.destroy?.();
        } catch {
          // ignore
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (hasInput && onInputError) input.off?.("error", onInputError);
      stopInput();
    };

    const fail = (error, { kill = false } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (kill) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      reject(error);
    };

    timeout = setTimeout(() => {
      fail(new Error(`${command} timed out after ${timeoutMs}ms`), { kill: true });
    }, Math.max(1000, timeoutMs));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} exited with code ${code}: ${clipText(stderr || stdout, 300)}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      error.command = command;
      reject(error);
    });

    if (hasInput) {
      onInputError = (error) => fail(error, { kill: true });
      input.once("error", onInputError);
      child.stdin.on("error", () => {
        // ffmpeg may stop after the requested sample while the source stream
        // is still open. End the source without turning that normal EPIPE
        // into a failed recognition attempt.
        stopInput();
      });
      try {
        input.pipe(child.stdin);
      } catch (error) {
        fail(error, { kill: true });
      }
    }
  });
}

function parseFpcalcOutput(stdout) {
  const text = String(stdout || "");
  const durationMatch = text.match(/^DURATION=(.+)$/m);
  const fingerprintMatch = text.match(/^FINGERPRINT=(.+)$/m);
  const duration = Number.parseFloat(String(durationMatch?.[1] || "").trim());
  const fingerprint = String(fingerprintMatch?.[1] || "").trim();

  if (!Number.isFinite(duration) || duration <= 0 || !fingerprint) {
    return null;
  }

  return {
    duration: Math.round(duration),
    fingerprint,
  };
}

function extractFpcalcResultFromError(error) {
  if (!error || String(error.command || "").toLowerCase() !== "fpcalc") {
    return null;
  }

  return parseFpcalcOutput(error.stdout);
}

function estimatePcmWavDurationSeconds(fileSizeBytes, sampleRate = 11025, channels = 1) {
  const payloadBytes = Math.max(0, Number(fileSizeBytes || 0) - 44);
  if (payloadBytes <= 0) return 0;
  const normalizedSampleRate = Math.max(1, Number(sampleRate) || 11025);
  const normalizedChannels = Math.max(1, Number(channels) || 1);
  return payloadBytes / (normalizedSampleRate * normalizedChannels * 2);
}

function isFpcalcDecodeEofError(error) {
  const text = String(error?.message || error?.stderr || error || "").toLowerCase();
  return text.includes("error decoding audio frame")
    || text.includes("end of file");
}

function isFpcalcMissingInputError(error) {
  const text = String(error?.message || error?.stderr || error || "").toLowerCase();
  return text.includes("could not open the input file")
    || text.includes("no such file or directory")
    || text.includes("sample file missing before fpcalc");
}

function isSoftRecognitionFailure(error) {
  if (!error) return false;
  const text = String(error?.message || error?.stderr || error || "").toLowerCase();
  return isFpcalcDecodeEofError(error)
    || isFpcalcMissingInputError(error)
    || text.includes("captured sample too short")
    || text.includes("sample file is empty")
    || text.includes("invalid data found when processing input")
    || text.includes("connection timed out")
    || text.includes("io error")
    || text.includes("timed out")
    || text.includes("no usable fingerprint");
}

function shouldLogRecognitionFailure(cacheKey, error, message) {
  const normalizedMessage = String(message || "").trim().toLowerCase();
  const isNoMatchLog = normalizedMessage === "acoustid-no-match";
  if (!isNoMatchLog && !isSoftRecognitionFailure(error)) return true;

  const normalizedKey = `${String(cacheKey || "-").toLowerCase()}|${normalizedMessage}`;
  const now = Date.now();
  const nextAllowedAt = recognitionSoftFailureLogCache.get(normalizedKey) || 0;
  if (nextAllowedAt > now) {
    return false;
  }

  const cooldownMs = isNoMatchLog
    ? RECOGNITION_NO_MATCH_LOG_COOLDOWN_MS
    : RECOGNITION_SOFT_LOG_COOLDOWN_MS;
  recognitionSoftFailureLogCache.set(normalizedKey, now + cooldownMs);
  if (recognitionSoftFailureLogCache.size > 500) {
    for (const [key, expiresAt] of recognitionSoftFailureLogCache.entries()) {
      if (expiresAt <= now) {
        recognitionSoftFailureLogCache.delete(key);
      }
    }
  }
  return true;
}

async function hasFpcalcSupport() {
  if (fpcalcAvailabilityPromise) return fpcalcAvailabilityPromise;
  fpcalcAvailabilityPromise = runProcess("fpcalc", ["-version"], { timeoutMs: 2500 })
    .then(() => true)
    .catch(() => false);
  return fpcalcAvailabilityPromise;
}

async function probeAudioDurationSeconds(filePath) {
  const output = await runProcess("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { timeoutMs: 4000 });

  const duration = Number.parseFloat(String(output.stdout || "").trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

async function runFpcalc(samplePath, fingerprintSeconds = null) {
  const sampleStat = await fs.stat(samplePath).catch(() => null);
  if (!sampleStat || sampleStat.size <= 44) {
    throw new Error("sample file missing before fpcalc");
  }

  const args = [];
  if (Number.isFinite(fingerprintSeconds) && fingerprintSeconds > 0) {
    args.push("-length", String(Math.max(1, Math.floor(fingerprintSeconds))));
  }
  args.push(samplePath);

  let output;
  try {
    output = await runProcess("fpcalc", args, {
      timeoutMs: Math.min(RECOGNITION_TIMEOUT_MS, 12_000),
    });
  } catch (error) {
    const parsedFromError = extractFpcalcResultFromError(error);
    if (parsedFromError) {
      return parsedFromError;
    }
    throw error;
  }
  const parsed = parseFpcalcOutput(output.stdout);
  if (!parsed) {
    throw new Error("fpcalc returned no usable fingerprint");
  }
  return parsed;
}

async function repairCapturedSample(samplePath, targetPath) {
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-y",
    "-fflags", "+discardcorrupt",
    "-i", samplePath,
    "-vn",
    "-ac", String(RECOGNITION_CAPTURE_CHANNELS),
    "-ar", String(RECOGNITION_CAPTURE_SAMPLE_RATE),
    "-c:a", "pcm_s16le",
    "-f", "wav",
    targetPath,
  ], { timeoutMs: Math.min(RECOGNITION_TIMEOUT_MS, 12_000) });

  const repairedStat = await fs.stat(targetPath).catch(() => null);
  if (!repairedStat || repairedStat.size <= 44) {
    throw new Error("repaired sample file is empty");
  }
  return targetPath;
}

async function fingerprintCapturedSample(samplePath, tempDir, preferredFingerprintSeconds) {
  try {
    return await runFpcalc(samplePath, preferredFingerprintSeconds);
  } catch (error) {
    if (!isFpcalcDecodeEofError(error)) throw error;
  }

  const repairedSamplePath = path.join(tempDir, "sample-repaired.wav");
  try {
    await repairCapturedSample(samplePath, repairedSamplePath);
  } catch {
    return await runFpcalc(samplePath, null);
  }

  try {
    return await runFpcalc(repairedSamplePath, preferredFingerprintSeconds);
  } catch (error) {
    if (!isFpcalcDecodeEofError(error)) throw error;
    return await runFpcalc(repairedSamplePath, null);
  }
}

function buildCaptureFfmpegArgs(samplePath) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-y",
    "-t", String(RECOGNITION_SAMPLE_SECONDS),
    "-i", "pipe:0",
    "-vn",
    "-ac", String(RECOGNITION_CAPTURE_CHANNELS),
    "-ar", String(RECOGNITION_CAPTURE_SAMPLE_RATE),
    "-c:a", "pcm_s16le",
    "-f", "wav",
    samplePath,
  ];
}

async function captureFingerprintAttempt(url) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-fingerprint-"));
  const samplePath = path.join(tempDir, "sample.wav");
  let source = null;

  try {
    const response = await safeFetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
      timeoutMs: Math.min(RECOGNITION_TIMEOUT_MS, 15_000),
    });
    if (!response.ok || !response.body) {
      try {
        await response.body?.cancel?.();
      } catch {
        // ignore
      }
      throw new Error(`stream request failed with status ${response.status}`);
    }
    source = Readable.fromWeb(response.body);

    await runProcess(
      "ffmpeg",
      buildCaptureFfmpegArgs(samplePath),
      { timeoutMs: RECOGNITION_TIMEOUT_MS, input: source }
    );

    const sampleStat = await fs.stat(samplePath).catch(() => null);
    if (!sampleStat || sampleStat.size <= 44) {
      throw new Error("sample file is empty");
    }

    let capturedSeconds = 0;
    try {
      capturedSeconds = await probeAudioDurationSeconds(samplePath);
    } catch {
      capturedSeconds = estimatePcmWavDurationSeconds(
        sampleStat.size,
        RECOGNITION_CAPTURE_SAMPLE_RATE,
        RECOGNITION_CAPTURE_CHANNELS
      );
    }

    if (!Number.isFinite(capturedSeconds) || capturedSeconds <= 0) {
      capturedSeconds = estimatePcmWavDurationSeconds(
        sampleStat.size,
        RECOGNITION_CAPTURE_SAMPLE_RATE,
        RECOGNITION_CAPTURE_CHANNELS
      );
    }

    if (capturedSeconds < RECOGNITION_MIN_SECONDS) {
      throw new Error(`captured sample too short (${capturedSeconds.toFixed(1)}s < ${RECOGNITION_MIN_SECONDS}s)`);
    }

    const preferredFingerprintSeconds = Math.min(RECOGNITION_SAMPLE_SECONDS, Math.max(1, Math.floor(capturedSeconds)));
    return await fingerprintCapturedSample(samplePath, tempDir, preferredFingerprintSeconds);
  } finally {
    source?.destroy?.();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function captureFingerprintFromStream(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= RECOGNITION_CAPTURE_RETRIES; attempt += 1) {
    try {
      return await captureFingerprintAttempt(url);
    } catch (error) {
      lastError = error;
      if (
        attempt >= RECOGNITION_CAPTURE_RETRIES
        || (!isFpcalcMissingInputError(error) && !isFpcalcDecodeEofError(error))
      ) {
        throw error;
      }
      await waitMs(150 * attempt);
    }
  }

  throw lastError || new Error("capture fingerprint failed");
}

function extractAcoustIdCandidate(result, recording) {
  if (!recording || typeof recording !== "object") return null;
  const title = normalizeRecognitionValue(recording.title, 180);
  const artist = joinArtistNames(recording.artists || recording["artist-credit"] || []);
  const release = Array.isArray(recording.releases) ? recording.releases.find((entry) => entry?.id || entry?.title) : null;
  const releaseGroup = Array.isArray(recording.releasegroups) ? recording.releasegroups[0] : null;
  const releaseTitle = normalizeRecognitionValue(release?.title || releaseGroup?.title, 180);
  const releaseId = MBID_PATTERN.test(String(release?.id || "").trim()) ? String(release.id).trim() : null;
  const recordingId = MBID_PATTERN.test(String(recording.id || "").trim()) ? String(recording.id).trim() : null;
  const score = Math.max(0, Math.min(1, Number.parseFloat(String(result?.score || 0)) || 0));
  const displayTitle = buildDisplayTitle(artist, title);
  if (!displayTitle) return null;

  return {
    acoustidId: normalizeRecognitionValue(result?.id, 64),
    musicBrainzRecordingId: recordingId,
    musicBrainzReleaseId: releaseId,
    artist,
    title,
    displayTitle,
    album: releaseTitle,
    releaseTitle,
    score,
    recognitionProvider: "AcoustID",
  };
}

function selectBestAcoustIdMatch(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const candidates = [];

  for (const result of results) {
    const recordings = Array.isArray(result?.recordings) ? result.recordings : [];
    for (const recording of recordings) {
      const candidate = extractAcoustIdCandidate(result, recording);
      if (!candidate) continue;
      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftRichness = Number(Boolean(left.artist)) + Number(Boolean(left.album));
    const rightRichness = Number(Boolean(right.artist)) + Number(Boolean(right.album));
    if (rightRichness !== leftRichness) return rightRichness - leftRichness;
    return String(left.displayTitle || "").localeCompare(String(right.displayTitle || ""));
  });

  const best = candidates[0] || null;
  if (!best || best.score < RECOGNITION_SCORE_THRESHOLD) return null;
  return best;
}

async function lookupAcoustIdFingerprint(fingerprint, duration) {
  await waitForProviderWindow("acoustid", ACOUSTID_MIN_DELAY_MS);

  const body = new URLSearchParams();
  body.set("client", ACOUSTID_API_KEY);
  body.set("duration", String(Math.max(1, Number(duration) || RECOGNITION_SAMPLE_SECONDS)));
  body.set("fingerprint", fingerprint);
  body.set("meta", "recordings+releasegroups+releases+tracks+compress");
  body.set("format", "json");

  const response = await fetch("https://api.acoustid.org/v2/lookup", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body,
    signal: AbortSignal.timeout(Math.min(12_000, RECOGNITION_TIMEOUT_MS)),
  });

  if (!response.ok) {
    throw new Error(`AcoustID lookup failed with HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.status !== "ok") {
    throw new Error("AcoustID did not return a valid result");
  }

  return selectBestAcoustIdMatch(payload);
}

function selectPreferredRelease(releases = []) {
  if (!Array.isArray(releases) || !releases.length) return null;
  const normalized = releases
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      releaseId: MBID_PATTERN.test(String(entry.id || "").trim()) ? String(entry.id).trim() : null,
      releaseTitle: normalizeRecognitionValue(entry.title, 180),
      status: String(entry.status || "").trim().toLowerCase(),
      date: String(entry.date || "").trim(),
    }))
    .filter((entry) => entry.releaseId || entry.releaseTitle);

  normalized.sort((left, right) => {
    const leftOfficial = left.status === "official" ? 1 : 0;
    const rightOfficial = right.status === "official" ? 1 : 0;
    if (rightOfficial !== leftOfficial) return rightOfficial - leftOfficial;
    if (left.date && right.date && left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.releaseTitle && right.releaseTitle && left.releaseTitle !== right.releaseTitle) {
      return left.releaseTitle.localeCompare(right.releaseTitle);
    }
    return 0;
  });

  return normalized[0] || null;
}

async function resolveCoverArtArchiveUrl(releaseId) {
  if (!MBID_PATTERN.test(String(releaseId || "").trim())) return null;
  const preferred = `https://coverartarchive.org/release/${releaseId}/front-500`;
  const fallback = `https://coverartarchive.org/release/${releaseId}/front`;

  for (const candidate of [preferred, fallback]) {
    const response = await fetch(candidate, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (response?.ok) return candidate;
  }

  return null;
}

async function fetchMusicBrainzRecording(recordingId) {
  if (!MUSICBRAINZ_ENABLED || !MBID_PATTERN.test(String(recordingId || "").trim())) return null;
  await waitForProviderWindow("musicbrainz", MUSICBRAINZ_MIN_DELAY_MS);

  const response = await fetch(
    `https://musicbrainz.org/ws/2/recording/${recordingId}?fmt=json&inc=artists+releases+release-groups`,
    {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    throw new Error(`MusicBrainz lookup failed with HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new Error("MusicBrainz returned no usable payload");
  }

  const release = selectPreferredRelease(payload.releases || []);
  const artist = joinArtistNames(payload["artist-credit"] || payload.artists || []);
  const title = normalizeRecognitionValue(payload.title, 180);
  const album = normalizeRecognitionValue(release?.releaseTitle, 180);
  const releaseId = release?.releaseId || null;
  const artworkUrl = releaseId ? await resolveCoverArtArchiveUrl(releaseId) : null;

  return {
    musicBrainzRecordingId: recordingId,
    musicBrainzReleaseId: releaseId,
    artist,
    title,
    displayTitle: buildDisplayTitle(artist, title),
    album,
    releaseTitle: album,
    artworkUrl,
    recognitionProvider: "AcoustID + MusicBrainz",
  };
}

function mergeRecognitionData(baseCandidate, enrichedCandidate) {
  const artist = enrichedCandidate?.artist || baseCandidate?.artist || null;
  const title = enrichedCandidate?.title || baseCandidate?.title || null;
  const displayTitle = enrichedCandidate?.displayTitle || baseCandidate?.displayTitle || buildDisplayTitle(artist, title);

  return {
    artist,
    title,
    displayTitle,
    raw: displayTitle || baseCandidate?.displayTitle || null,
    album: enrichedCandidate?.album || baseCandidate?.album || null,
    releaseTitle: enrichedCandidate?.releaseTitle || baseCandidate?.releaseTitle || null,
    artworkUrl: enrichedCandidate?.artworkUrl || null,
    recognitionProvider: enrichedCandidate?.recognitionProvider || baseCandidate?.recognitionProvider || "AcoustID",
    recognitionConfidence: baseCandidate?.score || null,
    acoustidId: baseCandidate?.acoustidId || null,
    musicBrainzRecordingId: enrichedCandidate?.musicBrainzRecordingId || baseCandidate?.musicBrainzRecordingId || null,
    musicBrainzReleaseId: enrichedCandidate?.musicBrainzReleaseId || baseCandidate?.musicBrainzReleaseId || null,
  };
}

async function recognizeTrackFromStream(url, { existingTrack = null } = {}) {
  if (!RECOGNITION_ENABLED || !ACOUSTID_API_KEY) return null;
  if (!(await hasFpcalcSupport())) return null;

  const cacheKey = buildRecognitionCacheKey(url, existingTrack);
  const streamKey = buildRecognitionStreamKey(url);
  const cached = recognitionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const streamCached = recognitionCache.get(streamKey);
  if (streamCached && streamCached.expiresAt > Date.now()) {
    return streamCached.value;
  }

  if (recognitionInFlight.has(cacheKey)) {
    return recognitionInFlight.get(cacheKey);
  }

  const request = (async () => {
    try {
      const sample = await captureFingerprintFromStream(url);
      const acoustIdCandidate = await lookupAcoustIdFingerprint(sample.fingerprint, sample.duration);
      if (!acoustIdCandidate) {
        if (shouldLogRecognitionFailure(streamKey || cacheKey, new Error("AcoustID returned no matches"), "acoustid-no-match")) {
          log("INFO", `[NowPlaying] Audio recognition found no AcoustID matches for ${sanitizeUrlForLog(url)}`);
        }
        recognitionCache.set(cacheKey, { value: null, expiresAt: Date.now() + RECOGNITION_FAILURE_TTL_MS });
        return null;
      }

      let enriched = null;
      if (acoustIdCandidate.musicBrainzRecordingId) {
        try {
          enriched = await fetchMusicBrainzRecording(acoustIdCandidate.musicBrainzRecordingId);
        } catch (error) {
          log("WARN", `[NowPlaying] MusicBrainz enrichment failed: ${error?.message || error}`);
        }
      }

      const resolved = mergeRecognitionData(acoustIdCandidate, enriched);
      if (!resolved.displayTitle) {
        recognitionCache.set(cacheKey, { value: null, expiresAt: Date.now() + RECOGNITION_FAILURE_TTL_MS });
        return null;
      }

      recognitionCache.set(cacheKey, {
        value: resolved,
        expiresAt: Date.now() + RECOGNITION_CACHE_TTL_MS,
      });
      return resolved;
    } catch (error) {
      const message = clipText(error?.message || String(error), 220);
      const level = isSoftRecognitionFailure(error) ? "INFO" : "WARN";
      if (shouldLogRecognitionFailure(streamKey || cacheKey, error, message)) {
        log(level, `[NowPlaying] Audio recognition failed: ${message}`);
      }
      recognitionCache.set(cacheKey, { value: null, expiresAt: Date.now() + RECOGNITION_FAILURE_TTL_MS });
      if (isSoftRecognitionFailure(error)) {
        recognitionCache.set(streamKey, {
          value: null,
          expiresAt: Date.now() + RECOGNITION_STREAM_SOFT_FAILURE_TTL_MS,
        });
      }
      return null;
    }
  })().finally(() => {
    recognitionInFlight.delete(cacheKey);
  });

  recognitionInFlight.set(cacheKey, request);
  return request;
}

export {
  buildCaptureFfmpegArgs,
  estimatePcmWavDurationSeconds,
  extractAcoustIdCandidate,
  extractFpcalcResultFromError,
  isFpcalcMissingInputError,
  isSoftRecognitionFailure,
  parseFpcalcOutput,
  selectBestAcoustIdMatch,
  shouldLogRecognitionFailure,
  recognizeTrackFromStream,
};
