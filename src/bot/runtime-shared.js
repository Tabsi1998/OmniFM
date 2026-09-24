// Settings and small helpers shared by runtime.js and the BotRuntime method
// modules (#210).
import { getServerPlanConfig } from "../core/entitlements.js";
import { getServerLicense } from "../premium-store.js";

// ============================================================
// OmniFM: BotRuntime Class
// ============================================================


export const NP_PREFIX = "np:";

// Helper: wraps getServerPlanConfig + adds 'tier' alias for backward compatibility
export function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

// Helper: wraps getServerLicense for backward compatibility
export function getLicense(guildId) {
  return getServerLicense(guildId);
}

export function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

export const VOICE_CHANNEL_STATUS_ENABLED = String(process.env.VOICE_CHANNEL_STATUS_ENABLED ?? "1") !== "0";
export const VOICE_CHANNEL_STATUS_TEMPLATE =
  String(process.env.VOICE_CHANNEL_STATUS_TEMPLATE || "\uD83D\uDD0A | 24/7 {station}").trim()
  || "\uD83D\uDD0A | 24/7 {station}";
export const VOICE_CHANNEL_STATUS_MAX_LENGTH = Math.max(1, Math.min(100, toPositiveInt(process.env.VOICE_CHANNEL_STATUS_MAX_LENGTH, 80)));
export const VOICE_CHANNEL_STATUS_REFRESH_MS = Math.max(60_000, toPositiveInt(process.env.VOICE_CHANNEL_STATUS_REFRESH_MS, 15 * 60_000));
export const ONBOARDING_MESSAGE_ENABLED = String(process.env.ONBOARDING_MESSAGE_ENABLED ?? "1") !== "0";
export const LISTENER_STATS_POLL_MS = Math.max(15_000, toPositiveInt(process.env.LISTENER_STATS_POLL_MS, 30_000));
export const PREMIUM_GUILD_ACCESS_MODE = String(process.env.PREMIUM_GUILD_ACCESS_MODE || "restrict").trim().toLowerCase() === "leave"
  ? "leave"
  : "restrict";
