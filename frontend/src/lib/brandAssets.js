// Shared OmniFM brand asset catalog (files live in /public/brand).
// Primary brand is a true vector (SVG) with transparent PNG exports so
// partners can place the mark on any background (dark or light).
export const BRAND_ASSETS = [
  // — Logo (nur das Zeichen: Unendlichkeit + Schallwelle) —
  { slug: 'mark-svg', label: 'Logo — Vektor (SVG)', desc: 'Skalierbar, transparent. Beste Qualität für alles.', file: '/brand/omnifm-mark.svg', bg: 'dark', use: 'Print · App · Vektor' },
  { slug: 'mark-color', label: 'Logo — Farbig (transparent)', desc: 'Hauptlogo als transparentes PNG.', file: '/brand/omnifm-mark-transparent.png', bg: 'dark', use: 'überall' },
  { slug: 'mark-white', label: 'Logo — Weiß (transparent)', desc: 'Einfarbig weiß für dunkle Flächen.', file: '/brand/omnifm-mark-white.png', bg: 'dark', use: 'dunkle Hintergründe' },
  { slug: 'mark-black', label: 'Logo — Dunkel (transparent)', desc: 'Einfarbig dunkel für helle Flächen.', file: '/brand/omnifm-mark-black.png', bg: 'light', use: 'helle Hintergründe' },
  { slug: 'mark-on-dark', label: 'Logo-Kachel — Dunkel', desc: 'Logo auf Obsidian-Kachel.', file: '/brand/omnifm-mark-on-dark.png', bg: 'dark', use: 'App-Icon dunkel' },
  { slug: 'mark-on-light', label: 'Logo-Kachel — Hell', desc: 'Logo auf heller Kachel.', file: '/brand/omnifm-mark-on-light.png', bg: 'light', use: 'App-Icon hell' },
  { slug: 'discord-avatar', label: 'Discord Avatar', desc: 'Rundes Profilbild für den Bot.', file: '/brand/omnifm-discord-avatar.png', bg: 'discord', use: 'Discord-Profil' },
  { slug: 'favicon', label: 'Favicon', desc: 'Kompaktes Logo für kleine Größen.', file: '/brand/omnifm-favicon.png', bg: 'dark', use: 'Favicon' },
  // — Wortmarke (Logo + „omnifm") —
  { slug: 'wordmark-dark', label: 'Wortmarke — Dunkel (transparent)', desc: 'Logo + „omnifm", helle Schrift.', file: '/brand/omnifm-wordmark-dark.png', bg: 'dark', use: 'dunkle Header' },
  { slug: 'wordmark-light', label: 'Wortmarke — Hell (transparent)', desc: 'Logo + „omnifm", dunkle Schrift.', file: '/brand/omnifm-wordmark-light.png', bg: 'light', use: 'helle Header' },
  { slug: 'wordmark-on-dark', label: 'Wortmarke-Kachel — Dunkel', desc: 'Wortmarke auf Obsidian-Panel.', file: '/brand/omnifm-wordmark-on-dark.png', bg: 'dark', use: 'Karten, Slides' },
  { slug: 'wordmark-on-light', label: 'Wortmarke-Kachel — Hell', desc: 'Wortmarke auf hellem Panel.', file: '/brand/omnifm-wordmark-on-light.png', bg: 'light', use: 'Dokumente' },
  // — Banner —
  { slug: 'banner-dark', label: 'Banner — Dunkel', desc: 'Hero-Banner mit Tagline (Obsidian).', file: '/brand/omnifm-banner.png', bg: 'dark', use: 'Social, OG-Image' },
  { slug: 'banner-light', label: 'Banner — Hell', desc: 'Hero-Banner auf hellem Grund.', file: '/brand/omnifm-banner-light.png', bg: 'light', use: 'helle Seiten' },
  { slug: 'banner-transparent', label: 'Banner — Transparent', desc: 'Banner ohne Hintergrund.', file: '/brand/omnifm-banner-transparent.png', bg: 'dark', use: 'Overlays' },
  // — Sponsor —
  { slug: 'sponsor-badge', label: 'Sponsor-Badge', desc: '„Powered by omnifm" zum Verlinken.', file: '/brand/omnifm-sponsor-badge.png', bg: 'dark', use: 'Sponsoren-Links' },
];

export const BRAND_PALETTE = [
  { name: 'Obsidian', hex: '#08090d' },
  { name: 'Surface', hex: '#0e111a' },
  { name: 'Signal Orange', hex: '#ff6b00' },
  { name: 'Live Red', hex: '#ff2a5f' },
  { name: 'Cyber Cyan', hex: '#00e5ff' },
  { name: 'Text', hex: '#f3f4f8' },
  { name: 'Muted', hex: '#94a3b8' },
];

export const BRAND_FONTS = [
  { name: 'Syne', role: 'Display / Headlines', weight: '700–800' },
  { name: 'DM Sans', role: 'Body / UI', weight: '400–600' },
  { name: 'JetBrains Mono', role: 'Code / Labels', weight: '400–700' },
];

export function siteOrigin() {
  if (typeof window !== 'undefined' && window.location) return window.location.origin;
  return 'https://omnifm.app';
}

export function sponsorEmbedHtml(origin = siteOrigin()) {
  return `<a href="${origin}" target="_blank" rel="noopener">\n  <img src="${origin}/brand/omnifm-sponsor-badge.png" alt="Powered by OmniFM" height="44" />\n</a>`;
}

export function sponsorEmbedMarkdown(origin = siteOrigin()) {
  return `[![Powered by OmniFM](${origin}/brand/omnifm-sponsor-badge.png)](${origin})`;
}
