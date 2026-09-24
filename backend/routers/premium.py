"""Premium: pricing, checkout, trials, license checks and the Stripe webhook.

Moved out of server.py unchanged (#200). server.py calls build_router(core)
with itself; names defined in server.py are read as core.<name> at call
time, so tests that patch server.db still reach these routes.
"""
from datetime import datetime
from datetime import timezone
from fastapi import APIRouter
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool


def build_router(core):
    router = APIRouter()

    @router.get("/api/premium/check")
    async def check_premium(request: Request, serverId: str = "", licenseKey: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited

        include_sensitive = core.is_admin_request(request)

        # Lizenz per Key suchen
        if licenseKey:
            data = core.load_premium()
            licenses = data.get("licenses", {})
            lic = licenses.get(licenseKey)
            resolved_key = licenseKey
            if not lic:
                lower_query = licenseKey.lower()
                for key, value in licenses.items():
                    if str(key).lower() == lower_query:
                        lic = value
                        resolved_key = key
                        break
            if not lic:
                return core.json_error(404, "Lizenz-Key nicht gefunden.")
            expired = core.is_expired(lic)
            normalized = {
                **lic,
                "tier": lic.get("tier", lic.get("plan", "free")),
                "plan": lic.get("plan", lic.get("tier", "free")),
                "expired": expired,
                "remainingDays": core.remaining_days(lic),
            }
            return {"licenseKey": resolved_key, **core.sanitize_license_for_api(normalized, include_sensitive)}

        # Fallback: Server-ID basiert
        if not core.is_valid_server_id(serverId):
            return core.json_error(400, "serverId oder licenseKey erforderlich (17-22 Ziffern).")

        server_id = str(serverId).strip()
        tier = core.get_tier(server_id)
        tier_config = core.TIERS.get(tier, core.TIERS["free"])
        license_info = core.get_license(server_id)
        return {
            "serverId": server_id,
            "tier": tier,
            **tier_config,
            "license": core.sanitize_license_for_api(license_info, include_sensitive),
        }

    @router.get("/api/premium/tiers")
    async def get_tiers(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        plans = core.get_config_section("plans")
        tiers = {}
        for key in ("free", "pro", "ultimate"):
            base = dict(core.TIERS.get(key, {}))
            p = plans.get(key) or {}
            base["name"] = p.get("name", base.get("name"))
            base["bitrate"] = p.get("bitrate", base.get("bitrate"))
            base["maxBots"] = p.get("maxBots", base.get("maxBots"))
            base["pricePerMonth"] = p.get("pricePerMonth", base.get("pricePerMonth"))
            tiers[key] = base
        return {"tiers": tiers}

    @router.post("/api/premium/trial")
    async def activate_trial(request: Request, body: dict):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited

        payload = body if isinstance(body, dict) else {}
        language = core.normalize_language(
            payload.get("language"),
            core.resolve_language_from_accept_language(request.headers.get("accept-language"), "de"),
        )
        def tmsg(de, en):
            return de if language == "de" else en
        email = str(payload.get("email", "")).strip().lower()

        if not core.is_pro_trial_enabled():
            return JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "message": tmsg(
                        "Der Pro-Testmonat ist aktuell deaktiviert.",
                        "The Pro trial month is currently disabled.",
                    ),
                },
            )

        if not core.is_valid_email(email):
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "message": tmsg(
                        "Bitte eine gueltige E-Mail-Adresse eingeben.",
                        "Please enter a valid email address.",
                    ),
                },
            )

        if core.list_licenses_by_contact_email(email):
            return JSONResponse(
                status_code=409,
                content={
                    "success": False,
                    "message": tmsg(
                        "Für diese E-Mail existiert bereits eine Lizenz. Der Testmonat ist nur einmalig für Neukunden verfügbar.",
                        "A license already exists for this email. The trial month is only available once for new customers.",
                    ),
                },
            )

        reserved = core.reserve_trial_claim(
            email,
            {
                "source": "api:trial",
                "preferredLanguage": language,
                "requestedAt": datetime.now(timezone.utc).isoformat(),
            },
        )
        if not reserved.get("ok"):
            return JSONResponse(
                status_code=409,
                content={
                    "success": False,
                    "message": tmsg(
                        "Der Pro-Testmonat wurde fuer diese E-Mail bereits genutzt.",
                        "The Pro trial month has already been used for this email.",
                    ),
                },
            )

        try:
            license_data = core.add_license(
                email,
                "pro",
                core.PRO_TRIAL_MONTHS,
                core.PRO_TRIAL_SEATS,
                "trial",
                "Trial via api:trial",
            )
        except Exception as exc:
            core.release_trial_claim(email)
            return JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "message": tmsg(
                        "Der Pro-Testmonat konnte nicht erstellt werden. Bitte spaeter erneut versuchen.",
                        "Could not create the Pro trial month. Please try again later.",
                    ),
                    "detail": core.clip_text(exc),
                },
            )

        core.finalize_trial_claim(
            email,
            {
                "source": "api:trial",
                "licenseId": license_data.get("licenseKey"),
                "tier": "pro",
                "seats": core.PRO_TRIAL_SEATS,
                "months": core.PRO_TRIAL_MONTHS,
                "expiresAt": license_data.get("expiresAt"),
                "activatedBy": "trial",
            },
        )

        smtp_configured = bool(core.system_setting("smtp", "host", "SMTP_HOST"))
        email_status = {
            "smtpConfigured": smtp_configured,
            "purchaseSent": False,
            "invoiceSent": False,
            "adminSent": False,
            "errors": [] if smtp_configured else ["smtp_not_configured"],
        }

        message = tmsg(
            f"Pro-Testmonat aktiviert! Lizenz-Key: {license_data.get('licenseKey')} - Pruefe deine E-Mail ({email}).",
            f"Pro trial month activated! License key: {license_data.get('licenseKey')} - Check your email ({email}).",
        )
        if not smtp_configured:
            message = tmsg(
                f"Pro-Testmonat aktiviert! Lizenz-Key: {license_data.get('licenseKey')}. Hinweis: SMTP ist nicht konfiguriert, daher wurde keine E-Mail versendet.",
                f"Pro trial month activated! License key: {license_data.get('licenseKey')}. Note: SMTP is not configured, so no email was sent.",
            )

        return {
            "success": True,
            "email": email,
            "tier": "pro",
            "licenseKey": license_data.get("licenseKey"),
            "expiresAt": license_data.get("expiresAt"),
            "seats": core.PRO_TRIAL_SEATS,
            "months": core.PRO_TRIAL_MONTHS,
            "message": message,
            "emailStatus": email_status,
        }

    @router.post("/api/premium/offer/preview")
    async def premium_offer_preview(request: Request, body: dict):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited

        payload = body if isinstance(body, dict) else {}
        language = core.normalize_language(
            payload.get("language"),
            core.resolve_language_from_accept_language(request.headers.get("accept-language"), "de"),
        )
        result = core.resolve_discount_preview(
            tier=payload.get("tier"),
            seats=payload.get("seats", 1),
            months=payload.get("months", 1),
            email=payload.get("email"),
            coupon_code=payload.get("couponCode") or payload.get("coupon") or "",
            language=language,
        )
        if not result.get("ok"):
            return JSONResponse(
                status_code=int(result.get("status", 400)),
                content={
                    "success": False,
                    "error": result.get("error", "Offer-Vorschau fehlgeschlagen."),
                    "discount": result.get("preview"),
                },
            )

        preview = result.get("preview", {})
        return {
            "success": True,
            "discount": preview,
            "pricing": {
                "baseAmountCents": preview.get("baseAmountCents", 0),
                "discountCents": preview.get("discountCents", 0),
                "finalAmountCents": preview.get("finalAmountCents", preview.get("baseAmountCents", 0)),
            },
        }

    @router.get("/api/premium/offer")
    async def premium_offer(request: Request, code: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        normalized_code = core.sanitize_offer_code(code)
        if not normalized_code:
            return core.json_error(400, "code ist erforderlich.")
        offer = core.get_offer(normalized_code)
        if not offer:
            return core.json_error(404, "Code nicht gefunden.")
        return {"offer": offer}

    @router.api_route("/api/premium/offers", methods=["GET", "POST", "PATCH", "DELETE"])
    async def premium_offers(request: Request):
        rate_scope = "read" if request.method == "GET" else "write"
        rate_limited = core.enforce_api_rate_limit(request, rate_scope)
        if rate_limited is not None:
            return rate_limited

        if not core.is_admin_request(request):
            return core.json_error(401, "Unauthorized. API admin token required.")

        if request.method == "GET":
            include_inactive = request.query_params.get("includeInactive", "1") != "0"
            offers = core.list_offers(include_inactive=include_inactive)
            return {"offers": offers}

        if request.method in ("POST", "PATCH"):
            try:
                body = await request.json()
                if not isinstance(body, dict):
                    body = {}
            except Exception:
                body = {}
            actor = core.clip_text(
                request.headers.get("x-admin-user") or body.get("updatedBy") or "api-admin",
                120,
            )
            try:
                offer = core.upsert_offer(
                    {
                        **body,
                        "updatedBy": actor,
                        "createdBy": body.get("createdBy") or actor,
                    },
                    partial=request.method == "PATCH",
                )
                return {"success": True, "offer": offer}
            except Exception as exc:
                return JSONResponse(
                    status_code=400,
                    content={"success": False, "error": core.clip_text(exc)},
                )

        if request.method == "DELETE":
            code = core.sanitize_offer_code(request.query_params.get("code", ""))
            if not code:
                return JSONResponse(status_code=400, content={"success": False, "error": "code ist erforderlich."})
            deleted = core.delete_offer(code)
            return JSONResponse(status_code=200 if deleted else 404, content={"success": deleted, "code": code})

        return core.json_error(405, "Methode nicht erlaubt.")

    @router.post("/api/premium/offers/active")
    async def premium_offer_active(request: Request, body: dict):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited

        if not core.is_admin_request(request):
            return core.json_error(401, "Unauthorized. API admin token required.")

        payload = body if isinstance(body, dict) else {}
        code = core.sanitize_offer_code(payload.get("code"))
        if not code:
            return JSONResponse(status_code=400, content={"success": False, "error": "code ist erforderlich."})
        offer = core.set_offer_active(code, payload.get("active", True))
        if not offer:
            return JSONResponse(status_code=404, content={"success": False, "error": "Code nicht gefunden."})
        return {"success": True, "offer": offer}

    @router.get("/api/premium/redemptions")
    async def premium_redemptions(request: Request, limit: int = 100):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        if not core.is_admin_request(request):
            return core.json_error(401, "Unauthorized. API admin token required.")
        return {"redemptions": core.list_recent_redemptions(limit)}

    @router.get("/api/premium/pricing")
    async def get_pricing(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited

        plans = core.get_config_section("plans")
        raw_plans = core.load_owner_config_raw().get("plans")
        raw_plans = raw_plans if isinstance(raw_plans, dict) else {}

        def _fmt_cents(cents):
            return f"{(int(cents) / 100):.2f}".replace(".", ",")

        def _scaled(tier, mapping):
            base = (core.TIERS.get(tier) or {}).get("pricePerMonth", 0) or 0
            price = (plans.get(tier) or {}).get("pricePerMonth", base) or 0
            ratio = (price / base) if base else 1
            return {str(k): _fmt_cents(round(v * ratio)) for k, v in mapping.items()}

        def _plan(key):
            p = plans.get(key) or {}
            raw = raw_plans.get(key) if isinstance(raw_plans, dict) else None
            default_feats = ((core.DEFAULT_OWNER_CONFIG.get("plans") or {}).get(key) or {}).get("features") or []
            raw_feats = raw.get("features") if isinstance(raw, dict) else None
            # Only expose features when the owner truly customized them (different from defaults).
            # Otherwise return [] so the frontend uses its localized (DE/EN) copy.
            owner_customized = isinstance(raw_feats, list) and len(raw_feats) > 0 and raw_feats != default_feats
            return {
                "name": p.get("name", key.title()),
                "pricePerMonth": p.get("pricePerMonth", (core.TIERS.get(key) or {}).get("pricePerMonth", 0)),
                "features": raw_feats if owner_customized else [],
            }

        result = {
            "brand": "OmniFM",
            "tiers": {
                "free": _plan("free"),
                "pro": {
                    **_plan("pro"),
                    "startingAt": _fmt_cents((plans.get("pro") or {}).get("pricePerMonth", 299)),
                    "durationPricing": _scaled("pro", core.DURATION_PRICING["pro"]),
                    "seatPricing": _scaled("pro", core.SEAT_MONTHLY_TOTAL_CENTS["pro"]),
                },
                "ultimate": {
                    **_plan("ultimate"),
                    "startingAt": _fmt_cents((plans.get("ultimate") or {}).get("pricePerMonth", 499)),
                    "durationPricing": _scaled("ultimate", core.DURATION_PRICING["ultimate"]),
                    "seatPricing": _scaled("ultimate", core.SEAT_MONTHLY_TOTAL_CENTS["ultimate"]),
                },
            },
            "durations": core.DURATION_OPTIONS,
            "seatOptions": core.SEAT_OPTIONS,
            "trial": {
                "enabled": core.is_pro_trial_enabled(),
                "tier": "pro",
                "months": core.PRO_TRIAL_MONTHS,
                "oneTimePerEmail": True,
            },
        }
        if core.is_valid_server_id(serverId):
            server_id = str(serverId).strip()
            license_info = core.get_license(server_id)
            if license_info and not license_info.get("expired"):
                result["currentLicense"] = {
                    "tier": license_info.get("tier", license_info.get("plan", "free")),
                    "seats": max(1, int(license_info.get("seats", 1) or 1)),
                    "expiresAt": license_info.get("expiresAt"),
                    "remainingDays": license_info.get("remainingDays", 0),
                }
                if license_info.get("tier", "") == "pro":
                    upgrade = core.calculate_upgrade_price(server_id, "ultimate")
                    if upgrade:
                        result["upgrade"] = {
                            "to": "ultimate",
                            "seats": upgrade["seats"],
                            "cost": upgrade["upgradeCost"],
                            "daysLeft": upgrade["daysLeft"],
                        }
        return result

    @router.get("/api/premium/invite-links")
    async def premium_invite_links(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited

        if not core.is_valid_server_id(serverId):
            return core.json_error(400, "serverId muss 17-22 Ziffern sein.")

        server_id = str(serverId).strip()
        tier = core.get_tier(server_id)
        tier_config = core.TIERS.get(tier, core.TIERS["free"])
        tier_rank = {"free": 0, "pro": 1, "ultimate": 2}
        server_rank = tier_rank.get(tier, 0)
        max_bots = int(tier_config.get("maxBots", 0))

        bots_data = core.load_bots_from_env()
        links = []
        for bot in bots_data:
            bot_index = int(bot.get("index", 0) or 0)
            bot_tier = bot.get("requiredTier", "free")
            bot_rank = tier_rank.get(bot_tier, 0)
            has_tier_access = server_rank >= bot_rank
            within_bot_limit = bot_index > 0 and bot_index <= max_bots
            has_access = has_tier_access and within_bot_limit
            blocked_reason = None if has_access else ("tier" if not has_tier_access else "maxBots")
            invite = None
            if has_access:
                cid = bot.get("clientId", "")
                invite = f"https://discord.com/oauth2/authorize?client_id={cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands" if cid else None
            links.append({
                "botId": bot["botId"],
                "name": bot["name"],
                "index": bot_index,
                "requiredTier": bot_tier,
                "hasAccess": has_access,
                "blockedReason": blocked_reason,
                "inviteUrl": invite,
            })
        return {"serverId": server_id, "serverTier": tier, "serverMaxBots": max_bots, "bots": links}

    @router.post("/api/premium/checkout")
    async def premium_checkout(request: Request, body: dict):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited

        tier = str(body.get("tier", "")).strip().lower()
        email = str(body.get("email", "")).strip().lower()
        duration_months = core.normalize_months(body.get("months", 1))
        seats = max(1, min(5, core.parse_int(body.get("seats", 1), 1)))
        return_url = str(body.get("returnUrl", "")).strip()

        if tier not in ("pro", "ultimate"):
            return core.json_error(400, "tier muss 'pro' oder 'ultimate' sein.")
        if not core.is_valid_email(email):
            return core.json_error(400, "Bitte eine gueltige E-Mail-Adresse angeben.")
        if not core.is_stripe_enabled():
            return core.json_error(503, "Stripe-Checkout ist im Owner-Menü deaktiviert.")

        stripe_key = core.get_stripe_secret_key()
        valid, msg = core.validate_stripe_key(stripe_key)
        if not valid:
            return core.json_error(503, msg)

        try:
            import stripe
            stripe.api_key = stripe_key

            price_in_cents = core.calculate_price(tier, duration_months, seats)
            if price_in_cents <= 0:
                return core.json_error(400, "Ungueltige Preisberechnung.")

            tier_name = core.TIERS[tier]["name"]
            seats_label = f" ({seats} Server)" if seats > 1 else ""
            if duration_months >= 12:
                description = f"{tier_name}{seats_label} - {duration_months} Monate (Jahresrabatt: 2 Monate gratis!)"
            else:
                description = f"{tier_name}{seats_label} - {duration_months} Monat{'e' if duration_months > 1 else ''}"

            return_base = core.resolve_checkout_return_base(return_url)

            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                mode="payment",
                customer_email=email,
                line_items=[{
                    "price_data": {
                        "currency": "eur",
                        "product_data": {
                            "name": f"OmniFM {tier_name}",
                            "description": description,
                        },
                        "unit_amount": price_in_cents,
                    },
                    "quantity": 1,
                }],
                metadata={
                    "email": email,
                    "tier": tier,
                    "seats": str(seats),
                    "months": str(duration_months),
                },
                success_url=return_base + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
                cancel_url=return_base + "?payment=cancelled",
            )
            return {"sessionId": session.id, "url": session.url}
        except Exception as e:
            return core.json_error(500, f"Checkout fehlgeschlagen: {core.clip_text(e)}")

    @router.post("/api/premium/webhook")
    async def premium_webhook(request: Request):
        """Provision paid Stripe Checkout sessions independently of the browser."""
        stripe_key = core.get_stripe_secret_key()
        webhook_secret = core.get_stripe_webhook_secret()
        if not stripe_key or not webhook_secret:
            return core.json_error(503, "Stripe Webhook ist nicht vollständig konfiguriert.")
        try:
            import stripe
            stripe.api_key = stripe_key
            payload = await request.body()
            signature = request.headers.get("stripe-signature", "")
            event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
        except Exception:
            return core.json_error(400, "Ungültige Stripe-Webhook-Signatur.")

        if str(event.get("type") or "") != "checkout.session.completed":
            return {"received": True, "handled": False}
        session = ((event.get("data") or {}).get("object") or {})
        session_id = str(session.get("id") or "").strip()
        if not session_id or str(session.get("payment_status") or "") != "paid":
            return {"received": True, "handled": False}
        processed = core.get_processed_session(session_id)
        if processed:
            return {"received": True, "handled": True, "replay": True}

        metadata = session.get("metadata") or {}
        email = str(metadata.get("email") or session.get("customer_details", {}).get("email") or "").strip().lower()
        tier = str(metadata.get("tier") or "").strip().lower()
        seats = max(1, min(5, core.parse_int(metadata.get("seats", 1), 1)))
        months = core.normalize_months(metadata.get("months", 1))
        if not core.is_valid_email(email) or tier not in ("pro", "ultimate"):
            return core.json_error(400, "Stripe-Session enthält ungültige Lizenzdaten.")

        try:
            license_data = core.add_license(email, tier, months, seats, "stripe-webhook", f"Session: {session_id}")
            core.mark_processed_session(session_id, {
                "licenseKey": license_data.get("licenseKey"), "email": email, "tier": tier,
                "seats": seats, "expiresAt": license_data.get("expiresAt"),
            })
            email_status = await run_in_threadpool(core.send_license_email_best_effort, email, license_data)
            core.record_owner_audit("stripe.checkout.completed", target=session_id, detail=f"{tier} · seats={seats} · email={'sent' if email_status.get('ok') else 'pending'}")
            return {"received": True, "handled": True, "emailSent": bool(email_status.get("ok"))}
        except Exception:
            return core.json_error(500, "Lizenz konnte nicht provisioniert werden.")

    @router.post("/api/premium/verify")
    async def verify_premium(request: Request, body: dict):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited

        session_id = str(body.get("sessionId", "")).strip()
        if not session_id:
            return core.json_error(400, "sessionId erforderlich.")

        processed = core.get_processed_session(session_id)
        if processed:
            license_key = str(processed.get("licenseKey", "")).strip()
            existing_license = core.get_license_by_key(license_key)
            if existing_license:
                return {
                    "success": True,
                    "replay": True,
                    "licenseKey": license_key,
                    "email": existing_license.get("email"),
                    "tier": existing_license.get("tier"),
                    "seats": existing_license.get("seats"),
                    "expiresAt": existing_license.get("expiresAt"),
                    "message": "Session wurde bereits verarbeitet.",
                }
            return {
                "success": True,
                "replay": True,
                "licenseKey": license_key or None,
                "email": processed.get("email"),
                "tier": processed.get("tier"),
                "seats": processed.get("seats"),
                "expiresAt": processed.get("expiresAt"),
                "message": "Session wurde bereits verarbeitet.",
            }

        stripe_key = core.get_stripe_secret_key()
        valid, msg = core.validate_stripe_key(stripe_key)
        if not valid:
            return core.json_error(503, msg)

        try:
            import stripe
            stripe.api_key = stripe_key
            session = stripe.checkout.Session.retrieve(session_id)

            if session.payment_status == "paid":
                processed_race = core.get_processed_session(session_id)
                if processed_race:
                    license_key = str(processed_race.get("licenseKey", "")).strip()
                    existing_license = core.get_license_by_key(license_key)
                    if existing_license:
                        return {
                            "success": True,
                            "replay": True,
                            "licenseKey": license_key,
                            "email": existing_license.get("email"),
                            "tier": existing_license.get("tier"),
                            "seats": existing_license.get("seats"),
                            "expiresAt": existing_license.get("expiresAt"),
                            "message": "Session wurde bereits verarbeitet.",
                        }

                metadata = session.metadata or {}
                email = str(metadata.get("email", "")).strip().lower()
                tier = str(metadata.get("tier", "")).strip().lower()
                months_str = metadata.get("months", "1")
                seats_str = metadata.get("seats", "1")
                seats = max(1, min(5, core.parse_int(seats_str, 1)))

                if core.is_valid_email(email) and tier in ("pro", "ultimate"):
                    duration_months = core.normalize_months(months_str)
                    license_data = core.add_license(email, tier, duration_months, seats, "stripe", f"Session: {session_id}")
                    core.mark_processed_session(
                        session_id,
                        {
                            "licenseKey": license_data.get("licenseKey"),
                            "email": email,
                            "tier": tier,
                            "seats": seats,
                            "expiresAt": license_data.get("expiresAt"),
                        },
                    )

                    email_status = await run_in_threadpool(core.send_license_email_best_effort, email, license_data)

                    license_key = license_data.get("licenseKey", "")
                    tier_name = core.TIERS[tier]["name"]
                    msg = f"Lizenz {license_key} erstellt! {tier_name} fuer {seats} Server, {duration_months} Monat{'e' if duration_months > 1 else ''}."

                    return {
                        "success": True,
                        "replay": False,
                        "licenseKey": license_key,
                        "email": email,
                        "tier": tier,
                        "seats": seats,
                        "expiresAt": license_data.get("expiresAt"),
                        "message": msg,
                        "emailSent": bool(email_status.get("ok")),
                    }

            return {"success": False, "message": "Zahlung nicht abgeschlossen."}
        except Exception as e:
            return core.json_error(500, f"Verifizierung fehlgeschlagen: {core.clip_text(e)}")

    return router
