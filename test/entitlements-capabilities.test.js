import test from "node:test";
import assert from "node:assert/strict";

import {
  getPlanCapabilities,
  getPlanLimits,
  getServerCapabilities,
  getServerSeats,
  getServerPlan,
  setLicenseProvider,
  buildUpgradeHints,
  getCapabilityRequirementPlan,
} from "../src/core/entitlements.js";
import {
  getDashboardBlockedFeatureLabels,
  getDashboardCapabilityRequiredTier,
  normalizeDashboardCapabilityPayload,
} from "../frontend/src/lib/dashboardCapabilities.js";

test("legacy tier-only licenses retain their paid plan", (t) => {
  setLicenseProvider(() => ({ active: true, tier: "ultimate", seats: 1 }));
  t.after(() => setLicenseProvider(() => null));
  assert.equal(getServerPlan("1342542257747923004"), "ultimate");
});

test("plan capabilities preserve free, pro, and ultimate package boundaries", () => {
  const freeCapabilities = getPlanCapabilities("free", { apiShape: true });
  const proCapabilities = getPlanCapabilities("pro", { apiShape: true });
  const ultimateCapabilities = getPlanCapabilities("ultimate", { apiShape: true });

  assert.equal(freeCapabilities.dashboardAccess, false);
  assert.equal(proCapabilities.dashboardAccess, true);
  assert.equal(proCapabilities.customStationUrls, false);
  assert.equal(proCapabilities.advancedAnalytics, false);
  assert.equal(proCapabilities.voiceGuard, true);
  assert.equal(ultimateCapabilities.customStationUrls, true);
  assert.equal(ultimateCapabilities.advancedAnalytics, true);
  assert.equal(ultimateCapabilities.failoverRules, true);
  assert.equal(ultimateCapabilities.voiceGuard, true);
  assert.equal(freeCapabilities.voiceGuard, true);
});

test("server capability payload derives seats from the active license", (t) => {
  setLicenseProvider((serverId) => {
    if (serverId !== "guild-1") return null;
    return { active: true, plan: "ultimate", seats: 3 };
  });
  t.after(() => setLicenseProvider(() => null));

  const capabilities = getServerCapabilities("guild-1", { apiShape: true });
  const limits = getPlanLimits("ultimate");

  assert.equal(capabilities.dashboardAccess, true);
  assert.equal(capabilities.licenseWorkspace, true);
  assert.equal(getServerSeats("guild-1"), 3);
  assert.equal(limits.maxBots, 16);
  assert.equal(limits.bitrateNum, 320);
});

test("upgrade hints expose blocked features in API naming", () => {
  const hints = buildUpgradeHints("pro", ["advanced_analytics", "custom_station_urls"]);

  assert.equal(hints.nextTier, "ultimate");
  assert.deepEqual(hints.blockedFeatures, ["advancedAnalytics", "customStationUrls"]);
});

test("dashboard capability payload normalization fills defaults", () => {
  const normalized = normalizeDashboardCapabilityPayload({
    serverId: "123",
    tier: "pro",
    capabilities: { dashboardAccess: true, eventScheduler: true },
    upgradeHints: { nextTier: "ultimate", blockedFeatures: ["advancedAnalytics"] },
  });

  assert.equal(normalized.serverId, "123");
  assert.equal(normalized.capabilities.dashboardAccess, true);
  assert.equal(normalized.capabilities.advancedAnalytics, false);
  assert.equal(normalized.capabilities.voiceGuard, false);
  assert.deepEqual(normalized.upgradeHints.blockedFeatures, ["advancedAnalytics"]);
});

test("dashboard blocked feature labels stay user-facing and deduplicated", () => {
  const t = (_de, en) => en;
  const labels = getDashboardBlockedFeatureLabels(
    ["advancedAnalytics", "customStationUrls", "advancedAnalytics"],
    t,
    5
  );

  assert.deepEqual(labels, ["Advanced analytics", "Custom stations"]);
});

test("dashboard capability required tiers keep pro and ultimate package boundaries", () => {
  assert.equal(getDashboardCapabilityRequiredTier("dashboardAccess"), "pro");
  assert.equal(getDashboardCapabilityRequiredTier("eventScheduler"), "pro");
  assert.equal(getDashboardCapabilityRequiredTier("customStationUrls"), "ultimate");
  assert.equal(getDashboardCapabilityRequiredTier("advancedAnalytics"), "ultimate");
  assert.equal(getDashboardCapabilityRequiredTier("voiceGuard"), "free");
  assert.equal(getCapabilityRequirementPlan("voice_guard"), "free");
});
