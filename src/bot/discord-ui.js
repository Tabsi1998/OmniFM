import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

import { BRAND } from "../config/plans.js";
import { OMNI_COLORS, brandFooter, brandAuthor, versionTag } from "./brand-embed.js";

export const DISCORD_UI_COLORS = {
  info: OMNI_COLORS.cyan,
  live: OMNI_COLORS.red,
  admin: OMNI_COLORS.orange,
  success: OMNI_COLORS.success,
  warning: OMNI_COLORS.warning,
  danger: OMNI_COLORS.danger,
  neutral: OMNI_COLORS.neutral,
};

export function buildOmniEmbed({
  tone = "info",
  title = "",
  description = "",
  fields = [],
  footer = "",
  author = "",
  withAuthor = true,
  withFooter = true,
  thumbnail = "",
  timestamp = true,
} = {}) {
  const embed = new EmbedBuilder().setColor(DISCORD_UI_COLORS[tone] || DISCORD_UI_COLORS.info);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (Array.isArray(fields) && fields.length > 0) {
    embed.addFields(fields);
  }
  if (withAuthor) embed.setAuthor(brandAuthor(author || `${BRAND.name} · 24/7 Discord Radio`));
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (withFooter) {
    const tag = versionTag();
    const text = footer || BRAND.footer;
    embed.setFooter(brandFooter(tag ? `${text} · ${tag}` : text));
  }
  if (timestamp) embed.setTimestamp(new Date());
  return embed;
}

export function buildLinkRow(buttons = []) {
  const components = buttons
    .filter((button) => button?.label && button?.url)
    .slice(0, 5)
    .map((button) => new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(String(button.label))
      .setURL(String(button.url)));
  if (!components.length) return null;
  return new ActionRowBuilder().addComponents(...components);
}
