// ============================================================
// OmniFM: Stage channels need a Stage moderator
// ============================================================
// Discord lets only a Stage moderator start a Stage, speak without asking
// and hang a server event on a Stage. A Stage moderator is whoever has these
// three rights in that channel; Discord sets them per channel via
// "Stage moderators", so the server-wide role alone says nothing.
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { languagePick } from "../lib/language.js";

const STAGE_MODERATOR_PERMISSIONS = [
  [PermissionFlagsBits.ManageChannels, "Manage Channels"],
  [PermissionFlagsBits.MuteMembers, "Mute Members"],
  [PermissionFlagsBits.MoveMembers, "Move Members"],
];

function isStageChannel(channel) {
  return channel?.type === ChannelType.GuildStageVoice;
}

function missingStageModeratorPermissions(channel, member) {
  const perms = member ? channel?.permissionsFor?.(member) : null;
  return STAGE_MODERATOR_PERMISSIONS
    .filter(([flag]) => !perms?.has?.(flag))
    .map(([, label]) => label);
}

function stageModeratorHowTo(language) {
  return languagePick(
    language,
    "So geht's: Stage-Kanal bearbeiten → Berechtigungen → Stage-Moderatoren → den Bot hinzufügen.",
    "How to: edit the Stage channel → Permissions → Stage Moderators → add the bot."
  );
}

function botUserId(bot) {
  return String(bot?.getApplicationId?.() || bot?.client?.user?.id || "").trim();
}

async function resolveBotMemberInGuild(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members?.cache?.get?.(userId)
    || await guild.members?.fetch?.(userId).catch(() => null)
    || null;
}

/**
 * Which of the given bots may speak in the Stage channel?
 * @returns {Promise<{ moderators: any[], others: any[] }>}
 */
async function splitStageModeratorBots(guild, channel, bots) {
  const list = bots || [];
  const members = await Promise.all(list.map((bot) => resolveBotMemberInGuild(guild, botUserId(bot))));
  const moderators = [];
  const others = [];
  list.forEach((bot, index) => {
    const member = members[index];
    if (member && missingStageModeratorPermissions(channel, member).length === 0) {
      moderators.push(bot);
    } else {
      others.push(bot);
    }
  });
  return { moderators, others };
}

/**
 * The bots that would play an event here: the invited workers, or the bot
 * itself when it plays on its own.
 */
function stagePlaybackBots(runtime, guildId, tier) {
  if (runtime?.role === "commander" && runtime.workerManager) {
    return runtime.workerManager.getInvitedWorkers(guildId, tier);
  }
  return [runtime];
}

/**
 * An event in a Stage channel only plays when at least one of the playing
 * bots is Stage moderator there; otherwise it sits silently in the audience.
 * @returns {Promise<string|null>} the reason in plain words, or null
 */
async function validateStageEventSpeakers(runtime, guild, channel, tier, language = "en") {
  if (!isStageChannel(channel)) return null;
  const bots = stagePlaybackBots(runtime, guild?.id, tier);
  if (!bots.length) return null;
  const { moderators, others } = await splitStageModeratorBots(guild, channel, bots);
  if (moderators.length) return null;
  const names = others.map((bot) => bot?.config?.name).filter(Boolean).join(", ") || "OmniFM";
  return languagePick(
    language,
    `In ${channel.toString()} darf ${names} noch nicht sprechen. Damit das Event dort läuft, muss der Bot in diesem Stage-Kanal Stage-Moderator sein.\n${stageModeratorHowTo("de")}`,
    `${names} may not speak in ${channel.toString()} yet. For the event to play there, the bot has to be a Stage moderator in this Stage channel.\n${stageModeratorHowTo("en")}`
  );
}

export {
  isStageChannel,
  missingStageModeratorPermissions,
  stageModeratorHowTo,
  splitStageModeratorBots,
  stagePlaybackBots,
  validateStageEventSpeakers,
};
