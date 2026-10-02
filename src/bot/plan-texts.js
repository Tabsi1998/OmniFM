// ============================================================
// OmniFM: the plan lines in Discord (#413)
// ============================================================
// /help, /premium and the upgrade hints say what a plan brings with the
// lines of src/config/plan-features.js, with the numbers of the catalogue.
import { loadStations } from "../stations-store.js";
import { PLAN_NAMES } from "../config/plan-features.js";
import { planCardLinesIn } from "../config/plan-feature-texts.js";

/**
 * How many stations the plan lines name: the Free ones and all of them.
 * @param {Record<string, { tier?: string }>} [stations]
 */
export function catalogPlanContext(stations = loadStations()?.stations || {}) {
  const list = Object.values(stations || {});
  const freeStations = list.filter((station) => String(station?.tier || "free").toLowerCase() === "free").length;
  return { freeStations: freeStations || undefined, allStations: list.length || undefined };
}

/**
 * "**Pro:** Alle 120 Sender des Katalogs · 8 Sprachkanäle gleichzeitig · …":
 * what a plan adds to the one below, in one line.
 * @param {string} plan
 * @param {string} language
 * @param {{ freeStations?: number, allStations?: number }} [context]
 */
export function planSummaryLine(plan, language, context = {}) {
  const { lines } = planCardLinesIn(plan, { language, context, highlightsOnly: true });
  return `**${PLAN_NAMES[plan] || plan}:** ${lines.join(" · ")}`;
}

/**
 * The bullet list of what the next plan adds, for upgrade hints.
 * @param {string} plan the plan to show
 * @param {string} language
 * @param {{ freeStations?: number, allStations?: number }} [context]
 */
export function planBulletLines(plan, language, context = {}) {
  return planCardLinesIn(plan, { language, context, highlightsOnly: true }).lines.map((line) => `> ${line}`).join("\n");
}
