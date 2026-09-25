// Playback commands: /play, /pause, /resume, /stop, /setvolume, /status,
// /diag, /workers.
// Moved out of runtime-interactions.js unchanged (#210); runtime-interactions.js
// dispatches to the map at the end of this file.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { log } from "../../lib/logging.js";
import { clipText } from "../../lib/helpers.js";
import { getTier } from "../../core/entitlements.js";
import { brandAuthor, brandFooter } from "../brand-embed.js";
import { BRAND } from "../../config/plans.js";
import { buildUserFacingRuntimeStatus } from "../../lib/user-facing-status.js";
import { WORKERS_COMPONENT_ID_OPEN } from "../runtime-links.js";
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

/** /workers */
async function handleWorkersCommand({ runtime, interaction, t, language }) {
  if (runtime.role !== "commander" || !runtime.workerManager) {
    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "warning",
      title: t("🤖 Nur im Commander verfügbar", "🤖 Commander only"),
      description: t("Dieser Befehl ist nur für den Commander-Bot.", "This command is only for the commander bot."),
    }));
    return;
  }

  const guildId = String(interaction.guildId || "").trim();
  if (!guildId) {
    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "warning",
      title: t("🏠 Nur auf Servern verfügbar", "🏠 Available in servers only"),
      description: t(
        "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
        "This command only works inside a Discord server (not in DMs)."
      ),
    }));
    return;
  }
  const view = String(interaction.options?.getString?.("view") || "private").trim().toLowerCase();
  if (view === "panel") {
    if (!runtime.hasGuildManagePermissions(interaction)) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🛠 Rechte fehlen", "🛠 Permission missing"),
        description: t(
          "Du brauchst die Berechtigung `Server verwalten`, um ein öffentliches Worker-Panel zu posten.",
          "You need the `Manage Server` permission to post a public worker panel."
        ),
      }));
      return;
    }

    const channel = interaction.channel;
    if (!channel?.isTextBased?.()) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("💬 Text-Channel nötig", "💬 Text channel required"),
        description: t(
          "In diesem Channel kann ich kein Panel posten. Nutze einen Text-Channel.",
          "I cannot post a panel in this channel. Use a text channel."
        ),
      }));
      return;
    }

    const payload = await runtime.buildWorkersStatusPayload(interaction, {
      hint: t(
        "Dieses Panel bleibt im Channel sichtbar und kann über die Buttons aktualisiert werden.",
        "This panel stays visible in the channel and can be refreshed with the buttons."
      ),
    });
    try {
      const panelMessage = await channel.send(payload);
      const createdLabel = t("Nachricht erstellt.", "Message created.");
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "success",
        title: t("📋 Worker-Panel gepostet", "📋 Worker panel posted"),
        description: t(
          `Worker-Panel gepostet: ${panelMessage?.url || createdLabel}`,
          `Worker panel posted: ${panelMessage?.url || createdLabel}`
        ),
      }));
    } catch (err) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "danger",
        title: t("✖ Worker-Panel fehlgeschlagen", "✖ Worker panel failed"),
        description: t(
          "Worker-Panel konnte nicht gepostet werden. Prüfe meine Schreibrechte in diesem Channel.",
          "Could not post the worker panel. Check my send-message permission in this channel."
        ),
      }));
      log("WARN", `[${runtime.config.name}] Workers panel post failed guild=${guildId} channel=${channel?.id || "-"}: ${err?.message || err}`);
    }
    return;
  }

  const payload = await runtime.buildWorkersStatusPayload(interaction);
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  return;
}

/** /pause */
async function handlePauseCommand({ runtime, interaction, t, language, state }) {
  const requestedBot = interaction.options.getInteger("bot");
  if (runtime.role === "commander" && runtime.workerManager) {
    const workers = requestedBot
      ? [runtime.workerManager.getWorkerByIndex(requestedBot, { prefer: "slot", strict: true })].filter(Boolean)
      : runtime.workerManager.getStreamingWorkers(interaction.guildId);
    if (workers.length === 0) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("⏸ Nichts zu pausieren", "⏸ Nothing to pause"),
        description: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."),
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }
    const failures = [];
    const pausedWorkers = [];
    const results = await Promise.all(workers.map(async (w) => ({
      worker: w,
      result: await w.pauseInGuild(interaction.guildId).catch((err) => ({ ok: false, error: err?.message || "pause_failed" })),
    })));
    for (const { worker: w, result } of results) {
      if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "pause_failed"}`);
      else pausedWorkers.push(w);
    }
    await runtime.workerManager.refreshRemoteStates?.({ force: true })?.catch?.(() => null);
    if (failures.length === workers.length) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "danger",
        title: t("✖ Pause fehlgeschlagen", "✖ Pause failed"),
        description: clipText(failures.join("\n"), 3500),
      }));
      return;
    }
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: failures.length > 0 ? "warning" : "success",
      title: t("⏸ Wiedergabe pausiert", "⏸ Playback paused"),
      description: t(
        `Pausiert: ${formatWorkerList(pausedWorkers) || t("Worker", "worker")}`,
        `Paused: ${formatWorkerList(pausedWorkers) || t("worker", "worker")}`
      ),
      fields: failures.length > 0 ? [{ name: t("Fehler", "Errors"), value: clipText(failures.join("\n"), 1024), inline: false }] : [],
      quickActions: { includePlay: true, includeStations: true },
    }));
    return;
  }
  if (!state.currentStationKey) {
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: "info",
      title: t("⏸ Nichts zu pausieren", "⏸ Nothing to pause"),
      description: t("Es läuft nichts.", "Nothing is playing."),
      quickActions: { includePlay: true, includeStations: true },
    }));
    return;
  }
  await runtime.pauseInGuild(interaction.guildId);
  await runtime.respondInteraction(interaction, buildNoticePayload({
    t,
    language,
    tone: "success",
    title: t("⏸ Wiedergabe pausiert", "⏸ Playback paused"),
    description: t("Der Stream wurde pausiert.", "The stream was paused."),
    quickActions: { includePlay: true, includeStations: true },
  }));
  return;
}

/** /resume */
async function handleResumeCommand({ runtime, interaction, t, language, state }) {
  const requestedBot = interaction.options.getInteger("bot");
  if (runtime.role === "commander" && runtime.workerManager) {
    const workers = requestedBot
      ? [runtime.workerManager.getWorkerByIndex(requestedBot, { prefer: "slot", strict: true })].filter(Boolean)
      : runtime.workerManager.getStreamingWorkers(interaction.guildId);
    if (workers.length === 0) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("▶ Nichts zum Fortsetzen", "▶ Nothing to resume"),
        description: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."),
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }
    const failures = [];
    const resumedWorkers = [];
    const results = await Promise.all(workers.map(async (w) => ({
      worker: w,
      result: await w.resumeInGuild(interaction.guildId).catch((err) => ({ ok: false, error: err?.message || "resume_failed" })),
    })));
    for (const { worker: w, result } of results) {
      if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "resume_failed"}`);
      else resumedWorkers.push(w);
    }
    await runtime.workerManager.refreshRemoteStates?.({ force: true })?.catch?.(() => null);
    if (failures.length === workers.length) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "danger",
        title: t("✖ Fortsetzen fehlgeschlagen", "✖ Resume failed"),
        description: clipText(failures.join("\n"), 3500),
      }));
      return;
    }
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: failures.length > 0 ? "warning" : "success",
      title: t("▶ Wiedergabe fortgesetzt", "▶ Playback resumed"),
      description: t(
        `Fortgesetzt: ${formatWorkerList(resumedWorkers) || t("Worker", "worker")}`,
        `Resumed: ${formatWorkerList(resumedWorkers) || t("worker", "worker")}`
      ),
      fields: failures.length > 0 ? [{ name: t("Fehler", "Errors"), value: clipText(failures.join("\n"), 1024), inline: false }] : [],
    }));
    return;
  }
  if (!state.currentStationKey) {
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: "info",
      title: t("▶ Nichts zum Fortsetzen", "▶ Nothing to resume"),
      description: t("Es läuft nichts.", "Nothing is playing."),
      quickActions: { includePlay: true, includeStations: true },
    }));
    return;
  }
  await runtime.resumeInGuild(interaction.guildId);
  await runtime.respondInteraction(interaction, buildNoticePayload({
    t,
    language,
    tone: "success",
    title: t("▶ Wiedergabe fortgesetzt", "▶ Playback resumed"),
    description: t("Der Stream läuft wieder.", "The stream is playing again."),
  }));
  return;
}

/** /stop */
async function handleStopCommand({ runtime, interaction, t, language }) {
  const requestedBot = interaction.options.getInteger("bot");
  const stopAll = interaction.options.getBoolean("all");
  
  if (runtime.role === "commander" && runtime.workerManager) {
    const guildId = interaction.guildId;
    let workers;
    
    // Priorität 1: Explizit bot: Parameter
    if (requestedBot) {
      const worker = runtime.workerManager.getWorkerByIndex(requestedBot, { prefer: "slot", strict: true });
      if (!worker) {
        // Worker-Index nicht gefunden / nicht konfiguriert
        await runtime.respondInteraction(interaction, buildNoticePayload({
          t,
          language,
          tone: "warning",
          title: t("🤖 Worker nicht gefunden", "🤖 Worker not found"),
          description: t(
            `Worker **${requestedBot}** ist nicht konfiguriert oder nicht verfügbar.`,
            `Worker **${requestedBot}** is not configured or not available.`
          ),
          extraComponents: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t("🤖 Worker anzeigen", "🤖 Show workers"))
            ),
          ],
        }));
        return;
      }
      const streamingWorkers = runtime.workerManager.getStreamingWorkers(guildId);
      if (!streamingWorkers.includes(worker)) {
        await runtime.respondInteraction(interaction, buildNoticePayload({
          t,
          language,
          tone: "info",
          title: t("🛑 Dieser Bot streamt nicht", "🛑 This bot is not streaming"),
          description: t(
            `**${worker.config?.name || `Bot ${requestedBot}`}** streamt aktuell nicht auf diesem Server.`,
            `**${worker.config?.name || `Bot ${requestedBot}`}** is not currently streaming on this server.`
          ),
          fields: streamingWorkers.length > 0
            ? [{
              name: t("Aktive Worker", "Active workers"),
              value: clipText(formatWorkerList(streamingWorkers), 1024),
              inline: false,
            }]
            : [],
          quickActions: { includePlay: true, includeStations: true, includeWorkers: true },
        }));
        return;
      }
      workers = [worker];
    }
    // Priorität 2: all: true Parameter
    else if (stopAll) {
      workers = runtime.workerManager.getStreamingWorkers(guildId);
    }
    // Priorität 3: User im Voice-Channel → stoppe nur Worker in diesem Channel
    else {
      const guild = interaction.guild || runtime.client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
      const userChannelId = String(member?.voice?.channelId || "").trim();
      
      if (userChannelId) {
        // User ist in Channel → stoppe nur Worker in diesem Channel
        const allStreamingWorkers = runtime.workerManager.getStreamingWorkers(guildId);
        const matchingWorkers = allStreamingWorkers.filter((worker) => {
          const info = worker.getGuildInfo(guildId);
          return String(info?.channelId || "").trim() === userChannelId;
        });
        if (matchingWorkers.length > 0) {
          workers = matchingWorkers;
        } else {
          await runtime.respondInteraction(interaction, buildNoticePayload({
            t,
            language,
            tone: "info",
            title: t("🛑 Kein Worker in deinem Channel", "🛑 No worker in your channel"),
            description: t(
              "In deinem Voice-Channel wurde kein aktiver OmniFM-Worker gefunden. Nutze `/stop bot:<botnummer>` oder `/stop all:true`, damit nichts Falsches gestoppt wird.",
              "No active OmniFM worker was found in your voice channel. Use `/stop bot:<bot number>` or `/stop all:true` so the wrong stream is not stopped."
            ),
            fields: allStreamingWorkers.length > 0
              ? [{
                name: t("Aktive Worker", "Active workers"),
                value: clipText(formatWorkerList(allStreamingWorkers), 1024),
                inline: false,
              }]
              : [],
            quickActions: { includePlay: true, includeStations: true, includeWorkers: true },
          }));
          return;
        }
      } else {
        // User nicht im Channel → Error
        await runtime.respondInteraction(interaction, buildNoticePayload({
          t,
          language,
          tone: "info",
          title: t("🛑 Worker auswählen", "🛑 Choose a worker"),
          description: t(
            "Du musst in einem Voice-Channel sein oder `/stop bot:<nummer>` / `/stop all:true` nutzen.",
            "You must be in a voice channel or use `/stop bot:<number>` / `/stop all:true`."
          ),
          extraComponents: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
            ),
          ],
        }));
        return;
      }
    }
    
    if (workers.length === 0) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("🛑 Nichts zu stoppen", "🛑 Nothing to stop"),
        description: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."),
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }
    const failures = [];
    const stoppedWorkers = [];
    const results = await Promise.all(workers.map(async (w) => ({
      worker: w,
      result: await w.stopInGuild(guildId).catch((err) => ({ ok: false, error: err?.message || "stop_failed" })),
    })));
    for (const { worker: w, result } of results) {
      if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "stop_failed"}`);
      else stoppedWorkers.push(w);
    }
    await runtime.workerManager.refreshRemoteStates?.({ force: true })?.catch?.(() => null);
    if (failures.length === workers.length) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "danger",
        title: t("✖ Stop fehlgeschlagen", "✖ Stop failed"),
        description: clipText(failures.join("\n"), 3500),
      }));
      return;
    }
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: failures.length > 0 ? "warning" : "success",
      title: t("🛑 Wiedergabe gestoppt", "🛑 Playback stopped"),
      description: t(
        `Gestoppt: ${formatWorkerList(stoppedWorkers) || t("Worker", "worker")}`,
        `Stopped: ${formatWorkerList(stoppedWorkers) || t("worker", "worker")}`
      ),
      fields: failures.length > 0 ? [{ name: t("Fehler", "Errors"), value: clipText(failures.join("\n"), 1024), inline: false }] : [],
      quickActions: { includePlay: true, includeStations: true },
    }));
    return;
  }
  
  // Worker/Legacy Mode: lokaler Stop
  await runtime.stopInGuild(interaction.guildId);

  await runtime.respondInteraction(interaction, buildNoticePayload({
    t,
    language,
    tone: "success",
    title: t("🛑 Wiedergabe gestoppt", "🛑 Playback stopped"),
    description: t("Gestoppt und Channel verlassen.", "Stopped and left the channel."),
    quickActions: { includePlay: true, includeStations: true },
  }));
  return;
}

/** /setvolume */
async function handleSetvolumeCommand({ runtime, interaction, t, language }) {
  const value = interaction.options.getInteger("value", true);
  if (value < 0 || value > 100) {
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: "warning",
      title: t("🎚 Lautstärke ungültig", "🎚 Invalid volume"),
      description: t("Wert muss zwischen 0 und 100 liegen.", "Value must be between 0 and 100."),
    }));
    return;
  }
  if (runtime.role === "commander" && runtime.workerManager) {
    const requestedBot = runtime.getIntegerOptionFlexible(interaction, ["bot", "worker"]);
    const guildTier = getTier(interaction.guildId);
    let targetWorkers = [];

    if (Number.isInteger(requestedBot)) {
      const check = runtime.workerManager.canUseWorker(requestedBot, interaction.guildId, guildTier, { prefer: "slot", strict: true });
      if (!check.ok) {
        const reasons = {
          tier: t(`Worker ${requestedBot} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBot} requires a higher plan (max: ${check.maxIndex}).`),
          not_configured: t(`Worker ${requestedBot} ist nicht konfiguriert.`, `Worker ${requestedBot} is not configured.`),
          offline: t(`Worker ${requestedBot} ist offline.`, `Worker ${requestedBot} is offline.`),
          not_invited: t(`Worker ${requestedBot} ist nicht auf diesem Server eingeladen.`, `Worker ${requestedBot} is not invited on this server.`),
        };
        await runtime.respondInteraction(interaction, buildNoticePayload({
          t,
          language,
          tone: "warning",
          title: t("🤖 Worker nicht verfügbar", "🤖 Worker not available"),
          description: reasons[check.reason] || t("Worker nicht verfügbar.", "Worker not available."),
        }));
        return;
      }
      targetWorkers = [check.worker];
    } else {
      const workers = runtime.workerManager.getStreamingWorkers(interaction.guildId);
      if (workers.length === 0) {
        const invitedWorkers = runtime.workerManager.getInvitedWorkers(interaction.guildId, guildTier);
        if (invitedWorkers.length === 1) {
          targetWorkers = invitedWorkers;
        } else if (invitedWorkers.length === 0) {
          await runtime.respondInteraction(interaction, buildNoticePayload({
            t,
            language,
            tone: "warning",
            title: t("🤖 Kein Worker eingeladen", "🤖 No worker invited"),
            description: t("Kein Worker ist auf diesem Server eingeladen.", "No worker is invited on this server."),
            quickActions: { includeInvite: true, includeWorkers: true },
          }));
          return;
        } else {
          await runtime.respondInteraction(interaction, buildNoticePayload({
            t,
            language,
            tone: "info",
            title: t("🎚 Worker auswählen", "🎚 Choose a worker"),
            description: t(
              "Aktuell streamt kein Worker. Nutze `/setvolume <value> bot:<nummer>`, um die Lautstärke für einen bestimmten Worker zu speichern.",
              "No worker is currently streaming. Use `/setvolume <value> bot:<number>` to save the volume for a specific worker."
            ),
            extraComponents: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                  .setStyle(ButtonStyle.Secondary)
                  .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
              ),
            ],
          }));
          return;
        }
      }

      if (workers.length > 0) {
        const guild = interaction.guild || runtime.client.guilds.cache.get(interaction.guildId);
        const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
        const userChannelId = String(member?.voice?.channelId || "").trim();
        if (userChannelId) {
          const matchingByChannel = workers.filter((worker) => {
            const info = worker.getGuildInfo(interaction.guildId);
            return String(info?.channelId || "").trim() === userChannelId;
          });
          if (matchingByChannel.length === 1) {
            targetWorkers = matchingByChannel;
          }
        }

        if (targetWorkers.length === 0 && workers.length === 1) {
          targetWorkers = workers;
        }
        if (targetWorkers.length === 0 && workers.length > 1) {
          await runtime.respondInteraction(interaction, buildNoticePayload({
            t,
            language,
            tone: "info",
            title: t("🎚 Worker auswählen", "🎚 Choose a worker"),
            description: t(
              "Mehrere Worker streamen aktuell. Nutze `/setvolume <value> bot:<nummer>` oder tritt dem Ziel-Voice-Channel bei.",
              "Multiple workers are currently streaming. Use `/setvolume <value> bot:<number>` or join the target voice channel."
            ),
            extraComponents: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                  .setStyle(ButtonStyle.Secondary)
                  .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
              ),
            ],
          }));
          return;
        }
      }
    }

    if (targetWorkers.length === 0) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🔎 Kein passender Worker", "🔎 No matching worker"),
        description: t("Kein passender Worker gefunden.", "No matching worker found."),
      }));
      return;
    }
    const failures = [];
    const appliedWorkers = [];
    const savedWorkers = [];
    const results = await Promise.all(targetWorkers.map(async (worker) => ({
      worker,
      result: await worker.setVolumeInGuild(interaction.guildId, value).catch((err) => ({ ok: false, error: err?.message || "setvolume_failed" })),
    })));
    for (const { worker, result } of results) {
      if (!result?.ok) {
        failures.push(`${worker.config?.name || "Worker"}: ${result?.error || "setvolume_failed"}`);
        continue;
      }
      if (result?.appliedLive) {
        appliedWorkers.push(worker.config?.name || "Worker");
      } else {
        savedWorkers.push(worker.config?.name || "Worker");
      }
    }
    if (failures.length === targetWorkers.length) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "danger",
        title: t("✖ Lautstärke konnte nicht gesetzt werden", "✖ Could not change volume"),
        description: clipText(failures.join("\n"), 3500),
      }));
      return;
    }
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: failures.length > 0 ? "warning" : "success",
      title: t("🎚 Lautstärke aktualisiert", "🎚 Volume updated"),
      description: t(`Zielwert: **${value}**`, `Target value: **${value}**`),
      fields: [
        ...(appliedWorkers.length > 0 ? [{
          name: t("Direkt angewendet", "Applied live"),
          value: clipText(appliedWorkers.join(", "), 1024),
          inline: false,
        }] : []),
        ...(savedWorkers.length > 0 ? [{
          name: t("Gespeichert für später", "Saved for later"),
          value: clipText(savedWorkers.join(", "), 1024),
          inline: false,
        }] : []),
        ...(failures.length > 0 ? [{
          name: t("Fehler", "Errors"),
          value: clipText(failures.join("\n"), 1024),
          inline: false,
        }] : []),
      ],
    }));
    return;
  }
  const result = await runtime.setVolumeInGuild(interaction.guildId, value);
  if (!result?.ok) {
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: "danger",
      title: t("✖ Lautstärke konnte nicht gesetzt werden", "✖ Could not change volume"),
      description: t(`Fehler: ${result?.error || "setvolume_failed"}`, `Error: ${result?.error || "setvolume_failed"}`),
    }));
    return;
  }
  await runtime.respondInteraction(interaction, buildNoticePayload({
    t,
    language,
    tone: "success",
    title: t("🎚 Lautstärke aktualisiert", "🎚 Volume updated"),
    description: result.appliedLive
      ? t(`Lautstärke gesetzt: **${value}**`, `Volume set to: **${value}**`)
      : t(
        `Lautstärke gespeichert: **${value}**. Wird beim nächsten Start verwendet.`,
        `Volume saved: **${value}**. It will be used for the next playback.`
      ),
  }));
  return;
}

/** /play */
async function handlePlayCommand({ runtime, interaction }) {
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
async function handleStatusCommand({ runtime, interaction, t, language }) {
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
      ui.text(`${ui.icon("info")} ${userStatus.nextStep}`),
    ],
    actions: [
      buildQuickActionRow(t, {
        includePlay: true,
        includeStations: true,
        includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager),
      }),
      buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
    ],
    footer: "/status",
  })));
  return;
}

/** /diag */
async function handleDiagCommand({ runtime, interaction, t, language }) {
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

export const PLAYBACK_COMMANDS = {
  workers: handleWorkersCommand,
  pause: handlePauseCommand,
  resume: handleResumeCommand,
  stop: handleStopCommand,
  setvolume: handleSetvolumeCommand,
  play: handlePlayCommand,
  status: handleStatusCommand,
  diag: handleDiagCommand,
};
