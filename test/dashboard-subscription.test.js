import test from "node:test";
import assert from "node:assert/strict";

import {
  formatSubscriptionPriceCents,
  buildSubscriptionLimitCards,
  buildSubscriptionNextAction,
  buildSubscriptionUpgradeSummary,
  buildSubscriptionPromotionNotes,
  buildSubscriptionActivityRows,
} from "../frontend/src/lib/dashboardSubscription.js";

test("subscription helpers format prices and expose current plan limits", () => {
  assert.equal(formatSubscriptionPriceCents(549, "de-AT"), "€ 5,49");

  const cards = buildSubscriptionLimitCards({
    license: {
      seats: 2,
      seatsUsed: 1,
      seatsAvailable: 1,
    },
    currentPlan: {
      limits: {
        maxBots: 8,
        bitrate: "128k",
        reconnectMs: 2500,
      },
    },
  }, (_de, en) => en);

  assert.equal(cards.length, 4);
  assert.deepEqual(cards[0], {
    key: "seats",
    label: "Seat status",
    value: "1 / 2",
    detail: "1 free",
  });
  assert.deepEqual(cards[1], {
    key: "bots",
    label: "Bot limit",
    value: "8",
    detail: "manageable in parallel",
  });
  assert.equal(cards[2].value, "128k");
  assert.equal(cards[3].value, "2500 ms");
});

test("subscription upgrade summary stays null without a recommendation", () => {
  const summary = buildSubscriptionUpgradeSummary({}, [], (_de, en) => en);
  assert.equal(summary, null);
});

test("subscription upgrade summary highlights upgrade path and pricing", () => {
  const summary = buildSubscriptionUpgradeSummary({
    recommendedUpgrade: {
      tier: "ultimate",
      tierName: "Ultimate",
      limits: {
        maxBots: 16,
        bitrate: "320k",
      },
      pricing: {
        monthlyCents: 799,
        yearlyCents: 3588,
      },
      upgradeCostCents: 240,
      daysLeft: 18,
    },
  }, ["Advanced analytics", "Custom stations", "Failover rules"], (_de, en) => en);

  assert.equal(summary.tier, "ultimate");
  assert.equal(summary.title, "Best next step: ULTIMATE");
  assert.match(summary.description, /Up to 16 bots/);
  assert.deepEqual(summary.highlights, [
    "Advanced analytics",
    "Custom stations",
    "Failover rules",
  ]);
  assert.equal(summary.pricing.monthlyCents, 799);
  assert.equal(summary.upgradeCostCents, 240);
  assert.equal(summary.daysLeft, 18);
});

test("subscription promotion notes expose coupon, trial, and seat saturation hints", () => {
  const t = (_de, en) => en;

  const freeNotes = buildSubscriptionPromotionNotes({
    promotions: {
      couponCodesSupported: true,
      proTrialEnabled: true,
      proTrialMonths: 1,
    },
    license: null,
  }, t);
  // Discount codes need a purchase; the website sells nothing since #321.
  assert.deepEqual(freeNotes, [
    {
      key: "trial",
      label: "Pro trial month",
      detail: "Currently available for new customers: 1 month of Pro.",
    },
  ]);

  const fullSeatNotes = buildSubscriptionPromotionNotes({
    promotions: {
      couponCodesSupported: false,
      proTrialEnabled: false,
    },
    license: {
      seatsAvailable: 0,
    },
  }, t);
  assert.deepEqual(fullSeatNotes, [
    {
      key: "seats-full",
      label: "Seat usage",
      detail: "All seats of this license are currently linked. Additional servers require a larger seat bundle or a second license.",
    },
  ]);
});

test("subscription next action prioritizes renewal, email hygiene, seat planning, and upgrades", () => {
  const t = (_de, en) => en;

  const expiredAction = buildSubscriptionNextAction({
    license: {
      expired: true,
      remainingDays: 0,
      plan: "pro",
      hasBillingEmail: true,
      seats: 2,
      seatsUsed: 1,
      seatsAvailable: 1,
    },
  }, [], t);
  assert.equal(expiredAction.key, "renew-expired");
  assert.equal(expiredAction.cta.kind, "checkout");

  const emailAction = buildSubscriptionNextAction({
    license: {
      expired: false,
      remainingDays: 21,
      plan: "pro",
      hasBillingEmail: false,
      emailMasked: "",
      seats: 2,
      seatsUsed: 1,
      seatsAvailable: 1,
    },
  }, [], t);
  assert.equal(emailAction.key, "billing-email");
  assert.equal(emailAction.cta.kind, "edit-email");

  const seatAction = buildSubscriptionNextAction({
    license: {
      expired: false,
      remainingDays: 21,
      plan: "ultimate",
      hasBillingEmail: true,
      seats: 2,
      seatsUsed: 2,
      seatsAvailable: 0,
    },
  }, [], t);
  assert.equal(seatAction.key, "seat-capacity");
  assert.equal(seatAction.cta.kind, "plans");

  const upgradeAction = buildSubscriptionNextAction({
    effectiveTier: "pro",
    license: {
      expired: false,
      remainingDays: 21,
      plan: "pro",
      hasBillingEmail: true,
      seats: 2,
      seatsUsed: 1,
      seatsAvailable: 1,
    },
    recommendedUpgrade: {
      tier: "ultimate",
      tierName: "Ultimate",
    },
  }, ["Advanced analytics", "Failover rules"], t);
  assert.equal(upgradeAction.key, "review-upgrade");
  assert.equal(upgradeAction.cta.kind, "plans", "an upgrade is not bought in the dashboard since #321");
  assert.match(upgradeAction.body, /Advanced analytics/i);
});

test("subscription activity rows summarize earlier renewals and upgrades", () => {
  const t = (_de, en) => en;
  const activity = {
    replayProtection: {
      recentSessionCount: 2,
      lastSessionId: "cs_live_123",
    },
    recentSessions: [
      {
        sessionId: "cs_live_123",
        upgraded: true,
        tierName: "Ultimate",
        months: 3,
        seats: 2,
        finalAmountCents: 1438,
        discountCents: 479,
        appliedOfferCode: "RENEW25",
        replayProtected: true,
        processedAt: "2026-03-09T08:00:00.000Z",
      },
      {
        sessionId: "cs_live_122",
        renewed: true,
        tierName: "Pro",
        months: 1,
        seats: 2,
        finalAmountCents: 549,
        discountCents: 0,
        replayProtected: true,
        processedAt: "2026-03-08T08:00:00.000Z",
      },
    ],
  };


  const rows = buildSubscriptionActivityRows(activity, t);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Upgrade");
  assert.match(rows[0].detail, /ULTIMATE/i);
  assert.match(rows[0].detail, /Code RENEW25/);
  assert.equal(rows[0].amountCents, 1438);
  assert.equal(rows[0].discountCents, 479);
  assert.equal(rows[1].title, "Renewal");
});
