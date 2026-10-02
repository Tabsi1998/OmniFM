// Playback commands: /play, /pause, /resume, /stop, /setvolume, /status,
// /diag, /workers.
// Moved out of runtime-interactions.js unchanged (#210); runtime-interactions.js
// dispatches to the map at the end of this file.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { log } from "../../lib/logging.js";
import { clipText } from "../../lib/helpers.js";
import { WORKERS_COMPONENT_ID_OPEN } from "../runtime-links.js";
import { buildNoticePayload, formatWorkerList } from "./command-helpers.js";
import {
  handleDiagCommand,
  handlePlayCommand,
  handleSleepCommand,
  handleStatusCommand,
} from "./playback-info-commands.js";
import { handleSetvolumeCommand } from "./setvolume-command.js";

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
        description: t("Worker-Panel gepostet: {link}", "Worker panel posted: {link}", { link: panelMessage?.url || createdLabel }),
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
      description: t("Pausiert: {workers}", "Paused: {workers}", { workers: formatWorkerList(pausedWorkers) || t("Worker", "worker") }),
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
      description: t("Fortgesetzt: {workers}", "Resumed: {workers}", { workers: formatWorkerList(resumedWorkers) || t("Worker", "worker") }),
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
          description: t("Worker **{worker}** ist nicht konfiguriert oder nicht verfügbar.", "Worker **{worker}** is not configured or not available.", { worker: requestedBot }),
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
          description: t("**{worker}** streamt aktuell nicht auf diesem Server.", "**{worker}** is not currently streaming on this server.", { worker: worker.config?.name || `Bot ${requestedBot}` }),
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
      description: t("Gestoppt: {workers}", "Stopped: {workers}", { workers: formatWorkerList(stoppedWorkers) || t("Worker", "worker") }),
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

export const PLAYBACK_COMMANDS = {
  sleep: handleSleepCommand,
  workers: handleWorkersCommand,
  pause: handlePauseCommand,
  resume: handleResumeCommand,
  stop: handleStopCommand,
  setvolume: handleSetvolumeCommand,
  play: handlePlayCommand,
  status: handleStatusCommand,
  diag: handleDiagCommand,
};
