// ============================================================
// OmniFM: "Which station next?" as a Discord poll (#274)
// ============================================================
// Plain data in, payloads out: which stations go into the poll, the poll
// itself, who won (a tie, no votes) and the announcement afterwards. The
// runtime side is runtime-methods/polls.js.
import * as ui from "../discord/ui/index.js";
import { colorSquare } from "./station-browser.js";

export const POLL_DURATION_CHOICES = Object.freeze([5, 15, 30, 60, 180, 360, 720, 1440]);
export const POLL_DEFAULT_MINUTES = 30;
export const POLL_MIN_STATIONS = 2;
export const POLL_MAX_STATIONS = 10;
const ANSWER_MAX = 55;

function clip(value, max) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function normalizePollMinutes(value) {
  const minutes = Number.parseInt(String(value ?? ""), 10);
  return POLL_DURATION_CHOICES.includes(minutes) ? minutes : POLL_DEFAULT_MINUTES;
}

/**
 * "Groove Salad, drone" -> catalog entries, by key or name (exact first,
 * then "contains"); each station once. { stations, unknown }.
 */
export function resolvePollStations(text, entries = []) {
  const stations = [];
  const unknown = [];
  for (const raw of String(text || "").split(/[,;\n]/)) {
    const needle = raw.trim().toLowerCase();
    if (!needle) continue;
    const match = entries.find((entry) => entry.key.toLowerCase() === needle || entry.name.toLowerCase() === needle)
      || entries.find((entry) => entry.name.toLowerCase().includes(needle) || entry.key.toLowerCase().includes(needle));
    if (!match) unknown.push(raw.trim());
    else if (!stations.some((station) => station.key === match.key)) stations.push(match);
  }
  return { stations: stations.slice(0, POLL_MAX_STATIONS), unknown };
}

/** `count` stations of a genre in random order (random() is injectable for tests). */
export function pickGenreStations(entries = [], genre = "", count = 5, random = Math.random) {
  const wanted = String(genre || "").trim().toLowerCase();
  const pool = entries.filter((entry) => !wanted || String(entry.genre || "").toLowerCase() === wanted);
  const shuffled = pool.map((entry) => ({ entry, order: random() })).sort((a, b) => a.order - b.order).map(({ entry }) => entry);
  const size = Math.max(POLL_MIN_STATIONS, Math.min(POLL_MAX_STATIONS, Number(count) || 5));
  return shuffled.slice(0, size);
}

/**
 * The message with the Discord poll. Discord polls run in whole hours; a
 * shorter poll gets one hour and OmniFM ends it itself at `endsAt`.
 */
export function buildStationPollMessage({ t, stations, minutes, endsAt }) {
  return {
    content: t(
      `📻 Abstimmung bis <t:${Math.floor(endsAt / 1000)}:t> – der Gewinner läuft danach.`,
      `📻 Voting until <t:${Math.floor(endsAt / 1000)}:t> – the winner plays afterwards.`
    ),
    poll: {
      question: { text: t("Welcher Sender als Nächstes?", "Which station next?") },
      answers: stations.map((station) => ({ text: clip(station.name || station.key, ANSWER_MAX), emoji: colorSquare(station.color) })),
      duration: Math.max(1, Math.ceil(minutes / 60)),
      allowMultiselect: false,
    },
    allowedMentions: { parse: [] },
  };
}

/**
 * The result from the answers' vote counts, in poll order:
 * { kind: "none" } with no votes, { kind: "winner", index }, or
 * { kind: "tie", index, tied } where the station that stood first wins.
 */
export function decideStationPollWinner(voteCounts = []) {
  const counts = voteCounts.map((count) => Math.max(0, Number(count) || 0));
  const best = Math.max(0, ...counts);
  if (best === 0) return { kind: "none" };
  const tied = counts.map((count, index) => (count === best ? index : -1)).filter((index) => index >= 0);
  return tied.length > 1 ? { kind: "tie", index: tied[0], tied } : { kind: "winner", index: tied[0] };
}

/** What OmniFM says when the poll is over. */
export function buildStationPollResultPayload({ t, outcome, stations = [], currentName = "", switched = false, error = "" }) {
  const name = (index) => `**${clip(stations[index]?.name || stations[index]?.key || "-", 80)}**`;
  let kind = "success";
  let title = t("Umfrage entschieden", "Poll decided");
  let body;
  if (outcome.kind === "none") {
    kind = "info";
    title = t("Keine Stimmen", "No votes");
    body = t(`Niemand hat abgestimmt – es bleibt bei **${clip(currentName || "-", 80)}**.`, `Nobody voted – **${clip(currentName || "-", 80)}** stays on.`);
  } else {
    const winner = name(outcome.index);
    const tieNote = outcome.kind === "tie"
      ? t(
        `Gleichstand zwischen ${outcome.tied.map(name).join(" und ")} – ${winner} gewinnt, weil er zuerst in der Umfrage stand. `,
        `A tie between ${outcome.tied.map(name).join(" and ")} – ${winner} wins because it stood first in the poll. `
      )
      : "";
    if (error) {
      kind = "error";
      title = t("Wechsel hat nicht geklappt", "Could not switch");
      body = `${tieNote}${t(`${winner} hat gewonnen, aber der Wechsel ging nicht: ${clip(error, 200)}`, `${winner} won, but switching failed: ${clip(error, 200)}`)}`;
    } else if (switched) {
      body = `${tieNote}${t(`📻 Jetzt läuft ${winner}.`, `📻 Now playing ${winner}.`)}`;
    } else {
      body = `${tieNote}${t(`${winner} läuft schon – es bleibt dabei.`, `${winner} is already on – it stays.`)}`;
    }
  }
  return ui.message(ui.notice(kind, { title, body }));
}
