// ============================================================
// OmniFM: what each plan brings (#413)
// ============================================================
// The one place that says what Free, Pro and Ultimate can do: the numbers
// (voice channels, audio, favourites, events, ...), the capabilities the bot
// and the dashboard check, the plan of each slash command, and the lines the
// website, /help and /premium show. Pure data and small functions without
// imports: the website bundles this file too (frontend/vite.config.js).

export const PLAN_ORDER = Object.freeze(["free", "pro", "ultimate"]);
export const PLAN_NAMES = Object.freeze({ free: "Free", pro: "Pro", ultimate: "Ultimate" });

/** The numbers of each plan; null is no limit. */
export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({ maxBots: 2, bitrate: "64k", bitrateNum: 64, reconnectMs: 5000, favorites: 3, events: 1, historySongs: 5, customStations: 0 }),
  pro: Object.freeze({ maxBots: 8, bitrate: "128k", bitrateNum: 128, reconnectMs: 1500, favorites: 5, events: null, historySongs: 20, customStations: 0 }),
  ultimate: Object.freeze({ maxBots: 16, bitrate: "320k", bitrateNum: 320, reconnectMs: 400, favorites: 10, events: null, historySongs: 20, customStations: 50 }),
});

/**
 * What the bot and the dashboard check, with the first plan that has it.
 * apiKey is its name in API answers.
 */
export const PLAN_CAPABILITIES = Object.freeze({
  dashboard_access: Object.freeze({ apiKey: "dashboardAccess", minPlan: "pro", de: "Dashboard", en: "Dashboard" }),
  event_scheduler: Object.freeze({ apiKey: "eventScheduler", minPlan: "free", de: "Geplante Events", en: "Scheduled events" }),
  role_permissions: Object.freeze({ apiKey: "rolePermissions", minPlan: "pro", de: "Rollenrechte", en: "Role permissions" }),
  weekly_digest: Object.freeze({ apiKey: "weeklyDigest", minPlan: "pro", de: "Wochenrückblick", en: "Weekly recap" }),
  basic_health: Object.freeze({ apiKey: "basicHealth", minPlan: "pro", de: "Live-Ansicht und Zustand", en: "Live view and health" }),
  incident_alerts: Object.freeze({ apiKey: "incidentAlerts", minPlan: "pro", de: "Ausfall-Meldungen", en: "Outage alerts" }),
  custom_station_urls: Object.freeze({ apiKey: "customStationUrls", minPlan: "ultimate", de: "Eigene Sender", en: "Your own stations" }),
  advanced_analytics: Object.freeze({ apiKey: "advancedAnalytics", minPlan: "ultimate", de: "Detail-Statistik", en: "Detailed statistics" }),
  failover_rules: Object.freeze({ apiKey: "failoverRules", minPlan: "ultimate", de: "Eigene Ersatzsender-Ketten", en: "Your own fallback chains" }),
  exports_webhooks: Object.freeze({ apiKey: "exportsWebhooks", minPlan: "ultimate", de: "Webhooks und Exporte", en: "Webhooks and exports" }),
  voice_guard: Object.freeze({ apiKey: "voiceGuard", minPlan: "free", de: "Voice Guard", en: "Voice guard" }),
});

/** Slash commands that need more than Free; every other command is Free. */
export const COMMAND_PLANS = Object.freeze({
  perm: "pro",
  addstation: "ultimate",
  removestation: "ultimate",
  mystations: "ultimate",
});

export function planRank(plan) {
  const index = PLAN_ORDER.indexOf(String(plan || "").toLowerCase());
  return index < 0 ? 0 : index;
}

export function planAtLeast(plan, minimum) {
  return planRank(plan) >= planRank(minimum);
}

export function normalizePlan(plan) {
  const value = String(plan || "").toLowerCase();
  return PLAN_ORDER.includes(value) ? value : "free";
}

export function planLimits(plan) {
  return PLAN_LIMITS[normalizePlan(plan)];
}

export function capabilityLabel(capabilityKey, language = "de") {
  const entry = PLAN_CAPABILITIES[capabilityKey];
  if (!entry) return String(capabilityKey || "");
  return language === "en" ? entry.en : entry.de;
}

/** "**Rollenrechte** gibt es ab OmniFM **Pro**." */
export function planRequirementText(capabilityKey, language = "de") {
  const entry = PLAN_CAPABILITIES[capabilityKey];
  const plan = PLAN_NAMES[entry?.minPlan || "pro"];
  const label = capabilityLabel(capabilityKey, language);
  return language === "en"
    ? `**${label}** comes with OmniFM **${plan}** and above.`
    : `**${label}** gibt es ab OmniFM **${plan}**.`;
}

const seconds = (ms, language) => {
  const value = ms / 1000;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return language === "en" ? text : text.replace(".", ",");
};

/**
 * @typedef {{ freeStations?: number, allStations?: number }} PlanContext
 * @typedef {(plan: string, context?: PlanContext) => (string | null)} PlanLine
 * @typedef {{ key: string, highlight?: boolean, de: PlanLine, en: PlanLine }} PlanFeature
 */

/**
 * Every line of the plans, in the order the website and /help show them.
 * de/en(plan, context) give the line in one language, or null when the plan
 * does not have it. context may carry { freeStations, allStations } from the
 * catalogue. highlight: part of the short lists of /help and /premium.
 * @type {ReadonlyArray<PlanFeature>}
 */
export const PLAN_FEATURES = Object.freeze([
  {
    key: "stations",
    highlight: true,
    de: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `${context.freeStations} Sender aus dem Katalog` : "Die Free-Sender des Katalogs")
      : (context.allStations ? `Alle ${context.allStations} Sender des Katalogs` : "Alle Sender des Katalogs")),
    en: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `${context.freeStations} stations from the catalogue` : "The free stations of the catalogue")
      : (context.allStations ? `All ${context.allStations} catalogue stations` : "Every catalogue station")),
  },
  {
    key: "channels",
    highlight: true,
    de: (plan) => `${PLAN_LIMITS[plan].maxBots} Sprachkanäle gleichzeitig`,
    en: (plan) => `${PLAN_LIMITS[plan].maxBots} voice channels at once`,
  },
  {
    key: "audio",
    highlight: true,
    de: (plan) => (plan === "ultimate" ? "Audio bis 320k, so gut wie der Sender liefert" : `Audio in ${PLAN_LIMITS[plan].bitrate}`),
    en: (plan) => (plan === "ultimate" ? "Audio up to 320k, as good as the station sends" : `Audio in ${PLAN_LIMITS[plan].bitrate}`),
  },
  {
    key: "reconnect",
    de: (plan) => `Nach einem Abbruch in ${seconds(Math.max(1000, PLAN_LIMITS[plan].reconnectMs), "de")} s wieder da`,
    en: (plan) => `Back ${seconds(Math.max(1000, PLAN_LIMITS[plan].reconnectMs), "en")} s after a drop`,
  },
  {
    key: "nowPlaying",
    de: () => "Now-Playing-Panel mit Knöpfen, auch mit /now",
    en: () => "Now-playing panel with buttons, also with /now",
  },
  {
    key: "history",
    de: (plan) => `/history mit den letzten ${PLAN_LIMITS[plan].historySongs} Songs`,
    en: (plan) => `/history with the last ${PLAN_LIMITS[plan].historySongs} songs`,
  },
  {
    key: "favorites",
    de: (plan) => `${PLAN_LIMITS[plan].favorites} Lieblingssender als Knöpfe im Panel`,
    en: (plan) => `${PLAN_LIMITS[plan].favorites} favourite stations as buttons in the panel`,
  },
  {
    key: "extras",
    de: () => "Merkliste, Umfragen, Sleep-Timer und Teilen-Karte",
    en: () => "Saved songs, polls, sleep timer and share card",
  },
  {
    key: "voiceGuard",
    de: () => "Voice Guard: der Bot bleibt in seinem Kanal",
    en: () => "Voice guard: the bot stays in its channel",
  },
  {
    key: "events",
    highlight: true,
    de: (plan) => (PLAN_LIMITS[plan].events === 1 ? "1 geplantes Radio-Event" : "Geplante Radio-Events ohne Grenze"),
    en: (plan) => (PLAN_LIMITS[plan].events === 1 ? "1 scheduled radio event" : "Unlimited scheduled radio events"),
  },
  {
    key: "dashboard",
    highlight: true,
    de: (plan) => (planAtLeast(plan, "pro") ? "Web-Dashboard mit Live-Ansicht, Statistik und Einstellungen" : null),
    en: (plan) => (planAtLeast(plan, "pro") ? "Web dashboard with live view, statistics and settings" : null),
  },
  {
    key: "permissions",
    highlight: true,
    de: (plan) => (planAtLeast(plan, "pro") ? "Rollenrechte: wer welche Befehle darf" : null),
    en: (plan) => (planAtLeast(plan, "pro") ? "Role permissions: who may use which command" : null),
  },
  {
    key: "incidentAlerts",
    highlight: true,
    de: (plan) => (planAtLeast(plan, "pro") ? "Ausfall-Meldungen in einen Discord-Kanal" : null),
    en: (plan) => (planAtLeast(plan, "pro") ? "Outage alerts in a Discord channel" : null),
  },
  {
    key: "weeklyDigest",
    de: (plan) => (planAtLeast(plan, "pro") ? "Wochenrückblick im Kanal" : null),
    en: (plan) => (planAtLeast(plan, "pro") ? "Weekly recap in a channel" : null),
  },
  {
    key: "panelDesign",
    de: (plan) => (planAtLeast(plan, "pro") ? "Panel selbst gestalten: Farbe und Knöpfe" : null),
    en: (plan) => (planAtLeast(plan, "pro") ? "Design the panel: colour and buttons" : null),
  },
  {
    key: "customStations",
    highlight: true,
    de: (plan) => (PLAN_LIMITS[plan].customStations ? `Bis zu ${PLAN_LIMITS[plan].customStations} eigene Sender mit Logo` : null),
    en: (plan) => (PLAN_LIMITS[plan].customStations ? `Up to ${PLAN_LIMITS[plan].customStations} stations of your own with logo` : null),
  },
  {
    key: "botProfile",
    highlight: true,
    de: (plan) => (plan === "ultimate" ? "Eigenes Bot-Aussehen pro Server" : null),
    en: (plan) => (plan === "ultimate" ? "Your own bot look per server" : null),
  },
  {
    key: "failoverRules",
    highlight: true,
    de: (plan) => (plan === "ultimate" ? "Eigene Ersatzsender-Ketten" : null),
    en: (plan) => (plan === "ultimate" ? "Your own fallback chains" : null),
  },
  {
    key: "analytics",
    de: (plan) => (plan === "ultimate" ? "Detail-Statistik über 30 Tage" : null),
    en: (plan) => (plan === "ultimate" ? "Detailed statistics over 30 days" : null),
  },
  {
    key: "webhooks",
    de: (plan) => (plan === "ultimate" ? "Webhooks und Exporte" : null),
    en: (plan) => (plan === "ultimate" ? "Webhooks and exports" : null),
  },
]);

/**
 * @param {PlanFeature} feature
 * @param {string} plan
 * @param {string} language
 * @param {PlanContext} context
 */
function lineOf(feature, plan, language, context) {
  const text = (language === "en" ? feature.en : feature.de)(plan, context);
  return text ? String(text) : null;
}

/**
 * The lines of one plan's card: Free lists everything it has; Pro and
 * Ultimate list only what is new or better than the plan below, after
 * "Alles aus Free, dazu:".
 * @param {string} plan
 * @param {{ language?: string, context?: PlanContext, highlightsOnly?: boolean }} [options]
 * @returns {{ basedOn: string | null, intro: string | null, lines: string[] }}
 */
export function planCardLines(plan, { language = "de", context = {}, highlightsOnly = false } = {}) {
  const current = normalizePlan(plan);
  const below = current === "free" ? null : PLAN_ORDER[planRank(current) - 1];
  const lines = [];
  for (const feature of PLAN_FEATURES) {
    if (highlightsOnly && !feature.highlight) continue;
    const line = lineOf(feature, current, language, context);
    if (!line) continue;
    if (below && lineOf(feature, below, language, context) === line) continue;
    lines.push(line);
  }
  const intro = below
    ? (language === "en" ? `Everything in ${PLAN_NAMES[below]}, plus:` : `Alles aus ${PLAN_NAMES[below]}, dazu:`)
    : null;
  return { basedOn: below, intro, lines };
}
