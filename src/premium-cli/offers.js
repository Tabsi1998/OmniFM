// OmniFM: premium CLI: the coupon and referral offers menu.
// Split out of src/premium-cli.js (#295).
/* eslint-disable no-await-in-loop -- an interactive menu: each question waits for the answer before it */
import {
  deleteOffer,
  listOffers,
  listRecentRedemptions,
  setOfferActive,
  upsertOffer,
} from "../coupon-store.js";
import { ask, centsToEur, fail, formatDate, info, ok, warn } from "../premium-cli.js";

function parseCsvValues(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function parseEuroToCents(raw) {
  const normalized = String(raw || "").trim().replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.round(parsed * 100));
}

function normalizeCodeInput(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40);
}

async function askWithDefault(label, defaultValue = "") {
  const displayDefault = String(defaultValue ?? "").trim();
  const answer = (await ask(displayDefault ? `${label} [${displayDefault}]` : label)).trim();
  return answer || displayDefault;
}

function printOffersTable(offers) {
  if (!offers.length) {
    info("Keine Coupon/Referral-Codes vorhanden.");
    return;
  }

  console.log("");
  console.log("  Code                 Typ       Status    Nutzen                  Regeln");
  console.log("  " + "-".repeat(100));
  for (const offer of offers) {
    const code = String(offer.code || "-").padEnd(20);
    const kind = String(offer.kind || "coupon").padEnd(8);
    const status = offer.active ? "aktiv" : "inaktiv";
    const benefit = offer.fulfillmentMode === "direct_grant"
      ? `Gratis ${String(offer.grantPlan || "-").toUpperCase()} ${offer.grantMonths || "-"}mo / ${offer.grantSeats || "-"} Seat`
      : (Number(offer.percentOff || 0) > 0
        ? `${offer.percentOff}%`
        : `${centsToEur(Number(offer.amountOffCents || 0))} fix`);
    const restrictions = [];
    if (Array.isArray(offer.allowedTiers) && offer.allowedTiers.length) restrictions.push(`tier=${offer.allowedTiers.join("/")}`);
    if (Array.isArray(offer.allowedSeats) && offer.allowedSeats.length) restrictions.push(`seats=${offer.allowedSeats.join("/")}`);
    if (Number.isFinite(Number(offer.minMonths)) && Number(offer.minMonths) > 0) restrictions.push(`min=${offer.minMonths}mo`);
    if (Number.isFinite(Number(offer.maxRedemptions)) && Number(offer.maxRedemptions) > 0) restrictions.push(`max=${offer.maxRedemptions}`);
    const stats = offer.redemptions?.total ? `used=${offer.redemptions.total}` : "used=0";
    restrictions.push(stats);
    console.log(`  ${code}${kind}${status.padEnd(10)}${benefit.padEnd(24)}${restrictions.join(" | ")}`);
  }
  console.log("");
}

function printRedemptionsTable(redemptions) {
  if (!redemptions.length) {
    info("Keine Redemptions gefunden.");
    return;
  }

  console.log("");
  console.log("  Zeit                Session                 Code         Art       Betrag");
  console.log("  " + "-".repeat(88));
  for (const entry of redemptions) {
    const when = formatDate(entry.processedAt).padEnd(20);
    const session = String(entry.sessionId || "-").slice(0, 22).padEnd(22);
    const code = String(entry.code || "-").padEnd(12);
    const kind = String(entry.kind || "-").padEnd(10);
    const amount = `${centsToEur(Number(entry.finalAmountCents || 0))} (disc ${centsToEur(Number(entry.discountCents || 0))})`;
    console.log(`  ${when}${session}${code}${kind}${amount}`);
    if (entry.email) {
      console.log(`    ${entry.email} | tier=${entry.tier || "-"} | seats=${entry.seats || "-"} | months=${entry.months || "-"}`);
    }
  }
  console.log("");
}

function findOfferByCode(code) {
  const normalizedCode = normalizeCodeInput(code);
  if (!normalizedCode) return null;
  return listOffers({ includeInactive: true, includeStats: false })
    .find((entry) => String(entry.code || "").toUpperCase() === normalizedCode) || null;
}

async function askOfferDiscount(existing, labelPrefix = "") {
  const prefix = labelPrefix ? `${labelPrefix} ` : "";
  const percentDefault = String(existing?.percentOff || 0);
  const amountDefault = Number(existing?.amountOffCents || 0) > 0
    ? (Number(existing.amountOffCents) / 100).toFixed(2).replace(".", ",")
    : "0";

  const percentOff = Math.max(0, parseInt(await askWithDefault(`${prefix}Rabatt in Prozent (0-95)`, percentDefault), 10) || 0);
  const amountOffCents = parseEuroToCents(await askWithDefault(`${prefix}Fix-Rabatt in EUR (z.B. 2,50)`, amountDefault));
  if (percentOff <= 0 && amountOffCents <= 0) return null;

  return {
    percentOff: Math.min(95, percentOff),
    amountOffCents,
  };
}

async function askOfferBenefitConfig(existing, labelPrefix = "") {
  const prefix = labelPrefix ? `${labelPrefix} ` : "";
  const modeRaw = (await askWithDefault(
    `${prefix}Einlöselogik (discount/direct_grant)`,
    existing?.fulfillmentMode || "discount"
  )).toLowerCase();
  const fulfillmentMode = modeRaw === "direct_grant" ? "direct_grant" : "discount";

  if (fulfillmentMode === "direct_grant") {
    const grantPlan = (await askWithDefault(
      `${prefix}Gratis-Plan (pro/ultimate)`,
      existing?.grantPlan || "pro"
    )).toLowerCase();
    if (grantPlan !== "pro" && grantPlan !== "ultimate") return null;

    const grantSeats = parseInt(await askWithDefault(
      `${prefix}Gratis-Seats (1/2/3/5)`,
      existing?.grantSeats ? String(existing.grantSeats) : "1"
    ), 10);
    if (![1, 2, 3, 5].includes(grantSeats)) return null;

    const grantMonths = parseInt(await askWithDefault(
      `${prefix}Gratis-Monate`,
      existing?.grantMonths ? String(existing.grantMonths) : "1"
    ), 10);
    if (!Number.isFinite(grantMonths) || grantMonths <= 0) return null;

    return {
      fulfillmentMode,
      percentOff: 0,
      amountOffCents: 0,
      grantPlan,
      grantSeats,
      grantMonths,
    };
  }

  const discount = await askOfferDiscount(existing, labelPrefix);
  if (!discount) return null;
  return {
    fulfillmentMode,
    percentOff: discount.percentOff,
    amountOffCents: discount.amountOffCents,
    grantPlan: null,
    grantSeats: null,
    grantMonths: null,
  };
}

function parseAllowedSeatsInput(raw) {
  return parseCsvValues(raw)
    .map((entry) => parseInt(entry, 10))
    .filter((entry) => [1, 2, 3, 5].includes(entry));
}

async function quickTierOfferSetup() {
  console.log("");
  info("Schnellsetup: getrennte Codes für PRO und ULTIMATE mit Rabatt oder Gratis-Lizenz.");
  info("Jeder Code wird automatisch auf sein Tier begrenzt (allowedTiers).");
  console.log("");

  const kindRaw = (await askWithDefault("Typ (coupon/referral)", "coupon")).toLowerCase();
  const kind = kindRaw === "referral" ? "referral" : "coupon";
  const fulfillmentModeRaw = (await askWithDefault("Einlöselogik (discount/direct_grant)", "discount")).toLowerCase();
  const fulfillmentMode = fulfillmentModeRaw === "direct_grant" ? "direct_grant" : "discount";
  const ownerLabel = await askWithDefault("Owner Label (optional)", "");
  const note = await askWithDefault("Notiz (optional)", "");
  const activeAnswer = (await askWithDefault("Aktiv? (j/n)", "j")).toLowerCase();
  const active = activeAnswer === "j" || activeAnswer === "y";
  const seatsCsv = await askWithDefault("Allowed seats (csv, leer=alle)", "");
  const allowedSeats = parseAllowedSeatsInput(seatsCsv);
  const minMonthsRaw = await askWithDefault("Mindestlaufzeit Monate (leer=keine)", "");
  const minMonths = minMonthsRaw ? Math.max(1, parseInt(minMonthsRaw, 10) || 0) : null;
  const maxRedemptionsRaw = await askWithDefault("Max Redemptions total (leer=unbegrenzt)", "");
  const maxRedemptions = maxRedemptionsRaw ? Math.max(1, parseInt(maxRedemptionsRaw, 10) || 0) : null;
  const maxPerEmailRaw = await askWithDefault("Max pro E-Mail (leer=unbegrenzt)", "");
  const maxPerEmail = maxPerEmailRaw ? Math.max(1, parseInt(maxPerEmailRaw, 10) || 0) : null;
  const startsAt = await askWithDefault("Startzeit ISO (leer=sofort)", "");
  const expiresAt = await askWithDefault("Ablaufzeit ISO (leer=kein Ablauf)", "");
  const sharedGrantSeats = fulfillmentMode === "direct_grant"
    ? parseInt(await askWithDefault("Gratis-Seats für beide Codes (1/2/3/5)", "1"), 10)
    : null;
  const sharedGrantMonths = fulfillmentMode === "direct_grant"
    ? parseInt(await askWithDefault("Gratis-Monate für beide Codes", "1"), 10)
    : null;

  if (fulfillmentMode === "direct_grant" && ![1, 2, 3, 5].includes(sharedGrantSeats)) {
    fail("Gratis-Seats müssen 1, 2, 3 oder 5 sein.");
    return;
  }
  if (fulfillmentMode === "direct_grant" && (!Number.isFinite(sharedGrantMonths) || sharedGrantMonths <= 0)) {
    fail("Gratis-Monate müssen größer als 0 sein.");
    return;
  }

  const tiers = [
    { tier: "pro", label: "PRO", codeDefault: "PRO10" },
    { tier: "ultimate", label: "ULTIMATE", codeDefault: "ULTI15" },
  ];

  let savedCount = 0;
  for (const entry of tiers) {
    console.log("");
    const codeRaw = await askWithDefault(`Code für ${entry.label} (leer=überspringen)`, entry.codeDefault);
    const code = normalizeCodeInput(codeRaw);
    if (!code) {
      info(`${entry.label}: übersprungen.`);
      continue;
    }

    const existing = findOfferByCode(code);
    const benefitConfig = fulfillmentMode === "direct_grant"
      ? {
        fulfillmentMode,
        percentOff: 0,
        amountOffCents: 0,
        grantPlan: entry.tier,
        grantSeats: sharedGrantSeats,
        grantMonths: sharedGrantMonths,
      }
      : await askOfferBenefitConfig(existing, `${entry.label}:`);
    if (!benefitConfig) {
      fail(`${entry.label}: ungültige Rabatt-/Gratis-Konfiguration, übersprungen.`);
      continue;
    }

    try {
      const saved = upsertOffer({
        code,
        kind,
        active,
        fulfillmentMode: benefitConfig.fulfillmentMode,
        percentOff: benefitConfig.percentOff,
        amountOffCents: benefitConfig.amountOffCents,
        grantPlan: benefitConfig.grantPlan,
        grantSeats: benefitConfig.grantSeats,
        grantMonths: benefitConfig.grantMonths,
        allowedTiers: [entry.tier],
        allowedSeats: allowedSeats.length ? allowedSeats : (benefitConfig.grantSeats ? [benefitConfig.grantSeats] : []),
        minMonths,
        maxRedemptions,
        maxPerEmail,
        startsAt: startsAt || null,
        expiresAt: expiresAt || null,
        ownerLabel: ownerLabel || null,
        note: note || null,
        updatedBy: "premium-cli-quick",
        createdBy: existing?.createdBy || "premium-cli-quick",
      }, { partial: false });
      ok(`${entry.label}: Code ${saved.code} gespeichert (${saved.kind}, ${saved.fulfillmentMode}).`);
      savedCount += 1;
    } catch (err) {
      fail(`${entry.label}: Speichern fehlgeschlagen: ${err?.message || err}`);
    }
  }

  if (savedCount > 0) {
    ok(`Schnellsetup abgeschlossen (${savedCount} Code(s) gespeichert).`);
  } else {
    warn("Schnellsetup abgeschlossen, aber kein Code gespeichert.");
  }
  console.log("");
}

export async function manageOffersMenu() {
  while (true) {
    console.log("  Coupon/Referral Verwaltung:");
    console.log("    1) Codes anzeigen");
    console.log("    2) Schnellsetup PRO + ULTIMATE Codes (Rabatt oder Gratis)");
    console.log("    3) Code anlegen/aktualisieren (erweitert inkl. Gratis-Lizenz)");
    console.log("    4) Code aktiv/inaktiv setzen");
    console.log("    5) Code löschen");
    console.log("    6) Letzte Redemptions anzeigen");
    console.log("    7) Zurück");
    console.log("");
    const choice = (await ask("Aktion")).trim();

    if (choice === "1") {
      const offers = listOffers({ includeInactive: true, includeStats: true });
      printOffersTable(offers);
      continue;
    }

    if (choice === "2") {
      await quickTierOfferSetup();
      continue;
    }

    if (choice === "3") {
      const code = normalizeCodeInput(await ask("Code (z.B. PRO10)"));
      if (!code) {
        fail("Code fehlt oder ungültig.");
        continue;
      }

      const existing = findOfferByCode(code);

      const kindRaw = (await askWithDefault("Typ (coupon/referral)", existing?.kind || "coupon")).toLowerCase();
      const kind = kindRaw === "referral" ? "referral" : "coupon";
      const benefitConfig = await askOfferBenefitConfig(existing);
      if (!benefitConfig) {
        fail("Rabatt-/Gratis-Konfiguration ist ungültig.");
        continue;
      }

      const activeAnswer = (await askWithDefault("Aktiv? (j/n)", existing ? (existing.active ? "j" : "n") : "j")).toLowerCase();
      const active = activeAnswer === "j" || activeAnswer === "y";
      const tiers = parseCsvValues(await askWithDefault("Allowed tiers (csv, leer=alle)", (existing?.allowedTiers || []).join(",")))
        .map((entry) => entry.toLowerCase())
        .filter((entry) => entry === "pro" || entry === "ultimate");
      const seats = parseAllowedSeatsInput(await askWithDefault("Allowed seats (csv, leer=alle)", (existing?.allowedSeats || []).join(",")));
      const minMonthsRaw = await askWithDefault("Mindestlaufzeit Monate (leer=keine)", existing?.minMonths ? String(existing.minMonths) : "");
      const minMonths = minMonthsRaw ? Math.max(1, parseInt(minMonthsRaw, 10) || 0) : null;
      const maxRedemptionsRaw = await askWithDefault("Max Redemptions total (leer=unbegrenzt)", existing?.maxRedemptions ? String(existing.maxRedemptions) : "");
      const maxRedemptions = maxRedemptionsRaw ? Math.max(1, parseInt(maxRedemptionsRaw, 10) || 0) : null;
      const maxPerEmailRaw = await askWithDefault("Max pro E-Mail (leer=unbegrenzt)", existing?.maxPerEmail ? String(existing.maxPerEmail) : "");
      const maxPerEmail = maxPerEmailRaw ? Math.max(1, parseInt(maxPerEmailRaw, 10) || 0) : null;
      const startsAt = await askWithDefault("Startzeit ISO (leer=sofort)", existing?.startsAt || "");
      const expiresAt = await askWithDefault("Ablaufzeit ISO (leer=kein Ablauf)", existing?.expiresAt || "");
      const ownerLabel = await askWithDefault("Owner Label (optional)", existing?.ownerLabel || "");
      const note = await askWithDefault("Notiz (optional)", existing?.note || "");

      try {
        const saved = upsertOffer({
          code,
          kind,
          active,
          fulfillmentMode: benefitConfig.fulfillmentMode,
          percentOff: benefitConfig.percentOff,
          amountOffCents: benefitConfig.amountOffCents,
          grantPlan: benefitConfig.grantPlan,
          grantSeats: benefitConfig.grantSeats,
          grantMonths: benefitConfig.grantMonths,
          allowedTiers: tiers,
          allowedSeats: seats,
          minMonths,
          maxRedemptions,
          maxPerEmail,
          startsAt: startsAt || null,
          expiresAt: expiresAt || null,
          ownerLabel: ownerLabel || null,
          note: note || null,
          updatedBy: "premium-cli",
          createdBy: existing?.createdBy || "premium-cli",
        }, { partial: false });
        ok(`Code ${saved.code} gespeichert (${saved.kind}).`);
      } catch (err) {
        fail(`Speichern fehlgeschlagen: ${err?.message || err}`);
      }
      continue;
    }

    if (choice === "4") {
      const code = normalizeCodeInput(await ask("Code"));
      if (!code) {
        fail("Code fehlt.");
        continue;
      }
      const activeAnswer = (await askWithDefault("Aktiv setzen? (j/n)", "j")).toLowerCase();
      const active = activeAnswer === "j" || activeAnswer === "y";
      const updated = setOfferActive(code, active);
      if (!updated) {
        fail("Code nicht gefunden.");
      } else {
        ok(`Code ${updated.code} ist jetzt ${updated.active ? "aktiv" : "inaktiv"}.`);
      }
      continue;
    }

    if (choice === "5") {
      const code = normalizeCodeInput(await ask("Code"));
      if (!code) {
        fail("Code fehlt.");
        continue;
      }
      const confirm = (await ask("Wirklich löschen? (j/n)")).trim().toLowerCase();
      if (confirm !== "j" && confirm !== "y") {
        info("Abgebrochen.");
        continue;
      }
      const deleted = deleteOffer(code);
      if (!deleted) {
        fail("Code nicht gefunden.");
      } else {
        ok(`Code ${code} gelöscht.`);
      }
      continue;
    }

    if (choice === "6") {
      const limitRaw = await askWithDefault("Limit", "25");
      const limit = Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 25));
      const redemptions = listRecentRedemptions(limit);
      printRedemptionsTable(redemptions);
      continue;
    }

    if (choice === "7" || choice.toLowerCase() === "q" || choice.toLowerCase() === "exit") {
      return;
    }

    fail("Ungültige Auswahl.");
    console.log("");
  }
}
