// The /event slash command: create, edit, list, delete and preview scheduled
// events. Moved out of runtime-events.js (#210), which re-exports it.
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { log } from "../lib/logging.js";
import { clipText } from "../lib/helpers.js";
import { getFeatureRequirementMessage, translateScheduledEventStoreMessage } from "../lib/language.js";
import { isWorkdayInTimeZone, normalizeRepeatMode } from "../lib/event-time.js";
import { getTier, requireFeature } from "../core/entitlements.js";
import {
  listScheduledEvents,
  createScheduledEvent,
  deleteScheduledEvent,
  patchScheduledEvent,
  getScheduledEvent,
} from "../scheduled-events-store.js";
import { BRAND } from "../config/plans.js";
import { DASHBOARD_URL, withLanguageParam } from "./runtime-links.js";
import { buildOmniEmbed } from "./discord-ui.js";
import {
  buildEventActionRows,
  buildEventNoticePayload,
} from "./runtime-events.js";
import { buildEventFormModal } from "./forms.js";
import { validateStageEventSpeakers } from "./stage-moderator.js";
import { buildRepeatChoices } from "../commands.js";

/**
 * `formInput` (#273): the values of the event form; they run through the
 * same checks as /event create.
 */
async function handleEventCommand(runtime, interaction, { formInput = null } = {}) {
  const guildId = interaction.guildId;
  const { t, language } = runtime.createInteractionTranslator(interaction);
  if (!runtime.hasGuildManagePermissions(interaction)) {
    await interaction.reply(buildEventNoticePayload(language, {
      tone: "warning",
      title: t("🛠 Event-Rechte fehlen", "🛠 Event permission missing"),
      description: t(
        "Du brauchst die Berechtigung `Server verwalten` für `/event`.",
        "You need the `Manage Server` permission for `/event`."
      ),
      includePlayback: false,
      includeSupport: true,
    }));
    return;
  }

  const feature = requireFeature(guildId, "scheduledEvents");
  if (!feature.ok) {
    await interaction.reply(buildEventNoticePayload(language, {
      tone: "info",
      title: t("📅 Events sind nicht freigeschaltet", "📅 Events are not unlocked"),
      description: getFeatureRequirementMessage(feature, language),
      fields: [
        {
          name: t("Upgrade", "Upgrade"),
          value: withLanguageParam(BRAND.upgradeUrl || DASHBOARD_URL, language),
          inline: false,
        },
      ],
      includePlayback: false,
      includePremium: true,
      includeSupport: true,
    }));
    return;
  }

  const sub = formInput ? "create" : interaction.options.getSubcommand();
  if (sub === "form") {
    await interaction.showModal(buildEventFormModal({ t, repeatChoices: buildRepeatChoices(), language }));
    return;
  }
  const guild = interaction.guild || runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  const me = guild ? await runtime.resolveBotMember(guild) : null;

  if (!guild || !me) {
    await interaction.reply(buildEventNoticePayload(language, {
      tone: "danger",
      title: t("✖ Server-Zugriff fehlgeschlagen", "✖ Server access failed"),
      description: t("Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load the bot member in this server."),
      includePlayback: false,
      includeSupport: true,
    }));
    return;
  }

  const validateTextChannel = (channel) => {
    if (!channel) return null;
    if (channel.guildId !== guildId) {
      return t("Der gewaehlte Text-Channel ist nicht in diesem Server.", "The selected text channel is not in this server.");
    }
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      return t(`Ich kann in ${channel.toString()} nicht schreiben.`, `I cannot send messages in ${channel.toString()}.`);
    }
    return null;
  };

  const validateVoiceChannel = async (channel, { stageTopic = null, createDiscordEvent = false } = {}) => {
    if (!channel) {
      return t("Voice- oder Stage-Channel fehlt.", "Voice or stage channel is missing.");
    }
    if (channel.guildId !== guildId) {
      return t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server.");
    }
    if (!channel.isVoiceBased() || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      return t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel.");
    }
    if (stageTopic && channel.type !== ChannelType.GuildStageVoice) {
      return t("`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels.");
    }
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      return t(`Ich habe keine Connect-Berechtigung für ${channel.toString()}.`, `I do not have Connect permission for ${channel.toString()}.`);
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      return t(`Ich habe keine Speak-Berechtigung für ${channel.toString()}.`, `I do not have Speak permission for ${channel.toString()}.`);
    }
    // Stage channels: a playing bot must be Stage moderator there, or it stays silent.
    const stageError = await validateStageEventSpeakers(runtime, guild, channel, getTier(guildId), language);
    if (stageError) return stageError;
    if (createDiscordEvent) {
      return runtime.validateDiscordScheduledEventPermissions(guild, channel, language);
    }
    return null;
  };

  const parseWindow = (input) => runtime.parseEventWindowInput(input, language);

  if (sub === "create") {
    // The form has the core fields; everything else stays at its default.
    const option = (name) => (formInput ? null : interaction.options.getString(name));
    const name = clipText(String(formInput ? formInput.name : interaction.options.getString("name", true)).trim(), 120);
    const stationRaw = formInput ? formInput.stationRaw : interaction.options.getString("station", true);
    const voiceChannel = formInput
      ? (formInput.voiceChannelId ? guild.channels.cache.get(formInput.voiceChannelId) || await guild.channels.fetch(formInput.voiceChannelId).catch(() => null) : null)
      : interaction.options.getChannel("voice", true);
    const textChannel = formInput ? null : interaction.options.getChannel("text");
    const startRaw = formInput ? formInput.startRaw : option("start");
    const startDateRaw = option("startdate");
    const startTimeRaw = option("starttime");
    const endRaw = option("end");
    const endDateRaw = option("enddate");
    const endTimeRaw = option("endtime");
    const requestedTimeZone = option("timezone") || "";
    const repeat = normalizeRepeatMode((formInput ? formInput.repeat : option("repeat")) || "none");
    const createDiscordEvent = formInput ? false : interaction.options.getBoolean("serverevent") === true;
    const stageTopicTemplate = runtime.normalizeClearableText(option("stagetopic"), 120);
    const message = runtime.normalizeClearableText(option("message"), 1200);
    const description = runtime.normalizeClearableText(option("description"), 800);

    if (!name) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("✍ Eventname fehlt", "✍ Event name missing"),
        description: t("Eventname darf nicht leer sein.", "Event name cannot be empty."),
      }));
      return;
    }

    const voiceError = await validateVoiceChannel(voiceChannel, {
      stageTopic: stageTopicTemplate,
      createDiscordEvent,
    });
    if (voiceError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🎙 Voice-Channel prüfen", "🎙 Check voice channel"),
        description: voiceError,
      }));
      return;
    }

    const textError = validateTextChannel(textChannel);
    if (textError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("💬 Text-Channel prüfen", "💬 Check text channel"),
        description: textError,
      }));
      return;
    }

    if (![startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim())) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🕒 Startzeit fehlt", "🕒 Start time missing"),
        description: t(
          "Bitte gib eine Startzeit an. Nutze entweder `start` oder die Kombination aus `startdate` + `starttime`.",
          "Please provide a start time. Use either `start` or the `startdate` + `starttime` combination."
        ),
      }));
      return;
    }

    const parsedWindow = parseWindow({
      startRaw,
      startDateRaw,
      startTimeRaw,
      endRaw,
      endDateRaw,
      endTimeRaw,
      requestedTimeZone,
      allowImmediate: !createDiscordEvent,
    });
    if (!parsedWindow.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🗓 Zeitfenster ungültig", "🗓 Invalid event window"),
        description: parsedWindow.message,
      }));
      return;
    }
    if (createDiscordEvent && parsedWindow.runAtMs < Date.now() + 60_000) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📣 Server-Event zu früh", "📣 Server event too soon"),
        description: t(
          "Mit `serverevent` muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
          "With `serverevent`, start time must be at least 60 seconds in the future."
        ),
      }));
      return;
    }
    if (repeat === "weekdays" && !isWorkdayInTimeZone(parsedWindow.runAtMs, parsedWindow.timeZone)) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📆 Wiederholung passt nicht", "📆 Repeat rule does not match"),
        description: t(
          "Für `weekdays` muss die Startzeit auf Montag bis Freitag liegen.",
          "For `weekdays`, the start time must fall on Monday to Friday."
        ),
      }));
      return;
    }

    const station = runtime.resolveStationForGuild(guildId, stationRaw, language);
    if (!station.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📻 Sender prüfen", "📻 Check station"),
        description: station.message,
      }));
      return;
    }

    if (runtime.role === "commander" && runtime.workerManager) {
      const guildTier = getTier(guildId);
      const invitedWorkers = runtime.workerManager.getInvitedWorkers(guildId, guildTier);
      if (invitedWorkers.length === 0) {
        await interaction.reply(buildEventNoticePayload(language, {
          tone: "warning",
          title: t("🤖 Kein Worker verfügbar", "🤖 No worker available"),
          description: t(
            "Kein geeigneter Worker-Bot ist auf diesem Server eingeladen. Bitte zuerst einen Worker mit `/invite worker:1` einladen.",
            "No eligible worker bot is invited on this server. Please invite one first with `/invite worker:1`."
          ),
        }));
        return;
      }
    }

    const created = createScheduledEvent({
      guildId,
      botId: runtime.config.id,
      name,
      stationKey: station.key,
      voiceChannelId: voiceChannel.id,
      textChannelId: textChannel?.id || null,
      announceMessage: message || null,
      description: description || null,
      stageTopic: stageTopicTemplate || null,
      timeZone: parsedWindow.timeZone,
      createDiscordEvent,
      discordScheduledEventId: null,
      repeat,
      runAtMs: parsedWindow.runAtMs,
      durationMs: parsedWindow.durationMs,
      activeUntilMs: 0,
      deleteAfterStop: false,
      createdByUserId: interaction.user?.id || null,
    });

    if (!created.ok) {
      const storeMessage = translateScheduledEventStoreMessage(created.message, language);
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "danger",
        title: t("✖ Event konnte nicht gespeichert werden", "✖ Could not save event"),
        description: storeMessage,
        includeSupport: true,
      }));
      return;
    }

    let replyEvent = created.event;
    let serverEventNote = "";
    if (createDiscordEvent) {
      try {
        const scheduledEvent = await runtime.syncDiscordScheduledEvent(created.event, station.station, {
          runAtMs: created.event.runAtMs,
        });
        if (scheduledEvent?.id) {
          const patched = patchScheduledEvent(created.event.id, { discordScheduledEventId: scheduledEvent.id });
          replyEvent = patched?.event || { ...created.event, discordScheduledEventId: scheduledEvent.id };
        }
      } catch (err) {
        serverEventNote = `${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
        log("WARN", `[${runtime.config.name}] Event ${created.event.id}: Discord-Server-Event konnte nicht erstellt werden: ${err?.message || err}`);
      }
    }

    const embed = runtime.buildScheduledEventEmbed(replyEvent, station.station?.name || null, language, {
      titlePrefix: `${t("Event erstellt", "Event created")}: `,
    });
    if (serverEventNote) {
      embed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(serverEventNote, 800),
        inline: false,
      });
    }
    await interaction.reply({ embeds: [embed], components: buildEventActionRows(language), flags: MessageFlags.Ephemeral });
    if (replyEvent.runAtMs <= Date.now() + 5_000) {
      runtime.queueImmediateScheduledEventTick(250);
    }
    return;
  }

  if (sub === "edit") {
    const id = interaction.options.getString("id", true);
    const existing = getScheduledEvent(id);
    if (!existing || existing.guildId !== guildId || existing.botId !== runtime.config.id) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🔎 Event nicht gefunden", "🔎 Event not found"),
        description: t("Event nicht gefunden.", "Event not found."),
      }));
      return;
    }

    const nameRaw = interaction.options.getString("name");
    const stationRaw = interaction.options.getString("station");
    const voiceChannelOption = interaction.options.getChannel("voice");
    const startRaw = interaction.options.getString("start");
    const startDateRaw = interaction.options.getString("startdate");
    const startTimeRaw = interaction.options.getString("starttime");
    const endRaw = interaction.options.getString("end");
    const endDateRaw = interaction.options.getString("enddate");
    const endTimeRaw = interaction.options.getString("endtime");
    const timeZoneRaw = interaction.options.getString("timezone");
    const repeatRaw = interaction.options.getString("repeat");
    const textChannelOption = interaction.options.getChannel("text");
    const clearText = interaction.options.getBoolean("cleartext") === true;
    const serverEventRaw = interaction.options.getBoolean("serverevent");
    const stageTopicRaw = interaction.options.getString("stagetopic");
    const messageRaw = interaction.options.getString("message");
    const descriptionRaw = interaction.options.getString("description");
    const enabledRaw = interaction.options.getBoolean("enabled");

    const existingVoiceChannel = await guild.channels.fetch(existing.voiceChannelId).catch(() => null);
    const nextVoiceChannel = voiceChannelOption || existingVoiceChannel;
    const nextStageTopic = stageTopicRaw !== null
      ? runtime.normalizeClearableText(stageTopicRaw, 120)
      : existing.stageTopic;
    const nextCreateDiscordEvent = serverEventRaw !== null ? serverEventRaw === true : existing.createDiscordEvent;
    const nextTextChannel = textChannelOption
      ? textChannelOption
      : clearText
        ? null
        : (existing.textChannelId ? await guild.channels.fetch(existing.textChannelId).catch(() => null) : null);
    const nextName = nameRaw !== null ? clipText(nameRaw.trim(), 120) : existing.name;
    const nextMessage = messageRaw !== null
      ? runtime.normalizeClearableText(messageRaw, 1200)
      : existing.announceMessage;
    const nextDescription = descriptionRaw !== null
      ? runtime.normalizeClearableText(descriptionRaw, 800)
      : existing.description;

    if (!nextName) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("✍ Eventname fehlt", "✍ Event name missing"),
        description: t("Eventname darf nicht leer sein.", "Event name cannot be empty."),
      }));
      return;
    }

    const voiceError = await validateVoiceChannel(nextVoiceChannel, {
      stageTopic: nextStageTopic,
      createDiscordEvent: nextCreateDiscordEvent,
    });
    if (voiceError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🎙 Voice-Channel prüfen", "🎙 Check voice channel"),
        description: voiceError,
      }));
      return;
    }

    const textError = validateTextChannel(nextTextChannel);
    if (textError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("💬 Text-Channel prüfen", "💬 Check text channel"),
        description: textError,
      }));
      return;
    }

    const currentDurationMs = Math.max(0, Number.parseInt(String(existing.durationMs || 0), 10) || 0);
    const hasStartChange = [startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim());
    const parsedWindow = parseWindow({
      startRaw,
      startDateRaw,
      startTimeRaw,
      endRaw,
      endDateRaw,
      endTimeRaw,
      baseRunAtMs: existing.runAtMs,
      baseDurationMs: currentDurationMs,
      requestedTimeZone: timeZoneRaw || existing.timeZone || "",
      allowImmediate: !nextCreateDiscordEvent,
    });
    if (!parsedWindow.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🗓 Zeitfenster ungültig", "🗓 Invalid event window"),
        description: parsedWindow.message,
      }));
      return;
    }
    if (nextCreateDiscordEvent && (hasStartChange || serverEventRaw === true) && parsedWindow.runAtMs < Date.now() + 60_000) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📣 Server-Event zu früh", "📣 Server event too soon"),
        description: t(
          "Mit `serverevent` muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
          "With `serverevent`, start time must be at least 60 seconds in the future."
        ),
      }));
      return;
    }
    const nextRepeat = repeatRaw ? normalizeRepeatMode(repeatRaw) : existing.repeat;
    if (nextRepeat === "weekdays" && !isWorkdayInTimeZone(parsedWindow.runAtMs, parsedWindow.timeZone)) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📆 Wiederholung passt nicht", "📆 Repeat rule does not match"),
        description: t(
          "Für `weekdays` muss die Startzeit auf Montag bis Freitag liegen.",
          "For `weekdays`, the start time must fall on Monday to Friday."
        ),
      }));
      return;
    }

    let resolvedStation = runtime.resolveStationForGuild(guildId, existing.stationKey, language);
    if (stationRaw) {
      resolvedStation = runtime.resolveStationForGuild(guildId, stationRaw, language);
      if (!resolvedStation.ok) {
        await interaction.reply(buildEventNoticePayload(language, {
          tone: "warning",
          title: t("📻 Sender prüfen", "📻 Check station"),
          description: resolvedStation.message,
        }));
        return;
      }
    } else if (!resolvedStation.ok) {
      resolvedStation = { ok: true, key: existing.stationKey, station: null };
    }

    const eventIsActive = Number.parseInt(String(existing.activeUntilMs || 0), 10) > Date.now()
      && Number.parseInt(String(existing.lastStopAtMs || 0), 10) < Number.parseInt(String(existing.activeUntilMs || 0), 10);

    const patchPayload = {
      name: nextName,
      stationKey: resolvedStation.key,
      voiceChannelId: nextVoiceChannel.id,
      textChannelId: nextTextChannel?.id || null,
      announceMessage: nextMessage || null,
      description: nextDescription || null,
      stageTopic: nextStageTopic || null,
      timeZone: parsedWindow.timeZone,
      createDiscordEvent: nextCreateDiscordEvent,
      repeat: nextRepeat,
      runAtMs: parsedWindow.runAtMs,
      durationMs: parsedWindow.durationMs,
      activeUntilMs: eventIsActive ? parsedWindow.endAtMs : 0,
      enabled: enabledRaw === null ? existing.enabled : enabledRaw === true,
    };

    const updated = patchScheduledEvent(existing.id, patchPayload);
    if (!updated.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "danger",
        title: t("✖ Event konnte nicht aktualisiert werden", "✖ Could not update event"),
        description: translateScheduledEventStoreMessage(updated.message, language),
        includeSupport: true,
      }));
      return;
    }

    let replyEvent = updated.event;
    let serverEventNote = "";
    if (!nextCreateDiscordEvent && existing.discordScheduledEventId) {
      await runtime.deleteDiscordScheduledEventById(guildId, existing.discordScheduledEventId).catch(() => null);
      const cleared = patchScheduledEvent(existing.id, { discordScheduledEventId: null });
      replyEvent = cleared?.event || { ...replyEvent, discordScheduledEventId: null };
    } else if (nextCreateDiscordEvent) {
      try {
        const scheduledEvent = await runtime.syncDiscordScheduledEvent(replyEvent, resolvedStation.station || { name: replyEvent.stationKey }, {
          runAtMs: replyEvent.runAtMs,
        });
        if (scheduledEvent?.id) {
          const synced = patchScheduledEvent(existing.id, { discordScheduledEventId: scheduledEvent.id });
          replyEvent = synced?.event || { ...replyEvent, discordScheduledEventId: scheduledEvent.id };
        }
      } catch (err) {
        serverEventNote = `${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
        log("WARN", `[${runtime.config.name}] Event ${existing.id}: Discord-Server-Event Sync fehlgeschlagen: ${err?.message || err}`);
      }
    }

    const embed = runtime.buildScheduledEventEmbed(replyEvent, resolvedStation.station?.name || null, language, {
      titlePrefix: `${t("Event aktualisiert", "Event updated")}: `,
    });
    if (serverEventNote) {
      embed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(serverEventNote, 800),
        inline: false,
      });
    }
    await interaction.reply({ embeds: [embed], components: buildEventActionRows(language), flags: MessageFlags.Ephemeral });
    if (replyEvent.enabled && replyEvent.runAtMs <= Date.now() + 5_000) {
      runtime.queueImmediateScheduledEventTick(250);
    }
    return;
  }

  if (sub === "list") {
    const events = listScheduledEvents({
      guildId,
      botId: runtime.config.id,
      includeDisabled: true,
    });

    if (!events.length) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("🗓 Keine Events geplant", "🗓 No events scheduled"),
            description: t(
              "Für diesen Server sind aktuell keine OmniFM-Events gespeichert.",
              "There are currently no OmniFM events stored for this server."
            ),
            fields: [
              {
                name: t("Nächster Schritt", "Next step"),
                value: t("Lege mit `/event create` den ersten automatischen Start an.", "Create the first automated start with `/event create`."),
                inline: false,
              },
            ],
          }),
        ],
        components: buildEventActionRows(language),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [runtime.buildScheduledEventsListEmbed(events, guildId, language)],
      components: buildEventActionRows(language),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "delete") {
    const id = interaction.options.getString("id", true);
    const existing = getScheduledEvent(id);
    if (!existing || existing.guildId !== guildId || existing.botId !== runtime.config.id) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🔎 Event nicht gefunden", "🔎 Event not found"),
        description: t("Event nicht gefunden.", "Event not found."),
        includePlayback: false,
      }));
      return;
    }

    if (Number.parseInt(String(existing.activeUntilMs || 0), 10) > Date.now()
      && Number.parseInt(String(existing.lastStopAtMs || 0), 10) < Number.parseInt(String(existing.activeUntilMs || 0), 10)
    ) {
      await runtime.executeScheduledEventStop({ ...existing, deleteAfterStop: false });
    }

    let removedDiscordEvent = false;
    if (existing.discordScheduledEventId) {
      removedDiscordEvent = await runtime.deleteDiscordScheduledEventById(guildId, existing.discordScheduledEventId);
    }
    const removed = deleteScheduledEvent(id, { guildId, botId: runtime.config.id });
    if (!removed.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "danger",
        title: t("✖ Event konnte nicht entfernt werden", "✖ Could not remove event"),
        description: translateScheduledEventStoreMessage(removed.message, language),
        includePlayback: false,
        includeSupport: true,
      }));
      return;
    }
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🧹 Event entfernt", "🧹 Event removed"),
          description: `${t("Event", "Event")} \`${id}\` ${t("entfernt", "removed")}.${removedDiscordEvent ? ` ${t("Discord-Server-Event ebenfalls entfernt.", "Discord server event was removed too.")}` : ""}`,
        }),
      ],
      components: buildEventActionRows(language, { includePlayback: false }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(buildEventNoticePayload(language, {
    tone: "warning",
    title: t("❓ Unbekannte Event-Aktion", "❓ Unknown event action"),
    description: t("Unbekannte /event Aktion.", "Unknown /event action."),
    includePlayback: false,
  }));
}

export {
  handleEventCommand,
};
