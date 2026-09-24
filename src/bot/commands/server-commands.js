// Server administration commands: /perm, /event, /addstation, /removestation,
// /mystations, /license, /voiceguard.
// Moved out of runtime-interactions.js unchanged (#210); runtime-interactions.js
// dispatches to the map at the end of this file.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { clipText } from "../../lib/helpers.js";
import { translateCustomStationErrorMessage } from "../../lib/language.js";
import {
  getGuildStations,
  addGuildStation,
  removeGuildStation,
  countGuildStations,
  MAX_STATIONS_PER_GUILD,
} from "../../custom-stations.js";
import { getTier, serverHasCapability } from "../../core/entitlements.js";
import { recordCommandUsage } from "../../listening-stats-store.js";
import { customStationEmbed } from "../../ui/upgradeEmbeds.js";
import { updateGuildSettings } from "../../lib/guild-settings.js";
import {
  buildResolvedVoiceGuardConfig,
  formatVoiceGuardDurationMs,
  validateVoiceGuardSettings,
} from "../../lib/voice-guard.js";
import {
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  getServerLicense,
} from "../../premium-store.js";
import { PLANS } from "../../config/plans.js";
import { PLAY_COMPONENT_ID_OPEN, STATIONS_COMPONENT_ID_OPEN } from "../runtime-links.js";
import { buildOmniEmbed } from "../discord-ui.js";
import {
  buildQuickActionRow,
  buildSupportRow,
  buildStreamingRuntimeSelectionPayload,
  formatVoiceGuardPolicyLabel,
} from "./command-helpers.js";

/** /perm */
async function handlePermCommand({ runtime, interaction }) {
  recordCommandUsage(interaction.guildId, interaction.commandName);
  await runtime.handlePermissionCommand(interaction);
  return;
}

/** /event */
async function handleEventCommand({ runtime, interaction }) {
  await runtime.handleEventCommand(interaction);
  return;
}

/** /addstation */
async function handleAddstationCommand({ interaction, t, language }) {
  const guildId = interaction.guildId;
  const guildTier = getTier(guildId);
  if (guildTier !== "ultimate") {
    await interaction.reply(customStationEmbed(language));
    return;
  }
  const key = interaction.options.getString("key");
  const name = interaction.options.getString("name");
  const url = interaction.options.getString("url");
  const result = await addGuildStation(guildId, key, name, url);
  if (result.error) {
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("⚠ Custom-Station konnte nicht gespeichert werden", "⚠ Could not save custom station"),
          description: translateCustomStationErrorMessage(result.error, language),
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
  } else {
    const count = countGuildStations(guildId);
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "success",
          title: t("✅ Custom-Station gespeichert", "✅ Custom station saved"),
          description: t(
            `**${result.station.name}** ist jetzt als \`${result.key}\` verfügbar.`,
            `**${result.station.name}** is now available as \`${result.key}\`.`
          ),
          fields: [
            {
              name: t("Nutzung", "Usage"),
              value: t(`${count}/${MAX_STATIONS_PER_GUILD} Slots belegt`, `${count}/${MAX_STATIONS_PER_GUILD} slots used`),
              inline: true,
            },
            {
              name: t("Nächster Schritt", "Next step"),
              value: t("Öffne `/play` oder `/stations`, um den Sender direkt zu starten.", "Open `/play` or `/stations` to start the station right away."),
              inline: true,
            },
          ],
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(PLAY_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Primary)
            .setLabel(t("🎛 Schnellstart", "🎛 Quick start")),
          new ButtonBuilder()
            .setCustomId(STATIONS_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t("📻 Sender", "📻 Stations"))
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
  return;
}

/** /removestation */
async function handleRemovestationCommand({ interaction, t, language }) {
  const guildId = interaction.guildId;
  const guildTier = getTier(guildId);
  if (guildTier !== "ultimate") {
    await interaction.reply(customStationEmbed(language));
    return;
  }
  const key = interaction.options.getString("key");
  if (removeGuildStation(guildId, key)) {
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🧹 Custom-Station entfernt", "🧹 Custom station removed"),
          description: t(`Station \`${key}\` entfernt.`, `Station \`${key}\` removed.`),
        }),
      ],
      components: [
        buildQuickActionRow(t, { includePlay: true, includeStations: true }),
        buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
      ].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🔎 Custom-Station nicht gefunden", "🔎 Custom station not found"),
          description: t(`Station \`${key}\` nicht gefunden.`, `Station \`${key}\` was not found.`),
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
  }
  return;
}

/** /mystations */
async function handleMystationsCommand({ interaction, t, language }) {
  const guildId = interaction.guildId;
  const guildTier = getTier(guildId);
  if (guildTier !== "ultimate") {
    await interaction.reply(customStationEmbed(language));
    return;
  }
  const custom = getGuildStations(guildId);
  const keys = Object.keys(custom);
  if (keys.length === 0) {
    const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true });
    const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true });
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "info",
          title: t("📂 Eigene Sender", "📂 Custom stations"),
          description: t(
            "Du hast noch keine eigenen Sender gespeichert. Lege zuerst mit `/addstation` einen privaten Stream an.",
            "You do not have any custom stations yet. Create a private stream first with `/addstation`."
          ),
          fields: [
            {
              name: t("Nächster Schritt", "Next step"),
              value: t("Danach kannst du den Sender direkt über `/play` oder `/stations` starten.", "After that, you can start it directly via `/play` or `/stations`."),
              inline: false,
            },
          ],
        }),
      ],
      components: [quickRow, supportRow].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
  } else {
    const list = keys.map((k) => {
      const station = custom[k] || {};
      const meta = [];
      if (station.folder) meta.push(`[${station.folder}]`);
      if (Array.isArray(station.tags) && station.tags.length > 0) {
        meta.push(station.tags.map((tag) => `#${tag}`).join(", "));
      }
      const suffix = meta.length > 0 ? ` - ${meta.join(" ")}` : "";
      return `• **${station.name}**\n\`${k}\`${suffix}`;
    }).join("\n\n");
    const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true });
    const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true });
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "admin",
          title: t("📂 Eigene Sender", "📂 Custom stations"),
          description: t(
            `${keys.length}/${MAX_STATIONS_PER_GUILD} Slots belegt. Deine privaten Streams sind direkt in OmniFM verfügbar.`,
            `${keys.length}/${MAX_STATIONS_PER_GUILD} slots used. Your private streams are directly available in OmniFM.`
          ),
          fields: [
            {
              name: t("Sender", "Stations"),
              value: clipText(list, 3500),
              inline: false,
            },
          ],
        }),
      ],
      components: [quickRow, supportRow].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
  }
  return;
}

// === /license Command ===
/** /license */
async function handleLicenseCommand({ runtime, interaction, t, language }) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const requiresManagePermission = sub === "activate" || sub === "remove";
  if (requiresManagePermission && !runtime.hasGuildManagePermissions(interaction)) {
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🛠 Lizenz-Rechte fehlen", "🛠 License permission missing"),
          description: t(
            "Du brauchst die Berechtigung `Server verwalten`, um Lizenz-Aktionen auszufuehren.",
            "You need the `Manage Server` permission to execute license actions."
          ),
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (sub === "activate") {
    const rawKey = interaction.options.getString("key").trim();
    const keyCandidates = [...new Set([rawKey, rawKey.toLowerCase(), rawKey.toUpperCase()])];
    let lic = null;
    let resolvedKey = null;
    for (const candidate of keyCandidates) {
      lic = getLicenseById(candidate);
      if (lic) {
        resolvedKey = lic.id || candidate;
        break;
      }
    }

    if (!lic) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "danger",
            title: t("✖ Lizenz-Key nicht gefunden", "✖ License key not found"),
            description: t(
              "Bitte prüfe den Key und versuche es erneut oder verwalte die Lizenz direkt im Dashboard.",
              "Please verify the key and try again, or manage the license directly in the dashboard."
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (lic.expired) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("⚠ Lizenz abgelaufen", "⚠ License expired"),
            description: t("Diese Lizenz ist abgelaufen. Bitte erneuere dein Abo.", "This license has expired. Please renew your subscription."),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = linkServerToLicense(guildId, resolvedKey);
    if (!result.ok) {
      const msg = result.message.includes("already linked")
        ? t("Dieser Server ist bereits mit dieser Lizenz verknuepft.", "This server is already linked to this license.")
        : result.message.includes("seat")
          ? t(
            `Alle ${lic.seats} Server-Slots sind belegt. Entferne zuerst einen Server mit \`/license remove\` oder upgrade auf mehr Seats.`,
            `All ${lic.seats} server seats are used. Remove a server with \`/license remove\` or upgrade to more seats first.`
          )
          : result.message;
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("⚠ Lizenz konnte nicht aktiviert werden", "⚠ License could not be activated"),
            description: msg,
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const refreshedLicense = getLicenseById(resolvedKey) || lic;
    const planName = PLANS[refreshedLicense.plan]?.name || refreshedLicense.plan;
    const expDate = refreshedLicense.expiresAt
      ? new Date(refreshedLicense.expiresAt).toLocaleDateString(t("de-DE", "en-US"))
      : t("Unbegrenzt", "Unlimited");
    const usedSeats = refreshedLicense.linkedServerIds?.length || 0;
    const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true, includeWorkers: true, includeInvite: true });
    const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true });
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: refreshedLicense.plan === "ultimate" ? "admin" : "live",
          title: t("✅ Lizenz aktiviert", "✅ License activated"),
          description: t(
            `Dieser Server wurde erfolgreich mit deiner **${planName}**-Lizenz verknüpft.`,
            `This server was linked successfully with your **${planName}** license.`
          ),
          fields: [
            { name: t("Lizenz-Key", "License key"), value: `\`${resolvedKey}\``, inline: true },
            { name: t("Plan", "Plan"), value: planName, inline: true },
            { name: t("Server-Slots", "Server seats"), value: `${usedSeats}/${refreshedLicense.seats}`, inline: true },
            { name: t("Gültig bis", "Valid until"), value: expDate, inline: true },
          ],
        }),
      ],
      components: [quickRow, supportRow].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "info") {
    const lic = getServerLicense(guildId);
    if (!lic) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("🔓 Keine aktive Lizenz", "🔓 No active license"),
            description: t(
              "Dieser Server hat aktuell keine aktive Lizenz. Du kannst einen Key aktivieren oder direkt upgraden.",
              "This server currently has no active license. You can activate a key or upgrade directly."
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const planName = PLANS[lic.plan]?.name || lic.plan;
    const expDate = lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString(t("de-DE", "en-US")) : t("Unbegrenzt", "Unlimited");
    const linked = lic.linkedServerIds || [];
    const tierConfig = PLANS[lic.plan] || PLANS.free;
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: lic.plan === "ultimate" ? "admin" : "live",
          title: `💎 OmniFM ${planName}`,
          description: t("Lizenz- und Planübersicht für diesen Server.", "License and plan overview for this server."),
          fields: [
            { name: t("Lizenz-Key", "License key"), value: `\`${lic.id || "-"}\``, inline: true },
            { name: t("Plan", "Plan"), value: planName, inline: true },
            { name: t("Server-Slots", "Server seats"), value: `${linked.length}/${lic.seats}`, inline: true },
            { name: t("Gültig bis", "Valid until"), value: expDate, inline: true },
            { name: t("Verbleibend", "Remaining"), value: t(`${lic.remainingDays} Tage`, `${lic.remainingDays} days`), inline: true },
            { name: t("Audio", "Audio"), value: tierConfig.bitrate, inline: true },
            { name: t("Max Bots", "Max bots"), value: `${tierConfig.maxBots}`, inline: true },
            { name: t("Reconnect", "Reconnect"), value: `${tierConfig.reconnectMs}ms`, inline: true },
          ],
          footer: lic.expired ? t("ABGELAUFEN", "EXPIRED") : "OmniFM Premium",
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "remove") {
    const lic = getServerLicense(guildId);
    if (!lic || !lic.id) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("🔓 Keine aktive Lizenz", "🔓 No active license"),
            description: t("Dieser Server hat keine aktive Lizenz.", "This server has no active license."),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = unlinkServerFromLicense(guildId, lic.id);
    if (!result.ok) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "danger",
            title: t("✖ Lizenz konnte nicht entfernt werden", "✖ License could not be removed"),
            description: t("Fehler beim Entfernen: ", "Error while removing: ") + result.message,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🧹 Lizenz entfernt", "🧹 License removed"),
          description: t(
            "Server wurde von der Lizenz entfernt. Der Server-Slot ist jetzt frei und kann für einen anderen Server genutzt werden.",
            "The server was unlinked from the license. The seat is now free and can be used for another server."
          ),
          fields: [
            {
              name: t("Nächster Schritt", "Next step"),
              value: t("Nutze `/license activate`, um einen neuen Key zu verbinden, oder upgrade direkt über das Dashboard.", "Use `/license activate` to link a new key, or upgrade directly in the dashboard."),
              inline: false,
            },
          ],
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

/** /voiceguard */
async function handleVoiceguardCommand({ runtime, interaction, t, language }) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (!serverHasCapability(guildId, "voice_guard")) {
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "info",
          title: t("🛡 Voice Guard gesperrt", "🛡 Voice guard locked"),
          description: t(
            "Voice Guard ist auf diesem Server aktuell nicht verfuegbar.",
            "Voice guard is not currently available on this server."
          ),
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!runtime.hasGuildManagePermissions(interaction)) {
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🛠 Voice-Guard-Rechte fehlen", "🛠 Voice guard permission missing"),
          description: t(
            "Du brauchst die Berechtigung `Server verwalten`, um den Voice-Guard zu aendern.",
            "You need the `Manage Server` permission to manage the voice guard."
          ),
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "policy") {
    const rawValue = interaction.options.getString("value", true);
    const validated = validateVoiceGuardSettings({ policy: rawValue });
    if (!validated.ok) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("⚠ Voice-Guard-Policy ungültig", "⚠ Invalid voice guard policy"),
            description: t(validated.error, validated.error),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const persisted = await updateGuildSettings(guildId, { voiceGuard: validated.config });
    if (!persisted.ok) {
      await interaction.editReply({
        embeds: [
          buildOmniEmbed({
            tone: "danger",
            title: t("✖ Voice Guard konnte nicht gespeichert werden", "✖ Could not save voice guard"),
            description: t(
              "Voice-Guard-Policy konnte nicht gespeichert werden. Bitte versuche es spaeter erneut oder nutze das Dashboard.",
              "The voice guard policy could not be saved. Please try again later or use the dashboard."
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await runtime.refreshVoiceGuardSettingsForGuild(guildId, { force: true }).catch(() => null);
    const resolved = buildResolvedVoiceGuardConfig(validated.config);
    await interaction.editReply({
      embeds: [
        buildOmniEmbed({
          tone: resolved.effectivePolicy === "disconnect" ? "warning" : "success",
          title: t("🛡 Voice Guard aktualisiert", "🛡 Voice guard updated"),
          description: t(
            `Gespeichert: **${formatVoiceGuardPolicyLabel(resolved.policy, t)}** | Aktiv: **${formatVoiceGuardPolicyLabel(resolved.effectivePolicy, t)}**`,
            `Saved: **${formatVoiceGuardPolicyLabel(resolved.policy, t)}** | Active: **${formatVoiceGuardPolicyLabel(resolved.effectivePolicy, t)}**`
          ),
        }),
      ],
      components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "status") {
    await runtime.refreshVoiceGuardSettings(guildId).catch(() => null);
    const configured = runtime.getVoiceGuardRuntimeSummary(guildId);
    const resolvedRuntime = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    const { runtime: activeRuntime, state: activeState } = resolvedRuntime;
    if (!activeRuntime && resolvedRuntime.reason && resolvedRuntime.reason !== "none") {
      await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, resolvedRuntime, language));
      return;
    }
    const liveSummary = activeRuntime && activeState
      ? activeRuntime.getVoiceGuardRuntimeSummary(guildId)
      : configured;
    const unlockLabel = liveSummary.unlockUntil
      ? new Date(Number(liveSummary.unlockUntil)).toLocaleString(language === "de" ? "de-DE" : "en-US")
      : "-";
    const cooldownLabel = liveSummary.cooldownUntil
      ? new Date(Number(liveSummary.cooldownUntil)).toLocaleString(language === "de" ? "de-DE" : "en-US")
      : "-";
    const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true });
    const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true });
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: liveSummary.unlocked ? "warning" : liveSummary.effectivePolicy === "disconnect" ? "danger" : liveSummary.effectivePolicy === "return" ? "success" : "neutral",
          title: t("🛡 Voice Guard", "🛡 Voice guard"),
          fields: [
            {
              name: t("Policy", "Policy"),
              value: `${formatVoiceGuardPolicyLabel(liveSummary.policy, t)} -> ${formatVoiceGuardPolicyLabel(liveSummary.effectivePolicy, t)}`,
              inline: true,
            },
            {
              name: t("Unlock", "Unlock"),
              value: liveSummary.unlocked
                ? t(`aktiv bis ${unlockLabel}`, `active until ${unlockLabel}`)
                : t("nicht aktiv", "inactive"),
              inline: true,
            },
            {
              name: t("Cooldown", "Cooldown"),
              value: liveSummary.cooldownUntil ? cooldownLabel : "-",
              inline: true,
            },
            {
              name: t("Bewegungen", "Moves"),
              value: t(
                `Gesamt: ${liveSummary.moveCount} | Fenster: ${liveSummary.moveWindowCount}/${liveSummary.maxMovesPerWindow}`,
                `Total: ${liveSummary.moveCount} | Window: ${liveSummary.moveWindowCount}/${liveSummary.maxMovesPerWindow}`
              ),
              inline: false,
            },
            {
              name: t("Aktionen", "Actions"),
              value: t(
                `Returns: ${liveSummary.returnCount} | Disconnects: ${liveSummary.disconnectCount} | Eskalationen: ${liveSummary.escalationCount}`,
                `Returns: ${liveSummary.returnCount} | Disconnects: ${liveSummary.disconnectCount} | Escalations: ${liveSummary.escalationCount}`
              ),
              inline: false,
            },
            {
              name: t("Letzte Aktion", "Last action"),
              value: liveSummary.lastAction
                ? `${liveSummary.lastAction}${liveSummary.lastActionReason ? ` | ${liveSummary.lastActionReason}` : ""}`
                : "-",
              inline: false,
            },
            {
              name: t("Guard-Regeln", "Guard rules"),
              value: t(
                `Confirm: ${liveSummary.moveConfirmations} | Return-Cooldown: ${formatVoiceGuardDurationMs(liveSummary.returnCooldownMs)} | Fenster: ${formatVoiceGuardDurationMs(liveSummary.moveWindowMs)} | Eskalation: ${liveSummary.escalation}`,
                `Confirm: ${liveSummary.moveConfirmations} | Return cooldown: ${formatVoiceGuardDurationMs(liveSummary.returnCooldownMs)} | Window: ${formatVoiceGuardDurationMs(liveSummary.moveWindowMs)} | Escalation: ${liveSummary.escalation}`
              ),
              inline: false,
            },
          ],
          footer: activeRuntime
            ? t(`Live-Runtime: ${activeRuntime.config.name}`, `Live runtime: ${activeRuntime.config.name}`)
            : t("Keine aktive Stream-Runtime erkannt", "No active stream runtime detected"),
        }),
      ],
      components: [quickRow, supportRow].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "unlock") {
    const resolved = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!resolved.runtime || !resolved.state) {
      if (resolved.reason && resolved.reason !== "none") {
        await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, resolved, language));
        return;
      }
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("ℹ Voice Guard wartet auf einen aktiven Stream", "ℹ Voice guard needs an active stream"),
            description: runtime.buildRuntimeSelectionHint(resolved.reason, language),
          }),
        ],
        components: [
          buildQuickActionRow(t, { includePlay: true, includeStations: true }),
          buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
        ].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const minutes = Math.max(1, Math.min(180, Number(interaction.options.getInteger("minutes") || 10) || 10));
    const result = await resolved.runtime.setVoiceGuardTemporaryUnlock(guildId, minutes * 60_000, "slash-unlock");
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🔓 Voice Guard entsperrt", "🔓 Voice guard unlocked"),
          description: t(
            `Voice Guard ist jetzt für ${result.label} entsperrt. Du kannst den Bot in dieser Zeit bewusst verschieben.`,
            `Voice guard is unlocked for ${result.label}. You can intentionally move the bot during that time.`
          ),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "lock") {
    const resolved = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!resolved.runtime || !resolved.state) {
      await runtime.clearVoiceGuardTemporaryUnlockForGuild(guildId, "slash-lock");
      if (resolved.reason && resolved.reason !== "none") {
        await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, resolved, language));
        return;
      }
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("🛡 Voice Guard zurückgesetzt", "🛡 Voice guard reset"),
            description: t(
              "Keine aktive Stream-Runtime gefunden. Temporaere Unlocks wurden fuer diesen Server zurueckgesetzt, falls vorhanden.",
              "No active stream runtime found. Temporary unlocks were reset for this server where present."
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await resolved.runtime.clearVoiceGuardTemporaryUnlockForGuild(guildId, "slash-lock");
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "success",
          title: t("🔒 Voice Guard aktiv", "🔒 Voice guard active"),
          description: t(
            "Voice Guard ist wieder sofort aktiv.",
            "Voice guard is active again immediately."
          ),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

export const SERVER_COMMANDS = {
  perm: handlePermCommand,
  event: handleEventCommand,
  addstation: handleAddstationCommand,
  removestation: handleRemovestationCommand,
  mystations: handleMystationsCommand,
  license: handleLicenseCommand,
  voiceguard: handleVoiceguardCommand,
};
