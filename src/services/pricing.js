// ============================================================
// OmniFM - Pricing Calculator (Seat- und Laufzeit-basiert)
// ============================================================

import { PLANS, BRAND } from "../config/plans.js";
import {
  DURATION_OPTIONS,
  SEAT_OPTIONS,
  getPricePerMonthCents,
  getSeatPricePerMonthCents,
  calculatePrice as calculatePriceCents,
  durationPricingInEuro,
  seatPricingInEuro,
  normalizeDuration,
  normalizeSeats,
} from "../lib/helpers.js";

export { DURATION_OPTIONS, SEAT_OPTIONS };

export function calculatePrice(plan, months, seats = 1) {
  const normalizedPlan = String(plan || "").toLowerCase();
  if (!["pro", "ultimate"].includes(normalizedPlan)) return null;

  const normalizedMonths = normalizeDuration(months);
  const normalizedSeats = normalizeSeats(seats);
  const totalCents = calculatePriceCents(normalizedPlan, normalizedMonths, normalizedSeats);
  if (totalCents <= 0) return null;

  const baseMonthlyCents = getSeatPricePerMonthCents(normalizedPlan, normalizedSeats);
  const discountedMonthlyCents = Math.round(totalCents / normalizedMonths);
  const regularTotalCents = baseMonthlyCents * normalizedMonths;
  const savingsCents = Math.max(0, regularTotalCents - totalCents);
  return {
    plan: normalizedPlan,
    months: normalizedMonths,
    seats: normalizedSeats,
    perMonthCents: discountedMonthlyCents,
    totalCents,
    currency: "EUR",
    perMonthFormatted: formatPriceEUR(discountedMonthlyCents / 100),
    totalFormatted: formatPriceEUR(totalCents / 100),
    savingsCents,
    savingsFormatted: savingsCents > 0 ? formatPriceEUR(savingsCents / 100) : null,
    savingsPercent: regularTotalCents > 0 ? Math.round((savingsCents / regularTotalCents) * 100) : 0,
  };
}

export function getAvailableProducts() {
  const products = [];
  for (const planId of ["pro", "ultimate"]) {
    const plan = PLANS[planId];
    for (const seats of SEAT_OPTIONS) {
      for (const months of DURATION_OPTIONS) {
        const price = calculatePrice(planId, months, seats);
        if (price) {
          products.push({
            plan: planId,
            planName: plan.name,
            ...price,
          });
        }
      }
    }
  }
  return products;
}

export function formatPriceEUR(value) {
  return `\u20ac${value.toFixed(2)}`;
}

export function getPricingOverview() {
  return {
    brand: BRAND.name,
    durations: DURATION_OPTIONS,
    seatOptions: SEAT_OPTIONS,
    plans: {
      free: {
        name: "Free",
        price: formatPriceEUR(0),
        tagline: "Zum Testen und für kleine Server.",
        highlights: [
          "20 Free-Stationen",
          "Standard Audio (64k)",
          "Standard Reconnect",
          "Bis zu 2 Bots",
        ],
      },
      pro: {
        name: "Pro",
        recommended: true,
        startingAt: formatPriceEUR(getPricePerMonthCents("pro", 1) / 100) + "/Monat",
        tagline: "Für aktive Communities.",
        highlights: [
          "20 Free + 100 Pro-Stationen",
          "HQ Audio (128k Opus)",
          "Priority Auto-Reconnect",
          "Bis zu 8 Bots",
          "Rollenbasierte Berechtigungen",
          "Event-Scheduler",
        ],
        durationPricing: durationPricingInEuro("pro"),
        seatPricing: seatPricingInEuro("pro"),
      },
      ultimate: {
        name: "Ultimate",
        startingAt: formatPriceEUR(getPricePerMonthCents("ultimate", 1) / 100) + "/Monat",
        tagline: "Für grosse Server und volle Kontrolle.",
        highlights: [
          "Alles aus Pro",
          "Ultra HQ Audio (320k)",
          "Instant Reconnect",
          "Custom Station URLs",
          "Bis zu 16 Bots",
        ],
        durationPricing: durationPricingInEuro("ultimate"),
        seatPricing: seatPricingInEuro("ultimate"),
      },
    },
  };
}
