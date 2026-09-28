// OmniFM: /play, /status, /diag and /sleep.
// Split out of src/bot/commands/playback-commands.js (#295).
import { EmbedBuilder, MessageFlags } from "discord.js";
import { clipText } from "../../lib/helpers.js";
import { brandAuthor, brandFooter } from "../brand-embed.js";
import { BRAND } from "../../config/plans.js";
import { buildUserFacingRuntimeStatus } from "../../lib/user-facing-status.js";
import { executeRuntimePlay } from "../runtime-panels.js";
import { describeRecoverySettings } from "../../config/recovery-settings.js";
import {
  buildQuickActionRow,
  buildSupportRow,
  buildNoticePayload,
  formatWorkerList,
  buildStreamingRuntimeSelectionPayload,
} from "./command-helpers.js";
import { derivePlaybackPhase, describePlaybackPhaseHistory } from "../playback-phase.js";
import * as ui from "../../discord/ui/index.js";
import { normalizeSleepMinutes } from "../runtime-methods/sleep.js";

/** /play */
export async function handlePlayCommand({ runtime, interaction }) {
  await executeRuntimePlay(runtime, interaction, {
    station: interaction.options.getString("station"),
    requestedVoiceChannel: interaction.options.getChannel("voice"),
    requestedBotIndex: interaction.options.getInteger("bot"),
    requestedWorkerSelectionMode: "slot",
    openWizardWhenIncomplete: true,
  });
  return;
}

/** /status */
export async function handleStatusCommand({ runtime, interaction, t, language }) {
  const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
  if (!playback.runtime || !playback.state) {
    await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language));
    return;
  }
  const activeRuntime = playback.runtime;
  const activeState = playback.state;
  const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
  const resolvedChannel = /^\d{16,22}$/.test(String(channelId))
    ? `<#${channelId}>`
    : String(channelId || "-");
  const userStatus = buildUserFacingRuntimeStatus({
    ready: activeRuntime.client?.isReady?.() === true,
    connected: Boolean(activeState.connection),
    playing: activeState.player?.state?.status === "playing" || activeState.connection?.state?.status === "ready",
    shouldReconnect: activeState.shouldReconnect === true,
    reconnectPending: Boolean(activeState.reconnectTimer),
    reconnectInFlight: activeState.reconnectInFlight === true,
    streamRestartPending: Boolean(activeState.streamRestartTimer),
    voiceConnectInFlight: activeState.voiceConnectInFlight === true,
    reconnectAttempts: activeState.reconnectAttempts || 0,
    streamErrorCount: activeState.streamErrorCount || 0,
    stationName: activeState.currentStationName || activeState.currentStationKey || "-",
    channelLabel: resolvedChannel,
    listeners: typeof activeRuntime.getCurrentListenerCount === "function"
      ? Number(activeRuntime.getCurrentListenerCount(interaction.guildId, activeState) || 0) || 0
      : 0,
    voiceGuardLastAction: activeState.voiceGuardLastAction || null,
    parkedReason: activeState.parkedReason || null,
    serverMuted: activeState.serverMuted === true,
    failoverActive: activeState.failoverActive === true,
    desiredStationName: activeState.desiredStationName || activeState.desiredStationKey || null,
    failbackNextProbeAt: Number(activeState.failbackNextProbeAt || 0) || 0,
  }, { t });

  // First command on the Discord design system (#264): one container in the
  // colour of the status, the actions inside, the brand line at the bottom.
  await interaction.reply(ui.reply(ui.panel({
    accent: userStatus.accent,
    title: t("Bot-Status", "Bot status"),
    subtitle: ui.statusLine([activeRuntime.config.name, interaction.guild?.name || interaction.guildId]),
    body: [
      ui.text([
        ui.field(t("Status", "Status"), userStatus.label),
        ui.field(t("Aktuell", "Currently"), userStatus.summary),
        ui.field(t("Wiedergabe", "Playback"), userStatus.playback),
      ].join("\n\n")),
      ui.separator({ divider: false }),
      ui.text(`${ui.icon("info", interaction.applicationId)} ${userStatus.nextStep}`),
    ],
    actions: [
      buildQuickActionRow(t, {
        includePlay: true,
        includeStations: true,
        includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager),
      }),
      buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true, includeStatusPage: true }),
    ],
    footer: "/status",
  })));
  return;
}

/** /diag */
export async function handleDiagCommand({ runtime, interaction, t, language }) {
  const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
  if (!playback.runtime || !playback.state) {
    await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language));
    return;
  }
  const activeRuntime = playback.runtime;
  const activeState = playback.state;
  const connected = activeState.connection ? t("ja", "yes") : t("nein", "no");
  const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
  const station = activeState.currentStationKey || "-";
  const diag = runtime.getStreamDiagnostics(interaction.guildId, activeState);
  const restartPending = activeState.streamRestartTimer ? t("ja", "yes") : t("nein", "no");
  const reconnectPending = activeState.reconnectTimer ? t("ja", "yes") : t("nein", "no");
  const networkHoldMs = activeRuntime.getNetworkRecoveryDelayMs(interaction.guildId);
  const resolvedChannel = /^\d{16,22}$/.test(String(channelId))
    ? `<#${channelId}>`
    : String(channelId || "-");

  const diagEmbed = new EmbedBuilder()
    .setColor(connected === t("ja", "yes") ? BRAND.proColor : BRAND.color)
    .setTitle(t("Stream-Diagnose", "Stream diagnostics"))
    .setDescription(`${activeRuntime.config.name} | ${interaction.guild?.name || interaction.guildId}`)
    .addFields(
      {
        name: t("Stream-Profil", "Stream profile"),
        value: [
          `Plan: ${diag.tier.toUpperCase()}`,
          `preset=${diag.preset}`,
          `transcode=${diag.transcodeEnabled ? "on" : "off"} (${diag.transcodeMode})`,
          `${t("Bitrate Ziel", "Target bitrate")}: ${diag.bitrateOverride || "-"} (${diag.requestedBitrateKbps}k)`,
          `${t("Profil", "Profile")}: ${diag.profile}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "FFmpeg",
        value: `queue=${diag.queue} | probe=${diag.probeSize} | analyzeUs=${diag.analyzeUs}`,
        inline: false,
      },
      {
        name: t("Wiedergabe", "Playback"),
        value: [
          `${t("Verbunden", "Connected")}: ${connected}`,
          `Channel: ${resolvedChannel}`,
          `Station: ${station}`,
          `${t("Stream-Laufzeit", "Stream lifetime")}: ${diag.streamLifetimeSec}s`,
          `${t("Fehler (Reihe)", "Errors (streak)")}: ${activeState.streamErrorCount || 0}`,
          `${t("Restart geplant", "Restart pending")}: ${restartPending}`,
          `${t("Reconnect geplant", "Reconnect pending")}: ${reconnectPending}`,
          `${t("Netz-Cooldown", "Network cooldown")}: ${networkHoldMs > 0 ? `${Math.round(networkHoldMs)}ms` : "0ms"}`,
          `${t("Geparkt", "Parked")}: ${activeState.parkedReason
              ? `${activeState.parkedReason}${Number(activeState.parkedAt || 0) > 0 ? ` (${t("seit", "since")} <t:${Math.floor(Number(activeState.parkedAt) / 1000)}:R>)` : ""}`
              : t("nein", "no")}`,
          `Failover: ${activeState.failoverActive === true
              ? `${t("aktiv", "active")} (${t("Wunschsender", "preferred")}: ${activeState.desiredStationName || activeState.desiredStationKey || "-"}${Number(activeState.failbackNextProbeAt || 0) > 0
              ? `, ${t("naechste Pruefung", "next check")} <t:${Math.floor(Number(activeState.failbackNextProbeAt) / 1000)}:R>`
              : ""})`
              : t("nein", "no")}`,
          `${t("Server-Stummschaltung", "Server mute")}: ${activeState.serverMuted === true ? t("ja", "yes") : t("nein", "no")}`,
        ].join("\n"),
        inline: false,
      },
      {
        // Where playback stands and how it got there (#210).
        name: t("Wiedergabe-Phase", "Playback phase"),
        value: [
          `${derivePlaybackPhase(activeState)}${Number(activeState.playbackPhaseSince || 0) > 0
            ? ` (${t("seit", "since")} <t:${Math.floor(Number(activeState.playbackPhaseSince) / 1000)}:R>)`
            : ""}`,
          ...describePlaybackPhaseHistory(activeState, { limit: 5, t }),
        ].join("\n").slice(0, 1024),
        inline: false,
      },
      {
        // The values the runtime works with, from the owner console or the
        // environment (#217), so support can read them.
        name: t("Recovery-Werte", "Recovery settings"),
        value: describeRecoverySettings(process.env, t).join("\n").slice(0, 1024),
        inline: false,
      }
    );

  diagEmbed.setAuthor(brandAuthor());
  diagEmbed.setFooter(brandFooter(t("OmniFM · /diag", "OmniFM · /diag")));
  diagEmbed.setTimestamp(new Date());

  await interaction.reply({
    embeds: [diagEmbed],
    components: [
      buildQuickActionRow(t, {
        includePlay: true,
        includeStations: true,
        includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager),
      }),
      buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
    ].filter(Boolean),
    flags: MessageFlags.Ephemeral,
  });
  return;
}

/** /sleep (#275): the streaming workers of the server turn off softly later. */
export async function handleSleepCommand({ runtime, interaction, t, language, state }) {
  const minutes = normalizeSleepMinutes(interaction.options.getString("duration"));
  const requestedBot = interaction.options.getInteger("bot");
  const workers = runtime.role === "commander" && runtime.workerManager
    ? (requestedBot
      ? [runtime.workerManager.getWorkerByIndex(requestedBot, { prefer: "slot", strict: true })].filter(Boolean)
      : runtime.workerManager.getStreamingWorkers(interaction.guildId))
    : (state?.currentStationKey ? [runtime] : []);
  if (workers.length === 0) {
    await runtime.respondInteraction(interaction, buildNoticePayload({ t, language, code: "nothing-playing" }));
    return;
  }
  const results = await Promise.all(workers.map(async (worker) => ({
    worker,
    result: await worker.setSleepTimerInGuild(interaction.guildId, minutes).catch((err) => ({ ok: false, error: err?.message || "sleep_failed" })),
  })));
  const done = results.filter(({ result }) => result?.ok);
  if (!done.length) {
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t, language, code: "failed", params: { detail: clipText(results.map(({ result }) => result?.error).filter(Boolean).join(", "), 300) },
    }));
    return;
  }
  const until = Math.max(...done.map(({ result }) => Number(result.sleepUntilMs) || 0));
  const unix = Math.floor(until / 1000);
  await runtime.respondInteraction(interaction, ui.reply(ui.notice(minutes ? "success" : "info", {
    title: minutes ? t("Sleep-Timer an", "Sleep timer on") : t("Sleep-Timer aus", "Sleep timer off"),
    body: minutes
      ? t(
        `😴 ${formatWorkerList(done.map(({ worker }) => worker))} schaltet <t:${unix}:R> leise aus (um <t:${unix}:t>). Eine Minute vorher kommt ein Hinweis mit „+30 min“.`,
        `😴 ${formatWorkerList(done.map(({ worker }) => worker))} turns off softly <t:${unix}:R> (at <t:${unix}:t>). A minute before, a note with “+30 min” comes.`
      )
      : t("OmniFM spielt weiter, bis ihr stoppt.", "OmniFM keeps playing until you stop it."),
  })));
}
