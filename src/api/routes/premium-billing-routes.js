export function createPremiumBillingRoutesHandler(deps) {
  const {
    BRAND,
    SEAT_OPTIONS,
    TIERS,
    activateOfferGrant,
    activatePaidStripeSession,
    activateProTrial,
    calculatePrice,
    getDashboardRequestTranslator,
    getDefaultLanguage,
    getLocalizedJsonBodyError,
    getStripeSecretKey,
    getStripeWebhookSecret,
    isStripeCheckoutEnabled,
    isEventProcessed,
    isProTrialEnabled,
    isSessionProcessed,
    isValidEmailAddress,
    log,
    markEventProcessed,
    methodNotAllowed,
    normalizeDuration,
    normalizeLanguage,
    normalizeSeats,
    resolveCheckoutOfferForRequest,
    resolveCheckoutReturnBase,
    resolveLanguageFromAcceptLanguage,
    sanitizeOfferCode,
    sendJson,
    webhookEventsInFlight,
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
    return (de, en) => (language === "de" ? de : en);
  }

  async function createStripeClient(stripeKey) {
    const stripe = await import("stripe");
    return new stripe.default(stripeKey);
  }

  return async function handlePremiumBillingRoutes(context) {
    const { req, res, requestUrl, readJsonBody, readRawBody, runtimes, publicUrl } = context;

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
              "Bitte eine gueltige E-Mail-Adresse eingeben.",
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
          returnUrl,
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
              "Bitte eine gueltige E-Mail-Adresse eingeben.",
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
              "Ungueltige Preisberechnung fuer die gewaehlte Kombination.",
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
        const priceInCents = Math.max(
          0,
          Number.isFinite(Number(offerPreview?.finalAmountCents))
            ? Number(offerPreview.finalAmountCents)
            : basePriceInCents
        );
        const discountCents = Math.max(0, Number(offerPreview?.discountCents || 0));
        const appliedOfferCode = sanitizeOfferCode(offerPreview?.applied?.code);
        const appliedOfferKind = String(offerPreview?.applied?.kind || "").trim().toLowerCase();
        const referralCode = sanitizeOfferCode(offerPreview?.attributionReferralCode || "");
        const requiresStripe = offerPreview?.requiresStripe !== false;
        if (!requiresStripe) {
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

        if (priceInCents <= 0) {
          sendJson(res, 400, { error: t("Preis ist nach Rabatt ungueltig.", "Price is invalid after discount.") });
          return true;
        }

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, {
            error: t(
              "Stripe nicht konfiguriert. Nutze: ./update.sh --stripe",
              "Stripe is not configured. Use: ./update.sh --stripe"
            ),
          });
          return true;
        }
        if (!isStripeCheckoutEnabled()) {
          sendJson(res, 503, {
            error: t("Stripe-Checkout ist im Owner-Menü deaktiviert.", "Stripe checkout is switched off in the owner console."),
          });
          return true;
        }

        const tierName = TIERS[tier].name;
        const seatsLabel = seats > 1
          ? (language === "de" ? ` (${seats} Server)` : ` (${seats} servers)`)
          : "";
        const description = durationMonths >= 12
          ? language === "de"
            ? `${tierName}${seatsLabel} - ${durationMonths} Monate`
            : `${tierName}${seatsLabel} - ${durationMonths} months`
          : language === "de"
            ? `${tierName}${seatsLabel} - ${durationMonths} Monat${durationMonths > 1 ? "e" : ""}`
            : `${tierName}${seatsLabel} - ${durationMonths} month${durationMonths > 1 ? "s" : ""}`;

        const stripeClient = await createStripeClient(stripeKey);
        const session = await stripeClient.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: String(email).trim().toLowerCase(),
          line_items: [{
            price_data: {
              currency: "eur",
              product_data: {
                name: `${BRAND.name} ${TIERS[tier].name}`,
                description,
              },
              unit_amount: priceInCents,
            },
            quantity: 1,
          }],
          metadata: {
            email: String(email).trim().toLowerCase(),
            tier,
            seats: String(seats),
            months: String(durationMonths),
            language,
            isUpgrade: "false",
            checkoutCreatedAt: new Date().toISOString(),
            couponCode: offerResolution.couponCode || "",
            referralCode: referralCode || "",
            appliedOfferCode: appliedOfferCode || "",
            appliedOfferKind: appliedOfferKind || "",
            offerOwnerLabel: String(offerPreview?.applied?.ownerLabel || ""),
            baseAmountCents: String(basePriceInCents),
            discountCents: String(discountCents),
            finalAmountCents: String(priceInCents),
          },
          success_url: `${resolveCheckoutReturnBase(returnUrl, publicUrl, req)}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${resolveCheckoutReturnBase(returnUrl, publicUrl, req)}?payment=cancelled`,
        });

        sendJson(res, 200, {
          sessionId: session.id,
          url: session.url,
          pricing: {
            baseAmountCents: basePriceInCents,
            discountCents,
            finalAmountCents: priceInCents,
          },
          discount: offerPreview,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        const language = resolveRequestLanguage(req, requestUrl);
        const t = getTranslator(language);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        log("ERROR", `Stripe checkout error: ${err.message}`);
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
              "Ungueltige Preisberechnung fuer die gewaehlte Kombination.",
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

    if (requestUrl.pathname === "/api/premium/webhook") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      const language = resolveRequestLanguage(req, requestUrl);
      const t = getTranslator(language);
      try {
        const stripeKey = getStripeSecretKey();
        const webhookSecret = getStripeWebhookSecret();
        if (!stripeKey || !webhookSecret) {
          sendJson(res, 503, {
            error: t("Stripe Webhook nicht konfiguriert.", "Stripe webhook is not configured."),
          });
          return true;
        }

        const signatureHeader = req.headers["stripe-signature"];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
        if (!signature) {
          sendJson(res, 400, { error: t("Stripe-Signatur fehlt.", "Stripe signature is missing.") });
          return true;
        }

        const rawBody = await readRawBody(2 * 1024 * 1024);
        const stripeClient = await createStripeClient(stripeKey);

        let event;
        try {
          event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (err) {
          sendJson(res, 400, {
            error: t(
              `Webhook-Signatur ungueltig: ${err.message}`,
              `Webhook signature is invalid: ${err.message}`
            ),
          });
          return true;
        }

        if (!event?.id) {
          sendJson(res, 400, { error: t("Webhook-Event ungueltig.", "Webhook event is invalid.") });
          return true;
        }

        if (isEventProcessed(event.id)) {
          sendJson(res, 200, { received: true, duplicate: true });
          return true;
        }

        if (webhookEventsInFlight.has(event.id)) {
          sendJson(res, 200, { received: true, duplicate: true, inFlight: true });
          return true;
        }
        webhookEventsInFlight.add(event.id);

        try {
          if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
            const result = await activatePaidStripeSession(event.data.object, runtimes, `webhook:${event.type}`);
            if (!result.success) {
              log("ERROR", `Webhook-Aktivierung fehlgeschlagen (event=${event.id}, type=${event.type}): ${result.message}`);
              sendJson(res, 500, {
                received: true,
                processed: false,
                replay: Boolean(result.replay),
                message: result.message,
              });
              return true;
            }

            markEventProcessed(event.id, {
              type: event.type,
              sessionId: event.data?.object?.id || null,
              success: true,
            });
            sendJson(res, 200, {
              received: true,
              processed: true,
              replay: Boolean(result.replay),
              message: result.message,
            });
            return true;
          }

          markEventProcessed(event.id, { type: event.type, ignored: true });
          sendJson(res, 200, { received: true, ignored: true });
        } finally {
          webhookEventsInFlight.delete(event.id);
        }
      } catch (err) {
        if (Number(err?.status || 0) === 413) {
          sendJson(res, 413, {
            error: t("Webhook-Body ist zu gross.", "Webhook body is too large."),
          });
          return true;
        }
        log("ERROR", `Stripe webhook error: ${err.message}`);
        sendJson(res, 500, {
          error: t(
            `Webhook-Verarbeitung fehlgeschlagen: ${err.message}`,
            `Webhook processing failed: ${err.message}`
          ),
        });
      }
      return true;
    }

    if (requestUrl.pathname !== "/api/premium/verify") {
      return false;
    }

    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }

    try {
      const body = await readJsonBody();
      const language = resolveRequestLanguage(req, requestUrl, body?.language);
      const t = getTranslator(language);
      const sessionId = body?.sessionId;
      if (!sessionId) {
        sendJson(res, 400, { error: t("sessionId erforderlich.", "sessionId is required.") });
        return true;
      }

      const stripeKey = getStripeSecretKey();
      if (!stripeKey) {
        sendJson(res, 503, { error: t("Stripe nicht konfiguriert.", "Stripe is not configured.") });
        return true;
      }

      const normalizedSessionId = String(sessionId).trim();
      const stripeClient = await createStripeClient(stripeKey);
      if (isSessionProcessed(normalizedSessionId)) {
        const replaySession = await stripeClient.checkout.sessions.retrieve(normalizedSessionId);
        const replayResult = await activatePaidStripeSession(replaySession, runtimes, "verify:replay");
        sendJson(res, 200, {
          success: true,
          replay: true,
          email: replayResult.email || null,
          licenseKey: replayResult.licenseKey || null,
          tier: replayResult.tier || null,
          discountCents: replayResult.discountCents || 0,
          appliedOfferCode: replayResult.appliedOfferCode || null,
          appliedOfferKind: replayResult.appliedOfferKind || null,
          referralCode: replayResult.referralCode || null,
          message: replayResult.message,
        });
        return true;
      }

      const session = await stripeClient.checkout.sessions.retrieve(normalizedSessionId);
      const result = await activatePaidStripeSession(session, runtimes, "verify");
      if (!result.success) {
        sendJson(res, result.status || 400, { success: false, message: result.message });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        replay: Boolean(result.replay),
        email: result.email,
        licenseKey: result.licenseKey,
        tier: result.tier,
        expiresAt: result.expiresAt,
        seats: result.seats,
        discountCents: result.discountCents || 0,
        appliedOfferCode: result.appliedOfferCode || null,
        appliedOfferKind: result.appliedOfferKind || null,
        referralCode: result.referralCode || null,
        message: result.message,
      });
    } catch (err) {
      const status = Number(err?.status || 0);
      const language = resolveRequestLanguage(req, requestUrl);
      const t = getTranslator(language);
      if (status === 400 || status === 413) {
        sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
        return true;
      }
      log("ERROR", `Stripe verify error: ${err.message}`);
      sendJson(res, 500, {
        error: t(
          `Verifizierung fehlgeschlagen: ${err.message}`,
          `Verification failed: ${err.message}`
        ),
      });
    }

    return true;
  };
}
