// ============================================================
// OmniFM Radio (#593): a server's setting for the live announcement
// ============================================================
// Stored in guild_settings under `omnifmRadioAnnounce`. On by default: the
// message goes to the server's system channel, without a role mention.
// "Off" is `enabled: false`. The dashboard sets it (every plan), the
// commander reads it before OmniFM 1 posts.
import { isOmnifmRadioVisibleForGuild } from "../services/omnifm-radio-config.js";

export const RADIO_ANNOUNCE_SETTINGS_KEY = "omnifmRadioAnnounce";

const snowflake = (value) => {
  const text = String(value ?? "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
};

/** @returns {{ enabled: boolean, channelId: string, roleId: string }} */
export function normalizeRadioAnnounceSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: input.enabled !== false,
    channelId: snowflake(input.channelId),
    roleId: snowflake(input.roleId),
  };
}

/**
 * What the dashboard shows: the setting, the server's system channel and the
 * roles to choose from. Only where the server sees OmniFM Radio; elsewhere
 * `available: false` and nothing else.
 * @param {string} guildId
 * @param {Record<string, any>} settings the stored guild settings
 * @param {{ guild?: any, visible?: boolean }} [options] guild: the server as a bot sees it
 */
export function buildDashboardRadioAnnounceResponse(guildId, settings = {}, { guild = null, visible = isOmnifmRadioVisibleForGuild(guildId) } = {}) {
  if (!visible) return { available: false };
  const systemChannel = guild?.systemChannel || null;
  const roles = [...(guild?.roles?.cache?.values?.() || [])]
    .filter((role) => role && !role.managed && role.id !== guild.id)
    .sort((a, b) => (Number(b.position) || 0) - (Number(a.position) || 0))
    .map((role) => ({ id: role.id, name: role.name, color: role.hexColor || "#99AAB5", mentionable: role.mentionable === true }));
  return {
    available: true,
    ...normalizeRadioAnnounceSettings(settings?.[RADIO_ANNOUNCE_SETTINGS_KEY]),
    systemChannel: systemChannel ? { id: systemChannel.id, name: systemChannel.name } : null,
    roles,
  };
}
