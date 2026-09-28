// ============================================================
// OmniFM: the year review per server (#301), counted
// ============================================================
// The commander counts the months a few minutes after the start and then
// every six hours: on the first run every month the listening sessions
// still reach back to, afterwards the current month and the one before.

import { log } from "../lib/logging.js";
import { refreshYearReview } from "../year-review-store.js";
import { loadStations } from "../stations-store.js";

const FIRST_RUN_MS = 3 * 60_000;
const EVERY_MS = 6 * 60 * 60_000;

/**
 * The genre of a catalogue station; a server's own station has none.
 * @param {Record<string, { genre?: string }>} [stations]
 */
export function catalogGenreOf(stations = loadStations()?.stations || {}) {
  return (key) => String(stations?.[key]?.genre || "");
}

export async function countYearReviewNow({ now = Date.now() } = {}) {
  const { months } = await refreshYearReview({ now, genreOf: catalogGenreOf() });
  if (months.length > 2) {
    log("INFO", `[Jahresrückblick] Monate nachgezählt: ${months.map(({ month, servers }) => `${month} (${servers} Server)`).join(", ")}`);
  }
  return months;
}

let timers = [];

export function startYearReviewService() {
  if (timers.length) return;
  const run = () => countYearReviewNow().catch((err) => log("WARN", `[Jahresrückblick] Zählen fehlgeschlagen: ${err?.message || err}`));
  timers = [setTimeout(run, FIRST_RUN_MS), setInterval(run, EVERY_MS)];
  for (const timer of timers) timer.unref?.();
}

export function stopYearReviewService() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
