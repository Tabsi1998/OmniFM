"""Public endpoints: health, bots, workers, stations, legal texts, stats, commands, marketing, cover art.

Moved out of server.py unchanged (#200). server.py calls build_router(core)
with itself; names defined in server.py are read as core.<name> at call
time, so tests that patch server.db still reach these routes.
"""
from datetime import datetime
from datetime import timezone
from fastapi import APIRouter
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
import re
import requests


def build_router(core):
    router = APIRouter()

    @router.get("/api/health")
    async def health():
        mongo_ready = core.mongo_is_reachable()
        services = {"api": True, "mongo": mongo_ready, "dashboardBackend": core.DASHBOARD_BACKEND}
        if core.DASHBOARD_BACKEND == "node":
            services["dashboardApi"] = core.node_api_reachable()
        payload = {
            "ok": mongo_ready,
            "ready": mongo_ready,
            "status": "online" if mongo_ready else "degraded",
            "brand": "OmniFM",
            "contractVersion": core.BACKEND_CONTRACT_VERSION,
            "services": services,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        return JSONResponse(status_code=200 if mongo_ready else 503, content=payload)

    @router.get("/api/bots")
    async def get_bots():
        bots = []
        live_doc = core.read_runtime_health_fresh()
        live_nodes = live_doc.get("nodes", []) if live_doc else []
        nodes_by_index = {int(node.get("index") or 0): node for node in live_nodes}
        nodes_by_id = {str(node.get("botId") or ""): node for node in live_nodes if node.get("botId")}
        for bot in core.load_bots_from_env():
            item = dict(bot)
            node = nodes_by_id.get(str(item.get("clientId") or "")) or nodes_by_index.get(int(item.get("index") or 0))
            if node:
                item.update({
                    "ready": node.get("status") == "online",
                    "servers": int(node.get("guilds") or 0),
                    "users": int(node.get("users") or 0),
                    "connections": int(node.get("voiceConnections") or 0),
                    "listeners": int(node.get("listeners") or 0),
                    "userTag": node.get("userTag"),
                    "uptimeSec": int((live_doc.get("process") or {}).get("uptimeSec") or 0),
                })
            if item.get("requiredTier", "free") != "free":
                item["clientId"] = None
                item["inviteUrl"] = None
            bots.append(item)
        live = core.live_runtime_totals()
        totals = {
            "servers": live["servers"],
            "users": live["users"],
            "connections": live["voiceConnections"],
            "listeners": live["listeners"],
        }
        return {"bots": bots, "totals": totals}

    @router.get("/api/workers")
    async def get_workers():
        """Worker-Status Dashboard API. Returns commander + worker bot statuses."""
        bots_data = core.load_bots_from_env()

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
                "free": {"maxWorkers": core.TIERS["free"]["maxBots"], "name": "Free"},
                "pro": {"maxWorkers": core.TIERS["pro"]["maxBots"], "name": "Pro"},
                "ultimate": {"maxWorkers": core.TIERS["ultimate"]["maxBots"], "name": "Ultimate"},
            },
        }

    @router.get("/api/stations")
    async def get_stations():
        stations_list = []
        if core.db is not None:
            try:
                # IMPORTANT: Only include official stations (free + pro). NEVER include custom stations.
                for doc in core.db.stations.find({"key": {"$not": {"$regex": "^custom:"}}, "tier": {"$in": ["free", "pro"]}}, {"_id": 0}):
                    stations_list.append({
                        "key": doc.get("key", ""),
                        "name": doc.get("name", doc.get("key", "")),
                        "url": doc.get("url", ""),
                        "tier": doc.get("tier", "free"),
                    })
            except Exception:
                pass
        if not stations_list:
            file_data = core.load_stations_from_file()
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
        if core.db is not None:
            try:
                default_doc = core.db.stations.find_one({"is_default": True}, {"_id": 0, "key": 1})
                if default_doc:
                    default_key = default_doc.get("key")
            except Exception:
                pass
        if not default_key:
            file_data = core.load_stations_from_file()
            default_key = file_data.get("defaultStationKey")
        return {
            "defaultStationKey": default_key,
            "total": len(stations_list),
            "stations": stations_list
        }

    @router.get("/api/legal")
    async def get_legal_notice(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        return core.build_public_legal_notice()

    @router.get("/api/privacy")
    async def get_privacy_notice(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        return core.build_public_privacy_notice()

    @router.get("/api/terms")
    async def get_terms_notice(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        return core.build_public_terms_notice()

    @router.get("/api/discordbotlist/status")
    async def discordbotlist_status(request: Request, limit: int = 20):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        if not core.is_admin_request(request):
            return core.json_error(401, "Unauthorized. API admin token required.")
        return core.get_discordbotlist_status(vote_limit=max(0, min(200, int(limit))))

    @router.get("/api/stats")
    async def get_stats():
        bots = core.load_bots_from_env()
        station_count = 0
        free_count = 0
        pro_count = 0
        if core.db is not None:
            try:
                # IMPORTANT: Only count official stations (free + pro). NEVER count custom stations.
                station_count = core.db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": {"$in": ["free", "pro"]}})
                free_count = core.db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": "free"})
                pro_count = station_count - free_count
            except Exception:
                pass
        if station_count == 0:
            file_data = core.load_stations_from_file()
            # Only count official stations (free + pro), exclude custom stations
            official = {k: v for k, v in file_data.get("stations", {}).items() if not k.startswith("custom:") and (v.get("tier", "free") or "free").lower() in ("free", "pro")}
            station_count = len(official)
            free_count = sum(1 for s in official.values() if (s.get("tier", "free") or "free").lower() == "free")
            pro_count = station_count - free_count
        # Live-Zahlen NUR aus echter Runtime-Telemetrie (0, wenn kein Bot laeuft) – keine Fake-Werte.
        live = core.live_runtime_totals()
        totals = {
            "servers": live["servers"],
            "users": live["users"],
            "connections": live["voiceConnections"],
            "listeners": live["listeners"],
            "bots": live["botsOnline"],
            "botsConfigured": len(bots),
            "live": live["live"],
            "stations": station_count,
            "freeStations": free_count,
            "proStations": pro_count,
        }
        return totals

    @router.get("/api/commands")
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

    @router.get("/api/marketing")
    async def get_marketing(request: Request):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        m = core.get_config_section("marketing")

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

    @router.get("/api/cover")
    async def cover_lookup(request: Request, artist: str = "", title: str = "", term: str = ""):
        rate_limited = core.enforce_api_rate_limit(request, "read")
        if rate_limited is not None:
            return rate_limited
        query = (term or f"{artist} {title}").strip()
        query = re.sub(r"\s+", " ", query)[:120]
        if not query:
            return {"ok": False, "error": "Kein Suchbegriff."}
        ckey = query.lower()
        if ckey in core._COVER_CACHE:
            return core._COVER_CACHE[ckey]

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

        if len(core._COVER_CACHE) >= core._COVER_CACHE_MAX:
            core._COVER_CACHE.clear()
        core._COVER_CACHE[ckey] = result
        return result

    return router
