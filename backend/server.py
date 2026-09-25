"""Production FastAPI backend for the OmniFM website and Owner Console.

The public API is served below ``/api`` on port 8001. The Node.js code in
``src/`` is the Discord voice runtime and intentionally runs separately.
"""

import os
import sys
import re
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient


load_dotenv()

# ------------------------------------------------------------
# Helper modules (#200). Loaded before any other code of this module runs, so
# every helper is available as server.<name> exactly as when it lived here.
# Each module reads the names of this module as core.<name> at call time.
# ------------------------------------------------------------
SERVICE_MODULES = (
    "config",
    "web_security",
    "dashboard_auth",
    "dashboard_data",
    "legal",
    "premium_state",
    "licenses",
    "catalog",
    "monitoring",
    "owner_audit",
)


def _load_service_modules():
    import importlib

    package = f"{__package__}.services" if __package__ else "services"
    core = sys.modules[__name__]
    for name in SERVICE_MODULES:
        module = importlib.import_module(f"{package}.{name}")
        module.bind(core)
        for export in module.__all__:
            globals()[export] = getattr(module, export)


_load_service_modules()

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


RECOVERY_SETTINGS = load_recovery_settings()


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


ALLOWED_ORIGINS = build_allowed_origins()
CORS_HAS_WILDCARD = "*" in ALLOWED_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_HAS_WILDCARD else ALLOWED_ORIGINS,
    allow_credentials=not CORS_HAS_WILDCARD,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token"],
)


API_CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'"


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Cache-Control", "no-store" if request.url.path.startswith("/api/admin/") else "no-cache")
    if request.url.path.startswith("/api/"):
        # The API answers with JSON and redirects only; nothing may load or
        # frame it. Responses forwarded from the Node API keep its own policy.
        response.headers.setdefault("Content-Security-Policy", API_CONTENT_SECURITY_POLICY)
    forwarded_proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").split(",")[0].strip()
    if forwarded_proto.lower() == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
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
SECRET_CONFIG_FIELDS = {"token", "secretKey", "webhookSecret", "secret", "clientSecret", "password", "apiKey", "webhookUrl"}

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
        # Discord webhook for operator alerts (#260). The URL carries a token,
        # so it is a secret like a password.
        "operatorAlerts": {
            "webhookUrl": "", "mention": "",
            "workerOffline": True, "failoverExhausted": True, "playbackLoops": True,
            "workerAutoheal": True, "diskSpace": True, "backupFailed": True, "updates": True,
        },
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


MONTHLY_EVENT_REPEAT_NTH = {
    "monthly_first_weekday": 1,
    "monthly_second_weekday": 2,
    "monthly_third_weekday": 3,
    "monthly_fourth_weekday": 4,
    "monthly_last_weekday": -1,
}


seed_stations_if_empty()
fill_station_catalog_fields()


if seed_demo_enabled():
    seed_premium_if_needed()


purge_demo_data_if_live()


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


if DASHBOARD_BACKEND == "node":
    install_node_dashboard_proxy(app)


_NODE_API_REACHABLE = {"at": 0.0, "value": False}


FAILOVER_HISTORY_EVENTS = (
    "stream_failover_activated",
    "stream_failover_exhausted",
    "stream_failback_completed",
    "stream_failback_abandoned",
)


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


# ------------------------------------------------------------
# Owner audit log + full station management (replaces CLI config).
# Every owner write action (station create/update/delete, stream
# test) is persisted to the `owner_audit` collection / file.
# ------------------------------------------------------------
OWNER_AUDIT_FILE = Path(__file__).parent.parent / "data" / "owner-audit.json"
VALID_TIERS = {"free", "pro", "ultimate"}
STATION_KEY_REGEX = re.compile(r"^[a-z0-9][a-z0-9._-]{1,48}$")


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
    for name in ("public", "premium", "dashboard", "dashboard_stats", "admin", "admin_stations", "admin_licenses"):
        module = importlib.import_module(f"{package}.{name}")
        router = module.build_router(core)
        app.include_router(router)
        for route in router.routes:
            endpoint = getattr(route, "endpoint", None)
            if endpoint is not None:
                globals().setdefault(endpoint.__name__, endpoint)


_include_route_modules()
