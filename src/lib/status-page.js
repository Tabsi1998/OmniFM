// ============================================================
// OmniFM: the public status page (#299), what it shows
// ============================================================
// Pure functions: the day of a moment, the last 90 days, which configured bot
// is online now, the owner's notices checked, and the answer of GET
// /api/status from the stored minutes, outages and notices. The answer names
// bots and their plan only, never a server, a listener count or an ID.

export const STATUS_TIME_ZONE = "Europe/Berlin";
export const STATUS_DAYS = 90;
/** A bot offline this long counts as an outage; shorter is a restart. */
export const OUTAGE_GRACE_MS = 2 * 60_000;
/** Past incidents: the last 14 days, outages from 5 minutes on. */
export const HISTORY_DAYS = 14;
export const HISTORY_MIN_OUTAGE_MS = 5 * 60_000;
/** Stored minutes, outages and ended notices go after 96 days (TTL). */
export const STATUS_KEEP_MS = 96 * 86_400_000;
export const STATUS_NOTICE_KINDS = Object.freeze(["incident", "maintenance"]);
export const STATUS_IMPACTS = Object.freeze(["minor", "major"]);
const HISTORY_MAX = 30;
const DAY_MS = 86_400_000;

const intOf = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function dateOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date || typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

const isoOf = (value) => dateOf(value)?.toISOString() ?? null;
const msOf = (value) => dateOf(value)?.getTime() ?? null;

/** Online share in percent, rounded down: 1439 of 1440 minutes is 99.93, never 100. */
function percent(online, total) {
  return total > 0 ? Math.floor((online / total) * 10_000) / 100 : null;
}

const dayFormats = new Map();

/** "2026-09-27": the calendar day of a moment in the status page's time zone. */
export function statusDay(ms, timeZone = STATUS_TIME_ZONE) {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The last `count` days up to today, oldest first; counted on the calendar, so a clock change skips none. */
export function lastStatusDays(now, count = STATUS_DAYS, timeZone = STATUS_TIME_ZONE) {
  const [year, month, day] = statusDay(now, timeZone).split("-").map(Number);
  const days = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    days.push(new Date(Date.UTC(year, month - 1, day - back)).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The configured bots as the status page names them, and whether each is
 * online now: matched to the health document like /api/bots (client ID, then
 * slot). Without a fresh document every bot counts as offline.
 */
export function statusBotsNow(configuredBots = [], liveDoc = null, commander = 1) {
  const nodes = Array.isArray(liveDoc?.nodes) ? liveDoc.nodes : [];
  const byId = new Map(nodes.filter((node) => node?.botId).map((node) => [String(node.botId), node]));
  const byIndex = new Map(nodes.filter((node) => intOf(node?.index) > 0).map((node) => [intOf(node.index), node]));
  return configuredBots.map((bot) => {
    const index = intOf(bot?.index);
    const node = byId.get(String(bot?.clientId || "")) || byIndex.get(index);
    return {
      key: `bot-${index}`,
      name: String(bot?.name || `OmniFM Bot ${index}`).slice(0, 80),
      role: index === commander ? "commander" : "worker",
      tier: String(bot?.requiredTier || "free"),
      online: node?.status === "online",
    };
  });
}

/**
 * An owner's notice as it is stored, merged over the stored one for a change;
 * { error } in plain German when something is missing. `resolved: true` ends
 * an incident (or a maintenance early), `resolved: false` opens it again.
 */
export function normalizeStatusNotice(input, { now = Date.now(), previous = null } = {}) {
  const patch = input && typeof input === "object" ? input : {};
  const merged = { ...(previous || {}), ...patch };
  const kind = String(merged.kind || "");
  if (!STATUS_NOTICE_KINDS.includes(kind)) return { error: "Bitte Störung oder Wartung wählen." };
  const title = String(merged.title ?? "").trim().slice(0, 120);
  if (!title) return { error: "Der Titel fehlt." };
  const message = String(merged.message ?? "").trim().slice(0, 2000);
  let startsAt = dateOf(merged.startsAt);
  let endsAt = dateOf(merged.endsAt);
  if (kind === "incident") {
    startsAt = startsAt || new Date(now);
    endsAt = null;
  } else {
    if (!startsAt || !endsAt) return { error: "Eine Wartung braucht Beginn und Ende." };
    if (endsAt <= startsAt) return { error: "Das Ende der Wartung liegt vor ihrem Beginn." };
  }
  let resolvedAt = dateOf(merged.resolvedAt);
  if (patch.resolved === true && !resolvedAt) resolvedAt = new Date(now);
  if (patch.resolved === false) resolvedAt = null;
  const over = resolvedAt || endsAt;
  return {
    notice: {
      kind,
      title,
      message,
      impact: kind === "incident" ? (STATUS_IMPACTS.includes(merged.impact) ? merged.impact : "minor") : "maintenance",
      startsAt,
      endsAt,
      resolvedAt,
      expiresAt: over ? new Date(over.getTime() + STATUS_KEEP_MS) : null,
    },
  };
}

function botDays(bot, days, minutes) {
  let online = 0;
  let total = 0;
  const daily = days.map((day) => {
    const doc = minutes.get(`${day}|${bot.key}`);
    const dayTotal = Math.max(0, intOf(doc?.total));
    const dayOnline = Math.min(dayTotal, Math.max(0, intOf(doc?.online)));
    online += dayOnline;
    total += dayTotal;
    return { day, uptime: percent(dayOnline, dayTotal), measured: dayTotal, down: dayTotal - dayOnline };
  });
  return { daily, uptime: percent(online, total) };
}

/**
 * GET /api/status. uptimeDocs: { day, bot, online, total } minutes per bot
 * and day; outages: { bot, name, startedAt, endedAt }; notices: the owner's
 * incidents and maintenance windows. measuring: false without a database.
 */
export function buildStatusResponse({
  bots = [],
  uptimeDocs = [],
  outages = [],
  notices = [],
  now = Date.now(),
  timeZone = STATUS_TIME_ZONE,
  measuring = true,
} = {}) {
  const days = lastStatusDays(now, STATUS_DAYS, timeZone);
  const minutes = new Map(uptimeDocs.map((doc) => [`${doc.day}|${doc.bot}`, doc]));
  const openOutages = new Map(outages.filter((outage) => !outage.endedAt).map((outage) => [String(outage.bot), outage]));

  const statusBots = bots.map((bot) => {
    const { daily, uptime } = botDays(bot, days, minutes);
    const outage = openOutages.get(bot.key);
    return {
      key: bot.key,
      name: bot.name,
      role: bot.role,
      tier: bot.tier,
      online: bot.online === true,
      offlineSince: !bot.online && outage ? isoOf(outage.startedAt) : null,
      uptime,
      days: daily,
    };
  });

  const current = [];
  for (const bot of statusBots) {
    const since = msOf(bot.offlineSince);
    if (!bot.online && since !== null && now - since >= OUTAGE_GRACE_MS) {
      current.push({ type: "outage", bot: bot.name, since: bot.offlineSince });
    }
  }
  const maintenance = [];
  const history = [];
  const historyFrom = now - HISTORY_DAYS * DAY_MS;
  for (const notice of notices) {
    const base = { id: String(notice._id ?? notice.id ?? ""), title: String(notice.title || ""), message: String(notice.message || "") };
    const startsAt = msOf(notice.startsAt);
    const endsAt = msOf(notice.endsAt);
    const resolvedAt = msOf(notice.resolvedAt);
    if (startsAt === null) continue;
    if (notice.kind === "incident") {
      const impact = STATUS_IMPACTS.includes(notice.impact) ? notice.impact : "minor";
      if (resolvedAt === null) {
        current.push({ type: "incident", ...base, impact, since: isoOf(startsAt), updatedAt: isoOf(notice.updatedAt) });
      } else if (resolvedAt >= historyFrom) {
        history.push({ type: "incident", ...base, impact, startedAt: isoOf(startsAt), endedAt: isoOf(resolvedAt) });
      }
      continue;
    }
    if (notice.kind !== "maintenance" || endsAt === null) continue;
    const over = resolvedAt ?? endsAt;
    if (over > now) {
      maintenance.push({ ...base, startsAt: isoOf(startsAt), endsAt: isoOf(endsAt), active: startsAt <= now });
    } else if (over >= historyFrom && startsAt <= over) {
      history.push({ type: "maintenance", ...base, startedAt: isoOf(startsAt), endedAt: isoOf(over) });
    }
  }
  const names = new Map(statusBots.map((bot) => [bot.key, bot.name]));
  for (const outage of outages) {
    const startedAt = msOf(outage.startedAt);
    const endedAt = msOf(outage.endedAt);
    if (startedAt === null || endedAt === null || endedAt < historyFrom) continue;
    if (endedAt - startedAt < HISTORY_MIN_OUTAGE_MS) continue;
    history.push({
      type: "outage",
      bot: names.get(String(outage.bot)) || String(outage.name || outage.bot),
      startedAt: isoOf(startedAt),
      endedAt: isoOf(endedAt),
    });
  }
  maintenance.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  history.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const outagesNow = current.filter((entry) => entry.type === "outage").length;
  const incidentImpact = (impact) => current.some((entry) => entry.type === "incident" && entry.impact === impact);
  let overall = "operational";
  if (!measuring) overall = "unknown";
  else if (incidentImpact("major")) overall = "major";
  else if (maintenance.some((entry) => entry.active)) overall = "maintenance";
  else if (statusBots.length && outagesNow === statusBots.length) overall = "major";
  else if (outagesNow || incidentImpact("minor")) overall = "minor";

  return {
    generatedAt: new Date(now).toISOString(),
    timeZone,
    measuring,
    overall,
    bots: statusBots,
    current,
    maintenance,
    history: history.slice(0, HISTORY_MAX),
  };
}
