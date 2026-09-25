// ============================================================
// OmniFM: the text in the voice channel status, as a template (#277)
// ============================================================
// One module for the bot and the dashboard preview (the frontend imports
// this file), so the preview shows exactly what the bot sets.
//
// Placeholders: {station} {title} {artist} {listeners} {emoji} {bot}.
// A part in [square brackets] only shows when every placeholder in it has a
// value: "{station}[ · {listeners} hören]". Empty placeholders elsewhere
// disappear together with the separator next to them.

export const VOICE_STATUS_PLACEHOLDERS = Object.freeze(["station", "title", "artist", "listeners", "emoji", "bot"]);
export const VOICE_STATUS_DEFAULT_TEMPLATE = "🔊 | 24/7 {station}";
export const VOICE_STATUS_TEMPLATE_MAX_LENGTH = 120;
export const VOICE_STATUS_TEXT_MAX_LENGTH = 100;

const PLACEHOLDER_RE = /\{([a-z]+)\}/gi;
// Separators between parts; only standing alone (spaces around), so "Jay-Z" and "24/7" stay.
const SEPARATOR = "(?:\\||·|•|-|–|—|:)";
const DOUBLE_SEPARATOR_RE = new RegExp(`(\\s${SEPARATOR})(?:\\s+${SEPARATOR})+(?=\\s|$)`, "g");
const EDGE_SEPARATOR_RE = new RegExp(`^(?:\\s*${SEPARATOR}(?=\\s|$))+|(?:(?:^|\\s)${SEPARATOR}\\s*)+$`, "g");

/** @type {Array<[RegExp, string]>} */
const GENRE_EMOJIS = [
  [/ambient|chill|lounge|lo-?fi|sleep|downtempo/i, "🌙"],
  [/hardstyle|hardcore/i, "🔥"],
  [/techno|house|trance|edm|festival|electro|synth|dance|drum/i, "🎛️"],
  [/hip ?hop|rap|r&b/i, "🎤"],
  [/metal|rock|punk|indie|alternative/i, "🎸"],
  [/jazz|blues|soul|funk/i, "🎷"],
  [/classic|klassik/i, "🎻"],
  [/reggae|dancehall|dub|ska/i, "🌴"],
  [/latin|salsa|samba/i, "💃"],
  [/schlager|party/i, "🎉"],
  [/world/i, "🌍"],
  [/news|talk|nachrichten/i, "🗞️"],
  [/pop|charts|hits/i, "🎵"],
];

/** An emoji for a station's genre; 📻 when nothing fits. */
export function emojiForGenre(genre) {
  const text = String(genre || "");
  for (const [pattern, emoji] of GENRE_EMOJIS) {
    if (pattern.test(text)) return emoji;
  }
  return "📻";
}

function clip(value, max) {
  const chars = Array.from(String(value ?? ""));
  return chars.length <= max ? chars.join("") : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** Whether a template shows the song or the listeners, so it changes while a station plays. */
export function voiceStatusTemplateIsLive(template) {
  return /\{(title|artist|listeners)\}/i.test(String(template || ""));
}

/** The template as stored: one line, trimmed, limited; empty means "the default". */
export function normalizeVoiceStatusTemplate(raw) {
  const text = String(raw ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return text ? clip(text, VOICE_STATUS_TEMPLATE_MAX_LENGTH) : "";
}

/** { ok, template, unknown } - unknown placeholders are refused, with their names. */
export function validateVoiceStatusTemplate(raw) {
  const template = normalizeVoiceStatusTemplate(raw);
  const unknown = [];
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const name = match[1].toLowerCase();
    if (!VOICE_STATUS_PLACEHOLDERS.includes(name) && !unknown.includes(name)) unknown.push(name);
  }
  return { ok: unknown.length === 0, template, unknown };
}

function valueMap(values = {}) {
  const listeners = Number.parseInt(String(values.listeners ?? ""), 10);
  return {
    station: clip(String(values.station || "").trim(), 60),
    title: clip(String(values.title || "").trim(), 60),
    artist: clip(String(values.artist || "").trim(), 40),
    listeners: Number.isFinite(listeners) && listeners > 0 ? String(listeners) : "",
    emoji: String(values.emoji || "").trim() || emojiForGenre(values.genre),
    bot: clip(String(values.bot || "").trim(), 24),
  };
}

// Unknown placeholders count as empty; the dashboard refuses them anyway.
function fill(text, map) {
  return text.replace(PLACEHOLDER_RE, (whole, name) => {
    const key = name.toLowerCase();
    return Object.hasOwn(map, key) ? map[key] : "";
  });
}

function renderOnce(source, map) {
  // Optional parts: shown only when all their placeholders have a value.
  const withGroups = source.replace(/\[([^\]]*)\]/g, (whole, inner) => {
    const names = [...inner.matchAll(PLACEHOLDER_RE)].map((match) => match[1].toLowerCase());
    return names.every((name) => map[name]) ? inner : "";
  });
  return fill(withGroups, map)
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(DOUBLE_SEPARATOR_RE, "$1")
    .replace(EDGE_SEPARATOR_RE, "")
    .replace(/\s*:\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The status text for a template and the current values
 * { station, title, artist, listeners, emoji, genre, bot }.
 */
export function renderVoiceStatusTemplate(template, values = {}, {
  maxLength = VOICE_STATUS_TEXT_MAX_LENGTH,
  fallbackTemplate = VOICE_STATUS_DEFAULT_TEMPLATE,
} = {}) {
  const map = valueMap(values);
  const fallback = normalizeVoiceStatusTemplate(fallbackTemplate) || VOICE_STATUS_DEFAULT_TEMPLATE;
  // Nothing left (a title-only template between two songs): the default instead of no status.
  const text = renderOnce(normalizeVoiceStatusTemplate(template) || fallback, map)
    || renderOnce(fallback, map)
    || renderOnce(VOICE_STATUS_DEFAULT_TEMPLATE, map);
  return clip(text, Math.max(1, Math.min(VOICE_STATUS_TEXT_MAX_LENGTH, Number(maxLength) || VOICE_STATUS_TEXT_MAX_LENGTH)));
}
