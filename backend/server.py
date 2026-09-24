"""Production FastAPI backend for the OmniFM website and Owner Console.

The public API is served below ``/api`` on port 8001. The Node.js code in
``src/`` is the Discord voice runtime and intentionally runs separately.
"""

import os
import sys
import json
import re
import hmac
import time
import string
import secrets
import socket
import ipaddress
import smtplib
import ssl
import calendar
from email.message import EmailMessage
import requests
from pathlib import Path
from urllib.parse import urlparse, urlencode
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.routing import APIRoute
from pymongo import MongoClient

load_dotenv()

app = FastAPI(title="OmniFM API")

# start.sh verifies this value after launching Uvicorn.  A generic 200 health
# response is not sufficient because an orphaned, older backend on the same
# port would otherwise look healthy while serving a different API contract.
BACKEND_CONTRACT_VERSION = "owner-live-v5"

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

STATIONS_FILE = Path(__file__).parent.parent / "stations.json"
# The fallback files without MongoDB share the runtime folder of the Node
# stores (#227): runtime-data/ in production, the repository root otherwise.
RUNTIME_DATA_DIR = Path(
    os.environ.get("OMNIFM_RUNTIME_DATA_DIR") or Path(__file__).parent.parent
)
if not RUNTIME_DATA_DIR.is_absolute():
    RUNTIME_DATA_DIR = Path(__file__).parent.parent / RUNTIME_DATA_DIR
PREMIUM_FILE = RUNTIME_DATA_DIR / "premium.json"
COUPONS_FILE = RUNTIME_DATA_DIR / "coupons.json"
DASHBOARD_FILE = RUNTIME_DATA_DIR / "dashboard.json"
# The recovery values of the owner console, shared with the bot (#217).
RECOVERY_SETTINGS_FILE = Path(__file__).parent.parent / "src" / "config" / "recovery-settings.json"


def load_recovery_settings():
    try:
        entries = json.loads(RECOVERY_SETTINGS_FILE.read_text(encoding="utf-8"))
        return [entry for entry in entries if isinstance(entry, dict) and entry.get("key") and entry.get("env")]
    except Exception:
        return []


RECOVERY_SETTINGS = load_recovery_settings()


def normalize_stream_recovery(values):
    """Owner values of system.streamRecovery, clamped to the bounds the bot
    applies itself. Unknown keys and values that are not numbers are dropped."""
    if not isinstance(values, dict):
        return {}
    normalized = {}
    for entry in RECOVERY_SETTINGS:
        raw = values.get(entry["key"])
        if raw in (None, "") or isinstance(raw, bool):
            continue
        try:
            number = int(float(raw))
        except (TypeError, ValueError):
            continue
        normalized[entry["key"]] = max(int(entry["min"]), min(int(entry["max"]), number))
    return normalized

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


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Cache-Control", "no-store" if request.url.path.startswith("/api/admin/") else "no-cache")
    return response

client = None
db = None
if MONGO_URL and DB_NAME:
    # pymongo reconnects on its own. Keeping the handles when the first ping
    # fails means the API recovers without a restart once MongoDB is reachable
    # (typical after a reboot, where mongod is still starting), see #199.
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
    db = client[DB_NAME]
    try:
        client.admin.command("ping")
    except Exception as exc:  # pragma: no cover - depends on the environment
        print(
            f"[OmniFM] MongoDB beim Start nicht erreichbar ({str(exc)[:120]}); "
            "die Verbindung wird automatisch nachgeholt.",
            file=sys.stderr,
        )

_MONGO_STATUS = {"checkedAt": 0.0, "ok": False}


def mongo_is_reachable(max_age_seconds=5.0):
    """True when MongoDB answers a ping. The answer is cached briefly so health
    polls do not turn into a ping storm, and a down MongoDB costs at most one
    server-selection timeout per cache window."""
    if client is None:
        return False
    now = time.monotonic()
    if (now - _MONGO_STATUS["checkedAt"]) < max_age_seconds:
        return _MONGO_STATUS["ok"]
    try:
        client.admin.command("ping")
        ok = True
    except Exception:
        ok = False
    _MONGO_STATUS["checkedAt"] = now
    _MONGO_STATUS["ok"] = ok
    return ok

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
SECRET_CONFIG_FIELDS = {"token", "secretKey", "webhookSecret", "secret", "clientSecret", "password", "apiKey"}

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
    "system": {
        "discordOAuth": {"clientId": "", "clientSecret": "", "redirectUri": "", "scopes": "identify guilds"},
        "smtp": {"enabled": False, "host": "", "port": 587, "secure": False, "user": "", "password": "", "from": ""},
        "audioRecognition": {"enabled": False, "apiKey": ""},
        "songHistory": {"enabled": True, "maxPerGuild": 100},
        "stationHealth": {"enabled": True, "intervalMs": 5000, "batchSize": 2, "concurrency": 2, "timeoutMs": 8000},
        "streamRecovery": {entry["key"]: entry["default"] for entry in RECOVERY_SETTINGS}
        or {"stableResetMs": 60000, "failoverMinFailures": 3, "failoverMinUnstableMs": 60000, "failoverStableAudioMs": 25000},
        "botDirectories": {
            "discordBotList": {"enabled": False, "token": "", "botId": "", "slug": "", "webhookSecret": "", "statsScope": "aggregate"},
            "botsGG": {"enabled": False, "token": "", "botId": "", "statsScope": "aggregate"},
            "topGG": {"enabled": False, "token": "", "botId": "", "webhookSecret": "", "statsScope": "aggregate"},
        },
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


def _strip_secret_markers(obj):
    """Remove API-only `...Set` flags before persisting Owner config."""
    if isinstance(obj, dict):
        return {
            key: _strip_secret_markers(value)
            for key, value in obj.items()
            if not (key.endswith("Set") and key[:-3] in SECRET_CONFIG_FIELDS)
        }
    if isinstance(obj, list):
        return [_strip_secret_markers(value) for value in obj]
    return obj


def save_config_section(name, data):
    if db is None:
        return False
    try:
        data = _strip_secret_markers(data)
        # Preserve secrets inherited from legacy env files when the first
        # Owner save sends their masked placeholders back to the API.
        if name == "system":
            current = effective_system_config()
        elif name == "payments":
            current = effective_payments_config()
        else:
            current = load_owner_config_raw().get(name)
        if isinstance(data, (dict, list)) and current is not None:
            if isinstance(data, dict) and isinstance(current, dict):
                merged = json.loads(json.dumps(current))
                data = _deep_merge(merged, data)
            data = _merge_config_secrets(current, data)
        if name == "system" and isinstance(data, dict) and "streamRecovery" in data:
            data["streamRecovery"] = normalize_stream_recovery(data["streamRecovery"])
        db.owner_config.update_one({"_id": OWNER_CONFIG_ID}, {"$set": {name: data}}, upsert=True)
        return True
    except Exception:
        return False


def system_setting(group, key, env_key=None, default=""):
    stored_group = (((load_owner_config_raw().get("system") or {}).get(group)) or {})
    if key in stored_group and stored_group.get(key) not in (None, ""):
        return stored_group.get(key)
    if env_key and os.environ.get(env_key) not in (None, ""):
        return os.environ.get(env_key)
    return default


def directory_setting(directory, key, env_key=None, default=""):
    stored = (((((load_owner_config_raw().get("system") or {}).get("botDirectories")) or {}).get(directory)) or {})
    if key in stored and stored.get(key) not in (None, ""):
        return stored.get(key)
    if env_key and os.environ.get(env_key) not in (None, ""):
        return os.environ.get(env_key)
    return default


def config_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def effective_system_config():
    """Return Owner settings with legacy environment values migrated in-memory.

    This prevents opening and saving the new System page from disabling values
    that were configured in backend/.env before this Owner section existed.
    """
    config = get_config_section("system")
    stored = load_owner_config_raw().get("system") or {}
    mappings = {
        "discordOAuth": {
            "clientId": ("DISCORD_CLIENT_ID", str),
            "clientSecret": ("DISCORD_CLIENT_SECRET", str),
            "redirectUri": ("DISCORD_REDIRECT_URI", str),
            "scopes": ("DISCORD_OAUTH_SCOPES", str),
        },
        "smtp": {
            "host": ("SMTP_HOST", str), "port": ("SMTP_PORT", int),
            "secure": ("SMTP_SECURE", config_bool), "user": ("SMTP_USER", str),
            "password": ("SMTP_PASS", str), "from": ("SMTP_FROM", str),
        },
        "audioRecognition": {
            "enabled": ("NOW_PLAYING_RECOGNITION_ENABLED", config_bool),
            "apiKey": ("ACOUSTID_API_KEY", str),
        },
        "songHistory": {
            "enabled": ("SONG_HISTORY_ENABLED", config_bool),
            "maxPerGuild": ("SONG_HISTORY_MAX_PER_GUILD", int),
        },
        "stationHealth": {
            "enabled": ("STATION_HEALTH_ENABLED", config_bool),
            "intervalMs": ("STATION_HEALTH_INTERVAL_MS", int),
            "batchSize": ("STATION_HEALTH_BATCH_SIZE", int),
            "concurrency": ("STATION_HEALTH_CONCURRENCY", int),
            "timeoutMs": ("STATION_HEALTH_TIMEOUT_MS", int),
        },
        "streamRecovery": {entry["key"]: (entry["env"], int) for entry in RECOVERY_SETTINGS},
    }
    for group, fields in mappings.items():
        stored_group = stored.get(group) or {}
        target = config.setdefault(group, {})
        for key, (env_key, converter) in fields.items():
            env_value = os.environ.get(env_key)
            if key in stored_group or env_value in (None, ""):
                continue
            try:
                target[key] = converter(env_value)
            except (TypeError, ValueError):
                pass
    smtp_stored = stored.get("smtp") or {}
    if "enabled" not in smtp_stored and os.environ.get("SMTP_HOST"):
        config["smtp"]["enabled"] = True

    directory_mappings = {
        "discordBotList": {
            "enabled": ("DISCORDBOTLIST_ENABLED", config_bool), "token": ("DISCORDBOTLIST_TOKEN", str),
            "botId": ("DISCORDBOTLIST_BOT_ID", str), "slug": ("DISCORDBOTLIST_SLUG", str),
            "webhookSecret": ("DISCORDBOTLIST_WEBHOOK_SECRET", str), "statsScope": ("DISCORDBOTLIST_STATS_SCOPE", str),
        },
        "botsGG": {
            "enabled": ("BOTSGG_ENABLED", config_bool), "token": ("BOTSGG_TOKEN", str),
            "botId": ("BOTSGG_BOT_ID", str), "statsScope": ("BOTSGG_STATS_SCOPE", str),
        },
        "topGG": {
            "enabled": ("TOPGG_ENABLED", config_bool), "token": ("TOPGG_TOKEN", str),
            "botId": ("TOPGG_BOT_ID", str), "webhookSecret": ("TOPGG_WEBHOOK_SECRET", str),
            "statsScope": ("TOPGG_STATS_SCOPE", str),
        },
    }
    stored_directories = stored.get("botDirectories") or {}
    target_directories = config.setdefault("botDirectories", {})
    for directory, fields in directory_mappings.items():
        stored_directory = stored_directories.get(directory) or {}
        target = target_directories.setdefault(directory, {})
        for key, (env_key, converter) in fields.items():
            env_value = os.environ.get(env_key)
            if key in stored_directory or env_value in (None, ""):
                continue
            try:
                target[key] = converter(env_value)
            except (TypeError, ValueError):
                pass
    return config


def effective_payments_config():
    config = get_config_section("payments")
    stored_stripe = ((load_owner_config_raw().get("payments") or {}).get("stripe") or {})
    stripe = config.setdefault("stripe", {})
    env_key = str(os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "").strip()
    env_webhook = str(os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    if "secretKey" not in stored_stripe and env_key:
        stripe["secretKey"] = env_key
    if "webhookSecret" not in stored_stripe and env_webhook:
        stripe["webhookSecret"] = env_webhook
    if "enabled" not in stored_stripe and env_key:
        stripe["enabled"] = True
    if "mode" not in stored_stripe and env_key:
        stripe["mode"] = "live" if env_key.startswith("sk_live_") else "test"
    return config


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
        "processedEvents": {},
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
    return bool(
        system_setting("discordOAuth", "clientId", "DISCORD_CLIENT_ID")
        and system_setting("discordOAuth", "clientSecret", "DISCORD_CLIENT_SECRET")
        and system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI")
    )


def get_frontend_base_url(request: Request):
    configured = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    parsed_config = urlparse(configured)
    if parsed_config.scheme in ("http", "https") and parsed_config.netloc:
        return f"{parsed_config.scheme}://{parsed_config.netloc}"

    from_redirect = urlparse(str(system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI")))
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
    if db is not None:
        try:
            db.oauth_states.delete_many({"expiresAt": {"$lte": now_value}})
        except Exception:
            pass


def clean_expired_dashboard_sessions(now_ts=None):
    now_value = int(now_ts if now_ts is not None else time.time())
    expired = []
    for session_key, payload in DASHBOARD_SESSION_STORE.items():
        expires_at = int(payload.get("expiresAt", 0) or 0)
        if expires_at <= now_value:
            expired.append(session_key)
    for session_key in expired:
        DASHBOARD_SESSION_STORE.pop(session_key, None)
    if db is not None:
        try:
            db.dashboard_sessions.delete_many({"expiresAt": {"$lte": now_value}})
        except Exception:
            pass


def store_ephemeral(collection_name, key, payload, memory_store):
    memory_store[key] = payload
    if db is not None:
        try:
            expires_at = int(payload.get("expiresAt") or 0)
            document = {"_id": key, **payload, "expiresAtDate": datetime.fromtimestamp(expires_at, timezone.utc)}
            collection = db[collection_name]
            collection.create_index("expiresAtDate", expireAfterSeconds=0)
            collection.replace_one({"_id": key}, document, upsert=True)
        except Exception:
            pass


def get_ephemeral(collection_name, key, memory_store, consume=False):
    payload = memory_store.pop(key, None) if consume else memory_store.get(key)
    if db is not None:
        try:
            collection = db[collection_name]
            document = collection.find_one_and_delete({"_id": key}) if consume else collection.find_one({"_id": key})
            if document:
                document.pop("_id", None)
                document.pop("expiresAtDate", None)
                payload = document
        except Exception:
            pass
    if not isinstance(payload, dict) or int(payload.get("expiresAt", 0) or 0) <= int(time.time()):
        return None
    return payload


def delete_ephemeral(collection_name, key, memory_store):
    memory_store.pop(key, None)
    if db is not None:
        try:
            db[collection_name].delete_one({"_id": key})
        except Exception:
            pass


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
    event_id = re.sub(r"[^a-z0-9_-]", "", str(payload.get("id") or f"evt_{int(time.time() * 1000):x}{secrets.token_hex(3)}").strip().lower())[:40]
    title = clip_text(payload.get("title") or payload.get("name") or "OmniFM Event", 120).strip()
    station_key = re.sub(r"[^a-z0-9:_-]", "", str(payload.get("stationKey") or payload.get("station") or "").strip().lower())[:120]
    timezone_name = clip_text(payload.get("timezone") or payload.get("timeZone") or "Europe/Vienna", 80)
    event_timezone = dashboard_event_zone(timezone_name)
    channel_id = str(payload.get("voiceChannelId") or payload.get("channelId") or "").strip()
    text_channel_id = str(payload.get("textChannelId") or "").strip()
    enabled = payload.get("enabled") is not False
    now_iso = datetime.now(timezone.utc).isoformat()
    run_at_ms = parse_int(payload.get("runAtMs"), 0)
    if run_at_ms <= 0:
        starts_at = str(payload.get("startsAtLocal") or payload.get("startsAt") or payload.get("startAt") or "").strip()
        if not starts_at:
            raise ValueError("Startzeit ist erforderlich.")
        try:
            parsed_start = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
            if parsed_start.tzinfo is None:
                parsed_start = parsed_start.replace(tzinfo=event_timezone)
            run_at_ms = int(parsed_start.timestamp() * 1000)
        except Exception as exc:
            raise ValueError("Startzeit oder Zeitzone ist ungültig.") from exc
    repeat = str(payload.get("repeat") or "none").strip().lower()
    supported_repeat = {"none", "daily", "weekdays", "weekly", "biweekly", "yearly", "monthly_first_weekday", "monthly_second_weekday", "monthly_third_weekday", "monthly_fourth_weekday", "monthly_last_weekday"}
    if repeat not in supported_repeat:
        repeat = "none"
    duration_ms = parse_int(payload.get("durationMs"), 0)
    if duration_ms <= 0:
        duration_ms = max(0, min(525600, parse_int(payload.get("durationMinutes"), 0))) * 60 * 1000
    return {
        "id": event_id,
        "guildId": str(payload.get("guildId") or "").strip(),
        "botId": clip_text(payload.get("botId") or "bot-1", 60),
        "name": title,
        "stationKey": station_key,
        "voiceChannelId": channel_id,
        "textChannelId": text_channel_id or None,
        "announceMessage": clip_text(payload.get("announceMessage") or "", 1200) or None,
        "description": clip_text(payload.get("description") or "", 1000) or None,
        "stageTopic": clip_text(payload.get("stageTopic") or "", 120) or None,
        "timeZone": timezone_name,
        "createDiscordEvent": payload.get("createDiscordEvent") is True,
        "discordScheduledEventId": payload.get("discordScheduledEventId") or None,
        "discordSyncError": payload.get("discordSyncError") or None,
        "repeat": repeat,
        "runAtMs": run_at_ms,
        "durationMs": duration_ms,
        "activeUntilMs": max(0, parse_int(payload.get("activeUntilMs"), 0)),
        "enabled": enabled,
        "lastRunAtMs": max(0, parse_int(payload.get("lastRunAtMs"), 0)),
        "lastStopAtMs": max(0, parse_int(payload.get("lastStopAtMs"), 0)),
        "deleteAfterStop": payload.get("deleteAfterStop") is True,
        "createdByUserId": str(payload.get("createdByUserId") or "").strip() or None,
        "updatedAt": now_iso,
        "createdAt": clip_text(payload.get("createdAt") or now_iso, 80),
    }


def dashboard_event_response(event):
    row = event if isinstance(event, dict) else {}
    run_at_ms = max(0, parse_int(row.get("runAtMs"), 0))
    starts_at = datetime.fromtimestamp(run_at_ms / 1000, timezone.utc).isoformat() if run_at_ms else None
    timezone_name = row.get("timeZone") or "Europe/Vienna"
    discord_scheduled_event_id = str(row.get("discordScheduledEventId") or "").strip() or None
    discord_sync_error = clip_text(row.get("discordSyncError") or "", 300) or None
    return {
        **{key: value for key, value in row.items() if key not in ("_id", "_eventId")},
        "title": row.get("name") or "OmniFM Event",
        "channelId": row.get("voiceChannelId") or "",
        "timezone": timezone_name,
        "startsAt": starts_at,
        "startsAtLocal": format_dashboard_event_local(run_at_ms, timezone_name),
        "repeatLabelDe": dashboard_event_repeat_label(row.get("repeat"), "de", run_at_ms, timezone_name),
        "repeatLabelEn": dashboard_event_repeat_label(row.get("repeat"), "en", run_at_ms, timezone_name),
        "durationMinutes": round(max(0, parse_int(row.get("durationMs"), 0)) / 60000),
        "announceMessage": row.get("announceMessage") or "",
        "description": row.get("description") or "",
        "stageTopic": row.get("stageTopic") or "",
        "discordScheduledEventId": discord_scheduled_event_id,
        "discordEventSynced": row.get("createDiscordEvent") is True and bool(discord_scheduled_event_id) and not discord_sync_error,
        "discordSyncError": discord_sync_error,
    }


MONTHLY_EVENT_REPEAT_NTH = {
    "monthly_first_weekday": 1,
    "monthly_second_weekday": 2,
    "monthly_third_weekday": 3,
    "monthly_fourth_weekday": 4,
    "monthly_last_weekday": -1,
}


def dashboard_event_zone(timezone_name):
    try:
        return ZoneInfo(str(timezone_name or "Europe/Vienna"))
    except Exception as exc:
        raise ValueError("Startzeit oder Zeitzone ist ungültig.") from exc


def format_dashboard_event_local(run_at_ms, timezone_name):
    value = max(0, parse_int(run_at_ms, 0))
    if not value:
        return ""
    return datetime.fromtimestamp(value / 1000, timezone.utc).astimezone(dashboard_event_zone(timezone_name)).strftime("%Y-%m-%dT%H:%M")


def dashboard_event_repeat_label(repeat, language, run_at_ms=0, timezone_name="Europe/Vienna"):
    mode = str(repeat or "none").strip().lower()
    is_de = normalize_language(language, "de") == "de"
    local_start = None
    if parse_int(run_at_ms, 0) > 0:
        local_start = datetime.fromtimestamp(parse_int(run_at_ms, 0) / 1000, timezone.utc).astimezone(dashboard_event_zone(timezone_name))
    weekday_de = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
    weekday_en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    weekday = (weekday_de if is_de else weekday_en)[local_start.weekday()] if local_start else ("Wochentag" if is_de else "weekday")
    if mode == "daily":
        return "Jeden Tag" if is_de else "Every day"
    if mode == "weekdays":
        return "Werktäglich (Montag bis Freitag)" if is_de else "Weekdays (Monday to Friday)"
    if mode == "weekly":
        return f"Jeden {weekday}" if is_de else f"Every {weekday}"
    if mode == "biweekly":
        return f"Alle 2 Wochen ({weekday})" if is_de else f"Every 2 weeks ({weekday})"
    if mode in MONTHLY_EVENT_REPEAT_NTH:
        nth = MONTHLY_EVENT_REPEAT_NTH[mode]
        if nth == -1:
            return f"Jeden letzten {weekday} im Monat" if is_de else f"Every last {weekday} of the month"
        ordinal_en = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}.get(nth, f"{nth}th")
        return f"Jeden {nth}. {weekday} im Monat" if is_de else f"Every {ordinal_en} {weekday} of the month"
    if mode == "yearly":
        if not local_start:
            return "Jährlich" if is_de else "Yearly"
        if is_de:
            return f"Jährlich am {local_start.day:02d}.{local_start.month:02d}."
        return f"Yearly on {local_start.strftime('%B')} {local_start.day}"
    return "Einmalig" if is_de else "Once"


def next_dashboard_event_run_ms(run_at_ms, repeat, timezone_name="Europe/Vienna"):
    value = max(0, parse_int(run_at_ms, 0))
    mode = str(repeat or "none").strip().lower()
    if not value or mode == "none":
        return 0
    tz = dashboard_event_zone(timezone_name)
    local_start = datetime.fromtimestamp(value / 1000, timezone.utc).astimezone(tz)
    if mode in {"daily", "weekdays", "weekly", "biweekly"}:
        step_days = 7 if mode == "weekly" else 14 if mode == "biweekly" else 1
        candidate = local_start + timedelta(days=step_days)
        while mode == "weekdays" and candidate.weekday() >= 5:
            candidate += timedelta(days=1)
        return int(candidate.timestamp() * 1000)
    if mode == "yearly":
        year = local_start.year + 1
        while year < local_start.year + 401:
            try:
                return int(local_start.replace(year=year).timestamp() * 1000)
            except ValueError:
                year += 1
        return 0
    nth = MONTHLY_EVENT_REPEAT_NTH.get(mode)
    if nth is None:
        return 0
    month = 1 if local_start.month == 12 else local_start.month + 1
    year = local_start.year + 1 if local_start.month == 12 else local_start.year
    _, last_day = calendar.monthrange(year, month)
    if nth == -1:
        day = last_day
        while datetime(year, month, day).weekday() != local_start.weekday():
            day -= 1
    else:
        first_weekday = datetime(year, month, 1).weekday()
        day = 1 + ((local_start.weekday() - first_weekday) % 7) + ((nth - 1) * 7)
        if day > last_day:
            return next_dashboard_event_run_ms(
                int(local_start.replace(year=year, month=month, day=last_day).timestamp() * 1000),
                repeat,
                timezone_name,
            )
    candidate = datetime(year, month, day, local_start.hour, local_start.minute, tzinfo=tz)
    return int(candidate.timestamp() * 1000)


def build_dashboard_event_preview_rows(event, limit=5):
    row = event if isinstance(event, dict) else {}
    safe_limit = max(1, min(10, parse_int(limit, 5)))
    run_at_ms = max(0, parse_int(row.get("runAtMs"), 0))
    duration_ms = max(0, parse_int(row.get("durationMs"), 0))
    timezone_name = row.get("timeZone") or row.get("timezone") or "Europe/Vienna"
    repeat = row.get("repeat") or "none"
    result = []
    for _ in range(safe_limit):
        if not run_at_ms:
            break
        end_at_ms = run_at_ms + duration_ms if duration_ms > 0 else 0
        result.append({
            "runAtMs": run_at_ms,
            "durationMs": duration_ms,
            "startsAt": datetime.fromtimestamp(run_at_ms / 1000, timezone.utc).isoformat(),
            "startsAtLocal": format_dashboard_event_local(run_at_ms, timezone_name),
            "endsAt": datetime.fromtimestamp(end_at_ms / 1000, timezone.utc).isoformat() if end_at_ms else "",
            "endsAtLocal": format_dashboard_event_local(end_at_ms, timezone_name) if end_at_ms else "",
        })
        run_at_ms = next_dashboard_event_run_ms(run_at_ms, repeat, timezone_name)
    return result


def build_dashboard_event_conflicts(candidate, existing_events, language="de", ignore_event_id=""):
    candidate_rows = build_dashboard_event_preview_rows(candidate, 5)
    candidate_duration = max(0, parse_int(candidate.get("durationMs"), 0))
    conflicts = []
    seen = set()
    for existing in existing_events if isinstance(existing_events, list) else []:
        if not isinstance(existing, dict) or existing.get("enabled") is False:
            continue
        if str(existing.get("id") or "") == str(ignore_event_id or ""):
            continue
        if str(existing.get("voiceChannelId") or "") != str(candidate.get("voiceChannelId") or ""):
            continue
        existing_rows = build_dashboard_event_preview_rows(existing, 5)
        existing_duration = max(0, parse_int(existing.get("durationMs"), 0))
        for candidate_row in candidate_rows:
            for existing_row in existing_rows:
                severity = ""
                if candidate_duration > 0 and existing_duration > 0:
                    overlaps = candidate_row["runAtMs"] < existing_row["runAtMs"] + existing_duration and existing_row["runAtMs"] < candidate_row["runAtMs"] + candidate_duration
                    if not overlaps:
                        continue
                    severity = "error"
                    message = f'Überschneidet sich mit „{existing.get("name") or "Event"}“ im selben Voice-Kanal.' if language == "de" else f'Overlaps with "{existing.get("name") or "Event"}" in the same voice channel.'
                elif candidate_duration <= 0 and existing_row["runAtMs"] >= candidate_row["runAtMs"]:
                    severity = "warning"
                    message = f'Dieses Event hat keine Endzeit und könnte „{existing.get("name") or "Event"}“ blockieren.' if language == "de" else f'This event has no end time and may block "{existing.get("name") or "Event"}."'
                elif existing_duration <= 0 and existing_row["runAtMs"] <= candidate_row["runAtMs"]:
                    severity = "warning"
                    message = f'„{existing.get("name") or "Event"}“ hat keine Endzeit und könnte dieses Event blockieren.' if language == "de" else f'"{existing.get("name") or "Event"}" has no end time and may block this event.'
                else:
                    continue
                key = (str(existing.get("id") or ""), candidate_row["runAtMs"], existing_row["runAtMs"], severity)
                if key in seen:
                    continue
                seen.add(key)
                existing_response = dashboard_event_response(existing)
                conflicts.append({
                    "severity": severity,
                    "message": message,
                    "eventId": existing_response.get("id"),
                    "title": existing_response.get("title"),
                    "repeat": existing_response.get("repeat"),
                    "repeatLabelDe": existing_response.get("repeatLabelDe"),
                    "repeatLabelEn": existing_response.get("repeatLabelEn"),
                    "startsAt": existing_row.get("startsAt"),
                    "startsAtLocal": existing_row.get("startsAtLocal"),
                    "endsAt": existing_row.get("endsAt"),
                    "endsAtLocal": existing_row.get("endsAtLocal"),
                    "channelId": existing_response.get("channelId"),
                })
    return sorted(conflicts, key=lambda item: (0 if item.get("severity") == "error" else 1, item.get("startsAt") or ""))


def dashboard_event_runtime_id(guild_id):
    live_doc = read_runtime_health_fresh()
    nodes = (live_doc or {}).get("nodes") or []
    candidates = [
        node for node in nodes
        if str(guild_id) in {str(item) for item in node.get("guildIds") or []}
        or any(str(detail.get("guildId") or detail.get("id") or "") == str(guild_id) for detail in node.get("guildDetails") or [])
    ]
    commander = next((node for node in candidates if node.get("role") == "commander"), None)
    selected = commander or (candidates[0] if candidates else {})
    return str(selected.get("runtimeId") or "bot-1").strip() or "bot-1"


def validate_dashboard_event(guild_id, event):
    if not event.get("name"):
        raise ValueError("Event-Name ist erforderlich.")
    if not event.get("stationKey"):
        raise ValueError("Sender ist erforderlich.")
    if not is_valid_server_id(event.get("voiceChannelId")):
        raise ValueError("Gültiger Voice-Kanal ist erforderlich.")
    directory = _runtime_guild_directory([guild_id], with_lists=True).get(guild_id) or {}
    known_voice_ids = {str(row.get("id") or "") for row in directory.get("voiceChannels") or []}
    if known_voice_ids and event.get("voiceChannelId") not in known_voice_ids:
        raise ValueError("Voice-Kanal gehört nicht zu diesem Server.")
    text_channel_id = event.get("textChannelId")
    known_text_ids = {str(row.get("id") or "") for row in directory.get("textChannels") or []}
    if text_channel_id and (not is_valid_server_id(text_channel_id) or (known_text_ids and text_channel_id not in known_text_ids)):
        raise ValueError("Text-Kanal gehört nicht zu diesem Server.")
    key = str(event.get("stationKey") or "")
    if key.startswith("custom:"):
        custom_key = key.split(":", 1)[1]
        exists = db is not None and db.custom_stations.find_one({"guildId": guild_id, "key": custom_key}, {"_id": 1}) is not None
    else:
        exists = db is not None and db.stations.find_one({"key": key}, {"_id": 1}) is not None
        if not exists:
            exists = key in (load_stations_from_file().get("stations") or {})
    if not exists:
        raise ValueError("Sender wurde nicht gefunden.")


def dashboard_event_station_name(guild_id, station_key):
    key = str(station_key or "").strip()
    if key.startswith("custom:"):
        custom_key = key.split(":", 1)[1]
        if db is not None:
            row = db.custom_stations.find_one({"guildId": str(guild_id), "key": custom_key}, {"_id": 0, "name": 1})
            if isinstance(row, dict) and row.get("name"):
                return str(row.get("name"))
        return custom_key
    if db is not None:
        row = db.stations.find_one({"key": key}, {"_id": 0, "name": 1})
        if isinstance(row, dict) and row.get("name"):
            return str(row.get("name"))
    file_row = (load_stations_from_file().get("stations") or {}).get(key) or {}
    return str(file_row.get("name") or key)


def normalize_dashboard_perms(payload):
    body = payload if isinstance(payload, dict) else {}
    incoming = body.get("commandRoleMap") if isinstance(body.get("commandRoleMap"), dict) else {}
    supported = {"play", "pause", "resume", "stop", "setvolume", "stations", "list", "now", "stats", "history", "status", "health", "diag", "addstation", "removestation", "mystations", "event"}
    normalized = {}
    for raw_command, raw_roles in incoming.items():
        command = clip_text(raw_command, 64).lstrip("/").lower()
        if command not in supported:
            continue
        roles = []
        if isinstance(raw_roles, list):
            for role in raw_roles:
                role_id = str(role or "").strip()
                if is_valid_server_id(role_id) and role_id not in roles:
                    roles.append(role_id)
        if roles:
            normalized[command] = roles
    return {
        "commandRoleMap": normalized,
        "commands": {command: {"allowRoleIds": role_ids, "denyRoleIds": []} for command, role_ids in normalized.items()},
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def dashboard_permission_response(document):
    row = document if isinstance(document, dict) else {}
    commands = row.get("commands") if isinstance(row.get("commands"), dict) else {}
    command_role_map = {}
    for command, rule in commands.items():
        if not isinstance(rule, dict):
            continue
        role_ids = []
        for role_id in rule.get("allowRoleIds") or []:
            normalized_id = str(role_id or "").strip()
            if is_valid_server_id(normalized_id) and normalized_id not in role_ids:
                role_ids.append(normalized_id)
        if role_ids:
            command_role_map[str(command)] = role_ids
    return {"commandRoleMap": command_role_map, "commands": commands, "updatedAt": row.get("updatedAt")}


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
    session = get_ephemeral("dashboard_sessions", token, DASHBOARD_SESSION_STORE)
    if not isinstance(session, dict):
        return None, token
    return session, token


def resolve_dashboard_guilds_for_session(session_payload):
    guilds = session_payload.get("guilds") if isinstance(session_payload.get("guilds"), list) else []
    runtime_guilds = _runtime_guild_directory(
        [str(item.get("id") or "").strip() for item in guilds if isinstance(item, dict)]
    )
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
        runtime_guild = runtime_guilds.get(guild_id) or {}
        output.append({
            "id": guild_id,
            "name": clip_text(item.get("name") or guild_id, 120),
            "icon": clip_text(item.get("icon") or "", 120),
            "owner": bool(item.get("owner", False)),
            "permissions": str(item.get("permissions") or "0"),
            "tier": tier,
            "memberCount": max(0, parse_int(runtime_guild.get("memberCount"), 0)),
            "iconUrl": runtime_guild.get("iconUrl"),
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
        "client_id": system_setting("discordOAuth", "clientId", "DISCORD_CLIENT_ID"),
        "response_type": "code",
        "redirect_uri": system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI"),
        "scope": system_setting("discordOAuth", "scopes", "DISCORD_OAUTH_SCOPES", "identify guilds"),
        "state": state,
        "prompt": prompt,
    }
    return f"https://discord.com/api/oauth2/authorize?{urlencode(params)}"


def exchange_discord_code_for_token(code):
    response = requests.post(
        "https://discord.com/api/oauth2/token",
        data={
            "client_id": system_setting("discordOAuth", "clientId", "DISCORD_CLIENT_ID"),
            "client_secret": system_setting("discordOAuth", "clientSecret", "DISCORD_CLIENT_SECRET"),
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI"),
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
    fallback_email = extract_mailbox(system_setting("smtp", "from", "SMTP_FROM") or "")
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
    has_stripe = is_stripe_enabled() and bool(get_stripe_secret_key())
    has_smtp = bool(system_setting("smtp", "host", "SMTP_HOST"))
    bot_id_candidate = str(directory_setting("discordBotList", "botId", "DISCORDBOTLIST_BOT_ID") or os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    has_discordbotlist = config_bool(directory_setting("discordBotList", "enabled", "DISCORDBOTLIST_ENABLED", False)) and bool(str(directory_setting("discordBotList", "token", "DISCORDBOTLIST_TOKEN") or "").strip()) and bool(re.match(r"^\d{17,22}$", bot_id_candidate))
    has_recognition = config_bool(system_setting("audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", False)) and bool(system_setting("audioRecognition", "apiKey", "ACOUSTID_API_KEY"))

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
            "songHistoryEnabled": config_bool(system_setting("songHistory", "enabled", "SONG_HISTORY_ENABLED", True), True),
            "songHistoryMaxPerGuild": parse_int(system_setting("songHistory", "maxPerGuild", "SONG_HISTORY_MAX_PER_GUILD", 100), 100),
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
    fallback_email = extract_mailbox(system_setting("smtp", "from", "SMTP_FROM") or "")
    has_stripe = is_stripe_enabled() and bool(get_stripe_secret_key())
    # PayPal settings are reserved for the future; no production checkout
    # route exists yet, so public legal notices must not advertise it.
    paypal_enabled = False
    has_smtp = bool(system_setting("smtp", "host", "SMTP_HOST"))

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


def is_stripe_enabled():
    stored = ((load_owner_config_raw().get("payments") or {}).get("stripe") or {})
    if "enabled" in stored:
        return bool(stored.get("enabled"))
    return bool(get_stripe_secret_key())


def get_stripe_webhook_secret():
    try:
        value = str(((get_config_section("payments") or {}).get("stripe") or {}).get("webhookSecret") or "").strip()
        if value:
            return value
    except Exception:
        pass
    return str(os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()


def send_license_email_best_effort(email, license_data):
    host = str(system_setting("smtp", "host", "SMTP_HOST") or "").strip()
    if not host or not config_bool(system_setting("smtp", "enabled", default=True), True):
        return {"ok": False, "message": "smtp_not_configured"}
    port = parse_int(system_setting("smtp", "port", "SMTP_PORT", 587), 587)
    secure = config_bool(system_setting("smtp", "secure", "SMTP_SECURE", False))
    user = str(system_setting("smtp", "user", "SMTP_USER") or "").strip()
    password = str(system_setting("smtp", "password", "SMTP_PASS") or "")
    sender = str(system_setting("smtp", "from", "SMTP_FROM") or user or "").strip()
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
        return {"ok": False, "message": clip_text(exc, 160)}
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
        if str(commander.get("clientId") or "").strip():
            entries.append(("free", commander))
        for w in (disc.get("workers") or []):
            if isinstance(w, dict) and str(w.get("clientId") or "").strip():
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
                events = data.get("processedEvents", {})
                for event_id, event in events.items():
                    if isinstance(event, dict):
                        event["_eventId"] = event_id
                        db.processed_events.replace_one({"_eventId": event_id}, event, upsert=True)
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
def seed_demo_enabled() -> bool:
    return (os.environ.get("SEED_DEMO_DATA") or "").strip().lower() in ("1", "true", "yes")


if seed_demo_enabled():
    seed_premium_if_needed()


def purge_demo_data_if_live():
    """Entfernt beim Live-Betrieb übrig gebliebene Demo-Dokumente (idempotent, sicher)."""
    if db is None:
        return
    if seed_demo_enabled():
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
            processed_events = {}
            for doc in db.processed_events.find({}, {"_id": 0}):
                event_id = doc.pop("_eventId", None)
                if event_id:
                    processed_events[event_id] = doc
            meta = db.premium_state.find_one({"_id": "meta"}, {"_id": 0}) or {}
            state = ensure_premium_state({
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
        if PREMIUM_FILE.exists():
            return ensure_premium_state(json.loads(PREMIUM_FILE.read_text(encoding="utf-8")))
        return empty_premium_state()
    except Exception:
        return empty_premium_state()


def save_premium(data):
    safe_data = ensure_premium_state(data)
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

    if db is not None:
        try:
            sync_map(db.licenses, "_licenseId", "licenses")
            sync_map(db.server_entitlements, "_serverId", "serverEntitlements")
            sync_map(db.processed_sessions, "_sessionId", "processedSessions")
            sync_map(db.processed_events, "_eventId", "processedEvents")

            # Meta sections are updated independently so an offer edit cannot
            # overwrite a concurrent trial claim or bot-list statistics update.
            changed_meta = {}
            for key in ("trialClaims", "offers", "discordBotListState", "recentRedemptions"):
                if not isinstance(baseline, dict) or baseline.get(key) != safe_data.get(key):
                    changed_meta[key] = safe_data.get(key)
            if changed_meta:
                db.premium_state.update_one(
                    {"_id": "meta"},
                    {"$set": changed_meta},
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
    token = str(directory_setting("discordBotList", "token", "DISCORDBOTLIST_TOKEN") or "").strip()
    explicit_bot_id = str(directory_setting("discordBotList", "botId", "DISCORDBOTLIST_BOT_ID") or "").strip()
    commander_bot_id = (os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    bot_id = explicit_bot_id or commander_bot_id
    configured = config_bool(directory_setting("discordBotList", "enabled", "DISCORDBOTLIST_ENABLED", bool(token))) and bool(token) and bool(re.match(r"^\d{17,22}$", bot_id))
    stats_scope = "aggregate" if str(directory_setting("discordBotList", "statsScope", "DISCORDBOTLIST_STATS_SCOPE", "aggregate")).strip().lower() == "aggregate" else "commander"

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
        return False
    return datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc)


def remaining_days(license_info):
    if not license_info or not license_info.get("expiresAt"):
        return 0
    diff = datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
    return max(0, int(diff.total_seconds() / 86400) + 1)


def get_server_license(server_id):
    """Get license for a server - supports both old and new format"""
    data = load_premium()
    sid = str(server_id or "").strip()
    if not sid:
        return None

    def resolved_license(lic, source, license_id=None):
        expired = is_expired(lic)
        active = bool(lic.get("active", True)) and not expired
        plan = str(lic.get("plan") or lic.get("tier") or "free").strip().lower()
        if plan not in TIERS:
            plan = "free"
        return {
            **lic,
            "expired": expired,
            "remainingDays": remaining_days(lic),
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
    data = load_premium()
    lic = data.get("licenses", {}).get(key)
    if not lic:
        return None
    expired = is_expired(lic)
    active = bool(lic.get("active", True)) and not expired
    return {
        **lic,
        "licenseKey": key,
        "expired": expired,
        "active": active,
        "remainingDays": remaining_days(lic),
        "activeTier": lic.get("tier", lic.get("plan", "free")) if active else "free",
        "tier": lic.get("tier", lic.get("plan", "free")),
    }


def get_tier(server_id):
    lic = get_server_license(server_id)
    if not lic or lic.get("expired") or not lic.get("active", True):
        return "free"
    tier = lic.get("tier", lic.get("plan", "free"))
    return tier if tier in TIERS else "free"


def get_dashboard_guild_stats(server_id, tier):
    dashboard_data = load_dashboard_data()
    events_map = dashboard_data.get("events", {}) if isinstance(dashboard_data.get("events"), dict) else {}
    perms_map = dashboard_data.get("perms", {}) if isinstance(dashboard_data.get("perms"), dict) else {}
    telemetry_map = dashboard_data.get("telemetry", {}) if isinstance(dashboard_data.get("telemetry"), dict) else {}

    guild_events = events_map.get(server_id, []) if isinstance(events_map.get(server_id), list) else []
    if db is not None:
        try:
            guild_events = list(db.scheduled_events.find({"guildId": server_id}, {"_id": 0, "_eventId": 0}).limit(200))
        except Exception:
            pass
    guild_perms = perms_map.get(server_id, {}) if isinstance(perms_map.get(server_id), dict) else {}
    if db is not None:
        try:
            guild_perms = dashboard_permission_response(db.command_permissions.find_one({"_guildId": server_id}, {"_id": 0}) or {})
        except Exception:
            pass
    telemetry_raw = telemetry_map.get(server_id, {}) if isinstance(telemetry_map.get(server_id), dict) else {}
    telemetry = normalize_dashboard_telemetry(telemetry_raw)

    live_rows = []
    parked_rows = []
    live_doc = read_runtime_health_fresh()
    for node in (live_doc or {}).get("nodes", []):
        for detail in node.get("guildDetails") or []:
            detail_id = str(detail.get("guildId") or detail.get("id") or "").strip()
            if detail_id != server_id:
                continue
            row = {
                **detail,
                "botId": str(node.get("botId") or ""),
                "botIndex": parse_int(node.get("index"), 0),
                "botName": clip_text(node.get("name") or "OmniFM", 80),
                "botRole": str(node.get("role") or "worker"),
            }
            if detail.get("playing") is True or detail.get("voiceConnected") is True:
                live_rows.append(row)
            elif detail.get("parkedReason"):
                # A parked target plays nothing, but the server admin must see
                # it and why (#216).
                parked_rows.append(row)

    live_listeners = sum(max(0, parse_int(row.get("listenerCount"), 0)) for row in live_rows)
    live_top = None
    if live_rows:
        live_top_row = sorted(live_rows, key=lambda row: parse_int(row.get("listenerCount"), 0), reverse=True)[0]
        live_top = {
            "name": clip_text(live_top_row.get("stationName") or live_top_row.get("stationKey") or "-", 120),
            "listeners": max(0, parse_int(live_top_row.get("listenerCount"), 0)),
        }

    live_stream_details = []
    for row in sorted(live_rows + parked_rows, key=lambda item: (parse_int(item.get("botIndex"), 999), str(item.get("botName") or ""))):
        live_stream_details.append({
            "botId": str(row.get("botId") or ""),
            "botIndex": parse_int(row.get("botIndex"), 0),
            "botName": clip_text(row.get("botName") or "OmniFM", 80),
            "botRole": str(row.get("botRole") or "worker"),
            "stationKey": clip_text(row.get("stationKey") or "", 100),
            "stationName": clip_text(row.get("stationName") or row.get("stationKey") or "Unbekannter Sender", 120),
            "desiredStationKey": clip_text(row.get("desiredStationKey") or row.get("stationKey") or "", 100),
            "desiredStationName": clip_text(row.get("desiredStationName") or row.get("stationName") or row.get("stationKey") or "", 120),
            "failoverActive": row.get("failoverActive") is True,
            "failoverStartedAt": max(0, parse_int(row.get("failoverStartedAt"), 0)),
            "failoverReason": clip_text(row.get("failoverReason") or "", 300),
            "failoverFromStationKey": clip_text(row.get("failoverFromStationKey") or "", 100),
            "failoverFromStationName": clip_text(row.get("failoverFromStationName") or "", 120),
            "channelId": str(row.get("channelId") or ""),
            "channelName": clip_text(row.get("channelName") or row.get("channelId") or "Voice-Kanal", 120),
            "listeners": max(0, parse_int(row.get("listenerCount"), 0)),
            "volume": max(0, min(200, parse_int(row.get("volume"), 100))),
            "playing": row.get("playing") is True,
            "voiceConnected": row.get("voiceConnected") is True,
            "recovering": row.get("recovering") is True,
            "lastStreamStartAt": row.get("lastStreamStartAt"),
            "reconnectAttempts": max(0, parse_int(row.get("reconnectAttempts"), 0)),
            "streamErrorCount": max(0, parse_int(row.get("streamErrorCount"), 0)),
            "failbackNextProbeAt": max(0, parse_int(row.get("failbackNextProbeAt"), 0)),
            "parkedReason": clip_text(row.get("parkedReason") or "", 40) or None,
            "parkedAt": max(0, parse_int(row.get("parkedAt"), 0)),
            "serverMuted": row.get("serverMuted") is True,
        })

    process_uptime_sec = max(0, parse_int(((live_doc or {}).get("process") or {}).get("uptimeSec"), 0))
    total_listening_ms = 0
    if db is not None:
        try:
            guild_stat = db.guild_stats.find_one({"guildId": server_id}, {"_id": 0, "totalListeningMs": 1})
            total_listening_ms = max(0, parse_int((guild_stat or {}).get("totalListeningMs"), 0))
        except Exception:
            total_listening_ms = 0

    active_events = len([item for item in guild_events if isinstance(item, dict) and item.get("enabled") is not False])
    basic = {
        "listenersNow": live_listeners if live_doc else telemetry.get("listenersNow", 0),
        "activeStreams": len(live_rows) if live_doc else telemetry.get("activeStreams", 0),
        "peakListeners": max(live_listeners, telemetry.get("peakListeners", 0)),
        "peakTime": telemetry.get("peakTime"),
        "topStation": live_top or telemetry.get("topStation", {"name": "-", "listeners": 0}),
        "activeStreamDetails": live_stream_details,
        "runtimeUptimeSec": process_uptime_sec if live_doc else 0,
        "totalListeningMs": total_listening_ms,
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
    save_premium(data)
    return {**data["licenses"][license_key], "licenseKey": license_key}


def upgrade_license(server_id, new_tier):
    data = load_premium()
    sid = str(server_id)
    lic = data.get("licenses", {}).get(sid)
    if not lic or lic.get("active", True) is False or is_expired(lic):
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
        payload["emailMasked"] = mask_email(license_info.get("email", ""))

    return payload


# === API Routes ===

# ------------------------------------------------------------
# Dashboard via the Node API (#195)
#
# With OMNIFM_DASHBOARD_BACKEND=node (start.sh sets it) FastAPI stays the only
# public HTTP entry, but /api/auth and /api/dashboard are answered by the Node
# API of the commander on 127.0.0.1. Failover chain, voice guard, alerts,
# exports and digest then use the same modules as the bot. Without the switch
# the FastAPI routes below answer as before.
# ------------------------------------------------------------
DASHBOARD_BACKEND = "node" if (os.environ.get("OMNIFM_DASHBOARD_BACKEND") or "").strip().lower() == "node" else "fastapi"
NODE_API_URL = (
    os.environ.get("OMNIFM_NODE_API_URL")
    or f"http://127.0.0.1:{parse_int(os.environ.get('OMNIFM_NODE_API_PORT'), 8002)}"
).rstrip("/")
NODE_PROXY_PREFIXES = ("/api/auth", "/api/dashboard")
NODE_PROXY_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
NODE_PROXY_SKIPPED_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "trailers",
    "transfer-encoding", "upgrade", "host", "content-length", "content-encoding",
}
NODE_PROXY_UNAVAILABLE = (
    "Das Dashboard startet gerade neu. Bitte in ein paar Sekunden erneut versuchen."
)


def build_node_proxy_headers(headers, client_host="", scheme="http"):
    """Request headers for the Node API.

    Hop-by-hop headers stay here. The address of the caller is appended to
    X-Forwarded-For, so the Node API rate-limits the browser and not this
    proxy. A same-origin Origin header is dropped: the Node API only accepts
    configured origins, same-origin requests are legitimate by definition, and
    its CSRF header still guards every dashboard change. A foreign Origin is
    passed on, so the Node API rejects it.
    """
    forwarded = {}
    for key, value in headers.items():
        if key.lower() in NODE_PROXY_SKIPPED_HEADERS:
            continue
        forwarded[key.lower()] = value
    host = str(headers.get("host") or "").strip()
    origin = str(headers.get("origin") or "").strip()
    if origin and host and urlparse(origin).netloc.lower() == host.lower():
        forwarded.pop("origin", None)
    chain = [part.strip() for part in str(headers.get("x-forwarded-for") or "").split(",") if part.strip()]
    if client_host:
        chain.append(str(client_host))
    if chain:
        forwarded["x-forwarded-for"] = ", ".join(chain)
    if not forwarded.get("x-forwarded-proto"):
        forwarded["x-forwarded-proto"] = scheme
    if host:
        forwarded["x-forwarded-host"] = host
    return forwarded


def build_node_proxy_response(status_code, header_pairs, body):
    """The Node API's answer as it is, every Set-Cookie header included."""
    response = Response(content=body or b"", status_code=int(status_code))
    for key, value in header_pairs:
        if key.lower() in NODE_PROXY_SKIPPED_HEADERS:
            continue
        response.headers.append(key, value)
    return response


def _forward_to_node_api(method, url, headers, body):
    upstream = requests.request(
        method, url, headers=headers, data=body or None, allow_redirects=False, timeout=(3, 60)
    )
    raw_headers = upstream.raw.headers
    pairs = [(key, value) for key in dict.fromkeys(raw_headers.keys()) for value in raw_headers.getlist(key)]
    return upstream.status_code, pairs, upstream.content


async def proxy_to_node_api(request: Request, path: str = ""):
    target = f"{NODE_API_URL}{request.url.path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    headers = build_node_proxy_headers(request.headers, getattr(request.client, "host", ""), request.url.scheme)
    body = await request.body()
    try:
        status_code, pairs, content = await run_in_threadpool(_forward_to_node_api, request.method, target, headers, body)
    except requests.RequestException:
        return JSONResponse(
            status_code=503,
            content={"error": NODE_PROXY_UNAVAILABLE, "retryable": True},
            headers={"Retry-After": "5"},
        )
    return build_node_proxy_response(status_code, pairs, content)


def install_node_dashboard_proxy(target_app):
    """Put the forwarding routes in front of every FastAPI route of the prefixes."""
    for prefix in NODE_PROXY_PREFIXES:
        for route_path in (f"{prefix}/{{path:path}}", prefix):
            target_app.router.routes.insert(
                0, APIRoute(route_path, proxy_to_node_api, methods=NODE_PROXY_METHODS, include_in_schema=False)
            )


if DASHBOARD_BACKEND == "node":
    install_node_dashboard_proxy(app)


_NODE_API_REACHABLE = {"at": 0.0, "value": False}


def node_api_reachable():
    """Whether the Node API answers, cached for ten seconds (health only)."""
    now = time.time()
    if now - _NODE_API_REACHABLE["at"] < 10:
        return _NODE_API_REACHABLE["value"]
    parsed = urlparse(NODE_API_URL)
    try:
        with socket.create_connection((parsed.hostname or "127.0.0.1", parsed.port or 80), timeout=1):
            value = True
    except OSError:
        value = False
    _NODE_API_REACHABLE.update(at=now, value=value)
    return value


def format_runtime_incident(doc):
    """One row of the owner incident list for both schemas in runtime_incidents:
    process incidents (at, source, message) and server incidents (guildId,
    eventKey, timestamp, payload)."""
    doc = doc or {}
    message = doc.get("message") or doc.get("summary")
    if not message and doc.get("eventKey"):
        guild = doc.get("guildName") or doc.get("guildId") or ""
        message = f"{guild}: {doc.get('eventKey')}" if guild else str(doc.get("eventKey"))
    at = doc.get("at") or doc.get("timestamp")
    if isinstance(at, datetime):
        at = (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    runtime = doc.get("runtime") if isinstance(doc.get("runtime"), dict) else {}
    return {
        "at": at,
        "severity": str(doc.get("severity") or doc.get("level") or "info").lower(),
        "source": doc.get("source") or runtime.get("name") or "runtime",
        "message": clip_text(message or "Incident", 240),
        "resolved": bool(doc.get("resolved")) or bool(doc.get("acknowledgedAt")),
    }


def build_affected_servers(nodes, now_ms=None):
    """Servers the owner should look at: parked target, backup station, muted
    bot or a running recovery, the longest-lasting first (#216)."""
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    rows = []
    for node in nodes or []:
        for detail in node.get("guildDetails") or []:
            if not isinstance(detail, dict):
                continue
            if detail.get("parkedReason"):
                state, since = "parked", detail.get("parkedAt")
            elif detail.get("failoverActive") is True:
                state, since = "failover", detail.get("failoverStartedAt")
            elif detail.get("serverMuted") is True:
                state, since = "muted", detail.get("serverMutedAt")
            elif detail.get("recovering") is True:
                state, since = "recovering", 0
            else:
                continue
            since_ms = max(0, parse_int(since, 0))
            rows.append({
                "guildId": str(detail.get("guildId") or detail.get("id") or ""),
                "guildName": clip_text(detail.get("name") or detail.get("guildName") or detail.get("guildId") or "", 120),
                "botName": clip_text(node.get("name") or "OmniFM", 80),
                "state": state,
                "sinceMs": since_ms,
                "durationSec": max(0, (now_ms - since_ms) // 1000) if since_ms else None,
                "stationName": clip_text(detail.get("stationName") or detail.get("stationKey") or "", 120),
                "desiredStationName": clip_text(detail.get("desiredStationName") or detail.get("desiredStationKey") or "", 120),
                "detail": clip_text(detail.get("parkedReason") or detail.get("failoverReason") or "", 200),
                "failbackNextProbeAt": max(0, parse_int(detail.get("failbackNextProbeAt"), 0)),
            })
    rows.sort(key=lambda row: row["sinceMs"] or now_ms)
    return rows


FAILOVER_HISTORY_EVENTS = (
    "stream_failover_activated",
    "stream_failover_exhausted",
    "stream_failback_completed",
    "stream_failback_abandoned",
)


def format_failover_history_row(doc):
    """One switch of the failover history: which server, from which station to
    which, why and how long the backup station played (#217)."""
    doc = doc or {}
    payload = doc.get("payload") if isinstance(doc.get("payload"), dict) else {}
    event = str(doc.get("eventKey") or "")
    previous = payload.get("previousStationName") or payload.get("previousStationKey") or ""
    backup = payload.get("failoverStationName") or payload.get("failoverStationKey") or ""
    restored = payload.get("restoredStationName") or payload.get("restoredStationKey") or ""
    if event == "stream_failback_completed":
        kind, from_name, to_name = "back", previous, restored
    elif event == "stream_failback_abandoned":
        kind, from_name, to_name = "stay", previous, backup
    elif event == "stream_failover_exhausted":
        kind, from_name, to_name = "exhausted", previous, ""
    else:
        kind, from_name, to_name = "switch", previous, backup
    at = doc.get("timestamp") or doc.get("at")
    if isinstance(at, datetime):
        at = (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    duration_ms = parse_int(payload.get("failoverDurationMs"), 0)
    runtime = doc.get("runtime") if isinstance(doc.get("runtime"), dict) else {}
    return {
        "at": at,
        "guildId": str(doc.get("guildId") or ""),
        "guildName": clip_text(doc.get("guildName") or doc.get("guildId") or "", 120),
        "event": event,
        "kind": kind,
        "from": clip_text(from_name, 120),
        "to": clip_text(to_name, 120),
        "reason": clip_text(payload.get("triggerError") or payload.get("reason") or "", 240),
        "durationSec": duration_ms // 1000 if duration_ms > 0 else None,
        "runtime": clip_text(runtime.get("name") or doc.get("source") or "", 80),
    }


def read_runtime_logs(limit=500):
    """Newest log lines of every bot process (capped collection runtime_logs)."""
    if db is None:
        return []
    try:
        rows = list(db.runtime_logs.find({}, {"_id": 0}).sort("$natural", -1).limit(max(1, int(limit))))
    except Exception:
        return []
    return [{
        "at": row.get("at"),
        "level": row.get("level") or "INFO",
        "source": row.get("source") or row.get("process") or "runtime",
        "message": clip_text(row.get("message") or "", 240),
        "process": row.get("process"),
    } for row in rows]


def read_runtime_health_fresh(max_age_sec=30):
    """Liest die echte Runtime-Telemetrie (vom Node-Bot) aus MongoDB, wenn frisch."""
    if db is None:
        return None
    try:
        doc = db.runtime_health.find_one({"_id": "latest"}, {"_id": 0})
    except Exception:
        return None
    if not doc:
        return None
    dt = _parse_iso_dt(doc.get("at"))
    if dt is None:
        return None
    if (datetime.now(timezone.utc) - dt).total_seconds() > max_age_sec:
        return None
    return doc


def live_runtime_totals():
    """Echte Live-Zahlen (0, wenn kein Bot laeuft) – EINE Quelle der Wahrheit."""
    doc = read_runtime_health_fresh()
    if not doc:
        return {"botsOnline": 0, "servers": 0, "users": 0, "voiceConnections": 0, "listeners": 0, "live": False}
    nodes = doc.get("nodes") or []
    online = [n for n in nodes if n.get("status") == "online"]
    guild_ids = {
        str(guild_id)
        for node in online
        for guild_id in (node.get("guildIds") or [])
        if str(guild_id).strip()
    }
    return {
        "botsOnline": len(online),
        "servers": len(guild_ids) if guild_ids else sum(int(n.get("guilds") or 0) for n in online),
        "users": sum(int(n.get("users") or 0) for n in online),
        "voiceConnections": sum(int(n.get("voiceConnections") or 0) for n in online),
        "listeners": sum(int(n.get("listeners") or 0) for n in online),
        "live": True,
    }


# === Dashboard License ===


# === Premium API ===


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


def _read_guild_directory_entries(guild_ids, with_lists=False):
    """Per-server entries the bot writes on change into runtime_guild_directory."""
    if db is None or not guild_ids:
        return {}
    projection = None if with_lists else {"roles": 0, "voiceChannels": 0, "textChannels": 0}
    try:
        rows = db.runtime_guild_directory.find({"_id": {"$in": list(guild_ids)}}, projection)
        return {str(row.get("_id")): row for row in rows}
    except Exception:
        return {}


def _merge_guild_directory_fields(guild, source):
    if not guild["name"] and source.get("name"):
        guild["name"] = source.get("name")
    guild["memberCount"] = max(parse_int(guild.get("memberCount"), 0), parse_int(source.get("memberCount"), 0))
    if not guild["iconUrl"] and source.get("iconUrl"):
        guild["iconUrl"] = source.get("iconUrl")
    for field in ("roles", "voiceChannels", "textChannels"):
        if not guild[field] and isinstance(source.get(field), list):
            guild[field] = source.get(field)


def _runtime_guild_directory(guild_ids=None, with_lists=False):
    """Servers the running bots are in.

    Membership comes from the fresh health document (guildIds per bot). Name,
    member count and icon, and with with_lists also roles and channels, come
    from runtime_guild_directory, which the bot writes only on change (#206).
    An older bot still sends all of it inline in guildDetails; those values
    are used first.
    """
    wanted = None if guild_ids is None else {str(item or "").strip() for item in guild_ids}
    guilds = {}
    live_doc = read_runtime_health_fresh()
    for node in (live_doc or {}).get("nodes", []):
        bot_name = str(node.get("name") or node.get("index") or "Bot")
        inline = {}
        for detail in node.get("guildDetails") or []:
            if isinstance(detail, dict):
                inline[str(detail.get("guildId") or detail.get("id") or "").strip()] = detail
        member_ids = [str(item or "").strip() for item in node.get("guildIds") or []] + list(inline.keys())
        for guild_id in member_ids:
            if not is_valid_server_id(guild_id) or (wanted is not None and guild_id not in wanted):
                continue
            guild = guilds.get(guild_id) or {
                "id": guild_id,
                "name": None,
                "memberCount": 0,
                "iconUrl": None,
                "roles": [],
                "voiceChannels": [],
                "textChannels": [],
                "bots": [],
                "discordUrl": f"https://discord.com/channels/{guild_id}",
            }
            _merge_guild_directory_fields(guild, inline.get(guild_id) or {})
            if bot_name not in guild["bots"]:
                guild["bots"].append(bot_name)
            guilds[guild_id] = guild
    entries = _read_guild_directory_entries(list(guilds.keys()), with_lists=with_lists)
    for guild_id, guild in guilds.items():
        _merge_guild_directory_fields(guild, entries.get(guild_id) or {})
        guild["name"] = str(guild["name"] or guild_id)[:120]
        guild["bots"] = sorted(set(guild["bots"]))
    return guilds


def _normalize_license_server_ids(values):
    raw_values = values if isinstance(values, list) else [values]
    normalized = []
    invalid = []
    for value in raw_values:
        server_id = str(value or "").strip()
        if not server_id:
            continue
        if not is_valid_server_id(server_id):
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

    normalized, invalid = _normalize_license_server_ids(server_ids)
    if invalid:
        raise ValueError(f"Ungültige Discord Guild-ID: {invalid[0]}. Erwartet werden 17–22 Ziffern.")
    seats = max(1, parse_int(license_info.get("seats", 1), 1))
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
    guild_directory = _runtime_guild_directory()
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
        linked_ids = [str(s) for s in linked][:50]
        linked_resolution = {}
        for server_id in linked_ids:
            resolved = get_server_license(server_id)
            linked_resolution[server_id] = {
                "resolved": bool(resolved and resolved.get("active") and not resolved.get("expired") and str(resolved.get("_licenseId") or "") == str(lid)),
                "effectivePlan": (resolved or {}).get("activeTier", "free"),
                "resolutionSource": (resolved or {}).get("resolutionSource"),
            }
        rows.append({
            "licenseKey": str(lid),
            "id": str(lic.get("id") or lid),
            "plan": plan,
            "planName": (TIERS.get(plan) or {}).get("name", plan.title()),
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
                "valid": is_valid_server_id(server_id),
                "memberCount": (guild_directory.get(server_id) or {}).get("memberCount", 0),
                "iconUrl": (guild_directory.get(server_id) or {}).get("iconUrl"),
                "bots": (guild_directory.get(server_id) or {}).get("bots", []),
                "discordUrl": f"https://discord.com/channels/{server_id}" if is_valid_server_id(server_id) else None,
                "licenseResolved": linked_resolution[server_id]["resolved"],
                "effectivePlan": linked_resolution[server_id]["effectivePlan"],
                "resolutionSource": linked_resolution[server_id]["resolutionSource"],
            } for server_id in linked_ids],
        })
    rows.sort(key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    return rows


def _parse_iso_dt(value):
    if not value:
        return None
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def get_bot_directory_config_status(directory, enabled_env, token_env, bot_id_env):
    enabled = config_bool(directory_setting(directory, "enabled", enabled_env, False))
    token = str(directory_setting(directory, "token", token_env) or "").strip()
    bot_id = str(directory_setting(directory, "botId", bot_id_env) or "").strip()
    return {
        "enabled": enabled,
        "configured": enabled and bool(token) and bool(re.match(r"^\d{17,22}$", bot_id)),
        "botId": bot_id or None,
    }


# ------------------------------------------------------------
# Live monitoring: worker health, incidents and log stream. Production only
# returns fresh MongoDB telemetry from the Node runtime. Synthetic values are
# isolated behind the explicit SEED_DEMO_DATA=1 development switch.
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


# Every user-triggered destructive operation is copied into MongoDB before
# the active document is removed. Archive rows are immutable and grouped by
# operationId so even large statistics resets remain below MongoDB's document
# size limit while still being restorable as one operation.
ARCHIVABLE_COLLECTIONS = {
    "licenses",
    "server_entitlements",
    "stations",
    "custom_stations",
    "scheduled_events",
    "command_permissions",
    "daily_stats",
    "listening_sessions",
    "listener_snapshots",
    "guild_stats",
}


def archive_mongo_records(queries, operation, target, request=None, actor="owner", delete=True):
    if db is None:
        raise RuntimeError("MongoDB nicht verbunden.")

    operation_id = f"arc_{secrets.token_urlsafe(18)}"
    archived_at = datetime.now(timezone.utc).isoformat()
    archive_rows = []
    source_rows = []

    for collection_name, query in queries:
        if collection_name not in ARCHIVABLE_COLLECTIONS:
            raise ValueError(f"Collection ist nicht archivierbar: {collection_name}")
        collection = db[collection_name]
        documents = list(collection.find(query))
        source_rows.append((collection_name, collection, documents))
        for document in documents:
            archive_rows.append({
                "recordId": f"rec_{secrets.token_urlsafe(18)}",
                "operationId": operation_id,
                "operation": clip_text(operation, 100),
                "target": clip_text(target, 200),
                "collection": collection_name,
                "originalId": str(document.get("_id") or ""),
                "payload": document,
                "archivedAt": archived_at,
                "archivedBy": clip_text(actor, 120),
                "ip": _client_ip_safe(request) if request is not None else "-",
                "restoredAt": None,
                "restoredBy": None,
            })

    if not archive_rows:
        return {"operationId": None, "archived": 0, "deleted": {name: 0 for name, _, _ in source_rows}}

    # Insert must succeed completely before any active record is removed.
    inserted = db.data_archive.insert_many(archive_rows, ordered=True)
    if len(inserted.inserted_ids) != len(archive_rows):
        raise RuntimeError("Archivierung wurde nicht vollständig bestätigt.")

    deleted_counts = {name: 0 for name, _, _ in source_rows}
    if delete:
        for collection_name, collection, documents in source_rows:
            document_ids = [document.get("_id") for document in documents if document.get("_id") is not None]
            if not document_ids:
                continue
            result = collection.delete_many({"_id": {"$in": document_ids}})
            deleted_counts[collection_name] = result.deleted_count

    return {"operationId": operation_id, "archived": len(archive_rows), "deleted": deleted_counts}


def restore_archived_operation(operation_id, request=None):
    if db is None:
        raise RuntimeError("MongoDB nicht verbunden.")
    operation_id = str(operation_id or "").strip()
    if not re.fullmatch(r"arc_[A-Za-z0-9_-]{12,80}", operation_id):
        raise ValueError("Ungültige Archiv-ID.")

    rows = list(db.data_archive.find({"operationId": operation_id, "restoredAt": None}).sort("archivedAt", 1))
    if not rows:
        existing = db.data_archive.find_one({"operationId": operation_id})
        if existing:
            raise ValueError("Dieser Archivvorgang wurde bereits wiederhergestellt.")
        raise LookupError("Archivvorgang nicht gefunden.")

    conflicts = []
    restore_rows = []
    for row in rows:
        collection_name = str(row.get("collection") or "")
        payload = row.get("payload")
        if collection_name not in ARCHIVABLE_COLLECTIONS or not isinstance(payload, dict) or payload.get("_id") is None:
            raise ValueError("Archiv enthält einen nicht wiederherstellbaren Datensatz.")
        existing = db[collection_name].find_one({"_id": payload.get("_id")})
        if existing is not None and existing != payload:
            conflicts.append(f"{collection_name}:{row.get('originalId') or payload.get('_id')}")
        restore_rows.append((collection_name, payload))

    if conflicts:
        raise ValueError(
            "Wiederherstellung würde neuere aktive Daten überschreiben: " + ", ".join(conflicts[:8])
        )

    restored = 0
    for collection_name, payload in restore_rows:
        db[collection_name].replace_one({"_id": payload.get("_id")}, payload, upsert=True)
        restored += 1

    restored_at = datetime.now(timezone.utc).isoformat()
    db.data_archive.update_many(
        {"operationId": operation_id, "restoredAt": None},
        {"$set": {"restoredAt": restored_at, "restoredBy": "owner", "restoredIp": _client_ip_safe(request)}},
    )
    return {"operationId": operation_id, "restored": restored, "restoredAt": restored_at}


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


# ------------------------------------------------------------
# Cover art / track metadata (keyless via iTunes Search API).
# Used to enrich "Now Playing" and station cards with real
# artwork without requiring any API keys. Server-side + cached.
# ------------------------------------------------------------
_COVER_CACHE = {}
_COVER_CACHE_MAX = 500


# ------------------------------------------------------------
# Route modules (#200). Each gets this module as `core`, so it works whether
# uvicorn loads it as "server" (production, cwd backend/) or "backend.server"
# (tests, CI). Endpoints stay reachable as server.<name> for existing callers.
# ------------------------------------------------------------
def _include_route_modules():
    import importlib

    package = f"{__package__}.routers" if __package__ else "routers"
    core = sys.modules[__name__]
    for name in ("public", "premium", "dashboard", "dashboard_stats", "admin", "admin_licenses"):
        module = importlib.import_module(f"{package}.{name}")
        router = module.build_router(core)
        app.include_router(router)
        for route in router.routes:
            endpoint = getattr(route, "endpoint", None)
            if endpoint is not None:
                globals().setdefault(endpoint.__name__, endpoint)


_include_route_modules()
