// ============================================================
// OmniFM: problems, ideas and feedback from Discord (#436)
// ============================================================
// A report goes to a private team channel in OmniFM's own Discord server
// first. It becomes public in a forum only after the team clicks for it AND
// the reporter allowed it, and then without server and name. Without a team
// channel nothing is posted anywhere; the report stays an incident in the
// owner console, as before. The rules here have no imports; the store is
// src/problem-reports-store.js, the posting src/services/problem-reports.js.

export const REPORT_KINDS = Object.freeze(["problem", "idea", "feedback"]);
export const REPORT_TEXT_MIN = 5;
export const REPORT_TEXT_MAX = 1500;
// One report per person and five minutes; more would only be noise.
export const REPORT_COOLDOWN_MS = 5 * 60_000;
// The team decides with one click; "new" until then (#437: "in-progress" in between).
export const REPORT_DECISIONS = Object.freeze(["in-progress", "done", "rejected", "duplicate"]);
export const REPORT_STATUSES = Object.freeze(["new", ...REPORT_DECISIONS]);
// The forum tag of each status, found by its name in each forum; the owner can rename them.
export const DEFAULT_REPORT_TAGS = Object.freeze({ new: "Neu", "in-progress": "In Arbeit", done: "Erledigt", rejected: "Abgelehnt", duplicate: "Doppelt" });
// The two voluntary ticks in the form.
export const REPORT_OPTION_PUBLIC = "public";
export const REPORT_OPTION_NOTIFY = "notify";
// Where a report comes from.
export const REPORT_SOURCES = Object.freeze(["command", "panel", "dashboard"]);

const SNOWFLAKE = /^\d{17,22}$/;
const snowflake = (value) => {
  const text = String(value ?? "").trim();
  return SNOWFLAKE.test(text) ? text : "";
};

/**
 * The owner's settings (owner_config.reports): the private team channel, one
 * forum per kind and the names of the status tags in the forums. Anything
 * that is no channel ID is dropped; a tag name has at most 20 characters,
 * like in Discord, and an empty one means "no tag".
 * @param {any} raw
 */
export function normalizeReportSettings(raw = {}) {
  const forums = raw?.forums && typeof raw.forums === "object" ? raw.forums : {};
  const tags = raw?.tags && typeof raw.tags === "object" ? raw.tags : {};
  return {
    teamChannelId: snowflake(raw?.teamChannelId),
    forums: Object.fromEntries(REPORT_KINDS.map((kind) => [kind, snowflake(forums[kind])])),
    tags: Object.fromEntries(REPORT_STATUSES.map((status) => [
      status,
      String(tags[status] ?? DEFAULT_REPORT_TAGS[status]).trim().slice(0, 20),
    ])),
  };
}

/** The ID of a status's tag in one forum, by name (without regard to case); "" when the forum has none. */
export function forumTagFor(availableTags = [], name = "") {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return "";
  const tag = (Array.isArray(availableTags) ? availableTags : []).find((entry) => String(entry?.name || "").trim().toLowerCase() === wanted);
  return tag?.id ? String(tag.id) : "";
}

/** Reports reach Discord only with a team channel; without one they stay incidents in the owner console. */
export function reportsConfigured(raw) {
  return Boolean(normalizeReportSettings(raw).teamChannelId);
}

export function isReportKind(kind) {
  return REPORT_KINDS.includes(kind);
}

/** The form's text: line breaks kept, runs of blanks folded, at most REPORT_TEXT_MAX characters. */
export function cleanReportText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, REPORT_TEXT_MAX);
}

/** The two ticks of the form: may it stand in the public forum, and does the reporter want to hear back. */
export function readConsents(values = []) {
  const chosen = new Set(Array.isArray(values) ? values.map(String) : []);
  return { public: chosen.has(REPORT_OPTION_PUBLIC), notify: chosen.has(REPORT_OPTION_NOTIFY) };
}

/**
 * What a public forum post may show: the text, the station and the plan.
 * Never the server, its ID, the bot or anybody's name.
 */
export function publicReportView(report = {}) {
  return {
    kind: isReportKind(report.kind) ? report.kind : "problem",
    text: cleanReportText(report.text),
    station: String(report.station?.name || "").slice(0, 100),
    plan: String(report.plan || ""),
  };
}

/** A forum post's title: the first line of the text, shortened; Discord allows 100 characters. */
export function reportThreadName(report = {}, fallback = "Report") {
  const firstLine = cleanReportText(report.text).split("\n")[0].trim();
  const title = firstLine.length > 90 ? `${firstLine.slice(0, 89).trimEnd()}…` : firstLine;
  return title || fallback;
}
