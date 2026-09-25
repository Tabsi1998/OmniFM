// ============================================================
// OmniFM: the look of the now-playing panel per server (#281)
// ============================================================
// Set in the dashboard: which optional buttons show, an own accent colour,
// "Earlier" (the last songs) on or off. Pause and Stop always stay, and so do
// the buttons of a backup station, they fix a running problem. Premium
// (Pro and Ultimate); on Free, or after a downgrade, the panel looks as usual.

export const PANEL_DESIGN_BUTTONS = Object.freeze([
  { key: "volume", de: "Lautstärke − / +", en: "Volume − / +" },
  { key: "stations", de: "Sender", en: "Stations" },
  { key: "favorites", de: "Favoriten-Leiste", en: "Favourites bar" },
  { key: "save", de: "Merken", en: "Save" },
  { key: "links", de: "Spotify und YouTube", en: "Spotify and YouTube" },
  { key: "share", de: "Teilen", en: "Share" },
  { key: "report", de: "Problem melden", en: "Report a problem" },
]);

const BUTTON_KEYS = PANEL_DESIGN_BUTTONS.map((entry) => entry.key);

/** 0xRRGGBB from a number or "#rrggbb", else null (automatic colour). */
export function normalizePanelAccent(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  return match ? Number.parseInt(match[1], 16) : null;
}

/**
 * @param {any} raw what is stored (or sent by the dashboard)
 * @returns {{ accentColor: number|null, showRecent: boolean, buttons: Record<string, boolean> }}
 */
export function normalizePanelDesign(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const buttons = source.buttons && typeof source.buttons === "object" ? source.buttons : {};
  return {
    accentColor: normalizePanelAccent(source.accentColor),
    showRecent: source.showRecent !== false,
    buttons: Object.fromEntries(BUTTON_KEYS.map((key) => [key, buttons[key] !== false])),
  };
}

export const DEFAULT_PANEL_DESIGN = Object.freeze(normalizePanelDesign({}));

export function isDefaultPanelDesign(design) {
  return panelDesignSignature(design) === panelDesignSignature(DEFAULT_PANEL_DESIGN);
}

/** Short and stable, for the panel's change check. */
export function panelDesignSignature(design) {
  const normalized = normalizePanelDesign(design);
  const off = BUTTON_KEYS.filter((key) => !normalized.buttons[key]).join("+");
  return `${normalized.accentColor ?? "auto"}/${normalized.showRecent ? "recent" : "norecent"}/${off || "all"}`;
}

export function canCustomizePanel(tier) {
  const value = String(tier || "").toLowerCase();
  return value === "pro" || value === "ultimate";
}

/** What the panel of a server uses: its design on Premium, else the standard. */
export function effectivePanelDesign(stored, tier) {
  return canCustomizePanel(tier) ? normalizePanelDesign(stored) : normalizePanelDesign({});
}
