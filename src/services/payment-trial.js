// OmniFM: the free Pro trial month, with its mail.
// Split out of src/services/payment.js (#295).
import { log } from "../lib/logging.js";
import {
  TIERS,
  PRO_TRIAL_MONTHS,
  PRO_TRIAL_SEATS,
  isValidEmailAddress,
  isProTrialEnabled,
} from "../lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import {
  isConfigured as isEmailConfigured,
  buildPurchaseEmail,
  buildAdminNotification,
} from "../email.js";
import {
  reserveTrialClaim,
  finalizeTrialClaim,
  releaseTrialClaim,
  listLicensesByContactEmail,
  createLicense,
} from "../premium-store.js";
import { buildInviteOverviewForTier, resolvePublicWebsiteUrl } from "../lib/api-helpers.js";
import { sendMailWithRetry } from "./payment.js";
import { botTranslator } from "../lib/bot-i18n.js";

export async function activateProTrial({ email, language, runtimes, source = "trial" }) {
  const customerLanguage = normalizeLanguage(language, getDefaultLanguage());
  const t = botTranslator(customerLanguage);
  const customerEmail = String(email || "").trim().toLowerCase();

  if (!isProTrialEnabled()) {
    return {
      success: false,
      status: 403,
      message: t(
        "Der Pro-Testmonat ist aktuell deaktiviert.",
        "The Pro trial month is currently disabled."
      ),
    };
  }

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

  const existingForEmail = listLicensesByContactEmail(customerEmail);
  if (existingForEmail.length > 0) {
    return {
      success: false,
      status: 409,
      message: t(
        "Für diese E-Mail existiert bereits eine Lizenz. Der Testmonat ist nur einmalig für Neukunden verfügbar.",
        "A license already exists for this email. The trial month is only available once for new customers."
      ),
    };
  }

  const reserved = reserveTrialClaim(customerEmail, {
    source,
    preferredLanguage: customerLanguage,
    requestedAt: new Date().toISOString(),
  });

  if (!reserved.ok) {
    return {
      success: false,
      status: 409,
      message: t(
        "Der Pro-Testmonat wurde für diese E-Mail bereits genutzt.",
        "The Pro trial month has already been used for this email."
      ),
    };
  }

  let license;
  try {
    license = createLicense({
      plan: "pro",
      seats: PRO_TRIAL_SEATS,
      billingPeriod: "monthly",
      months: PRO_TRIAL_MONTHS,
      activatedBy: "trial",
      note: `Trial via ${source}`,
      contactEmail: customerEmail,
      preferredLanguage: customerLanguage,
    });
  } catch (err) {
    releaseTrialClaim(customerEmail);
    return {
      success: false,
      status: 500,
      message: t(
        "Der Pro-Testmonat konnte nicht erstellt werden. Bitte später erneut versuchen.",
        "Could not create the Pro trial month. Please try again later."
      ),
      detail: err?.message || String(err),
    };
  }

  finalizeTrialClaim(customerEmail, {
    source,
    licenseId: license.id,
    tier: "pro",
    seats: PRO_TRIAL_SEATS,
    months: PRO_TRIAL_MONTHS,
    expiresAt: license.expiresAt,
    activatedBy: "trial",
  });

  const emailDelivery = {
    smtpConfigured: isEmailConfigured(),
    purchaseSent: false,
    invoiceSent: false,
    adminSent: false,
    errors: [],
  };

  if (emailDelivery.smtpConfigured) {
    const tierConfig = TIERS.pro;
    const isDe = customerLanguage === "de";
    const inviteOverview = buildInviteOverviewForTier(runtimes, "pro");
    const purchaseHtml = buildPurchaseEmail({
      tier: "pro",
      tierName: isDe ? `${tierConfig.name} Testmonat` : `${tierConfig.name} Trial Month`,
      months: PRO_TRIAL_MONTHS,
      licenseKey: license.id,
      seats: PRO_TRIAL_SEATS,
      email: customerEmail,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade: false,
      pricePaid: 0,
      currency: "eur",
      language: customerLanguage,
    });
    const purchaseSubject = isDe
      ? "OmniFM Pro Testmonat - Dein Lizenz-Key"
      : "OmniFM Pro Trial Month - Your license key";

    const purchaseResult = await sendMailWithRetry({
      to: customerEmail,
      subject: purchaseSubject,
      html: purchaseHtml,
      label: "trial-license-mail",
      maxAttempts: 2,
    });
    emailDelivery.purchaseSent = Boolean(purchaseResult?.success);
    if (!emailDelivery.purchaseSent) {
      emailDelivery.errors.push(`purchase:${purchaseResult?.error || "unknown"}`);
    }

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: "pro",
        tierName: isDe ? "Pro Testmonat" : "Pro Trial Month",
        months: PRO_TRIAL_MONTHS,
        serverId: "-",
        expiresAt: license.expiresAt,
        pricePaid: 0,
        language: customerLanguage,
      });
      const adminSubject = isDe
        ? "OmniFM Pro-Testmonat aktiviert"
        : "OmniFM Pro trial activated";
      const adminResult = await sendMailWithRetry({
        to: adminEmail,
        subject: adminSubject,
        html: adminHtml,
        label: "trial-admin-notification",
        maxAttempts: 1,
      });
      emailDelivery.adminSent = Boolean(adminResult?.success);
      if (!emailDelivery.adminSent) {
        emailDelivery.errors.push(`admin:${adminResult?.error || "unknown"}`);
      }
    }
  } else {
    emailDelivery.errors.push("smtp_not_configured");
    log("ERROR", `[Email] SMTP nicht konfiguriert - keine Trial-E-Mail für ${customerEmail} möglich.`);
  }

  log(
    "INFO",
    `[Trial] Pro-Test aktiviert: ${license.id} für ${customerEmail} | email purchase=${emailDelivery.purchaseSent} admin=${emailDelivery.adminSent}`
  );

  let message = customerLanguage === "de"
    ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id} - Prüfe deine E-Mail (${customerEmail}).`
    : `Pro trial month activated! License key: ${license.id} - Check your email (${customerEmail}).`;

  if (!emailDelivery.smtpConfigured) {
    message = customerLanguage === "de"
      ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id}. Hinweis: SMTP ist nicht konfiguriert, daher wurde keine E-Mail versendet.`
      : `Pro trial month activated! License key: ${license.id}. Note: SMTP is not configured, so no email was sent.`;
  } else if (!emailDelivery.purchaseSent) {
    message = customerLanguage === "de"
      ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id}. Achtung: Die Lizenz-Mail konnte nicht zugestellt werden. Bitte Support kontaktieren.`
      : `Pro trial month activated! License key: ${license.id}. Warning: The license email could not be delivered. Please contact support.`;
  }

  return {
    success: true,
    email: customerEmail,
    tier: "pro",
    licenseKey: license.id,
    expiresAt: license.expiresAt,
    seats: PRO_TRIAL_SEATS,
    months: PRO_TRIAL_MONTHS,
    language: customerLanguage,
    emailStatus: emailDelivery,
    message,
  };
}
