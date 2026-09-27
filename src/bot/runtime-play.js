// OmniFM: resolving the station to play, delegating to a worker and /play itself.
// Split out of src/bot/runtime-panels.js (#295).
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { buildVoiceChannelAccessMessage } from "../lib/user-facing-setup.js";
import { premiumStationEmbed, customStationEmbed } from "../ui/upgradeEmbeds.js";
import { log } from "../lib/logging.js";
import { loadStations, resolveStation, buildScopedStationsData } from "../stations-store.js";
import {
  getGuildStations,
  buildCustomStationReference,
  validateCustomStationUrl,
  customStationLogoUrl,
} from "../custom-stations.js";
import { translateCustomStationErrorMessage } from "../lib/language.js";
import { PLAY_COMPONENT_ID_OPEN, STATIONS_COMPONENT_ID_OPEN } from "./runtime-links.js";
import { buildOmniEmbed } from "./discord-ui.js";
import { buildNoticePayload } from "./commands/command-helpers.js";
import {
  buildStationCatalog,
  getTierConfig,
  openRuntimePlayWizard,
  resolveExplicitVoiceChannel,
} from "./runtime-panels.js";

export async function respondWithPayload(runtime, interaction, payload, { update = false } = {}) {
  if (update && typeof interaction.update === "function" && !interaction.deferred && !interaction.replied) {
    const updatePayload = { ...payload };
    delete updatePayload.flags;
    await interaction.update(updatePayload);
    return;
  }
  await runtime.respondInteraction(interaction, payload);
}

async function resolvePlayableStation(runtime, interaction, requested) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const guildId = String(interaction.guildId || "").trim();
  const { guildTier, stationsData } = buildStationCatalog(guildId);
  const stations = loadStations();
  const requestedOfficialKey = resolveStation(stations, requested);
  let playStations = stationsData;
  let key = resolveStation(stationsData, requested);

  if (key) {
    const stationTier = playStations.stations[key]?.tier || "free";
    const tierRank = { free: 0, pro: 1, ultimate: 2 };
    if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
      return { errorPayload: premiumStationEmbed(playStations.stations[key].name, stationTier, language) };
    }
    return { key, playStations, guildTier };
  }

  if (requestedOfficialKey && !String(requestedOfficialKey).startsWith("custom:")) {
    const stationTier = stations.stations[requestedOfficialKey]?.tier || "free";
    const tierRank = { free: 0, pro: 1, ultimate: 2 };
    if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
      return { errorPayload: premiumStationEmbed(stations.stations[requestedOfficialKey].name, stationTier, language) };
    }
  }

  const customStations = getGuildStations(guildId);
  const lowered = String(requested || "").toLowerCase();
  const customKey = Object.keys(customStations).find((candidate) =>
    candidate === requested || String(customStations[candidate]?.name || "").toLowerCase() === lowered
  );
  if (customKey && guildTier === "ultimate") {
    key = buildCustomStationReference(customKey);
    const customUrl = customStations[customKey].url;
    const validation = validateCustomStationUrl(customUrl);
    if (!validation.ok) {
      const translated = translateCustomStationErrorMessage(validation.error, language);
      return {
        errorPayload: {
          content: t(
            `Custom-Station kann nicht genutzt werden: ${translated}`,
            `Custom station cannot be used: ${translated}`
          ),
          flags: MessageFlags.Ephemeral,
        },
      };
    }
    playStations = buildScopedStationsData(stations, {
      ...stationsData.stations,
      [key]: { name: customStations[customKey].name, url: validation.url, tier: "ultimate", logo: customStationLogoUrl(guildId, customKey, customStations[customKey]) },
    });
    return { key, playStations, guildTier };
  }

  if (customKey) {
    return { errorPayload: customStationEmbed(language) };
  }

  return {
    errorPayload: buildNoticePayload({ t, language, code: "station-unknown" }),
  };
}

/**
 * The commander hands a stream to a worker: pick the worker (the requested
 * one, one already in the channel, or a free one), check its permissions in
 * the channel and start. Returns { ok: false, message } or { ok: true,
 * worker, result, reusingExistingWorker, selectedStation }. Shared by /play
 * and the setup (#271).
 */
export async function delegatePlayToWorker(runtime, {
  guildId,
  channelId,
  playable,
  requestedBotIndex = null,
  requestedWorkerSelectionMode = "slot",
  t,
  language,
}) {
  let worker;
  let reusingExistingWorker = false;
  if (requestedBotIndex) {
    const check = runtime.workerManager.canUseWorker(requestedBotIndex, guildId, playable.guildTier, {
      prefer: requestedWorkerSelectionMode === "botIndex" ? "botIndex" : "slot",
      strict: requestedWorkerSelectionMode !== "botIndex",
    });
    if (!check.ok) {
      const reasons = {
        tier: t(`Worker ${requestedBotIndex} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBotIndex} requires a higher plan (max: ${check.maxIndex}).`),
        not_configured: t(`Worker ${requestedBotIndex} ist nicht konfiguriert.`, `Worker ${requestedBotIndex} is not configured.`),
        offline: t(`Worker ${requestedBotIndex} ist offline.`, `Worker ${requestedBotIndex} is offline.`),
        not_invited: t(`Worker ${requestedBotIndex} ist nicht auf diesem Server. Nutze \`/invite worker:${requestedBotIndex}\` zum Einladen.`, `Worker ${requestedBotIndex} is not on this server. Use \`/invite worker:${requestedBotIndex}\` to invite.`),
      };
      return { ok: false, message: reasons[check.reason] || t("Worker nicht verfuegbar.", "Worker not available.") };
    }
    worker = check.worker;
  } else {
    const activeWorkerInChannel = runtime.workerManager.findStreamingWorkerByChannel(guildId, channelId);
    if (activeWorkerInChannel) {
      worker = activeWorkerInChannel;
      reusingExistingWorker = true;
    } else {
      const connectedWorkerInChannel = await runtime.workerManager.findConnectedWorkerByChannel(guildId, channelId, playable.guildTier);
      if (connectedWorkerInChannel) {
        worker = connectedWorkerInChannel;
        reusingExistingWorker = true;
      }
    }
    if (!worker) {
      worker = runtime.workerManager.findFreeWorker(guildId, playable.guildTier);
    }
  }

  if (!worker) {
    const invited = runtime.workerManager.getInvitedWorkers(guildId, playable.guildTier);
    return {
      ok: false,
      message: invited.length === 0
        ? t(
          "Kein Worker-Bot ist auf diesem Server. Nutze `/invite worker:1` zum Einladen.",
          "No worker bot is on this server. Use `/invite worker:1` to invite one."
        )
        : t(
          "Alle Worker-Bots auf diesem Server sind belegt. Lade mehr Worker ein oder stoppe einen laufenden Stream.",
          "All worker bots on this server are busy. Invite more workers or stop a running stream."
        ),
    };
  }

  const selectedStation = playable.playStations.stations[playable.key];
  let workerAccess = { ok: true };
  if (worker?.remote !== true) {
    const workerGuild = worker.client?.guilds?.cache?.get?.(guildId)
      || await worker.client?.guilds?.fetch?.(guildId).catch(() => null);
    const workerChannel = workerGuild?.channels?.cache?.get?.(channelId)
      || await workerGuild?.channels?.fetch?.(channelId).catch(() => null);
    workerAccess = workerGuild && workerChannel
      ? await worker.validateVoiceChannelAccess(workerGuild, workerChannel, {
        language,
        workerName: worker.config?.name || "Worker",
      })
      : {
        ok: false,
        message: t(
          "Der Ziel-Channel konnte fuer den ausgewaehlten Worker gerade nicht geladen werden. Bitte versuche es erneut.",
          "The target channel could not be loaded for the selected worker right now. Please try again."
        ),
      };
  }
  if (!workerAccess.ok) {
    return { ok: false, message: workerAccess.message };
  }

  log("INFO", `[${runtime.config.name}] /play guild=${guildId} station=${playable.key} -> delegating to ${worker.config.name}`);
  worker.clearScheduledEventPlaybackInGuild(guildId);
  const result = await worker.playInGuild(guildId, channelId, playable.key, playable.playStations, undefined);
  if (!result.ok) {
    return { ok: false, message: t(`Fehler: ${result.error}`, `Error: ${result.error}`) };
  }
  if (typeof runtime.workerManager.refreshRemoteStates === "function") {
    await runtime.workerManager.refreshRemoteStates({ force: true }).catch(() => null);
  }
  return { ok: true, worker, result, reusingExistingWorker, selectedStation };
}

export async function executeRuntimePlay(runtime, interaction, {
  station = null,
  requestedVoiceChannel = null,
  requestedVoiceChannelId = null,
  requestedBotIndex = null,
  requestedWorkerSelectionMode = "slot",
  openWizardWhenIncomplete = false,
  wizardHint = "",
} = {}) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const requestedKey = String(station || "").trim();
  let explicitVoiceChannel = await resolveExplicitVoiceChannel(interaction, requestedVoiceChannel, requestedVoiceChannelId);

  if (explicitVoiceChannel) {
    if (explicitVoiceChannel.guildId !== interaction.guildId) {
      await runtime.respondInteraction(interaction, {
        content: t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server."),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !explicitVoiceChannel.isVoiceBased?.()
      || (explicitVoiceChannel.type !== ChannelType.GuildVoice && explicitVoiceChannel.type !== ChannelType.GuildStageVoice)
    ) {
      await runtime.respondInteraction(interaction, buildNoticePayload({ t, language, code: "not-in-voice" }));
      return;
    }
  }

  if (!requestedKey) {
    if (openWizardWhenIncomplete) {
      const payload = await openRuntimePlayWizard(runtime, interaction, {
        channelId: explicitVoiceChannel?.id || interaction?.member?.voice?.channelId || null,
        workerIndex: requestedBotIndex,
        hint: wizardHint || t("Wähle zuerst einen Sender aus, dann kannst du direkt starten.", "Pick a station first, then start right away."),
      });
      await runtime.respondInteraction(interaction, payload);
      return;
    }
    await runtime.respondInteraction(interaction, {
      content: t("Bitte gib eine Station an oder nutze den Schnellstart.", "Please choose a station or use the quick start panel."),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const playable = await resolvePlayableStation(runtime, interaction, requestedKey);
  if (playable.errorPayload) {
    await runtime.respondInteraction(interaction, playable.errorPayload);
    return;
  }

  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guild) {
    await runtime.respondInteraction(interaction, {
      content: t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (runtime.role === "commander" && runtime.workerManager) {
    if (typeof runtime.workerManager.refreshRemoteStates === "function") {
      await runtime.workerManager.refreshRemoteStates().catch(() => null);
    }
    let channelId = explicitVoiceChannel?.id;
    if (!channelId) {
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      channelId = member?.voice?.channelId || null;
    }
    if (!channelId) {
      if (openWizardWhenIncomplete) {
        const payload = await openRuntimePlayWizard(runtime, interaction, {
          stationKey: playable.key,
          workerIndex: requestedBotIndex,
          hint: buildVoiceChannelAccessMessage({ issue: "select_channel", t }),
        });
        await runtime.respondInteraction(interaction, payload);
        return;
      }
      await runtime.respondInteraction(interaction, {
        content: buildVoiceChannelAccessMessage({ issue: "select_channel", t }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await runtime.respondInteraction(interaction, { content: t("Verbinde Worker...", "Connecting worker..."), flags: MessageFlags.Ephemeral });

    const delegated = await delegatePlayToWorker(runtime, {
      guildId,
      channelId,
      playable,
      requestedBotIndex,
      requestedWorkerSelectionMode,
      t,
      language,
    });
    if (!delegated.ok) {
      await runtime.respondInteraction(interaction, { content: delegated.message });
      return;
    }
    const { worker, result, reusingExistingWorker, selectedStation } = delegated;
    const tierConfig = getTierConfig(guildId);
    const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
    const successEmbed = buildOmniEmbed({
      tone: result.recovering ? "warning" : "success",
      title: result.recovering
        ? t("⚠ Stream stabilisiert sich", "⚠ Stream is stabilizing")
        : t("✅ Stream gestartet", "✅ Stream started"),
      description: result.recovering
        ? t(
          `${result.workerName} bleibt verbunden und versucht die Quelle erneut: **${selectedStation?.name || playable.key}**${tierLabel}`,
          `${result.workerName} stays connected and retries the source: **${selectedStation?.name || playable.key}**${tierLabel}`
        )
        : reusingExistingWorker
          ? t(
            `${result.workerName} wechselt jetzt auf **${selectedStation?.name || playable.key}**${tierLabel}.`,
            `${result.workerName} is now switching to **${selectedStation?.name || playable.key}**${tierLabel}.`
          )
          : t(
            `${result.workerName} startet jetzt **${selectedStation?.name || playable.key}**${tierLabel}.`,
            `${result.workerName} is now starting **${selectedStation?.name || playable.key}**${tierLabel}.`
          ),
      fields: [
        {
          name: t("Ziel", "Target"),
          value: `<#${channelId}>`,
          inline: true,
        },
        {
          name: t("Worker", "Worker"),
          value: result.workerName || worker.config?.name || "-",
          inline: true,
        },
      ],
    });
    await runtime.respondInteraction(interaction, {
      embeds: [successEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(PLAY_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t("🎛 Neu öffnen", "🎛 Open again")),
          new ButtonBuilder()
            .setCustomId(STATIONS_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t("📻 Sender", "📻 Stations"))
        ),
      ],
    });
    return;
  }

  log("INFO", `[${runtime.config.name}] /play guild=${guildId} station=${playable.key} tier=${playable.guildTier}`);
  await runtime.respondInteraction(interaction, { content: t("Verbinde Sprachkanal...", "Connecting voice channel..."), flags: MessageFlags.Ephemeral });
  await runtime.runSerializedGuildOperation(guildId, "slash-play", async () => {
    const state = runtime.getState(guildId);
    runtime.clearRestoreRetry(guildId);
    const { connection, error: connectError } = await runtime.connectToVoice(interaction, explicitVoiceChannel, { silent: true });
    if (!connection) {
      if (openWizardWhenIncomplete && String(connectError || "").includes("Channel")) {
        const payload = await openRuntimePlayWizard(runtime, interaction, {
          stationKey: playable.key,
          hint: connectError,
        });
        await runtime.respondInteraction(interaction, payload);
        return;
      }
      await runtime.respondInteraction(interaction, { content: connectError || t("Konnte keine Voice-Verbindung herstellen.", "Could not establish a voice connection.") });
      return;
    }
    state.shouldReconnect = true;
    runtime.clearScheduledEventPlayback(state);

    try {
      await runtime.playStation(state, playable.playStations, playable.key, guildId, {
        countAsStart: true,
        resumeSession: false,
      });
      const tierConfig = getTierConfig(guildId);
      const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
      await runtime.respondInteraction(interaction, {
        embeds: [
          buildOmniEmbed({
            tone: "success",
            title: t("✅ Stream gestartet", "✅ Stream started"),
            description: t(
              `Jetzt live: **${playable.playStations.stations[playable.key]?.name || playable.key}**${tierLabel}`,
              `Now live: **${playable.playStations.stations[playable.key]?.name || playable.key}**${tierLabel}`
            ),
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(PLAY_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("🎛 Neu öffnen", "🎛 Open again")),
            new ButtonBuilder()
              .setCustomId(STATIONS_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("📻 Sender", "📻 Stations"))
          ),
        ],
      });
    } catch (err) {
      log("ERROR", `[${runtime.config.name}] Play error: ${err.message}`);
      state.lastStreamErrorAt = new Date().toISOString();
      const recovery = runtime.armPlaybackRecovery(
        guildId,
        state,
        playable.playStations,
        playable.key,
        err,
        { reason: "local-play-start-failed" }
      );
      if (recovery.scheduled) {
        await runtime.respondInteraction(interaction, {
          embeds: [
            buildOmniEmbed({
              tone: "warning",
              title: t("⚠ Stream stabilisiert sich", "⚠ Stream is stabilizing"),
              description: t(
                `Verbunden. Die Quelle ist aktuell instabil, OmniFM versucht **${playable.playStations.stations[playable.key]?.name || playable.key}** erneut.`,
                `Connected. The source is unstable right now, OmniFM is retrying **${playable.playStations.stations[playable.key]?.name || playable.key}**.`
              ),
            }),
          ],
        });
        return;
      }

      state.shouldReconnect = false;
      runtime.invalidateVoiceStatus?.(state, { clearText: true });
      runtime.syncVoiceChannelStatus(guildId, "").catch(() => null);
      runtime.clearNowPlayingTimer(state);
      state.player.stop();
      runtime.clearCurrentProcess(state);
      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }
      state.currentStationKey = null;
      state.currentStationName = null;
      state.desiredStationKey = null;
      state.desiredStationName = null;
      state.failoverActive = false;
      state.failoverStartedAt = 0;
      state.failoverReason = null;
      state.failoverFromStationKey = null;
      state.failoverFromStationName = null;
      state.failoverFailureStationKey = null;
      state.failoverFailureCount = 0;
      state.failoverFailureStartedAt = 0;
      state.failoverLastFailureAt = 0;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      runtime.updatePresence();
      await runtime.respondInteraction(interaction, {
        embeds: [
          buildOmniEmbed({
            tone: "danger",
            title: t("✖ Start fehlgeschlagen", "✖ Start failed"),
            description: t(`Fehler beim Starten: ${err.message}`, `Error while starting: ${err.message}`),
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(PLAY_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("🎛 Erneut versuchen", "🎛 Try again")),
            new ButtonBuilder()
              .setCustomId(STATIONS_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("📻 Sender", "📻 Stations"))
          ),
        ],
      });
    }
  });
}
