import { logError } from "../../lib/logging.js";
import { resolveUserFacingErrorMessage } from "../../lib/user-facing-errors.js";

export function createDashboardLicenseRouteHandler(deps) {
  const {
    BRAND,
    TIERS,
    activateOfferGrant,
    buildDashboardLicensePayload,
    calculatePrice,
    getDashboardSession,
    getLicense,
    getLocalizedJsonBodyError,
    getStripeSecretKey,
    isValidEmailAddress,
    languagePick,
    linkServerToLicense,
    maskDashboardEmail,
    methodNotAllowed,
    normalizeDuration,
    normalizeLanguage,
    normalizeSeats,
    resolveCheckoutOfferForRequest,
    resolveCheckoutReturnBase,
    resolveDashboardGuildForSession,
    resolveDashboardRequestLanguage,
    resolvePublicWebsiteUrl,
    sanitizeOfferCode,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
    unlinkServerFromLicense,
    updateLicenseContactEmail,
  } = deps;

  return async function handleDashboardLicenseRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname === "/api/dashboard/license") {
      const { language } = getDashboardRequestTranslatorCompat(resolveDashboardRequestLanguage, req, requestUrl);
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }

      if (req.method === "GET") {
        sendJson(res, 200, buildDashboardLicensePayload(guildInfo, session));
        return true;
      }

      if (req.method === "PUT") {
        try {
          const body = await readJsonBody();
          const license = getLicense(guildInfo.id);
          if (!license?.id) {
            sendLocalizedError(
              res,
              404,
              language,
              "Fuer diesen Server wurde keine bearbeitbare Lizenz gefunden.",
              "No editable license was found for this server."
            );
            return true;
          }

          const nextEmail = String(body?.contactEmail || body?.email || "").trim().toLowerCase();
          if (!isValidEmailAddress(nextEmail)) {
            sendLocalizedError(
              res,
              400,
              language,
              "Bitte eine gueltige Lizenz-E-Mail eingeben.",
              "Please enter a valid license email."
            );
            return true;
          }

          const updated = updateLicenseContactEmail(license.id, nextEmail, normalizeLanguage(body?.language, language));
          if (!updated) {
            sendLocalizedError(
              res,
              404,
              language,
              "Lizenz konnte nicht aktualisiert werden.",
              "License could not be updated."
            );
            return true;
          }

          sendJson(res, 200, {
            success: true,
            ...buildDashboardLicensePayload(guildInfo, session),
          });
        } catch (err) {
          const status = Number(err?.status || 0);
          if (status === 400 || status === 413) {
            sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
            return true;
          }
          logError("[DashboardLicense] Update failed", err, {
            context: {
              source: "dashboard-license",
              route: "/api/dashboard/license",
              guildId: guildInfo?.id || "",
            },
            includeStack: true,
          });
          sendJson(res, 400, {
            error: resolveUserFacingErrorMessage(language, err, {
              fallbackDe: "Die Lizenzdaten konnten gerade nicht aktualisiert werden.",
              fallbackEn: "The license details could not be updated right now.",
            }),
          });
        }
        return true;
      }

      methodNotAllowed(res, ["GET", "PUT"]);
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/license/workspace") {
      const { language } = getDashboardRequestTranslatorCompat(resolveDashboardRequestLanguage, req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }

      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }

      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }

      if (!serverHasCapability(guildInfo.id, "license_workspace")) {
        sendLocalizedError(
          res,
          403,
          language,
          "Der Lizenz-Workspace ist nur fuer Ultimate verfuegbar.",
          "The license workspace is only available for Ultimate."
        );
        return true;
      }

      const license = getLicense(guildInfo.id);
      if (!license?.id) {
        sendLocalizedError(
          res,
          404,
          language,
          "Fuer diesen Server wurde keine aktive Lizenz gefunden.",
          "No active license was found for this server."
        );
        return true;
      }
      if (!license.active || license.expired) {
        sendLocalizedError(
          res,
          409,
          language,
          "Abgelaufene oder inaktive Lizenzen koennen im Workspace nicht verwaltet werden.",
          "Expired or inactive licenses cannot be managed in the workspace."
        );
        return true;
      }

      try {
        const body = await readJsonBody();
        const action = String(body?.action || "").trim().toLowerCase();
        const targetServerId = String(body?.targetServerId || body?.guildId || "").trim();
        const t = (de, en) => languagePick(language, de, en);

        if (!["link", "unlink"].includes(action)) {
          sendLocalizedError(
            res,
            400,
            language,
            "Ungueltige Workspace-Aktion.",
            "Invalid workspace action."
          );
          return true;
        }

        if (!/^\d{17,22}$/.test(targetServerId)) {
          sendLocalizedError(
            res,
            400,
            language,
            "Bitte einen gueltigen Server auswaehlen.",
            "Please select a valid server."
          );
          return true;
        }

        const targetGuild = resolveDashboardGuildForSession(session, targetServerId);
        if (!targetGuild) {
          sendLocalizedError(
            res,
            403,
            language,
            "Kein Zugriff auf den ausgewaehlten Server.",
            "No access to the selected server."
          );
          return true;
        }

        if (action === "link") {
          const targetLicense = getLicense(targetGuild.id);
          if (
            targetLicense?.id
            && String(targetLicense.id) !== String(license.id)
            && targetLicense.active
            && !targetLicense.expired
          ) {
            sendLocalizedError(
              res,
              409,
              language,
              "Dieser Server hat bereits eine andere aktive Lizenz. Entferne sie zuerst dort, bevor du ihn in diesen Workspace verschiebst.",
              "This server already has another active license. Remove it there first before moving it into this workspace."
            );
            return true;
          }

          const result = linkServerToLicense(targetGuild.id, license.id);
          if (!result.ok) {
            const message = String(result.message || "");
            if (/already linked/i.test(message)) {
              sendJson(res, 200, {
                success: true,
                action,
                message: t(
                  `Server ${targetGuild.name} ist bereits mit dieser Lizenz verknuepft.`,
                  `Server ${targetGuild.name} is already linked to this license.`
                ),
                ...buildDashboardLicensePayload(guildInfo, session),
              });
              return true;
            }
            if (/seat/i.test(message)) {
              sendLocalizedError(
                res,
                409,
                language,
                "Alle Server-Slots dieser Lizenz sind belegt. Entferne zuerst einen Server oder upgrade auf mehr Seats.",
                "All server seats of this license are occupied. Remove a server first or upgrade to more seats."
              );
              return true;
            }
            sendJson(res, 400, { error: message || t("Server konnte nicht verknuepft werden.", "Server could not be linked.") });
            return true;
          }

          sendJson(res, 200, {
            success: true,
            action,
            message: t(
              `Server ${targetGuild.name} wurde dem Lizenz-Workspace hinzugefuegt.`,
              `Server ${targetGuild.name} was added to the license workspace.`
            ),
            ...buildDashboardLicensePayload(guildInfo, session),
          });
          return true;
        }

        const targetLicense = getLicense(targetGuild.id);
        if (!targetLicense?.id || String(targetLicense.id) !== String(license.id)) {
          sendLocalizedError(
            res,
            400,
            language,
            "Dieser Server ist nicht mit der aktuellen Lizenz verknuepft.",
            "This server is not linked to the current license."
          );
          return true;
        }

        const result = unlinkServerFromLicense(targetGuild.id, license.id);
        if (!result.ok) {
          sendJson(res, 400, {
            error: result.message || t("Server konnte nicht entfernt werden.", "Server could not be removed."),
          });
          return true;
        }

        sendJson(res, 200, {
          success: true,
          action,
          message: t(
            `Server ${targetGuild.name} wurde aus dem Lizenz-Workspace entfernt.`,
            `Server ${targetGuild.name} was removed from the license workspace.`
          ),
          ...buildDashboardLicensePayload(guildInfo, session),
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        logError("[DashboardLicenseWorkspace] Update failed", err, {
          context: {
            source: "dashboard-license-workspace",
            route: "/api/dashboard/license/workspace",
            guildId: guildInfo?.id || "",
          },
          includeStack: true,
        });
        sendLocalizedError(
          res,
          500,
          language,
          "Der Lizenz-Workspace konnte nicht aktualisiert werden.",
          "The license workspace could not be updated."
        );
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/license/offer-preview") {
      const requestLanguage = resolveDashboardRequestLanguage(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, requestLanguage, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendLocalizedError(res, 403, requestLanguage, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const license = getLicense(guildInfo.id);
        const previewLanguage = normalizeLanguage(
          body?.language,
          normalizeLanguage(license?.preferredLanguage, requestLanguage)
        );
        const isDe = previewLanguage === "de";
        const t = (de, en) => (isDe ? de : en);

        if (!license) {
          sendJson(res, 404, {
            success: false,
            error: t(
              "Fuer diesen Server wurde keine aktive oder abgelaufene Lizenz gefunden.",
              "No active or expired license was found for this server."
            ),
          });
          return true;
        }

        const providedBillingEmail = String(body?.email || "").trim().toLowerCase();
        if (providedBillingEmail && !isValidEmailAddress(providedBillingEmail)) {
          sendJson(res, 400, {
            success: false,
            error: t(
              "Bitte eine gueltige Abrechnungs-E-Mail eingeben.",
              "Please enter a valid billing email address."
            ),
          });
          return true;
        }

        const previewEmail = providedBillingEmail || String(license.contactEmail || license.email || "").trim().toLowerCase();
        const currentPlan = String(license.plan || guildInfo.tier || "free").trim().toLowerCase();
        const requestedTier = String(body?.tier || currentPlan).trim().toLowerCase();
        const durationMonths = normalizeDuration(body?.months);
        const seats = normalizeSeats(license.seats || 1);
        const couponCode = body?.couponCode ?? body?.coupon ?? "";
        const referralCode = body?.referralCode ?? body?.referral ?? "";

        if (!["pro", "ultimate"].includes(currentPlan)) {
          sendJson(res, 400, {
            success: false,
            error: t(
              "Dieses Dashboard kann nur bestehende Pro- oder Ultimate-Abos verlaengern.",
              "This dashboard can only renew existing Pro or Ultimate subscriptions."
            ),
          });
          return true;
        }

        if (!["pro", "ultimate"].includes(requestedTier)) {
          sendJson(res, 400, {
            success: false,
            error: t("Ungueltiger Zielplan.", "Invalid target plan."),
          });
          return true;
        }

        if (currentPlan === "ultimate" && requestedTier !== "ultimate") {
          sendJson(res, 400, {
            success: false,
            error: t(
              "Ein Ultimate-Abo kann nicht im Dashboard heruntergestuft werden.",
              "An Ultimate subscription cannot be downgraded in the dashboard."
            ),
          });
          return true;
        }

        const basePriceInCents = calculatePrice(requestedTier, durationMonths, seats);
        if (basePriceInCents <= 0) {
          sendJson(res, 400, {
            success: false,
            error: t(
              "Ungueltige Preisberechnung fuer die gewaehlte Verlaengerung.",
              "Invalid price calculation for the selected renewal."
            ),
          });
          return true;
        }

        const offerResolution = resolveCheckoutOfferForRequest({
          tier: requestedTier,
          seats,
          months: durationMonths,
          email: previewEmail,
          couponCode,
          referralCode,
          baseAmountCents: basePriceInCents,
          language: previewLanguage,
        });
        if (!offerResolution.ok) {
          sendJson(res, offerResolution.status || 400, {
            success: false,
            error: offerResolution.error || t("Rabattcode konnte nicht angewendet werden.", "Could not apply discount code."),
            discount: offerResolution.preview || null,
          });
          return true;
        }

        const offerPreview = offerResolution.preview;
        sendJson(res, 200, {
          success: true,
          pricing: {
            baseAmountCents: basePriceInCents,
            discountCents: Math.max(
              0,
              Number.isFinite(Number(offerPreview?.discountCents))
                ? Number(offerPreview.discountCents)
                : 0
            ),
            finalAmountCents: Math.max(
              0,
              Number.isFinite(Number(offerPreview?.finalAmountCents))
                ? Number(offerPreview.finalAmountCents)
                : basePriceInCents
            ),
          },
          discount: offerPreview,
          renewal: {
            currentPlan,
            targetPlan: requestedTier,
            seats,
            months: durationMonths,
            emailMasked: maskDashboardEmail(previewEmail),
          },
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            success: false,
            error: getLocalizedJsonBodyError(requestLanguage, status),
          });
          return true;
        }
        logError("[DashboardLicense] Offer preview failed", err, {
          context: {
            source: "dashboard-license-offer-preview",
            route: "/api/dashboard/license/offer-preview",
            guildId: guildInfo?.id || "",
          },
          includeStack: true,
        });
        sendLocalizedError(res, 500, requestLanguage, "Dashboard-Angebotsvorschau fehlgeschlagen.", "Dashboard offer preview failed.");
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/license/checkout") {
      const requestLanguage = resolveDashboardRequestLanguage(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, requestLanguage, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendLocalizedError(res, 403, requestLanguage, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const license = getLicense(guildInfo.id);
        const checkoutLanguage = normalizeLanguage(
          body?.language,
          normalizeLanguage(license?.preferredLanguage, requestLanguage)
        );
        const isDe = checkoutLanguage === "de";
        const t = (de, en) => (isDe ? de : en);

        if (!license) {
          sendJson(res, 404, {
            error: t(
              "Für diesen Server wurde keine aktive oder abgelaufene Lizenz gefunden.",
              "No active or expired license was found for this server."
            ),
          });
          return true;
        }

        const providedBillingEmail = String(body?.email || "").trim().toLowerCase();
        let licenseEmail = String(license.contactEmail || license.email || "").trim().toLowerCase();
        if (providedBillingEmail) {
          if (!isValidEmailAddress(providedBillingEmail)) {
            sendJson(res, 400, {
              error: t(
                "Bitte eine gültige Abrechnungs-E-Mail eingeben.",
                "Please enter a valid billing email address."
              ),
            });
            return true;
          }
          licenseEmail = providedBillingEmail;
          if (license?.id && licenseEmail !== String(license.contactEmail || "").trim().toLowerCase()) {
            updateLicenseContactEmail(license.id, licenseEmail, checkoutLanguage);
          }
        }
        if (!isValidEmailAddress(licenseEmail)) {
          sendJson(res, 400, {
            error: t(
              "Für diese Lizenz ist keine gültige Abrechnungs-E-Mail hinterlegt. Bitte gib unten eine E-Mail ein.",
              "No valid billing email is stored for this license. Please enter one below."
            ),
          });
          return true;
        }

        const currentPlan = String(license.plan || guildInfo.tier || "free").trim().toLowerCase();
        const requestedTier = String(body?.tier || currentPlan).trim().toLowerCase();
        const durationMonths = normalizeDuration(body?.months);
        const seats = normalizeSeats(license.seats || 1);
        const returnUrl = String(body?.returnUrl || "").trim();
        const couponCode = body?.couponCode ?? body?.coupon ?? "";
        const referralCode = body?.referralCode ?? body?.referral ?? "";

        if (!["pro", "ultimate"].includes(currentPlan)) {
          sendJson(res, 400, {
            error: t(
              "Dieses Dashboard kann nur bestehende Pro- oder Ultimate-Abos verlängern.",
              "This dashboard can only renew existing Pro or Ultimate subscriptions."
            ),
          });
          return true;
        }

        if (!["pro", "ultimate"].includes(requestedTier)) {
          sendJson(res, 400, {
            error: t("Ungültiger Zielplan.", "Invalid target plan."),
          });
          return true;
        }

        if (currentPlan === "ultimate" && requestedTier !== "ultimate") {
          sendJson(res, 400, {
            error: t("Ein Ultimate-Abo kann nicht im Dashboard heruntergestuft werden.", "An Ultimate subscription cannot be downgraded in the dashboard."),
          });
          return true;
        }

        const basePriceInCents = calculatePrice(requestedTier, durationMonths, seats);
        if (basePriceInCents <= 0) {
          sendJson(res, 400, {
            error: t(
              "Ungültige Preisberechnung für die gewählte Verlängerung.",
              "Invalid price calculation for the selected renewal."
            ),
          });
          return true;
        }

        const offerResolution = resolveCheckoutOfferForRequest({
          tier: requestedTier,
          seats,
          months: durationMonths,
          email: licenseEmail,
          couponCode,
          referralCode,
          baseAmountCents: basePriceInCents,
          language: checkoutLanguage,
        });
        if (!offerResolution.ok) {
          sendJson(res, offerResolution.status || 400, {
            error: offerResolution.error || t("Rabattcode konnte nicht angewendet werden.", "Could not apply discount code."),
            discount: offerResolution.preview || null,
          });
          return true;
        }

        const offerPreview = offerResolution.preview;
        const discountCents = Math.max(
          0,
          Number.isFinite(Number(offerPreview?.discountCents))
            ? Number(offerPreview.discountCents)
            : 0
        );
        const priceInCents = Math.max(
          0,
          Number.isFinite(Number(offerPreview?.finalAmountCents))
            ? Number(offerPreview.finalAmountCents)
            : basePriceInCents
        );
        const appliedOfferCode = sanitizeOfferCode(offerPreview?.applied?.code);
        const appliedOfferKind = String(offerPreview?.applied?.kind || "").trim().toLowerCase();
        const resolvedReferralCode = sanitizeOfferCode(offerPreview?.attributionReferralCode || "");
        const requiresStripe = offerPreview?.requiresStripe !== false;
        if (!requiresStripe) {
          const grantResult = await activateOfferGrant({
            preview: offerPreview,
            email: licenseEmail,
            language: checkoutLanguage,
            runtimes,
            source: "dashboard:checkout",
          });
          if (!grantResult.success) {
            sendJson(res, grantResult.status || 400, {
              error: grantResult.message,
              discount: offerPreview,
            });
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
            renewal: {
              currentPlan,
              targetPlan: grantResult.tier,
              seats: grantResult.seats,
              months: grantResult.months,
              emailMasked: licenseEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
            },
          });
          return true;
        }

        if (priceInCents <= 0) {
          sendJson(res, 400, {
            error: t("Preis ist nach Rabatt ungültig.", "Price is invalid after discount."),
            discount: offerPreview,
          });
          return true;
        }

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, {
            error: t("Stripe ist nicht konfiguriert.", "Stripe is not configured."),
          });
          return true;
        }

        const publicUrl = resolvePublicWebsiteUrl(req);
        const seatsLabel = seats > 1
          ? (isDe ? ` (${seats} Server)` : ` (${seats} servers)`)
          : "";
        const isUpgrade = currentPlan === "pro" && requestedTier === "ultimate";
        const description = isUpgrade
          ? (isDe
            ? `${TIERS[requestedTier].name}${seatsLabel} - Upgrade für ${durationMonths} Monat${durationMonths > 1 ? "e" : ""}`
            : `${TIERS[requestedTier].name}${seatsLabel} - upgrade for ${durationMonths} month${durationMonths > 1 ? "s" : ""}`)
          : (isDe
            ? `${TIERS[requestedTier].name}${seatsLabel} - Verlängerung für ${durationMonths} Monat${durationMonths > 1 ? "e" : ""}`
            : `${TIERS[requestedTier].name}${seatsLabel} - renewal for ${durationMonths} month${durationMonths > 1 ? "s" : ""}`);

        const stripe = await import("stripe");
        const stripeClient = new stripe.default(stripeKey);
        const checkoutSession = await stripeClient.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: licenseEmail,
          line_items: [{
            price_data: {
              currency: "eur",
              product_data: {
                name: `${BRAND.name} ${TIERS[requestedTier].name}`,
                description,
              },
              unit_amount: priceInCents,
            },
            quantity: 1,
          }],
          metadata: {
            email: licenseEmail,
            tier: requestedTier,
            seats: String(seats),
            months: String(durationMonths),
            language: checkoutLanguage,
            isUpgrade: String(isUpgrade),
            checkoutCreatedAt: new Date().toISOString(),
            couponCode: offerResolution.couponCode || "",
            referralCode: resolvedReferralCode || "",
            appliedOfferCode: appliedOfferCode || "",
            appliedOfferKind: appliedOfferKind || "",
            offerOwnerLabel: String(offerPreview?.applied?.ownerLabel || ""),
            baseAmountCents: String(basePriceInCents),
            discountCents: String(discountCents),
            finalAmountCents: String(priceInCents),
          },
          success_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
          cancel_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=cancelled",
        });

        sendJson(res, 200, {
          sessionId: checkoutSession.id,
          url: checkoutSession.url,
          pricing: {
            baseAmountCents: basePriceInCents,
            discountCents,
            finalAmountCents: priceInCents,
          },
          discount: offerPreview,
          renewal: {
            currentPlan,
            targetPlan: requestedTier,
            seats,
            months: durationMonths,
            emailMasked: licenseEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
          },
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            error: getLocalizedJsonBodyError(requestLanguage, status),
          });
          return true;
        }
        logError("[DashboardLicense] Checkout failed", err, {
          context: {
            source: "dashboard-license-checkout",
            route: "/api/dashboard/license/checkout",
            guildId: guildInfo?.id || "",
          },
          includeStack: true,
        });
        sendLocalizedError(res, 500, requestLanguage, "Dashboard-Checkout fehlgeschlagen.", "Dashboard checkout failed.");
      }
      return true;
    }

    return false;
  };
}

function getDashboardRequestTranslatorCompat(resolveDashboardRequestLanguage, req, requestUrl) {
  return { language: resolveDashboardRequestLanguage(req, requestUrl) };
}
