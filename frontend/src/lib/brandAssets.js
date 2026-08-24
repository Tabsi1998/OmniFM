// Shared OmniFM brand asset catalog (files live in /public/brand).
// Primary brand is a true vector (SVG) with transparent PNG exports so
// partners can place the mark on any background (dark or light).
export const BRAND_ASSETS = [
  { slug: 'omnifm-mark-svg', label: 'Vektor-Icon (SVG)', desc: 'Skalierbare Marke – Schallwelle + Unendlichkeit. Transparent.', file: '/brand/omnifm-mark.svg', bg: 'dark', use: 'Print, App, Vektor · beste Qualität' },
  { slug: 'omnifm-mark-512', label: 'Icon PNG (transparent)', desc: 'Hauptsymbol als transparentes PNG.', file: '/brand/omnifm-mark-512.png', bg: 'dark', use: 'App-Icon, Social Avatar' },
  { slug: 'omnifm-wordmark-dark', label: 'Wortmarke – Dunkel', desc: 'Logo + „omnifm" für dunkle Flächen. Transparent.', file: '/brand/omnifm-wordmark-dark.png', bg: 'dark', use: 'Header, dunkle Webseiten' },
  { slug: 'omnifm-wordmark-light', label: 'Wortmarke – Hell', desc: 'Logo + „omnifm" für helle Flächen. Transparent.', file: '/brand/omnifm-wordmark-light.png', bg: 'light', use: 'Helle Seiten, Dokumente' },
  { slug: 'omnifm-sponsor-badge', label: 'Sponsor-Badge', desc: '„Powered by omnifm" zum Verlinken. Transparent.', file: '/brand/omnifm-sponsor-badge.png', bg: 'dark', use: 'Sponsoren-Links, Footer' },
  { slug: 'omnifm-banner', label: 'Marketing-Banner', desc: 'Breites Hero-Banner für Social & Web.', file: '/brand/omnifm-banner.png', bg: 'dark', use: 'Social Header, OG-Image' },
  { slug: 'omnifm-favicon', label: 'Favicon', desc: 'Kompakte Marke, lesbar in kleinen Größen.', file: '/brand/omnifm-favicon.png', bg: 'dark', use: 'Favicon, kleine Icons' },
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
