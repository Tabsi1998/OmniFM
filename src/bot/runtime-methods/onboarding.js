// Guild onboarding: the welcome a server gets when the bot joins, and the
// three-step setup behind it and behind /setup (#271).
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime.
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";

import { log } from "../../lib/logging.js";
import { clipText } from "../../lib/helpers.js";
import { getTier } from "../../core/entitlements.js";
import { updateGuildSettings } from "../../lib/guild-settings.js";
import { buildInviteUrl } from "../../bot-config.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import {
  buildStationCatalog,
  buildStationOptions,
  buildVoiceChannelOptions,
  delegatePlayToWorker,
} from "../runtime-panels.js";
import {
  DASHBOARD_URL,
  PLAY_COMPONENT_ID_OPEN,
  SUPPORT_URL,
  WEBSITE_URL,
  withLanguageParam,
} from "../runtime-links.js";
import {
  PANEL_CHANNEL_PERMISSIONS,
  SETUP_COMPONENT_ID_HELP,
  SETUP_COMPONENT_ID_OPEN,
  SETUP_PANEL_AUTO,
  buildPanelChannelOptions,
  buildSetupDonePayload,
  buildSetupWizardPayload,
  buildWelcomePayload,
  missingPermissionLabels,
  parseSetupCustomId,
  voiceChannelPermissions,
} from "../setup-wizard.js";
import {
  ONBOARDING_MESSAGE_ENABLED,
} from "../runtime-shared.js";

const SETUP_SESSION_TTL_MS = 30 * 60_000;

// Channels meant for bots or the team. The welcome never lands in a
// community channel such as #general (#271).
const ONBOARDING_CHANNEL_SCORES = [
  ["system", 400],
  ["setup", 380],
  ["config", 360],
  ["bot", 340],
  ["command", 320],
  ["kommando", 320],
  ["admin", 300],
  ["staff", 300],
  ["mod", 280],
  ["team", 260],
];

export function scoreOnboardingChannel(channel) {
  const name = String(channel?.name || "").toLowerCase();
  let score = 0;
  for (const [needle, points] of ONBOARDING_CHANNEL_SCORES) {
    if (name.includes(needle)) score = Math.max(score, points);
  }
  return score;
}

function canManageGuild(interaction) {
  return interaction?.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) === true;
}

// A component update may not carry the ephemeral flag; V2 stays.
function asUpdate(payload) {
  return { ...payload, flags: MessageFlags.IsComponentsV2 };
}

const onboardingMethods = {
  async handleGuildJoin(guild) {
    return this.enforceGuildAccessForGuild(guild, "join");
  },

  canSendOnboardingToChannel(channel, me) {
    if (!channel) return false;
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return false;
    if (!me) return false;
    const perms = channel.permissionsFor(me);
    return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
  },

  /** The system channel, else the best bot/team channel, else none. */
  async resolveOnboardingChannel(guild) {
    if (!guild) return null;
    const me = await this.resolveBotMember(guild);
    if (!me) return null;
    const systemChannel = guild.systemChannel || null;
    if (this.canSendOnboardingToChannel(systemChannel, me)) {
      return systemChannel;
    }

    if (!guild.channels?.cache?.size) {
      await guild.channels.fetch().catch(() => null);
    }

    const candidates = [...guild.channels.cache.values()]
      .filter((channel) => scoreOnboardingChannel(channel) > 0 && this.canSendOnboardingToChannel(channel, me))
      .sort((a, b) => (scoreOnboardingChannel(b) - scoreOnboardingChannel(a))
        || ((Number(a.rawPosition) || 0) - (Number(b.rawPosition) || 0)));
    return candidates[0] || null;
  },

  buildOnboardingMessagePayload(guild) {
    const language = this.resolveGuildLanguage(guild?.id);
    const t = (de, en) => (language === "de" ? de : en);
    return buildWelcomePayload({
      t,
      guildName: clipText(guild?.name || "", 80),
      urls: {
        dashboard: withLanguageParam(DASHBOARD_URL, language),
        support: SUPPORT_URL,
      },
      applicationId: this.client?.application?.id || null,
    });
  },

  async sendGuildOnboardingMessage(guild) {
    if (!ONBOARDING_MESSAGE_ENABLED) return;
    if (!guild?.id) return;

    const channel = await this.resolveOnboardingChannel(guild);
    if (!channel) {
      log("INFO", `[${this.config.name}] Onboarding: kein System- oder Bot-Kanal auf ${guild.id}, Einrichtung bleibt bei /setup.`);
      return;
    }
    await channel.send(this.buildOnboardingMessagePayload(guild));
  },

  /** /setup and the welcome button: the private setup, for server managers. */
  async openSetupWizard(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = String(interaction?.guildId || "").trim();
    if (!guildId) return buildNoticePayload({ t, language, code: "guild-only" });
    if (this.role !== "commander" || !this.workerManager) return buildNoticePayload({ t, language, code: "commander-only" });
    if (!canManageGuild(interaction)) return buildNoticePayload({ t, language, code: "manage-server-required" });

    const settings = await this.loadGuildSettingsCached(guildId).catch(() => ({}));
    const session = this.createInteractiveUiSession("setup", {
      guildId,
      userId: interaction.user?.id,
      ttlMs: SETUP_SESSION_TTL_MS,
      data: {
        voiceChannelId: interaction.member?.voice?.channelId || null,
        stationKey: null,
        panelChannelId: String(settings?.nowPlayingChannelId || "").trim() || null,
      },
    });
    return this.buildSetupWizardView(interaction, session);
  },

  /** The worker that will play: a free one, else any invited one. */
  pickSetupWorker(guildId) {
    const tier = getTier(guildId);
    return this.workerManager?.findFreeWorker?.(guildId, tier)
      || this.workerManager?.getInvitedWorkers?.(guildId, tier)?.[0]
      || null;
  },

  // Permissions of the worker in a channel; null when they cannot be read
  // here (remote worker, channel not loaded): then the start checks them.
  async resolveSetupWorkerPermissions(worker, guildId, channelId) {
    if (!worker || worker.remote === true || !channelId) return null;
    const workerGuild = worker.client?.guilds?.cache?.get?.(guildId) || null;
    const channel = workerGuild?.channels?.cache?.get?.(channelId)
      || await workerGuild?.channels?.fetch?.(channelId).catch(() => null);
    const me = workerGuild ? await worker.resolveBotMember(workerGuild).catch(() => null) : null;
    if (!channel || !me) return null;
    return { channel, perms: channel.permissionsFor(me) };
  },

  async buildSetupWizardView(interaction, session, { hint = null } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = session.guildId;
    const guild = interaction?.guild || this.client.guilds?.cache?.get?.(guildId) || null;
    const applicationId = interaction?.applicationId || this.client?.application?.id || null;
    const worker = this.pickSetupWorker(guildId);
    const firstWorker = this.workerManager?.getWorkerByIndex?.(1, { prefer: "slot" }) || null;
    const firstWorkerClientId = String(firstWorker?.getApplicationId?.() || firstWorker?.config?.clientId || "").trim();
    const { voiceChannelId, stationKey, panelChannelId } = session.data || {};

    let voiceMissing = null;
    const voiceAccess = await this.resolveSetupWorkerPermissions(worker, guildId, voiceChannelId);
    if (voiceAccess) voiceMissing = missingPermissionLabels(voiceAccess.perms, voiceChannelPermissions(voiceAccess.channel.type), t);

    let panelMissing = null;
    if (panelChannelId && panelChannelId !== SETUP_PANEL_AUTO) {
      const panelAccess = await this.resolveSetupWorkerPermissions(worker, guildId, panelChannelId);
      if (panelAccess) panelMissing = missingPermissionLabels(panelAccess.perms, PANEL_CHANNEL_PERMISSIONS, t);
    }

    const workerGuild = worker && worker.remote !== true ? worker.client?.guilds?.cache?.get?.(guildId) : null;
    const workerMe = workerGuild?.members?.me || null;
    const canPost = workerMe
      ? (channel) => missingPermissionLabels(workerGuild.channels.cache.get(channel.id)?.permissionsFor(workerMe), PANEL_CHANNEL_PERMISSIONS).length === 0
      : null;

    const { entries } = buildStationCatalog(guildId);
    const selectedStation = entries.find((entry) => entry.key === stationKey) || null;

    return buildSetupWizardPayload({
      t,
      sessionId: session.id,
      guildName: guild?.name || "",
      view: {
        worker: {
          ready: Boolean(worker),
          name: worker?.config?.name || "",
          inviteUrl: firstWorker && firstWorkerClientId ? buildInviteUrl({ ...firstWorker.config, clientId: firstWorkerClientId }) : null,
        },
        voice: { options: buildVoiceChannelOptions(guild, voiceChannelId), selectedId: voiceChannelId, missing: voiceMissing },
        station: {
          options: buildStationOptions(entries, language, selectedStation?.key || null),
          selectedKey: selectedStation?.key || null,
          selectedName: selectedStation?.name || null,
        },
        panel: {
          options: buildPanelChannelOptions(guild, panelChannelId, { t, canUse: canPost }),
          selectedId: panelChannelId,
          missing: panelMissing,
        },
        hint,
      },
      urls: {
        dashboard: withLanguageParam(DASHBOARD_URL, language),
        permissionsHelp: withLanguageParam(`${String(WEBSITE_URL).replace(/\/+$/, "")}/faq`, language),
      },
      applicationId,
    });
  },

  // ③ is saved for the server right away; the worker reads it for the panel.
  async saveSetupPanelChannel(guildId, panelChannelId) {
    const result = panelChannelId && panelChannelId !== SETUP_PANEL_AUTO
      ? await updateGuildSettings(guildId, { nowPlayingChannelId: panelChannelId })
      : await updateGuildSettings(guildId, {}, { unset: ["nowPlayingChannelId"] });
    for (const runtime of new Set([this, ...(this.workerManager?.workers || [])])) {
      runtime?.invalidateGuildSettingsCache?.(guildId);
    }
    return result;
  },

  async handleSetupComponentInteraction(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const customId = String(interaction.customId || "");

    if (customId === SETUP_COMPONENT_ID_OPEN) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.respondInteraction(interaction, await this.openSetupWizard(interaction));
      return true;
    }
    if (customId === SETUP_COMPONENT_ID_HELP) {
      const payload = this.buildHelpMessage(interaction);
      await interaction.reply({ ...payload, flags: (Number(payload.flags) || 0) | MessageFlags.Ephemeral });
      return true;
    }

    const parsed = parseSetupCustomId(customId);
    if (!parsed) return false;
    const session = this.getInteractiveUiSession(parsed.sessionId, {
      type: "setup",
      guildId: interaction.guildId,
      userId: interaction.user?.id,
    });
    if (!session) {
      await interaction.update(asUpdate(buildNoticePayload({ t, language, code: "action-expired" })));
      return true;
    }

    // Reading channels and permissions can take a moment: acknowledge first.
    await interaction.deferUpdate();
    const value = interaction.values?.[0] === "__none__" ? null : (interaction.values?.[0] || null);
    let hint = null;
    if (parsed.action === "voice" && interaction.isStringSelectMenu?.()) {
      this.updateInteractiveUiSession(session.id, { data: { voiceChannelId: value } });
    } else if (parsed.action === "station" && interaction.isStringSelectMenu?.()) {
      this.updateInteractiveUiSession(session.id, { data: { stationKey: value } });
    } else if (parsed.action === "panel" && interaction.isStringSelectMenu?.()) {
      this.updateInteractiveUiSession(session.id, { data: { panelChannelId: value } });
      const saved = await this.saveSetupPanelChannel(session.guildId, value);
      if (!saved?.ok) {
        hint = {
          kind: "warning",
          title: t("Nicht gespeichert", "Not saved"),
          body: t(
            "Den Panel-Kanal konnte ich gerade nicht speichern. Versuch es gleich noch einmal.",
            "I could not save the panel channel right now. Please try again in a moment."
          ),
        };
      }
    } else if (parsed.action === "start") {
      return this.startSetupStream(interaction, this.getInteractiveUiSession(session.id));
    }

    const current = this.getInteractiveUiSession(session.id);
    await interaction.editReply(asUpdate(await this.buildSetupWizardView(interaction, current, { hint })));
    return true;
  },

  async startSetupStream(interaction, session) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = session.guildId;
    const { voiceChannelId, stationKey, panelChannelId } = session.data || {};
    const { guildTier, stationsData } = buildStationCatalog(guildId);
    const showHint = async (body) => {
      await interaction.editReply(asUpdate(await this.buildSetupWizardView(interaction, session, {
        hint: { kind: "error", title: t("Start hat nicht geklappt", "Could not start"), body },
      })));
      return true;
    };

    if (!voiceChannelId || !stationKey) {
      return showHint(t("Wähle zuerst Sprachkanal und Sender.", "Choose a voice channel and a station first."));
    }
    if (!stationsData.stations?.[stationKey]) {
      return showHint(t("Diesen Sender gibt es nicht (mehr). Wähle einen anderen.", "This station does not exist (any more). Pick another one."));
    }

    await this.workerManager?.refreshRemoteStates?.().catch(() => null);
    const outcome = await delegatePlayToWorker(this, {
      guildId,
      channelId: voiceChannelId,
      playable: { key: stationKey, playStations: stationsData, guildTier },
      t,
      language,
    });
    if (!outcome.ok) return showHint(outcome.message);

    this.deleteInteractiveUiSession(session.id);
    log("INFO", `[${this.config.name}] Setup guild=${guildId} station=${stationKey} -> ${outcome.result?.workerName || outcome.worker?.config?.name || "worker"}`);
    await interaction.editReply(asUpdate(buildSetupDonePayload({
      t,
      workerName: outcome.result?.workerName || outcome.worker?.config?.name || "",
      stationName: outcome.selectedStation?.name || stationKey,
      voiceChannelId,
      panelChannelId,
      recovering: outcome.result?.recovering === true,
      urls: { dashboard: withLanguageParam(DASHBOARD_URL, language) },
      quickstartId: PLAY_COMPONENT_ID_OPEN,
      applicationId: interaction?.applicationId || this.client?.application?.id || null,
    })));
    return true;
  },
};

export { onboardingMethods };
