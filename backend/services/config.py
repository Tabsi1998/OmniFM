"""Owner configuration, CORS origins, MongoDB reachability and small value helpers.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timezone
from fastapi.responses import JSONResponse
from urllib.parse import urlparse
import json
import os
import time

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def load_recovery_settings():
    try:
        entries = json.loads(core.RECOVERY_SETTINGS_FILE.read_text(encoding="utf-8"))
        return [entry for entry in entries if isinstance(entry, dict) and entry.get("key") and entry.get("env")]
    except Exception:
        return []


def normalize_stream_recovery(values):
    """Owner values of system.streamRecovery, clamped to the bounds the bot
    applies itself. Unknown keys and values that are not numbers are dropped."""
    if not isinstance(values, dict):
        return {}
    normalized = {}
    for entry in core.RECOVERY_SETTINGS:
        raw = values.get(entry["key"])
        if raw in (None, "") or isinstance(raw, bool):
            continue
        try:
            number = int(float(raw))
        except (TypeError, ValueError):
            continue
        normalized[entry["key"]] = max(int(entry["min"]), min(int(entry["max"]), number))
    return normalized


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


def mongo_is_reachable(max_age_seconds=5.0):
    """True when MongoDB answers a ping. The answer is cached briefly so health
    polls do not turn into a ping storm, and a down MongoDB costs at most one
    server-selection timeout per cache window."""
    if core.client is None:
        return False
    now = time.monotonic()
    if (now - core._MONGO_STATUS["checkedAt"]) < max_age_seconds:
        return core._MONGO_STATUS["ok"]
    try:
        core.client.admin.command("ping")
        ok = True
    except Exception:
        ok = False
    core._MONGO_STATUS["checkedAt"] = now
    core._MONGO_STATUS["ok"] = ok
    return ok


def _deep_merge(base, override):
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            core._deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def load_owner_config_raw():
    if core.db is not None:
        try:
            found = core.db.owner_config.find_one({"_id": core.OWNER_CONFIG_ID}) or {}
            found.pop("_id", None)
            return found
        except Exception:
            return {}
    return {}


def get_config_section(name):
    default = core.DEFAULT_OWNER_CONFIG.get(name)
    stored = core.load_owner_config_raw().get(name)
    if isinstance(default, dict):
        merged = json.loads(json.dumps(default))
        if isinstance(stored, dict):
            core._deep_merge(merged, stored)
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
                if k in core.SECRET_CONFIG_FIELDS and (v in ("", None, core.SECRET_MASK) or (isinstance(v, str) and v.startswith("\u2022"))):
                    item[k] = ""
        return item

    if isinstance(incoming, dict) and isinstance(current, dict):
        for key, value in list(incoming.items()):
            if key in core.SECRET_CONFIG_FIELDS and (value in ("", None, core.SECRET_MASK) or (isinstance(value, str) and value.startswith("\u2022"))):
                incoming[key] = current.get(key, "")
            elif isinstance(value, (dict, list)) and key in current:
                incoming[key] = core._merge_config_secrets(current[key], value)
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
                incoming[i] = core._merge_config_secrets(match, item) if isinstance(match, dict) else _blank_new_secrets(item)
        return incoming
    return incoming


def mask_config_secrets(obj):
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if key in core.SECRET_CONFIG_FIELDS and isinstance(value, str) and value:
                out[key] = core.SECRET_MASK
                out[key + "Set"] = True
            elif isinstance(value, (dict, list)):
                out[key] = core.mask_config_secrets(value)
            else:
                out[key] = value
        return out
    if isinstance(obj, list):
        return [core.mask_config_secrets(v) for v in obj]
    return obj


def _strip_secret_markers(obj):
    """Remove API-only `...Set` flags before persisting Owner config."""
    if isinstance(obj, dict):
        return {
            key: core._strip_secret_markers(value)
            for key, value in obj.items()
            if not (key.endswith("Set") and key[:-3] in core.SECRET_CONFIG_FIELDS)
        }
    if isinstance(obj, list):
        return [core._strip_secret_markers(value) for value in obj]
    return obj


def save_config_section(name, data):
    if core.db is None:
        return False
    try:
        data = core._strip_secret_markers(data)
        # Preserve secrets inherited from legacy env files when the first
        # Owner save sends their masked placeholders back to the API.
        if name == "system":
            current = core.effective_system_config()
        elif name == "payments":
            current = core.effective_payments_config()
        else:
            current = core.load_owner_config_raw().get(name)
        if isinstance(data, (dict, list)) and current is not None:
            if isinstance(data, dict) and isinstance(current, dict):
                merged = json.loads(json.dumps(current))
                data = core._deep_merge(merged, data)
            data = core._merge_config_secrets(current, data)
        if name == "system" and isinstance(data, dict) and "streamRecovery" in data:
            data["streamRecovery"] = core.normalize_stream_recovery(data["streamRecovery"])
        core.db.owner_config.update_one({"_id": core.OWNER_CONFIG_ID}, {"$set": {name: data}}, upsert=True)
        return True
    except Exception:
        return False


def system_setting(group, key, env_key=None, default=""):
    stored_group = (((core.load_owner_config_raw().get("system") or {}).get(group)) or {})
    if key in stored_group and stored_group.get(key) not in (None, ""):
        return stored_group.get(key)
    if env_key and os.environ.get(env_key) not in (None, ""):
        return os.environ.get(env_key)
    return default


def directory_setting(directory, key, env_key=None, default=""):
    stored = (((((core.load_owner_config_raw().get("system") or {}).get("botDirectories")) or {}).get(directory)) or {})
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
    config = core.get_config_section("system")
    stored = core.load_owner_config_raw().get("system") or {}
    mappings = {
        "discordOAuth": {
            "clientId": ("DISCORD_CLIENT_ID", str),
            "clientSecret": ("DISCORD_CLIENT_SECRET", str),
            "redirectUri": ("DISCORD_REDIRECT_URI", str),
            "scopes": ("DISCORD_OAUTH_SCOPES", str),
        },
        "smtp": {
            "host": ("SMTP_HOST", str), "port": ("SMTP_PORT", int),
            "secure": ("SMTP_SECURE", core.config_bool), "user": ("SMTP_USER", str),
            "password": ("SMTP_PASS", str), "from": ("SMTP_FROM", str),
        },
        "audioRecognition": {
            "enabled": ("NOW_PLAYING_RECOGNITION_ENABLED", core.config_bool),
            "apiKey": ("ACOUSTID_API_KEY", str),
        },
        "songHistory": {
            "enabled": ("SONG_HISTORY_ENABLED", core.config_bool),
            "maxPerGuild": ("SONG_HISTORY_MAX_PER_GUILD", int),
        },
        "stationHealth": {
            "enabled": ("STATION_HEALTH_ENABLED", core.config_bool),
            "intervalMs": ("STATION_HEALTH_INTERVAL_MS", int),
            "batchSize": ("STATION_HEALTH_BATCH_SIZE", int),
            "concurrency": ("STATION_HEALTH_CONCURRENCY", int),
            "timeoutMs": ("STATION_HEALTH_TIMEOUT_MS", int),
        },
        "streamRecovery": {entry["key"]: (entry["env"], int) for entry in core.RECOVERY_SETTINGS},
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
            "enabled": ("DISCORDBOTLIST_ENABLED", core.config_bool), "token": ("DISCORDBOTLIST_TOKEN", str),
            "botId": ("DISCORDBOTLIST_BOT_ID", str), "slug": ("DISCORDBOTLIST_SLUG", str),
            "webhookSecret": ("DISCORDBOTLIST_WEBHOOK_SECRET", str), "statsScope": ("DISCORDBOTLIST_STATS_SCOPE", str),
        },
        "botsGG": {
            "enabled": ("BOTSGG_ENABLED", core.config_bool), "token": ("BOTSGG_TOKEN", str),
            "botId": ("BOTSGG_BOT_ID", str), "statsScope": ("BOTSGG_STATS_SCOPE", str),
        },
        "topGG": {
            "enabled": ("TOPGG_ENABLED", core.config_bool), "token": ("TOPGG_TOKEN", str),
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
    config = core.get_config_section("payments")
    stored_stripe = ((core.load_owner_config_raw().get("payments") or {}).get("stripe") or {})
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
    return bool(core.EMAIL_REGEX.match(str(email or "").strip()))


def is_valid_server_id(server_id):
    return bool(core.SERVER_ID_REGEX.match(str(server_id or "").strip()))


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
    closest = min(core.DURATION_OPTIONS, key=lambda x: abs(x - parsed))
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


def parse_iso_datetime(raw_value):
    value = str(raw_value or "").strip()
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


__all__ = [
    "load_recovery_settings",
    "normalize_stream_recovery",
    "build_allowed_origins",
    "mongo_is_reachable",
    "_deep_merge",
    "load_owner_config_raw",
    "get_config_section",
    "_merge_config_secrets",
    "mask_config_secrets",
    "_strip_secret_markers",
    "save_config_section",
    "system_setting",
    "directory_setting",
    "config_bool",
    "effective_system_config",
    "effective_payments_config",
    "json_error",
    "parse_int",
    "is_valid_email",
    "is_valid_server_id",
    "normalize_months",
    "normalize_duration",
    "mask_email",
    "clip_text",
    "_parse_iso_dt",
    "parse_iso_datetime",
]
