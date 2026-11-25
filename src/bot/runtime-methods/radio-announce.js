// OmniFM Radio (#593): what OmniFM 1 does for the live announcement.
// BotRuntime methods, mixed into BotRuntime.prototype in src/bot/runtime.js.
// The commander (src/services/omnifm-radio-announce.js) decides who gets a
// message; these run in the bot that posts it, also behind the worker
// bridge (commands "radioAnnounce" and "radioAnnounceEnd").
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";

import { loadBotConfigs } from "../../bot-config.js";
import * as ui from "../../discord/ui/index.js";
import { botTranslator } from "../../lib/bot-i18n.js";
import { log } from "../../lib/logging.js";
import { getOmnifmRadioConfig } from "../../services/omnifm-radio-config.js";
import { createOmnifmRadioAnnounceStore } from "../../omnifm-radio-announce-store.js";
import { radioAnnounceRole } from "../../lib/omnifm-radio-announce-settings.js";
import { buildRadioEndedPayload, buildRadioLivePayload } from "../omnifm-radio-announce-messages.js";
import { buildStationCatalog } from "../runtime-panels.js";

let defaultStore = null;
/** Where the claim lives (tests set runtime.radioAnnounceStore). */
const announceStore = (runtime) => runtime.radioAnnounceStore || (defaultStore ||= createOmnifmRadioAnnounceStore());

const POST_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

function canPost(channel, me) {
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return false;
  const perms = channel.permissionsFor?.(me);
  return POST_PERMISSIONS.every((flag) => perms?.has(flag));
}

/** The user ids of all OmniFM bots of this installation. */
function omnifmBotIds() {
  try {
    return new Set(loadBotConfigs(process.env).map((bot) => String(bot.clientId)));
  } catch {
    return new Set();
  }
}

/** The channel this bot streams in on the server, or "". */
function streamingChannelId(state) {
  if (!state?.currentStationKey) return "";
  return String(state.connection?.joinConfig?.channelId || state.lastChannelId || "").trim();
}

/**
 * The channel the announcement goes to (the chosen one, else the system
 * channel) once this bot may write there, else the reason it may not.
 * Without `fetch` only the cache is asked: no call to Discord.
 */
async function announceTarget(runtime, guildId, channelId, { fetch = false } = {}) {
  const guild = runtime.client.guilds.cache.get(guildId);
  if (!guild) return { reason: "not-in-guild" };
  const me = guild.members?.me || (fetch ? await runtime.resolveBotMember(guild) : null);
  if (!me) return { reason: "no-member" };
  const channel = channelId
    ? guild.channels.cache.get(channelId) || (fetch ? await guild.channels.fetch(channelId).catch(() => null) : null)
    : guild.systemChannel;
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    return { reason: "no-channel" };
  }
  if (!canPost(channel, me)) return { reason: "missing-permissions" };
  return { guild, channel };
}

const radioAnnounceMethods = {
  /** Whether this bot could post on the server now, from its cache only (before the commander's pause). */
  async checkRadioAnnouncement(guildId, { channelId = "" } = {}) {
    const target = await announceTarget(this, guildId, channelId);
    return target.reason ? { ok: false, reason: target.reason } : { ok: true };
  },

  /** Posts the live message: the chosen channel, else the system channel. */
  async postRadioAnnouncement(guildId, { channelId = "", roleId = "", show = {}, claim = null } = {}) {
    const target = await announceTarget(this, guildId, channelId, { fetch: true });
    if (target.reason) return { ok: false, reason: target.reason };
    const { guild, channel } = target;
    // A deleted role, @everyone or a bot role is never mentioned, whatever is stored.
    const role = radioAnnounceRole(guild, roleId);
    const payload = buildRadioLivePayload({
      t: botTranslator(this.resolveGuildLanguage(guildId)),
      show,
      roleId: role ? role.id : "",
      botName: this.config?.name || "OmniFM 1",
      applicationId: this.client.application?.id || null,
    });
    try {
      const message = await channel.send(payload);
      // Written here too: if the commander's wait timed out, the id still reaches the claim.
      if (claim) {
        await announceStore(this).setMessage(claim, { channelId: channel.id, messageId: message.id, at: new Date() })
          .catch((error) => log("WARN", `[OmniFM Radio] Ankündigung ${guildId}: Nachricht nicht vermerkt: ${error?.message || error}`));
      }
      return { ok: true, channelId: channel.id, messageId: message.id };
    } catch (error) {
      // Rights changed since the check, the channel is gone: skipped like the rest.
      return { ok: false, reason: String(error?.code || error?.message || "send-failed") };
    }
  },

  /** Edits the live message into "show over", without a second message. */
  async endRadioAnnouncement(guildId, { channelId = "", messageId = "", show = {} } = {}) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, reason: "not-in-guild" };
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.messages) return { ok: false, reason: "no-channel" };
    const payload = buildRadioEndedPayload({
      t: botTranslator(this.resolveGuildLanguage(guildId)),
      show,
      applicationId: this.client.application?.id || null,
    });
    try {
      await channel.messages.edit(messageId, payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.code || error?.message || "edit-failed") };
    }
  },

  /**
   * "Listen now": this bot comes into the presser's voice channel and plays
   * OmniFM Radio, under the same rules as /play with that station. It never
   * leaves a channel where it plays, and never joins one where another
   * OmniFM bot plays.
   */
  async handleRadioListenButton(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const applicationId = this.client.application?.id || null;
    const answer = (kind, title, body = "") => {
      const payload = ui.reply(ui.notice(kind, { title, body, applicationId }));
      if (interaction.deferred || interaction.replied) return interaction.editReply({ ...payload, flags: MessageFlags.IsComponentsV2 });
      return interaction.reply(payload);
    };
    const guildId = String(interaction.guildId || "");
    const guild = interaction.guild || this.client.guilds.cache.get(guildId);
    if (!guildId || !guild) {
      await answer("warning", t("Nur auf Servern", "Servers only"));
      return true;
    }
    const access = this.getGuildAccess(guildId);
    if (!access.allowed) {
      await this.replyAccessDenied(interaction, access);
      return true;
    }
    const permission = this.checkCommandRolePermission(interaction, "play");
    if (!permission?.ok) {
      await answer("warning", t("Nicht erlaubt", "Not allowed"), permission?.message || t("Dafür fehlen dir die Rechte.", "You are not allowed to do that."));
      return true;
    }
    const radioKey = getOmnifmRadioConfig().stationKey;
    // The server's own catalog: OmniFM Radio is only in it where it is visible.
    const { stationsData } = buildStationCatalog(guildId);
    if (!stationsData?.stations?.[radioKey]) {
      await answer("warning", t("OmniFM Radio gibt es hier nicht", "OmniFM Radio is not available here"), t(
        "Auf diesem Server kann OmniFM Radio gerade nicht gespielt werden.",
        "OmniFM Radio cannot be played on this server right now."
      ));
      return true;
    }
    const member = interaction.member?.voice ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
    const voiceChannelId = String(member?.voice?.channelId || "");
    if (!voiceChannelId) {
      await answer("info", t("Kein Sprachkanal", "No voice channel"), t(
        "Geh zuerst in einen Sprachkanal und drück dann noch mal auf „Jetzt hören“.",
        "Join a voice channel first, then press “Listen now” again."
      ));
      return true;
    }
    const bot = this.config?.name || "OmniFM 1";
    /** OmniFM 1 already plays: in the presser's channel, or for other listeners. */
    const answerBusy = (busyIn, stationKey) => (busyIn === voiceChannelId && stationKey === radioKey
      ? answer("success", t("Läuft schon", "Already on"), t("OmniFM Radio läuft schon in deinem Sprachkanal.", "OmniFM Radio is already playing in your voice channel."))
      : answer("info", t("{bot} spielt schon", "{bot} is already playing", { bot }), t(
        "{bot} spielt gerade in {channel}. Damit dort niemand umgeschaltet wird, starte OmniFM Radio mit `/play` bei einem anderen Bot.",
        "{bot} is playing in {channel} right now. So nobody there is switched, start OmniFM Radio with `/play` on another bot.",
        { bot, channel: `<#${busyIn}>` }
      )));
    // A quick answer here; the check that counts runs inside playInGuild's lock.
    const state = this.guildState?.get?.(guildId);
    const busyIn = streamingChannelId(state);
    if (busyIn) {
      await answerBusy(busyIn, state.currentStationKey);
      return true;
    }
    const voiceChannel = guild.channels.cache.get(voiceChannelId) || null;
    const ownIds = omnifmBotIds();
    const otherBot = [...(voiceChannel?.members?.values?.() || [])]
      .find((entry) => entry?.user?.bot && entry.id !== this.client.user?.id && ownIds.has(String(entry.id)));
    if (otherBot) {
      await answer("info", t("Hier spielt schon ein Bot", "A bot is already playing here"), t(
        "In deinem Sprachkanal ist schon {bot}. Mit `/play` kannst du dort auf OmniFM Radio umschalten.",
        "{bot} is already in your voice channel. Use `/play` to switch it to OmniFM Radio.",
        { bot: otherBot.displayName || otherBot.user?.username || "OmniFM" }
      ));
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const voiceAccess = await this.validateVoiceChannelAccess(guild, voiceChannel, { language, workerName: bot });
    if (!voiceAccess.ok) {
      await answer("warning", t("Das geht gerade nicht", "That does not work right now"), voiceAccess.message);
      return true;
    }
    const result = await this.playInGuild(guildId, voiceChannelId, radioKey, stationsData, undefined, { onlyWhenIdle: true });
    if (result?.busy) {
      await answerBusy(String(result.channelId || ""), result.stationKey);
      return true;
    }
    if (!result?.ok) {
      await answer("error", t("Start fehlgeschlagen", "Start failed"), result?.error || "");
      return true;
    }
    log("INFO", `[${bot}] OmniFM Radio per „Jetzt hören“ guild=${guildId} channel=${voiceChannelId}`);
    // Split mode: the commander sees at once that this bot is busy now.
    await this.publishWorkerSnapshot?.().catch(() => null);
    await answer("success", t("OmniFM Radio läuft", "OmniFM Radio is on"), t(
      "{bot} spielt jetzt OmniFM Radio in {channel}.",
      "{bot} is now playing OmniFM Radio in {channel}.",
      { bot, channel: `<#${voiceChannelId}>` }
    ));
    return true;
  },
};

export { radioAnnounceMethods };
