// ============================================================
// OmniFM - Upgrade Embeds (Reusable Discord Embeds, DE/EN)
// ============================================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { BRAND, PLANS } from "../config/plans.js";
import { getDefaultLanguage, normalizeLanguage } from "../i18n.js";
import { brandFooter, brandAuthor } from "../bot/brand-embed.js";

function pick(language, de, en) {
  return normalizeLanguage(language, getDefaultLanguage()) === "de" ? de : en;
}

function upgradeButton(language = getDefaultLanguage(), label = null) {
  const url = BRAND.upgradeUrl || "https://omnifm.bot";
  const resolvedLabel = label || pick(language, "Upgrade", "Upgrade");
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(resolvedLabel)
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor(brandAuthor())
    .setTimestamp(new Date())
    .setFooter(brandFooter(BRAND.footer));
}

export function premiumStationEmbed(stationName, requiredPlan, language = getDefaultLanguage()) {
  const planConfig = PLANS[requiredPlan] || PLANS.pro;
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Premium-Station", "Premium station"))
        .setDescription(
          pick(
            language,
            `**${stationName || "Diese Station"}** ist ab ${BRAND.name} **${planConfig.name}** verfügbar.\n\n`
              + "Upgrade für:\n"
              + "> 100+ Premium-Stationen\n"
              + "> HQ-Audioqualität\n"
              + "> Priority Reconnect",
            `**${stationName || "This station"}** is available from ${BRAND.name} **${planConfig.name}**.\n\n`
              + "Upgrade for:\n"
              + "> 100+ premium stations\n"
              + "> HQ audio quality\n"
              + "> Priority reconnect"
          )
        )
        .setColor(BRAND.proColor),
    ],
    components: [upgradeButton(language, pick(language, `Upgrade auf ${planConfig.name}`, `Upgrade to ${planConfig.name}`))],
    ephemeral: true,
  };
}

export function hqAudioEmbed(currentPlan, language = getDefaultLanguage()) {
  return {
    embeds: [
      baseEmbed()
        .setTitle("HQ Audio")
        .setDescription(
          pick(
            language,
            `HQ Audio ist in diesen ${BRAND.name}-Plänen verfügbar:\n\n`
              + "> **Pro** - 128k Opus\n"
              + "> **Ultimate** - 320k Opus\n\n"
              + `Dein aktueller Plan: **${PLANS[currentPlan]?.name || "Free"}** (${PLANS[currentPlan]?.bitrate || "64k"})`,
            `HQ audio is available in these ${BRAND.name} plans:\n\n`
              + "> **Pro** - 128k Opus\n"
              + "> **Ultimate** - 320k Opus\n\n"
              + `Your current plan: **${PLANS[currentPlan]?.name || "Free"}** (${PLANS[currentPlan]?.bitrate || "64k"})`
          )
        )
        .setColor(BRAND.proColor),
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}

export function customStationEmbed(language = getDefaultLanguage()) {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Eigene Stationen", "Custom stations"))
        .setDescription(
          pick(
            language,
            `Eigene Stations-URLs sind ein **${BRAND.name} Ultimate**-Feature.\n\n`
              + "> Eigene Stream-URLs hinzufügen\n"
              + "> Bis zu 50 eigene Stationen pro Server\n"
              + "> Volle Kontrolle über deine Playlist",
            `Custom station URLs are a **${BRAND.name} Ultimate** feature.\n\n`
              + "> Add your own stream URLs\n"
              + "> Up to 50 custom stations per server\n"
              + "> Full control over your playlist"
          )
        )
        .setColor(BRAND.ultimateColor),
    ],
    components: [upgradeButton(language, pick(language, "Upgrade auf Ultimate", "Upgrade to Ultimate"))],
    ephemeral: true,
  };
}

export function botLimitEmbed(currentPlan, maxBots, requestedIndex, language = getDefaultLanguage()) {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Worker-Limit erreicht", "Worker limit reached"))
        .setDescription(
          pick(
            language,
            `Dein **${PLANS[currentPlan]?.name || "Free"}**-Plan erlaubt maximal **${maxBots}** Worker.\n`
              + `Du hast Worker #${requestedIndex} angefragt.\n\n`
              + "> **Pro** - bis zu 8 Worker\n"
              + "> **Ultimate** - bis zu 16 Worker",
            `Your **${PLANS[currentPlan]?.name || "Free"}** plan allows up to **${maxBots}** workers.\n`
              + `You requested worker #${requestedIndex}.\n\n`
              + "> **Pro** - up to 8 workers\n"
              + "> **Ultimate** - up to 16 workers"
          )
        )
        .setColor(BRAND.proColor),
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}

export function reconnectPriorityEmbed(currentPlan, language = getDefaultLanguage()) {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Reconnect-Priorität", "Reconnect priority"))
        .setDescription(
          pick(
            language,
            `Schnellere Reconnects mit ${BRAND.name}-Upgrades:\n\n`
              + "> **Pro** - Priority Reconnect (1,5s)\n"
              + "> **Ultimate** - Instant Reconnect (0,4s)\n\n"
              + `Dein aktueller Plan: **${PLANS[currentPlan]?.name || "Free"}** (5s)`,
            `Faster reconnects with ${BRAND.name} upgrades:\n\n`
              + "> **Pro** - Priority reconnect (1.5s)\n"
              + "> **Ultimate** - Instant reconnect (0.4s)\n\n"
              + `Your current plan: **${PLANS[currentPlan]?.name || "Free"}** (5s)`
          )
        )
        .setColor(BRAND.proColor),
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}

export function seatLimitEmbed(seats, language = getDefaultLanguage()) {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Seat-Limit erreicht", "Seat limit reached"))
        .setDescription(
          pick(
            language,
            `Diese Lizenz deckt **${seats}** Server ab und alle Plätze sind belegt.\n\n`
              + "> Trenne zuerst einen bestehenden Server, oder\n"
              + "> upgrade auf ein größeres Bundle",
            `This license covers **${seats}** servers and all seats are used.\n\n`
              + "> Unlink an existing server first, or\n"
              + "> upgrade to a larger bundle"
          )
        )
        .setColor(BRAND.proColor),
    ],
    components: [upgradeButton(language, pick(language, "Lizenz verwalten", "Manage license"))],
    ephemeral: true,
  };
}

export function genericUpgradeEmbed(title, description, language = getDefaultLanguage()) {
  return {
    embeds: [
      baseEmbed()
        .setTitle(title)
        .setDescription(description),
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}
