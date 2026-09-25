// ============================================================
// OmniFM: the station browser in Components V2 (#268)
// ============================================================
// /stations, /list and the "Sender" buttons open it. Genre filter, five
// stations per page, each with a play button next to it; stations above the
// server's plan are shown with a lock and a link to Premium. A search form
// narrows the list by name or genre.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import * as ui from "../discord/ui/index.js";
import { TIER_RANK } from "../lib/helpers.js";

export const BROWSER_PAGE_SIZE = 5;
const CUSTOM_ID_MAX = 100;

// The nine coloured squares Discord renders everywhere; the genre colour
// picks the nearest one, so the list shows the colours of the catalog.
const COLOR_SQUARES = [
  ["🟥", 0xDD2E44], ["🟧", 0xF4900C], ["🟨", 0xFDCB58], ["🟩", 0x78B159], ["🟦", 0x55ACEE],
  ["🟪", 0xAA8ED6], ["🟫", 0xC1694F], ["⬛", 0x31373D], ["⬜", 0xE6E7E8],
];

export function colorSquare(hex) {
  const value = Number.parseInt(String(hex || "").replace(/^#/, ""), 16);
  if (!Number.isFinite(value)) return "⬛";
  const channels = (color) => [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  const [r, g, b] = channels(value);
  let best = COLOR_SQUARES[0];
  let bestDistance = Infinity;
  for (const square of COLOR_SQUARES) {
    const [sr, sg, sb] = channels(square[1]);
    const distance = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (distance < bestDistance) {
      best = square;
      bestDistance = distance;
    }
  }
  return best[0];
}

/**
 * Every official station with its lock state for the server's plan, plus the
 * server's own stations on Ultimate. Available ones first.
 */
export function buildBrowserEntries({ stations = {}, guildTier = "free", customStations = [] }) {
  const planRank = TIER_RANK[guildTier] ?? 0;
  const tierOrder = { free: 0, pro: 1, ultimate: 2 };
  const entries = Object.entries(stations).map(([key, station]) => {
    const tier = String(station?.tier || "free").toLowerCase();
    return {
      key,
      name: String(station?.name || key),
      genre: String(station?.genre || "Radio"),
      color: station?.color || null,
      tier,
      locked: (TIER_RANK[tier] ?? 0) > planRank,
      source: "official",
    };
  });
  for (const custom of customStations) entries.push({ ...custom, locked: false, source: "custom" });
  return entries.sort((left, right) => {
    if (left.locked !== right.locked) return left.locked ? 1 : -1;
    const tierDelta = (tierOrder[left.tier] ?? 9) - (tierOrder[right.tier] ?? 9);
    if (tierDelta) return tierDelta;
    return left.name.localeCompare(right.name);
  });
}

export function filterBrowserEntries(entries, { genre = null, query = "" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  return entries.filter((entry) => {
    if (genre && entry.genre !== genre) return false;
    if (!needle) return true;
    return entry.name.toLowerCase().includes(needle) || entry.genre.toLowerCase().includes(needle);
  });
}

export function pickCustomId(prefix, sessionId, stationKey) {
  const id = `${prefix}pick:${sessionId}:${stationKey}`;
  return id.length <= CUSTOM_ID_MAX ? id : null;
}

/** "pick:<session>:<station key>" - station keys of custom stations contain ":". */
export function parsePickTarget(sessionPart) {
  const [sessionId, ...rest] = String(sessionPart || "").split(":");
  return { sessionId: sessionId || null, stationKey: rest.join(":") || null };
}

/**
 * @param {object} input
 * @param {(de: string, en: string) => string} input.t
 * @param {string} input.prefix      custom id prefix of the browser
 * @param {object} input.session     { id, data: { page, genre, query } }
 * @param {object[]} input.entries   buildBrowserEntries()
 * @param {string} input.planName
 * @param {string} input.premiumUrl
 * @param {string|null} [input.applicationId]
 * @param {string} [input.hint]
 */
export function buildStationBrowserPayload(input) {
  const { t, prefix, session, entries, applicationId: appId = null } = input;
  const genre = session?.data?.genre || null;
  const query = String(session?.data?.query || "").trim();
  const shown = filterBrowserEntries(entries, { genre, query });
  const pages = Math.max(1, Math.ceil(shown.length / BROWSER_PAGE_SIZE));
  const page = Math.min(Math.max(0, Number.parseInt(String(session?.data?.page ?? 0), 10) || 0), pages - 1);
  const pageEntries = shown.slice(page * BROWSER_PAGE_SIZE, (page + 1) * BROWSER_PAGE_SIZE);

  const genres = [...new Set(entries.map((entry) => entry.genre))].sort((a, b) => a.localeCompare(b)).slice(0, 24);
  const genreColors = new Map(entries.map((entry) => [entry.genre, entry.color]));
  const genreSelect = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}genre:${session.id}`)
    .setPlaceholder(t("Genre wählen", "Choose a genre"))
    .addOptions([
      { label: t("Alle Genres", "All genres"), value: "__all__", default: !genre },
      ...genres.map((name) => ({ label: name.slice(0, 100), value: name.slice(0, 100), emoji: { name: colorSquare(genreColors.get(name)) }, default: genre === name })),
    ]);

  const subtitle = ui.statusLine([
    `${t("Plan", "Plan")}: **${input.planName}**`,
    t(`${shown.length} Sender`, `${shown.length} stations`),
    genre ? `${colorSquare(genreColors.get(genre))} ${genre}` : null,
    query ? `${t("Suche", "Search")}: „${query.slice(0, 40)}“` : null,
  ]);

  const rows = pageEntries.map((entry) => {
    const lines = [
      `${colorSquare(entry.color)} **${entry.name.slice(0, 80)}**`,
      ui.subtext(ui.statusLine([
        entry.genre,
        entry.source === "custom" ? t("Eigener Sender", "Your station") : (entry.tier !== "free" ? entry.tier.toUpperCase() : null),
      ])),
    ];
    let button;
    if (entry.locked) {
      button = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(input.premiumUrl)
        .setLabel(entry.tier === "ultimate" ? "Ultimate" : "Pro").setEmoji({ name: "🔒" });
    } else {
      const customId = pickCustomId(prefix, session.id, entry.key);
      button = new ButtonBuilder().setStyle(ButtonStyle.Primary).setLabel(t("Abspielen", "Play"));
      if (customId) button.setCustomId(customId);
      else button.setCustomId(`${prefix}toolong:${session.id}`).setDisabled(true);
      const playEmoji = ui.componentEmoji("play", appId);
      if (playEmoji) button.setEmoji(playEmoji);
    }
    return ui.section({ content: lines.join("\n"), button });
  });

  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}page-prev:${session.id}`).setStyle(ButtonStyle.Secondary)
      .setLabel("◀").setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}pageinfo:${session.id}`).setStyle(ButtonStyle.Secondary)
      .setLabel(`${page + 1} / ${pages}`).setDisabled(true),
    new ButtonBuilder().setCustomId(`${prefix}page-next:${session.id}`).setStyle(ButtonStyle.Secondary)
      .setLabel("▶").setDisabled(page >= pages - 1),
    new ButtonBuilder().setCustomId(`${prefix}search:${session.id}`).setStyle(ButtonStyle.Secondary)
      .setLabel(t("Suchen", "Search")).setEmoji({ name: "🔍" }),
    new ButtonBuilder().setCustomId(`${prefix}close:${session.id}`).setStyle(ButtonStyle.Secondary)
      .setLabel(t("Schließen", "Close")),
  );
  const actions = [new ActionRowBuilder().addComponents(genreSelect), navigation];
  if (genre || query) {
    actions.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}reset:${session.id}`).setStyle(ButtonStyle.Secondary)
        .setLabel(t("Alle Sender zeigen", "Show all stations")),
    ));
  }

  const body = rows.length
    ? rows
    : [ui.text(t("Keine Sender gefunden. Anderes Genre wählen oder die Suche zurücksetzen.", "No stations found. Pick another genre or reset the search."))];
  if (input.hint) body.push(ui.text(`> ${String(input.hint).slice(0, 300)}`));

  return ui.reply(ui.panel({
    accent: genre ? (Number.parseInt(String(genreColors.get(genre) || "").replace(/^#/, ""), 16) || ui.UI_COLORS.brand) : ui.UI_COLORS.brand,
    title: `${ui.icon("radio", appId)} ${t("Sender", "Stations")}`,
    subtitle,
    body,
    actions,
    footer: "/stations",
  }));
}

/** The search form of the browser. */
export function buildStationSearchModal({ t, prefix, sessionId, query = "" }) {
  const input = new TextInputBuilder()
    .setCustomId("query")
    .setLabel(t("Name oder Genre", "Name or genre"))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(60)
    .setPlaceholder(t("z. B. Techno, Lounge, Groove", "e.g. techno, lounge, groove"));
  if (query) input.setValue(String(query).slice(0, 60));
  return new ModalBuilder()
    .setCustomId(`${prefix}searchform:${sessionId}`)
    .setTitle(t("Sender suchen", "Search stations"))
    .addComponents(new ActionRowBuilder().addComponents(input));
}
