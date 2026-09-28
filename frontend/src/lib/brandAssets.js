// Shared OmniFM brand asset catalog (files live in /public/brand).
// Primary brand is a true vector (SVG) with transparent PNG exports so
// partners can place the mark on any background (dark or light).
export const BRAND_ASSETS = [
  // — Logo (nur das Zeichen: Unendlichkeit + Schallwelle) —
  { slug: 'mark-svg', label: { de: 'Logo — Vektor (SVG)', en: 'Logo — Vector (SVG)' }, desc: { de: 'Skalierbar, transparent. Beste Qualität für alles.', en: 'Scalable, transparent. Best quality for anything.' }, file: '/brand/omnifm-mark.svg', bg: 'dark', use: { de: 'Print · App · Vektor', en: 'Print · App · Vector' } },
  { slug: 'mark-color', label: { de: 'Logo — Farbig (transparent)', en: 'Logo — Colour (transparent)' }, desc: { de: 'Hauptlogo als transparentes PNG.', en: 'Primary logo as a transparent PNG.' }, file: '/brand/omnifm-mark-transparent.png', bg: 'dark', use: { de: 'überall', en: 'anywhere' } },
  { slug: 'mark-white', label: { de: 'Logo — Weiß (transparent)', en: 'Logo — White (transparent)' }, desc: { de: 'Einfarbig weiß für dunkle Flächen.', en: 'Solid white for dark surfaces.' }, file: '/brand/omnifm-mark-white.png', bg: 'dark', use: { de: 'dunkle Hintergründe', en: 'dark backgrounds' } },
  { slug: 'mark-black', label: { de: 'Logo — Dunkel (transparent)', en: 'Logo — Dark (transparent)' }, desc: { de: 'Einfarbig dunkel für helle Flächen.', en: 'Solid dark for light surfaces.' }, file: '/brand/omnifm-mark-black.png', bg: 'light', use: { de: 'helle Hintergründe', en: 'light backgrounds' } },
  { slug: 'mark-on-dark', label: { de: 'Logo-Kachel — Dunkel', en: 'Logo tile — Dark' }, desc: { de: 'Logo auf Obsidian-Kachel.', en: 'Logo on an obsidian tile.' }, file: '/brand/omnifm-mark-on-dark.png', bg: 'dark', use: { de: 'App-Icon dunkel', en: 'App icon dark' } },
  { slug: 'mark-on-light', label: { de: 'Logo-Kachel — Hell', en: 'Logo tile — Light' }, desc: { de: 'Logo auf heller Kachel.', en: 'Logo on a light tile.' }, file: '/brand/omnifm-mark-on-light.png', bg: 'light', use: { de: 'App-Icon hell', en: 'App icon light' } },
  { slug: 'discord-avatar', label: { de: 'Discord Avatar', en: 'Discord avatar' }, desc: { de: 'Rundes Profilbild für den Bot.', en: 'Round profile picture for the bot.' }, file: '/brand/omnifm-discord-avatar.png', bg: 'discord', use: { de: 'Discord-Profil', en: 'Discord profile' } },
  { slug: 'favicon', label: { de: 'Favicon', en: 'Favicon' }, desc: { de: 'Kompaktes Logo für kleine Größen.', en: 'Compact logo for small sizes.' }, file: '/brand/omnifm-favicon.png', bg: 'dark', use: { de: 'Favicon', en: 'Favicon' } },
  // — Wortmarke (Logo + „omnifm") —
  { slug: 'wordmark-dark', label: { de: 'Wortmarke — Dunkel (transparent)', en: 'Wordmark — Dark (transparent)' }, desc: { de: 'Logo + „omnifm", helle Schrift.', en: 'Logo + “omnifm”, light type.' }, file: '/brand/omnifm-wordmark-dark.png', bg: 'dark', use: { de: 'dunkle Header', en: 'dark headers' } },
  { slug: 'wordmark-light', label: { de: 'Wortmarke — Hell (transparent)', en: 'Wordmark — Light (transparent)' }, desc: { de: 'Logo + „omnifm", dunkle Schrift.', en: 'Logo + “omnifm”, dark type.' }, file: '/brand/omnifm-wordmark-light.png', bg: 'light', use: { de: 'helle Header', en: 'light headers' } },
  { slug: 'wordmark-on-dark', label: { de: 'Wortmarke-Kachel — Dunkel', en: 'Wordmark tile — Dark' }, desc: { de: 'Wortmarke auf Obsidian-Panel.', en: 'Wordmark on an obsidian panel.' }, file: '/brand/omnifm-wordmark-on-dark.png', bg: 'dark', use: { de: 'Karten, Slides', en: 'Cards, slides' } },
  { slug: 'wordmark-on-light', label: { de: 'Wortmarke-Kachel — Hell', en: 'Wordmark tile — Light' }, desc: { de: 'Wortmarke auf hellem Panel.', en: 'Wordmark on a light panel.' }, file: '/brand/omnifm-wordmark-on-light.png', bg: 'light', use: { de: 'Dokumente', en: 'Documents' } },
  // — Banner —
  { slug: 'banner-dark', label: { de: 'Banner — Dunkel', en: 'Banner — Dark' }, desc: { de: 'Hero-Banner mit Tagline (Obsidian).', en: 'Hero banner with tagline (obsidian).' }, file: '/brand/omnifm-banner.png', bg: 'dark', use: { de: 'Social, OG-Image', en: 'Social, OG image' } },
  { slug: 'banner-light', label: { de: 'Banner — Hell', en: 'Banner — Light' }, desc: { de: 'Hero-Banner auf hellem Grund.', en: 'Hero banner on a light ground.' }, file: '/brand/omnifm-banner-light.png', bg: 'light', use: { de: 'helle Seiten', en: 'light pages' } },
  { slug: 'banner-transparent', label: { de: 'Banner — Transparent', en: 'Banner — Transparent' }, desc: { de: 'Banner ohne Hintergrund.', en: 'Banner without a background.' }, file: '/brand/omnifm-banner-transparent.png', bg: 'dark', use: { de: 'Overlays', en: 'Overlays' } },
  // — Sponsor —
  { slug: 'sponsor-badge', label: { de: 'Sponsor-Badge', en: 'Sponsor badge' }, desc: { de: '„Powered by omnifm" zum Verlinken.', en: '“Powered by omnifm” for linking.' }, file: '/brand/omnifm-sponsor-badge.png', bg: 'dark', use: { de: 'Sponsoren-Links', en: 'Sponsor links' } },
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
