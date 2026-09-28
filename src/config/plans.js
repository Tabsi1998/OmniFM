// ============================================================
// OmniFM - Plan Configuration
// ============================================================
// Built from src/config/plan-features.js (#413), the one place that says
// what each plan can do; this file keeps the shapes the bot and the API use.

import { PLAN_CAPABILITIES, PLAN_LIMITS, PLAN_NAMES, PLAN_ORDER as ORDER, planRank } from "./plan-features.js";

export const PLAN_ORDER = [...ORDER];

export const CAPABILITIES = Object.fromEntries(
  Object.entries(PLAN_CAPABILITIES).map(([key, entry]) => [key, { apiKey: entry.apiKey, minPlan: entry.minPlan, label: entry.de }])
);

export const CAPABILITY_KEYS = Object.freeze(Object.keys(CAPABILITIES));
export const CAPABILITY_API_KEYS = Object.freeze(
  Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, CAPABILITIES[key].apiKey]))
);
export const CAPABILITY_LABELS = Object.freeze(
  Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, CAPABILITIES[key].label]))
);

function buildPlan(id) {
  const limits = PLAN_LIMITS[id];
  return {
    id,
    name: PLAN_NAMES[id],
    maxBots: limits.maxBots,
    bitrate: limits.bitrate,
    bitrateNum: limits.bitrateNum,
    reconnectMs: limits.reconnectMs,
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, planRank(id) >= planRank(CAPABILITIES[key].minPlan)])),
    limits: { ...limits },
  };
}

export const PLANS = Object.fromEntries(PLAN_ORDER.map((id) => [id, buildPlan(id)]));

export const BRAND = {
  name: "OmniFM",
  tagline: "Streaming the future of radio",
  footer: "OmniFM · 24/7 Discord Radio",
  presence: "Streaming the future of radio | /play",
  color: 0x00E5FF,
  colorHex: "#00E5FF",
  proColor: 0xFF6B00,
  ultimateColor: 0xFF2A5F,
  upgradeUrl: "",
};
