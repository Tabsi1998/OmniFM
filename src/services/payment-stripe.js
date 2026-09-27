// OmniFM: turning a paid Stripe checkout into a license, with mails.
// Split out of src/services/payment.js (#295).
import { log } from "../lib/logging.js";
import {
  TIERS,
  normalizeSeats,
  sanitizeOfferCode,
  formatEuroCentsDe,
  clipText,
} from "../lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import {
  isConfigured as isEmailConfigured,
  buildPurchaseEmail,
  buildInvoiceEmail,
  buildAdminNotification,
} from "../email.js";
import {
  isSessionProcessed,
  markSessionProcessed,
  createOrExtendLicenseForEmail,
} from "../premium-store.js";
import { markOfferRedemption } from "../coupon-store.js";
import { buildInviteOverviewForTier, resolvePublicWebsiteUrl } from "../lib/api-helpers.js";
import { sendMailWithRetry } from "./payment.js";

export async function activatePaidStripeSession(session, runtimes, source = "verify") {
  const fallbackLanguage = normalizeLanguage(session?.metadata?.language, getDefaultLanguage());
  const t = (de, en) => (fallbackLanguage === "de" ? de : en);
  if (!session || session.payment_status !== "paid" || !session.metadata) {
    return { success: false, status: 400, message: t("Zahlung nicht abgeschlossen oder ungültig.", "Payment not completed or invalid.") };
  }

  const sessionId = String(session.id || "").trim();
  if (!sessionId) {
    return { success: false, status: 400, message: t("session.id fehlt.", "session.id is missing.") };
  }

  const {
    email: metaEmail,
    tier,
    months,
    seats,
    language,
    appliedOfferCode: metaAppliedOfferCode,
    appliedOfferKind: metaAppliedOfferKind,
    couponCode: metaCouponCode,
    referralCode: metaReferralCode,
    discountCents: metaDiscountCents,
    baseAmountCents: metaBaseAmountCents,
    finalAmountCents: metaFinalAmountCents,
    offerOwnerLabel: metaOfferOwnerLabel,
  } = session.metadata;
  const customerEmail = String(metaEmail || session.customer_details?.email || "").trim().toLowerCase();
  const cleanTier = String(tier || "").trim().toLowerCase();
  const cleanSeats = [1, 2, 3, 5].includes(Number(seats)) ? Number(seats) : 1;
  const durationMonths = Math.max(1, parseInt(months, 10) || 1);
  const customerLanguage = normalizeLanguage(language, fallbackLanguage);
  const amountPaid = Math.max(0, Number.parseInt(String(session.amount_total || 0), 10) || 0);
  const baseAmountCentsMeta = Math.max(0, Number.parseInt(String(metaBaseAmountCents || 0), 10) || 0);
  const discountCentsMeta = Math.max(0, Number.parseInt(String(metaDiscountCents || 0), 10) || 0);
  const finalAmountCentsMeta = Math.max(0, Number.parseInt(String(metaFinalAmountCents || 0), 10) || 0);
  const appliedOfferCode = sanitizeOfferCode(metaAppliedOfferCode || metaCouponCode);
  const referralCode = sanitizeOfferCode(metaReferralCode);
  const appliedOfferKind = ["coupon", "referral"].includes(String(metaAppliedOfferKind || "").toLowerCase())
    ? String(metaAppliedOfferKind).toLowerCase()
    : (appliedOfferCode ? "coupon" : null);
  const offerOwnerLabel = clipText(metaOfferOwnerLabel || "", 160) || null;

  const baseAmountCents = baseAmountCentsMeta > 0
    ? baseAmountCentsMeta
    : Math.max(0, amountPaid + discountCentsMeta);
  const discountCents = Math.max(
    0,
    discountCentsMeta > 0
      ? discountCentsMeta
      : Math.max(0, baseAmountCents - Math.max(amountPaid, finalAmountCentsMeta))
  );
  const finalAmountCents = Math.max(
    0,
    amountPaid > 0
      ? amountPaid
      : (finalAmountCentsMeta > 0 ? finalAmountCentsMeta : Math.max(0, baseAmountCents - discountCents))
  );

  if (!customerEmail || !["pro", "ultimate"].includes(cleanTier)) {
    return {
      success: false,
      status: 400,
      message: customerLanguage === "de"
        ? "Session-Metadaten sind ungültig (E-Mail oder Tier fehlt)."
        : "Session metadata is invalid (email or tier missing).",
    };
  }

  if (isSessionProcessed(sessionId)) {
    return {
      success: true,
      replay: true,
      email: customerEmail,
      tier: cleanTier,
      message: customerLanguage === "de"
        ? `Session ${sessionId} wurde bereits verarbeitet.`
        : `Session ${sessionId} has already been processed.`,
    };
  }

  let license;
  let licenseChange;
  try {
    licenseChange = createOrExtendLicenseForEmail({
      plan: cleanTier,
      seats: cleanSeats,
      billingPeriod: durationMonths >= 12 ? "yearly" : "monthly",
      months: durationMonths,
      activatedBy: "stripe",
      note: `Session: ${sessionId}`,
      contactEmail: customerEmail,
      preferredLanguage: customerLanguage,
    });
    license = licenseChange.license;
  } catch (err) {
    return { success: false, status: 400, message: err.message || String(err) };
  }

  const effectiveTier = String(license?.plan || cleanTier);
  const effectiveSeats = normalizeSeats(license?.seats || cleanSeats);
  const isUpgrade = Boolean(licenseChange?.upgraded);
  const isRenewal = Boolean(licenseChange?.extended && !licenseChange?.upgraded);

  if (appliedOfferCode || referralCode) {
    markOfferRedemption(sessionId, {
      source,
      email: customerEmail,
      code: appliedOfferCode || null,
      kind: appliedOfferKind || null,
      referralCode: referralCode || null,
      tier: effectiveTier,
      seats: effectiveSeats,
      months: durationMonths,
      baseAmountCents,
      discountCents,
      finalAmountCents,
    });
  }

  markSessionProcessed(sessionId, {
    email: customerEmail,
    tier: effectiveTier,
    licenseId: license.id,
    source,
    seats: effectiveSeats,
    months: durationMonths,
    expiresAt: license.expiresAt,
    language: customerLanguage,
    created: Boolean(licenseChange?.created),
    renewed: isRenewal,
    upgraded: isUpgrade,
    replayProtected: true,
    appliedOfferCode: appliedOfferCode || null,
    appliedOfferKind: appliedOfferKind || null,
    referralCode: referralCode || null,
    amountPaidCents: amountPaid,
    baseAmountCents,
    discountCents,
    finalAmountCents,
  });

  const emailDelivery = {
    smtpConfigured: isEmailConfigured(),
    purchaseSent: false,
    invoiceSent: false,
    adminSent: false,
    errors: [],
  };

  if (emailDelivery.smtpConfigured && customerEmail) {
    const tierConfig = TIERS[effectiveTier] || TIERS[cleanTier];
    const inviteOverview = buildInviteOverviewForTier(runtimes, effectiveTier);

    const purchaseHtml = buildPurchaseEmail({
      tier: effectiveTier,
      tierName: tierConfig.name,
      months: durationMonths,
      licenseKey: license.id,
      seats: effectiveSeats,
      email: customerEmail,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade,
      isRenewal,
      pricePaid: amountPaid,
      baseAmountCents,
      discountCents,
      appliedOfferCode,
      appliedOfferKind,
      referralCode,
      offerOwnerLabel,
      currency: session.currency || "eur",
      language: customerLanguage,
    });
    let purchaseSubject;
    if (isUpgrade) {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Upgrade bestätigt`
        : `OmniFM ${tierConfig.name} - Upgrade confirmed`;
    } else if (isRenewal) {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Verlängerung bestätigt`
        : `OmniFM ${tierConfig.name} - Renewal confirmed`;
    } else {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Dein Lizenz-Key`
        : `OmniFM ${tierConfig.name} - Your license key`;
    }

    const invoiceId = `OFM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${sessionId.slice(-8).toUpperCase()}`;
    const invoiceHtml = buildInvoiceEmail({
      invoiceId,
      sessionId,
      customerEmail,
      tier: effectiveTier,
      tierName: tierConfig.name,
      months: durationMonths,
      seats: effectiveSeats,
      isUpgrade,
      isRenewal,
      amountPaid,
      currency: session.currency || "eur",
      licenseKey: license.id,
      expiresAt: license.expiresAt,
      baseAmountCents,
      discountCents,
      appliedOfferCode,
      appliedOfferKind,
      referralCode,
      offerOwnerLabel,
      language: customerLanguage,
    });
    const invoiceSubject = customerLanguage === "de"
      ? `OmniFM Rechnung ${invoiceId}`
      : `OmniFM Invoice ${invoiceId}`;

    const [purchaseResult, invoiceResult] = await Promise.all([
      sendMailWithRetry({
        to: customerEmail,
        subject: purchaseSubject,
        html: purchaseHtml,
        label: "purchase-mail",
        maxAttempts: 2,
      }),
      sendMailWithRetry({
        to: customerEmail,
        subject: invoiceSubject,
        html: invoiceHtml,
        label: "invoice-mail",
        maxAttempts: 2,
      }),
    ]);

    emailDelivery.purchaseSent = Boolean(purchaseResult?.success);
    emailDelivery.invoiceSent = Boolean(invoiceResult?.success);
    if (!emailDelivery.purchaseSent) emailDelivery.errors.push(`purchase:${purchaseResult?.error || "unknown"}`);
    if (!emailDelivery.invoiceSent) emailDelivery.errors.push(`invoice:${invoiceResult?.error || "unknown"}`);

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: effectiveTier,
        tierName: tierConfig.name,
        months: durationMonths,
        serverId: "-",
        expiresAt: license.expiresAt,
        pricePaid: amountPaid,
        language: customerLanguage,
      });
      const adminSubject = customerLanguage === "de"
        ? `OmniFM Kauf eingegangen (${tierConfig.name})`
        : `OmniFM purchase received (${tierConfig.name})`;
      const adminResult = await sendMailWithRetry({
        to: adminEmail,
        subject: adminSubject,
        html: adminHtml,
        label: "admin-notification",
        maxAttempts: 1,
      });
      emailDelivery.adminSent = Boolean(adminResult?.success);
      if (!emailDelivery.adminSent) emailDelivery.errors.push(`admin:${adminResult?.error || "unknown"}`);
    }
  } else if (!emailDelivery.smtpConfigured) {
    emailDelivery.errors.push("smtp_not_configured");
    log("ERROR", `[Email] SMTP nicht konfiguriert - keine Kauf-E-Mail für ${customerEmail} möglich.`);
  } else {
    emailDelivery.errors.push("customer_email_missing");
    log("ERROR", "[Email] Kunden-E-Mail fehlt - keine Kauf-E-Mail möglich.");
  }

  log(
    "INFO",
    `[License] ${licenseChange?.created ? "Erstellt" : isUpgrade ? "Upgrade+Verlängerung" : "Verlängert"}: ${license.id} für ${customerEmail} (${effectiveTier}, ${effectiveSeats} Seats, +${durationMonths}mo, paid=${amountPaid}, discount=${discountCents}, code=${appliedOfferCode || "-"}, ref=${referralCode || "-"}) via ${source} | email purchase=${emailDelivery.purchaseSent} invoice=${emailDelivery.invoiceSent} admin=${emailDelivery.adminSent}`
  );

  const tierNameForMessage = TIERS[effectiveTier]?.name || TIERS[cleanTier]?.name || "Premium";
  let message;
  if (isUpgrade) {
    message = customerLanguage === "de"
      ? `Upgrade auf ${tierNameForMessage} abgeschlossen! Dein Lizenz-Key bleibt: ${license.id} - Prüfe deine E-Mail (${customerEmail}).`
      : `Upgrade to ${tierNameForMessage} completed! Your license key remains: ${license.id} - Check your email (${customerEmail}).`;
  } else if (isRenewal) {
    message = customerLanguage === "de"
      ? `${tierNameForMessage} verlängert! Dein bestehender Lizenz-Key bleibt: ${license.id} - Prüfe deine E-Mail (${customerEmail}).`
      : `${tierNameForMessage} renewed! Your existing license key remains: ${license.id} - Check your email (${customerEmail}).`;
  } else {
    message = customerLanguage === "de"
      ? `${tierNameForMessage} aktiviert! Lizenz-Key: ${license.id} - Prüfe deine E-Mail (${customerEmail}).`
      : `${tierNameForMessage} activated! License key: ${license.id} - Check your email (${customerEmail}).`;
  }

  if (discountCents > 0 && appliedOfferCode) {
    const discountLabel = customerLanguage === "de"
      ? ` Rabatt angewendet: ${formatEuroCentsDe(discountCents)} EUR (${appliedOfferCode}).`
      : ` Discount applied: EUR ${(discountCents / 100).toFixed(2)} (${appliedOfferCode}).`;
    message += discountLabel;
  }

  if (!emailDelivery.smtpConfigured) {
    message += customerLanguage === "de"
      ? " Hinweis: SMTP ist aktuell nicht konfiguriert, daher wurde keine E-Mail versendet."
      : " Note: SMTP is not configured, so no email could be sent.";
  } else if (!emailDelivery.purchaseSent || !emailDelivery.invoiceSent) {
    const missingPartsDe = [
      !emailDelivery.purchaseSent ? "Lizenz-Mail" : "",
      !emailDelivery.invoiceSent ? "Rechnung" : "",
    ].filter(Boolean).join(" + ");
    const missingPartsEn = [
      !emailDelivery.purchaseSent ? "license email" : "",
      !emailDelivery.invoiceSent ? "invoice" : "",
    ].filter(Boolean).join(" + ");
    message += customerLanguage === "de"
      ? ` Achtung: ${missingPartsDe} konnte nicht zugestellt werden. Bitte Support kontaktieren.`
      : ` Warning: ${missingPartsEn} could not be delivered. Please contact support.`;
  }

  return {
    success: true,
    email: customerEmail,
    tier: effectiveTier,
    licenseKey: license.id,
    expiresAt: license.expiresAt,
    seats: effectiveSeats,
    language: customerLanguage,
    amountPaid,
    discountCents,
    baseAmountCents,
    finalAmountCents,
    appliedOfferCode: appliedOfferCode || null,
    appliedOfferKind: appliedOfferKind || null,
    referralCode: referralCode || null,
    emailStatus: emailDelivery,
    message,
    created: Boolean(licenseChange?.created),
    renewed: isRenewal,
    upgraded: isUpgrade,
  };
}
