// Interactive menus: invite and worker menus, streaming runtime selection,
// component routing and the short-lived UI sessions behind them.
// BotRuntime methods, moved out of runtime.js unchanged (#210) and mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { log } from "../../lib/logging.js";
import { SAVED_SONGS_PREFIX } from "../saved-songs.js";
import { clipText } from "../../lib/helpers.js";
import { getTier } from "../../core/entitlements.js";
import { BRAND } from "../../config/plans.js";
import { brandFooter, brandAuthor } from "../brand-embed.js";
import { isComponentsV2Message } from "../../discord/ui/index.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import { buildInviteUrl } from "../../bot-config.js";
import { SETUP_COMPONENT_PREFIX } from "../setup-wizard.js";
import {
  INVITE_COMPONENT_PREFIX,
  INVITE_COMPONENT_ID_OPEN,
  INVITE_COMPONENT_ID_REFRESH,
  INVITE_COMPONENT_ID_SELECT,
  INVITE_COMPONENT_ID_CLOSE,
  WORKERS_COMPONENT_PREFIX,
  WORKERS_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_REFRESH,
  WORKERS_COMPONENT_ID_PAGE_PREFIX,
  PLAY_COMPONENT_PREFIX,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_PREFIX,
  STATIONS_COMPONENT_ID_OPEN,
} from "../runtime-links.js";
import { buildRuntimeHelpMessage, buildRuntimeWorkersStatusPayload } from "../runtime-message-builders.js";
import { handleRuntimePanelInteraction } from "../runtime-panels.js";
import { HELP_COMPONENT_PREFIX, HELP_SECTION_SELECT_ID } from "../help-panel.js";
import {
  NP_PREFIX,
} from "../runtime-shared.js";

const menuMethods = {
  pruneInteractiveUiSessions(now = Date.now()) {
    if (!(this.interactiveUiSessions instanceof Map)) {
      this.interactiveUiSessions = new Map();
      return;
    }
    for (const [sessionId, session] of this.interactiveUiSessions.entries()) {
      if (!session || Number(session.expiresAt || 0) <= now) {
        this.interactiveUiSessions.delete(sessionId);
      }
    }
  },

  createInteractiveUiSession(type, {
    guildId = null,
    userId = null,
    ttlMs = 15 * 60_000,
    data = {},
  } = {}) {
    this.pruneInteractiveUiSessions();
    const createdAt = Date.now();
    const id = `${createdAt.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const session = {
      id,
      type: String(type || "").trim(),
      guildId: String(guildId || "").trim() || null,
      userId: String(userId || "").trim() || null,
      data: data && typeof data === "object" ? { ...data } : {},
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + Math.max(30_000, Number(ttlMs) || 0),
    };
    this.interactiveUiSessions.set(id, session);
    return session;
  },

  getInteractiveUiSession(sessionId, {
    type = null,
    guildId = null,
    userId = null,
  } = {}) {
    this.pruneInteractiveUiSessions();
    const normalizedId = String(sessionId || "").trim();
    if (!normalizedId) return null;
    const session = this.interactiveUiSessions.get(normalizedId);
    if (!session) return null;
    if (type && session.type !== String(type)) return null;
    if (guildId && session.guildId !== String(guildId)) return null;
    if (userId && session.userId && session.userId !== String(userId)) return null;
    return session;
  },

  updateInteractiveUiSession(sessionId, patch = {}) {
    const session = this.getInteractiveUiSession(sessionId);
    if (!session) return null;
    const nextData = patch.data && typeof patch.data === "object"
      ? { ...session.data, ...patch.data }
      : session.data;
    const updated = {
      ...session,
      ...patch,
      data: nextData,
      updatedAt: Date.now(),
    };
    this.interactiveUiSessions.set(session.id, updated);
    return updated;
  },

  deleteInteractiveUiSession(sessionId) {
    const normalizedId = String(sessionId || "").trim();
    if (!normalizedId) return false;
    return this.interactiveUiSessions.delete(normalizedId);
  },

  getStreamingRuntimeSelectionMessage(reason, language = "de") {
    const isDe = String(language || "de").toLowerCase() === "de";
    const messages = {
      none: isDe
        ? "Auf diesem Server streamt gerade kein Worker. Starte zuerst `/play`."
        : "No worker is currently streaming on this server. Start `/play` first.",
      multiple: isDe
        ? "Mehrere Worker streamen aktuell. Tritt dem Ziel-Voice-Channel bei, damit ich den richtigen Stream waehle."
        : "Multiple workers are currently streaming. Join the target voice channel so I can select the correct stream.",
      multiple_in_channel: isDe
        ? "In deinem Voice-Channel sind mehrere Worker aktiv. Stoppe einen davon oder waehle einen eindeutigen Ziel-Channel."
        : "Multiple workers are active in your voice channel. Stop one of them or choose a unique target channel.",
      requested_missing: isDe
        ? "Der gewählte Worker streamt aktuell nicht auf diesem Server."
        : "The selected worker is not currently streaming on this server.",
    };
    return messages[reason] || messages.none;
  },

  async resolveStreamingRuntimeForInteraction(interaction) {
    const guildId = String(interaction?.guildId || "").trim();
    if (!guildId) {
      return { runtime: null, state: null, reason: "none" };
    }

    if (this.role !== "commander" || !this.workerManager) {
      return { runtime: this, state: this.getState(guildId), reason: null };
    }

    if (typeof this.workerManager.refreshRemoteStates === "function") {
      await this.workerManager.refreshRemoteStates().catch(() => null);
    }

    const requestedBotIndex = this.getIntegerOptionFlexible(interaction, ["bot"]);
    const requestedSlotIndex = requestedBotIndex === null
      ? this.getIntegerOptionFlexible(interaction, ["worker"])
      : null;
    const requestedWorkerIndex = requestedBotIndex ?? requestedSlotIndex;
    if (requestedWorkerIndex !== null) {
      const resolvedWorker = this.workerManager.resolveWorker(requestedWorkerIndex, { prefer: "slot", strict: true });
      const streamingWorkers = this.workerManager.getStreamingWorkers(guildId);
      const isStreamingWorker = resolvedWorker?.worker && streamingWorkers.includes(resolvedWorker.worker);
      if (!resolvedWorker?.worker || !isStreamingWorker) {
        return {
          runtime: null,
          state: null,
          reason: "requested_missing",
          requestedWorkerIndex,
          requestedWorkerSlot: Number(resolvedWorker?.workerSlot || 0) || null,
        };
      }
      return {
        runtime: resolvedWorker.worker,
        state: resolvedWorker.worker.getState(guildId),
        reason: null,
        requestedWorkerIndex,
        requestedWorkerSlot: Number(resolvedWorker.workerSlot || 0) || null,
      };
    }

    const workers = this.workerManager.getStreamingWorkers(guildId);
    if (!workers.length) {
      return { runtime: null, state: null, reason: "none" };
    }

    const guild = interaction.guild
      || this.client.guilds.cache.get(guildId)
      || await this.client.guilds.fetch(guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
    const userChannelId = String(member?.voice?.channelId || "").trim();

    if (userChannelId) {
      const matchingWorkers = workers.filter((worker) => {
        const info = worker.getGuildInfo(guildId);
        return String(info?.channelId || "").trim() === userChannelId;
      });
      if (matchingWorkers.length === 1) {
        const runtime = matchingWorkers[0];
        return { runtime, state: runtime.getState(guildId), reason: null };
      }
      if (matchingWorkers.length > 1) {
        return { runtime: null, state: null, reason: "multiple_in_channel" };
      }
    }

    if (workers.length === 1) {
      const runtime = workers[0];
      return { runtime, state: runtime.getState(guildId), reason: null };
    }

    return { runtime: null, state: null, reason: "multiple" };
  },

  getIntegerOptionFlexible(interaction, optionNames = []) {
    const resolver = interaction?.options;
    if (!resolver || !Array.isArray(optionNames) || optionNames.length === 0) return null;

    const parseValue = (value) => {
      if (Number.isInteger(value)) return value;
      const parsed = Number.parseInt(String(value ?? "").trim(), 10);
      return Number.isInteger(parsed) ? parsed : null;
    };

    for (const rawName of optionNames) {
      const name = String(rawName || "").trim();
      if (!name) continue;

      try {
        const direct = resolver.getInteger(name, false);
        const parsedDirect = parseValue(direct);
        if (parsedDirect !== null) return parsedDirect;
      } catch {
        // ignore option type mismatch
      }

      try {
        const asString = resolver.getString(name, false);
        const parsedString = parseValue(asString);
        if (parsedString !== null) return parsedString;
      } catch {
        // ignore option type mismatch
      }

      try {
        const raw = resolver.get(name, false);
        const parsedRaw = parseValue(raw?.value);
        if (parsedRaw !== null) return parsedRaw;
      } catch {
        // ignore missing option
      }
    }

    const rawData = Array.isArray(resolver.data) ? resolver.data : [];
    for (const rawName of optionNames) {
      const name = String(rawName || "").trim();
      if (!name) continue;
      const option = rawData.find((entry) => String(entry?.name || "").trim() === name);
      const parsed = parseValue(option?.value);
      if (parsed !== null) return parsed;
    }

    return null;
  },

  getWorkerRequiredTierBySlot(slot) {
    const idx = Number.parseInt(String(slot || ""), 10);
    if (!Number.isFinite(idx) || idx <= 2) return "free";
    if (idx <= 8) return "pro";
    return "ultimate";
  },

  formatTierLabel(tier, language) {
    const normalized = String(tier || "free").toLowerCase();
    if (normalized === "ultimate") return "Ultimate";
    if (normalized === "pro") return "Pro";
    return language === "de" ? "Free" : "Free";
  },

  async isWorkerAlreadyInvited(guild, worker) {
    if (!guild || !worker) return false;
    const clientId = String(worker.getApplicationId?.() || worker.config?.clientId || "").trim();
    if (!/^\d{17,22}$/.test(clientId)) return false;

    if (worker.client?.isReady?.() && worker.client.guilds.cache.has(guild.id)) {
      return true;
    }
    if (guild.members?.cache?.has(clientId)) {
      return true;
    }
    const member = await guild.members.fetch(clientId).catch(() => null);
    return Boolean(member);
  },

  async collectInviteWorkerState(guild) {
    const guildId = String(guild?.id || "").trim();
    const guildTier = getTier(guildId);
    const maxIndex = this.workerManager.getMaxWorkerIndex(guildTier);
    const workers = [];
    const statuses = this.workerManager.getAllStatuses();

    for (const status of statuses) {
      const slot = Number(status?.index || 0);
      if (!slot) continue;
      const worker = this.workerManager.getWorkerByIndex(slot, { prefer: "slot" });
      const requiredTier = this.getWorkerRequiredTierBySlot(slot);
      const tierLocked = slot > maxIndex;
      const resolvedClientId = String(worker?.getApplicationId?.() || worker?.config?.clientId || status?.clientId || "").trim();
      const inviteUrl = resolvedClientId && worker
        ? buildInviteUrl({ ...worker.config, clientId: resolvedClientId })
        : null;
      const alreadyInvited = worker ? await this.isWorkerAlreadyInvited(guild, worker) : false;

      workers.push({
        slot,
        botIndex: Number(status?.botIndex || worker?.config?.index || 0) || null,
        name: worker?.config?.name || status?.name || `Worker ${slot}`,
        requiredTier,
        tierLocked,
        online: Boolean(status?.online),
        inviteUrl,
        alreadyInvited,
        selectable: !tierLocked && !alreadyInvited && Boolean(inviteUrl),
      });
    }

    workers.sort((a, b) => a.slot - b.slot);
    const selectableWorkers = workers.filter((worker) => worker.selectable);
    const invitedWorkers = workers.filter((worker) => worker.alreadyInvited && !worker.tierLocked);
    const lockedWorkers = workers.filter((worker) => worker.tierLocked);
    return {
      guildTier,
      maxIndex,
      workers,
      selectableWorkers,
      invitedWorkers,
      lockedWorkers,
    };
  },

  formatWorkerBadge(worker) {
    const botIndexLabel = worker.botIndex ? `, BOT_${worker.botIndex}` : "";
    return `#${worker.slot}${botIndexLabel}`;
  },

  formatWorkerList(items = [], maxLines = 8, moreLabel = "weitere") {
    if (!Array.isArray(items) || !items.length) return "-";
    const lines = items.slice(0, maxLines).map((item) => {
      return `\`${this.formatWorkerBadge(item)}\` ${item.name}`;
    });
    if (items.length > maxLines) {
      lines.push(`+${items.length - maxLines} ${moreLabel}`);
    }
    return lines.join("\n");
  },

  async buildInviteMenuPayload(interaction, { selectedWorkerSlot = null, hint = "" } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guild = interaction.guild || this.client.guilds.cache.get(interaction.guildId) || null;
    if (!guild) {
      return {
        content: t("Server konnte nicht gefunden werden.", "Could not resolve server."),
        embeds: [],
        components: [],
      };
    }

    const inviteState = await this.collectInviteWorkerState(guild);
    const moreLabel = t("weitere", "more");
    const selectedWorker = inviteState.selectableWorkers.find((worker) => worker.slot === Number(selectedWorkerSlot))
      || inviteState.selectableWorkers[0]
      || null;

    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setAuthor(brandAuthor())
      .setTitle(t("Worker-Bots einladen", "Invite worker bots"))
      .setDescription(
        t(
          `Plan: **${this.formatTierLabel(inviteState.guildTier, language)}** | Verfügbare Worker: **1-${inviteState.maxIndex}**\nWähle einen Worker unten aus und nutze den Invite-Button.`,
          `Plan: **${this.formatTierLabel(inviteState.guildTier, language)}** | Available workers: **1-${inviteState.maxIndex}**\nSelect a worker below and use the invite button.`
        )
      )
      .addFields(
        {
          name: t("Bereits eingeladen", "Already invited"),
          value: this.formatWorkerList(inviteState.invitedWorkers, 8, moreLabel),
          inline: true,
        },
        {
          name: t("Jetzt auswaehlbar", "Selectable now"),
          value: this.formatWorkerList(inviteState.selectableWorkers, 8, moreLabel),
          inline: true,
        },
        {
          name: t("Gesperrt durch Plan", "Locked by plan"),
          value: this.formatWorkerList(inviteState.lockedWorkers, 8, moreLabel),
          inline: false,
        }
      );

    if (selectedWorker) {
      embed.setFooter(brandFooter(t(
        `Ausgewaehlt: ${selectedWorker.name} (${this.formatWorkerBadge(selectedWorker)})`,
        `Selected: ${selectedWorker.name} (${this.formatWorkerBadge(selectedWorker)})`
      )));
    } else {
      embed.setFooter(brandFooter(t(
        "Kein Worker auswaehlbar. Entweder schon eingeladen oder Plan-Limit erreicht.",
        "No worker is selectable. Workers are already invited or plan-limited."
      )));
    }

    if (hint) {
      embed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(String(hint), 900),
        inline: false,
      });
    }

    const rows = [];
    const selectOptions = inviteState.selectableWorkers.slice(0, 25).map((worker) => ({
      label: clipText(`${worker.name}`, 90),
      description: clipText(`${this.formatWorkerBadge(worker)} - ${this.formatTierLabel(worker.requiredTier, language)}`, 90),
      value: String(worker.slot),
      default: selectedWorker ? worker.slot === selectedWorker.slot : false,
    }));

    if (selectOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(INVITE_COMPONENT_ID_SELECT)
        .setPlaceholder(t("Worker-Bot auswaehlen", "Select worker bot"))
        .addOptions(selectOptions);
      rows.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    const buttons = new ActionRowBuilder();
    if (selectedWorker?.inviteUrl) {
      buttons.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(
            t(
              `Invite ${selectedWorker.name}`,
              `Invite ${selectedWorker.name}`
            )
          )
          .setURL(selectedWorker.inviteUrl)
      );
    } else {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(`${INVITE_COMPONENT_PREFIX}noop`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(t("Kein Invite verfügbar", "No invite available"))
          .setDisabled(true)
      );
    }

    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_REFRESH)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Aktualisieren", "Refresh")),
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_CLOSE)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Schliessen", "Close"))
    );
    rows.push(buttons);

    return {
      embeds: [embed],
      components: rows,
    };
  },

  async handleInviteComponentInteraction(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    if (this.role !== "commander" || !this.workerManager) {
      if (interaction.isRepliable?.()) {
        await interaction.reply(buildNoticePayload({ t, language, code: "commander-only" }));
      }
      return true;
    }

    if (!interaction.guildId) {
      await interaction.reply(buildNoticePayload({ t, language, code: "guild-only" }));
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_CLOSE) {
      await interaction.update({
        content: t("Invite-Menue geschlossen.", "Invite menu closed."),
        embeds: [],
        components: [],
      });
      return true;
    }

    // From a Components V2 message (#269, /help) the invite menu comes as
    // its own private message: V2 cannot be edited into embeds.
    if (interaction.customId === INVITE_COMPONENT_ID_OPEN && isComponentsV2Message(interaction.message)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(await this.buildInviteMenuPayload(interaction));
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_REFRESH || interaction.customId === INVITE_COMPONENT_ID_OPEN) {
      await interaction.deferUpdate();
      const payload = await this.buildInviteMenuPayload(interaction);
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_SELECT && interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();
      const selectedSlot = Number.parseInt(String(interaction.values?.[0] || ""), 10);
      const payload = await this.buildInviteMenuPayload(interaction, {
        selectedWorkerSlot: Number.isFinite(selectedSlot) ? selectedSlot : null,
      });
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId.startsWith(INVITE_COMPONENT_PREFIX)) {
      await interaction.reply(buildNoticePayload({ t, language, code: "action-expired" }));
      return true;
    }

    return false;
  },

  async buildWorkersStatusPayload(interaction, { hint = "", page = 0 } = {}) {
    return buildRuntimeWorkersStatusPayload(this, interaction, { hint, page });
  },

  async handleWorkersComponentInteraction(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    if (this.role !== "commander" || !this.workerManager) {
      if (interaction.isRepliable?.()) {
        await interaction.reply(buildNoticePayload({ t, language, code: "commander-only" }));
      }
      return true;
    }

    if (!interaction.guildId) {
      await interaction.reply(buildNoticePayload({ t, language, code: "guild-only" }));
      return true;
    }

    // A Components V2 message (#264, e.g. /status) cannot be edited into an
    // embed: the worker overview then comes as its own private message.
    if (interaction.customId === WORKERS_COMPONENT_ID_OPEN && isComponentsV2Message(interaction.message)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(await this.buildWorkersStatusPayload(interaction));
      return true;
    }

    if (interaction.customId === WORKERS_COMPONENT_ID_REFRESH || interaction.customId === WORKERS_COMPONENT_ID_OPEN) {
      await interaction.deferUpdate();
      const payload = await this.buildWorkersStatusPayload(interaction);
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId.startsWith(WORKERS_COMPONENT_ID_PAGE_PREFIX)) {
      const rawPage = interaction.customId.slice(WORKERS_COMPONENT_ID_PAGE_PREFIX.length);
      const nextPage = Number.parseInt(rawPage, 10);
      if (!Number.isFinite(nextPage) || nextPage < 0) {
        await interaction.reply(buildNoticePayload({ t, language, code: "action-expired" }));
        return true;
      }
      await interaction.deferUpdate();
      const payload = await this.buildWorkersStatusPayload(interaction, { page: nextPage });
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId.startsWith(WORKERS_COMPONENT_PREFIX)) {
      await interaction.reply(buildNoticePayload({ t, language, code: "action-expired" }));
      return true;
    }

    return false;
  },

  async handleComponentInteraction(interaction) {
    // Modal submits too: the station browser's search form (#268) never
    // arrived here before and failed with "interaction failed".
    if (!interaction || (!interaction.isButton?.() && !interaction.isStringSelectMenu?.() && !interaction.isModalSubmit?.())) return false;
    const customId = String(interaction.customId || "");
    try {
      if (customId.startsWith(SETUP_COMPONENT_PREFIX)) {
        return this.handleSetupComponentInteraction(interaction);
      }
      if (customId.startsWith(INVITE_COMPONENT_PREFIX)) {
        return this.handleInviteComponentInteraction(interaction);
      }
      if (customId.startsWith(WORKERS_COMPONENT_PREFIX)) {
        return this.handleWorkersComponentInteraction(interaction);
      }
      if (customId.startsWith(NP_PREFIX)) {
        return this.handleNowPlayingControl(interaction);
      }
      if (customId.startsWith(HELP_COMPONENT_PREFIX)) {
        return this.handleHelpComponentInteraction(interaction);
      }
      if (
        customId === PLAY_COMPONENT_ID_OPEN
        || customId === STATIONS_COMPONENT_ID_OPEN
        || customId.startsWith(PLAY_COMPONENT_PREFIX)
        || customId.startsWith(STATIONS_COMPONENT_PREFIX)
      ) {
        return handleRuntimePanelInteraction(this, interaction);
      }
      if (customId.startsWith(SAVED_SONGS_PREFIX)) {
        return this.handleSavedSongsComponent(interaction);
      }
      return false;
    } catch (err) {
      const { t } = this.createInteractionTranslator(interaction);
      log(
        "ERROR",
        `[${this.config.name}] Component interaction error (customId=${customId || "-"}) guild=${interaction?.guildId || "-"}: ${err?.stack || err}`
      );
      const payload = {
        content: t(
          "Aktion fehlgeschlagen. Bitte aktualisiere die Ansicht und versuche es erneut.",
          "Action failed. Please refresh the view and try again."
        ),
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.deferred || interaction.replied) {
          const editPayload = { ...payload };
          delete editPayload.flags;
          await interaction.editReply(editPayload);
        } else {
          await interaction.reply(payload);
        }
      } catch {
        // ignore secondary reply failures
      }
      return true;
    }
  },

  buildHelpMessage(interaction, section = "overview") {
    return buildRuntimeHelpMessage(this, interaction, section);
  },

  // The topic menu of /help (#269) switches the page in place.
  async handleHelpComponentInteraction(interaction) {
    if (interaction.customId === HELP_SECTION_SELECT_ID && interaction.isStringSelectMenu?.()) {
      await interaction.update(this.buildHelpMessage(interaction, interaction.values?.[0] || "overview"));
      return true;
    }
    return false;
  },
};

export { menuMethods };
