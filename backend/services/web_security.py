"""Request safety: private hosts, custom station URLs, client address, rate limits,
owner token and checkout return origins.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from urllib.parse import urlparse
import hmac
import ipaddress
import os
import re
import socket
import time

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


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

    legacy_ipv4 = core.legacy_host_to_ipv4(hostname)
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
    if core.is_private_or_local_host(parsed.hostname):
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
        if address and core.is_private_or_local_host(address):
            return {"ok": False, "error": "Lokale/private Hosts sind nicht erlaubt."}

    return {"ok": True, "url": value}


def first_header_value(raw_value):
    value = str(raw_value or "").strip()
    if not value:
        return ""
    first = value.split(",")[0].strip()
    return first


def get_client_ip(request: Request):
    if core.TRUST_PROXY_HEADERS:
        forwarded = core.first_header_value(request.headers.get("x-forwarded-for"))
        if forwarded:
            return forwarded
        real_ip = core.first_header_value(request.headers.get("x-real-ip"))
        if real_ip:
            return real_ip
    client_host = getattr(request.client, "host", None)
    return str(client_host or "unknown")


def get_api_rate_limit_spec(scope):
    normalized_scope = str(scope or "read").strip().lower()
    if normalized_scope == "write":
        window_ms = core.parse_int(os.environ.get("API_RATE_WRITE_WINDOW_MS"), 60000)
        max_requests = core.parse_int(os.environ.get("API_RATE_WRITE_MAX"), 20)
    else:
        window_ms = core.parse_int(os.environ.get("API_RATE_READ_WINDOW_MS"), 60000)
        max_requests = core.parse_int(os.environ.get("API_RATE_READ_MAX"), 120)

    return {
        "scope": "write" if normalized_scope == "write" else "read",
        "window_ms": max(1000, window_ms),
        "max_requests": max(1, max_requests),
    }


def cleanup_api_rate_limit_state(now_ms=None):
    now = int(now_ms if now_ms is not None else (time.time() * 1000))
    if len(core.API_RATE_LIMIT_STATE) < 10000 and len(core.API_RATE_LIMIT_STATE) <= core.MAX_API_RATE_STATE_ENTRIES:
        return

    expired_keys = [key for key, value in core.API_RATE_LIMIT_STATE.items() if not value or int(value.get("reset_at", 0)) <= now]
    for key in expired_keys:
        core.API_RATE_LIMIT_STATE.pop(key, None)

    if len(core.API_RATE_LIMIT_STATE) > core.MAX_API_RATE_STATE_ENTRIES:
        sorted_entries = sorted(core.API_RATE_LIMIT_STATE.items(), key=lambda entry: int(entry[1].get("reset_at", 0)))
        remove_count = len(core.API_RATE_LIMIT_STATE) - core.MAX_API_RATE_STATE_ENTRIES
        for key, _ in sorted_entries[:remove_count]:
            core.API_RATE_LIMIT_STATE.pop(key, None)


def enforce_api_rate_limit(request: Request, scope):
    spec = core.get_api_rate_limit_spec(scope)
    now = int(time.time() * 1000)
    core.cleanup_api_rate_limit_state(now)

    ip = core.get_client_ip(request)
    key = f"{spec['scope']}:{request.method}:{request.url.path}:{ip}"
    entry = core.API_RATE_LIMIT_STATE.get(key)
    if not entry or int(entry.get("reset_at", 0)) <= now:
        entry = {"count": 0, "reset_at": now + spec["window_ms"]}

    entry["count"] = int(entry.get("count", 0)) + 1
    core.API_RATE_LIMIT_STATE[key] = entry

    if entry["count"] > spec["max_requests"]:
        retry_after_seconds = max(1, int((entry["reset_at"] - now + 999) // 1000))
        return JSONResponse(
            status_code=429,
            content={"error": "Rate limit erreicht. Bitte spaeter erneut versuchen.", "retryAfterSeconds": retry_after_seconds},
            headers={"Retry-After": str(retry_after_seconds)},
        )

    return None


def is_admin_request(request: Request):
    if not core.ADMIN_API_TOKEN:
        return False
    header_token = (request.headers.get("x-admin-token") or "").strip()
    if header_token and hmac.compare_digest(header_token, core.ADMIN_API_TOKEN):
        return True
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        bearer = auth[7:].strip()
        if bearer and hmac.compare_digest(bearer, core.ADMIN_API_TOKEN):
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
        normalized = core.parse_origin(origin)
        if normalized:
            allowed.add(normalized)
    return allowed


def resolve_checkout_return_base(return_url):
    fallback = core.parse_origin((os.environ.get("PUBLIC_WEB_URL") or "").strip()) or "http://localhost"
    if not return_url:
        return fallback

    parsed = urlparse(str(return_url).strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return fallback

    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in core.build_allowed_return_origins():
        return fallback

    safe_path = parsed.path if parsed.path and parsed.path != "/" else ""
    return f"{origin}{safe_path}"


def _admin_guard(request: Request):
    if not core.ADMIN_API_TOKEN:
        return core.json_error(503, "Owner-API ist nicht konfiguriert (API_ADMIN_TOKEN fehlt).")
    if not core.is_admin_request(request):
        return core.json_error(401, "Nicht autorisiert. Gueltiger Owner-Token erforderlich.")
    return None


def _client_ip_safe(request):
    try:
        return core.get_client_ip(request)
    except Exception:
        return "-"


__all__ = [
    "legacy_host_to_ipv4",
    "is_private_or_local_host",
    "validate_custom_station_url",
    "first_header_value",
    "get_client_ip",
    "get_api_rate_limit_spec",
    "cleanup_api_rate_limit_state",
    "enforce_api_rate_limit",
    "is_admin_request",
    "parse_origin",
    "build_allowed_return_origins",
    "resolve_checkout_return_base",
    "_admin_guard",
    "_client_ip_safe",
]
