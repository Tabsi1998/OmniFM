// ============================================================
// OmniFM: the Easter egg hunt in Discord (#429)
// ============================================================
// The egg button in the panel, the finder's private answer and /ostereier
// (English /eggs), the server's board. Plain data in, payloads out; the
// runtime side is runtime-methods/easter-eggs.js, the rules lib/easter-eggs.js.
import { ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";

import * as ui from "../discord/ui/index.js";
import { GOLDEN_POINTS } from "../lib/easter-eggs.js";
import { SEASON_COLORS } from "./season-look.js";
import { NP_PREFIX } from "./runtime-shared.js";

export const EGG_ACTION_PREFIX = "egg:";
export const EGG_BUTTON_PREFIX = `${NP_PREFIX}${EGG_ACTION_PREFIX}`;
const MEDALS = ["🥇", "🥈", "🥉"];

/** The panel's egg: one to catch, a golden one, or "Found" once somebody has it. */
export function eggButton(egg, { t, appId = null }) {
  if (!egg?.id) return null;
  const button = new ButtonBuilder()
    .setCustomId(`${EGG_BUTTON_PREFIX}${egg.id}`)
    .setEmoji(ui.componentEmoji("egg", appId) || { name: "🥚" });
  if (egg.foundAt) return button.setStyle(ButtonStyle.Secondary).setLabel(t("Gefunden", "Found")).setDisabled(true);
  return egg.golden
    ? button.setStyle(ButtonStyle.Success).setLabel(t("Ein goldenes Ei!", "A golden egg!"))
    : button.setStyle(ButtonStyle.Secondary).setLabel(t("Ein Osterei!", "An Easter egg!"));
}

/** What the panel's signature needs to know: a new egg or a found one redraws it. */
export function eggSignature(egg) {
  if (!egg?.id) return "";
  return `${egg.id}:${egg.foundAt ? "found" : "open"}`;
}

const eggs = (count, t) => (count === 1 ? t("1 Ei", "1 egg") : t(`${count} Eier`, `${count} eggs`));

/** The private answer to a click on the egg; reason as claimEgg and the runtime give it. */
export function eggAnswer({ t, result, golden = false, appId = null }) {
  const egg = ui.icon("egg", appId) || "🥚";
  let content;
  if (result?.ok) {
    content = golden
      ? `🌟 ${t(`Du hast ein goldenes Ei gefunden! Es zählt ${GOLDEN_POINTS}. (${result.count} dieses Jahr)`, `You found a golden egg! It counts ${GOLDEN_POINTS}. (${result.count} this year)`)}`
      : `${egg} ${t(`Du hast ein Ei gefunden! (${result.count} dieses Jahr)`, `You found an egg! (${result.count} this year)`)}`;
    content += `\n-# ${t("`/ostereier` zeigt die Bestenliste des Servers.", "`/eggs` shows the server's leaderboard.")}`;
  } else {
    content = {
      taken: t("Zu spät: Dieses Ei hat schon jemand gefunden.", "Too late: somebody found this egg already."),
      mine: t("Dieses Ei hast du schon gefunden.", "You found this egg already."),
      gone: t("Dieses Ei ist weg: Der Song ist schon vorbei.", "This egg is gone: the song is over."),
      song: t("Für diesen Song hast du schon ein Ei. Das nächste gibt es bei einem anderen Song.", "You have an egg for this song already. The next one comes with another song."),
      over: t("Die Ostereiersuche ist vorbei.", "The Easter egg hunt is over."),
      bot: t("Bots suchen keine Eier.", "Bots do not hunt eggs."),
    }[result?.reason] || t("Die Ostereiersuche geht gerade nicht. Versuch es gleich noch einmal.", "The Easter egg hunt does not work right now. Try again in a moment.");
  }
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

/** A calendar date as a Discord timestamp: every reader sees it in their own language. */
function discordDate({ year, month, day }) {
  return `<t:${Math.floor(Date.UTC(year, month - 1, day, 12) / 1000)}:D>`;
}

/**
 * /ostereier: the server's board, only for whoever asks.
 * @param {{
 *   t: (de: string, en: string) => string,
 *   board: { year: number, top: { userId: string, count: number, rank: number }[], own: { count: number, rank: number } | null, finders: number } | null,
 *   running?: boolean, off?: boolean, next?: { year: number, month: number, day: number } | null,
 *   appId?: string | null,
 * }} input
 */
export function buildEggBoard({ t, board, running = false, off = false, next = null, appId = null }) {
  const egg = ui.icon("egg", appId) || "🥚";
  const blocks = [];
  const year = board?.year ?? next?.year ?? new Date().getUTCFullYear();
  const heading = ui.heading(`${egg} ${t("Ostereiersuche", "Easter egg hunt")} ${year}`);
  if (board?.top?.length) {
    const lines = board.top.map((row) => `${MEDALS[row.rank - 1] || `**${row.rank}.**`} <@${row.userId}> · ${eggs(row.count, t)}`);
    blocks.push(ui.text([heading, ...lines].join("\n")));
  } else {
    blocks.push(ui.text([heading, t("Hier hat noch niemand ein Ei gefunden.", "Nobody here has found an egg yet.")].join("\n")));
  }
  const own = board?.own
    ? t(`Dein Platz: ${board.own.rank} · ${eggs(board.own.count, t)}`, `Your place: ${board.own.rank} · ${eggs(board.own.count, t)}`)
    : t("Du hast noch kein Ei gefunden.", "You have not found an egg yet.");
  blocks.push(ui.text(`**${own}**${board?.finders ? ` · ${t(`${board.finders} Finder`, `${board.finders} finders`)}` : ""}`));
  let note;
  if (off) {
    note = t("Die Ostereiersuche ist auf diesem Server ausgeschaltet (Dashboard → Saison-Deko).", "The Easter egg hunt is switched off on this server (dashboard → Seasonal decoration).");
  } else if (running) {
    note = t(
      `Bis Ostermontag bringt etwa jeder achte Song ein Ei ins Panel; wer zuerst klickt, bekommt es. Ein goldenes Ei zählt ${GOLDEN_POINTS}.`,
      `Until Easter Monday about every eighth song brings an egg into the panel; whoever clicks first gets it. A golden egg counts ${GOLDEN_POINTS}.`,
    );
  } else if (next) {
    note = t(`Die nächste Ostereiersuche beginnt am Palmsonntag, ${discordDate(next)}.`, `The next Easter egg hunt starts on Palm Sunday, ${discordDate(next)}.`);
  }
  if (note) blocks.push(ui.text(ui.subtext(note)));
  blocks.push(ui.brandLine());
  return { ...ui.reply(ui.container({ accent: SEASON_COLORS.easter, blocks })), allowedMentions: { parse: [] } };
}
