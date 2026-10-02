// The recovery settings the owner console can change (#217). One list for
// the bot start (from-owner-config.mjs), FastAPI (validation and the form)
// and /diag: recovery-settings.json next to this file.
import fs from "node:fs";
import { botTranslator } from "../lib/bot-i18n.js";

const RECOVERY_SETTINGS = Object.freeze(
  JSON.parse(fs.readFileSync(new URL("./recovery-settings.json", import.meta.url), "utf8"))
    .map((entry) => Object.freeze({ ...entry }))
);

function clampSetting(entry, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(entry.min, Math.min(entry.max, parsed));
}

/** Copies the owner values of system.streamRecovery into the environment. */
function applyRecoverySettingsToEnv(streamRecovery = {}, env = process.env) {
  const applied = [];
  for (const entry of RECOVERY_SETTINGS) {
    const value = clampSetting(entry, streamRecovery?.[entry.key]);
    if (value === null) continue;
    env[entry.env] = String(value);
    applied.push(entry.env);
  }
  return applied;
}

/** The value the runtime works with and where it comes from. */
function getEffectiveRecoverySettings(env = process.env) {
  return RECOVERY_SETTINGS.map((entry) => {
    const configured = clampSetting(entry, env?.[entry.env]);
    return {
      key: entry.key,
      env: entry.env,
      label: entry.label,
      unit: entry.unit,
      value: configured ?? entry.default,
      isDefault: configured === null || configured === entry.default,
    };
  });
}

function formatDuration(ms, t) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} ${t("Std.", "h")}`;
}

/**
 * Short lines for /diag, so support can read the effective values.
 * @param {Record<string, string | undefined>} [env]
 * @param {(de: string, en: string, params?: Record<string, unknown>) => string} [t]
 */
function describeRecoverySettings(env = process.env, t = botTranslator("de")) {
  const values = Object.fromEntries(getEffectiveRecoverySettings(env).map((item) => [item.key, item.value]));
  return [
    t(
      "Ersatzsender: nach {failures} Fehlern und {silence} ohne Ton",
      "Backup station: after {failures} failures and {silence} without audio", { failures: values.failoverMinFailures, silence: formatDuration(values.failoverMinUnstableMs, t) }
    ),
    t(
      "Zurück: Prüfung alle {every} (bis {max}), {confirmations}× erreichbar",
      "Back: check every {every} (up to {max}), {confirmations}× reachable", { every: formatDuration(values.failbackCheckMs, t), max: formatDuration(values.failbackMaxMs, t), confirmations: values.failbackConfirmations }
    ),
    t(
      "Neustart nach {stall} Stille · Pause {pause} ab {failures} Fehlern",
      "Restart after {stall} of silence · pause {pause} from {failures} failures", { stall: formatDuration(values.healthcheckStallMs, t), pause: formatDuration(values.errorCooldownMs, t), failures: values.errorCooldownThreshold }
    ),
    t(
      "Verbindungssperre nach {attempts} Versuchen für {lock} · Pausiert: neuer Versuch alle {retry}",
      "Connection lock after {attempts} attempts for {lock} · Paused: retry every {retry}", { attempts: values.reconnectCircuitAttempts, lock: formatDuration(values.reconnectCircuitMs, t), retry: formatDuration(values.voiceParkedRetryMs, t) }
    ),
  ];
}

export {
  RECOVERY_SETTINGS,
  applyRecoverySettingsToEnv,
  clampSetting,
  describeRecoverySettings,
  getEffectiveRecoverySettings,
};
