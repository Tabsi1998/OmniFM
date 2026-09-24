"""Dashboard statistics, scheduled events and telemetry (FastAPI fallback, see dashboard.py).

Moved out of server.py unchanged (#200). server.py calls build_router(core)
with itself; names defined in server.py are read as core.<name> at call
time, so tests that patch server.db still reach these routes.
"""
from datetime import datetime
from datetime import timezone
from fastapi import APIRouter
from fastapi import Request


def build_router(core):
    router = APIRouter()

    @router.get("/api/dashboard/stats")
    async def dashboard_stats(request: Request, serverId: str = ""):
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
        stats_payload = core.get_dashboard_guild_stats(guild.get("id"), tier)
        return {
            "serverId": guild.get("id"),
            "tier": tier,
            "basic": stats_payload.get("basic", {}),
            "advanced": stats_payload.get("advanced") if tier == "ultimate" else None,
        }

    @router.delete("/api/dashboard/stats/reset")
    async def dashboard_stats_reset(request: Request, serverId: str = ""):
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
        if not gid:
            return core.json_error(400, "Ungueltige Server-ID.")

        deleted_counts = {}
        archive_id = None
        if core.db is not None:
            try:
                archived = core.archive_mongo_records(
                    [
                        ("daily_stats", {"guildId": gid}),
                        ("listening_sessions", {"guildId": gid}),
                        ("listener_snapshots", {"guildId": gid}),
                        ("guild_stats", {"guildId": gid}),
                    ],
                    operation="dashboard.stats.reset",
                    target=gid,
                    request=request,
                    actor="dashboard",
                    delete=True,
                )
                deleted_counts = archived.get("deleted", {})
                archive_id = archived.get("operationId")
            except Exception as e:
                return core.json_error(500, f"Fehler beim sicheren Archivieren/Zuruecksetzen: {str(e)}")

        return {"success": True, "serverId": gid, "deleted": deleted_counts, "archiveId": archive_id}

    @router.get("/api/dashboard/stats/detail")
    async def dashboard_stats_detail(request: Request, serverId: str = "", days: int = 30):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        session, _ = core.get_dashboard_session(request)
        if not session:
            return core.json_error(401, "Nicht eingeloggt.")
        guild = core.resolve_session_guild_for_server(session, serverId)
        if not guild:
            return core.json_error(403, "Kein Zugriff auf diesen Server.")
        if guild.get("tier") != "ultimate":
            return core.json_error(403, "Detaillierte Statistiken sind nur fuer Ultimate verfuegbar.")

        gid = guild.get("id", "")
        days = max(1, min(90, days))
        result = {
            "serverId": gid, "tier": "ultimate",
            "listeningStats": {}, "dailyStats": [], "sessionHistory": [],
            "connectionHealth": {"connects": 0, "reconnects": 0, "errors": 0, "events": []},
            "listenerTimeline": [], "activeSessions": [],
        }
        if core.db is not None:
            try:
                from datetime import timedelta
                cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
                daily = list(core.db.daily_stats.find(
                    {"guildId": gid, "date": {"$gte": cutoff}},
                    {"_id": 0}
                ).sort("date", -1).limit(days))
                result["dailyStats"] = daily

                sessions = list(core.db.listening_sessions.find(
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

                guild_stat = core.db.guild_stats.find_one({"guildId": gid}, {"_id": 0})
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

                snapshots = list(core.db.listener_snapshots.find(
                    {"guildId": gid}, {"_id": 0}
                ).sort("timestamp", -1).limit(288))
                result["listenerTimeline"] = [{
                    "timestamp": s.get("timestamp").isoformat() if hasattr(s.get("timestamp", ""), "isoformat") else str(s.get("timestamp", "")),
                    "listeners": s.get("listeners", 0),
                } for s in reversed(snapshots)]
            except Exception:
                pass
        return result

    @router.post("/api/dashboard/telemetry")
    async def dashboard_upsert_telemetry(request: Request, body: dict, serverId: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "write")
        if rate_limited is not None:
            return rate_limited
        if not core.is_admin_request(request):
            return core.json_error(401, "Unauthorized. API admin token required.")
        if not core.is_valid_server_id(serverId):
            return core.json_error(400, "ungueltige serverId")

        data = core.load_dashboard_data()
        telemetry_map = data.setdefault("telemetry", {})
        telemetry_map[serverId] = core.normalize_dashboard_telemetry(body)
        core.save_dashboard_data(data)
        return {"success": True, "serverId": serverId, "telemetry": telemetry_map[serverId]}

    @router.post("/api/dashboard/events/preview")
    async def dashboard_events_preview(request: Request, body: dict, serverId: str = ""):
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
            return core.json_error(403, "Events sind erst ab Pro verfuegbar.")
        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")

        language = core.normalize_language(
            request.headers.get("X-OmniFM-Language"),
            core.resolve_language_from_accept_language(request.headers.get("accept-language"), "de"),
        )
        guild_id = str(guild.get("id") or "")
        incoming = body if isinstance(body, dict) else {}
        event_id = str(incoming.get("eventId") or incoming.get("id") or "").strip()
        existing = None
        if event_id:
            existing = core.db.scheduled_events.find_one({"_eventId": event_id, "guildId": guild_id}, {"_id": 0})
            if not existing:
                return core.json_error(404, "Event nicht gefunden." if language == "de" else "Event not found.")
        try:
            event_payload = core.normalize_dashboard_event({
                **(existing or {}),
                **incoming,
                "id": (existing or {}).get("id") or event_id or None,
                "guildId": guild_id,
                "botId": (existing or {}).get("botId") or core.dashboard_event_runtime_id(guild_id),
                "createdAt": (existing or {}).get("createdAt"),
                "createdByUserId": (existing or {}).get("createdByUserId") or (session.get("user") or {}).get("id"),
            })
            core.validate_dashboard_event(guild_id, event_payload)
        except ValueError as exc:
            return core.json_error(400, str(exc))

        existing_events = list(core.db.scheduled_events.find({"guildId": guild_id}, {"_id": 0, "_eventId": 0}).limit(200))
        conflicts = core.build_dashboard_event_conflicts(
            event_payload,
            existing_events,
            language=language,
            ignore_event_id=(existing or {}).get("id") or event_id,
        )
        event_response = core.dashboard_event_response(event_payload)
        event_response["stationName"] = core.dashboard_event_station_name(guild_id, event_payload.get("stationKey"))
        return {
            "success": True,
            "serverId": guild_id,
            "event": event_response,
            "schedule": {
                "nextRuns": core.build_dashboard_event_preview_rows(event_payload, 5),
                "repeatLabelDe": core.dashboard_event_repeat_label(event_payload.get("repeat"), "de", event_payload.get("runAtMs"), event_payload.get("timeZone")),
                "repeatLabelEn": core.dashboard_event_repeat_label(event_payload.get("repeat"), "en", event_payload.get("runAtMs"), event_payload.get("timeZone")),
                "hasConflicts": bool(conflicts),
            },
            "conflicts": conflicts,
        }

    @router.get("/api/dashboard/events")
    async def dashboard_events_list(request: Request, serverId: str = ""):
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
            return core.json_error(403, "Events sind erst ab Pro verfuegbar.")

        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        rows = list(core.db.scheduled_events.find({"guildId": guild.get("id")}, {"_id": 0, "_eventId": 0}).sort("runAtMs", 1).limit(200))
        return {"serverId": guild.get("id"), "events": [core.dashboard_event_response(row) for row in rows]}

    @router.post("/api/dashboard/events")
    async def dashboard_events_create(request: Request, body: dict, serverId: str = ""):
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
            return core.json_error(403, "Events sind erst ab Pro verfuegbar.")

        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        if core.db.scheduled_events.count_documents({"guildId": guild.get("id")}) >= 200:
            return core.json_error(400, "Maximal 200 Events pro Server sind möglich.")
        try:
            event_payload = core.normalize_dashboard_event({
                **(body if isinstance(body, dict) else {}),
                "guildId": guild.get("id"),
                "botId": core.dashboard_event_runtime_id(guild.get("id")),
                "createdByUserId": (session.get("user") or {}).get("id"),
            })
            core.validate_dashboard_event(guild.get("id"), event_payload)
        except ValueError as exc:
            return core.json_error(400, str(exc))
        core.db.scheduled_events.replace_one({"_eventId": event_payload["id"]}, {"_eventId": event_payload["id"], **event_payload}, upsert=True)
        return {"success": True, "event": core.dashboard_event_response(event_payload)}

    @router.patch("/api/dashboard/events/{event_id}")
    async def dashboard_events_update(request: Request, event_id: str, body: dict, serverId: str = ""):
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
            return core.json_error(403, "Events sind erst ab Pro verfuegbar.")

        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        existing = core.db.scheduled_events.find_one({"_eventId": str(event_id), "guildId": guild.get("id")}, {"_id": 0})
        if not existing:
            return core.json_error(404, "Event nicht gefunden.")
        try:
            updated = core.normalize_dashboard_event({
                **existing,
                **(body if isinstance(body, dict) else {}),
                "id": existing.get("id"),
                "guildId": guild.get("id"),
                "botId": existing.get("botId") or core.dashboard_event_runtime_id(guild.get("id")),
                "createdAt": existing.get("createdAt"),
                "createdByUserId": existing.get("createdByUserId"),
            })
            core.validate_dashboard_event(guild.get("id"), updated)
        except ValueError as exc:
            return core.json_error(400, str(exc))
        core.db.scheduled_events.replace_one({"_eventId": str(event_id)}, {"_eventId": str(event_id), **updated}, upsert=False)
        return {"success": True, "event": core.dashboard_event_response(updated)}

    @router.delete("/api/dashboard/events/{event_id}")
    async def dashboard_events_delete(request: Request, event_id: str, serverId: str = ""):
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
            return core.json_error(403, "Events sind erst ab Pro verfuegbar.")

        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        try:
            archived = core.archive_mongo_records(
                [("scheduled_events", {"_eventId": str(event_id), "guildId": guild.get("id")})],
                operation="dashboard.event.delete",
                target=f"{guild.get('id')}:{event_id}",
                request=request,
                actor="dashboard",
                delete=True,
            )
        except Exception as exc:
            return core.json_error(500, f"Event konnte nicht sicher archiviert werden: {core.clip_text(exc)}")
        removed_count = int((archived.get("deleted") or {}).get("scheduled_events") or 0)
        if removed_count == 0:
            return core.json_error(404, "Event nicht gefunden.")
        return {"success": True, "eventId": str(event_id), "archiveId": archived.get("operationId")}

    return router
