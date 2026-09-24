"""Dashboard (FastAPI fallback when OMNIFM_DASHBOARD_BACKEND is not "node"): Discord login, session, guilds, settings, channels, roles, stations, permissions, license.

Moved out of server.py unchanged (#200). server.py calls build_router(core)
with itself; names defined in server.py are read as core.<name> at call
time, so tests that patch server.db still reach these routes.
"""
from fastapi import APIRouter
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.responses import RedirectResponse
import os
import re
import requests
import secrets
import time


def build_router(core):
    router = APIRouter()

    @router.get("/api/auth/discord/login")
    async def auth_discord_login(request: Request, nextPage: str = "dashboard", redirect: bool = False):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited

        if not core.is_discord_oauth_configured():
            return JSONResponse(
                status_code=503,
                content={
                    "error": "Discord OAuth ist noch nicht konfiguriert.",
                    "oauthConfigured": False,
                },
            )

        core.clean_expired_oauth_states()
        state_token = secrets.token_urlsafe(24)
        core.store_ephemeral("oauth_states", state_token, {
            "nextPage": core.clip_text(nextPage or "dashboard", 40),
            "createdAt": int(time.time()),
            "expiresAt": int(time.time()) + core.DISCORD_OAUTH_STATE_TTL_SECONDS,
            "origin": core.get_frontend_base_url(request),
        }, core.DISCORD_OAUTH_STATE_STORE)
        auth_url = core.build_discord_authorize_url(state_token)
        # A normal browser navigation must continue to Discord. Programmatic callers
        # keep the JSON contract used by the SPA and API tests.
        accepts_html = "text/html" in str(request.headers.get("accept") or "").lower()
        if redirect or accepts_html:
            return RedirectResponse(url=auth_url, status_code=302)
        return {
            "oauthConfigured": True,
            "authUrl": auth_url,
            "state": state_token,
        }

    @router.get("/api/auth/discord/callback")
    async def auth_discord_callback(request: Request, code: str = "", state: str = ""):
        frontend_base = core.get_frontend_base_url(request)

        def build_error_redirect(error_code):
            target = f"{frontend_base}/?page=dashboard&authError={error_code}"
            return RedirectResponse(url=target, status_code=302)

        if not core.is_discord_oauth_configured():
            return build_error_redirect("oauth_not_configured")

        core.clean_expired_oauth_states()
        state_payload = core.get_ephemeral("oauth_states", str(state or "").strip(), core.DISCORD_OAUTH_STATE_STORE, consume=True)
        if not state_payload:
            return build_error_redirect("invalid_state")
        if not str(code or "").strip():
            return build_error_redirect("missing_code")

        try:
            access_token = core.exchange_discord_code_for_token(code)
            user_profile = core.fetch_discord_user_profile(access_token)
            guilds = core.fetch_discord_user_guilds(access_token)
        except Exception:
            return build_error_redirect("oauth_exchange_failed")

        core.clean_expired_dashboard_sessions()
        session_token = secrets.token_urlsafe(32)
        core.store_ephemeral("dashboard_sessions", session_token, {
            "user": user_profile,
            "guilds": guilds,
            "createdAt": int(time.time()),
            "expiresAt": int(time.time()) + core.DASHBOARD_SESSION_TTL_SECONDS,
        }, core.DASHBOARD_SESSION_STORE)

        next_page = str(state_payload.get("nextPage") or "dashboard").strip().lower()
        if next_page not in ("dashboard", "home"):
            next_page = "dashboard"
        target = f"{frontend_base}/?page={next_page}"
        response = RedirectResponse(url=target, status_code=302)
        response.set_cookie(
            key=core.SESSION_COOKIE_NAME,
            value=session_token,
            max_age=core.DASHBOARD_SESSION_TTL_SECONDS,
            httponly=True,
            secure=True,
            samesite="lax",
            path="/",
        )
        return response

    @router.get("/api/auth/session")
    async def auth_session(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited

        session, _ = core.get_dashboard_session(request)
        if not session:
            return {
                "authenticated": False,
                "oauthConfigured": core.is_discord_oauth_configured(),
                "user": None,
                "guilds": [],
            }

        guilds = core.resolve_dashboard_guilds_for_session(session)
        return {
            "authenticated": True,
            "oauthConfigured": core.is_discord_oauth_configured(),
            "user": session.get("user", {}),
            "guilds": guilds,
            "expiresAt": session.get("expiresAt"),
        }

    @router.post("/api/auth/logout")
    async def auth_logout(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited

        _, token = core.get_dashboard_session(request)
        if token:
            core.delete_ephemeral("dashboard_sessions", token, core.DASHBOARD_SESSION_STORE)

        response = JSONResponse(status_code=200, content={"success": True})
        response.delete_cookie(core.SESSION_COOKIE_NAME, path="/")
        return response

    @router.get("/api/dashboard/guilds")
    async def dashboard_guilds(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        return {"guilds": core.resolve_dashboard_guilds_for_session(session)}

    @router.get("/api/dashboard/settings")
    async def dashboard_settings_get(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")

        gid = guild.get("id", "")
        settings = {}
        if core.db is not None:
            try:
                settings = core.db.guild_settings.find_one({"guildId": gid}, {"_id": 0}) or {}
            except Exception:
                pass
        return {
            "guildId": gid,
            "tier": guild.get("tier", "free"),
            "weeklyDigest": settings.get("weeklyDigest", {"enabled": False, "channelId": "", "dayOfWeek": 1, "hour": 9, "language": "de"}),
            "fallbackStation": settings.get("fallbackStation", ""),
        }

    @router.put("/api/dashboard/settings")
    async def dashboard_settings_put(request: Request, body: dict, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")

        gid = guild.get("id", "")
        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")

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
                return core.json_error(403, "Fallback-Station ist nur fuer Ultimate verfuegbar.")
            updates["fallbackStation"] = str(fs or "").strip().lower()[:120]

        try:
            core.db.guild_settings.update_one({"guildId": gid}, {"$set": updates}, upsert=True)
        except Exception as e:
            return core.json_error(500, f"Fehler: {str(e)}")
        return {"success": True, **updates}

    @router.get("/api/dashboard/channels")
    async def dashboard_channels(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")
        runtime_guild = core._runtime_guild_directory([guild.get("id")], with_lists=True).get(guild.get("id")) or {}
        return {
            "voiceChannels": runtime_guild.get("voiceChannels", []),
            "textChannels": runtime_guild.get("textChannels", []),
        }

    @router.get("/api/dashboard/roles")
    async def dashboard_roles(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")
        runtime_guild = core._runtime_guild_directory([guild.get("id")], with_lists=True).get(guild.get("id")) or {}
        return {"roles": runtime_guild.get("roles", [])}

    @router.get("/api/dashboard/stations")
    async def dashboard_stations_all(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")

        gid = guild.get("id", "")
        tier = guild.get("tier", "free")
        file_data = core.load_stations_from_file()
        all_stations = file_data.get("stations", {})

        free_list, pro_list = [], []
        for key, val in all_stations.items():
            if key.startswith("custom:"):
                continue
            st_tier = (val.get("tier", "free") or "free").lower()
            entry = {"key": key, "name": val.get("name", key), "url": val.get("url", ""), "genre": val.get("genre", ""), "country": val.get("country", ""), "tier": st_tier}
            if st_tier == "free":
                free_list.append(entry)
            elif st_tier == "pro" and tier in ("pro", "ultimate"):
                pro_list.append(entry)
        free_list.sort(key=lambda s: s["name"])
        pro_list.sort(key=lambda s: s["name"])

        custom_list = []
        if core.db is not None and tier == "ultimate":
            try:
                for doc in core.db.custom_stations.find({"guildId": gid}, {"_id": 0}):
                    custom_list.append({"key": doc.get("key", ""), "name": doc.get("name", ""), "url": doc.get("url", ""), "genre": doc.get("genre", ""), "custom": True})
            except Exception:
                pass

        return {"free": free_list, "pro": pro_list, "custom": custom_list, "tier": tier}

    @router.get("/api/dashboard/custom-stations")
    async def dashboard_custom_stations_get(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff.")

        gid = guild.get("id", "")
        tier = guild.get("tier", "free")
        stations = []
        if core.db is not None:
            try:
                for doc in core.db.custom_stations.find({"guildId": gid}, {"_id": 0}):
                    stations.append({"key": doc.get("key", ""), "name": doc.get("name", ""), "url": doc.get("url", ""), "genre": doc.get("genre", "")})
            except Exception:
                pass
        stations.sort(key=lambda s: s.get("name", ""))
        return {"stations": stations, "tier": tier}

    @router.post("/api/dashboard/custom-stations")
    async def dashboard_custom_stations_create(request: Request, body: dict, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff.")
        if guild.get("tier") != "ultimate":
            return core.json_error(403, "Custom Stations sind nur für Ultimate verfügbar.")

        gid = guild.get("id", "")
        key = re.sub(r"[^a-z0-9_-]", "", str(body.get("key", "")).strip().lower()[:80])
        name = str(body.get("name", "")).strip()[:120]
        url = str(body.get("url", "")).strip()[:500]
        genre = str(body.get("genre", "")).strip()[:80]
        if not key or not name or not url:
            return core.json_error(400, "Key, Name und URL sind erforderlich.")

        validation = core.validate_custom_station_url(url)
        if not validation.get("ok"):
            return core.json_error(400, validation.get("error") or "URL-Format ungültig.")
        url = validation["url"]

        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")

        count = core.db.custom_stations.count_documents({"guildId": gid})
        if count >= 50:
            return core.json_error(400, "Maximale Anzahl von 50 Custom Stations erreicht.")

        existing = core.db.custom_stations.find_one({"guildId": gid, "key": key})
        if existing:
            return core.json_error(400, f"Station mit Key '{key}' existiert bereits.")

        core.db.custom_stations.insert_one({"guildId": gid, "key": key, "name": name, "url": url, "genre": genre})
        return {"success": True, "station": {"key": key, "name": name, "url": url, "genre": genre}}

    @router.put("/api/dashboard/custom-stations")
    async def dashboard_custom_stations_update(request: Request, body: dict, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff.")
        if guild.get("tier") != "ultimate":
            return core.json_error(403, "Custom Stations sind nur für Ultimate verfügbar.")

        gid = guild.get("id", "")
        key = re.sub(r"[^a-z0-9_-]", "", str(body.get("key", "")).strip().lower()[:80])
        if not key:
            return core.json_error(400, "Station-Key fehlt.")

        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")

        existing = core.db.custom_stations.find_one({"guildId": gid, "key": key})
        if not existing:
            return core.json_error(404, "Station nicht gefunden.")

        updates = {}
        if body.get("name"):
            updates["name"] = str(body["name"]).strip()[:120]
        next_url = str(body.get("url", existing.get("url", ""))).strip()[:500]
        validation = core.validate_custom_station_url(next_url)
        if not validation.get("ok"):
            return core.json_error(400, validation.get("error") or "URL-Format ungültig.")
        if body.get("url"):
            updates["url"] = validation["url"]
        if "genre" in body:
            updates["genre"] = str(body["genre"]).strip()[:80]

        if updates:
            core.db.custom_stations.update_one({"guildId": gid, "key": key}, {"$set": updates})

        return {
            "success": True,
            "station": {
                "key": key,
                "name": updates.get("name", existing.get("name", "")),
                "url": updates.get("url", existing.get("url", "")),
                "genre": updates.get("genre", existing.get("genre", "")),
            },
        }

    @router.delete("/api/dashboard/custom-stations")
    async def dashboard_custom_stations_delete(request: Request, serverId: str = "", key: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff.")

        if not key:
            return core.json_error(400, "Station-Key fehlt.")

        gid = guild.get("id", "")
        if core.db is not None:
            try:
                archived = core.archive_mongo_records(
                    [("custom_stations", {"guildId": gid, "key": key})],
                    operation="dashboard.custom_station.delete",
                    target=f"{gid}:{key}",
                    request=request,
                    actor="dashboard",
                    delete=True,
                )
            except Exception as exc:
                return core.json_error(500, f"Station konnte nicht sicher archiviert werden: {core.clip_text(exc)}")
            deleted = int((archived.get("deleted") or {}).get("custom_stations") or 0)
            return {"success": deleted > 0, "key": key, "archiveId": archived.get("operationId")}
        return {"success": False, "key": key}

    @router.get("/api/dashboard/perms")
    async def dashboard_perms_get(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")

        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")
        if core.TIER_RANK.get(guild.get("tier", "free"), 0) < core.TIER_RANK.get("pro", 1):
            return core.json_error(403, "Berechtigungen sind erst ab Pro verfuegbar.")

        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        guild_id = guild.get("id")
        document = core.db.command_permissions.find_one({"_guildId": guild_id}, {"_id": 0})
        if not document:
            data = core.load_dashboard_data()
            legacy_map = data.get("perms", {}) if isinstance(data.get("perms"), dict) else {}
            legacy = core.normalize_dashboard_perms(legacy_map.get(guild_id) or {})
            if legacy.get("commands"):
                document = {"_guildId": guild_id, "guildId": guild_id, "commands": legacy["commands"], "updatedAt": legacy["updatedAt"]}
                core.db.command_permissions.replace_one({"_guildId": guild_id}, document, upsert=True)
        payload = core.dashboard_permission_response(document or {})
        return {
            "serverId": guild_id,
            "tier": guild.get("tier"),
            "commandRoleMap": payload.get("commandRoleMap", {}),
            "updatedAt": payload.get("updatedAt"),
        }

    @router.put("/api/dashboard/perms")
    async def dashboard_perms_put(request: Request, body: dict, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")

        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")
        if core.TIER_RANK.get(guild.get("tier", "free"), 0) < core.TIER_RANK.get("pro", 1):
            return core.json_error(403, "Berechtigungen sind erst ab Pro verfuegbar.")

        normalized = core.normalize_dashboard_perms(body)
        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        guild_id = guild.get("id")
        directory = core._runtime_guild_directory([guild_id], with_lists=True).get(guild_id) or {}
        known_role_ids = {str(role.get("id") or "") for role in directory.get("roles") or []}
        requested_role_ids = {
            role_id
            for role_ids in normalized.get("commandRoleMap", {}).values()
            for role_id in role_ids
        }
        if known_role_ids and not requested_role_ids.issubset(known_role_ids):
            return core.json_error(400, "Mindestens eine Rolle gehört nicht zu diesem Server.")
        document = {
            "_guildId": guild_id,
            "guildId": guild_id,
            "commands": normalized.get("commands", {}),
            "updatedAt": normalized.get("updatedAt"),
        }
        if document["commands"]:
            core.db.command_permissions.replace_one({"_guildId": guild_id}, document, upsert=True)
        else:
            try:
                core.archive_mongo_records(
                    [("command_permissions", {"_guildId": guild_id})],
                    operation="dashboard.permissions.reset",
                    target=guild_id,
                    request=request,
                    actor="dashboard",
                    delete=True,
                )
            except Exception as exc:
                return core.json_error(500, f"Berechtigungen konnten nicht sicher archiviert werden: {core.clip_text(exc)}")
        return {
            "success": True,
            "serverId": guild_id,
            "commandRoleMap": normalized.get("commandRoleMap", {}),
            "updatedAt": normalized.get("updatedAt"),
        }

    @router.get("/api/dashboard/license")
    async def dashboard_license(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")

        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")

        tier = guild.get("tier", "free")
        lic = core.get_server_license(guild.get("id"))
        tier_config = core.TIERS.get(tier, core.TIERS["free"])

        result = {
            "serverId": guild.get("id"),
            "serverName": guild.get("name"),
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
                "active": bool(lic.get("active", True)) and not bool(lic.get("expired")),
                "expired": bool(lic.get("expired")),
                "expiresAt": lic.get("expiresAt"),
                "remainingDays": lic.get("remainingDays", 0),
                "billingPeriod": lic.get("billingPeriod", "monthly"),
                "durationMonths": lic.get("durationMonths"),
                "emailMasked": core.mask_email(lic.get("email") or lic.get("contactEmail") or ""),
                "resolutionSource": lic.get("resolutionSource"),
            }

        return result

    @router.get("/api/dashboard/emojis")
    async def dashboard_emojis(request: Request, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")

        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")

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

    return router
