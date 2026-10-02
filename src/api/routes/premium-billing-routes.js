import { botTranslator } from "../../lib/bot-i18n.js";

export function createPremiumBillingRoutesHandler(deps) {
  const {
    SEAT_OPTIONS,
    activateOfferGrant,
    activateProTrial,
    calculatePrice,
    getDashboardRequestTranslator,
    getDefaultLanguage,
    getLocalizedJsonBodyError,
    isProTrialEnabled,
    isValidEmailAddress,
    log,
    methodNotAllowed,
    normalizeDuration,
    normalizeLanguage,
    normalizeSeats,
    resolveCheckoutOfferForRequest,
    resolveLanguageFromAcceptLanguage,
    sendJson,
  } = deps;

  function resolveRequestLanguage(req, requestUrl, rawLanguage = null) {
    const acceptLanguage = req.headers["accept-language"];
    const fallbackLanguage = getDashboardRequestTranslator(
      req,
      requestUrl,
      resolveLanguageFromAcceptLanguage(acceptLanguage, getDefaultLanguage())
    ).language;
    return normalizeLanguage(rawLanguage, fallbackLanguage);
  }

  function getTranslator(language) {
    return botTranslator(language);
  }

  return async function handlePremiumBillingRoutes(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname === "/api/premium/trial") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      try {
        const body = await readJsonBody();
        const language = resolveRequestLanguage(req, requestUrl, body?.language);
        const t = getTranslator(language);
        const email = body?.email;

        if (!isProTrialEnabled()) {
          sendJson(res, 403, {
            success: false,
            message: t(
              "Der Pro-Testmonat ist aktuell deaktiviert.",
              "The Pro trial month is currently disabled."
            ),
          });
          return true;
        }

        if (!isValidEmailAddress(email)) {
          sendJson(res, 400, {
            success: false,
            message: t(
              "Bitte eine gültige E-Mail-Adresse eingeben.",
              "Please enter a valid email address."
            ),
          });
          return true;
        }

        const result = await activateProTrial({
          email,
          language,
          runtimes,
          source: "api:trial",
        });
        if (!result.success) {
          sendJson(res, result.status || 400, {
            success: false,
            message: result.message,
          });
          return true;
        }

        sendJson(res, 200, {
          success: true,
          email: result.email,
          tier: result.tier,
          licenseKey: result.licenseKey,
          expiresAt: result.expiresAt,
          seats: result.seats,
          months: result.months,
          message: result.message,
          emailStatus: result.emailStatus,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        const language = resolveRequestLanguage(req, requestUrl);
        const t = getTranslator(language);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            success: false,
            message: getLocalizedJsonBodyError(language, status),
          });
          return true;
        }
        log("ERROR", `Pro trial activation error: ${err.message}`);
        sendJson(res, 500, {
          success: false,
          message: t(
            "Der Pro-Testmonat konnte nicht aktiviert werden.",
            "Could not activate the Pro trial month."
          ),
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/premium/checkout") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      try {
        const body = await readJsonBody();
        const language = resolveRequestLanguage(req, requestUrl, body?.language);
        const t = getTranslator(language);
        const {
          tier,
          email,
          months,
          seats: rawSeats,
        } = body || {};
        const rawCouponCode = body?.couponCode ?? body?.coupon ?? "";
        const rawReferralCode = body?.referralCode ?? body?.referral ?? "";

        if (!tier || !email) {
          sendJson(res, 400, { error: t("tier und email erforderlich.", "tier and email are required.") });
          return true;
        }
        if (!isValidEmailAddress(email)) {
          sendJson(res, 400, {
            error: t(
              "Bitte eine gültige E-Mail-Adresse eingeben.",
              "Please enter a valid email address."
            ),
          });
          return true;
        }
        if (tier !== "pro" && tier !== "ultimate") {
          sendJson(res, 400, {
            error: t("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.")
          });
          return true;
        }

        const durationMonths = normalizeDuration(months);
        const seats = normalizeSeats(rawSeats);
        const requestedSeats = rawSeats === undefined || rawSeats === null || rawSeats === ""
          ? null
          : Number.parseInt(String(rawSeats), 10);
        if (requestedSeats !== null && !SEAT_OPTIONS.includes(requestedSeats)) {
          sendJson(res, 400, {
            error: t(
              `seats muss einer der Werte ${SEAT_OPTIONS.join(", ")} sein.`,
              `seats must be one of ${SEAT_OPTIONS.join(", ")}.`
            ),
          });
          return true;
        }

        const basePriceInCents = calculatePrice(tier, durationMonths, seats);
        if (basePriceInCents <= 0) {
          sendJson(res, 400, {
            error: t(
              "Ungültige Preisberechnung für die gewählte Kombination.",
              "Invalid price calculation for the selected combination."
            ),
          });
          return true;
        }

        const offerResolution = resolveCheckoutOfferForRequest({
          tier,
          seats,
          months: durationMonths,
          email: String(email).trim().toLowerCase(),
          couponCode: rawCouponCode,
          referralCode: rawReferralCode,
          baseAmountCents: basePriceInCents,
          language,
        });
        if (!offerResolution.ok) {
          sendJson(res, offerResolution.status || 400, {
            error: offerResolution.error || t(
              "Rabattcode konnte nicht angewendet werden.",
              "Could not apply discount code."
            ),
            discount: offerResolution.preview || null,
          });
          return true;
        }

        const offerPreview = offerResolution.preview;
        if (offerPreview?.requiresPayment === false) {
          const grantResult = await activateOfferGrant({
            preview: offerPreview,
            email: String(email).trim().toLowerCase(),
            language,
            runtimes,
            source: "api:checkout",
          });
          if (!grantResult.success) {
            sendJson(res, grantResult.status || 400, { error: grantResult.message, discount: offerPreview });
            return true;
          }
          sendJson(res, 200, {
            success: true,
            activated: true,
            directGrant: true,
            message: grantResult.message,
            licenseKey: grantResult.licenseKey,
            expiresAt: grantResult.expiresAt,
            tier: grantResult.tier,
            seats: grantResult.seats,
            months: grantResult.months,
            pricing: {
              baseAmountCents: grantResult.baseAmountCents,
              discountCents: grantResult.discountCents,
              finalAmountCents: 0,
            },
            discount: offerPreview,
          });
          return true;
        }

        // Buying on the website ended (#321); Premium comes to
        // Discord. A code that grants a license still works above.
        sendJson(res, 400, {
          error: t(
            "Premium kann man gerade nicht auf der Website kaufen, es kommt bald direkt in Discord. Mit einem Gratis-Code oder dem Testmonat geht es schon jetzt.",
            "Premium cannot be bought on the website right now; it is coming to Discord soon. A free code or the trial month works already."
          ),
          code: "purchase_unavailable",
          discount: offerPreview,
        });
        return true;
      } catch (err) {
        const status = Number(err?.status || 0);
        const language = resolveRequestLanguage(req, requestUrl);
        const t = getTranslator(language);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        log("ERROR", `Checkout error: ${err.message}`);
        sendJson(res, 500, {
          error: t(
            `Checkout fehlgeschlagen: ${err.message}`,
            `Checkout failed: ${err.message}`
          ),
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/premium/offer/preview") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      try {
        const body = await readJsonBody();
        const language = resolveRequestLanguage(req, requestUrl, body?.language);
        const t = getTranslator(language);
        const {
          tier,
          email,
          months,
          seats: rawSeats,
        } = body || {};
        const couponCode = body?.couponCode ?? body?.coupon ?? "";
        const referralCode = body?.referralCode ?? body?.referral ?? "";
        const cleanTier = String(tier || "").trim().toLowerCase();

        if (!["pro", "ultimate"].includes(cleanTier)) {
          sendJson(res, 400, {
            success: false,
            error: t("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'."),
          });
          return true;
        }

        const durationMonths = normalizeDuration(months);
        const seats = normalizeSeats(rawSeats);
        const requestedSeats = rawSeats === undefined || rawSeats === null || rawSeats === ""
          ? null
          : Number.parseInt(String(rawSeats), 10);
        if (requestedSeats !== null && !SEAT_OPTIONS.includes(requestedSeats)) {
          sendJson(res, 400, {
            success: false,
            error: t(
              `seats muss einer der Werte ${SEAT_OPTIONS.join(", ")} sein.`,
              `seats must be one of ${SEAT_OPTIONS.join(", ")}.`
            ),
          });
          return true;
        }

        const baseAmountCents = calculatePrice(cleanTier, durationMonths, seats);
        if (baseAmountCents <= 0) {
          sendJson(res, 400, {
            success: false,
            error: t(
              "Ungültige Preisberechnung für die gewählte Kombination.",
              "Invalid price calculation for the selected combination."
            ),
          });
          return true;
        }

        const resolved = resolveCheckoutOfferForRequest({
          tier: cleanTier,
          seats,
          months: durationMonths,
          email: String(email || "").trim().toLowerCase(),
          couponCode,
          referralCode,
          baseAmountCents,
          language,
        });

        if (!resolved.ok) {
          sendJson(res, resolved.status || 400, {
            success: false,
            error: resolved.error,
            discount: resolved.preview || null,
          });
          return true;
        }

        sendJson(res, 200, {
          success: true,
          discount: resolved.preview,
          pricing: {
            baseAmountCents,
            discountCents: Number.isFinite(Number(resolved.preview?.discountCents))
              ? Number(resolved.preview.discountCents)
              : 0,
            finalAmountCents: Number.isFinite(Number(resolved.preview?.finalAmountCents))
              ? Number(resolved.preview.finalAmountCents)
              : baseAmountCents,
          },
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        const language = resolveRequestLanguage(req, requestUrl);
        const t = getTranslator(language);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            success: false,
            error: getLocalizedJsonBodyError(language, status),
          });
          return true;
        }
        log("ERROR", `Offer preview error: ${err.message}`);
        sendJson(res, 500, {
          success: false,
          error: t(
            `Offer-Vorschau fehlgeschlagen: ${err.message}`,
            `Offer preview failed: ${err.message}`
          ),
        });
      }
      return true;
    }

    return false;
  };
}
