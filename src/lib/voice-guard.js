function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function normalizePolicy(value, fallbackValue, { allowDefault = false } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "allow" || normalized === "return" || normalized === "disconnect") {
    return normalized;
  }
  if (allowDefault && normalized === "default") {
    return "default";
  }
  return fallbackValue;
}

function normalizeEscalation(value, fallbackValue) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "cooldown" || normalized === "disconnect") {
    return normalized;
  }
  return fallbackValue;
}

export const VOICE_GUARD_DEFAULT_POLICY = normalizePolicy(process.env.VOICE_MOVE_POLICY, "return");
export const VOICE_GUARD_MOVE_CONFIRMATIONS = Math.max(1, toPositiveInt(process.env.VOICE_MOVE_CONFIRMATIONS, 2));
export const VOICE_GUARD_RETURN_COOLDOWN_MS = Math.max(2_000, toPositiveInt(process.env.VOICE_MOVE_RETURN_COOLDOWN_MS, 15_000));
export const VOICE_GUARD_WINDOW_MS = Math.max(10_000, toPositiveInt(process.env.VOICE_MOVE_WINDOW_MS, 120_000));
export const VOICE_GUARD_MAX_EVENTS_PER_WINDOW = Math.max(2, toPositiveInt(process.env.VOICE_MOVE_MAX_EVENTS_PER_WINDOW, 4));
export const VOICE_GUARD_ESCALATION = normalizeEscalation(process.env.VOICE_MOVE_ESCALATION, "disconnect");
export const VOICE_GUARD_ESCALATION_COOLDOWN_MS = Math.max(
  VOICE_GUARD_RETURN_COOLDOWN_MS,
  toPositiveInt(process.env.VOICE_MOVE_ESCALATION_COOLDOWN_MS, 10 * 60_000)
);

export const DEFAULT_VOICE_GUARD_SETTINGS = Object.freeze({
  policy: "default",
});

export function normalizeVoiceGuardPolicy(value, { allowDefault = false, fallback = VOICE_GUARD_DEFAULT_POLICY } = {}) {
  return normalizePolicy(value, fallback, { allowDefault });
}

export function normalizeVoiceGuardEscalation(value, fallback = VOICE_GUARD_ESCALATION) {
  return normalizeEscalation(value, fallback);
}

export function normalizeVoiceGuardSettings(rawConfig) {
  const input = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    policy: normalizeVoiceGuardPolicy(input.policy, { allowDefault: true, fallback: "default" }),
  };
}

export function validateVoiceGuardSettings(rawConfig) {
  const config = normalizeVoiceGuardSettings(rawConfig);
  const rawPolicy = String(rawConfig?.policy || "").trim();
  if (rawPolicy && !["default", "allow", "return", "disconnect"].includes(rawPolicy.toLowerCase())) {
    return { ok: false, error: "Voice-Guard-Policy ist ungültig." };
  }
  return { ok: true, config };
}

export function buildResolvedVoiceGuardConfig(rawConfig, { featureEnabled = true } = {}) {
  const normalized = normalizeVoiceGuardSettings(rawConfig);
  const configuredPolicy = normalizeVoiceGuardPolicy(normalized.policy, {
    allowDefault: true,
    fallback: "default",
  });
  const effectivePolicy = featureEnabled
    ? (configuredPolicy === "default" ? VOICE_GUARD_DEFAULT_POLICY : configuredPolicy)
    : "allow";

  return {
    available: featureEnabled === true,
    policy: configuredPolicy,
    effectivePolicy,
    defaults: {
      policy: VOICE_GUARD_DEFAULT_POLICY,
      moveConfirmations: VOICE_GUARD_MOVE_CONFIRMATIONS,
      returnCooldownMs: VOICE_GUARD_RETURN_COOLDOWN_MS,
      moveWindowMs: VOICE_GUARD_WINDOW_MS,
      maxMovesPerWindow: VOICE_GUARD_MAX_EVENTS_PER_WINDOW,
      escalation: VOICE_GUARD_ESCALATION,
      escalationCooldownMs: VOICE_GUARD_ESCALATION_COOLDOWN_MS,
    },
  };
}

export function formatVoiceGuardDurationMs(value) {
  const ms = Math.max(0, Number(value || 0) || 0);
  if (ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
