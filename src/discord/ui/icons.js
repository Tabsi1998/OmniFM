// ============================================================
// OmniFM Discord design system: icons (#264, #265)
// ============================================================
// Every icon has a logical name. Once the OmniFM app emojis are synced
// (#265), an app's own emoji is used; until then, and for any app without
// it, the Unicode emoji stands in. App emojis belong to one application:
// each worker bot is its own application, so the lookup takes its id.

const FALLBACK = Object.freeze({
  play: "▶️",
  pause: "⏸️",
  stop: "⏹️",
  next: "⏭️",
  live: "🔴",
  equalizer: "🎶",
  radio: "📻",
  listeners: "🎧",
  quality: "🎚️",
  save: "💾",
  history: "📜",
  settings: "⚙️",
  premium: "👑",
  dashboard: "🖥️",
  help: "❓",
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "⛔",
  link: "🔗",
});

export const ICON_NAMES = Object.freeze(Object.keys(FALLBACK));

// applicationId -> Map(logical name -> { id, name, animated })
const appEmojis = new Map();

/** Registers the synced app emojis of one application (#265). */
export function registerAppEmojis(applicationId, emojis = []) {
  const map = new Map();
  for (const emoji of emojis) {
    if (emoji?.logicalName && emoji?.id && emoji?.name) {
      map.set(emoji.logicalName, { id: String(emoji.id), name: String(emoji.name), animated: emoji.animated === true });
    }
  }
  appEmojis.set(String(applicationId || ""), map);
  return map.size;
}

export function clearAppEmojis() {
  appEmojis.clear();
}

function appEmoji(name, applicationId) {
  return appEmojis.get(String(applicationId || ""))?.get(name) || null;
}

/** Icon for message text: "<:omnifm_play:123>" or the Unicode fallback. */
export function icon(name, applicationId = null) {
  const emoji = appEmoji(name, applicationId);
  if (emoji) return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
  return FALLBACK[name] || "";
}

/** Icon for ButtonBuilder#setEmoji and select options. */
export function componentEmoji(name, applicationId = null) {
  const emoji = appEmoji(name, applicationId);
  if (emoji) return { id: emoji.id, name: emoji.name, animated: emoji.animated };
  return FALLBACK[name] ? { name: FALLBACK[name] } : undefined;
}
