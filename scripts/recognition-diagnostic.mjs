import { fetchStreamSnapshot, hasUsableStreamTrack } from "../src/services/now-playing.js";
import { recognizeTrackFromStream } from "../src/services/audio-recognition.js";
import { validateOutboundUrlWithDns } from "../src/lib/safe-outbound-http.js";
import { redactSensitiveData, redactSensitiveText, sanitizeUrlForLog } from "../src/lib/redact-sensitive.js";
import { pathToFileURL } from "node:url";

function getRecognitionEnvironment(env = process.env) {
  return {
    keyPresent: Boolean(env.ACOUSTID_API_KEY),
    sampleSeconds: Math.max(8, Math.min(40, Number.parseInt(env.NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS || "22", 10) || 22)),
    sampleRate: Math.max(11025, Math.min(48000, Number.parseInt(env.NOW_PLAYING_RECOGNITION_CAPTURE_SAMPLE_RATE || "44100", 10) || 44100)),
    channels: Math.max(1, Math.min(2, Number.parseInt(env.NOW_PLAYING_RECOGNITION_CAPTURE_CHANNELS || "2", 10) || 2)),
    timeoutMs: Number.parseInt(env.NOW_PLAYING_RECOGNITION_TIMEOUT_MS || "28000", 10) || 28000,
  };
}

function buildRecognitionReport(url, env) {
  return {
    ok: false,
    url: sanitizeUrlForLog(url),
    env: getRecognitionEnvironment(env),
    stream: {
      metadataSource: null,
      metadataStatus: null,
      displayTitle: null,
      artist: null,
      title: null,
      album: null,
      willSkipRecognition: false,
    },
    recognition: {
      attempted: false,
      result: null,
    },
    error: null,
  };
}

async function runRecognitionDiagnostic(rawUrl, {
  env = process.env,
  validateUrl = validateOutboundUrlWithDns,
  fetchSnapshot = fetchStreamSnapshot,
  recognizeTrack = recognizeTrackFromStream,
} = {}) {
  const report = buildRecognitionReport(rawUrl, env);
  const validation = await validateUrl(rawUrl, {
    allowedProtocols: ["http:", "https:"],
  });

  if (!validation?.ok) {
    report.error = redactSensitiveText(validation?.error || "Stream-URL konnte nicht sicher erreicht werden.");
    return report;
  }

  report.url = sanitizeUrlForLog(validation.url);
  try {
    // Both services use safeFetch internally. In particular, the recognition
    // service feeds its already DNS-pinned response to FFmpeg via pipe:0,
    // rather than allowing FFmpeg to resolve or follow the remote URL itself.
    const streamSnapshot = await fetchSnapshot(validation.url, {
      includeCover: false,
      allowRecognition: false,
    });
    report.stream.metadataSource = redactSensitiveText(streamSnapshot?.metadataSource || "") || null;
    report.stream.metadataStatus = redactSensitiveText(streamSnapshot?.metadataStatus || "") || null;
    report.stream.displayTitle = redactSensitiveText(streamSnapshot?.displayTitle || "") || null;
    report.stream.artist = redactSensitiveText(streamSnapshot?.artist || "") || null;
    report.stream.title = redactSensitiveText(streamSnapshot?.title || "") || null;
    report.stream.album = redactSensitiveText(streamSnapshot?.album || "") || null;
    report.stream.willSkipRecognition = hasUsableStreamTrack(streamSnapshot);

    report.recognition.attempted = true;
    report.recognition.result = redactSensitiveData(
      await recognizeTrack(validation.url, { existingTrack: null }) || null
    );
    report.ok = true;
  } catch (error) {
    report.error = redactSensitiveText(error?.message || error);
  }

  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runRecognitionDiagnostic(process.env.RECOGNITION_TEST_URL || "");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export {
  buildRecognitionReport,
  getRecognitionEnvironment,
  runRecognitionDiagnostic,
};
