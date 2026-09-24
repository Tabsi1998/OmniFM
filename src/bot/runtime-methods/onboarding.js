// Guild onboarding: the setup message a server gets when the bot joins.
// BotRuntime methods, moved out of runtime.js unchanged (#210) and mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { buildRuntimeSetupMessagePayload } from "../runtime-message-builders.js";
import {
  ONBOARDING_MESSAGE_ENABLED,
} from "../runtime-shared.js";

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

    const textChannels = [...guild.channels.cache.values()].filter((channel) => {
      return this.canSendOnboardingToChannel(channel, me);
    });
    if (!textChannels.length) return null;

    const scoreChannel = (channel) => {
      const name = String(channel.name || "").toLowerCase();
      let score = 0;
      if (name.includes("system")) score += 400;
      if (name.includes("mod") || name.includes("moderator")) score += 320;
      if (name.includes("admin") || name.includes("staff")) score += 300;
      if (name.includes("setup") || name.includes("config")) score += 280;
      if (name.includes("bot") || name.includes("command") || name.includes("kommando")) score += 220;
      if (name.includes("general") || name.includes("allgemein")) score += 150;
      score -= Number(channel.rawPosition || 0);
      return score;
    };

    textChannels.sort((a, b) => scoreChannel(b) - scoreChannel(a));
    return textChannels[0] || null;
  },

  buildSetupMessagePayload({ guild = null, language = null, guildId = null } = {}) {
    return buildRuntimeSetupMessagePayload(this, { guild, language, guildId });
  },

  buildOnboardingMessagePayload(guild) {
    const language = this.resolveGuildLanguage(guild?.id);
    return this.buildSetupMessagePayload({ guild, language, guildId: guild?.id });
  },

  buildSetupMessage(interaction) {
    return this.buildSetupMessagePayload({
      guild: interaction?.guild || null,
      language: this.resolveInteractionLanguage(interaction),
      guildId: interaction?.guildId,
    });
  },

  async sendGuildOnboardingMessage(guild) {
    if (!ONBOARDING_MESSAGE_ENABLED) return;
    if (!guild?.id) return;

    const channel = await this.resolveOnboardingChannel(guild);
    if (!channel) return;
    const payload = this.buildOnboardingMessagePayload(guild);
    await channel.send(payload);
  },
};

export { onboardingMethods };
