// ============================================================
// OmniFM: the owner console's settings for code that has to answer at once
// ============================================================
// Prices are read synchronously (price helpers, code redemption).
// Instead of reading MongoDB on every request, the last read
// owner_config stays here, refreshed once a minute and right after the console
// saves (#289). Before the first read everything falls back to the built-in
// prices and the environment, exactly as without an owner console.
import { loadOwnerConfigRaw } from "./owner-config.js";
import { isConnected } from "./db.js";

let snapshot = {};
let refreshTimer = null;

/** The last read owner_config document (without _id); {} before the first read. */
export function ownerSettings() {
  return snapshot;
}

export async function refreshOwnerSettings(options = {}) {
  if (!options.db && !isConnected()) return snapshot;
  try {
    snapshot = (await loadOwnerConfigRaw(options)) || {};
  } catch {
    // Keep the last good settings.
  }
  return snapshot;
}

export function startOwnerSettingsRefresh(intervalMs = 60_000) {
  if (refreshTimer) return;
  void refreshOwnerSettings();
  refreshTimer = setInterval(() => { void refreshOwnerSettings(); }, intervalMs);
  refreshTimer.unref?.();
}

export function stopOwnerSettingsRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/** For tests: set the settings without MongoDB. */
export function setOwnerSettingsForTests(value) {
  snapshot = value && typeof value === "object" ? value : {};
}

const text = (value) => String(value ?? "").trim();

/** The monthly price the owner set for a plan, in cents; null when none is set. */
export function ownerPlanPriceCents(tier) {
  const value = snapshot?.plans?.[String(tier || "").toLowerCase()]?.pricePerMonth;
  const cents = Number.parseInt(text(value), 10);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}
