// ============================================================
// OmniFM: Audio Stream Resource Creation
// ============================================================
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import {
  createAudioResource,
  demuxProbe,
  StreamType,
} from "@discordjs/voice";
import { log, shouldLogFfmpegStderrLine } from "../lib/logging.js";
import {
  clipText,
  applyVolumeTransformerLevel,
  sanitizeUrlForLog,
  buildTranscodeProfile,
  isLikelyNetworkFailureLine,
} from "../lib/helpers.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import { safeFetch } from "../lib/safe-outbound-http.js";

async function createResource(url, volume, qualityPreset, botName, bitrateOverride, networkScope = null) {
  const streamResponse = await safeFetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "OmniFM/3.0" },
    timeoutMs: 10_000,
  });
  if (!streamResponse.ok || !streamResponse.body) {
    try {
      await streamResponse.body?.cancel?.();
    } catch {
      // ignore
    }
    throw new Error(`Stream konnte nicht geladen werden: ${streamResponse.status}`);
  }
  const recoveryOptions = networkScope ? { scope: networkScope } : undefined;
  const preset = qualityPreset || "custom";
  const presetBitrate =
    preset === "low" ? "96k" : preset === "medium" ? "128k" : preset === "high" ? "192k" : null;
  const profile = buildTranscodeProfile({ bitrateOverride, qualityPreset: preset });

  const transcode = String(process.env.TRANSCODE || "0") === "1" || preset !== "custom" || !!bitrateOverride;
  if (transcode) {
    const mode = String(process.env.TRANSCODE_MODE || "opus").toLowerCase();
    const args = [
      "-loglevel", "warning",
      "-fflags", "+genpts+discardcorrupt",
      "-probesize", profile.probeSize,
      "-analyzeduration", profile.analyzeDuration,
      "-thread_queue_size", profile.threadQueueSize,
      "-rtbufsize", profile.rtbufsize,
      "-max_delay", profile.maxDelayUs,
      "-i", "pipe:0",
      "-ar", "48000",
      "-ac", "2",
      "-vn",
      "-af", "aresample=async=1:first_pts=0",
      "-flush_packets", profile.outputFlushPackets,
    ];

    let inputType = StreamType.Raw;
    if (mode === "opus") {
      const bitrate = bitrateOverride || presetBitrate || String(process.env.OPUS_BITRATE || "192k");
      const vbr = String(process.env.OPUS_VBR || "on");
      const compression = String(process.env.OPUS_COMPRESSION || "5");
      const frame = String(process.env.OPUS_FRAME || "20");
      const application = String(process.env.OPUS_APPLICATION || (profile.isUltra ? "audio" : "lowdelay")).toLowerCase();
      const packetLoss = String(process.env.OPUS_PACKET_LOSS || (profile.isUltra ? "8" : "3"));

      args.push(
        "-c:a", "libopus",
        "-b:a", bitrate,
        "-vbr", vbr,
        "-compression_level", compression,
        "-frame_duration", frame,
        "-application", application,
        "-packet_loss", packetLoss,
        "-cutoff", "20000",
        "-f", "ogg",
        "pipe:1"
      );
      inputType = StreamType.OggOpus;
    } else {
      args.push("-f", "s16le", "-acodec", "pcm_s16le", "pipe:1");
      inputType = StreamType.Raw;
    }

    log("INFO", `[${botName}] ffmpeg profile=${profile.isUltra ? "ultra-stable" : "stable"} bitrate=${profile.requestedKbps}k queue=${profile.threadQueueSize} probe=${profile.probeSize} analyzeUs=${profile.analyzeDuration}`);
    const loggedArgs = args.map((value, index) => {
      const raw = String(value || "");
      if ((index > 0 && args[index - 1] === "-i") || /^https?:\/\//i.test(raw)) {
        return sanitizeUrlForLog(raw);
      }
      return raw;
    });
    log("INFO", `[${botName}] ffmpeg ${loggedArgs.join(" ")}`);
    const ffmpeg = spawn("ffmpeg", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" }
    });
    const source = Readable.fromWeb(streamResponse.body);
    source.once("error", (error) => {
      try {
        ffmpeg.stdin.destroy(error);
      } catch {
        // ignore
      }
    });
    ffmpeg.stdin.once("error", () => source.destroy());
    ffmpeg.once("close", () => source.destroy());
    source.pipe(ffmpeg.stdin);

    let stderrBuffer = "";
    ffmpeg.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (isLikelyNetworkFailureLine(trimmed)) {
          networkRecoveryCoordinator.noteFailure(`${botName} ffmpeg`, trimmed, recoveryOptions);
        }
        if (!shouldLogFfmpegStderrLine(trimmed)) continue;
        log("INFO", `[${botName}] ffmpeg: ${clipText(trimmed, 500)}`);
      }
    });

    ffmpeg.stdout.once("data", () => {
      networkRecoveryCoordinator.noteSuccess(`${botName} ffmpeg audio`, recoveryOptions);
    });

    ffmpeg.on("error", (err) => {
      source.destroy(err);
      log("ERROR", `[${botName}] ffmpeg process error: ${err?.message || err}`);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType,
      inlineVolume: true,
    });
    applyVolumeTransformerLevel(resource.volume, volume);

    return { resource, process: ffmpeg };
  }

  const stream = Readable.fromWeb(streamResponse.body);
  networkRecoveryCoordinator.noteSuccess(`${botName} fetch-stream`, recoveryOptions);

  // ---- Fix: demuxProbe() kann bei kaputten Streams ewig haengen ----
  // Promise.race() mit Timeout verhindert dass der Bot haengt.
  const DEMUX_TIMEOUT_MS = 15_000;
  const probe = await Promise.race([
    demuxProbe(stream),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`demuxProbe Timeout nach ${DEMUX_TIMEOUT_MS}ms`)),
        DEMUX_TIMEOUT_MS
      )
    ),
  ]);

  const resource = createAudioResource(probe.stream, { inputType: probe.type, inlineVolume: true });
  applyVolumeTransformerLevel(resource.volume, volume);

  return { resource, process: null };
}

export { createResource };
