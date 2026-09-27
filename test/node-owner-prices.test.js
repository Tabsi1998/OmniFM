import test from "node:test";
import assert from "node:assert/strict";

const helpers = await import("../src/lib/helpers.js");
const { setOwnerSettingsForTests } = await import("../src/lib/owner-settings-cache.js");
const { premiumPricing } = await import("../src/lib/owner-public.js");
const { DEFAULT_OWNER_CONFIG } = await import("../src/lib/owner-config.js");

const withPlans = (changes) => {
  const plans = JSON.parse(JSON.stringify(DEFAULT_OWNER_CONFIG.plans));
  for (const [tier, fields] of Object.entries(changes)) Object.assign(plans[tier], fields);
  return { plans };
};
const euro = (cents) => (cents / 100).toFixed(2).replace(".", ",");

test("without owner prices Node charges exactly what FastAPI charged", () => {
  setOwnerSettingsForTests({});
  // FastAPI: months x round(seat total x duration discount), rounded per month.
  assert.equal(helpers.calculatePrice("pro", 1, 1), 299);
  assert.equal(helpers.calculatePrice("pro", 3, 2), 3 * 457);
  assert.equal(helpers.calculatePrice("ultimate", 12, 5), 12 * Math.round(1699 * 299 / 499));
});

test("an owner price changes every price OmniFM shows alike (#289)", () => {
  const raw = withPlans({ pro: { pricePerMonth: 349 }, ultimate: { pricePerMonth: 599 } });
  setOwnerSettingsForTests(raw);
  try {
    const shown = premiumPricing(raw);
    for (const tier of ["pro", "ultimate"]) {
      for (const months of [1, 3, 6, 12]) {
        // One server: the monthly price on the website times the months is the charge.
        const charged = helpers.calculatePrice(tier, months, 1);
        assert.equal(euro(charged / months), shown.tiers[tier].durationPricing[String(months)], `${tier} ${months} months`);
      }
      for (const seats of [1, 2, 3, 5]) {
        assert.equal(euro(helpers.getSeatPricePerMonthCents(tier, seats)), shown.tiers[tier].seatPricing[String(seats)], `${tier} ${seats} servers`);
      }
    }
    assert.equal(helpers.calculatePrice("pro", 1, 1), 349);
    // An owner price of 0 or none keeps the built-in price, never a free checkout.
    setOwnerSettingsForTests(withPlans({ pro: { pricePerMonth: 0 } }));
    assert.equal(helpers.calculatePrice("pro", 1, 1), 299);
  } finally {
    setOwnerSettingsForTests({});
  }
});

