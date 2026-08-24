import { ChannelType, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { brandAuthor, brandFooter } from "../bot/brand-embed.js";
import { getDb, isConnected } from "./db.js";
import {
  normalizeDashboardIncidentAlertsConfig,
  shouldDeliverDashboardIncidentAlert,
} from "./dashboard-incident-alerts.js";
import { log } from "./logging.js";
import { serverHasCapability } from "../core/entitlements.js";

const CUSTOMER_VISIBLE_RUNTIME_INCIDENT_EVENT_KEYS = new Set([
  "stream_healthcheck_stalled",
  "stream_failover_activated",
  "stream_failover_exhausted",
]);

function clipText(value, maxLen = 240) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

async function loadRuntimeIncidentAlertsConfig(guildId) {
  if (!isConnected() || !getDb()) return null;

  try {
    const settings = await getDb().collection("guild_settings").findOne(
      { guildId: String(guildId || "").trim() },
      { projection: { incidentAlerts: 1 } }
    );
    return normalizeDashboardIncidentAlertsConfig(settings?.incidentAlerts || {});
  } catch {
    return null;
  }
}

async function resolveRuntimeAlertGuild(runtime, guildId) {
  const normalizedGuildId = String(guildId || "").trim();
  if (!normalizedGuildId) return null;
  const cachedGuild = runtime?.client?.guilds?.cache?.get?.(normalizedGuildId) || null;
  if (cachedGuild) return cachedGuild;
  if (typeof runtime?.client?.guilds?.fetch !== "function") return null;
  try {
    return await runtime.client.guilds.fetch(normalizedGuildId);
  } catch {
    return null;
  }
}

async function resolveRuntimeAlertBotMember(runtime, guild) {
  if (!guild) return null;
  if (typeof runtime?.resolveBotMember === "function") {
    try {
      return await runtime.resolveBotMember(guild);
    } catch {
      return null;
    }
  }
  return guild?.members?.me || null;
}

async function resolveRuntimeAlertChannel(runtime, guild, channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  if (!guild || !normalizedChannelId) return null;
  if (typeof runtime?.fetchGuildChannelById === "function") {
    return runtime.fetchGuildChannelById(guild, normalizedChannelId);
  }
  const cachedChannel = guild.channels?.cache?.get?.(normalizedChannelId) || null;
  if (cachedChannel) return cachedChannel;
  if (typeof guild.channels?.fetch !== "function") return null;
  try {
    return await guild.channels.fetch(normalizedChannelId);
  } catch {
    return null;
  }
}

function canSendRuntimeIncidentAlert(channel, me) {
  if (!channel || typeof channel.send !== "function") return false;
  if (channel.isThread?.() && channel.archived) return false;

  const isSupportedChannel = channel.isThread?.()
    || channel.type === ChannelType.GuildText
    || channel.type === ChannelType.GuildAnnouncement;
  if (!isSupportedChannel) return false;

  if (!me || typeof channel.permissionsFor !== "function") return true;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
}

function buildRuntimeIncidentAlertCopy(eventKey, payload, t) {
  const previousStation = payload?.previousStationName || payload?.previousStationKey || t("dem letzten Stream", "the previous stream");
  const failoverStation = payload?.failoverStationName || payload?.failoverStationKey || t("der Failover-Station", "the failover station");
  switch (String(eventKey || "").trim().toLowerCase()) {
    case "stream_failover_activated":
      return {
        title: t("Failover aktiviert", "Failover activated"),
        color: 0xF59E0B,
        description: t(
          `OmniFM ist von ${previousStation} auf ${failoverStation} gewechselt.`,
          `OmniFM switched from ${previousStation} to ${failoverStation}.`
        ),
      };
    case "stream_healthcheck_stalled":
      return {
        title: t("Stream stockt", "Stream stalled"),
        color: 0xF59E0B,
        description: t(
          `OmniFM erkennt gerade keine stabile Wiedergabe mehr bei ${previousStation}.`,
          `OmniFM is no longer seeing stable playback on ${previousStation}.`
        ),
      };
    case "stream_failover_exhausted":
      return {
        title: t("Failover ausgeschoepft", "Failover exhausted"),
        color: 0xEF4444,
        description: t(
          `OmniFM konnte ${previousStation} nicht stabilisieren und hat alle konfigurierten Failover-Schritte verbraucht.`,
          `OmniFM could not stabilize ${previousStation} and exhausted every configured failover step.`
        ),
      };
    default:
      return {
        title: t("Reliability-Vorfall", "Reliability incident"),
        color: 0x71717A,
        description: t(
          "OmniFM hat einen neuen Runtime-Vorfall erkannt.",
          "OmniFM detected a new runtime incident."
        ),
      };
  }
}

function buildRuntimeIncidentAlertMessage(input) {
  const language = String(input?.language || "de").trim().toLowerCase() === "en" ? "en" : "de";
  const t = (de, en) => (language === "en" ? en : de);
  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};
  const copy = buildRuntimeIncidentAlertCopy(input?.eventKey, payload, t);
  const runtimeMeta = payload?.runtime && typeof payload.runtime === "object" ? payload.runtime : {};
  const runtimeLabel = clipText(runtimeMeta.name || input?.runtimeName || "", 120);

  const fields = [];
  if (runtimeLabel) {
    fields.push({
      name: t("Runtime", "Runtime"),
      value: runtimeLabel,
      inline: true,
    });
  }
  if (payload.previousStationName || payload.previousStationKey) {
    fields.push({
      name: t("Vorheriger Stream", "Previous stream"),
      value: clipText(payload.previousStationName || payload.previousStationKey, 120) || "-",
      inline: true,
    });
  }
  if (payload.recoveredStationName || payload.recoveredStationKey) {
    fields.push({
      name: t("Wiederhergestellt", "Recovered"),
      value: clipText(payload.recoveredStationName || payload.recoveredStationKey, 120) || "-",
      inline: true,
    });
  }
  if (payload.failoverStationName || payload.failoverStationKey) {
    fields.push({
      name: t("Failover", "Failover"),
      value: clipText(payload.failoverStationName || payload.failoverStationKey, 120) || "-",
      inline: true,
    });
  }
  if (Number.isFinite(Number(payload.listenerCount)) && Number(payload.listenerCount) > 0) {
    fields.push({
      name: t("Listener", "Listeners"),
      value: String(Number(payload.listenerCount) || 0),
      inline: true,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(copy.color)
    .setAuthor(brandAuthor("OmniFM · Incident"))
    .setTitle(copy.title)
    .setDescription(copy.description)
    .setTimestamp(input?.timestamp ? new Date(input.timestamp) : new Date());

  if (fields.length > 0) {
    embed.addFields(fields.slice(0, 8));
  }

  const guildName = clipText(input?.guildName || input?.guildId || "", 120);
  if (guildName) {
    embed.setFooter(brandFooter(guildName));
  }

  return {
    content: "",
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}

export async function dispatchRuntimeIncidentAlert(input, deps = {}) {
  const guildId = String(input?.guildId || "").trim();
  const eventKey = String(input?.eventKey || "").trim().toLowerCase();
  if (!guildId || !eventKey) {
    return { attempted: false, delivered: false, skipped: "invalid" };
  }

  const hasCapability = typeof deps.hasCapability === "function"
    ? deps.hasCapability
    : (targetGuildId) => serverHasCapability(targetGuildId, "exports_webhooks");
  if (!hasCapability(guildId)) {
    return { attempted: false, delivered: false, skipped: "capability" };
  }
  if (!CUSTOMER_VISIBLE_RUNTIME_INCIDENT_EVENT_KEYS.has(eventKey)) {
    return { attempted: false, delivered: false, skipped: "event-policy" };
  }

  const resolvedConfig = input?.alertConfig && typeof input.alertConfig === "object"
    ? normalizeDashboardIncidentAlertsConfig(input.alertConfig)
    : await (typeof deps.loadConfig === "function"
      ? deps.loadConfig(guildId)
      : loadRuntimeIncidentAlertsConfig(guildId));
  if (!resolvedConfig) {
    return { attempted: false, delivered: false, skipped: "config" };
  }

  const shouldDeliver = typeof deps.shouldDeliver === "function"
    ? deps.shouldDeliver
    : shouldDeliverDashboardIncidentAlert;
  if (!shouldDeliver(resolvedConfig, eventKey)) {
    return { attempted: false, delivered: false, skipped: "disabled" };
  }

  const runtime = input?.runtime || null;
  const guild = await (typeof deps.resolveGuild === "function"
    ? deps.resolveGuild(runtime, guildId)
    : resolveRuntimeAlertGuild(runtime, guildId));
  if (!guild) {
    return { attempted: false, delivered: false, skipped: "guild" };
  }

  const me = await (typeof deps.resolveBotMember === "function"
    ? deps.resolveBotMember(runtime, guild)
    : resolveRuntimeAlertBotMember(runtime, guild));
  const channel = await (typeof deps.resolveChannel === "function"
    ? deps.resolveChannel(runtime, guild, resolvedConfig.channelId)
    : resolveRuntimeAlertChannel(runtime, guild, resolvedConfig.channelId));
  if (!channel) {
    return { attempted: false, delivered: false, skipped: "channel" };
  }

  const canSend = typeof deps.canSend === "function"
    ? deps.canSend(channel, me)
    : canSendRuntimeIncidentAlert(channel, me);
  if (!canSend) {
    return { attempted: false, delivered: false, skipped: "permissions" };
  }

  const buildMessage = typeof deps.buildMessage === "function"
    ? deps.buildMessage
    : buildRuntimeIncidentAlertMessage;
  const message = buildMessage({
    ...input,
    guildName: String(input?.guildName || guild?.name || guildId).trim(),
    language: typeof runtime?.resolveGuildLanguage === "function"
      ? runtime.resolveGuildLanguage(guildId)
      : "de",
  });

  const send = typeof deps.send === "function"
    ? deps.send
    : async (targetChannel, payload) => targetChannel.send(payload);

  try {
    const response = await send(channel, message);
    return {
      attempted: true,
      delivered: true,
      channelId: String(channel?.id || resolvedConfig.channelId || "").trim(),
      responseId: String(response?.id || "").trim() || null,
      payloadPreview: message,
    };
  } catch (err) {
    const logger = typeof deps.logger === "function" ? deps.logger : log;
    logger(
      "WARN",
      `[runtime-discord-alerts] Delivery failed guild=${guildId} event=${eventKey}: ${err?.message || err}`
    );
    return {
      attempted: true,
      delivered: false,
      channelId: String(channel?.id || resolvedConfig.channelId || "").trim(),
      error: err?.message || String(err),
      payloadPreview: message,
    };
  }
}
