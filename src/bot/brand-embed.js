// ============================================================
// OmniFM — zentrale Brand-Optik für ALLE Discord-Embeds.
// Farben & Look spiegeln die Website (dunkel, Orange/Cyan/Rot).
// Discord unterstützt keine Gradients/Fonts, daher setzen wir
// konsistente Akzentfarben, ein Marken-Icon in Footer/Author
// und ein modernes, aufgeräumtes Layout.
// ============================================================

import { WEBSITE_URL } from "./runtime-links.js";

// Website-Palette (exakt wie im Frontend).
export const OMNI_COLORS = {
  orange: 0xFF6B00,   // Primär / Pro
  cyan: 0x00E5FF,     // Sekundär / Free
  red: 0xFF2A5F,      // Live / Ultimate / Akzent
  live: 0xFF2A5F,
  info: 0x00E5FF,
  success: 0x10B981,
  warning: 0xF59E0B,
  danger: 0xEF4444,
  neutral: 0x64748B,
  dark: 0x0A0C12,
};

// Tarif-Akzent wie auf der Website: Free Cyan, Pro Orange, Ultimate Rot.
export function tierColor(tier) {
  const t = String(tier || "free").toLowerCase();
  if (t === "ultimate") return OMNI_COLORS.red;
  if (t === "pro") return OMNI_COLORS.orange;
  return OMNI_COLORS.cyan;
}

// Marken-Icon (PNG, hell) für Footer/Author – SVG kann Discord nicht.
export function brandIconUrl() {
  const base = String(WEBSITE_URL || "").replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) return undefined;
  return `${base}/brand/omnifm-mark-white.png`;
}

// Einheitlicher Footer mit Marken-Icon.
export function brandFooter(text) {
  const icon = brandIconUrl();
  const footer = { text: String(text || "OmniFM · 24/7 Discord Radio") };
  if (icon) footer.iconURL = icon;
  return footer;
}

// Einheitlicher Author (Kopfzeile) mit Marken-Icon.
export function brandAuthor(name, iconURL) {
  const author = { name: String(name || "OmniFM") };
  const icon = iconURL || brandIconUrl();
  if (icon) author.iconURL = icon;
  return author;
}

// Dünne Trennlinie für Beschreibungen (dezent, on-brand).
export const OMNI_RULE = "─────────────────────";
