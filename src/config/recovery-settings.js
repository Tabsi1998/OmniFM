// The recovery settings the owner console can change (#217). One list for
// the bot start (from-owner-config.mjs), FastAPI (validation and the form)
// and /diag: recovery-settings.json next to this file.
import fs from "node:fs";

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

/** Short lines for /diag, so support can read the effective values. */
function describeRecoverySettings(env = process.env, t = (de) => de) {
  const values = Object.fromEntries(getEffectiveRecoverySettings(env).map((item) => [item.key, item.value]));
  return [
    t(
      `Ersatzsender: nach ${values.failoverMinFailures} Fehlern und ${formatDuration(values.failoverMinUnstableMs, t)} ohne Ton`,
      `Backup station: after ${values.failoverMinFailures} failures and ${formatDuration(values.failoverMinUnstableMs, t)} without audio`
    ),
    t(
      `Zurück: Prüfung alle ${formatDuration(values.failbackCheckMs, t)} (bis ${formatDuration(values.failbackMaxMs, t)}), ${values.failbackConfirmations}× erreichbar`,
      `Back: check every ${formatDuration(values.failbackCheckMs, t)} (up to ${formatDuration(values.failbackMaxMs, t)}), ${values.failbackConfirmations}× reachable`
    ),
    t(
      `Neustart nach ${formatDuration(values.healthcheckStallMs, t)} Stille · Pause ${formatDuration(values.errorCooldownMs, t)} ab ${values.errorCooldownThreshold} Fehlern`,
      `Restart after ${formatDuration(values.healthcheckStallMs, t)} of silence · pause ${formatDuration(values.errorCooldownMs, t)} from ${values.errorCooldownThreshold} failures`
    ),
    t(
      `Verbindungssperre nach ${values.reconnectCircuitAttempts} Versuchen für ${formatDuration(values.reconnectCircuitMs, t)} · Pausiert: neuer Versuch alle ${formatDuration(values.voiceParkedRetryMs, t)}`,
      `Connection lock after ${values.reconnectCircuitAttempts} attempts for ${formatDuration(values.reconnectCircuitMs, t)} · Paused: retry every ${formatDuration(values.voiceParkedRetryMs, t)}`
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
