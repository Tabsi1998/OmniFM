import { log } from "../lib/logging.js";
import { clipText } from "../lib/helpers.js";
import { resolveLanguageFromDiscordLocale } from "../lib/language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  EVENT_TIME_ZONE_SUGGESTIONS,
  formatDateTime,
} from "../lib/event-time.js";
import { loadStations, filterStationsByTier } from "../stations-store.js";
import { getGuildStations } from "../custom-stations.js";
import { getTier, requireFeature } from "../core/entitlements.js";
import { recordCommandUsage } from "../listening-stats-store.js";
import { listScheduledEvents } from "../scheduled-events-store.js";
import { getDefaultLanguage } from "../i18n.js";
import {
  deferRuntimeReply,
  buildNoticePayload,
} from "./commands/command-helpers.js";
import { INFO_COMMANDS } from "./commands/info-commands.js";
import { PLAYBACK_COMMANDS } from "./commands/playback-commands.js";
import { SERVER_COMMANDS } from "./commands/server-commands.js";

export async function handleRuntimeAutocomplete(runtime, interaction) {
  try {
    if (interaction.guildId) {
      const access = runtime.getGuildAccess(interaction.guildId);
      if (!access.allowed) {
        await interaction.respond([]);
        return;
      }
    }

    const commandPermission = runtime.checkCommandRolePermission(interaction, interaction.commandName);
    if (!commandPermission.ok) {
      await interaction.respond([]);
      return;
    }
    if (interaction.commandName === "event") {
      const feature = requireFeature(interaction.guildId, "scheduledEvents");
      if (!feature.ok) {
        await interaction.respond([]);
        return;
      }
    }

    const focused = interaction.options.getFocused(true);

    if (focused.name === "station") {
      const stations = loadStations();
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      const query = String(focused.value || "").toLowerCase().trim();

      // Standard-Stationen nach Tier gefiltert
      const available = filterStationsByTier(stations.stations, guildTier);
      const allStations = Object.entries(available)
        .map(([key, value]) => {
          const badge = value.tier && value.tier !== "free" ? ` [${value.tier.toUpperCase()}]` : "";
          return { key, name: value.name, display: `${value.name}${badge}` };
        });

      // Custom Stationen (Ultimate)
      if (guildTier === "ultimate") {
        const custom = getGuildStations(guildId);
        for (const [key, station] of Object.entries(custom)) {
          allStations.push({ key, name: station.name, display: `${station.name} [CUSTOM]` });
        }
      }

      const items = (query
        ? allStations.filter((item) =>
            item.key.toLowerCase().includes(query) ||
            item.name.toLowerCase().includes(query)
          )
        : allStations
      )
        .slice(0, 25)
        .map((item) => ({ name: clipText(`${item.display} (${item.key})`, 100), value: item.key }));

      await interaction.respond(items);
      return;
    }

    // Autocomplete fuer /removestation key
    if (focused.name === "key" && interaction.commandName === "removestation") {
      const guildId = interaction.guildId;
      const custom = getGuildStations(guildId);
      const query = String(focused.value || "").toLowerCase().trim();
      const items = Object.entries(custom)
        .filter(([k, v]) => !query || k.includes(query) || v.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map(([k, v]) => ({ name: `${v.name} (${k})`, value: k }));
      await interaction.respond(items);
      return;
    }

    if (focused.name === "timezone" && interaction.commandName === "event") {
      const query = String(focused.value || "").trim().toLowerCase();
      const dedup = new Map();
      for (const entry of EVENT_TIME_ZONE_SUGGESTIONS) {
        if (!entry?.value) continue;
        dedup.set(entry.value, entry.label || entry.value);
      }
      dedup.set(EVENT_FALLBACK_TIME_ZONE, EVENT_FALLBACK_TIME_ZONE);

      const items = [...dedup.entries()]
        .filter(([value, label]) => {
          if (!query) return true;
          return value.toLowerCase().includes(query) || String(label || "").toLowerCase().includes(query);
        })
        .slice(0, 25)
        .map(([value, label]) => ({
          name: clipText(String(label || value), 100),
          value,
        }));

      await interaction.respond(items);
      return;
    }

    if (focused.name === "id" && interaction.commandName === "event") {
      const guildId = interaction.guildId;
      const query = String(focused.value || "").toLowerCase().trim();
      const events = listScheduledEvents({
        guildId,
        botId: runtime.config.id,
        includeDisabled: true,
      });
      const language = runtime.resolveInteractionLanguage(interaction);

      const items = events
        .filter((event) =>
          !query
          || event.id.includes(query)
          || String(event.name || "").toLowerCase().includes(query)
          || String(event.stationKey || "").toLowerCase().includes(query)
        )
        .slice(0, 25)
        .map((event) => ({
          name: clipText(`${event.name} | ${formatDateTime(event.runAtMs, language, event.timeZone)} | ${event.id}`, 100),
          value: event.id,
        }));

      await interaction.respond(items);
      return;
    }

    // Unknown option
    await interaction.respond([]);
  } catch (err) {
    log("ERROR", `[${runtime.config.name}] Autocomplete error: ${err?.message || err}`);
    try {
      await interaction.respond([]);
    } catch {
      // interaction might have already been responded to
    }
  }
}

// Which handler answers which command, in the three phases of the original
// if-chain (#210): before the /perm role check, after it, and with the
// station catalog and the guild state loaded.
const PRE_PERMISSION_COMMANDS = {
  // The person's own list (#272): no role rule and no plan in the way.
  saved: ({ runtime, interaction }) => runtime.handleSavedSongsCommand(interaction),
  help: INFO_COMMANDS.help,
  setup: INFO_COMMANDS.setup,
  language: INFO_COMMANDS.language,
  perm: SERVER_COMMANDS.perm,
};

const GENERAL_COMMANDS = {
  event: SERVER_COMMANDS.event,
  stats: INFO_COMMANDS.stats,
  invite: INFO_COMMANDS.invite,
  workers: PLAYBACK_COMMANDS.workers,
};

const STATION_COMMANDS = {
  stations: INFO_COMMANDS.stations,
  list: INFO_COMMANDS.list,
  now: INFO_COMMANDS.now,
  history: INFO_COMMANDS.history,
  pause: PLAYBACK_COMMANDS.pause,
  resume: PLAYBACK_COMMANDS.resume,
  stop: PLAYBACK_COMMANDS.stop,
  setvolume: PLAYBACK_COMMANDS.setvolume,
  sleep: PLAYBACK_COMMANDS.sleep,
  premium: INFO_COMMANDS.premium,
  health: INFO_COMMANDS.health,
  diag: PLAYBACK_COMMANDS.diag,
  status: PLAYBACK_COMMANDS.status,
  addstation: SERVER_COMMANDS.addstation,
  removestation: SERVER_COMMANDS.removestation,
  mystations: SERVER_COMMANDS.mystations,
  license: SERVER_COMMANDS.license,
  voiceguard: SERVER_COMMANDS.voiceguard,
  play: PLAYBACK_COMMANDS.play,
};

function commandHandler(map, commandName) {
  // Own entries only: a name like "constructor" must not reach Object.prototype.
  return Object.hasOwn(map, commandName) ? map[commandName] : null;
}

export async function handleRuntimeInteraction(runtime, interaction) {
  if (interaction.isAutocomplete()) {
    await runtime.handleAutocomplete(interaction);
    return;
  }

  if (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isModalSubmit?.()) {
    const handled = await runtime.handleComponentInteraction(interaction);
    if (handled) return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guildId) {
    const isDe = resolveLanguageFromDiscordLocale(interaction?.locale, getDefaultLanguage()) === "de";
    await interaction.reply(buildNoticePayload({
      t: (de, en) => (isDe ? de : en),
      language: isDe ? "de" : "en",
      tone: "warning",
      title: isDe ? "🏠 Nur auf Servern verfügbar" : "🏠 Available in servers only",
      description: isDe ? "Dieser Bot funktioniert nur auf Servern." : "This bot only works in servers.",
      supportActions: { includeDashboard: false, includePremium: false, includeSupport: true },
    }));
    return;
  }

  const { t, language } = runtime.createInteractionTranslator(interaction);
  const unrestrictedCommands = new Set(["help", "setup", "premium", "license", "language", "saved"]);
  if (!unrestrictedCommands.has(interaction.commandName)) {
    const access = runtime.getGuildAccess(interaction.guildId);
    if (!access.allowed) {
      await runtime.replyAccessDenied(interaction, access);
      return;
    }
  }

  const context = { runtime, interaction, t, language };
  // Before the /perm role check: help and setup must always work, /perm checks itself.
  const preCheckHandler = commandHandler(PRE_PERMISSION_COMMANDS, interaction.commandName);
  if (preCheckHandler) {
    await preCheckHandler(context);
    return;
  }

  const commandPermission = runtime.checkCommandRolePermission(interaction, interaction.commandName);
  if (!commandPermission.ok) {
    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "warning",
      title: t("🔒 Befehl nicht erlaubt", "🔒 Command not allowed"),
      description: commandPermission.message,
      supportActions: { includeDashboard: true, includePremium: false, includeSupport: true },
    }));
    return;
  }

  recordCommandUsage(interaction.guildId, interaction.commandName);

  if (["play", "pause", "resume", "stop", "setvolume"].includes(interaction.commandName)) {
    await deferRuntimeReply(interaction);
  }

  if (runtime.role === "commander" && runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }

  const generalHandler = commandHandler(GENERAL_COMMANDS, interaction.commandName);
  if (generalHandler) {
    await generalHandler(context);
    return;
  }

  const stations = loadStations();
  const state = runtime.getState(interaction.guildId);
  const stationHandler = commandHandler(STATION_COMMANDS, interaction.commandName);
  if (stationHandler) {
    await stationHandler({ ...context, stations, state });
  }
}
