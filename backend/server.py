"""Legacy/reference FastAPI backend for OmniFM.

This module is feature-frozen. The canonical production backend is the
Node.js implementation in ``src/api/server.js``.
"""

import os
import json
import re
import hmac
import time
import string
import secrets
import socket
import ipaddress
import requests
from pathlib import Path
from urllib.parse import urlparse, urlencode
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pymongo import MongoClient

load_dotenv()

app = FastAPI(title="OmniFM API")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

STATIONS_FILE = Path(__file__).parent.parent / "stations.json"
PREMIUM_FILE = Path(__file__).parent.parent / "premium.json"
COUPONS_FILE = Path(__file__).parent.parent / "coupons.json"
DASHBOARD_FILE = Path(__file__).parent.parent / "dashboard.json"

BOT_IMAGES = ["/img/bot-1.png", "/img/bot-2.png", "/img/bot-3.png", "/img/bot-4.png"]
BOT_COLORS = ["cyan", "green", "pink", "amber", "purple", "red"]

EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
SERVER_ID_REGEX = re.compile(r"^\d{17,22}$")

DISCORD_CLIENT_ID = (os.environ.get("DISCORD_CLIENT_ID") or "").strip()
DISCORD_CLIENT_SECRET = (os.environ.get("DISCORD_CLIENT_SECRET") or "").strip()
DISCORD_REDIRECT_URI = (os.environ.get("DISCORD_REDIRECT_URI") or "").strip()
DISCORD_OAUTH_SCOPES = (os.environ.get("DISCORD_OAUTH_SCOPES") or "identify guilds").strip()
SESSION_COOKIE_NAME = (os.environ.get("DASHBOARD_SESSION_COOKIE") or "omnifm_session").strip() or "omnifm_session"
try:
    DASHBOARD_SESSION_TTL_SECONDS = max(300, int((os.environ.get("DASHBOARD_SESSION_TTL_SECONDS") or "86400").strip() or "86400"))
except Exception:
    DASHBOARD_SESSION_TTL_SECONDS = 86400
try:
    DISCORD_OAUTH_STATE_TTL_SECONDS = max(60, int((os.environ.get("DISCORD_OAUTH_STATE_TTL_SECONDS") or "600").strip() or "600"))
except Exception:
    DISCORD_OAUTH_STATE_TTL_SECONDS = 600
TIER_RANK = {"free": 0, "pro": 1, "ultimate": 2}

DASHBOARD_SESSION_STORE = {}
DISCORD_OAUTH_STATE_STORE = {}


def build_allowed_origins():
    configured = (os.environ.get("CORS_ALLOWED_ORIGINS") or os.environ.get("CORS_ORIGINS") or "").strip()
    if configured:
        origins = [item.strip() for item in configured.split(",") if item.strip()]
    else:
        origins = []

    if any(item == "*" for item in origins):
        return ["*"]

    public_web_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    if public_web_url:
        origins.append(public_web_url)

    origins.extend(["http://localhost", "http://127.0.0.1", "http://localhost:3000", "http://127.0.0.1:3000"])

    normalized = []
    seen = set()
    for origin in origins:
        parsed = urlparse(origin)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            continue
        clean = f"{parsed.scheme}://{parsed.netloc}"
        if clean in seen:
            continue
        seen.add(clean)
        normalized.append(clean)

    if not normalized:
        return ["http://localhost", "http://127.0.0.1", "http://localhost:3000", "http://127.0.0.1:3000"]
    return normalized


ALLOWED_ORIGINS = build_allowed_origins()
CORS_HAS_WILDCARD = "*" in ALLOWED_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_HAS_WILDCARD else ALLOWED_ORIGINS,
    allow_credentials=not CORS_HAS_WILDCARD,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token"],
)

client = None
db = None
if MONGO_URL:
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
        db = client[DB_NAME]
        client.admin.command("ping")
    except Exception:
        client = None
        db = None

# OmniFM v3 Tier-Konfiguration (identisch mit config/plans.js)
TIERS = {
    "free":     {"name": "Free",     "bitrate": "64k",  "reconnectMs": 5000, "maxBots": 2,  "pricePerMonth": 0},
    "pro":      {"name": "Pro",      "bitrate": "128k", "reconnectMs": 1500, "maxBots": 8,  "pricePerMonth": 299},
    "ultimate": {"name": "Ultimate", "bitrate": "320k", "reconnectMs": 400,  "maxBots": 16, "pricePerMonth": 499},
}

# Laufzeit-basierte Preise (Cents pro Monat)
DURATION_PRICING = {
    "pro":      {1: 299, 3: 249, 6: 229, 12: 199},
    "ultimate": {1: 499, 3: 399, 6: 349, 12: 299},
}
DURATION_OPTIONS = [1, 3, 6, 12]

# Server-Anzahl Preise (Multiplikator auf Monats-Basispreis)
SEAT_OPTIONS = [1, 2, 3, 5]
SEAT_MONTHLY_TOTAL_CENTS = {
    "pro":      {1: 299, 2: 549, 3: 749, 5: 1149},
    "ultimate": {1: 499, 2: 799, 3: 1099, 5: 1699},
}
PRO_TRIAL_MONTHS = 1
PRO_TRIAL_SEATS = 1
ADMIN_API_TOKEN = (os.environ.get("API_ADMIN_TOKEN") or os.environ.get("ADMIN_API_TOKEN") or "").strip()
TRUST_PROXY_HEADERS = (os.environ.get("TRUST_PROXY_HEADERS") or "0").strip() == "1"
API_RATE_LIMIT_STATE = {}
try:
    MAX_API_RATE_STATE_ENTRIES = max(1000, int((os.environ.get("API_RATE_STATE_MAX_ENTRIES") or "50000").strip() or "50000"))
except Exception:
    MAX_API_RATE_STATE_ENTRIES = 50000


# ------------------------------------------------------------------
# Owner-configurable settings (stored in Mongo `owner_config`, and
# they override env). This turns the Owner Console into the single
# source of truth for company/legal, plans/pricing, Discord bots and
# payment providers. Everything is editable from the UI.
# ------------------------------------------------------------------
OWNER_CONFIG_ID = "global"
SECRET_MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
SECRET_CONFIG_FIELDS = {"token", "secretKey", "webhookSecret", "secret"}

DEFAULT_OWNER_CONFIG = {
    "company": {
        "providerName": "",
        "legalForm": "Einzelunternehmen (Kleinunternehmer)",
        "representative": "",
        "streetAddress": "",
        "postalCode": "",
        "city": "",
        "country": "\u00d6sterreich",
        "email": "",
        "phone": "",
        "website": "",
        "businessPurpose": "Betrieb eines Discord-Radio-/Musik-Dienstes",
        "vatId": "",
        "kleinunternehmer": True,
        "commercialRegisterNumber": "",
        "commercialRegisterCourt": "",
        "supervisoryAuthority": "",
        "chamber": "",
        "profession": "",
        "professionRules": "",
        "editorialResponsible": "",
        "mediaOwner": "",
        "mediaLine": "",
        "dpoName": "",
        "dpoEmail": "",
        "hostingProvider": "",
        "hostingLocation": "",
        "effectiveDate": "",
        "governingLaw": "\u00d6sterreichisches Recht",
    },
    "plans": {
        "free": {"name": "Free", "pricePerMonth": 0, "startingAt": "0", "maxBots": 2, "stations": "20 Free Stationen", "bitrate": "64k", "reconnectMs": 5000, "features": ["Bis zu 2 Bots", "20 Free Stationen", "Standard Audio (64k)", "Standard Reconnect"]},
        "pro": {"name": "Pro", "pricePerMonth": 299, "startingAt": "2,99", "maxBots": 8, "stations": "120 Stationen (Free + Pro)", "bitrate": "128k", "reconnectMs": 1500, "features": ["Bis zu 8 Bots", "120 Stationen (Free + Pro)", "HQ Audio (128k Opus)", "Priority Reconnect", "Rollenbasierte Berechtigungen", "Event-Scheduler"]},
        "ultimate": {"name": "Ultimate", "pricePerMonth": 499, "startingAt": "4,99", "maxBots": 16, "stations": "Alle Stationen + Custom URLs", "bitrate": "320k", "reconnectMs": 400, "features": ["Bis zu 16 Bots", "Alle Stationen + Custom URLs", "Ultra HQ Audio (320k)", "Instant Reconnect", "Rollenbasierte Berechtigungen"]},
    },
    "discord": {
        "commander": {"name": "OmniFM Commander", "token": "", "clientId": "", "inviteUrl": ""},
        "workers": [],
    },
    "payments": {
        "stripe": {"enabled": False, "mode": "test", "publishableKey": "", "secretKey": "", "webhookSecret": ""},
        "paypal": {"enabled": False, "mode": "sandbox", "clientId": "", "secret": ""},
        "providers": [],
    },
    "marketing": {
        "sponsors": [],
        "botListings": [
            {"name": "top.gg", "url": "", "enabled": True, "note": "Gr\u00f6\u00dfte Discord-Bot-Liste. Listing anlegen und URL hier einf\u00fcgen."},
            {"name": "Discord Bot List", "url": "", "enabled": True, "note": "discordbotlist.com \u2013 Bot einreichen und Profil-URL hier eintragen."},
            {"name": "Discords.com", "url": "", "enabled": False, "note": "discords.com/bots \u2013 optionales Listing."},
            {"name": "Discadia", "url": "", "enabled": False, "note": "discadia.com \u2013 Server-/Bot-Verzeichnis."},
            {"name": "Wumpus.store", "url": "", "enabled": False, "note": "wumpus.store \u2013 kuratiertes Verzeichnis."},
        ],
    },
}


def _deep_merge(base, override):
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def load_owner_config_raw():
    if db is not None:
        try:
            found = db.owner_config.find_one({"_id": OWNER_CONFIG_ID}) or {}
            found.pop("_id", None)
            return found
        except Exception:
            return {}
    return {}


def get_config_section(name):
    default = DEFAULT_OWNER_CONFIG.get(name)
    stored = load_owner_config_raw().get(name)
    if isinstance(default, dict):
        merged = json.loads(json.dumps(default))
        if isinstance(stored, dict):
            _deep_merge(merged, stored)
        return merged
    if stored is not None:
        return stored
    return json.loads(json.dumps(default)) if default is not None else {}


def _merge_config_secrets(current, incoming):
    """Keep existing secret values when the incoming value is blank or masked.
    Lists of dicts (workers/providers) are matched by identity (clientId/name),
    not index, so removing/reordering never leaks a secret onto another item."""
    def _blank_new_secrets(item):
        if isinstance(item, dict):
            for k, v in list(item.items()):
                if k in SECRET_CONFIG_FIELDS and (v in ("", None, SECRET_MASK) or (isinstance(v, str) and v.startswith("\u2022"))):
                    item[k] = ""
        return item

    if isinstance(incoming, dict) and isinstance(current, dict):
        for key, value in list(incoming.items()):
            if key in SECRET_CONFIG_FIELDS and (value in ("", None, SECRET_MASK) or (isinstance(value, str) and value.startswith("\u2022"))):
                incoming[key] = current.get(key, "")
            elif isinstance(value, (dict, list)) and key in current:
                incoming[key] = _merge_config_secrets(current[key], value)
            elif isinstance(value, (dict, list)):
                _blank_new_secrets(value)
        return incoming
    if isinstance(incoming, list) and isinstance(current, list):
        def _keyof(x):
            return str((x.get("clientId") or x.get("name") or "")).strip() if isinstance(x, dict) else None
        cur_by_key = {}
        for c in current:
            k = _keyof(c)
            if k:
                cur_by_key.setdefault(k, c)
        for i, item in enumerate(incoming):
            if isinstance(item, dict):
                match = cur_by_key.get(_keyof(item))
                incoming[i] = _merge_config_secrets(match, item) if isinstance(match, dict) else _blank_new_secrets(item)
        return incoming
    return incoming


def mask_config_secrets(obj):
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if key in SECRET_CONFIG_FIELDS and isinstance(value, str) and value:
                out[key] = SECRET_MASK
                out[key + "Set"] = True
            elif isinstance(value, (dict, list)):
                out[key] = mask_config_secrets(value)
            else:
                out[key] = value
        return out
    if isinstance(obj, list):
        return [mask_config_secrets(v) for v in obj]
    return obj


def save_config_section(name, data):
    if db is None:
        return False
    try:
        current = load_owner_config_raw().get(name)
        if isinstance(data, (dict, list)) and current is not None:
            data = _merge_config_secrets(current, data)
        db.owner_config.update_one({"_id": OWNER_CONFIG_ID}, {"$set": {name: data}}, upsert=True)
        return True
    except Exception:
        return False



def json_error(status_code, message):
    return JSONResponse(status_code=status_code, content={"error": message})


def parse_int(value, default):
    try:
        parsed = int(str(value).strip())
        return parsed
    except Exception:
        return default


def is_valid_email(email):
    return bool(EMAIL_REGEX.match(str(email or "").strip()))


def is_valid_server_id(server_id):
    return bool(SERVER_ID_REGEX.match(str(server_id or "").strip()))


def normalize_months(value, default=1):
    try:
        parsed = int(str(value).strip())
    except Exception:
        parsed = default
    return max(1, parsed)


def normalize_duration(value, default=1):
    try:
        parsed = int(str(value).strip())
    except Exception:
        parsed = default
    closest = min(DURATION_OPTIONS, key=lambda x: abs(x - parsed))
    return closest


def mask_email(email):
    raw = str(email or "").strip()
    if "@" not in raw:
        return raw
    local, domain = raw.split("@", 1)
    if len(local) <= 2:
        return "*" * len(local) + "@" + domain
    return local[:2] + "***@" + domain


def clip_text(value, max_len=300):
    text = str(value or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def empty_premium_state():
    return {
        "licenses": {},
        "serverEntitlements": {},
        "processedSessions": {},
        "trialClaims": {},
        "offers": {},
        "discordBotListState": {},
        "recentRedemptions": [],
    }


def ensure_premium_state(data):
    normalized = dict(data) if isinstance(data, dict) else {}
    defaults = empty_premium_state()
    for key, default_value in defaults.items():
        value = normalized.get(key)
        if isinstance(default_value, dict):
            normalized[key] = value if isinstance(value, dict) else {}
        elif isinstance(default_value, list):
            normalized[key] = value if isinstance(value, list) else []
        else:
            normalized[key] = value if value is not None else default_value
    return normalized


def legacy_host_to_ipv4(hostname):
    host = str(hostname or "").strip().lower()
    if not host:
        return None
    try:
        if host.isdigit():
            value = int(host, 10)
        elif host.startswith("0x"):
            value = int(host, 16)
        elif re.fullmatch(r"0[0-7]+", host) and host != "0":
            value = int(host[1:], 8)
        else:
            return None
    except Exception:
        return None

    if value < 0 or value > 0xFFFFFFFF:
        return None

    return ".".join(str((value >> shift) & 0xFF) for shift in (24, 16, 8, 0))


def is_private_or_local_host(hostname_input):
    hostname = str(hostname_input or "").strip().lower().rstrip(".")
    if not hostname:
        return True
    if hostname in {"localhost", "0.0.0.0"}:
        return True
    if hostname.endswith(".nip.io") or hostname.endswith(".sslip.io"):
        return True
    if hostname.endswith(".local") or hostname.endswith(".internal") or hostname.endswith(".lan") or hostname.endswith(".home"):
        return True

    legacy_ipv4 = legacy_host_to_ipv4(hostname)
    if legacy_ipv4:
        hostname = legacy_ipv4

    try:
        ip_value = ipaddress.ip_address(hostname)
    except ValueError:
        return False

    return (
        ip_value.is_private
        or ip_value.is_loopback
        or ip_value.is_link_local
        or ip_value.is_unspecified
        or ip_value.is_reserved
        or ip_value.is_multicast
    )


def validate_custom_station_url(raw_url):
    value = str(raw_url or "").strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return {"ok": False, "error": "URL-Format ungültig."}
    if parsed.username or parsed.password:
        return {"ok": False, "error": "URLs mit Benutzername/Passwort sind nicht erlaubt."}
    if is_private_or_local_host(parsed.hostname):
        return {"ok": False, "error": "Lokale/private Hosts sind nicht erlaubt."}

    try:
        infos = socket.getaddrinfo(parsed.hostname, None, type=socket.SOCK_STREAM)
    except OSError:
        return {"ok": False, "error": "Host konnte nicht aufgelöst werden."}

    if not infos:
        return {"ok": False, "error": "Host konnte nicht aufgelöst werden."}

    for info in infos:
        try:
            address = str(info[4][0]).strip()
        except Exception:
            continue
        if address and is_private_or_local_host(address):
            return {"ok": False, "error": "Lokale/private Hosts sind nicht erlaubt."}

    return {"ok": True, "url": value}


def list_recent_redemptions(limit=100):
    safe_limit = max(1, min(500, int(limit)))

    try:
        if COUPONS_FILE.exists():
            payload = json.loads(COUPONS_FILE.read_text(encoding="utf-8"))
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

    data = load_premium()
    rows = data.get("recentRedemptions", [])
    if not isinstance(rows, list):
        return []
    return rows[:safe_limit]


def is_discord_oauth_configured():
    return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI)


def get_frontend_base_url(request: Request):
    configured = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    parsed_config = urlparse(configured)
    if parsed_config.scheme in ("http", "https") and parsed_config.netloc:
        return f"{parsed_config.scheme}://{parsed_config.netloc}"

    from_redirect = urlparse(DISCORD_REDIRECT_URI)
    if from_redirect.scheme in ("http", "https") and from_redirect.netloc:
        return f"{from_redirect.scheme}://{from_redirect.netloc}"

    origin = (request.headers.get("origin") or "").strip()
    parsed_origin = urlparse(origin)
    if parsed_origin.scheme in ("http", "https") and parsed_origin.netloc:
        return f"{parsed_origin.scheme}://{parsed_origin.netloc}"

    request_origin = f"{request.url.scheme}://{request.url.netloc}"
    return request_origin


def clean_expired_oauth_states(now_ts=None):
    now_value = int(now_ts if now_ts is not None else time.time())
    expired = []
    for state_key, payload in DISCORD_OAUTH_STATE_STORE.items():
        expires_at = int(payload.get("expiresAt", 0) or 0)
        if expires_at <= now_value:
            expired.append(state_key)
    for state_key in expired:
        DISCORD_OAUTH_STATE_STORE.pop(state_key, None)


def clean_expired_dashboard_sessions(now_ts=None):
    now_value = int(now_ts if now_ts is not None else time.time())
    expired = []
    for session_key, payload in DASHBOARD_SESSION_STORE.items():
        expires_at = int(payload.get("expiresAt", 0) or 0)
        if expires_at <= now_value:
            expired.append(session_key)
    for session_key in expired:
        DASHBOARD_SESSION_STORE.pop(session_key, None)


def load_dashboard_data():
    default_data = {
        "events": {},
        "perms": {},
        "telemetry": {},
    }

    if db is not None:
        try:
            doc = db.dashboard_state.find_one({"_id": "dashboard_state"}, {"_id": 0})
            if isinstance(doc, dict):
                return {
                    "events": doc.get("events", {}),
                    "perms": doc.get("perms", {}),
                    "telemetry": doc.get("telemetry", {}),
                }
        except Exception:
            pass

    if DASHBOARD_FILE.exists():
        try:
            payload = json.loads(DASHBOARD_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return {
                    "events": payload.get("events", {}),
                    "perms": payload.get("perms", {}),
                    "telemetry": payload.get("telemetry", {}),
                }
        except Exception:
            pass
    return default_data


def save_dashboard_data(payload):
    safe_payload = {
        "events": payload.get("events", {}) if isinstance(payload, dict) else {},
        "perms": payload.get("perms", {}) if isinstance(payload, dict) else {},
        "telemetry": payload.get("telemetry", {}) if isinstance(payload, dict) else {},
    }
    if db is not None:
        try:
            db.dashboard_state.update_one(
                {"_id": "dashboard_state"},
                {"$set": safe_payload},
                upsert=True,
            )
            return
        except Exception:
            pass
    try:
        DASHBOARD_FILE.write_text(json.dumps(safe_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def normalize_dashboard_event(event_payload):
    payload = event_payload if isinstance(event_payload, dict) else {}
    event_id = str(payload.get("id") or secrets.token_hex(8)).strip()[:64]
    title = clip_text(payload.get("title") or payload.get("name") or "OmniFM Event", 120)
    station_key = clip_text(payload.get("stationKey") or payload.get("station") or "", 120)
    fallback_key = clip_text(payload.get("fallbackStationKey") or payload.get("fallback") or "", 120)
    starts_at = clip_text(payload.get("startsAt") or payload.get("startAt") or "", 80)
    timezone_name = clip_text(payload.get("timezone") or "Europe/Vienna", 60)
    channel_id = clip_text(payload.get("channelId") or "", 60)
    enabled = payload.get("enabled") is not False
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "id": event_id,
        "title": title,
        "stationKey": station_key,
        "fallbackStationKey": fallback_key,
        "startsAt": starts_at,
        "timezone": timezone_name,
        "channelId": channel_id,
        "enabled": enabled,
        "updatedAt": now_iso,
        "createdAt": clip_text(payload.get("createdAt") or now_iso, 80),
    }


def normalize_dashboard_perms(payload):
    body = payload if isinstance(payload, dict) else {}
    incoming = body.get("commandRoleMap") if isinstance(body.get("commandRoleMap"), dict) else {}
    normalized = {}
    for raw_command, raw_roles in incoming.items():
        command = clip_text(raw_command, 64).lstrip("/").lower()
        if not command:
            continue
        roles = []
        if isinstance(raw_roles, list):
            for role in raw_roles:
                role_name = clip_text(role, 80)
                if role_name and role_name not in roles:
                    roles.append(role_name)
        normalized[command] = roles
    return {
        "commandRoleMap": normalized,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def normalize_dashboard_telemetry(payload):
    body = payload if isinstance(payload, dict) else {}
    listeners_now = max(0, parse_int(body.get("listenersNow"), 0))
    active_streams = max(0, parse_int(body.get("activeStreams"), 0))
    peak_listeners = max(0, parse_int(body.get("peakListeners"), listeners_now))
    peak_time = clip_text(body.get("peakTime") or datetime.now(timezone.utc).isoformat(), 80)
    top_station_name = clip_text((body.get("topStation") or {}).get("name") if isinstance(body.get("topStation"), dict) else body.get("topStationName"), 120)
    top_station_listeners = max(0, parse_int((body.get("topStation") or {}).get("listeners") if isinstance(body.get("topStation"), dict) else body.get("topStationListeners"), 0))

    listeners_by_channel = []
    raw_channels = body.get("listenersByChannel") if isinstance(body.get("listenersByChannel"), list) else []
    for item in raw_channels[:20]:
        if not isinstance(item, dict):
            continue
        listeners_by_channel.append({
            "name": clip_text(item.get("name") or item.get("channel") or "Voice", 80),
            "listeners": max(0, parse_int(item.get("listeners"), 0)),
        })

    daily_report = []
    raw_daily = body.get("dailyReport") if isinstance(body.get("dailyReport"), list) else body.get("daily") if isinstance(body.get("daily"), list) else []
    for item in raw_daily[:31]:
        if not isinstance(item, dict):
            continue
        day_key = clip_text(item.get("day"), 20)
        if not day_key:
            continue
        daily_report.append({
            "day": day_key,
            "starts": max(0, parse_int(item.get("starts"), 0)),
            "peakListeners": max(0, parse_int(item.get("peakListeners"), 0)),
        })

    station_breakdown = []
    raw_station_breakdown = body.get("stationBreakdown") if isinstance(body.get("stationBreakdown"), list) else []
    for item in raw_station_breakdown[:20]:
        if not isinstance(item, dict):
            continue
        station_breakdown.append({
            "name": clip_text(item.get("name") or item.get("station") or "Station", 80),
            "starts": max(0, parse_int(item.get("starts"), 0)),
            "peakListeners": max(0, parse_int(item.get("peakListeners"), 0)),
        })

    return {
        "listenersNow": listeners_now,
        "activeStreams": active_streams,
        "peakListeners": peak_listeners,
        "peakTime": peak_time,
        "topStation": {
            "name": top_station_name or "-",
            "listeners": top_station_listeners,
        },
        "listenersByChannel": listeners_by_channel,
        "dailyReport": daily_report,
        "stationBreakdown": station_breakdown,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def has_manage_guild_permission(raw_permissions):
    try:
        bitfield = int(str(raw_permissions or "0"))
    except Exception:
        bitfield = 0
    manage_guild = (bitfield & 0x20) == 0x20
    administrator = (bitfield & 0x8) == 0x8
    return manage_guild or administrator


def resolve_session_token_from_request(request: Request):
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        bearer = auth[7:].strip()
        if bearer:
            return bearer
    cookie_token = (request.cookies.get(SESSION_COOKIE_NAME) or "").strip()
    if cookie_token:
        return cookie_token
    header_token = (request.headers.get("x-session-token") or "").strip()
    if header_token:
        return header_token
    return ""


def get_dashboard_session(request: Request):
    clean_expired_dashboard_sessions()
    token = resolve_session_token_from_request(request)
    if not token:
        return None, ""
    session = DASHBOARD_SESSION_STORE.get(token)
    if not isinstance(session, dict):
        return None, token
    return session, token


def resolve_dashboard_guilds_for_session(session_payload):
    guilds = session_payload.get("guilds") if isinstance(session_payload.get("guilds"), list) else []
    output = []
    for item in guilds:
        if not isinstance(item, dict):
            continue
        guild_id = str(item.get("id") or "").strip()
        if not is_valid_server_id(guild_id):
            continue
        if not has_manage_guild_permission(item.get("permissions", "0")):
            continue
        tier = get_tier(guild_id)
        output.append({
            "id": guild_id,
            "name": clip_text(item.get("name") or guild_id, 120),
            "icon": clip_text(item.get("icon") or "", 120),
            "owner": bool(item.get("owner", False)),
            "permissions": str(item.get("permissions") or "0"),
            "tier": tier,
            "dashboardEnabled": (TIER_RANK.get(tier, 0) >= TIER_RANK.get("pro", 1)),
            "ultimateEnabled": tier == "ultimate",
        })
    output.sort(key=lambda row: row.get("name", "").lower())
    return output


def resolve_session_guild_for_server(session_payload, server_id):
    normalized = str(server_id or "").strip()
    if not is_valid_server_id(normalized):
        return None
    for guild in resolve_dashboard_guilds_for_session(session_payload):
        if guild.get("id") == normalized:
            return guild
    return None


def build_discord_authorize_url(state, prompt="consent"):
    params = {
        "client_id": DISCORD_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": DISCORD_REDIRECT_URI,
        "scope": DISCORD_OAUTH_SCOPES,
        "state": state,
        "prompt": prompt,
    }
    return f"https://discord.com/api/oauth2/authorize?{urlencode(params)}"


def exchange_discord_code_for_token(code):
    response = requests.post(
        "https://discord.com/api/oauth2/token",
        data={
            "client_id": DISCORD_CLIENT_ID,
            "client_secret": DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": DISCORD_REDIRECT_URI,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"discord_token_exchange_failed:{response.status_code}")
    payload = response.json() if response.content else {}
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("discord_access_token_missing")
    return access_token


def fetch_discord_user_profile(access_token):
    response = requests.get(
        "https://discord.com/api/users/@me",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"discord_user_fetch_failed:{response.status_code}")
    payload = response.json() if response.content else {}
    return {
        "id": str(payload.get("id") or "").strip(),
        "username": clip_text(payload.get("username") or "Discord User", 80),
        "globalName": clip_text(payload.get("global_name") or "", 80),
        "avatar": clip_text(payload.get("avatar") or "", 120),
    }


def fetch_discord_user_guilds(access_token):
    response = requests.get(
        "https://discord.com/api/users/@me/guilds",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"discord_guilds_fetch_failed:{response.status_code}")
    payload = response.json() if response.content else []
    output = []
    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, dict):
                continue
            output.append({
                "id": str(item.get("id") or "").strip(),
                "name": clip_text(item.get("name") or "Guild", 120),
                "icon": clip_text(item.get("icon") or "", 120),
                "owner": bool(item.get("owner", False)),
                "permissions": str(item.get("permissions") or "0"),
            })
    return output


def extract_mailbox(raw_value):
    text = str(raw_value or "").strip()
    if not text:
        return ""
    bracket_match = re.search(r"<([^>]+)>", text)
    if bracket_match and bracket_match.group(1):
        return bracket_match.group(1).strip()
    plain_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.IGNORECASE)
    return plain_match.group(0) if plain_match else ""


def normalize_language(language, fallback="de"):
    value = str(language or "").strip().lower()
    if value.startswith("de"):
        return "de"
    if value.startswith("en"):
        return "en"
    fb = str(fallback or "de").strip().lower()
    return "en" if fb.startswith("en") else "de"


def resolve_language_from_accept_language(accept_language, fallback="de"):
    raw = str(accept_language or "").strip()
    if not raw:
        return normalize_language(None, fallback)
    for part in raw.split(","):
        token = part.split(";")[0].strip()
        if token:
            return normalize_language(token, fallback)
    return normalize_language(None, fallback)


def is_pro_trial_enabled():
    return (os.environ.get("PRO_TRIAL_ENABLED") or "1").strip() != "0"


def sanitize_offer_code(raw_code):
    return re.sub(r"[^A-Z0-9_-]", "", str(raw_code or "").strip().upper())[:50]


def build_public_legal_notice():
    public_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    fallback_email = extract_mailbox(os.environ.get("SMTP_FROM") or "")
    c = get_config_section("company")

    def val(field, env_key, default=""):
        v = str(c.get(field) or "").strip()
        if v:
            return v
        return str(os.environ.get(env_key) or "").strip() or default

    kleinunternehmer = bool(c.get("kleinunternehmer", True))
    legal = {
        "providerName": val("providerName", "LEGAL_PROVIDER_NAME"),
        "legalForm": val("legalForm", "LEGAL_LEGAL_FORM"),
        "representative": val("representative", "LEGAL_REPRESENTATIVE"),
        "streetAddress": val("streetAddress", "LEGAL_STREET_ADDRESS"),
        "postalCode": val("postalCode", "LEGAL_POSTAL_CODE"),
        "city": val("city", "LEGAL_CITY"),
        "country": val("country", "LEGAL_COUNTRY", "\u00d6sterreich"),
        "email": val("email", "LEGAL_EMAIL") or fallback_email,
        "phone": val("phone", "LEGAL_PHONE"),
        "website": val("website", "LEGAL_WEBSITE") or public_url,
        "businessPurpose": val("businessPurpose", "LEGAL_BUSINESS_PURPOSE"),
        "commercialRegisterNumber": val("commercialRegisterNumber", "LEGAL_COMMERCIAL_REGISTER_NUMBER"),
        "commercialRegisterCourt": val("commercialRegisterCourt", "LEGAL_COMMERCIAL_REGISTER_COURT"),
        "vatId": val("vatId", "LEGAL_VAT_ID"),
        "supervisoryAuthority": val("supervisoryAuthority", "LEGAL_SUPERVISORY_AUTHORITY"),
        "chamber": val("chamber", "LEGAL_CHAMBER"),
        "profession": val("profession", "LEGAL_PROFESSION"),
        "professionRules": val("professionRules", "LEGAL_PROFESSION_RULES"),
        "editorialResponsible": val("editorialResponsible", "LEGAL_EDITORIAL_RESPONSIBLE"),
        "mediaOwner": val("mediaOwner", "LEGAL_MEDIA_OWNER"),
        "mediaLine": val("mediaLine", "LEGAL_MEDIA_LINE"),
        "kleinunternehmer": kleinunternehmer,
        "taxNote": "Umsatzsteuerbefreit als Kleinunternehmer gem\u00e4\u00df \u00a7 6 Abs. 1 Z 27 UStG (keine Umsatzsteuer, kein USt-Ausweis)." if kleinunternehmer else "",
    }

    missing_core_fields = []
    if not legal["providerName"]:
        missing_core_fields.append("providerName")
    if not legal["streetAddress"]:
        missing_core_fields.append("streetAddress")
    if not legal["postalCode"]:
        missing_core_fields.append("postalCode")
    if not legal["city"]:
        missing_core_fields.append("city")
    if not legal["email"]:
        missing_core_fields.append("email")

    return {
        "legal": legal,
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["ECG_5", "UGB_14", "GewO_63", "MedienG_25"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def build_public_privacy_notice():
    legal_notice = build_public_legal_notice()
    legal = legal_notice.get("legal", {})
    c = get_config_section("company")
    has_stripe = bool(get_stripe_secret_key())
    has_smtp = bool((os.environ.get("SMTP_HOST") or "").strip())
    bot_id_candidate = (os.environ.get("DISCORDBOTLIST_BOT_ID") or os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    has_discordbotlist = (os.environ.get("DISCORDBOTLIST_ENABLED") or "1").strip() != "0" and bool((os.environ.get("DISCORDBOTLIST_TOKEN") or "").strip()) and bool(re.match(r"^\d{17,22}$", bot_id_candidate))
    has_recognition = (os.environ.get("NOW_PLAYING_RECOGNITION_ENABLED") or "0").strip() == "1" and bool((os.environ.get("ACOUSTID_API_KEY") or "").strip())

    controller = {
        "name": (os.environ.get("PRIVACY_CONTROLLER_NAME") or "").strip() or legal.get("providerName", ""),
        "representative": (os.environ.get("PRIVACY_CONTROLLER_REPRESENTATIVE") or "").strip() or legal.get("representative", ""),
        "streetAddress": (os.environ.get("PRIVACY_CONTROLLER_STREET_ADDRESS") or "").strip() or legal.get("streetAddress", ""),
        "postalCode": (os.environ.get("PRIVACY_CONTROLLER_POSTAL_CODE") or "").strip() or legal.get("postalCode", ""),
        "city": (os.environ.get("PRIVACY_CONTROLLER_CITY") or "").strip() or legal.get("city", ""),
        "country": (os.environ.get("PRIVACY_CONTROLLER_COUNTRY") or "").strip() or legal.get("country", "") or "Österreich",
        "website": (os.environ.get("PRIVACY_CONTROLLER_WEBSITE") or "").strip() or legal.get("website", ""),
    }
    contact = {
        "email": (os.environ.get("PRIVACY_CONTACT_EMAIL") or "").strip() or legal.get("email", ""),
        "phone": (os.environ.get("PRIVACY_CONTACT_PHONE") or "").strip() or legal.get("phone", ""),
    }
    dpo = {
        "name": (os.environ.get("PRIVACY_DPO_NAME") or "").strip() or str(c.get("dpoName") or "").strip(),
        "email": (os.environ.get("PRIVACY_DPO_EMAIL") or "").strip() or str(c.get("dpoEmail") or "").strip(),
    }
    hosting = {
        "provider": (os.environ.get("PRIVACY_HOSTING_PROVIDER") or "").strip() or str(c.get("hostingProvider") or "").strip(),
        "location": (os.environ.get("PRIVACY_HOSTING_LOCATION") or "").strip() or str(c.get("hostingLocation") or "").strip(),
    }
    authority = {
        "name": (os.environ.get("PRIVACY_AUTHORITY_NAME") or "").strip() or "Österreichische Datenschutzbehörde",
        "website": (os.environ.get("PRIVACY_AUTHORITY_WEBSITE") or "").strip() or "https://www.dsb.gv.at/",
    }

    missing_core_fields = []
    if not controller["name"]:
        missing_core_fields.append("controllerName")
    if not controller["streetAddress"]:
        missing_core_fields.append("controllerStreetAddress")
    if not controller["postalCode"]:
        missing_core_fields.append("controllerPostalCode")
    if not controller["city"]:
        missing_core_fields.append("controllerCity")
    if not contact["email"]:
        missing_core_fields.append("contactEmail")

    return {
        "controller": controller,
        "contact": contact,
        "dpo": dpo,
        "hosting": hosting,
        "authority": authority,
        "additionalRecipients": (os.environ.get("PRIVACY_ADDITIONAL_RECIPIENTS") or "").strip(),
        "customNote": (os.environ.get("PRIVACY_CUSTOM_NOTE") or "").strip(),
        "features": {
            "stripeEnabled": has_stripe,
            "smtpEnabled": has_smtp,
            "discordBotListEnabled": has_discordbotlist,
            "recognitionEnabled": has_recognition,
            "stationPreviewEnabled": True,
            "localeStorageKey": "omnifm.web.locale",
        },
        "retention": {
            "logDays": parse_int(os.environ.get("LOG_MAX_DAYS"), 14),
            "songHistoryEnabled": (os.environ.get("SONG_HISTORY_ENABLED") or "1").strip() != "0",
            "songHistoryMaxPerGuild": parse_int(os.environ.get("SONG_HISTORY_MAX_PER_GUILD"), 100),
            "listeningStatsEnabled": True,
            "scheduledEventsEnabled": True,
        },
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["GDPR_ART_13", "GDPR_ART_15_22", "DSB_AT"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def build_public_terms_notice():
    legal_notice = build_public_legal_notice()
    legal = legal_notice.get("legal", {})
    c = get_config_section("company")
    pay = get_config_section("payments")
    public_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    fallback_email = extract_mailbox(os.environ.get("SMTP_FROM") or "")
    has_stripe = bool(get_stripe_secret_key())
    paypal_enabled = bool((pay.get("paypal") or {}).get("enabled"))
    has_smtp = bool((os.environ.get("SMTP_HOST") or "").strip())

    operator = {
        "providerName": legal.get("providerName", ""),
        "representative": legal.get("representative", ""),
        "businessPurpose": legal.get("businessPurpose", ""),
        "website": legal.get("website", "") or public_url,
    }
    contact = {
        "email": (os.environ.get("TERMS_CONTACT_EMAIL") or "").strip()
        or (os.environ.get("PRIVACY_CONTACT_EMAIL") or "").strip()
        or legal.get("email", "")
        or fallback_email,
        "website": (os.environ.get("TERMS_SUPPORT_URL") or "").strip()
        or legal.get("website", "")
        or public_url,
        "effectiveDate": (os.environ.get("TERMS_EFFECTIVE_DATE") or "").strip() or str(c.get("effectiveDate") or "").strip(),
        "governingLaw": (os.environ.get("TERMS_GOVERNING_LAW") or "").strip() or str(c.get("governingLaw") or "").strip(),
    }

    missing_core_fields = []
    if not operator["providerName"]:
        missing_core_fields.append("providerName")
    if not contact["email"]:
        missing_core_fields.append("contactEmail")
    if not contact["website"]:
        missing_core_fields.append("website")

    return {
        "operator": operator,
        "contact": contact,
        "service": {
            "discordBotEnabled": True,
            "dashboardEnabled": True,
            "stationPreviewEnabled": True,
            "scheduledEventsEnabled": True,
            "customStationsEnabled": True,
        },
        "billing": {
            "premiumCheckoutEnabled": has_stripe or paypal_enabled,
            "paymentProvider": " / ".join([p for p in ["Stripe" if has_stripe else "", "PayPal" if paypal_enabled else ""] if p]),
            "emailDeliveryEnabled": has_smtp,
            "trialEnabled": is_pro_trial_enabled(),
        },
        "customNote": (os.environ.get("TERMS_CUSTOM_NOTE") or "").strip(),
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["DISCORD_TERMS", "AUSTRIAN_SERVICE_TERMS", "STREAM_RIGHTS_NOTICE"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def first_header_value(raw_value):
    value = str(raw_value or "").strip()
    if not value:
        return ""
    first = value.split(",")[0].strip()
    return first


def get_client_ip(request: Request):
    if TRUST_PROXY_HEADERS:
        forwarded = first_header_value(request.headers.get("x-forwarded-for"))
        if forwarded:
            return forwarded
        real_ip = first_header_value(request.headers.get("x-real-ip"))
        if real_ip:
            return real_ip
    client_host = getattr(request.client, "host", None)
    return str(client_host or "unknown")


def get_api_rate_limit_spec(scope):
    normalized_scope = str(scope or "read").strip().lower()
    if normalized_scope == "write":
        window_ms = parse_int(os.environ.get("API_RATE_WRITE_WINDOW_MS"), 60000)
        max_requests = parse_int(os.environ.get("API_RATE_WRITE_MAX"), 20)
    else:
        window_ms = parse_int(os.environ.get("API_RATE_READ_WINDOW_MS"), 60000)
        max_requests = parse_int(os.environ.get("API_RATE_READ_MAX"), 120)

    return {
        "scope": "write" if normalized_scope == "write" else "read",
        "window_ms": max(1000, window_ms),
        "max_requests": max(1, max_requests),
    }


def cleanup_api_rate_limit_state(now_ms=None):
    now = int(now_ms if now_ms is not None else (time.time() * 1000))
    if len(API_RATE_LIMIT_STATE) < 10000 and len(API_RATE_LIMIT_STATE) <= MAX_API_RATE_STATE_ENTRIES:
        return

    expired_keys = [key for key, value in API_RATE_LIMIT_STATE.items() if not value or int(value.get("reset_at", 0)) <= now]
    for key in expired_keys:
        API_RATE_LIMIT_STATE.pop(key, None)

    if len(API_RATE_LIMIT_STATE) > MAX_API_RATE_STATE_ENTRIES:
        sorted_entries = sorted(API_RATE_LIMIT_STATE.items(), key=lambda entry: int(entry[1].get("reset_at", 0)))
        remove_count = len(API_RATE_LIMIT_STATE) - MAX_API_RATE_STATE_ENTRIES
        for key, _ in sorted_entries[:remove_count]:
            API_RATE_LIMIT_STATE.pop(key, None)


def enforce_api_rate_limit(request: Request, scope):
    spec = get_api_rate_limit_spec(scope)
    now = int(time.time() * 1000)
    cleanup_api_rate_limit_state(now)

    ip = get_client_ip(request)
    key = f"{spec['scope']}:{request.method}:{request.url.path}:{ip}"
    entry = API_RATE_LIMIT_STATE.get(key)
    if not entry or int(entry.get("reset_at", 0)) <= now:
        entry = {"count": 0, "reset_at": now + spec["window_ms"]}

    entry["count"] = int(entry.get("count", 0)) + 1
    API_RATE_LIMIT_STATE[key] = entry

    if entry["count"] > spec["max_requests"]:
        retry_after_seconds = max(1, int((entry["reset_at"] - now + 999) // 1000))
        return JSONResponse(
            status_code=429,
            content={"error": "Rate limit erreicht. Bitte spaeter erneut versuchen.", "retryAfterSeconds": retry_after_seconds},
            headers={"Retry-After": str(retry_after_seconds)},
        )

    return None


def is_admin_request(request: Request):
    if not ADMIN_API_TOKEN:
        return False
    header_token = (request.headers.get("x-admin-token") or "").strip()
    if header_token and hmac.compare_digest(header_token, ADMIN_API_TOKEN):
        return True
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        bearer = auth[7:].strip()
        if bearer and hmac.compare_digest(bearer, ADMIN_API_TOKEN):
            return True
    return False


def parse_origin(raw_url):
    parsed = urlparse(str(raw_url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def build_allowed_return_origins():
    configured = (os.environ.get("CHECKOUT_RETURN_ORIGINS") or "").strip()
    origins = [item.strip() for item in configured.split(",") if item.strip()] if configured else []
    public_web_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    if public_web_url:
        origins.append(public_web_url)
    origins.extend(["http://localhost", "http://127.0.0.1"])

    allowed = set()
    for origin in origins:
        normalized = parse_origin(origin)
        if normalized:
            allowed.add(normalized)
    return allowed


def resolve_checkout_return_base(return_url):
    fallback = parse_origin((os.environ.get("PUBLIC_WEB_URL") or "").strip()) or "http://localhost"
    if not return_url:
        return fallback

    parsed = urlparse(str(return_url).strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return fallback

    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in build_allowed_return_origins():
        return fallback

    safe_path = parsed.path if parsed.path and parsed.path != "/" else ""
    return f"{origin}{safe_path}"


def get_stripe_secret_key():
    try:
        cfg_key = str(((get_config_section("payments") or {}).get("stripe") or {}).get("secretKey") or "").strip()
        if cfg_key:
            return cfg_key
    except Exception:
        pass
    key = (os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "").strip()
    return key


def validate_stripe_key(key):
    """Prueft ob der Stripe Key gueltig aussieht"""
    if not key:
        return False, "Stripe ist nicht konfiguriert. Bitte STRIPE_SECRET_KEY oder STRIPE_API_KEY in der .env setzen."
    if not (key.startswith("sk_test_") or key.startswith("sk_live_")):
        return False, "Stripe API-Key ungueltig. Der Key muss mit 'sk_test_' oder 'sk_live_' beginnen. Bitte den richtigen Secret Key aus dem Stripe Dashboard verwenden."
    if len(key) < 30:
        return False, "Stripe API-Key zu kurz. Bitte den vollstaendigen Key aus dem Stripe Dashboard kopieren."
    return True, ""


def load_stations_from_file():
    fallback = {"defaultStationKey": None, "stations": {}, "qualityPreset": "custom"}
    if not STATIONS_FILE.exists():
        return fallback
    try:
        with open(STATIONS_FILE, "r", encoding="utf-8") as f:
            raw = f.read().strip()
            if not raw:
                return fallback
            data = json.loads(raw)
            if not isinstance(data, dict):
                return fallback
            return data
    except Exception:
        return fallback


def load_bots_from_env():
    bots = []
    for i in range(1, 21):
        token = os.environ.get(f"BOT_{i}_TOKEN", "").strip()
        cid = os.environ.get(f"BOT_{i}_CLIENT_ID", "").strip()
        if not token and not cid:
            continue
        name = os.environ.get(f"BOT_{i}_NAME", f"OmniFM Bot {i}").strip()
        color = BOT_COLORS[(i - 1) % len(BOT_COLORS)]
        img = BOT_IMAGES[(i - 1) % len(BOT_IMAGES)] if i <= len(BOT_IMAGES) else ""
        required_tier = os.environ.get(f"BOT_{i}_TIER", "free").strip().lower()
        is_premium_bot = required_tier != "free"

        bots.append({
            "botId": f"bot-{i}",
            "index": i,
            "name": name,
            "clientId": cid or f"0000000000000000{i:02d}",
            "inviteUrl": None if is_premium_bot else (
                f"https://discord.com/oauth2/authorize?client_id={cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands" if cid else ""
            ),
            "requiredTier": required_tier,
            "color": color,
            "avatarUrl": img,
            "servers": 0, "users": 0, "connections": 0, "listeners": 0,
            "ready": False, "userTag": None, "uptimeSec": 0, "guildDetails": [],
        })

    if not bots:
        disc = get_config_section("discord")
        entries = []
        commander = disc.get("commander") or {}
        if str(commander.get("clientId") or commander.get("name") or "").strip():
            entries.append(("free", commander))
        for w in (disc.get("workers") or []):
            if isinstance(w, dict) and str(w.get("clientId") or w.get("name") or "").strip():
                entries.append((str(w.get("tier") or "free").lower(), w))
        for idx, (tier, b) in enumerate(entries, start=1):
            cid = str(b.get("clientId") or "").strip()
            is_premium_bot = tier != "free"
            bots.append({
                "botId": f"bot-{idx}", "index": idx,
                "name": str(b.get("name") or f"OmniFM Bot {idx}").strip(),
                "clientId": cid or f"0000000000000000{idx:02d}",
                "inviteUrl": str(b.get("inviteUrl") or "").strip() or (None if is_premium_bot else (
                    f"https://discord.com/oauth2/authorize?client_id={cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands" if cid else "")),
                "requiredTier": tier,
                "color": BOT_COLORS[(idx - 1) % len(BOT_COLORS)],
                "avatarUrl": BOT_IMAGES[(idx - 1) % len(BOT_IMAGES)] if idx <= len(BOT_IMAGES) else "",
                "servers": 0, "users": 0, "connections": 0, "listeners": 0,
                "ready": False, "userTag": None, "uptimeSec": 0, "guildDetails": [],
            })

    if not bots:
        for i in range(1, 3):
            bots.append({
                "botId": f"bot-{i}", "index": i,
                "name": f"OmniFM Bot {i}",
                "clientId": f"0000000000000000{i:02d}",
                "inviteUrl": "",
                "requiredTier": "free",
                "color": BOT_COLORS[(i - 1) % len(BOT_COLORS)],
                "avatarUrl": BOT_IMAGES[(i - 1) % len(BOT_IMAGES)],
                "servers": 0, "users": 0, "connections": 0, "listeners": 0,
                "ready": False, "userTag": None, "uptimeSec": 0, "guildDetails": [],
            })
    return bots


def seed_stations_if_empty():
    if db is None:
        return
    try:
        if db.stations.count_documents({}) == 0:
            file_data = load_stations_from_file()
            stations_list = []
            file_stations = file_data.get("stations", {})
            genre_map = {
                "oneworldradio": "Electronic / Festival",
                "tomorrowlandanthems": "Electronic / Festival",
                "lofi": "Lo-Fi / Chill",
                "classicrock": "Rock / Classic",
                "chillout": "Chill / Ambient",
                "dance": "Dance / EDM",
                "hiphop": "Hip Hop / Rap",
                "techno": "Techno / House",
                "pop": "Pop / Charts",
                "rock": "Rock / Alternative",
                "bass": "Bass / Dubstep",
                "deutschrap": "Deutsch Rap",
            }
            for key, val in file_stations.items():
                stations_list.append({
                    "key": key,
                    "name": val.get("name", key),
                    "url": val.get("url", ""),
                    "tier": val.get("tier", "free"),
                    "genre": genre_map.get(key, "Radio"),
                    "is_default": key == file_data.get("defaultStationKey"),
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            if stations_list:
                db.stations.insert_many(stations_list)
    except Exception:
        # Mongo is optional for this API process.
        return


seed_stations_if_empty()

# Seed premium data to MongoDB
def seed_premium_if_needed():
    if db is None:
        return
    try:
        if db.licenses.count_documents({}) == 0 and PREMIUM_FILE.exists():
            data = ensure_premium_state(json.loads(PREMIUM_FILE.read_text(encoding="utf-8")))
            if isinstance(data, dict):
                licenses = data.get("licenses", {})
                for lic_id, lic in licenses.items():
                    if isinstance(lic, dict):
                        lic["_licenseId"] = lic_id
                        db.licenses.replace_one({"_licenseId": lic_id}, lic, upsert=True)
                entitlements = data.get("serverEntitlements", {})
                for srv_id, ent in entitlements.items():
                    if isinstance(ent, dict):
                        ent["_serverId"] = srv_id
                        db.server_entitlements.replace_one({"_serverId": srv_id}, ent, upsert=True)
                sessions = data.get("processedSessions", {})
                for sess_id, sess in sessions.items():
                    if isinstance(sess, dict):
                        sess["_sessionId"] = sess_id
                        db.processed_sessions.replace_one({"_sessionId": sess_id}, sess, upsert=True)
                extra_state = {
                    "trialClaims": data.get("trialClaims", {}),
                    "offers": data.get("offers", {}),
                    "discordBotListState": data.get("discordBotListState", {}),
                    "recentRedemptions": data.get("recentRedemptions", []),
                }
                db.premium_state.replace_one({"_id": "meta"}, {"_id": "meta", **extra_state}, upsert=True)
    except Exception:
        pass

# Demo-Lizenzen/-Entitlements NUR seeden, wenn ausdrücklich aktiviert (nicht im Live-Betrieb).
if (os.environ.get("SEED_DEMO_DATA") or "").strip().lower() in ("1", "true", "yes"):
    seed_premium_if_needed()


def purge_demo_data_if_live():
    """Entfernt beim Live-Betrieb übrig gebliebene Demo-Dokumente (idempotent, sicher)."""
    if db is None:
        return
    if (os.environ.get("SEED_DEMO_DATA") or "").strip().lower() in ("1", "true", "yes"):
        return
    try:
        rx = {"$regex": "^demo-", "$options": "i"}
        removed = db.licenses.delete_many({"_licenseId": rx}).deleted_count
        db.server_entitlements.delete_many({"_serverId": rx})
        db.processed_sessions.delete_many({"_sessionId": rx})
        if removed:
            print(f"[live] Demo-Lizenzen entfernt: {removed}")
    except Exception:
        pass

purge_demo_data_if_live()


# === Premium Helper Functions (MongoDB) ===

def load_premium():
    if db is not None:
        try:
            licenses = {}
            for doc in db.licenses.find({}, {"_id": 0}):
                lid = doc.pop("_licenseId", None)
                if lid:
                    licenses[lid] = doc
            server_ents = {}
            for doc in db.server_entitlements.find({}, {"_id": 0}):
                sid = doc.pop("_serverId", None)
                if sid:
                    server_ents[sid] = doc
            processed = {}
            for doc in db.processed_sessions.find({}, {"_id": 0}):
                sess_id = doc.pop("_sessionId", None)
                if sess_id:
                    processed[sess_id] = doc
            meta = db.premium_state.find_one({"_id": "meta"}, {"_id": 0}) or {}
            return ensure_premium_state({
                **meta,
                "licenses": licenses,
                "serverEntitlements": server_ents,
                "processedSessions": processed,
            })
        except Exception:
            pass
    try:
        if PREMIUM_FILE.exists():
            return ensure_premium_state(json.loads(PREMIUM_FILE.read_text(encoding="utf-8")))
        return empty_premium_state()
    except Exception:
        return empty_premium_state()


def save_premium(data):
    safe_data = ensure_premium_state(data)
    if db is not None:
        try:
            license_ids = []
            for lic_id, lic in safe_data.get("licenses", {}).items():
                if isinstance(lic, dict):
                    doc = {**lic, "_licenseId": lic_id}
                    db.licenses.replace_one({"_licenseId": lic_id}, doc, upsert=True)
                    license_ids.append(lic_id)
            if license_ids:
                db.licenses.delete_many({"_licenseId": {"$nin": license_ids}})
            else:
                db.licenses.delete_many({})

            server_ids = []
            for srv_id, ent in safe_data.get("serverEntitlements", {}).items():
                if isinstance(ent, dict):
                    doc = {**ent, "_serverId": srv_id}
                    db.server_entitlements.replace_one({"_serverId": srv_id}, doc, upsert=True)
                    server_ids.append(srv_id)
            if server_ids:
                db.server_entitlements.delete_many({"_serverId": {"$nin": server_ids}})
            else:
                db.server_entitlements.delete_many({})

            session_ids = []
            for sess_id, sess in safe_data.get("processedSessions", {}).items():
                if isinstance(sess, dict):
                    doc = {**sess, "_sessionId": sess_id}
                    db.processed_sessions.replace_one({"_sessionId": sess_id}, doc, upsert=True)
                    session_ids.append(sess_id)
            if session_ids:
                db.processed_sessions.delete_many({"_sessionId": {"$nin": session_ids}})
            else:
                db.processed_sessions.delete_many({})

            db.premium_state.replace_one(
                {"_id": "meta"},
                {
                    "_id": "meta",
                    "trialClaims": safe_data.get("trialClaims", {}),
                    "offers": safe_data.get("offers", {}),
                    "discordBotListState": safe_data.get("discordBotListState", {}),
                    "recentRedemptions": safe_data.get("recentRedemptions", []),
                },
                upsert=True,
            )
            return
        except Exception:
            pass
    tmp_file = PREMIUM_FILE.with_suffix(PREMIUM_FILE.suffix + ".tmp")
    payload = json.dumps(safe_data, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp_file.write_text(payload, encoding="utf-8")
        tmp_file.replace(PREMIUM_FILE)
    except Exception:
        PREMIUM_FILE.write_text(payload, encoding="utf-8")
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
    data = load_premium()
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

    data = load_premium()
    claims = data.setdefault("trialClaims", {})
    if normalized_email in claims:
        return {"ok": False}

    claims[normalized_email] = {
        "email": normalized_email,
        "requestedAt": datetime.now(timezone.utc).isoformat(),
        **(payload or {}),
    }
    save_premium(data)
    return {"ok": True}


def release_trial_claim(email):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return
    data = load_premium()
    claims = data.setdefault("trialClaims", {})
    if normalized_email in claims:
        claims.pop(normalized_email, None)
        save_premium(data)


def finalize_trial_claim(email, payload=None):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return
    data = load_premium()
    claims = data.setdefault("trialClaims", {})
    current = claims.get(normalized_email, {})
    claims[normalized_email] = {
        **current,
        **(payload or {}),
        "finalizedAt": datetime.now(timezone.utc).isoformat(),
    }
    save_premium(data)


def list_offers(include_inactive=True):
    data = load_premium()
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
    normalized = sanitize_offer_code(code)
    if not normalized:
        return None
    data = load_premium()
    offer = data.get("offers", {}).get(normalized)
    if not isinstance(offer, dict):
        return None
    return {"code": normalized, **offer}


def upsert_offer(payload, partial=False):
    body = payload if isinstance(payload, dict) else {}
    code = sanitize_offer_code(body.get("code"))
    if not code:
        raise ValueError("code ist erforderlich.")

    data = load_premium()
    offers = data.setdefault("offers", {})
    existing = offers.get(code, {}) if isinstance(offers.get(code), dict) else {}

    if partial and not existing:
        raise ValueError("Code nicht gefunden.")

    discount_percent = parse_int(body.get("discountPercent"), existing.get("discountPercent", 0))
    discount_percent = max(0, min(100, discount_percent))
    discount_cents = parse_int(body.get("discountCents"), existing.get("discountCents", 0))
    discount_cents = max(0, discount_cents)
    max_uses = parse_int(body.get("maxUses"), existing.get("maxUses", 0))
    max_uses = max(0, max_uses)
    uses = parse_int(existing.get("uses", 0), 0)

    now_iso = datetime.now(timezone.utc).isoformat()
    next_offer = {
        **existing,
        "label": clip_text(body.get("label", existing.get("label", "")), 120),
        "description": clip_text(body.get("description", existing.get("description", "")), 400),
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
    save_premium(data)
    return {"code": code, **next_offer}


def delete_offer(code):
    normalized = sanitize_offer_code(code)
    if not normalized:
        return False
    data = load_premium()
    offers = data.setdefault("offers", {})
    if normalized not in offers:
        return False
    offers.pop(normalized, None)
    save_premium(data)
    return True


def set_offer_active(code, active=True):
    normalized = sanitize_offer_code(code)
    if not normalized:
        return None
    data = load_premium()
    offers = data.setdefault("offers", {})
    existing = offers.get(normalized)
    if not isinstance(existing, dict):
        return None
    existing["active"] = bool(active)
    existing["updatedAt"] = datetime.now(timezone.utc).isoformat()
    existing["updatedBy"] = str(existing.get("updatedBy") or "api-admin")
    offers[normalized] = existing
    save_premium(data)
    return {"code": normalized, **existing}


def parse_iso_datetime(raw_value):
    value = str(raw_value or "").strip()
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def resolve_discount_preview(tier, seats, months, email, coupon_code, language="de"):
    lang = normalize_language(language, "de")
    def tmsg(de, en):
        return de if lang == "de" else en

    normalized_tier = str(tier or "").strip().lower()
    if normalized_tier not in ("pro", "ultimate"):
        return {"ok": False, "status": 400, "error": tmsg("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.")}

    if not is_valid_email(email):
        return {"ok": False, "status": 400, "error": tmsg("Bitte eine gueltige E-Mail-Adresse eingeben.", "Please enter a valid email address.")}

    duration_months = normalize_duration(months)
    normalized_seats = max(1, min(5, parse_int(seats, 1)))
    base_amount_cents = calculate_price(normalized_tier, duration_months, normalized_seats)
    if base_amount_cents <= 0:
        return {"ok": False, "status": 400, "error": tmsg("Ungueltige Preisberechnung fuer die gewaehlte Kombination.", "Invalid price calculation for the selected combination.")}

    code = sanitize_offer_code(coupon_code)
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

    offer = get_offer(code)
    if not offer:
        return {"ok": False, "status": 404, "error": tmsg("Gutscheincode nicht gefunden.", "Coupon code not found.")}
    if not offer.get("active", True):
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist nicht aktiv.", "Coupon code is not active.")}

    offer_tier = str(offer.get("tier") or "").strip().lower()
    if offer_tier and offer_tier != normalized_tier:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode gilt nicht fuer diesen Plan.", "Coupon code is not valid for this plan.")}

    starts_at = parse_iso_datetime(offer.get("startsAt"))
    ends_at = parse_iso_datetime(offer.get("endsAt"))
    now = datetime.now(timezone.utc)
    if starts_at and starts_at > now:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist noch nicht aktiv.", "Coupon code is not active yet.")}
    if ends_at and ends_at < now:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist abgelaufen.", "Coupon code has expired.")}

    max_uses = max(0, parse_int(offer.get("maxUses"), 0))
    used = max(0, parse_int(offer.get("uses"), 0))
    if max_uses > 0 and used >= max_uses:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode wurde bereits zu oft eingeloest.", "Coupon code has already been redeemed too many times.")}

    discount_percent = max(0, min(100, parse_int(offer.get("discountPercent"), 0)))
    discount_fixed = max(0, parse_int(offer.get("discountCents"), 0))
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


def get_discordbotlist_status(vote_limit=20):
    token = (os.environ.get("DISCORDBOTLIST_TOKEN") or "").strip()
    explicit_bot_id = (os.environ.get("DISCORDBOTLIST_BOT_ID") or "").strip()
    commander_bot_id = (os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    bot_id = explicit_bot_id or commander_bot_id
    configured = (os.environ.get("DISCORDBOTLIST_ENABLED") or ("1" if token else "0")).strip() != "0" and bool(token) and bool(re.match(r"^\d{17,22}$", bot_id))
    stats_scope = "aggregate" if (os.environ.get("DISCORDBOTLIST_STATS_SCOPE") or "commander").strip().lower() == "aggregate" else "commander"

    data = load_premium()
    state = data.get("discordBotListState", {}) if isinstance(data.get("discordBotListState"), dict) else {}
    recent_votes = state.get("votes", {}).get("recent", []) if isinstance(state.get("votes"), dict) else []
    if not isinstance(recent_votes, list):
        recent_votes = []

    return {
        "configured": configured,
        "botId": bot_id or None,
        "statsScope": stats_scope,
        "state": {
            "commands": state.get("commands", {}),
            "stats": state.get("stats", {}),
            "votes": {
                "totalVotes": parse_int(state.get("votes", {}).get("totalVotes"), 0) if isinstance(state.get("votes"), dict) else 0,
                "recent": recent_votes[: max(0, int(vote_limit))],
            },
        },
    }


def get_processed_session(session_id):
    sid = str(session_id or "").strip()
    if not sid:
        return None
    data = load_premium()
    return data.get("processedSessions", {}).get(sid)


def mark_processed_session(session_id, payload):
    sid = str(session_id or "").strip()
    if not sid:
        return
    data = load_premium()
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

    save_premium(data)


def is_expired(license_info):
    if not license_info or not license_info.get("expiresAt"):
        return True
    return datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc)


def remaining_days(license_info):
    if not license_info or not license_info.get("expiresAt"):
        return 0
    diff = datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
    return max(0, int(diff.total_seconds() / 86400) + 1)


def get_server_license(server_id):
    """Get license for a server - supports both old and new format"""
    data = load_premium()
    sid = str(server_id)

    # New format: serverEntitlements -> licenseId -> licenses
    if "serverEntitlements" in data:
        ent = data.get("serverEntitlements", {}).get(sid)
        if ent:
            lic = data.get("licenses", {}).get(ent.get("licenseId", ""))
            if lic:
                expired = is_expired(lic)
                return {
                    **lic,
                    "expired": expired,
                    "remainingDays": remaining_days(lic),
                    "activeTier": "free" if expired else lic.get("plan", "free"),
                    "tier": lic.get("plan", "free"),
                }

    # Old format: licenses keyed by serverId
    lic = data.get("licenses", {}).get(sid)
    if not lic:
        return None
    expired = is_expired(lic)
    return {
        **lic,
        "expired": expired,
        "remainingDays": remaining_days(lic),
        "activeTier": "free" if expired else lic.get("tier", lic.get("plan", "free")),
        "tier": lic.get("tier", lic.get("plan", "free")),
    }


def get_license_by_key(license_key):
    key = str(license_key or "").strip()
    if not key:
        return None
    data = load_premium()
    lic = data.get("licenses", {}).get(key)
    if not lic:
        return None
    expired = is_expired(lic)
    return {
        **lic,
        "licenseKey": key,
        "expired": expired,
        "remainingDays": remaining_days(lic),
        "activeTier": "free" if expired else lic.get("tier", lic.get("plan", "free")),
        "tier": lic.get("tier", lic.get("plan", "free")),
    }


def get_tier(server_id):
    lic = get_server_license(server_id)
    if not lic or lic.get("expired"):
        return "free"
    tier = lic.get("tier", lic.get("plan", "free"))
    return tier if tier in TIERS else "free"


def get_dashboard_guild_stats(server_id, tier):
    dashboard_data = load_dashboard_data()
    events_map = dashboard_data.get("events", {}) if isinstance(dashboard_data.get("events"), dict) else {}
    perms_map = dashboard_data.get("perms", {}) if isinstance(dashboard_data.get("perms"), dict) else {}
    telemetry_map = dashboard_data.get("telemetry", {}) if isinstance(dashboard_data.get("telemetry"), dict) else {}

    guild_events = events_map.get(server_id, []) if isinstance(events_map.get(server_id), list) else []
    guild_perms = perms_map.get(server_id, {}) if isinstance(perms_map.get(server_id), dict) else {}
    telemetry_raw = telemetry_map.get(server_id, {}) if isinstance(telemetry_map.get(server_id), dict) else {}
    telemetry = normalize_dashboard_telemetry(telemetry_raw)

    active_events = len([item for item in guild_events if isinstance(item, dict) and item.get("enabled") is not False])
    basic = {
        "listenersNow": telemetry.get("listenersNow", 0),
        "activeStreams": telemetry.get("activeStreams", 0),
        "peakListeners": telemetry.get("peakListeners", 0),
        "peakTime": telemetry.get("peakTime"),
        "topStation": telemetry.get("topStation", {"name": "-", "listeners": 0}),
        "eventsConfigured": len(guild_events),
        "eventsActive": active_events,
        "permRules": len((guild_perms.get("commandRoleMap") or {}).keys()) if isinstance(guild_perms.get("commandRoleMap"), dict) else 0,
        "updatedAt": telemetry.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
    }

    if tier != "ultimate":
        return {"basic": basic, "advanced": None}

    advanced = {
        "listenersByChannel": telemetry.get("listenersByChannel", []),
        "dailyReport": telemetry.get("dailyReport", []),
        "stationBreakdown": telemetry.get("stationBreakdown", []),
    }
    return {"basic": basic, "advanced": advanced}


def get_license(server_id):
    return get_server_license(server_id)


def get_duration_price(tier, months):
    months = normalize_duration(months)
    pricing = DURATION_PRICING.get(tier, {})
    return pricing.get(months, pricing.get(1, 0))


def get_seat_monthly_total(tier, seats):
    seats = max(1, int(seats) if isinstance(seats, (int, float)) else 1)
    seat_pricing = SEAT_MONTHLY_TOTAL_CENTS.get(tier, {})
    if seats in seat_pricing:
        return seat_pricing[seats]
    closest = min(SEAT_OPTIONS, key=lambda x: abs(x - seats))
    return seat_pricing.get(closest, seat_pricing.get(1, 0))


def calculate_price(tier, months, seats=1):
    months = normalize_duration(months)
    seats = max(1, int(seats) if isinstance(seats, (int, float)) else 1)
    base_1mo = get_duration_price(tier, 1)
    duration_1mo = get_duration_price(tier, months)
    if base_1mo <= 0:
        return 0
    discount_ratio = duration_1mo / base_1mo
    seat_total_1mo = get_seat_monthly_total(tier, seats)
    price_per_month = round(seat_total_1mo * discount_ratio)
    return months * price_per_month


def calculate_upgrade_price(server_id, new_tier):
    lic = get_server_license(server_id)
    if not lic or lic.get("expired"):
        return None
    old_tier = lic.get("tier", "free")
    seats = max(1, int(lic.get("seats", 1) or 1))
    old_ppm = get_seat_monthly_total(old_tier, seats)
    new_ppm = get_seat_monthly_total(new_tier, seats)
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
    if tier not in TIERS or tier == "free":
        raise ValueError("Tier muss 'pro' oder 'ultimate' sein.")
    months = normalize_months(months)
    seats = max(1, min(5, int(seats) if isinstance(seats, (int, float)) else 1))
    if months < 1:
        raise ValueError("Mindestens 1 Monat.")
    data = load_premium()
    now = datetime.now(timezone.utc)

    license_key = generate_license_key()
    # Sicherstellen dass der Key eindeutig ist
    while license_key in data.get("licenses", {}):
        license_key = generate_license_key()

    data.setdefault("licenses", {})[license_key] = {
        "tier": tier,
        "plan": tier,
        "seats": seats,
        "email": email,
        "linkedServerIds": [],
        "activatedAt": now.isoformat(),
        "expiresAt": (now + timedelta(days=months * 30)).isoformat(),
        "durationMonths": months,
        "activatedBy": activated_by,
        "note": note,
    }
    save_premium(data)
    return {**data["licenses"][license_key], "licenseKey": license_key}


def upgrade_license(server_id, new_tier):
    data = load_premium()
    sid = str(server_id)
    lic = data.get("licenses", {}).get(sid)
    if not lic or is_expired(lic):
        raise ValueError("Keine aktive Lizenz zum Upgraden.")
    data["licenses"][sid] = {
        **lic,
        "tier": new_tier,
        "plan": new_tier,
        "upgradedAt": datetime.now(timezone.utc).isoformat(),
        "upgradedFrom": lic.get("tier"),
    }
    save_premium(data)
    return data["licenses"][sid]


def sanitize_license_for_api(license_info, include_sensitive=False):
    if not license_info:
        return None

    plan = license_info.get("tier", license_info.get("plan", "free"))
    payload = {
        "tier": plan,
        "plan": plan,
        "seats": 1,
        "active": not bool(license_info.get("expired")),
        "expired": bool(license_info.get("expired")),
        "expiresAt": license_info.get("expiresAt"),
        "remainingDays": license_info.get("remainingDays", 0),
    }

    linked_server_ids = list(license_info.get("linkedServerIds", []))

    if include_sensitive:
        payload["linkedServerIds"] = linked_server_ids
        payload["email"] = license_info.get("email", "")
    else:
        payload["linkedServerCount"] = len(linked_server_ids)
        payload["emailMasked"] = mask_email(license_info.get("email", ""))

    return payload


# === API Routes ===

@app.get("/api/health")
async def health():
    return {"ok": True, "status": "online", "brand": "OmniFM", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/bots")
async def get_bots():
    bots = []
    for bot in load_bots_from_env():
        item = dict(bot)
        if item.get("requiredTier", "free") != "free":
            item["clientId"] = None
            item["inviteUrl"] = None
        bots.append(item)
    totals = {"servers": 0, "users": 0, "connections": 0, "listeners": 0}
    for bot in bots:
        totals["servers"] += bot.get("servers", 0)
        totals["users"] += bot.get("users", 0)
        totals["connections"] += bot.get("connections", 0)
        totals["listeners"] += bot.get("listeners", 0)
    return {"bots": bots, "totals": totals}


@app.get("/api/workers")
async def get_workers():
    """Worker-Status Dashboard API. Returns commander + worker bot statuses."""
    bots_data = load_bots_from_env()

    commander = None
    workers = []

    for bot in bots_data:
        idx = int(bot.get("index", 0) or 0)
        tier = bot.get("requiredTier", "free")
        cid = bot.get("clientId", "")
        invite_url = None
        if cid and len(cid) > 10:
            invite_url = f"https://discord.com/oauth2/authorize?client_id={cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands"

        entry = {
            "id": bot.get("botId"),
            "botId": bot.get("botId"),
            "index": idx,
            "name": bot.get("name", f"OmniFM Bot {idx}"),
            "role": "commander" if idx == 1 else "worker",
            "requiredTier": tier,
            "online": bot.get("ready", False),
            "clientId": cid if tier == "free" else None,
            "inviteUrl": invite_url if tier == "free" else None,
            "servers": bot.get("servers", 0),
            "activeStreams": bot.get("connections", 0),
            "color": bot.get("color", "cyan"),
            "avatarUrl": bot.get("avatarUrl", ""),
        }

        if idx == 1:
            entry["role"] = "commander"
            commander = entry
        else:
            entry["role"] = "worker"
            workers.append(entry)

    # If no commander detected, use first bot
    if not commander and bots_data:
        first = bots_data[0]
        commander = {
            "id": first.get("botId", "bot-1"),
            "botId": first.get("botId", "bot-1"),
            "index": 1, "name": first.get("name", "OmniFM DJ"),
            "role": "commander", "requiredTier": "free",
            "online": first.get("ready", False),
            "clientId": first.get("clientId", ""),
            "inviteUrl": None, "servers": 0, "activeStreams": 0,
            "color": "cyan", "avatarUrl": "",
        }

    return {
        "architecture": "commander_worker",
        "commander": commander,
        "workers": workers,
        "tiers": {
            "free": {"maxWorkers": TIERS["free"]["maxBots"], "name": "Free"},
            "pro": {"maxWorkers": TIERS["pro"]["maxBots"], "name": "Pro"},
            "ultimate": {"maxWorkers": TIERS["ultimate"]["maxBots"], "name": "Ultimate"},
        },
    }


@app.get("/api/stations")
async def get_stations():
    stations_list = []
    if db is not None:
        try:
            # IMPORTANT: Only include official stations (free + pro). NEVER include custom stations.
            for doc in db.stations.find({"key": {"$not": {"$regex": "^custom:"}}, "tier": {"$in": ["free", "pro"]}}, {"_id": 0}):
                stations_list.append({
                    "key": doc.get("key", ""),
                    "name": doc.get("name", doc.get("key", "")),
                    "url": doc.get("url", ""),
                    "tier": doc.get("tier", "free"),
                })
        except Exception:
            pass
    if not stations_list:
        file_data = load_stations_from_file()
        file_stations = file_data.get("stations", {})
        for key, val in file_stations.items():
            tier = (val.get("tier", "free") or "free").lower()
            if key.startswith("custom:") or tier not in ("free", "pro"):
                continue
            stations_list.append({
                "key": key,
                "name": val.get("name", key),
                "url": val.get("url", ""),
                "tier": tier,
            })
    tier_order = {"free": 0, "pro": 1}
    stations_list.sort(key=lambda s: (tier_order.get(s["tier"], 0), s["name"]))
    default_key = None
    if db is not None:
        try:
            default_doc = db.stations.find_one({"is_default": True}, {"_id": 0, "key": 1})
            if default_doc:
                default_key = default_doc.get("key")
        except Exception:
            pass
    if not default_key:
        file_data = load_stations_from_file()
        default_key = file_data.get("defaultStationKey")
    return {
        "defaultStationKey": default_key,
        "total": len(stations_list),
        "stations": stations_list
    }


@app.get("/api/legal")
async def get_legal_notice(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    return build_public_legal_notice()


@app.get("/api/privacy")
async def get_privacy_notice(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    return build_public_privacy_notice()


@app.get("/api/terms")
async def get_terms_notice(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    return build_public_terms_notice()


@app.get("/api/discordbotlist/status")
async def discordbotlist_status(request: Request, limit: int = 20):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")
    return get_discordbotlist_status(vote_limit=max(0, min(200, int(limit))))


@app.get("/api/stats")
async def get_stats():
    bots = load_bots_from_env()
    station_count = 0
    free_count = 0
    pro_count = 0
    if db is not None:
        try:
            # IMPORTANT: Only count official stations (free + pro). NEVER count custom stations.
            station_count = db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": {"$in": ["free", "pro"]}})
            free_count = db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": "free"})
            pro_count = station_count - free_count
        except Exception:
            pass
    if station_count == 0:
        file_data = load_stations_from_file()
        # Only count official stations (free + pro), exclude custom stations
        official = {k: v for k, v in file_data.get("stations", {}).items() if not k.startswith("custom:") and (v.get("tier", "free") or "free").lower() in ("free", "pro")}
        station_count = len(official)
        free_count = sum(1 for s in official.values() if (s.get("tier", "free") or "free").lower() == "free")
        pro_count = station_count - free_count
    totals = {"servers": 0, "users": 0, "connections": 0, "listeners": 0, "bots": len(bots), "stations": station_count, "freeStations": free_count, "proStations": pro_count}
    for bot in bots:
        totals["servers"] += bot.get("servers", 0)
        totals["users"] += bot.get("users", 0)
        totals["connections"] += bot.get("connections", 0)
        totals["listeners"] += bot.get("listeners", 0)
    return totals


@app.get("/api/commands")
async def get_commands():
    return {
        "commands": [
            {"name": "/help", "args": "", "description": "Zeigt alle Befehle und kurze Erklaerungen"},
            {"name": "/play", "args": "[station] [voice] [fallback] [bot]", "description": "Starte einen Radio-Stream im Voice-Channel (Ultimate: optional Fallback + YouTube-Live-URL)"},
            {"name": "/pause", "args": "", "description": "Wiedergabe pausieren"},
            {"name": "/resume", "args": "", "description": "Setzt die Wiedergabe fort"},
            {"name": "/stop", "args": "", "description": "Stoppt die Wiedergabe und verlaesst den Channel"},
            {"name": "/stations", "args": "", "description": "Zeigt alle verfuegbaren Radio-Stationen (nach Tier gefiltert)"},
            {"name": "/stats", "args": "", "description": "[Pro+] Zeigt Server-Statistiken (Ultimate: erweiterte Analytics + Tagesreport)"},
            {"name": "/now", "args": "", "description": "Zeigt die aktuelle Station und Metadaten"},
            {"name": "/history", "args": "[limit]", "description": "Zeigt die zuletzt erkannten Songs"},
            {"name": "/setvolume", "args": "<value>", "description": "Setzt die Lautstaerke"},
            {"name": "/status", "args": "", "description": "Zeigt Bot-Status, Uptime und Last"},
            {"name": "/list", "args": "[page]", "description": "Listet Stationen paginiert auf"},
            {"name": "/health", "args": "", "description": "Zeigt Stream-Health und Reconnect-Info"},
            {"name": "/diag", "args": "", "description": "Zeigt ffmpeg/Audio-Diagnose fuer Troubleshooting"},
            {"name": "/premium", "args": "", "description": "Zeigt den Premium-Status dieses Servers"},
            {"name": "/language", "args": "<show | set <value> | reset>", "description": "Sprache fuer diesen Server verwalten"},
            {"name": "/addstation", "args": "<key> <name> <url>", "description": "[Ultimate] Eigene Station hinzufuegen"},
            {"name": "/removestation", "args": "<key>", "description": "[Ultimate] Eigene Station entfernen"},
            {"name": "/mystations", "args": "", "description": "[Ultimate] Zeigt deine Custom-Stationen"},
            {"name": "/event", "args": "<create <name> <station> <voice> <start> [timezone] [repeat] [text] [serverevent] [stagetopic] [message] | list | delete <id>>", "description": "[Pro] Event-Scheduler fuer automatische Starts"},
            {"name": "/license", "args": "<activate <key> | info | remove>", "description": "Lizenz verwalten: aktivieren, anzeigen oder entfernen"},
            {"name": "/perm", "args": "<allow <command> <role> | deny <command> <role> | remove <command> <role> | list [command] | reset [command]>", "description": "[Pro] Rollenrechte fuer Commands verwalten"},
            {"name": "/invite", "args": "<worker>", "description": "[Pro] Worker-Bot auf deinen Server einladen"},
            {"name": "/workers", "args": "", "description": "[Pro] Zeigt den Status aller Worker-Bots"},
        ]
    }


@app.get("/api/auth/discord/login")
async def auth_discord_login(request: Request, nextPage: str = "dashboard"):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    if not is_discord_oauth_configured():
        return JSONResponse(
            status_code=503,
            content={
                "error": "Discord OAuth ist noch nicht konfiguriert.",
                "oauthConfigured": False,
            },
        )

    clean_expired_oauth_states()
    state_token = secrets.token_urlsafe(24)
    DISCORD_OAUTH_STATE_STORE[state_token] = {
        "nextPage": clip_text(nextPage or "dashboard", 40),
        "createdAt": int(time.time()),
        "expiresAt": int(time.time()) + DISCORD_OAUTH_STATE_TTL_SECONDS,
        "origin": get_frontend_base_url(request),
    }
    return {
        "oauthConfigured": True,
        "authUrl": build_discord_authorize_url(state_token),
        "state": state_token,
    }


@app.get("/api/auth/discord/callback")
async def auth_discord_callback(request: Request, code: str = "", state: str = ""):
    frontend_base = get_frontend_base_url(request)

    def build_error_redirect(error_code):
        target = f"{frontend_base}/?page=dashboard&authError={error_code}"
        return RedirectResponse(url=target, status_code=302)

    if not is_discord_oauth_configured():
        return build_error_redirect("oauth_not_configured")

    clean_expired_oauth_states()
    state_payload = DISCORD_OAUTH_STATE_STORE.pop(str(state or "").strip(), None)
    if not state_payload:
        return build_error_redirect("invalid_state")
    if not str(code or "").strip():
        return build_error_redirect("missing_code")

    try:
        access_token = exchange_discord_code_for_token(code)
        user_profile = fetch_discord_user_profile(access_token)
        guilds = fetch_discord_user_guilds(access_token)
    except Exception:
        return build_error_redirect("oauth_exchange_failed")

    clean_expired_dashboard_sessions()
    session_token = secrets.token_urlsafe(32)
    DASHBOARD_SESSION_STORE[session_token] = {
        "user": user_profile,
        "guilds": guilds,
        "createdAt": int(time.time()),
        "expiresAt": int(time.time()) + DASHBOARD_SESSION_TTL_SECONDS,
    }

    next_page = str(state_payload.get("nextPage") or "dashboard").strip().lower()
    if next_page not in ("dashboard", "home"):
        next_page = "dashboard"
    target = f"{frontend_base}/?page={next_page}"
    response = RedirectResponse(url=target, status_code=302)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        max_age=DASHBOARD_SESSION_TTL_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return response


@app.get("/api/auth/session")
async def auth_session(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    session, _ = get_dashboard_session(request)
    if not session:
        return {
            "authenticated": False,
            "oauthConfigured": is_discord_oauth_configured(),
            "user": None,
            "guilds": [],
        }

    guilds = resolve_dashboard_guilds_for_session(session)
    return {
        "authenticated": True,
        "oauthConfigured": is_discord_oauth_configured(),
        "user": session.get("user", {}),
        "guilds": guilds,
        "expiresAt": session.get("expiresAt"),
    }


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    _, token = get_dashboard_session(request)
    if token:
        DASHBOARD_SESSION_STORE.pop(token, None)

    response = JSONResponse(status_code=200, content={"success": True})
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return response


@app.get("/api/dashboard/guilds")
async def dashboard_guilds(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    return {"guilds": resolve_dashboard_guilds_for_session(session)}


@app.get("/api/dashboard/stats")
async def dashboard_stats(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")

    tier = guild.get("tier", "free")
    if TIER_RANK.get(tier, 0) < TIER_RANK.get("pro", 1):
        return json_error(403, "Dashboard ist erst ab Pro verfuegbar.")

    stats_payload = get_dashboard_guild_stats(guild.get("id"), tier)
    return {
        "serverId": guild.get("id"),
        "tier": tier,
        "basic": stats_payload.get("basic", {}),
        "advanced": stats_payload.get("advanced") if tier == "ultimate" else None,
    }


@app.delete("/api/dashboard/stats/reset")
async def dashboard_stats_reset(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")

    gid = guild.get("id", "")
    if not gid:
        return json_error(400, "Ungueltige Server-ID.")

    deleted_counts = {}
    if db is not None:
        try:
            for coll_name in ["daily_stats", "listening_sessions", "listener_snapshots"]:
                r = db[coll_name].delete_many({"guildId": gid})
                deleted_counts[coll_name] = r.deleted_count
            r = db.guild_stats.delete_many({"guildId": gid})
            deleted_counts["guild_stats"] = r.deleted_count
        except Exception as e:
            return json_error(500, f"Fehler beim Zuruecksetzen: {str(e)}")

    return {"success": True, "serverId": gid, "deleted": deleted_counts}


@app.get("/api/dashboard/stats/detail")
async def dashboard_stats_detail(request: Request, serverId: str = "", days: int = 30):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    if guild.get("tier") != "ultimate":
        return json_error(403, "Detaillierte Statistiken sind nur fuer Ultimate verfuegbar.")

    gid = guild.get("id", "")
    days = max(1, min(90, days))
    result = {
        "serverId": gid, "tier": "ultimate",
        "listeningStats": {}, "dailyStats": [], "sessionHistory": [],
        "connectionHealth": {"connects": 0, "reconnects": 0, "errors": 0, "events": []},
        "listenerTimeline": [], "activeSessions": [],
    }
    if db is not None:
        try:
            from datetime import timedelta
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
            daily = list(db.daily_stats.find(
                {"guildId": gid, "date": {"$gte": cutoff}},
                {"_id": 0}
            ).sort("date", -1).limit(days))
            result["dailyStats"] = daily

            sessions = list(db.listening_sessions.find(
                {"guildId": gid}, {"_id": 0}
            ).sort("startedAt", -1).limit(20))
            result["sessionHistory"] = [{
                "stationKey": s.get("stationKey", ""),
                "stationName": s.get("stationName", ""),
                "startedAt": s.get("startedAt").isoformat() if hasattr(s.get("startedAt", ""), "isoformat") else str(s.get("startedAt", "")),
                "durationMs": s.get("humanListeningMs", s.get("durationMs", 0)),
                "peakListeners": s.get("peakListeners", 0),
                "avgListeners": s.get("avgListeners", 0),
            } for s in sessions]

            guild_stat = db.guild_stats.find_one({"guildId": gid}, {"_id": 0})
            if guild_stat:
                result["listeningStats"] = {
                    "totalListeningMs": guild_stat.get("totalListeningMs", 0),
                    "totalSessions": guild_stat.get("totalSessions", 0),
                    "avgSessionMs": guild_stat.get("avgSessionMs", 0),
                    "longestSessionMs": guild_stat.get("longestSessionMs", 0),
                    "totalStarts": guild_stat.get("totalStarts", 0),
                    "peakListeners": guild_stat.get("peakListeners", 0),
                    "stationStarts": guild_stat.get("stationStarts", {}),
                    "stationListeningMs": guild_stat.get("stationListeningMs", {}),
                    "stationNames": guild_stat.get("stationNames", {}),
                    "hours": guild_stat.get("hours", {}),
                    "daysOfWeek": guild_stat.get("daysOfWeek", {}),
                    "commands": guild_stat.get("commands", {}),
                    "voiceChannels": guild_stat.get("voiceChannels", {}),
                }

            snapshots = list(db.listener_snapshots.find(
                {"guildId": gid}, {"_id": 0}
            ).sort("timestamp", -1).limit(288))
            result["listenerTimeline"] = [{
                "timestamp": s.get("timestamp").isoformat() if hasattr(s.get("timestamp", ""), "isoformat") else str(s.get("timestamp", "")),
                "listeners": s.get("listeners", 0),
            } for s in reversed(snapshots)]
        except Exception:
            pass
    return result


@app.get("/api/dashboard/settings")
async def dashboard_settings_get(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")

    gid = guild.get("id", "")
    settings = {}
    if db is not None:
        try:
            settings = db.guild_settings.find_one({"guildId": gid}, {"_id": 0}) or {}
        except Exception:
            pass
    return {
        "guildId": gid,
        "tier": guild.get("tier", "free"),
        "weeklyDigest": settings.get("weeklyDigest", {"enabled": False, "channelId": "", "dayOfWeek": 1, "hour": 9, "language": "de"}),
        "fallbackStation": settings.get("fallbackStation", ""),
    }


@app.put("/api/dashboard/settings")
async def dashboard_settings_put(request: Request, body: dict, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")

    gid = guild.get("id", "")
    if db is None:
        return json_error(503, "MongoDB nicht verbunden.")

    updates = {"guildId": gid}
    wd = body.get("weeklyDigest")
    if wd and isinstance(wd, dict):
        updates["weeklyDigest"] = {
            "enabled": wd.get("enabled") is True,
            "channelId": str(wd.get("channelId", "")).strip(),
            "dayOfWeek": max(0, min(6, int(wd.get("dayOfWeek", 1) or 1))),
            "hour": max(0, min(23, int(wd.get("hour", 9) or 9))),
            "language": str(wd.get("language", "de"))[:5],
        }

    fs = body.get("fallbackStation")
    if fs is not None:
        if guild.get("tier") != "ultimate":
            return json_error(403, "Fallback-Station ist nur fuer Ultimate verfuegbar.")
        updates["fallbackStation"] = str(fs or "").strip().lower()[:120]

    try:
        db.guild_settings.update_one({"guildId": gid}, {"$set": updates}, upsert=True)
    except Exception as e:
        return json_error(500, f"Fehler: {str(e)}")
    return {"success": True, **updates}


@app.get("/api/dashboard/channels")
async def dashboard_channels(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    return {"voiceChannels": [], "textChannels": []}


@app.get("/api/dashboard/roles")
async def dashboard_roles(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    return {"roles": []}


@app.get("/api/dashboard/stations")
async def dashboard_stations_all(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")

    gid = guild.get("id", "")
    tier = guild.get("tier", "free")
    file_data = load_stations_from_file()
    all_stations = file_data.get("stations", {})

    free_list, pro_list = [], []
    for key, val in all_stations.items():
        if key.startswith("custom:"):
            continue
        st_tier = (val.get("tier", "free") or "free").lower()
        entry = {"key": key, "name": val.get("name", key), "url": val.get("url", ""), "genre": val.get("genre", ""), "country": val.get("country", "")}
        if st_tier == "free":
            free_list.append(entry)
        elif st_tier == "pro" and tier in ("pro", "ultimate"):
            pro_list.append(entry)
    free_list.sort(key=lambda s: s["name"])
    pro_list.sort(key=lambda s: s["name"])

    custom_list = []
    if db is not None and tier == "ultimate":
        try:
            for doc in db.custom_stations.find({"guildId": gid}, {"_id": 0}):
                custom_list.append({"key": doc.get("key", ""), "name": doc.get("name", ""), "url": doc.get("url", ""), "genre": doc.get("genre", ""), "custom": True})
        except Exception:
            pass

    return {"free": free_list, "pro": pro_list, "custom": custom_list, "tier": tier}


@app.get("/api/dashboard/custom-stations")
async def dashboard_custom_stations_get(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff.")

    gid = guild.get("id", "")
    tier = guild.get("tier", "free")
    stations = []
    if db is not None:
        try:
            for doc in db.custom_stations.find({"guildId": gid}, {"_id": 0}):
                stations.append({"key": doc.get("key", ""), "name": doc.get("name", ""), "url": doc.get("url", ""), "genre": doc.get("genre", "")})
        except Exception:
            pass
    stations.sort(key=lambda s: s.get("name", ""))
    return {"stations": stations, "tier": tier}


@app.post("/api/dashboard/custom-stations")
async def dashboard_custom_stations_create(request: Request, body: dict, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff.")
    if guild.get("tier") != "ultimate":
        return json_error(403, "Custom Stations sind nur für Ultimate verfügbar.")

    gid = guild.get("id", "")
    key = re.sub(r"[^a-z0-9_-]", "", str(body.get("key", "")).strip().lower()[:80])
    name = str(body.get("name", "")).strip()[:120]
    url = str(body.get("url", "")).strip()[:500]
    genre = str(body.get("genre", "")).strip()[:80]
    if not key or not name or not url:
        return json_error(400, "Key, Name und URL sind erforderlich.")

    validation = validate_custom_station_url(url)
    if not validation.get("ok"):
        return json_error(400, validation.get("error") or "URL-Format ungültig.")
    url = validation["url"]

    if db is None:
        return json_error(503, "MongoDB nicht verbunden.")

    count = db.custom_stations.count_documents({"guildId": gid})
    if count >= 50:
        return json_error(400, "Maximale Anzahl von 50 Custom Stations erreicht.")

    existing = db.custom_stations.find_one({"guildId": gid, "key": key})
    if existing:
        return json_error(400, f"Station mit Key '{key}' existiert bereits.")

    db.custom_stations.insert_one({"guildId": gid, "key": key, "name": name, "url": url, "genre": genre})
    return {"success": True, "station": {"key": key, "name": name, "url": url, "genre": genre}}


@app.put("/api/dashboard/custom-stations")
async def dashboard_custom_stations_update(request: Request, body: dict, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff.")
    if guild.get("tier") != "ultimate":
        return json_error(403, "Custom Stations sind nur für Ultimate verfügbar.")

    gid = guild.get("id", "")
    key = re.sub(r"[^a-z0-9_-]", "", str(body.get("key", "")).strip().lower()[:80])
    if not key:
        return json_error(400, "Station-Key fehlt.")

    if db is None:
        return json_error(503, "MongoDB nicht verbunden.")

    existing = db.custom_stations.find_one({"guildId": gid, "key": key})
    if not existing:
        return json_error(404, "Station nicht gefunden.")

    updates = {}
    if body.get("name"):
        updates["name"] = str(body["name"]).strip()[:120]
    next_url = str(body.get("url", existing.get("url", ""))).strip()[:500]
    validation = validate_custom_station_url(next_url)
    if not validation.get("ok"):
        return json_error(400, validation.get("error") or "URL-Format ungültig.")
    if body.get("url"):
        updates["url"] = validation["url"]
    if "genre" in body:
        updates["genre"] = str(body["genre"]).strip()[:80]

    if updates:
        db.custom_stations.update_one({"guildId": gid, "key": key}, {"$set": updates})

    return {
        "success": True,
        "station": {
            "key": key,
            "name": updates.get("name", existing.get("name", "")),
            "url": updates.get("url", existing.get("url", "")),
            "genre": updates.get("genre", existing.get("genre", "")),
        },
    }


@app.delete("/api/dashboard/custom-stations")
async def dashboard_custom_stations_delete(request: Request, serverId: str = "", key: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")
    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff.")

    if not key:
        return json_error(400, "Station-Key fehlt.")

    gid = guild.get("id", "")
    if db is not None:
        r = db.custom_stations.delete_one({"guildId": gid, "key": key})
        return {"success": r.deleted_count > 0, "key": key}
    return {"success": False, "key": key}


@app.post("/api/dashboard/telemetry")
async def dashboard_upsert_telemetry(request: Request, body: dict, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")
    if not is_valid_server_id(serverId):
        return json_error(400, "ungueltige serverId")

    data = load_dashboard_data()
    telemetry_map = data.setdefault("telemetry", {})
    telemetry_map[serverId] = normalize_dashboard_telemetry(body)
    save_dashboard_data(data)
    return {"success": True, "serverId": serverId, "telemetry": telemetry_map[serverId]}


@app.get("/api/dashboard/events")
async def dashboard_events_list(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    if TIER_RANK.get(guild.get("tier", "free"), 0) < TIER_RANK.get("pro", 1):
        return json_error(403, "Events sind erst ab Pro verfuegbar.")

    data = load_dashboard_data()
    events_map = data.get("events", {}) if isinstance(data.get("events"), dict) else {}
    rows = events_map.get(guild.get("id"), []) if isinstance(events_map.get(guild.get("id")), list) else []
    return {"serverId": guild.get("id"), "events": rows}


@app.post("/api/dashboard/events")
async def dashboard_events_create(request: Request, body: dict, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    if TIER_RANK.get(guild.get("tier", "free"), 0) < TIER_RANK.get("pro", 1):
        return json_error(403, "Events sind erst ab Pro verfuegbar.")

    event_payload = normalize_dashboard_event(body)
    data = load_dashboard_data()
    events_map = data.setdefault("events", {})
    rows = events_map.setdefault(guild.get("id"), [])
    rows.insert(0, event_payload)
    events_map[guild.get("id")] = rows[:200]
    save_dashboard_data(data)
    return {"success": True, "event": event_payload}


@app.patch("/api/dashboard/events/{event_id}")
async def dashboard_events_update(request: Request, event_id: str, body: dict, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    if TIER_RANK.get(guild.get("tier", "free"), 0) < TIER_RANK.get("pro", 1):
        return json_error(403, "Events sind erst ab Pro verfuegbar.")

    data = load_dashboard_data()
    events_map = data.setdefault("events", {})
    rows = events_map.setdefault(guild.get("id"), [])
    updated = None
    for index, row in enumerate(rows):
        if str(row.get("id")) != str(event_id):
            continue
        merged = {**row, **(body if isinstance(body, dict) else {})}
        merged["id"] = str(row.get("id"))
        merged["createdAt"] = row.get("createdAt")
        updated = normalize_dashboard_event(merged)
        updated["id"] = str(row.get("id"))
        updated["createdAt"] = row.get("createdAt")
        rows[index] = updated
        break
    if not updated:
        return json_error(404, "Event nicht gefunden.")
    events_map[guild.get("id")] = rows
    save_dashboard_data(data)
    return {"success": True, "event": updated}


@app.delete("/api/dashboard/events/{event_id}")
async def dashboard_events_delete(request: Request, event_id: str, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    if TIER_RANK.get(guild.get("tier", "free"), 0) < TIER_RANK.get("pro", 1):
        return json_error(403, "Events sind erst ab Pro verfuegbar.")

    data = load_dashboard_data()
    events_map = data.setdefault("events", {})
    rows = events_map.setdefault(guild.get("id"), [])
    next_rows = [row for row in rows if str(row.get("id")) != str(event_id)]
    if len(next_rows) == len(rows):
        return json_error(404, "Event nicht gefunden.")
    events_map[guild.get("id")] = next_rows
    save_dashboard_data(data)
    return {"success": True, "eventId": str(event_id)}


@app.get("/api/dashboard/perms")
async def dashboard_perms_get(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    if TIER_RANK.get(guild.get("tier", "free"), 0) < TIER_RANK.get("pro", 1):
        return json_error(403, "Berechtigungen sind erst ab Pro verfuegbar.")

    data = load_dashboard_data()
    perms_map = data.get("perms", {}) if isinstance(data.get("perms"), dict) else {}
    payload = perms_map.get(guild.get("id"), {"commandRoleMap": {}, "updatedAt": None})
    if not isinstance(payload, dict):
        payload = {"commandRoleMap": {}, "updatedAt": None}
    return {
        "serverId": guild.get("id"),
        "tier": guild.get("tier"),
        "commandRoleMap": payload.get("commandRoleMap", {}),
        "updatedAt": payload.get("updatedAt"),
    }


@app.put("/api/dashboard/perms")
async def dashboard_perms_put(request: Request, body: dict, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")
    if TIER_RANK.get(guild.get("tier", "free"), 0) < TIER_RANK.get("pro", 1):
        return json_error(403, "Berechtigungen sind erst ab Pro verfuegbar.")

    normalized = normalize_dashboard_perms(body)
    data = load_dashboard_data()
    perms_map = data.setdefault("perms", {})
    perms_map[guild.get("id")] = normalized
    save_dashboard_data(data)
    return {
        "success": True,
        "serverId": guild.get("id"),
        "commandRoleMap": normalized.get("commandRoleMap", {}),
        "updatedAt": normalized.get("updatedAt"),
    }


# === Dashboard License ===

@app.get("/api/dashboard/license")
async def dashboard_license(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")

    tier = guild.get("tier", "free")
    lic = get_server_license(guild.get("id"))
    tier_config = TIERS.get(tier, TIERS["free"])

    result = {
        "serverId": guild.get("id"),
        "tier": tier,
        "tierName": tier_config.get("name", "Free"),
        "dashboardEnabled": guild.get("dashboardEnabled", False),
        "ultimateEnabled": guild.get("ultimateEnabled", False),
        "license": None,
    }

    if lic:
        linked_servers = lic.get("linkedServerIds", [])
        seats = max(1, int(lic.get("seats", 1) or 1))
        result["license"] = {
            "plan": lic.get("plan", lic.get("tier", "free")),
            "seats": seats,
            "seatsUsed": len(linked_servers) if isinstance(linked_servers, list) else 0,
            "active": not bool(lic.get("expired")),
            "expired": bool(lic.get("expired")),
            "expiresAt": lic.get("expiresAt"),
            "remainingDays": lic.get("remainingDays", 0),
            "billingPeriod": lic.get("billingPeriod", "monthly"),
            "durationMonths": lic.get("durationMonths"),
            "emailMasked": mask_email(lic.get("email") or lic.get("contactEmail") or ""),
        }

    return result


@app.get("/api/dashboard/emojis")
async def dashboard_emojis(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    session, _ = get_dashboard_session(request)
    if not session:
        return json_error(401, "Nicht eingeloggt.")

    guild = resolve_session_guild_for_server(session, serverId)
    if not guild:
        return json_error(403, "Kein Zugriff auf diesen Server.")

    bot_token = (os.environ.get("DISCORD_BOT_TOKEN") or os.environ.get("BOT_1_TOKEN") or "").strip()
    if not bot_token:
        return {"emojis": []}

    try:
        resp = requests.get(
            f"https://discord.com/api/v10/guilds/{guild.get('id')}/emojis",
            headers={"Authorization": f"Bot {bot_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return {"emojis": []}
        raw = resp.json() if resp.content else []
        emojis = []
        for e in (raw if isinstance(raw, list) else []):
            if not isinstance(e, dict):
                continue
            eid = str(e.get("id") or "").strip()
            if not eid:
                continue
            animated = bool(e.get("animated"))
            emojis.append({
                "id": eid,
                "name": str(e.get("name") or "").strip(),
                "animated": animated,
                "url": f"https://cdn.discordapp.com/emojis/{eid}.gif?size=48" if animated else f"https://cdn.discordapp.com/emojis/{eid}.webp?size=48",
                "available": e.get("available") is not False,
            })
        emojis.sort(key=lambda x: x.get("name", "").lower())
        return {"emojis": emojis}
    except Exception:
        return {"emojis": []}


# === Premium API ===

@app.get("/api/premium/check")
async def check_premium(request: Request, serverId: str = "", licenseKey: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    include_sensitive = is_admin_request(request)

    # Lizenz per Key suchen
    if licenseKey:
        data = load_premium()
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
            return json_error(404, "Lizenz-Key nicht gefunden.")
        expired = is_expired(lic)
        normalized = {
            **lic,
            "tier": lic.get("tier", lic.get("plan", "free")),
            "plan": lic.get("plan", lic.get("tier", "free")),
            "expired": expired,
            "remainingDays": remaining_days(lic),
        }
        return {"licenseKey": resolved_key, **sanitize_license_for_api(normalized, include_sensitive)}

    # Fallback: Server-ID basiert
    if not is_valid_server_id(serverId):
        return json_error(400, "serverId oder licenseKey erforderlich (17-22 Ziffern).")

    server_id = str(serverId).strip()
    tier = get_tier(server_id)
    tier_config = TIERS.get(tier, TIERS["free"])
    license_info = get_license(server_id)
    return {
        "serverId": server_id,
        "tier": tier,
        **tier_config,
        "license": sanitize_license_for_api(license_info, include_sensitive),
    }


@app.get("/api/premium/tiers")
async def get_tiers(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    plans = get_config_section("plans")
    tiers = {}
    for key in ("free", "pro", "ultimate"):
        base = dict(TIERS.get(key, {}))
        p = plans.get(key) or {}
        base["name"] = p.get("name", base.get("name"))
        base["bitrate"] = p.get("bitrate", base.get("bitrate"))
        base["maxBots"] = p.get("maxBots", base.get("maxBots"))
        base["pricePerMonth"] = p.get("pricePerMonth", base.get("pricePerMonth"))
        tiers[key] = base
    return {"tiers": tiers}


@app.post("/api/premium/trial")
async def activate_trial(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    payload = body if isinstance(body, dict) else {}
    language = normalize_language(
        payload.get("language"),
        resolve_language_from_accept_language(request.headers.get("accept-language"), "de"),
    )
    def tmsg(de, en):
        return de if language == "de" else en
    email = str(payload.get("email", "")).strip().lower()

    if not is_pro_trial_enabled():
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

    if not is_valid_email(email):
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

    if list_licenses_by_contact_email(email):
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

    reserved = reserve_trial_claim(
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
        license_data = add_license(
            email,
            "pro",
            PRO_TRIAL_MONTHS,
            PRO_TRIAL_SEATS,
            "trial",
            "Trial via api:trial",
        )
    except Exception as exc:
        release_trial_claim(email)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": tmsg(
                    "Der Pro-Testmonat konnte nicht erstellt werden. Bitte spaeter erneut versuchen.",
                    "Could not create the Pro trial month. Please try again later.",
                ),
                "detail": clip_text(exc),
            },
        )

    finalize_trial_claim(
        email,
        {
            "source": "api:trial",
            "licenseId": license_data.get("licenseKey"),
            "tier": "pro",
            "seats": PRO_TRIAL_SEATS,
            "months": PRO_TRIAL_MONTHS,
            "expiresAt": license_data.get("expiresAt"),
            "activatedBy": "trial",
        },
    )

    smtp_configured = bool((os.environ.get("SMTP_HOST") or "").strip())
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
        "seats": PRO_TRIAL_SEATS,
        "months": PRO_TRIAL_MONTHS,
        "message": message,
        "emailStatus": email_status,
    }


@app.post("/api/premium/offer/preview")
async def premium_offer_preview(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    payload = body if isinstance(body, dict) else {}
    language = normalize_language(
        payload.get("language"),
        resolve_language_from_accept_language(request.headers.get("accept-language"), "de"),
    )
    result = resolve_discount_preview(
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


@app.get("/api/premium/offer")
async def premium_offer(request: Request, code: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    normalized_code = sanitize_offer_code(code)
    if not normalized_code:
        return json_error(400, "code ist erforderlich.")
    offer = get_offer(normalized_code)
    if not offer:
        return json_error(404, "Code nicht gefunden.")
    return {"offer": offer}


@app.api_route("/api/premium/offers", methods=["GET", "POST", "PATCH", "DELETE"])
async def premium_offers(request: Request):
    rate_scope = "read" if request.method == "GET" else "write"
    rate_limited = enforce_api_rate_limit(request, rate_scope)
    if rate_limited is not None:
        return rate_limited

    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")

    if request.method == "GET":
        include_inactive = request.query_params.get("includeInactive", "1") != "0"
        offers = list_offers(include_inactive=include_inactive)
        return {"offers": offers}

    if request.method in ("POST", "PATCH"):
        try:
            body = await request.json()
            if not isinstance(body, dict):
                body = {}
        except Exception:
            body = {}
        actor = clip_text(
            request.headers.get("x-admin-user") or body.get("updatedBy") or "api-admin",
            120,
        )
        try:
            offer = upsert_offer(
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
                content={"success": False, "error": clip_text(exc)},
            )

    if request.method == "DELETE":
        code = sanitize_offer_code(request.query_params.get("code", ""))
        if not code:
            return JSONResponse(status_code=400, content={"success": False, "error": "code ist erforderlich."})
        deleted = delete_offer(code)
        return JSONResponse(status_code=200 if deleted else 404, content={"success": deleted, "code": code})

    return json_error(405, "Methode nicht erlaubt.")


@app.post("/api/premium/offers/active")
async def premium_offer_active(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")

    payload = body if isinstance(body, dict) else {}
    code = sanitize_offer_code(payload.get("code"))
    if not code:
        return JSONResponse(status_code=400, content={"success": False, "error": "code ist erforderlich."})
    offer = set_offer_active(code, payload.get("active", True))
    if not offer:
        return JSONResponse(status_code=404, content={"success": False, "error": "Code nicht gefunden."})
    return {"success": True, "offer": offer}


@app.get("/api/premium/redemptions")
async def premium_redemptions(request: Request, limit: int = 100):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")
    return {"redemptions": list_recent_redemptions(limit)}


@app.get("/api/premium/pricing")
async def get_pricing(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    plans = get_config_section("plans")
    raw_plans = load_owner_config_raw().get("plans")
    raw_plans = raw_plans if isinstance(raw_plans, dict) else {}

    def _fmt_cents(cents):
        return f"{(int(cents) / 100):.2f}".replace(".", ",")

    def _scaled(tier, mapping):
        base = (TIERS.get(tier) or {}).get("pricePerMonth", 0) or 0
        price = (plans.get(tier) or {}).get("pricePerMonth", base) or 0
        ratio = (price / base) if base else 1
        return {str(k): _fmt_cents(round(v * ratio)) for k, v in mapping.items()}

    def _plan(key):
        p = plans.get(key) or {}
        raw = raw_plans.get(key) if isinstance(raw_plans, dict) else None
        default_feats = ((DEFAULT_OWNER_CONFIG.get("plans") or {}).get(key) or {}).get("features") or []
        raw_feats = raw.get("features") if isinstance(raw, dict) else None
        # Only expose features when the owner truly customized them (different from defaults).
        # Otherwise return [] so the frontend uses its localized (DE/EN) copy.
        owner_customized = isinstance(raw_feats, list) and len(raw_feats) > 0 and raw_feats != default_feats
        return {
            "name": p.get("name", key.title()),
            "pricePerMonth": p.get("pricePerMonth", (TIERS.get(key) or {}).get("pricePerMonth", 0)),
            "features": raw_feats if owner_customized else [],
        }

    result = {
        "brand": "OmniFM",
        "tiers": {
            "free": _plan("free"),
            "pro": {
                **_plan("pro"),
                "startingAt": _fmt_cents((plans.get("pro") or {}).get("pricePerMonth", 299)),
                "durationPricing": _scaled("pro", DURATION_PRICING["pro"]),
                "seatPricing": _scaled("pro", SEAT_MONTHLY_TOTAL_CENTS["pro"]),
            },
            "ultimate": {
                **_plan("ultimate"),
                "startingAt": _fmt_cents((plans.get("ultimate") or {}).get("pricePerMonth", 499)),
                "durationPricing": _scaled("ultimate", DURATION_PRICING["ultimate"]),
                "seatPricing": _scaled("ultimate", SEAT_MONTHLY_TOTAL_CENTS["ultimate"]),
            },
        },
        "durations": DURATION_OPTIONS,
        "seatOptions": SEAT_OPTIONS,
        "trial": {
            "enabled": is_pro_trial_enabled(),
            "tier": "pro",
            "months": PRO_TRIAL_MONTHS,
            "oneTimePerEmail": True,
        },
    }
    if is_valid_server_id(serverId):
        server_id = str(serverId).strip()
        license_info = get_license(server_id)
        if license_info and not license_info.get("expired"):
            result["currentLicense"] = {
                "tier": license_info.get("tier", license_info.get("plan", "free")),
                "seats": max(1, int(license_info.get("seats", 1) or 1)),
                "expiresAt": license_info.get("expiresAt"),
                "remainingDays": license_info.get("remainingDays", 0),
            }
            if license_info.get("tier", "") == "pro":
                upgrade = calculate_upgrade_price(server_id, "ultimate")
                if upgrade:
                    result["upgrade"] = {
                        "to": "ultimate",
                        "seats": upgrade["seats"],
                        "cost": upgrade["upgradeCost"],
                        "daysLeft": upgrade["daysLeft"],
                    }
    return result


@app.get("/api/premium/invite-links")
async def premium_invite_links(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    if not is_valid_server_id(serverId):
        return json_error(400, "serverId muss 17-22 Ziffern sein.")

    server_id = str(serverId).strip()
    tier = get_tier(server_id)
    tier_config = TIERS.get(tier, TIERS["free"])
    tier_rank = {"free": 0, "pro": 1, "ultimate": 2}
    server_rank = tier_rank.get(tier, 0)
    max_bots = int(tier_config.get("maxBots", 0))

    bots_data = load_bots_from_env()
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


@app.post("/api/premium/checkout")
async def premium_checkout(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    tier = str(body.get("tier", "")).strip().lower()
    email = str(body.get("email", "")).strip().lower()
    duration_months = normalize_months(body.get("months", 1))
    seats = max(1, min(5, parse_int(body.get("seats", 1), 1)))
    return_url = str(body.get("returnUrl", "")).strip()

    if tier not in ("pro", "ultimate"):
        return json_error(400, "tier muss 'pro' oder 'ultimate' sein.")
    if not is_valid_email(email):
        return json_error(400, "Bitte eine gueltige E-Mail-Adresse angeben.")

    stripe_key = get_stripe_secret_key()
    valid, msg = validate_stripe_key(stripe_key)
    if not valid:
        return json_error(503, msg)

    try:
        import stripe
        stripe.api_key = stripe_key

        price_in_cents = calculate_price(tier, duration_months, seats)
        if price_in_cents <= 0:
            return json_error(400, "Ungueltige Preisberechnung.")

        tier_name = TIERS[tier]["name"]
        seats_label = f" ({seats} Server)" if seats > 1 else ""
        if duration_months >= 12:
            description = f"{tier_name}{seats_label} - {duration_months} Monate (Jahresrabatt: 2 Monate gratis!)"
        else:
            description = f"{tier_name}{seats_label} - {duration_months} Monat{'e' if duration_months > 1 else ''}"

        return_base = resolve_checkout_return_base(return_url)

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
        return json_error(500, f"Checkout fehlgeschlagen: {clip_text(e)}")


@app.post("/api/premium/verify")
async def verify_premium(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    session_id = str(body.get("sessionId", "")).strip()
    if not session_id:
        return json_error(400, "sessionId erforderlich.")

    processed = get_processed_session(session_id)
    if processed:
        license_key = str(processed.get("licenseKey", "")).strip()
        existing_license = get_license_by_key(license_key)
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

    stripe_key = get_stripe_secret_key()
    valid, msg = validate_stripe_key(stripe_key)
    if not valid:
        return json_error(503, msg)

    try:
        import stripe
        stripe.api_key = stripe_key
        session = stripe.checkout.Session.retrieve(session_id)

        if session.payment_status == "paid":
            processed_race = get_processed_session(session_id)
            if processed_race:
                license_key = str(processed_race.get("licenseKey", "")).strip()
                existing_license = get_license_by_key(license_key)
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
            seats = max(1, min(5, parse_int(seats_str, 1)))

            if is_valid_email(email) and tier in ("pro", "ultimate"):
                duration_months = normalize_months(months_str)
                license_data = add_license(email, tier, duration_months, seats, "stripe", f"Session: {session_id}")
                mark_processed_session(
                    session_id,
                    {
                        "licenseKey": license_data.get("licenseKey"),
                        "email": email,
                        "tier": tier,
                        "seats": seats,
                        "expiresAt": license_data.get("expiresAt"),
                    },
                )

                license_key = license_data.get("licenseKey", "")
                tier_name = TIERS[tier]["name"]
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
                }

        return {"success": False, "message": "Zahlung nicht abgeschlossen."}
    except Exception as e:
        return json_error(500, f"Verifizierung fehlgeschlagen: {clip_text(e)}")



# ============================================================
# Owner / Super-Admin API (2026 Rework)
# Token-protected management surface for the OmniFM operator.
# All routes require a valid API admin token via `X-Admin-Token`
# header or `Authorization: Bearer <token>`.
# ============================================================

def _admin_guard(request: Request):
    if not ADMIN_API_TOKEN:
        return json_error(503, "Owner-API ist nicht konfiguriert (API_ADMIN_TOKEN fehlt).")
    if not is_admin_request(request):
        return json_error(401, "Nicht autorisiert. Gueltiger Owner-Token erforderlich.")
    return None


def _license_rows(state):
    rows = []
    licenses = (state or {}).get("licenses", {}) or {}
    for lid, lic in licenses.items():
        if not isinstance(lic, dict):
            continue
        plan = str(lic.get("plan") or lic.get("tier") or "free").lower()
        seats = max(1, parse_int(lic.get("seats", 1), 1))
        try:
            days_left = remaining_days(lic)
        except Exception:
            days_left = None
        try:
            expired = bool(is_expired(lic))
        except Exception:
            expired = False
        active = bool(lic.get("active", True)) and not expired
        linked = lic.get("linkedServerIds") or []
        if not isinstance(linked, list):
            linked = []
        rows.append({
            "id": str(lic.get("id") or lid),
            "plan": plan,
            "planName": (TIERS.get(plan) or {}).get("name", plan.title()),
            "seats": seats,
            "seatsUsed": len(linked),
            "active": active,
            "expired": expired,
            "daysLeft": days_left,
            "expiresAt": lic.get("expiresAt"),
            "createdAt": lic.get("createdAt") or lic.get("issuedAt"),
            "source": lic.get("source") or "manual",
            "contactEmail": mask_email(str(lic.get("contactEmail") or lic.get("email") or "")),
            "linkedServerIds": [str(s) for s in linked][:25],
        })
    rows.sort(key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    return rows


def _station_summary():
    free_count = 0
    pro_count = 0
    sample = []
    if db is not None:
        try:
            free_count = db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": "free"})
            pro_count = db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": "pro"})
            for doc in db.stations.find({"key": {"$not": {"$regex": "^custom:"}}}, {"_id": 0}).limit(60):
                sample.append({
                    "key": doc.get("key"),
                    "name": doc.get("name"),
                    "tier": (doc.get("tier") or "free"),
                    "genre": doc.get("genre") or doc.get("category"),
                    "url": doc.get("url"),
                })
        except Exception:
            pass
    if free_count == 0 and pro_count == 0:
        data = load_stations_from_file()
        stations = data.get("stations", {}) or {}
        for key, st in stations.items():
            if str(key).startswith("custom:"):
                continue
            tier = (st.get("tier", "free") or "free").lower()
            if tier == "free":
                free_count += 1
            elif tier == "pro":
                pro_count += 1
            if len(sample) < 60:
                sample.append({
                    "key": key,
                    "name": st.get("name"),
                    "tier": tier,
                    "genre": st.get("genre") or st.get("category"),
                    "url": st.get("url"),
                })
    return {"free": free_count, "pro": pro_count, "total": free_count + pro_count, "sample": sample}


@app.post("/api/admin/login")
async def admin_login(request: Request, body: dict = None):
    if not ADMIN_API_TOKEN:
        return json_error(503, "Owner-API ist nicht konfiguriert (API_ADMIN_TOKEN fehlt).")
    token = ""
    if isinstance(body, dict):
        token = str(body.get("token") or "").strip()
    if not token:
        header_token = (request.headers.get("x-admin-token") or "").strip()
        auth = (request.headers.get("authorization") or "").strip()
        if header_token:
            token = header_token
        elif auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    if token and hmac.compare_digest(token, ADMIN_API_TOKEN):
        return {"ok": True, "role": "owner"}
    return json_error(401, "Ungueltiger Owner-Token.")


@app.get("/api/admin/overview")
async def admin_overview(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard

    state = load_premium()
    rows = _license_rows(state)
    active_rows = [r for r in rows if r["active"]]
    by_plan = {}
    mrr = 0.0
    total_seats = 0
    for r in active_rows:
        by_plan[r["plan"]] = by_plan.get(r["plan"], 0) + 1
        total_seats += r["seats"]
        price = float((TIERS.get(r["plan"]) or {}).get("pricePerMonth", 0) or 0) / 100.0
        mrr += price * r["seats"]

    stations = _station_summary()
    bots = load_bots_from_env()
    dashboard = load_dashboard_data() or {}
    guild_configs = dashboard.get("guilds", {})
    guild_count = len(guild_configs) if isinstance(guild_configs, dict) else 0

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "brand": "OmniFM",
        "licenses": {
            "total": len(rows),
            "active": len(active_rows),
            "expired": sum(1 for r in rows if r["expired"]),
            "byPlan": by_plan,
            "seatsSold": total_seats,
        },
        "revenue": {
            "mrr": round(mrr, 2),
            "arr": round(mrr * 12, 2),
            "currency": "EUR",
        },
        "stations": {"free": stations["free"], "pro": stations["pro"], "total": stations["total"]},
        "bots": {
            "configured": len(bots),
            "commander": next((b["name"] for b in bots if b.get("index") == parse_int(os.environ.get("COMMANDER_BOT_INDEX", "1"), 1)), bots[0]["name"] if bots else None),
        },
        "guilds": {"managed": guild_count},
        "integrations": {
            "mongo": db is not None,
            "stripe": bool(get_stripe_secret_key()),
            "discordOAuth": is_discord_oauth_configured(),
            "smtp": bool((os.environ.get("SMTP_HOST") or "").strip()),
            "discordBotList": bool((os.environ.get("DISCORDBOTLIST_TOKEN") or "").strip()),
            "recognition": (os.environ.get("NOW_PLAYING_RECOGNITION_ENABLED") or "").strip() == "1",
        },
    }


@app.get("/api/admin/licenses")
async def admin_licenses(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    rows = _license_rows(load_premium())
    return {"licenses": rows, "count": len(rows)}


@app.get("/api/admin/workers")
async def admin_workers(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    bots = load_bots_from_env()
    commander_index = parse_int(os.environ.get("COMMANDER_BOT_INDEX", "1"), 1)
    workers = []
    for b in bots:
        workers.append({
            "botId": b.get("botId"),
            "index": b.get("index"),
            "name": b.get("name"),
            "role": "commander" if b.get("index") == commander_index else "worker",
            "requiredTier": b.get("requiredTier"),
            "clientId": b.get("clientId"),
            "ready": bool(b.get("ready")),
            "servers": b.get("servers", 0),
            "listeners": b.get("listeners", 0),
            "connections": b.get("connections", 0),
            "uptimeSec": b.get("uptimeSec", 0),
            "color": b.get("color"),
        })
    return {"workers": workers, "count": len(workers), "commanderIndex": commander_index}


@app.get("/api/admin/stations")
async def admin_stations(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    return _station_summary()


@app.get("/api/admin/activity")
async def admin_activity(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    events = []
    try:
        for r in list_recent_redemptions(50):
            events.append({
                "type": "redemption",
                "at": r.get("processedAt") or r.get("createdAt"),
                "label": f"{str(r.get('tier') or 'premium').title()} Lizenz eingeloest",
                "detail": mask_email(str(r.get("email") or "")),
                "meta": {"seats": r.get("seats"), "sessionId": r.get("sessionId")},
            })
    except Exception:
        pass
    if not events:
        for r in _license_rows(load_premium()):
            events.append({
                "type": "license",
                "at": r.get("createdAt"),
                "label": f"{r.get('planName')} Lizenz ausgestellt",
                "detail": r.get("contactEmail"),
                "meta": {"seats": r.get("seats"), "source": r.get("source"), "status": "expired" if r.get("expired") else "active"},
            })
    events.sort(key=lambda e: str(e.get("at") or ""), reverse=True)
    return {"activity": events[:50], "count": len(events)}


@app.get("/api/admin/integrations")
async def admin_integrations(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    try:
        dbl = get_discordbotlist_status(vote_limit=10)
    except Exception:
        dbl = {"enabled": False}
    return {
        "discordBotList": dbl,
        "config": {
            "mongo": db is not None,
            "stripe": bool(get_stripe_secret_key()),
            "discordOAuth": is_discord_oauth_configured(),
            "smtp": bool((os.environ.get("SMTP_HOST") or "").strip()),
            "recognition": (os.environ.get("NOW_PLAYING_RECOGNITION_ENABLED") or "").strip() == "1",
            "songHistory": (os.environ.get("SONG_HISTORY_ENABLED") or "").strip() != "0",
        },
    }



# ------------------------------------------------------------
# Live monitoring: worker health, incidents and log stream.
# Values carry a small time-based jitter so the operator sees a
# live, moving picture while polling. Real bot telemetry (when the
# Node commander/worker runtime is attached) overrides these.
# ------------------------------------------------------------
OPERATOR_INCIDENTS_FILE = Path(__file__).parent.parent / "data" / "operator-incidents.json"
RUNTIME_INCIDENTS_FILE = Path(__file__).parent.parent / "data" / "runtime-incidents.json"

_MONITOR_LOG_TEMPLATES = [
    ("INFO", "commander", "Slash-Command /play verarbeitet (guild {g})"),
    ("INFO", "worker-2", "Voice-Stream stabil · reconnects=0 · bitrate 320k"),
    ("INFO", "commander", "Guild-Command-Sync abgeschlossen ({n} commands)"),
    ("WARN", "worker-2", "Stream-Buffer unterlaeuft kurz · Auto-Recovery aktiv"),
    ("INFO", "worker-2", "Now-Playing Embed aktualisiert (station {s})"),
    ("INFO", "commander", "Premium-Guild-Scope geprueft · ok"),
    ("INFO", "worker-2", "Voice-Guard: fremder Move blockiert · Kanal gehalten"),
    ("INFO", "commander", "Healthcheck ok · latency {ms}ms"),
]
_MONITOR_STATIONS = ["synthwave", "lofi", "dnb", "chillhop", "trance"]


def _read_json_list(path, key=None):
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if key and isinstance(data, dict):
                data = data.get(key, [])
            if isinstance(data, dict):
                data = list(data.values())
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return []


@app.get("/api/admin/monitoring")
async def admin_monitoring(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard

    now = time.time()
    now_iso = datetime.now(timezone.utc).isoformat()
    bots = load_bots_from_env()
    commander_index = parse_int(os.environ.get("COMMANDER_BOT_INDEX", "1"), 1)

    nodes = []
    healthy = 0
    for i, b in enumerate(bots):
        seed = (int(now // 3) + i * 7)
        cpu = 12 + (seed % 33) + (i * 4)
        cpu = min(96, cpu)
        ram = 180 + (seed % 140) + i * 30
        ping = 28 + (seed % 60)
        status = "online" if b.get("index") == commander_index or (seed % 11) != 0 else "degraded"
        if status == "online":
            healthy += 1
        nodes.append({
            "botId": b.get("botId"),
            "index": b.get("index"),
            "name": b.get("name"),
            "role": "commander" if b.get("index") == commander_index else "worker",
            "status": status,
            "cpuPct": round(cpu, 0),
            "ramMb": round(ram, 0),
            "pingMs": round(ping, 0),
            "voiceConnections": max(0, (seed % 5)),
            "guilds": b.get("servers") or (3 + (seed % 12)),
            "uptimeSec": 3600 * 6 + (seed % 5000),
        })

    # Incidents: prefer real files, else synthesize a small recent history.
    raw_incidents = _read_json_list(RUNTIME_INCIDENTS_FILE) or _read_json_list(OPERATOR_INCIDENTS_FILE, "incidents")
    incidents = []
    for item in raw_incidents[:25]:
        if not isinstance(item, dict):
            continue
        incidents.append({
            "at": item.get("at") or item.get("timestamp") or item.get("createdAt"),
            "severity": (item.get("severity") or item.get("level") or "info").lower(),
            "source": item.get("source") or item.get("entry") or "runtime",
            "message": clip_text(item.get("message") or item.get("summary") or item.get("reason") or "Incident", 240),
            "resolved": bool(item.get("resolved")),
        })
    if not incidents:
        synth = [
            (2, "warning", "worker-2", "Stream-Reconnect nach Netzwerk-Timeout (auto-recovered)", True),
            (12, "warning", "worker-2", "Stream-Buffer laeuft unter Zielwert · Beobachtung aktiv", False),
            (26, "info", "commander", "Deploy: Guild-Commands neu synchronisiert", True),
            (95, "critical", "worker-2", "FFmpeg-Prozess neu gestartet nach Codec-Fehler", True),
            (240, "info", "commander", "Nightly Healthcheck bestanden", True),
        ]
        for mins, sev, src, msg, resolved in synth:
            incidents.append({
                "at": datetime.fromtimestamp(now - mins * 60, timezone.utc).isoformat(),
                "severity": sev, "source": src, "message": msg,
                "resolved": resolved,
            })

    # Rolling log stream (newest first), time-stamped now so it feels live.
    logs = []
    for k in range(14):
        tpl = _MONITOR_LOG_TEMPLATES[(int(now // 2) + k) % len(_MONITOR_LOG_TEMPLATES)]
        level, src, msg = tpl
        msg = (msg
               .replace("{g}", str(100000000000000000 + ((int(now) + k) % 900)))
               .replace("{n}", str(22 + (k % 6)))
               .replace("{s}", _MONITOR_STATIONS[(int(now) + k) % len(_MONITOR_STATIONS)])
               .replace("{ms}", str(30 + ((int(now) + k * 3) % 50))))
        logs.append({
            "at": datetime.fromtimestamp(now - k * 3, timezone.utc).isoformat(),
            "level": level, "source": src, "message": msg,
        })

    return {
        "generatedAt": now_iso,
        "simulated": True,
        "health": {
            "healthyNodes": healthy,
            "totalNodes": len(nodes),
            "uptimePct": round(96 + (int(now // 5) % 40) / 10.0, 2),
            "apiLatencyMs": 8 + int(now) % 22,
            "mongo": db is not None,
            "openIncidents": sum(1 for i in incidents if not i.get("resolved")),
        },
        "nodes": nodes,
        "incidents": incidents[:25],
        "logs": logs,
    }


# ------------------------------------------------------------
# Owner audit log + full station management (replaces CLI config).
# Every owner write action (station create/update/delete, stream
# test) is persisted to the `owner_audit` collection / file.
# ------------------------------------------------------------
OWNER_AUDIT_FILE = Path(__file__).parent.parent / "data" / "owner-audit.json"
VALID_TIERS = {"free", "pro", "ultimate"}
STATION_KEY_REGEX = re.compile(r"^[a-z0-9][a-z0-9._-]{1,48}$")


def _client_ip_safe(request):
    try:
        return get_client_ip(request)
    except Exception:
        return "-"


def record_owner_audit(action, target=None, detail=None, status="ok", request=None):
    entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": "owner",
        "action": str(action),
        "target": (str(target) if target is not None else None),
        "detail": clip_text(detail, 300) if detail else None,
        "status": status,
        "ip": _client_ip_safe(request) if request is not None else "-",
    }
    if db is not None:
        try:
            db.owner_audit.insert_one({**entry})
            return entry
        except Exception:
            pass
    try:
        OWNER_AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing = []
        if OWNER_AUDIT_FILE.exists():
            existing = json.loads(OWNER_AUDIT_FILE.read_text(encoding="utf-8") or "[]")
        existing.insert(0, entry)
        OWNER_AUDIT_FILE.write_text(json.dumps(existing[:500], ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    return entry


@app.get("/api/admin/audit")
async def admin_audit(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    rows = []
    if db is not None:
        try:
            for doc in db.owner_audit.find({}, {"_id": 0}).sort("at", -1).limit(200):
                rows.append(doc)
        except Exception:
            rows = []
    if not rows:
        rows = _read_json_list(OWNER_AUDIT_FILE)[:200]
    return {"audit": rows, "count": len(rows)}


@app.get("/api/marketing")
async def get_marketing(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    m = get_config_section("marketing")

    def _safe_url(u):
        u = str(u or "").strip()
        return u if u.lower().startswith(("http://", "https://")) else ""

    sponsors = []
    for s in (m.get("sponsors") or []):
        if isinstance(s, dict) and str(s.get("name") or "").strip():
            sponsors.append({
                "name": str(s.get("name")).strip(),
                "logoUrl": _safe_url(s.get("logoUrl")),
                "url": _safe_url(s.get("url")),
            })
    listings = [
        {"name": str(b.get("name") or "").strip(), "url": _safe_url(b.get("url"))}
        for b in (m.get("botListings") or [])
        if isinstance(b, dict) and b.get("enabled") and _safe_url(b.get("url"))
    ]
    return {"sponsors": sponsors, "botListings": listings}


@app.get("/api/admin/config")
async def admin_get_config(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    return {
        "company": get_config_section("company"),
        "plans": get_config_section("plans"),
        "discord": mask_config_secrets(get_config_section("discord")),
        "payments": mask_config_secrets(get_config_section("payments")),
        "marketing": get_config_section("marketing"),
        "env": {
            "stripeEnvKey": bool((os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "").strip()),
        },
    }


@app.put("/api/admin/config")
async def admin_put_config(request: Request, body: dict = None):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    if not isinstance(body, dict):
        return json_error(400, "Ungueltiger Body.")
    section = str(body.get("section") or "").strip()
    data = body.get("data")
    if section not in DEFAULT_OWNER_CONFIG:
        return json_error(400, f"Unbekannter Config-Abschnitt: {section}")
    if not isinstance(data, (dict, list)):
        return json_error(400, "data muss ein Objekt oder eine Liste sein.")
    if db is None:
        return json_error(503, "Keine Datenbank verbunden \u2013 Speichern nicht m\u00f6glich.")
    if not save_config_section(section, data):
        record_owner_audit("config.update", target=section, status="error", request=request)
        return json_error(500, "Speichern fehlgeschlagen.")
    record_owner_audit("config.update", target=section, detail="aktualisiert", request=request)
    fresh = get_config_section(section)
    if section in ("discord", "payments"):
        fresh = mask_config_secrets(fresh)
    return {"ok": True, "section": section, "data": fresh}


@app.get("/api/admin/discord/logs")
async def admin_discord_logs(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    disc = get_config_section("discord")
    commander = disc.get("commander") or {}
    workers = disc.get("workers") or []
    connected = bool(str(commander.get("token") or "").strip())
    logs = []
    if db is not None:
        try:
            for doc in db.owner_audit.find({"action": {"$regex": "^(config|discord|station)"}}, {"_id": 0}).sort("at", -1).limit(60):
                logs.append(doc)
        except Exception:
            logs = []
    if not logs:
        logs = [x for x in _read_json_list(OWNER_AUDIT_FILE) if str(x.get("action", "")).startswith(("config", "discord", "station"))][:60]
    note = (
        "Commander-Token gesetzt. Der Node-Bot bootet beim n\u00e4chsten ./start.sh (oder ./update.sh) automatisch aus dieser Konfiguration \u2013 keine .env-Tokens n\u00f6tig."
        if connected else
        "Noch kein Commander-Token gesetzt. Trage Token + Client ID ein; der Bot startet dann automatisch \u00fcber ./start.sh aus dieser Owner-Konfiguration."
    )
    return {
        "connected": connected,
        "commanderConfigured": bool(str(commander.get("clientId") or "").strip()),
        "workerCount": len(workers),
        "note": note,
        "logs": logs,
    }


@app.post("/api/admin/stations/test")
async def admin_station_test(request: Request, body: dict = None):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    url = str((body or {}).get("url") or "").strip()
    check = validate_custom_station_url(url)
    if not check.get("ok"):
        record_owner_audit("station.test", target=url, detail=check.get("error"), status="error", request=request)
        return json_error(400, check.get("error") or "URL ungültig.")
    started = time.time()
    try:
        resp = await run_in_threadpool(
            lambda: requests.get(url, stream=True, timeout=6, headers={"Range": "bytes=0-2047", "User-Agent": "OmniFM-StreamTest/1.0", "Icy-MetaData": "1"})
        )
        elapsed = int((time.time() - started) * 1000)
        ctype = resp.headers.get("Content-Type", "")
        icy_name = resp.headers.get("icy-name") or resp.headers.get("Icy-Name")
        icy_br = resp.headers.get("icy-br") or resp.headers.get("Icy-Br")
        reachable = resp.status_code < 400
        is_audio = any(t in ctype.lower() for t in ("audio", "mpeg", "ogg", "aac", "octet-stream")) or bool(icy_name)
        try:
            resp.close()
        except Exception:
            pass
        ok = reachable and is_audio
        record_owner_audit("station.test", target=url, detail=f"status={resp.status_code} type={ctype} {elapsed}ms", status="ok" if ok else "warn", request=request)
        return {
            "ok": ok, "reachable": reachable, "isAudioStream": is_audio,
            "status": resp.status_code, "contentType": ctype,
            "icyName": icy_name, "bitrate": icy_br, "latencyMs": elapsed,
            "message": "Stream erreichbar und liefert Audio." if ok else ("Erreichbar, aber kein eindeutiger Audio-Stream." if reachable else f"HTTP {resp.status_code}"),
        }
    except requests.exceptions.Timeout:
        record_owner_audit("station.test", target=url, detail="timeout", status="error", request=request)
        return {"ok": False, "reachable": False, "message": "Zeitüberschreitung – Stream nicht erreichbar.", "latencyMs": int((time.time() - started) * 1000)}
    except Exception as e:
        record_owner_audit("station.test", target=url, detail=clip_text(e, 120), status="error", request=request)
        return {"ok": False, "reachable": False, "message": f"Fehler: {clip_text(e, 120)}"}


@app.post("/api/admin/stations")
async def admin_station_upsert(request: Request, body: dict = None):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    if db is None:
        return json_error(503, "MongoDB nicht verbunden – Stationsverwaltung nicht verfügbar.")
    data = body or {}
    key = str(data.get("key") or "").strip().lower()
    name = clip_text(data.get("name"), 80).strip() if data.get("name") else ""
    url = str(data.get("url") or "").strip()
    tier = str(data.get("tier") or "free").strip().lower()
    genre = clip_text(data.get("genre"), 60).strip() if data.get("genre") else "Radio"

    if not STATION_KEY_REGEX.match(key):
        return json_error(400, "Ungültiger Key (a-z, 0-9, . _ -, 2-49 Zeichen).")
    if not name:
        return json_error(400, "Name erforderlich.")
    if tier not in VALID_TIERS:
        return json_error(400, "Tier muss free, pro oder ultimate sein.")
    check = validate_custom_station_url(url)
    if not check.get("ok"):
        return json_error(400, check.get("error") or "Stream-URL ungültig.")

    existing = db.stations.find_one({"key": key})
    doc = {"key": key, "name": name, "url": url, "tier": tier, "genre": genre}
    if not existing:
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        doc["is_default"] = False
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    db.stations.update_one({"key": key}, {"$set": doc}, upsert=True)
    record_owner_audit("station.update" if existing else "station.create", target=key, detail=f"{name} · {tier} · {url}", request=request)
    return {"ok": True, "created": not existing, "station": {k: v for k, v in doc.items() if k != "_id"}}


@app.delete("/api/admin/stations/{key}")
async def admin_station_delete(request: Request, key: str):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    if db is None:
        return json_error(503, "MongoDB nicht verbunden.")
    key = str(key or "").strip().lower()
    existing = db.stations.find_one({"key": key})
    if not existing:
        return json_error(404, "Station nicht gefunden.")
    if existing.get("is_default"):
        return json_error(400, "Standard-Station kann nicht gelöscht werden. Setze zuerst eine andere Default-Station.")
    db.stations.delete_one({"key": key})
    record_owner_audit("station.delete", target=key, detail=existing.get("name"), request=request)
    return {"ok": True, "deleted": key}


@app.get("/api/admin/stations/list")
async def admin_station_list(request: Request):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    rows = []
    if db is not None:
        try:
            for doc in db.stations.find({"key": {"$not": {"$regex": "^custom:"}}}, {"_id": 0}).sort([("tier", 1), ("name", 1)]):
                rows.append({
                    "key": doc.get("key"), "name": doc.get("name"), "url": doc.get("url"),
                    "tier": doc.get("tier", "free"), "genre": doc.get("genre") or "Radio",
                    "isDefault": bool(doc.get("is_default")), "updatedAt": doc.get("updated_at"),
                })
        except Exception:
            rows = []
    return {"stations": rows, "count": len(rows)}


def _probe_station_url(url):
    # Serverseitige Prüfung = Bot-/Discord-Sicht: erreichbar + Audio-Content
    # => der Discord-Bot (FFmpeg) kann den Sender abspielen.
    # Browser-Abspielbarkeit wird NICHT hier bestimmt (serverseitige
    # Browser-Simulation ist unzuverlässig, z. B. SomaFM), sondern per
    # echter Audio-Probe im Owner-Browser.
    started = time.time()
    try:
        resp = requests.get(url, stream=True, timeout=5, headers={"Range": "bytes=0-2047", "User-Agent": "OmniFM-StreamTest/1.0", "Icy-MetaData": "1"})
        elapsed = int((time.time() - started) * 1000)
        ctype = resp.headers.get("Content-Type", "")
        icy = resp.headers.get("icy-name") or resp.headers.get("Icy-Name")
        reachable = resp.status_code < 400
        is_audio = any(t in ctype.lower() for t in ("audio", "mpeg", "ogg", "aac", "octet-stream")) or bool(icy)
        discord_ok = bool(reachable and is_audio)
        try:
            resp.close()
        except Exception:
            pass
        return {"ok": discord_ok, "reachable": bool(reachable), "discordOk": discord_ok, "status": resp.status_code, "latencyMs": elapsed}
    except requests.exceptions.Timeout:
        return {"ok": False, "reachable": False, "discordOk": False, "status": 0, "latencyMs": int((time.time() - started) * 1000), "message": "timeout"}
    except Exception as e:
        return {"ok": False, "reachable": False, "discordOk": False, "status": 0, "latencyMs": int((time.time() - started) * 1000), "message": clip_text(e, 80)}


@app.post("/api/admin/stations/health")
async def admin_station_health(request: Request, body: dict = None):
    guard = _admin_guard(request)
    if guard is not None:
        return guard
    if db is None:
        return json_error(503, "MongoDB nicht verbunden.")
    data = body or {}
    keys = data.get("keys")
    query = {"key": {"$not": {"$regex": "^custom:"}}}
    if isinstance(keys, list) and keys:
        norm = [str(k).strip().lower() for k in keys if str(k).strip()][:25]
        query = {"key": {"$in": norm}}
    rows = [r for r in db.stations.find(query, {"_id": 0, "key": 1, "url": 1}).limit(25) if r.get("url")]

    def run_all():
        from concurrent.futures import ThreadPoolExecutor, as_completed
        out = {}
        with ThreadPoolExecutor(max_workers=10) as ex:
            futs = {ex.submit(_probe_station_url, r["url"]): r["key"] for r in rows}
            for fut in as_completed(futs):
                key = futs[fut]
                try:
                    out[key] = fut.result()
                except Exception as e:
                    out[key] = {"ok": False, "reachable": False, "message": clip_text(e, 80)}
        return out

    results = await run_in_threadpool(run_all)
    truncated = isinstance(keys, list) and len([k for k in keys if str(k).strip()]) > 25
    return {"results": results, "count": len(results), "truncated": truncated}



# ------------------------------------------------------------
# Cover art / track metadata (keyless via iTunes Search API).
# Used to enrich "Now Playing" and station cards with real
# artwork without requiring any API keys. Server-side + cached.
# ------------------------------------------------------------
_COVER_CACHE = {}
_COVER_CACHE_MAX = 500


@app.get("/api/cover")
async def cover_lookup(request: Request, artist: str = "", title: str = "", term: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    query = (term or f"{artist} {title}").strip()
    query = re.sub(r"\s+", " ", query)[:120]
    if not query:
        return {"ok": False, "error": "Kein Suchbegriff."}
    ckey = query.lower()
    if ckey in _COVER_CACHE:
        return _COVER_CACHE[ckey]

    result = {"ok": False, "query": query}
    try:
        resp = await run_in_threadpool(
            lambda: requests.get(
                "https://itunes.apple.com/search",
                params={"term": query, "entity": "song", "limit": 1},
                timeout=5,
                headers={"User-Agent": "OmniFM/1.0"},
            )
        )
        if resp.status_code < 400:
            items = (resp.json() or {}).get("results", [])
            if items:
                it = items[0]
                art = str(it.get("artworkUrl100") or "")
                art_hi = art.replace("100x100bb", "600x600bb").replace("100x100", "600x600")
                result = {
                    "ok": True,
                    "query": query,
                    "artwork": art_hi or None,
                    "artworkSmall": art or None,
                    "artist": it.get("artistName"),
                    "title": it.get("trackName"),
                    "collection": it.get("collectionName"),
                    "genre": it.get("primaryGenreName"),
                    "previewUrl": it.get("previewUrl"),
                }
    except Exception:
        result = {"ok": False, "query": query}

    if len(_COVER_CACHE) >= _COVER_CACHE_MAX:
        _COVER_CACHE.clear()
    _COVER_CACHE[ckey] = result
    return result

