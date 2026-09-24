"""Premium state: licenses file and MongoDB sync, trials, offers, discounts and
processed checkout sessions.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timezone
import json

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def empty_premium_state():
    return {
        "licenses": {},
        "serverEntitlements": {},
        "processedSessions": {},
        "processedEvents": {},
        "trialClaims": {},
        "offers": {},
        "discordBotListState": {},
        "recentRedemptions": [],
    }


def ensure_premium_state(data):
    normalized = dict(data) if isinstance(data, dict) else {}
    defaults = core.empty_premium_state()
    for key, default_value in defaults.items():
        value = normalized.get(key)
        if isinstance(default_value, dict):
            normalized[key] = value if isinstance(value, dict) else {}
        elif isinstance(default_value, list):
            normalized[key] = value if isinstance(value, list) else []
        else:
            normalized[key] = value if value is not None else default_value
    return normalized


def list_recent_redemptions(limit=100):
    safe_limit = max(1, min(500, int(limit)))

    try:
        if core.COUPONS_FILE.exists():
            payload = json.loads(core.COUPONS_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                rows = payload.get("redemptions", {})
                if isinstance(rows, dict):
                    parsed_rows = []
                    for session_id, redemption in rows.items():
                        if not isinstance(redemption, dict):
                            continue
                        parsed_rows.append({
                            "sessionId": str(redemption.get("sessionId") or session_id).strip(),
                            **redemption,
                        })
                    parsed_rows.sort(key=lambda item: str(item.get("processedAt") or ""), reverse=True)
                    return parsed_rows[:safe_limit]
    except Exception:
        pass

    data = core.load_premium()
    rows = data.get("recentRedemptions", [])
    if not isinstance(rows, list):
        return []
    return rows[:safe_limit]


def load_premium():
    if core.db is not None:
        try:
            licenses = {}
            for doc in core.db.licenses.find({}, {"_id": 0}):
                lid = doc.pop("_licenseId", None)
                if lid:
                    licenses[lid] = doc
            server_ents = {}
            for doc in core.db.server_entitlements.find({}, {"_id": 0}):
                sid = doc.pop("_serverId", None)
                if sid:
                    server_ents[sid] = doc
            processed = {}
            for doc in core.db.processed_sessions.find({}, {"_id": 0}):
                sess_id = doc.pop("_sessionId", None)
                if sess_id:
                    processed[sess_id] = doc
            processed_events = {}
            for doc in core.db.processed_events.find({}, {"_id": 0}):
                event_id = doc.pop("_eventId", None)
                if event_id:
                    processed_events[event_id] = doc
            meta = core.db.premium_state.find_one({"_id": "meta"}, {"_id": 0}) or {}
            state = core.ensure_premium_state({
                **meta,
                "licenses": licenses,
                "serverEntitlements": server_ents,
                "processedSessions": processed,
                "processedEvents": processed_events,
            })
            # Keep the exact Mongo snapshot with the in-memory state. save_premium
            # uses it to write only the caller's changes instead of replacing
            # collections that the Discord runtime may be updating concurrently.
            state["_mongoBaseline"] = {
                key: json.loads(json.dumps(state.get(key)))
                for key in (
                    "licenses", "serverEntitlements", "processedSessions", "processedEvents",
                    "trialClaims", "offers", "discordBotListState", "recentRedemptions",
                )
            }
            return state
        except Exception:
            pass
    try:
        if core.PREMIUM_FILE.exists():
            return core.ensure_premium_state(json.loads(core.PREMIUM_FILE.read_text(encoding="utf-8")))
        return core.empty_premium_state()
    except Exception:
        return core.empty_premium_state()


def save_premium(data):
    safe_data = core.ensure_premium_state(data)
    baseline = safe_data.pop("_mongoBaseline", {})

    def sync_map(collection, id_field, map_key):
        before = baseline.get(map_key, {}) if isinstance(baseline, dict) else {}
        before = before if isinstance(before, dict) else {}
        current = safe_data.get(map_key, {})
        current = current if isinstance(current, dict) else {}
        for record_id, value in current.items():
            if not isinstance(value, dict) or isinstance(value, list):
                continue
            if before.get(record_id) == value:
                continue
            collection.replace_one(
                {id_field: record_id},
                {**value, id_field: record_id},
                upsert=True,
            )
        removed_ids = list(set(before.keys()) - set(current.keys()))
        if removed_ids:
            collection.delete_many({id_field: {"$in": removed_ids}})

    if core.db is not None:
        try:
            sync_map(core.db.licenses, "_licenseId", "licenses")
            sync_map(core.db.server_entitlements, "_serverId", "serverEntitlements")
            sync_map(core.db.processed_sessions, "_sessionId", "processedSessions")
            sync_map(core.db.processed_events, "_eventId", "processedEvents")

            # Meta sections are updated independently so an offer edit cannot
            # overwrite a concurrent trial claim or bot-list statistics update.
            changed_meta = {}
            for key in ("trialClaims", "offers", "discordBotListState", "recentRedemptions"):
                if not isinstance(baseline, dict) or baseline.get(key) != safe_data.get(key):
                    changed_meta[key] = safe_data.get(key)
            if changed_meta:
                core.db.premium_state.update_one(
                    {"_id": "meta"},
                    {"$set": changed_meta},
                    upsert=True,
                )
            return
        except Exception:
            pass
    tmp_file = core.PREMIUM_FILE.with_suffix(core.PREMIUM_FILE.suffix + ".tmp")
    payload = json.dumps(safe_data, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp_file.write_text(payload, encoding="utf-8")
        tmp_file.replace(core.PREMIUM_FILE)
    except Exception:
        core.PREMIUM_FILE.write_text(payload, encoding="utf-8")
    finally:
        try:
            if tmp_file.exists():
                tmp_file.unlink()
        except Exception:
            pass


def list_licenses_by_contact_email(email):
    needle = str(email or "").strip().lower()
    if not needle:
        return []
    data = core.load_premium()
    matches = []
    for key, lic in data.get("licenses", {}).items():
        if not isinstance(lic, dict):
            continue
        lic_email = str(lic.get("email") or lic.get("contactEmail") or "").strip().lower()
        if lic_email == needle:
            matches.append({"licenseKey": key, **lic})
    return matches


def reserve_trial_claim(email, payload=None):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return {"ok": False}

    data = core.load_premium()
    claims = data.setdefault("trialClaims", {})
    if normalized_email in claims:
        return {"ok": False}

    claims[normalized_email] = {
        "email": normalized_email,
        "requestedAt": datetime.now(timezone.utc).isoformat(),
        **(payload or {}),
    }
    core.save_premium(data)
    return {"ok": True}


def release_trial_claim(email):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return
    data = core.load_premium()
    claims = data.setdefault("trialClaims", {})
    if normalized_email in claims:
        claims.pop(normalized_email, None)
        core.save_premium(data)


def finalize_trial_claim(email, payload=None):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return
    data = core.load_premium()
    claims = data.setdefault("trialClaims", {})
    current = claims.get(normalized_email, {})
    claims[normalized_email] = {
        **current,
        **(payload or {}),
        "finalizedAt": datetime.now(timezone.utc).isoformat(),
    }
    core.save_premium(data)


def list_offers(include_inactive=True):
    data = core.load_premium()
    offers = data.get("offers", {})
    rows = []
    for code, offer in offers.items():
        if not isinstance(offer, dict):
            continue
        row = {"code": code, **offer}
        if not include_inactive and not row.get("active", True):
            continue
        rows.append(row)
    rows.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return rows


def get_offer(code):
    normalized = core.sanitize_offer_code(code)
    if not normalized:
        return None
    data = core.load_premium()
    offer = data.get("offers", {}).get(normalized)
    if not isinstance(offer, dict):
        return None
    return {"code": normalized, **offer}


def upsert_offer(payload, partial=False):
    body = payload if isinstance(payload, dict) else {}
    code = core.sanitize_offer_code(body.get("code"))
    if not code:
        raise ValueError("code ist erforderlich.")

    data = core.load_premium()
    offers = data.setdefault("offers", {})
    existing = offers.get(code, {}) if isinstance(offers.get(code), dict) else {}

    if partial and not existing:
        raise ValueError("Code nicht gefunden.")

    discount_percent = core.parse_int(body.get("discountPercent"), existing.get("discountPercent", 0))
    discount_percent = max(0, min(100, discount_percent))
    discount_cents = core.parse_int(body.get("discountCents"), existing.get("discountCents", 0))
    discount_cents = max(0, discount_cents)
    max_uses = core.parse_int(body.get("maxUses"), existing.get("maxUses", 0))
    max_uses = max(0, max_uses)
    uses = core.parse_int(existing.get("uses", 0), 0)

    now_iso = datetime.now(timezone.utc).isoformat()
    next_offer = {
        **existing,
        "label": core.clip_text(body.get("label", existing.get("label", "")), 120),
        "description": core.clip_text(body.get("description", existing.get("description", "")), 400),
        "active": bool(body.get("active", existing.get("active", True))),
        "tier": str(body.get("tier", existing.get("tier", ""))).strip().lower(),
        "discountPercent": discount_percent,
        "discountCents": discount_cents,
        "maxUses": max_uses,
        "uses": uses,
        "startsAt": str(body.get("startsAt", existing.get("startsAt", ""))).strip() or None,
        "endsAt": str(body.get("endsAt", existing.get("endsAt", ""))).strip() or None,
        "createdAt": existing.get("createdAt", now_iso),
        "createdBy": str(body.get("createdBy", existing.get("createdBy", "api-admin"))).strip() or "api-admin",
        "updatedAt": now_iso,
        "updatedBy": str(body.get("updatedBy", existing.get("updatedBy", "api-admin"))).strip() or "api-admin",
    }

    if next_offer.get("tier") not in ("", "pro", "ultimate"):
        raise ValueError("tier muss leer, 'pro' oder 'ultimate' sein.")
    if next_offer.get("discountPercent", 0) <= 0 and next_offer.get("discountCents", 0) <= 0:
        raise ValueError("discountPercent oder discountCents muss gesetzt sein.")

    offers[code] = next_offer
    core.save_premium(data)
    return {"code": code, **next_offer}


def delete_offer(code):
    normalized = core.sanitize_offer_code(code)
    if not normalized:
        return False
    data = core.load_premium()
    offers = data.setdefault("offers", {})
    if normalized not in offers:
        return False
    offers.pop(normalized, None)
    core.save_premium(data)
    return True


def set_offer_active(code, active=True):
    normalized = core.sanitize_offer_code(code)
    if not normalized:
        return None
    data = core.load_premium()
    offers = data.setdefault("offers", {})
    existing = offers.get(normalized)
    if not isinstance(existing, dict):
        return None
    existing["active"] = bool(active)
    existing["updatedAt"] = datetime.now(timezone.utc).isoformat()
    existing["updatedBy"] = str(existing.get("updatedBy") or "api-admin")
    offers[normalized] = existing
    core.save_premium(data)
    return {"code": normalized, **existing}


def resolve_discount_preview(tier, seats, months, email, coupon_code, language="de"):
    lang = core.normalize_language(language, "de")
    def tmsg(de, en):
        return de if lang == "de" else en

    normalized_tier = str(tier or "").strip().lower()
    if normalized_tier not in ("pro", "ultimate"):
        return {"ok": False, "status": 400, "error": tmsg("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.")}

    if not core.is_valid_email(email):
        return {"ok": False, "status": 400, "error": tmsg("Bitte eine gueltige E-Mail-Adresse eingeben.", "Please enter a valid email address.")}

    duration_months = core.normalize_duration(months)
    normalized_seats = max(1, min(5, core.parse_int(seats, 1)))
    base_amount_cents = core.calculate_price(normalized_tier, duration_months, normalized_seats)
    if base_amount_cents <= 0:
        return {"ok": False, "status": 400, "error": tmsg("Ungueltige Preisberechnung fuer die gewaehlte Kombination.", "Invalid price calculation for the selected combination.")}

    code = core.sanitize_offer_code(coupon_code)
    if not code:
        return {
            "ok": True,
            "preview": {
                "code": None,
                "discountCents": 0,
                "finalAmountCents": base_amount_cents,
                "baseAmountCents": base_amount_cents,
            },
        }

    offer = core.get_offer(code)
    if not offer:
        return {"ok": False, "status": 404, "error": tmsg("Gutscheincode nicht gefunden.", "Coupon code not found.")}
    if not offer.get("active", True):
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist nicht aktiv.", "Coupon code is not active.")}

    offer_tier = str(offer.get("tier") or "").strip().lower()
    if offer_tier and offer_tier != normalized_tier:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode gilt nicht fuer diesen Plan.", "Coupon code is not valid for this plan.")}

    starts_at = core.parse_iso_datetime(offer.get("startsAt"))
    ends_at = core.parse_iso_datetime(offer.get("endsAt"))
    now = datetime.now(timezone.utc)
    if starts_at and starts_at > now:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist noch nicht aktiv.", "Coupon code is not active yet.")}
    if ends_at and ends_at < now:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist abgelaufen.", "Coupon code has expired.")}

    max_uses = max(0, core.parse_int(offer.get("maxUses"), 0))
    used = max(0, core.parse_int(offer.get("uses"), 0))
    if max_uses > 0 and used >= max_uses:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode wurde bereits zu oft eingeloest.", "Coupon code has already been redeemed too many times.")}

    discount_percent = max(0, min(100, core.parse_int(offer.get("discountPercent"), 0)))
    discount_fixed = max(0, core.parse_int(offer.get("discountCents"), 0))
    percent_cents = round(base_amount_cents * (discount_percent / 100)) if discount_percent > 0 else 0
    discount_cents = max(percent_cents, discount_fixed)
    discount_cents = max(0, min(base_amount_cents, discount_cents))
    final_amount_cents = max(0, base_amount_cents - discount_cents)

    return {
        "ok": True,
        "preview": {
            "code": code,
            "label": offer.get("label") or code,
            "discountCents": discount_cents,
            "finalAmountCents": final_amount_cents,
            "baseAmountCents": base_amount_cents,
        },
    }


def get_processed_session(session_id):
    sid = str(session_id or "").strip()
    if not sid:
        return None
    data = core.load_premium()
    return data.get("processedSessions", {}).get(sid)


def mark_processed_session(session_id, payload):
    sid = str(session_id or "").strip()
    if not sid:
        return
    data = core.load_premium()
    data.setdefault("processedSessions", {})[sid] = {
        **(payload or {}),
        "processedAt": datetime.now(timezone.utc).isoformat(),
    }

    # Keep processedSessions bounded.
    processed = data.get("processedSessions", {})
    if len(processed) > 5000:
        ordered = sorted(
            processed.items(),
            key=lambda entry: str(entry[1].get("processedAt", "")),
            reverse=True,
        )
        data["processedSessions"] = dict(ordered[:5000])

    core.save_premium(data)


__all__ = [
    "empty_premium_state",
    "ensure_premium_state",
    "list_recent_redemptions",
    "load_premium",
    "save_premium",
    "list_licenses_by_contact_email",
    "reserve_trial_claim",
    "release_trial_claim",
    "finalize_trial_claim",
    "list_offers",
    "get_offer",
    "upsert_offer",
    "delete_offer",
    "set_offer_active",
    "resolve_discount_preview",
    "get_processed_session",
    "mark_processed_session",
]
