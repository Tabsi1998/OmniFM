"""Dashboard login: Discord OAuth, sessions, OAuth states and the guilds of a session.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timezone
from fastapi import Request
from urllib.parse import urlencode
from urllib.parse import urlparse
import os
import requests
import time

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def is_discord_oauth_configured():
    return bool(
        core.system_setting("discordOAuth", "clientId", "DISCORD_CLIENT_ID")
        and core.system_setting("discordOAuth", "clientSecret", "DISCORD_CLIENT_SECRET")
        and core.system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI")
    )


def get_frontend_base_url(request: Request):
    configured = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    parsed_config = urlparse(configured)
    if parsed_config.scheme in ("http", "https") and parsed_config.netloc:
        return f"{parsed_config.scheme}://{parsed_config.netloc}"

    from_redirect = urlparse(str(core.system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI")))
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
    for state_key, payload in core.DISCORD_OAUTH_STATE_STORE.items():
        expires_at = int(payload.get("expiresAt", 0) or 0)
        if expires_at <= now_value:
            expired.append(state_key)
    for state_key in expired:
        core.DISCORD_OAUTH_STATE_STORE.pop(state_key, None)
    if core.db is not None:
        try:
            core.db.oauth_states.delete_many({"expiresAt": {"$lte": now_value}})
        except Exception:
            pass


def clean_expired_dashboard_sessions(now_ts=None):
    now_value = int(now_ts if now_ts is not None else time.time())
    expired = []
    for session_key, payload in core.DASHBOARD_SESSION_STORE.items():
        expires_at = int(payload.get("expiresAt", 0) or 0)
        if expires_at <= now_value:
            expired.append(session_key)
    for session_key in expired:
        core.DASHBOARD_SESSION_STORE.pop(session_key, None)
    if core.db is not None:
        try:
            core.db.dashboard_sessions.delete_many({"expiresAt": {"$lte": now_value}})
        except Exception:
            pass


def store_ephemeral(collection_name, key, payload, memory_store):
    memory_store[key] = payload
    if core.db is not None:
        try:
            expires_at = int(payload.get("expiresAt") or 0)
            document = {"_id": key, **payload, "expiresAtDate": datetime.fromtimestamp(expires_at, timezone.utc)}
            collection = core.db[collection_name]
            collection.create_index("expiresAtDate", expireAfterSeconds=0)
            collection.replace_one({"_id": key}, document, upsert=True)
        except Exception:
            pass


def get_ephemeral(collection_name, key, memory_store, consume=False):
    payload = memory_store.pop(key, None) if consume else memory_store.get(key)
    if core.db is not None:
        try:
            collection = core.db[collection_name]
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
    if core.db is not None:
        try:
            core.db[collection_name].delete_one({"_id": key})
        except Exception:
            pass


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
    cookie_token = (request.cookies.get(core.SESSION_COOKIE_NAME) or "").strip()
    if cookie_token:
        return cookie_token
    header_token = (request.headers.get("x-session-token") or "").strip()
    if header_token:
        return header_token
    return ""


def get_dashboard_session(request: Request):
    core.clean_expired_dashboard_sessions()
    token = core.resolve_session_token_from_request(request)
    if not token:
        return None, ""
    session = core.get_ephemeral("dashboard_sessions", token, core.DASHBOARD_SESSION_STORE)
    if not isinstance(session, dict):
        return None, token
    return session, token


def resolve_dashboard_guilds_for_session(session_payload):
    guilds = session_payload.get("guilds") if isinstance(session_payload.get("guilds"), list) else []
    runtime_guilds = core._runtime_guild_directory(
        [str(item.get("id") or "").strip() for item in guilds if isinstance(item, dict)]
    )
    output = []
    for item in guilds:
        if not isinstance(item, dict):
            continue
        guild_id = str(item.get("id") or "").strip()
        if not core.is_valid_server_id(guild_id):
            continue
        if not core.has_manage_guild_permission(item.get("permissions", "0")):
            continue
        tier = core.get_tier(guild_id)
        runtime_guild = runtime_guilds.get(guild_id) or {}
        output.append({
            "id": guild_id,
            "name": core.clip_text(item.get("name") or guild_id, 120),
            "icon": core.clip_text(item.get("icon") or "", 120),
            "owner": bool(item.get("owner", False)),
            "permissions": str(item.get("permissions") or "0"),
            "tier": tier,
            "memberCount": max(0, core.parse_int(runtime_guild.get("memberCount"), 0)),
            "iconUrl": runtime_guild.get("iconUrl"),
            "dashboardEnabled": (core.TIER_RANK.get(tier, 0) >= core.TIER_RANK.get("pro", 1)),
            "ultimateEnabled": tier == "ultimate",
        })
    output.sort(key=lambda row: row.get("name", "").lower())
    return output


def resolve_session_guild_for_server(session_payload, server_id):
    normalized = str(server_id or "").strip()
    if not core.is_valid_server_id(normalized):
        return None
    for guild in core.resolve_dashboard_guilds_for_session(session_payload):
        if guild.get("id") == normalized:
            return guild
    return None


def build_discord_authorize_url(state, prompt="consent"):
    params = {
        "client_id": core.system_setting("discordOAuth", "clientId", "DISCORD_CLIENT_ID"),
        "response_type": "code",
        "redirect_uri": core.system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI"),
        "scope": core.system_setting("discordOAuth", "scopes", "DISCORD_OAUTH_SCOPES", "identify guilds"),
        "state": state,
        "prompt": prompt,
    }
    return f"https://discord.com/api/oauth2/authorize?{urlencode(params)}"


def exchange_discord_code_for_token(code):
    response = requests.post(
        "https://discord.com/api/oauth2/token",
        data={
            "client_id": core.system_setting("discordOAuth", "clientId", "DISCORD_CLIENT_ID"),
            "client_secret": core.system_setting("discordOAuth", "clientSecret", "DISCORD_CLIENT_SECRET"),
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": core.system_setting("discordOAuth", "redirectUri", "DISCORD_REDIRECT_URI"),
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
        "username": core.clip_text(payload.get("username") or "Discord User", 80),
        "globalName": core.clip_text(payload.get("global_name") or "", 80),
        "avatar": core.clip_text(payload.get("avatar") or "", 120),
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
                "name": core.clip_text(item.get("name") or "Guild", 120),
                "icon": core.clip_text(item.get("icon") or "", 120),
                "owner": bool(item.get("owner", False)),
                "permissions": str(item.get("permissions") or "0"),
            })
    return output


__all__ = [
    "is_discord_oauth_configured",
    "get_frontend_base_url",
    "clean_expired_oauth_states",
    "clean_expired_dashboard_sessions",
    "store_ephemeral",
    "get_ephemeral",
    "delete_ephemeral",
    "has_manage_guild_permission",
    "resolve_session_token_from_request",
    "get_dashboard_session",
    "resolve_dashboard_guilds_for_session",
    "resolve_session_guild_for_server",
    "build_discord_authorize_url",
    "exchange_discord_code_for_token",
    "fetch_discord_user_profile",
    "fetch_discord_user_guilds",
]
