// ============================================================
// OmniFM Discord design system: tokens (#264)
// ============================================================
// The colours come from the website palette in src/bot/brand-embed.js, so a
// message in Discord and the website look like one product.
import { OMNI_COLORS, tierColor } from "../../bot/brand-embed.js";

export const UI_COLORS = Object.freeze({
  brand: OMNI_COLORS.orange,
  live: OMNI_COLORS.live,
  info: OMNI_COLORS.info,
  success: OMNI_COLORS.success,
  warning: OMNI_COLORS.warning,
  error: OMNI_COLORS.danger,
  neutral: OMNI_COLORS.neutral,
});

export { tierColor };

/** Kinds of notices: colour and icon name (see icons.js). */
export const NOTICE_KINDS = Object.freeze({
  info: Object.freeze({ color: UI_COLORS.info, icon: "info" }),
  success: Object.freeze({ color: UI_COLORS.success, icon: "success" }),
  warning: Object.freeze({ color: UI_COLORS.warning, icon: "warning" }),
  error: Object.freeze({ color: UI_COLORS.error, icon: "error" }),
  premium: Object.freeze({ color: OMNI_COLORS.orange, icon: "premium" }),
});

/**
 * Limits of a Components V2 message. Every component counts, nested ones
 * too; all text displays together share one text budget.
 */
export const DISCORD_LIMITS = Object.freeze({
  components: 40,
  textLength: 4000,
  buttonsPerRow: 5,
  selectOptions: 25,
  buttonLabel: 80,
});
