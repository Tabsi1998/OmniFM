// ============================================================
// OmniFM: licenses from codes and the trial month (no purchase since #321)
// ============================================================
import { createHash } from "node:crypto";
import { log } from "../lib/logging.js";
import {
  TIERS,
  normalizeSeats,
  isValidEmailAddress,
  sanitizeOfferCode,
  translateOfferReason,
  clipText,
  waitMs,
  calculatePrice,
} from "../lib/helpers.js";
import { getDefaultLanguage } from "../i18n.js";
import {
  isConfigured as isEmailConfigured,
  sendMail,
  buildPurchaseEmail,
  buildPurchaseSubject,
  buildAdminNotification,
} from "../email.js";
import {
  isSessionProcessed,
  getProcessedSession,
  markSessionProcessed,
  createOrExtendLicenseForEmail,
  getLicenseById,
} from "../premium-store.js";
import { markOfferRedemption, previewCheckoutOffer } from "../coupon-store.js";
import { buildInviteOverviewForTier, resolvePublicWebsiteUrl } from "../lib/api-helpers.js";
import { activateProTrial } from "./payment-trial.js";
import { botTranslator, normalizeBotLanguage } from "../lib/bot-i18n.js";

async function sendMailWithRetry({ to, subject, html, label, maxAttempts = 2 }) {
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // eslint-disable-next-line no-await-in-loop -- mail retries wait for each other
    const result = await sendMail(to, subject, html);
    if (result?.success) {
      log("INFO", `[Email] ${label} sent to ${to} (attempt ${attempt}/${maxAttempts})`);
      return { success: true, attempts: attempt };
    }

    lastError = String(result?.error || "unknown email error");
    log("ERROR", `[Email] ${label} failed for ${to} (attempt ${attempt}/${maxAttempts}): ${lastError}`);
    if (attempt < maxAttempts) {
      // eslint-disable-next-line no-await-in-loop -- mail retries wait for each other
      await waitMs(1000 * attempt);
    }
  }

  return { success: false, error: lastError, attempts: maxAttempts };
}

function resolveCheckoutOfferForRequest({
  tier,
  seats,
  months,
  email,
  couponCode,
  referralCode,
  baseAmountCents,
  language,
}) {
  const checkoutLanguage = normalizeBotLanguage(language, getDefaultLanguage());
  const normalizedCouponCode = sanitizeOfferCode(couponCode);
  const normalizedReferralCode = sanitizeOfferCode(referralCode);

  const preview = previewCheckoutOffer({
    tier,
    seats,
    months,
    email,
    baseAmountCents,
    couponCode: normalizedCouponCode,
    referralCode: normalizedReferralCode,
  });

  const couponProvided = Boolean(normalizedCouponCode);
  const referralProvided = Boolean(normalizedReferralCode);

  if (couponProvided && (!preview.coupon?.ok || preview.applied?.kind !== "coupon")) {
    return {
      ok: false,
      status: 400,
      error: translateOfferReason(preview.coupon?.reason, checkoutLanguage),
      preview,
    };
  }

  if (!couponProvided && referralProvided && (!preview.referral?.ok || preview.applied?.kind !== "referral")) {
    return {
      ok: false,
      status: 400,
      error: translateOfferReason(preview.referral?.reason, checkoutLanguage),
      preview,
    };
  }

  return {
    ok: true,
    preview,
    couponCode: normalizedCouponCode || null,
    referralCode: normalizedReferralCode || null,
  };
}

function buildOfferGrantSessionId({
  code,
  kind,
  email,
  tier,
  seats,
  months,
}) {
  const hash = createHash("sha256")
    .update([
      String(code || "").trim().toUpperCase(),
      String(kind || "coupon").trim().toLowerCase(),
      String(email || "").trim().toLowerCase(),
      String(tier || "").trim().toLowerCase(),
      String(seats || ""),
      String(months || ""),
    ].join("|"))
    .digest("hex")
    .slice(0, 16);
  return `offer_${hash}`;
}

async function activateOfferGrant({
  preview,
  email,
  language,
  runtimes,
  source = "offer-grant",
}) {
  const customerLanguage = normalizeBotLanguage(language, getDefaultLanguage());
  const t = botTranslator(customerLanguage);
  const customerEmail = String(email || "").trim().toLowerCase();
  const appliedOfferCode = sanitizeOfferCode(preview?.applied?.code);
  const referralCode = sanitizeOfferCode(preview?.attributionReferralCode || "");
  const appliedOfferKind = ["coupon", "referral"].includes(String(preview?.applied?.kind || "").toLowerCase())
    ? String(preview.applied.kind).toLowerCase()
    : (appliedOfferCode ? "coupon" : null);
  const grantPlan = String(preview?.applied?.grantPlan || "").trim().toLowerCase();
  const grantSeats = normalizeSeats(preview?.applied?.grantSeats || 1);
  const grantMonths = Math.max(1, Number.parseInt(String(preview?.applied?.grantMonths || 1), 10) || 1);
  const baseAmountCents = Math.max(0, Number(preview?.baseAmountCents || 0) || 0);
  const theoreticalAmountCents = calculatePrice(grantPlan, grantMonths, grantSeats);
  const sessionId = buildOfferGrantSessionId({
    code: appliedOfferCode,
    kind: appliedOfferKind,
    email: customerEmail,
    tier: grantPlan,
    seats: grantSeats,
    months: grantMonths,
  });

  if (!isValidEmailAddress(customerEmail)) {
    return {
      success: false,
      status: 400,
      message: t(
        "Bitte eine gültige E-Mail-Adresse eingeben.",
        "Please enter a valid email address."
      ),
    };
  }

  if (!appliedOfferCode || !appliedOfferKind || preview?.applied?.fulfillmentMode !== "direct_grant") {
    return {
      success: false,
      status: 400,
      message: t(
        "Der Code kann nicht direkt als Gratis-Lizenz eingelöst werden.",
        "This code cannot be redeemed directly as a free license."
      ),
    };
  }

  if (!["pro", "ultimate"].includes(grantPlan) || !grantSeats || grantMonths <= 0) {
    return {
      success: false,
      status: 400,
      message: t(
        "Der Code ist unvollständig konfiguriert (Plan, Seats oder Monate fehlen).",
        "The code is not fully configured (plan, seats, or months are missing)."
      ),
    };
  }

  if (isSessionProcessed(sessionId)) {
    const processed = getProcessedSession(sessionId);
    const replayLicense = processed?.licenseId ? getLicenseById(processed.licenseId) : null;
    return {
      success: true,
      replay: true,
      activated: true,
      directGrant: true,
      email: customerEmail,
      tier: String(processed?.tier || replayLicense?.plan || grantPlan).toLowerCase(),
      licenseKey: replayLicense?.id || processed?.licenseId || null,
      expiresAt: replayLicense?.expiresAt || processed?.expiresAt || null,
      seats: Number(processed?.seats || replayLicense?.seats || grantSeats) || grantSeats,
      months: Number(processed?.months || grantMonths) || grantMonths,
      amountPaid: 0,
      discountCents: Math.max(0, Number(processed?.discountCents || baseAmountCents) || baseAmountCents),
      baseAmountCents: Math.max(0, Number(processed?.baseAmountCents || theoreticalAmountCents || baseAmountCents) || 0),
      finalAmountCents: 0,
      appliedOfferCode,
      appliedOfferKind,
      referralCode: referralCode || null,
      message: t(
        "Code {code} wurde bereits für {email} eingelöst. Die vorhandene Lizenz bleibt aktiv.",
        "Code {code} was already redeemed for {email}. The existing license stays active.",
        { code: appliedOfferCode, email: customerEmail },
      ),
      emailStatus: {
        smtpConfigured: isEmailConfigured(),
        purchaseSent: false,
        invoiceSent: false,
        adminSent: false,
        errors: ["replay"],
      },
    };
  }

  let license;
  let licenseChange;
  try {
    licenseChange = createOrExtendLicenseForEmail({
      plan: grantPlan,
      seats: grantSeats,
      billingPeriod: grantMonths >= 12 ? "yearly" : "monthly",
      months: grantMonths,
      activatedBy: "offer-grant",
      note: `Offer grant: ${appliedOfferCode}`,
      contactEmail: customerEmail,
      preferredLanguage: customerLanguage,
    });
    license = licenseChange.license;
  } catch (err) {
    return {
      success: false,
      status: 400,
      message: err?.message || String(err),
    };
  }

  const effectiveTier = String(license?.plan || grantPlan).toLowerCase();
  const effectiveSeats = normalizeSeats(license?.seats || grantSeats);
  const effectiveBaseAmountCents = Math.max(0, theoreticalAmountCents || baseAmountCents || 0);
  const offerOwnerLabel = clipText(preview?.applied?.ownerLabel || "", 160) || null;
  const inviteOverview = buildInviteOverviewForTier(Array.isArray(runtimes) ? runtimes : [], effectiveTier);
  const isUpgrade = Boolean(licenseChange?.upgraded);
  const isRenewal = Boolean(licenseChange?.extended && !licenseChange?.upgraded);

  markOfferRedemption(sessionId, {
    source,
    email: customerEmail,
    code: appliedOfferCode,
    kind: appliedOfferKind,
    fulfillmentMode: "direct_grant",
    referralCode: referralCode || null,
    tier: effectiveTier,
    seats: effectiveSeats,
    months: grantMonths,
    grantPlan: grantPlan,
    grantSeats: grantSeats,
    grantMonths: grantMonths,
    baseAmountCents: effectiveBaseAmountCents,
    discountCents: effectiveBaseAmountCents,
    finalAmountCents: 0,
  });

  markSessionProcessed(sessionId, {
    email: customerEmail,
    tier: effectiveTier,
    licenseId: license.id,
    source,
    seats: effectiveSeats,
    months: grantMonths,
    expiresAt: license.expiresAt,
    language: customerLanguage,
    created: Boolean(licenseChange?.created),
    renewed: isRenewal,
    upgraded: isUpgrade,
    replayProtected: true,
    appliedOfferCode,
    appliedOfferKind,
    referralCode: referralCode || null,
    amountPaidCents: 0,
    baseAmountCents: effectiveBaseAmountCents,
    discountCents: effectiveBaseAmountCents,
    finalAmountCents: 0,
  });

  const emailDelivery = {
    smtpConfigured: isEmailConfigured(),
    purchaseSent: false,
    invoiceSent: false,
    adminSent: false,
    errors: [],
  };

  if (emailDelivery.smtpConfigured) {
    const tierConfig = TIERS[effectiveTier];
    const purchaseHtml = buildPurchaseEmail({
      tier: effectiveTier,
      tierName: tierConfig?.name || grantPlan,
      months: grantMonths,
      licenseKey: license.id,
      seats: effectiveSeats,
      email: customerEmail,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade,
      isRenewal,
      pricePaid: 0,
      baseAmountCents: effectiveBaseAmountCents,
      discountCents: effectiveBaseAmountCents,
      appliedOfferCode,
      appliedOfferKind,
      referralCode: referralCode || null,
      offerOwnerLabel,
      currency: "eur",
      language: customerLanguage,
    });
    const purchaseSubject = buildPurchaseSubject({ planName: tierConfig?.name || grantPlan, language: customerLanguage });
    const purchaseResult = await sendMailWithRetry({
      to: customerEmail,
      subject: purchaseSubject,
      html: purchaseHtml,
      label: "offer-grant-license-mail",
      maxAttempts: 2,
    });
    emailDelivery.purchaseSent = Boolean(purchaseResult?.success);
    if (!emailDelivery.purchaseSent) {
      emailDelivery.errors.push(`purchase:${purchaseResult?.error || "unknown"}`);
    }

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: effectiveTier,
        tierName: tierConfig?.name || grantPlan,
        months: grantMonths,
        serverId: "-",
        expiresAt: license.expiresAt,
        pricePaid: 0,
      });
      // The operator's mail is in the installation's language, not the customer's.
      const adminSubject = botTranslator(getDefaultLanguage())(
        "OmniFM-Gratis-Lizenz eingelöst ({code})",
        "OmniFM free license redeemed ({code})",
        { code: appliedOfferCode },
      );
      const adminResult = await sendMailWithRetry({
        to: adminEmail,
        subject: adminSubject,
        html: adminHtml,
        label: "offer-grant-admin-notification",
        maxAttempts: 1,
      });
      emailDelivery.adminSent = Boolean(adminResult?.success);
      if (!emailDelivery.adminSent) {
        emailDelivery.errors.push(`admin:${adminResult?.error || "unknown"}`);
      }
    }
  } else {
    emailDelivery.errors.push("smtp_not_configured");
  }

  return {
    success: true,
    activated: true,
    directGrant: true,
    email: customerEmail,
    tier: effectiveTier,
    licenseKey: license.id,
    expiresAt: license.expiresAt,
    seats: effectiveSeats,
    months: grantMonths,
    amountPaid: 0,
    discountCents: effectiveBaseAmountCents,
    baseAmountCents: effectiveBaseAmountCents,
    finalAmountCents: 0,
    appliedOfferCode,
    appliedOfferKind,
    referralCode: referralCode || null,
    emailStatus: emailDelivery,
    message: t(
      "Code {code} eingelöst. {plan} ist kostenlos aktiviert, die Lizenz ging an {email}.",
      "Code {code} redeemed. {plan} is activated for free; the license went to {email}.",
      { code: appliedOfferCode, plan: TIERS[effectiveTier]?.name || effectiveTier, email: customerEmail },
    ),
    created: Boolean(licenseChange?.created),
    renewed: isRenewal,
    upgraded: isUpgrade,
  };
}

export {
  sendMailWithRetry,
  resolveCheckoutOfferForRequest,
  activateOfferGrant,
  activateProTrial,
};
