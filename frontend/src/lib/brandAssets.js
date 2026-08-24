// Shared OmniFM brand asset catalog (files live in /public/brand).
// Primary brand is a true vector (SVG) with transparent PNG exports so
// partners can place the mark on any background (dark or light).
export const BRAND_ASSETS = [
  // — Logo (nur das Zeichen: Unendlichkeit + Schallwelle) —
  { slug: 'mark-svg', label: 'Logo — Vektor (SVG)', labelEn: 'Logo — Vector (SVG)', desc: 'Skalierbar, transparent. Beste Qualität für alles.', descEn: 'Scalable, transparent. Best quality for anything.', file: '/brand/omnifm-mark.svg', bg: 'dark', use: 'Print · App · Vektor', useEn: 'Print · App · Vector' },
  { slug: 'mark-color', label: 'Logo — Farbig (transparent)', labelEn: 'Logo — Colour (transparent)', desc: 'Hauptlogo als transparentes PNG.', descEn: 'Primary logo as a transparent PNG.', file: '/brand/omnifm-mark-transparent.png', bg: 'dark', use: 'überall', useEn: 'anywhere' },
  { slug: 'mark-white', label: 'Logo — Weiß (transparent)', labelEn: 'Logo — White (transparent)', desc: 'Einfarbig weiß für dunkle Flächen.', descEn: 'Solid white for dark surfaces.', file: '/brand/omnifm-mark-white.png', bg: 'dark', use: 'dunkle Hintergründe', useEn: 'dark backgrounds' },
  { slug: 'mark-black', label: 'Logo — Dunkel (transparent)', labelEn: 'Logo — Dark (transparent)', desc: 'Einfarbig dunkel für helle Flächen.', descEn: 'Solid dark for light surfaces.', file: '/brand/omnifm-mark-black.png', bg: 'light', use: 'helle Hintergründe', useEn: 'light backgrounds' },
  { slug: 'mark-on-dark', label: 'Logo-Kachel — Dunkel', labelEn: 'Logo tile — Dark', desc: 'Logo auf Obsidian-Kachel.', descEn: 'Logo on an obsidian tile.', file: '/brand/omnifm-mark-on-dark.png', bg: 'dark', use: 'App-Icon dunkel', useEn: 'App icon dark' },
  { slug: 'mark-on-light', label: 'Logo-Kachel — Hell', labelEn: 'Logo tile — Light', desc: 'Logo auf heller Kachel.', descEn: 'Logo on a light tile.', file: '/brand/omnifm-mark-on-light.png', bg: 'light', use: 'App-Icon hell', useEn: 'App icon light' },
  { slug: 'discord-avatar', label: 'Discord Avatar', labelEn: 'Discord avatar', desc: 'Rundes Profilbild für den Bot.', descEn: 'Round profile picture for the bot.', file: '/brand/omnifm-discord-avatar.png', bg: 'discord', use: 'Discord-Profil', useEn: 'Discord profile' },
  { slug: 'favicon', label: 'Favicon', labelEn: 'Favicon', desc: 'Kompaktes Logo für kleine Größen.', descEn: 'Compact logo for small sizes.', file: '/brand/omnifm-favicon.png', bg: 'dark', use: 'Favicon', useEn: 'Favicon' },
  // — Wortmarke (Logo + „omnifm") —
  { slug: 'wordmark-dark', label: 'Wortmarke — Dunkel (transparent)', labelEn: 'Wordmark — Dark (transparent)', desc: 'Logo + „omnifm", helle Schrift.', descEn: 'Logo + “omnifm”, light type.', file: '/brand/omnifm-wordmark-dark.png', bg: 'dark', use: 'dunkle Header', useEn: 'dark headers' },
  { slug: 'wordmark-light', label: 'Wortmarke — Hell (transparent)', labelEn: 'Wordmark — Light (transparent)', desc: 'Logo + „omnifm", dunkle Schrift.', descEn: 'Logo + “omnifm”, dark type.', file: '/brand/omnifm-wordmark-light.png', bg: 'light', use: 'helle Header', useEn: 'light headers' },
  { slug: 'wordmark-on-dark', label: 'Wortmarke-Kachel — Dunkel', labelEn: 'Wordmark tile — Dark', desc: 'Wortmarke auf Obsidian-Panel.', descEn: 'Wordmark on an obsidian panel.', file: '/brand/omnifm-wordmark-on-dark.png', bg: 'dark', use: 'Karten, Slides', useEn: 'Cards, slides' },
  { slug: 'wordmark-on-light', label: 'Wortmarke-Kachel — Hell', labelEn: 'Wordmark tile — Light', desc: 'Wortmarke auf hellem Panel.', descEn: 'Wordmark on a light panel.', file: '/brand/omnifm-wordmark-on-light.png', bg: 'light', use: 'Dokumente', useEn: 'Documents' },
  // — Banner —
  { slug: 'banner-dark', label: 'Banner — Dunkel', labelEn: 'Banner — Dark', desc: 'Hero-Banner mit Tagline (Obsidian).', descEn: 'Hero banner with tagline (obsidian).', file: '/brand/omnifm-banner.png', bg: 'dark', use: 'Social, OG-Image', useEn: 'Social, OG image' },
  { slug: 'banner-light', label: 'Banner — Hell', labelEn: 'Banner — Light', desc: 'Hero-Banner auf hellem Grund.', descEn: 'Hero banner on a light ground.', file: '/brand/omnifm-banner-light.png', bg: 'light', use: 'helle Seiten', useEn: 'light pages' },
  { slug: 'banner-transparent', label: 'Banner — Transparent', labelEn: 'Banner — Transparent', desc: 'Banner ohne Hintergrund.', descEn: 'Banner without a background.', file: '/brand/omnifm-banner-transparent.png', bg: 'dark', use: 'Overlays', useEn: 'Overlays' },
  // — Sponsor —
  { slug: 'sponsor-badge', label: 'Sponsor-Badge', labelEn: 'Sponsor badge', desc: '„Powered by omnifm" zum Verlinken.', descEn: '“Powered by omnifm” for linking.', file: '/brand/omnifm-sponsor-badge.png', bg: 'dark', use: 'Sponsoren-Links', useEn: 'Sponsor links' },
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
