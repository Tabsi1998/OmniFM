"""Licenses: tiers, prices, license keys, server links, Stripe settings and
license mails.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from email.message import EmailMessage
import os
import secrets
import smtplib
import ssl
import string

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def is_expired(license_info):
    if not license_info or not license_info.get("expiresAt"):
        return False
    return datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc)


def remaining_days(license_info):
    if not license_info or not license_info.get("expiresAt"):
        return 0
    diff = datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
    return max(0, int(diff.total_seconds() / 86400) + 1)


def get_server_license(server_id):
    """Get license for a server - supports both old and new format"""
    data = core.load_premium()
    sid = str(server_id or "").strip()
    if not sid:
        return None

    def resolved_license(lic, source, license_id=None):
        expired = core.is_expired(lic)
        active = bool(lic.get("active", True)) and not expired
        plan = str(lic.get("plan") or lic.get("tier") or "free").strip().lower()
        if plan not in core.TIERS:
            plan = "free"
        return {
            **lic,
            "expired": expired,
            "remainingDays": core.remaining_days(lic),
            "active": active,
            "activeTier": plan if active else "free",
            "tier": plan,
            "plan": plan,
            "resolutionSource": source,
            "_licenseId": str(license_id or lic.get("id") or ""),
        }

    # New format: serverEntitlements -> licenseId -> licenses
    if "serverEntitlements" in data:
        entitlements = data.get("serverEntitlements", {})
        ent = entitlements.get(sid)
        if not ent:
            # Be tolerant of old Mongo documents whose _serverId was stored as
            # a number. New writes are always normalized strings.
            ent = next((value for key, value in entitlements.items() if str(key) == sid), None)
        # Compatibility/self-healing read for links created by older Owner APIs,
        # which updated linkedServerIds but forgot serverEntitlements.
        if not ent:
            for license_id, candidate in data.get("licenses", {}).items():
                if sid in [str(item) for item in (candidate.get("linkedServerIds") or [])]:
                    ent = {"serverId": sid, "licenseId": license_id, "_legacyLink": True}
                    break
        if ent:
            license_id = str(ent.get("licenseId") or "")
            lic = data.get("licenses", {}).get(license_id)
            if not lic:
                lic = next((value for key, value in data.get("licenses", {}).items() if str(key) == license_id), None)
            if lic:
                return resolved_license(lic, "linkedServerIds" if ent.get("_legacyLink") else "serverEntitlement", license_id)

    # Old format: licenses keyed by serverId
    lic = data.get("licenses", {}).get(sid)
    if not lic:
        return None
    return resolved_license(lic, "legacyServerKey", sid)


def get_license_by_key(license_key):
    key = str(license_key or "").strip()
    if not key:
        return None
    data = core.load_premium()
    lic = data.get("licenses", {}).get(key)
    if not lic:
        return None
    expired = core.is_expired(lic)
    active = bool(lic.get("active", True)) and not expired
    return {
        **lic,
        "licenseKey": key,
        "expired": expired,
        "active": active,
        "remainingDays": core.remaining_days(lic),
        "activeTier": lic.get("tier", lic.get("plan", "free")) if active else "free",
        "tier": lic.get("tier", lic.get("plan", "free")),
    }


def get_tier(server_id):
    lic = core.get_server_license(server_id)
    if not lic or lic.get("expired") or not lic.get("active", True):
        return "free"
    tier = lic.get("tier", lic.get("plan", "free"))
    return tier if tier in core.TIERS else "free"


def get_license(server_id):
    return core.get_server_license(server_id)


def get_duration_price(tier, months):
    months = core.normalize_duration(months)
    pricing = core.DURATION_PRICING.get(tier, {})
    return pricing.get(months, pricing.get(1, 0))


def get_seat_monthly_total(tier, seats):
    seats = max(1, int(seats) if isinstance(seats, (int, float)) else 1)
    seat_pricing = core.SEAT_MONTHLY_TOTAL_CENTS.get(tier, {})
    if seats in seat_pricing:
        return seat_pricing[seats]
    closest = min(core.SEAT_OPTIONS, key=lambda x: abs(x - seats))
    return seat_pricing.get(closest, seat_pricing.get(1, 0))


def calculate_price(tier, months, seats=1):
    months = core.normalize_duration(months)
    seats = max(1, int(seats) if isinstance(seats, (int, float)) else 1)
    base_1mo = core.get_duration_price(tier, 1)
    duration_1mo = core.get_duration_price(tier, months)
    if base_1mo <= 0:
        return 0
    discount_ratio = duration_1mo / base_1mo
    seat_total_1mo = core.get_seat_monthly_total(tier, seats)
    price_per_month = round(seat_total_1mo * discount_ratio)
    return months * price_per_month


def calculate_upgrade_price(server_id, new_tier):
    lic = core.get_server_license(server_id)
    if not lic or lic.get("expired"):
        return None
    old_tier = lic.get("tier", "free")
    seats = max(1, int(lic.get("seats", 1) or 1))
    old_ppm = core.get_seat_monthly_total(old_tier, seats)
    new_ppm = core.get_seat_monthly_total(new_tier, seats)
    if new_ppm <= old_ppm:
        return None
    days_left = lic.get("remainingDays", 0)
    if days_left <= 0:
        return None
    diff_daily = (new_ppm - old_ppm) / 30
    upgrade_cost = round(diff_daily * days_left)
    return {
        "oldTier": old_tier,
        "newTier": new_tier,
        "daysLeft": days_left,
        "seats": seats,
        "upgradeCost": upgrade_cost,
    }


def generate_license_key():
    """Generiert einen eindeutigen Lizenz-Key im Format OMNI-XXXX-XXXX-XXXX"""
    chars = string.ascii_uppercase + string.digits
    parts = [''.join(secrets.choice(chars) for _ in range(4)) for _ in range(3)]
    return f"OMNI-{parts[0]}-{parts[1]}-{parts[2]}"


def add_license(email, tier, months, seats=1, activated_by="stripe", note=""):
    if tier not in core.TIERS or tier == "free":
        raise ValueError("Tier muss 'pro' oder 'ultimate' sein.")
    months = core.normalize_months(months)
    seats = max(1, min(5, int(seats) if isinstance(seats, (int, float)) else 1))
    if months < 1:
        raise ValueError("Mindestens 1 Monat.")
    data = core.load_premium()
    now = datetime.now(timezone.utc)

    license_key = core.generate_license_key()
    # Sicherstellen dass der Key eindeutig ist
    while license_key in data.get("licenses", {}):
        license_key = core.generate_license_key()

    data.setdefault("licenses", {})[license_key] = {
        "id": license_key,
        "tier": tier,
        "plan": tier,
        "seats": seats,
        "active": True,
        "email": email,
        "contactEmail": email,
        "linkedServerIds": [],
        "createdAt": now.isoformat(),
        "updatedAt": now.isoformat(),
        "activatedAt": now.isoformat(),
        "expiresAt": (now + timedelta(days=months * 30)).isoformat(),
        "durationMonths": months,
        "activatedBy": activated_by,
        "note": note,
    }
    core.save_premium(data)
    return {**data["licenses"][license_key], "licenseKey": license_key}


def upgrade_license(server_id, new_tier):
    data = core.load_premium()
    sid = str(server_id)
    lic = data.get("licenses", {}).get(sid)
    if not lic or lic.get("active", True) is False or core.is_expired(lic):
        raise ValueError("Keine aktive Lizenz zum Upgraden.")
    data["licenses"][sid] = {
        **lic,
        "tier": new_tier,
        "plan": new_tier,
        "upgradedAt": datetime.now(timezone.utc).isoformat(),
        "upgradedFrom": lic.get("tier"),
    }
    core.save_premium(data)
    return data["licenses"][sid]


def sanitize_license_for_api(license_info, include_sensitive=False):
    if not license_info:
        return None

    plan = license_info.get("tier", license_info.get("plan", "free"))
    expired = bool(license_info.get("expired"))
    active = bool(license_info.get("active", True)) and not expired
    payload = {
        "tier": plan,
        "plan": plan,
        "seats": 1,
        "active": active,
        "expired": expired,
        "expiresAt": license_info.get("expiresAt"),
        "remainingDays": license_info.get("remainingDays", 0),
    }

    linked_server_ids = list(license_info.get("linkedServerIds", []))

    if include_sensitive:
        payload["linkedServerIds"] = linked_server_ids
        payload["email"] = license_info.get("email", "")
    else:
        payload["linkedServerCount"] = len(linked_server_ids)
        payload["emailMasked"] = core.mask_email(license_info.get("email", ""))

    return payload


def _license_rows(state):
    rows = []
    licenses = (state or {}).get("licenses", {}) or {}
    for lid, lic in licenses.items():
        if not isinstance(lic, dict):
            continue
        plan = str(lic.get("plan") or lic.get("tier") or "free").lower()
        seats = max(1, core.parse_int(lic.get("seats", 1), 1))
        try:
            days_left = core.remaining_days(lic)
        except Exception:
            days_left = None
        try:
            expired = bool(core.is_expired(lic))
        except Exception:
            expired = False
        active = bool(lic.get("active", True)) and not expired
        linked = lic.get("linkedServerIds") or []
        if not isinstance(linked, list):
            linked = []
        rows.append({
            "id": str(lic.get("id") or lid),
            "plan": plan,
            "planName": (core.TIERS.get(plan) or {}).get("name", plan.title()),
            "seats": seats,
            "seatsUsed": len(linked),
            "active": active,
            "expired": expired,
            "daysLeft": days_left,
            "expiresAt": lic.get("expiresAt"),
            "createdAt": lic.get("createdAt") or lic.get("issuedAt"),
            "source": lic.get("source") or "manual",
            "contactEmail": core.mask_email(str(lic.get("contactEmail") or lic.get("email") or "")),
            "linkedServerIds": [str(s) for s in linked][:25],
        })
    rows.sort(key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    return rows


def _normalize_license_server_ids(values):
    raw_values = values if isinstance(values, list) else [values]
    normalized = []
    invalid = []
    for value in raw_values:
        server_id = str(value or "").strip()
        if not server_id:
            continue
        if not core.is_valid_server_id(server_id):
            invalid.append(server_id)
            continue
        if server_id not in normalized:
            normalized.append(server_id)
    return normalized, invalid


def _set_license_server_links(state, license_key, server_ids):
    licenses = state.setdefault("licenses", {})
    entitlements = state.setdefault("serverEntitlements", {})
    license_info = licenses.get(license_key)
    if not isinstance(license_info, dict):
        raise ValueError("Lizenz nicht gefunden.")

    normalized, invalid = core._normalize_license_server_ids(server_ids)
    if invalid:
        raise ValueError(f"Ungültige Discord Guild-ID: {invalid[0]}. Erwartet werden 17–22 Ziffern.")
    seats = max(1, core.parse_int(license_info.get("seats", 1), 1))
    if len(normalized) > seats:
        raise ValueError(f"Diese Lizenz hat {seats} Seat(s), angefordert wurden {len(normalized)} Server.")

    previous = {str(item) for item in (license_info.get("linkedServerIds") or [])}
    target = set(normalized)
    for server_id in previous - target:
        current = entitlements.get(server_id)
        if str((current or {}).get("licenseId") or "") == str(license_key):
            entitlements.pop(server_id, None)

    for server_id in normalized:
        current_license_id = str((entitlements.get(server_id) or {}).get("licenseId") or "")
        conflicting_ids = {current_license_id} if current_license_id else set()
        conflicting_ids.update(
            str(other_id) for other_id, other_license in licenses.items()
            if str(other_id) != str(license_key)
            and server_id in [str(item) for item in (other_license.get("linkedServerIds") or [])]
        )
        for old_license_id in conflicting_ids:
            if not old_license_id or old_license_id == str(license_key):
                continue
            old_license = licenses.get(old_license_id)
            if not isinstance(old_license, dict):
                continue
            old_license["linkedServerIds"] = [
                item for item in (old_license.get("linkedServerIds") or [])
                if str(item) != server_id
            ]
            old_license["updatedAt"] = datetime.now(timezone.utc).isoformat()
        entitlements[server_id] = {"serverId": server_id, "licenseId": str(license_key)}

    license_info["linkedServerIds"] = normalized
    license_info["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return normalized


def _admin_license_rows(state):
    """Wie _license_rows, aber mit vollständigen Daten für die Owner-Verwaltung
    (unmaskierte E-Mail + Lizenz-Key/GUID, damit man gezielt suchen/bearbeiten kann)."""
    rows = []
    licenses = (state or {}).get("licenses", {}) or {}
    guild_directory = core._runtime_guild_directory()
    for lid, lic in licenses.items():
        if not isinstance(lic, dict):
            continue
        plan = str(lic.get("plan") or lic.get("tier") or "free").lower()
        seats = max(1, core.parse_int(lic.get("seats", 1), 1))
        try:
            days_left = core.remaining_days(lic)
        except Exception:
            days_left = None
        try:
            expired = bool(core.is_expired(lic))
        except Exception:
            expired = False
        active = bool(lic.get("active", True)) and not expired
        linked = lic.get("linkedServerIds") or []
        if not isinstance(linked, list):
            linked = []
        linked_ids = [str(s) for s in linked][:50]
        linked_resolution = {}
        for server_id in linked_ids:
            resolved = core.get_server_license(server_id)
            linked_resolution[server_id] = {
                "resolved": bool(resolved and resolved.get("active") and not resolved.get("expired") and str(resolved.get("_licenseId") or "") == str(lid)),
                "effectivePlan": (resolved or {}).get("activeTier", "free"),
                "resolutionSource": (resolved or {}).get("resolutionSource"),
            }
        rows.append({
            "licenseKey": str(lid),
            "id": str(lic.get("id") or lid),
            "plan": plan,
            "planName": (core.TIERS.get(plan) or {}).get("name", plan.title()),
            "seats": seats,
            "seatsUsed": len(linked),
            "active": active,
            "expired": expired,
            "daysLeft": days_left,
            "expiresAt": lic.get("expiresAt"),
            "activatedAt": lic.get("activatedAt"),
            "createdAt": lic.get("createdAt") or lic.get("issuedAt") or lic.get("activatedAt"),
            "durationMonths": lic.get("durationMonths"),
            "source": lic.get("source") or lic.get("activatedBy") or "manual",
            "email": str(lic.get("contactEmail") or lic.get("email") or ""),
            "note": str(lic.get("note") or ""),
            "linkedServerIds": linked_ids,
            "linkedServers": [{
                "id": server_id,
                "name": (guild_directory.get(server_id) or {}).get("name") or server_id,
                "known": server_id in guild_directory,
                "valid": core.is_valid_server_id(server_id),
                "memberCount": (guild_directory.get(server_id) or {}).get("memberCount", 0),
                "iconUrl": (guild_directory.get(server_id) or {}).get("iconUrl"),
                "bots": (guild_directory.get(server_id) or {}).get("bots", []),
                "discordUrl": f"https://discord.com/channels/{server_id}" if core.is_valid_server_id(server_id) else None,
                "licenseResolved": linked_resolution[server_id]["resolved"],
                "effectivePlan": linked_resolution[server_id]["effectivePlan"],
                "resolutionSource": linked_resolution[server_id]["resolutionSource"],
            } for server_id in linked_ids],
        })
    rows.sort(key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    return rows


def get_stripe_secret_key():
    try:
        cfg_key = str(((core.get_config_section("payments") or {}).get("stripe") or {}).get("secretKey") or "").strip()
        if cfg_key:
            return cfg_key
    except Exception:
        pass
    key = (os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "").strip()
    return key


def is_stripe_enabled():
    stored = ((core.load_owner_config_raw().get("payments") or {}).get("stripe") or {})
    if "enabled" in stored:
        return bool(stored.get("enabled"))
    return bool(core.get_stripe_secret_key())


def get_stripe_webhook_secret():
    try:
        value = str(((core.get_config_section("payments") or {}).get("stripe") or {}).get("webhookSecret") or "").strip()
        if value:
            return value
    except Exception:
        pass
    return str(os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()


def send_license_email_best_effort(email, license_data):
    host = str(core.system_setting("smtp", "host", "SMTP_HOST") or "").strip()
    if not host or not core.config_bool(core.system_setting("smtp", "enabled", default=True), True):
        return {"ok": False, "message": "smtp_not_configured"}
    port = core.parse_int(core.system_setting("smtp", "port", "SMTP_PORT", 587), 587)
    secure = core.config_bool(core.system_setting("smtp", "secure", "SMTP_SECURE", False))
    user = str(core.system_setting("smtp", "user", "SMTP_USER") or "").strip()
    password = str(core.system_setting("smtp", "password", "SMTP_PASS") or "")
    sender = str(core.system_setting("smtp", "from", "SMTP_FROM") or user or "").strip()
    if not sender:
        return {"ok": False, "message": "smtp_sender_missing"}
    message = EmailMessage()
    message["Subject"] = f"Deine OmniFM {str(license_data.get('tier') or '').title()} Lizenz"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        "Vielen Dank für deinen Einkauf bei OmniFM.\n\n"
        f"Lizenz-Key: {license_data.get('licenseKey')}\n"
        f"Plan: {str(license_data.get('tier') or '').title()}\n"
        f"Server-Slots: {license_data.get('seats', 1)}\n"
        f"Gültig bis: {license_data.get('expiresAt')}\n\n"
        "Bewahre den Lizenz-Key sicher auf."
    )
    connection = None
    try:
        if secure:
            connection = smtplib.SMTP_SSL(host, port, timeout=15, context=ssl.create_default_context())
        else:
            connection = smtplib.SMTP(host, port, timeout=15)
            connection.ehlo()
            if connection.has_extn("STARTTLS"):
                connection.starttls(context=ssl.create_default_context())
                connection.ehlo()
        if user:
            connection.login(user, password)
        connection.send_message(message)
        return {"ok": True, "message": "sent"}
    except Exception as exc:
        return {"ok": False, "message": core.clip_text(exc, 160)}
    finally:
        try:
            if connection:
                connection.quit()
        except Exception:
            pass


def validate_stripe_key(key):
    """Prueft ob der Stripe Key gueltig aussieht"""
    if not key:
        return False, "Stripe ist nicht konfiguriert. Bitte STRIPE_SECRET_KEY oder STRIPE_API_KEY in der .env setzen."
    if not (key.startswith("sk_test_") or key.startswith("sk_live_")):
        return False, "Stripe API-Key ungueltig. Der Key muss mit 'sk_test_' oder 'sk_live_' beginnen. Bitte den richtigen Secret Key aus dem Stripe Dashboard verwenden."
    if len(key) < 30:
        return False, "Stripe API-Key zu kurz. Bitte den vollstaendigen Key aus dem Stripe Dashboard kopieren."
    return True, ""


__all__ = [
    "is_expired",
    "remaining_days",
    "get_server_license",
    "get_license_by_key",
    "get_tier",
    "get_license",
    "get_duration_price",
    "get_seat_monthly_total",
    "calculate_price",
    "calculate_upgrade_price",
    "generate_license_key",
    "add_license",
    "upgrade_license",
    "sanitize_license_for_api",
    "_license_rows",
    "_normalize_license_server_ids",
    "_set_license_server_links",
    "_admin_license_rows",
    "get_stripe_secret_key",
    "is_stripe_enabled",
    "get_stripe_webhook_secret",
    "send_license_email_best_effort",
    "validate_stripe_key",
]
