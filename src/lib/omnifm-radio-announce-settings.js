// ============================================================
// OmniFM Radio (#593): a server's setting for the live announcement
// ============================================================
// Stored in guild_settings under `omnifmRadioAnnounce`. On by default: the
// message goes to the server's system channel, without a role mention.
// "Off" is `enabled: false`. The dashboard sets it (every plan), the
// commander reads it with loadRadioAnnounceSettings before OmniFM 1 posts.
import { getDb, isConnected, isMongoRequested } from "./db.js";
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
    // Only a real false switches it off; anything else is the default.
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    channelId: snowflake(input.channelId),
    roleId: snowflake(input.roleId),
  };
}

/**
 * The server's setting, read strictly: unlike loadGuildSettings, a database
 * that is away or fails throws, so a server that switched it off never gets
 * a message because its "off" could not be read. Without MongoDB at all
 * (local development) it is the default.
 */
export async function loadRadioAnnounceSettings(guildId, {
  getDatabase = () => (isConnected() ? getDb() : null),
  mongoRequested = isMongoRequested,
} = {}) {
  const db = getDatabase();
  if (!db) {
    if (mongoRequested()) throw new Error("MongoDB ist nicht verbunden.");
    return normalizeRadioAnnounceSettings(undefined);
  }
  const doc = await db.collection("guild_settings").findOne(
    { guildId: String(guildId || "") },
    { projection: { [RADIO_ANNOUNCE_SETTINGS_KEY]: 1 } },
  );
  return normalizeRadioAnnounceSettings(doc?.[RADIO_ANNOUNCE_SETTINGS_KEY]);
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
