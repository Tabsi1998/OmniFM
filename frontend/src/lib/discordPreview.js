// Discord's message JSON as plain parts for the dashboard preview (#281).
// Only what the OmniFM panel uses: headings, small text (-#), quotes, bold,
// links, custom emojis, channel mentions and timestamps. Everything else
// stays plain text; nothing becomes HTML.

const TOKEN = /(<a?:[A-Za-z0-9_]{2,32}:\d{17,22}>|<#\d{17,22}>|<t:\d{1,12}(?::[tTdDfFR])?>|\*\*[^*]+\*\*|\[[^\]]{1,200}\]\(https?:\/\/[^)\s]{1,500}\))/;

/** "<:name:id>" → { name, id, animated } or null. */
function parseEmoji(token) {
  const match = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,22})>$/.exec(token);
  return match ? { name: match[2], id: match[3], animated: match[1] === 'a' } : null;
}

export function emojiImageUrl(id, animated = false) {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=48`;
}

/** One line of text as parts: text, bold, link, emoji, channel, time. */
export function parseDiscordInline(text) {
  const parts = [];
  for (const piece of String(text || '').split(TOKEN)) {
    if (!piece) continue;
    const emoji = parseEmoji(piece);
    if (emoji) {
      parts.push({ type: 'emoji', ...emoji });
    } else if (/^<#\d+>$/.test(piece)) {
      parts.push({ type: 'channel', text: '#radio' });
    } else if (/^<t:\d+/.test(piece)) {
      const seconds = Number(/^<t:(\d+)/.exec(piece)[1]);
      parts.push({ type: 'time', seconds });
    } else if (/^\*\*[^*]+\*\*$/.test(piece)) {
      parts.push({ type: 'bold', text: piece.slice(2, -2) });
    } else if (/^\[[^\]]+\]\(https?:\/\//.test(piece)) {
      const match = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(piece);
      parts.push(match ? { type: 'link', text: match[1], url: match[2] } : { type: 'text', text: piece });
    } else {
      parts.push({ type: 'text', text: piece });
    }
  }
  return parts;
}

/** A text block as lines: { kind: h1|h2|h3|subtext|quote|text, parts }. */
export function parseDiscordMarkdown(content) {
  return String(content || '').split('\n').map((line) => {
    const rules = [[/^### /, 'h3'], [/^## /, 'h2'], [/^# /, 'h1'], [/^-# /, 'subtext'], [/^> /, 'quote']];
    for (const [pattern, kind] of rules) {
      if (pattern.test(line)) return { kind, parts: parseDiscordInline(line.replace(pattern, '')) };
    }
    return { kind: 'text', parts: parseDiscordInline(line) };
  });
}

/** #RRGGBB of Discord's accent_color number, or null. */
export function accentHex(value) {
  return Number.isInteger(value) && value >= 0 ? `#${value.toString(16).padStart(6, '0')}` : null;
}

/** Discord's button colours by style: 1 primary, 2 secondary, 3 success, 4 danger, 5 link. */
export const BUTTON_STYLE_COLORS = Object.freeze({
  1: { background: '#5865F2', color: '#fff' },
  2: { background: '#4E5058', color: '#fff' },
  3: { background: '#248046', color: '#fff' },
  4: { background: '#DA373C', color: '#fff' },
  5: { background: '#4E5058', color: '#fff' },
});

/** Every button id of a payload, for tests: what the preview shows. */
export function listButtons(payload) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 2) out.push(node.custom_id || node.url || node.label || '');
    for (const child of node.components || []) walk(child);
    if (node.accessory) walk(node.accessory);
  };
  for (const component of payload?.components || []) walk(component);
  return out;
}
