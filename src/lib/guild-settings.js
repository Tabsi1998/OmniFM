import { getDb, isConnected } from "./db.js";
import { normalizeFailoverChain, getPrimaryFailoverStation } from "./failover-chain.js";
import { normalizeWeeklyDigestConfig } from "./weekly-digest.js";
import { normalizeDashboardIncidentAlertsConfig } from "./dashboard-incident-alerts.js";
import { normalizeDashboardExportsWebhookConfig } from "./dashboard-webhooks.js";
import { normalizeVoiceGuardSettings } from "./voice-guard.js";

function sanitizeGuildId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function normalizeIsoDateString(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeGuildSettings(rawSettings = {}) {
  const input = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const normalizedGuildId = sanitizeGuildId(input.guildId);
  const normalizedFailoverChain = normalizeFailoverChain(input.failoverChain || input.fallbackStation || []);
  const normalizedWeeklyDigestLastSent = normalizeIsoDateString(input.weeklyDigestLastSent);

  const normalized = {
    ...input,
    weeklyDigest: normalizeWeeklyDigestConfig(input.weeklyDigest || {}, "de"),
    failoverChain: normalizedFailoverChain,
    fallbackStation: getPrimaryFailoverStation(normalizedFailoverChain, input.fallbackStation || ""),
    incidentAlerts: normalizeDashboardIncidentAlertsConfig(input.incidentAlerts || {}),
    exportsWebhook: normalizeDashboardExportsWebhookConfig(input.exportsWebhook || {}),
    voiceGuard: normalizeVoiceGuardSettings(input.voiceGuard || {}),
  };

  if (normalizedGuildId) {
    normalized.guildId = normalizedGuildId;
  } else {
    delete normalized.guildId;
  }

  if (normalizedWeeklyDigestLastSent) {
    normalized.weeklyDigestLastSent = normalizedWeeklyDigestLastSent;
  } else {
    delete normalized.weeklyDigestLastSent;
  }

  return normalized;
}

export async function loadGuildSettings(guildId) {
  const normalizedGuildId = sanitizeGuildId(guildId);
  if (!normalizedGuildId || !isConnected() || !getDb()) {
    return {};
  }

  try {
    const settings = await getDb().collection("guild_settings").findOne(
      { guildId: normalizedGuildId },
      { projection: { _id: 0 } }
    ) || {};
    const hasStoredSettings = Object.keys(settings).length > 0;
    const normalized = normalizeGuildSettings({
      ...settings,
      guildId: normalizedGuildId,
    });

    if (hasStoredSettings && JSON.stringify(settings || {}) !== JSON.stringify(normalized)) {
      const removedKeys = Object.keys(settings).filter((key) => !Object.prototype.hasOwnProperty.call(normalized, key));
      // A caller that awaits this load expects repaired settings to be durable
      // before it can perform a following read or write. Leaving the repair in
      // the background made that guarantee timing-dependent (especially in CI).
      await getDb().collection("guild_settings").updateOne(
        { guildId: normalizedGuildId },
        {
          $set: normalized,
          ...(removedKeys.length > 0
            ? { $unset: Object.fromEntries(removedKeys.map((key) => [key, ""])) }
            : {}),
        },
        { upsert: true }
      ).catch(() => null);
    }

    return normalized;
  } catch {
    return {};
  }
}

export async function updateGuildSettings(guildId, updates, { unset = [] } = {}) {
  const normalizedGuildId = sanitizeGuildId(guildId);
  if (!normalizedGuildId || !isConnected() || !getDb()) {
    return { ok: false, error: "db_unavailable" };
  }

  const safeUpdates = updates && typeof updates === "object" ? { ...updates } : {};
  safeUpdates.guildId = normalizedGuildId;
  const safeUnset = Array.isArray(unset)
    ? unset.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const operations = { $set: safeUpdates };
  if (safeUnset.length > 0) {
    operations.$unset = Object.fromEntries(safeUnset.map((key) => [key, ""]));
  }

  try {
    await getDb().collection("guild_settings").updateOne(
      { guildId: normalizedGuildId },
      operations,
      { upsert: true }
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "db_write_failed" };
  }
}

export {
  normalizeGuildSettings,
};
