// Shared OmniFM brand asset catalog (files live in /public/brand).
export const BRAND_ASSETS = [
  { slug: 'omnifm-icon-universal', label: 'Universal Icon', desc: 'Primäres Symbol – funktioniert auf hell & dunkel.', file: '/brand/omnifm-icon-universal.jpg', bg: 'dark', use: 'App-Icon, Social Avatar' },
  { slug: 'omnifm-bot-avatar', label: 'Discord Bot Avatar', desc: 'Rundes Profilbild für den Discord-Bot.', file: '/brand/omnifm-bot-avatar.jpg', bg: 'discord', use: 'Discord-Profil, Favicon' },
  { slug: 'omnifm-wordmark-dark', label: 'Wortmarke (Dunkel)', desc: 'Logo + Schriftzug für dunkle Flächen.', file: '/brand/omnifm-wordmark-dark.jpg', bg: 'dark', use: 'Header, dunkle Webseiten' },
  { slug: 'omnifm-wordmark-light', label: 'Wortmarke (Hell)', desc: 'Logo + Schriftzug für helle Flächen.', file: '/brand/omnifm-wordmark-light.jpg', bg: 'light', use: 'Helle Webseiten, Dokumente' },
  { slug: 'omnifm-sponsor-badge', label: 'Sponsor-Badge', desc: '„Powered by OmniFM" zum Verlinken.', file: '/brand/omnifm-sponsor-badge.jpg', bg: 'dark', use: 'Sponsoren-Links, Footer' },
  { slug: 'omnifm-banner', label: 'Marketing-Banner', desc: 'Breites Hero-Banner für Social & Web.', file: '/brand/omnifm-banner.jpg', bg: 'dark', use: 'Social Header, OG-Image' },
  { slug: 'omnifm-print-logo', label: 'Druck-Logo', desc: 'Kontrastreiches Logo auf weißem Grund.', file: '/brand/omnifm-print-logo.jpg', bg: 'light', use: 'Print, Flyer, Sticker' },
  { slug: 'omnifm-favicon-mark', label: 'Favicon-Mark', desc: 'Reduzierte Marke, lesbar ab 32px.', file: '/brand/omnifm-favicon-mark.jpg', bg: 'dark', use: 'Favicon, kleine Icons' },
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
  return `<a href="${origin}" target="_blank" rel="noopener">\n  <img src="${origin}/brand/omnifm-sponsor-badge.jpg" alt="Powered by OmniFM" height="44" />\n</a>`;
}

export function sponsorEmbedMarkdown(origin = siteOrigin()) {
  return `[![Powered by OmniFM](${origin}/brand/omnifm-sponsor-badge.jpg)](${origin})`;
}
