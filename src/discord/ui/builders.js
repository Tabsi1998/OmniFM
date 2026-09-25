// ============================================================
// OmniFM Discord design system: building blocks (#264)
// ============================================================
// One place for how OmniFM messages look. Every block returns discord.js
// builders for Components V2 (containers with an accent colour, text,
// separators, sections with a thumbnail or button). `reply()` and
// `message()` turn them into a payload with the right flags;
// `checkDiscordLimits()` says whether Discord will accept it.
// The rules for tone and layout are in docs/discord-design.md.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import { versionTag } from "../../bot/brand-embed.js";
import { icon } from "./icons.js";
import { DISCORD_LIMITS, NOTICE_KINDS, UI_COLORS } from "./tokens.js";

// Discord rejects an empty text display; a zero-width space stands in.
const EMPTY_TEXT = String.fromCharCode(0x200b);

function clamp(value, max) {
  const textValue = String(value ?? "");
  return textValue.length <= max ? textValue : `${textValue.slice(0, Math.max(0, max - 1))}…`;
}

/** Plain markdown text. */
export function text(content) {
  return new TextDisplayBuilder().setContent(clamp(content, DISCORD_LIMITS.textLength) || EMPTY_TEXT);
}

/** "## Title" - level 1 to 3. */
export function heading(title, level = 2) {
  return `${"#".repeat(Math.min(3, Math.max(1, level)))} ${String(title ?? "").trim()}`;
}

/** Small grey text: every line gets Discord's "-# " prefix. */
export function subtext(content) {
  return String(content ?? "").split("\n").filter((line) => line.trim()).map((line) => `-# ${line}`).join("\n");
}

/** "Station · Genre · 42 listeners": the empty parts drop out. */
export function statusLine(parts = []) {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== "").join(" · ");
}

/** A labelled block: "**Label**\nvalue". */
export function field(label, value) {
  return `**${String(label ?? "").trim()}**\n${String(value ?? "").trim() || "-"}`;
}

export function separator({ divider = true, large = false } = {}) {
  return new SeparatorBuilder()
    .setDivider(divider)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/** Text with a thumbnail (cover, logo) or a button on the right. */
export function section({ content, thumbnailUrl = null, button = null }) {
  const block = new SectionBuilder().addTextDisplayComponents(text(content));
  if (thumbnailUrl) block.setThumbnailAccessory(new ThumbnailBuilder().setURL(String(thumbnailUrl)));
  else if (button) block.setButtonAccessory(button);
  return block;
}

/** The brand line at the bottom: "OmniFM · v3.1.0 · abc1234 · /status". */
export function brandLine(...parts) {
  return text(subtext(statusLine(["OmniFM", versionTag(), ...parts])));
}

function addBlock(container, block) {
  if (!block) return container;
  if (typeof block === "string") return container.addTextDisplayComponents(text(block));
  if (block instanceof TextDisplayBuilder) return container.addTextDisplayComponents(block);
  if (block instanceof SeparatorBuilder) return container.addSeparatorComponents(block);
  if (block instanceof SectionBuilder) return container.addSectionComponents(block);
  if (block instanceof ActionRowBuilder) return container.addActionRowComponents(block);
  if (block instanceof MediaGalleryBuilder) return container.addMediaGalleryComponents(block);
  throw new TypeError(`unsupported block in container: ${block?.constructor?.name || typeof block}`);
}

/** A container with an accent colour and any blocks (strings become text). */
export function container({ accent = UI_COLORS.brand, blocks = [] } = {}) {
  const box = new ContainerBuilder().setAccentColor(accent);
  for (const block of blocks) addBlock(box, block);
  return box;
}

/**
 * The standard OmniFM message: heading (with a thumbnail when given),
 * subtitle, body blocks, action rows and the brand line.
 */
export function panel({ accent = UI_COLORS.brand, title, subtitle = "", body = [], thumbnailUrl = null, actions = [], footer = "" }) {
  const head = [heading(title), subtitle ? String(subtitle) : ""].filter(Boolean).join("\n");
  const rows = actions.filter(Boolean);
  return container({
    accent,
    blocks: [
      thumbnailUrl ? section({ content: head, thumbnailUrl }) : text(head),
      ...body,
      rows.length ? separator() : null,
      ...rows,
      brandLine(footer),
    ],
  });
}

/** Info, success, warning, error or premium hint, with an optional fix. */
export function notice(kind, { title, body = "", actions = [], footer = "", applicationId = null }) {
  const style = NOTICE_KINDS[kind] || NOTICE_KINDS.info;
  return panel({
    accent: style.color,
    title: `${icon(style.icon, applicationId)} ${String(title ?? "").trim()}`.trim(),
    body: body ? [text(body)] : [],
    actions,
    footer,
  });
}

/**
 * A page of a longer list with back/next buttons. `customId(page)` builds
 * the button id; buttons outside the list are disabled.
 */
export function list({ accent = UI_COLORS.brand, title, items = [], page = 0, pageSize = 10, customId, footer = "", t = (de) => de }) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const shown = items.slice(current * pageSize, (current + 1) * pageSize);
  const body = shown.length ? shown.map((item) => `- ${item}`).join("\n") : t("Noch keine Einträge.", "No entries yet.");
  const actions = [];
  if (pages > 1 && typeof customId === "function") {
    actions.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(customId(current - 1)).setStyle(ButtonStyle.Secondary)
        .setLabel(t("◀ Zurück", "◀ Back")).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(`${customId(current)}:page`).setStyle(ButtonStyle.Secondary)
        .setLabel(`${current + 1} / ${pages}`).setDisabled(true),
      new ButtonBuilder().setCustomId(customId(current + 1)).setStyle(ButtonStyle.Secondary)
        .setLabel(t("Weiter ▶", "Next ▶")).setDisabled(current >= pages - 1),
    ));
  }
  return { container: panel({ accent, title, body: [text(body)], actions, footer }), page: current, pages };
}

/** A yes/no question with two buttons. */
export function confirm({ title, body = "", confirmId, cancelId, confirmLabel, cancelLabel, danger = false, t = (de) => de }) {
  return panel({
    accent: danger ? UI_COLORS.error : UI_COLORS.brand,
    title,
    body: body ? [text(body)] : [],
    actions: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Primary)
        .setLabel(confirmLabel || t("Ja", "Yes")),
      new ButtonBuilder().setCustomId(cancelId).setStyle(ButtonStyle.Secondary)
        .setLabel(cancelLabel || t("Abbrechen", "Cancel")),
    )],
  });
}

/** Payload for interaction.reply / editReply. Ephemeral unless said otherwise. */
export function reply(components, { ephemeral = true } = {}) {
  const items = Array.isArray(components) ? components : [components];
  return {
    components: items.filter(Boolean),
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
  };
}

/** Payload for channel.send / message.edit. */
export function message(components) {
  return reply(components, { ephemeral: false });
}

/**
 * Whether a message was sent with Components V2. Such a message can never
 * be edited into embeds or plain content; a handler answers it with a new
 * message instead of interaction.update().
 */
export function isComponentsV2Message(sourceMessage) {
  const flags = sourceMessage?.flags;
  if (!flags) return false;
  if (typeof flags.has === "function") return flags.has(MessageFlags.IsComponentsV2);
  return (Number(flags) & MessageFlags.IsComponentsV2) !== 0;
}

/** Counts components and text of a payload against Discord's limits. */
export function checkDiscordLimits(payload) {
  let components = 0;
  let textLength = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const json = typeof node.toJSON === "function" ? node.toJSON() : node;
    if (typeof json.type === "number") components += 1;
    if (json.type === 10 && typeof json.content === "string") textLength += json.content.length;
    for (const child of json.components || []) visit(child);
    if (json.accessory) visit(json.accessory);
  };
  for (const component of payload?.components || []) visit(component);
  const problems = [];
  if (components > DISCORD_LIMITS.components) problems.push(`${components} components (Discord allows ${DISCORD_LIMITS.components})`);
  if (textLength > DISCORD_LIMITS.textLength) problems.push(`${textLength} characters of text (Discord allows ${DISCORD_LIMITS.textLength})`);
  return { components, textLength, problems };
}
