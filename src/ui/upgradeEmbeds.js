// ============================================================
// OmniFM - Upgrade Embeds (Reusable Discord Embeds, DE/EN)
// ============================================================
// What a plan brings comes from src/config/plan-features.js (#413), so the
// hints say the same as the website, /help and /premium.

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { BRAND } from "../config/plans.js";
import { PLAN_LIMITS, PLAN_NAMES } from "../config/plan-features.js";
import { catalogPlanContext, planBulletLines } from "../bot/plan-texts.js";
import { getDefaultLanguage, normalizeLanguage } from "../i18n.js";
import { brandFooter, brandAuthor } from "../bot/brand-embed.js";

function languageOf(language) {
  return normalizeLanguage(language, getDefaultLanguage()) === "de" ? "de" : "en";
}

function pick(language, de, en) {
  return languageOf(language) === "de" ? de : en;
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
  const plan = PLAN_NAMES[requiredPlan] ? requiredPlan : "pro";
  const name = PLAN_NAMES[plan];
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Premium-Station", "Premium station"))
        .setDescription(
          pick(
            language,
            `**${stationName || "Diese Station"}** ist ab ${BRAND.name} **${name}** verfügbar. ${name} bringt:\n\n`,
            `**${stationName || "This station"}** is available from ${BRAND.name} **${name}**. ${name} brings:\n\n`
          ) + planBulletLines(plan, languageOf(language), catalogPlanContext())
        )
        .setColor(BRAND.proColor),
    ],
    components: [upgradeButton(language, pick(language, `Upgrade auf ${name}`, `Upgrade to ${name}`))],
    ephemeral: true,
  };
}

export function customStationEmbed(language = getDefaultLanguage()) {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Eigene Sender", "Your own stations"))
        .setDescription(
          pick(
            language,
            `Eigene Sender gibt es mit **${BRAND.name} Ultimate**. Ultimate bringt:\n\n`,
            `Your own stations come with **${BRAND.name} Ultimate**. Ultimate brings:\n\n`
          ) + planBulletLines("ultimate", languageOf(language), catalogPlanContext())
        )
        .setColor(BRAND.ultimateColor),
    ],
    components: [upgradeButton(language, pick(language, "Upgrade auf Ultimate", "Upgrade to Ultimate"))],
    ephemeral: true,
  };
}

export function botLimitEmbed(currentPlan, maxBots, requestedIndex, language = getDefaultLanguage()) {
  const current = PLAN_NAMES[currentPlan] || PLAN_NAMES.free;
  const larger = ["pro", "ultimate"]
    .filter((plan) => PLAN_LIMITS[plan].maxBots > maxBots)
    .map((plan) => pick(
      language,
      `> **${PLAN_NAMES[plan]}**: ${PLAN_LIMITS[plan].maxBots} Sprachkanäle gleichzeitig`,
      `> **${PLAN_NAMES[plan]}**: ${PLAN_LIMITS[plan].maxBots} voice channels at once`
    ));
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Worker-Limit erreicht", "Worker limit reached"))
        .setDescription(
          pick(
            language,
            `Dein **${current}**-Plan erlaubt maximal **${maxBots}** Worker.\n`
              + `Du hast Worker #${requestedIndex} angefragt.`,
            `Your **${current}** plan allows up to **${maxBots}** workers.\n`
              + `You requested worker #${requestedIndex}.`
          ) + (larger.length ? `\n\n${larger.join("\n")}` : "")
        )
        .setColor(BRAND.proColor),
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}
