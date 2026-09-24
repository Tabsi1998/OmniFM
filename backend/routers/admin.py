"""Owner console: login, overview, configuration, stations, integrations, audit, monitoring.

Moved out of server.py unchanged (#200). server.py calls build_router(core)
with itself; names defined in server.py are read as core.<name> at call
time, so tests that patch server.db still reach these routes.
"""
from datetime import datetime
from datetime import timezone
from fastapi import APIRouter
from fastapi import Request
from starlette.concurrency import run_in_threadpool
import hmac
import os
import re
import requests
import smtplib
import ssl
import time


def build_router(core):
    router = APIRouter()

    @router.post("/api/admin/login")
    async def admin_login(request: Request, body: dict = None):
        if not core.ADMIN_API_TOKEN:
            return core.json_error(503, "Owner-API ist nicht konfiguriert (API_ADMIN_TOKEN fehlt).")
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
        if token and hmac.compare_digest(token, core.ADMIN_API_TOKEN):
            return {"ok": True, "role": "owner"}
        return core.json_error(401, "Ungueltiger Owner-Token.")

    @router.get("/api/admin/overview")
    async def admin_overview(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard

        state = core.load_premium()
        rows = core._license_rows(state)
        active_rows = [r for r in rows if r["active"]]
        by_plan = {}
        mrr = 0.0
        total_seats = 0
        for r in active_rows:
            by_plan[r["plan"]] = by_plan.get(r["plan"], 0) + 1
            total_seats += r["seats"]
            price = float((core.TIERS.get(r["plan"]) or {}).get("pricePerMonth", 0) or 0) / 100.0
            mrr += price * r["seats"]

        stations = core._station_summary()
        bots = core.load_bots_from_env()
        live = core.live_runtime_totals()

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
                "online": live["botsOnline"],
                "commander": next((b["name"] for b in bots if b.get("index") == core.parse_int(os.environ.get("COMMANDER_BOT_INDEX", "1"), 1)), bots[0]["name"] if bots else None),
            },
            # Echte verwaltete Server aus der laufenden Runtime (0, wenn kein Bot laeuft).
            "guilds": {"managed": live["servers"], "live": live["live"]},
            "integrations": {
                "mongo": core.mongo_is_reachable(),
                "stripe": core.is_stripe_enabled() and bool(core.get_stripe_secret_key()),
                "discordOAuth": core.is_discord_oauth_configured(),
                "smtp": core.config_bool(core.system_setting("smtp", "enabled", default=bool(core.system_setting("smtp", "host", "SMTP_HOST")))) and bool(core.system_setting("smtp", "host", "SMTP_HOST")),
                "discordBotList": bool(str(core.directory_setting("discordBotList", "token", "DISCORDBOTLIST_TOKEN") or "").strip()),
                "botsGG": bool(str(core.directory_setting("botsGG", "token", "BOTSGG_TOKEN") or "").strip()),
                "topGG": bool(str(core.directory_setting("topGG", "token", "TOPGG_TOKEN") or "").strip()),
                "recognition": core.config_bool(core.system_setting("audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", False)),
            },
        }

    @router.get("/api/admin/guilds")
    async def admin_guilds(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        guilds = sorted(core._runtime_guild_directory().values(), key=lambda item: str(item.get("name") or "").lower())
        return {"guilds": guilds, "count": len(guilds), "live": bool(core.read_runtime_health_fresh())}

    @router.get("/api/admin/workers")
    async def admin_workers(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        bots = core.load_bots_from_env()
        live_doc = core.read_runtime_health_fresh()
        live_nodes = (live_doc or {}).get("nodes") or []
        live_process = (live_doc or {}).get("process") or {}
        nodes_by_id = {str(node.get("botId") or ""): node for node in live_nodes if node.get("botId")}
        nodes_by_index = {core.parse_int(node.get("index"), 0): node for node in live_nodes if core.parse_int(node.get("index"), 0) > 0}
        commander_index = core.parse_int(os.environ.get("COMMANDER_BOT_INDEX", "1"), 1)
        workers = []
        matched_node_keys = set()
        for b in bots:
            node = nodes_by_id.get(str(b.get("clientId") or "")) or nodes_by_id.get(str(b.get("botId") or "")) or nodes_by_index.get(core.parse_int(b.get("index"), 0))
            if node:
                matched_node_keys.add((str(node.get("botId") or ""), core.parse_int(node.get("index"), 0)))
            workers.append({
                "botId": (node or {}).get("botId") or b.get("botId"),
                "index": b.get("index"),
                "name": (node or {}).get("name") or b.get("name"),
                "role": (node or {}).get("role") or ("commander" if b.get("index") == commander_index else "worker"),
                "requiredTier": b.get("requiredTier"),
                "clientId": b.get("clientId"),
                "ready": (node or {}).get("status") == "online" if node else False,
                "status": (node or {}).get("status") or "offline",
                "servers": core.parse_int((node or {}).get("guilds", b.get("servers", 0)), 0),
                "listeners": core.parse_int((node or {}).get("listeners", b.get("listeners", 0)), 0),
                "connections": core.parse_int((node or {}).get("voiceConnections", b.get("connections", 0)), 0),
                "pingMs": (node or {}).get("pingMs"),
                "guildDetails": (node or {}).get("guildDetails") or [],
                "uptimeSec": core.parse_int((node or {}).get("uptimeSec", live_process.get("uptimeSec", 0)), 0),
                "cpuPct": (node or {}).get("cpuPct"),
                "ramMb": (node or {}).get("ramMb"),
                "heapUsedMb": (node or {}).get("heapUsedMb"),
                "pid": (node or {}).get("pid"),
                "host": (node or {}).get("host"),
                "nodeVersion": (node or {}).get("nodeVersion"),
                "resourceScope": (node or {}).get("resourceScope") or "shared-process",
                "color": b.get("color"),
            })

        # A just-started runtime can report a node before the corresponding Owner
        # configuration response has been reloaded. Keep the live node visible.
        for node in live_nodes:
            key = (str(node.get("botId") or ""), core.parse_int(node.get("index"), 0))
            if key in matched_node_keys:
                continue
            workers.append({
                "botId": node.get("botId") or f"runtime-{node.get('index')}",
                "index": node.get("index"),
                "name": node.get("name") or f"Bot {node.get('index')}",
                "role": node.get("role") or "worker",
                "requiredTier": None,
                "clientId": node.get("botId"),
                "ready": node.get("status") == "online",
                "status": node.get("status") or "offline",
                "servers": core.parse_int(node.get("guilds"), 0),
                "listeners": core.parse_int(node.get("listeners"), 0),
                "connections": core.parse_int(node.get("voiceConnections"), 0),
                "pingMs": node.get("pingMs"),
                "guildDetails": node.get("guildDetails") or [],
                "uptimeSec": core.parse_int(node.get("uptimeSec", live_process.get("uptimeSec")), 0),
                "cpuPct": node.get("cpuPct"),
                "ramMb": node.get("ramMb"),
                "heapUsedMb": node.get("heapUsedMb"),
                "pid": node.get("pid"),
                "host": node.get("host"),
                "nodeVersion": node.get("nodeVersion"),
                "resourceScope": node.get("resourceScope") or "shared-process",
                "color": None,
            })
        workers.sort(key=lambda item: core.parse_int(item.get("index"), 999))
        return {
            "workers": workers,
            "count": len(workers),
            "commanderIndex": commander_index,
            "live": bool(live_doc),
            "generatedAt": (live_doc or {}).get("at"),
            "resourceModel": (((live_doc or {}).get("process") or {}).get("resourceModel")),
        }

    @router.get("/api/admin/stations")
    async def admin_stations(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        return core._station_summary()

    @router.get("/api/admin/integrations")
    async def admin_integrations(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        try:
            dbl = core.get_discordbotlist_status(vote_limit=10)
        except Exception:
            dbl = {"enabled": False}
        bots_gg = core.get_bot_directory_config_status("botsGG", "BOTSGG_ENABLED", "BOTSGG_TOKEN", "BOTSGG_BOT_ID")
        top_gg = core.get_bot_directory_config_status("topGG", "TOPGG_ENABLED", "TOPGG_TOKEN", "TOPGG_BOT_ID")
        return {
            "discordBotList": dbl,
            "botDirectories": {"discordBotList": dbl, "botsGG": bots_gg, "topGG": top_gg},
            "config": {
                "mongo": core.mongo_is_reachable(),
                "stripe": core.is_stripe_enabled() and bool(core.get_stripe_secret_key()),
                "discordOAuth": core.is_discord_oauth_configured(),
                "smtp": core.config_bool(core.system_setting("smtp", "enabled", default=bool(core.system_setting("smtp", "host", "SMTP_HOST")))) and bool(core.system_setting("smtp", "host", "SMTP_HOST")),
                "recognition": core.config_bool(core.system_setting("audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", False)),
                "songHistory": core.config_bool(core.system_setting("songHistory", "enabled", "SONG_HISTORY_ENABLED", True), True),
                "discordBotList": core.config_bool(core.directory_setting("discordBotList", "enabled", "DISCORDBOTLIST_ENABLED", False)),
                "botsGG": core.config_bool(core.directory_setting("botsGG", "enabled", "BOTSGG_ENABLED", False)),
                "topGG": core.config_bool(core.directory_setting("topGG", "enabled", "TOPGG_ENABLED", False)),
            },
        }

    @router.post("/api/admin/integrations/test")
    async def admin_integrations_test(request: Request, body: dict = None):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        requested = str((body or {}).get("integration") or "all").strip().lower()
        supported = {"mongo", "stripe", "discordoauth", "smtp", "recognition", "songhistory", "discordbotlist", "botsgg", "topgg"}
        names = supported if requested == "all" else {requested}
        if not names.issubset(supported):
            return core.json_error(400, "Unbekannte Integration.")

        def check_all():
            results = {}
            if "mongo" in names:
                try:
                    if core.client is None:
                        raise RuntimeError("MongoDB ist nicht verbunden")
                    core.client.admin.command("ping")
                    results["mongo"] = {"ok": True, "message": "MongoDB antwortet."}
                except Exception as exc:
                    results["mongo"] = {"ok": False, "message": core.clip_text(exc, 160)}
            if "stripe" in names:
                key = core.get_stripe_secret_key()
                if not key:
                    results["stripe"] = {"ok": False, "message": "Kein Stripe Secret Key konfiguriert."}
                else:
                    try:
                        response = requests.get("https://api.stripe.com/v1/balance", auth=(key, ""), timeout=10)
                        results["stripe"] = {"ok": response.status_code < 400, "message": "Stripe API erreichbar." if response.status_code < 400 else f"Stripe HTTP {response.status_code}"}
                    except Exception as exc:
                        results["stripe"] = {"ok": False, "message": core.clip_text(exc, 160)}
            if "discordoauth" in names:
                results["discordOAuth"] = {"ok": core.is_discord_oauth_configured(), "message": "OAuth-Konfiguration vollständig." if core.is_discord_oauth_configured() else "Client ID, Secret oder Redirect URI fehlt."}
            if "smtp" in names:
                host = str(core.system_setting("smtp", "host", "SMTP_HOST") or "").strip()
                port = core.parse_int(core.system_setting("smtp", "port", "SMTP_PORT", 587), 587)
                secure = core.config_bool(core.system_setting("smtp", "secure", "SMTP_SECURE", False))
                user = str(core.system_setting("smtp", "user", "SMTP_USER") or "").strip()
                password = str(core.system_setting("smtp", "password", "SMTP_PASS") or "")
                if not host:
                    results["smtp"] = {"ok": False, "message": "SMTP Host fehlt."}
                else:
                    connection = None
                    try:
                        if secure:
                            connection = smtplib.SMTP_SSL(host, port, timeout=10, context=ssl.create_default_context())
                        else:
                            connection = smtplib.SMTP(host, port, timeout=10)
                            connection.ehlo()
                            if connection.has_extn("STARTTLS"):
                                connection.starttls(context=ssl.create_default_context())
                                connection.ehlo()
                        if user:
                            connection.login(user, password)
                        results["smtp"] = {"ok": True, "message": "SMTP-Verbindung und Anmeldung erfolgreich."}
                    except Exception as exc:
                        results["smtp"] = {"ok": False, "message": core.clip_text(exc, 160)}
                    finally:
                        try:
                            if connection:
                                connection.quit()
                        except Exception:
                            pass
            if "recognition" in names:
                enabled = core.config_bool(core.system_setting("audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", False))
                has_key = bool(core.system_setting("audioRecognition", "apiKey", "ACOUSTID_API_KEY"))
                results["recognition"] = {"ok": enabled and has_key, "message": "Song-Erkennung ist vollständig konfiguriert." if enabled and has_key else "Aktivierung oder API Key fehlt."}
            if "songhistory" in names:
                enabled = core.config_bool(core.system_setting("songHistory", "enabled", "SONG_HISTORY_ENABLED", True), True)
                results["songHistory"] = {"ok": enabled and core.db is not None, "message": "Song-Verlauf und MongoDB sind aktiv." if enabled and core.db is not None else "Song-Verlauf ist deaktiviert oder MongoDB fehlt."}
            directory_specs = {
                "discordbotlist": ("discordBotList", "DISCORDBOTLIST_TOKEN", "DISCORDBOTLIST_BOT_ID", "Discord Bot List"),
                "botsgg": ("botsGG", "BOTSGG_TOKEN", "BOTSGG_BOT_ID", "Bots.gg"),
                "topgg": ("topGG", "TOPGG_TOKEN", "TOPGG_BOT_ID", "Top.gg"),
            }
            for requested_name, (directory, token_env, bot_id_env, label) in directory_specs.items():
                if requested_name not in names:
                    continue
                enabled_env = token_env.replace("TOKEN", "ENABLED")
                enabled = core.config_bool(core.directory_setting(directory, "enabled", enabled_env, False))
                token = str(core.directory_setting(directory, "token", token_env) or "").strip()
                bot_id = str(core.directory_setting(directory, "botId", bot_id_env) or "").strip()
                complete = enabled and bool(token) and bool(re.match(r"^\d{17,22}$", bot_id))
                results[directory] = {"ok": complete, "message": f"{label} ist vollständig konfiguriert." if complete else f"{label}: Aktivierung, Token oder gültige Bot-ID fehlt."}
            return results

        results = await run_in_threadpool(check_all)
        core.record_owner_audit("integrations.test", target=requested, detail="; ".join(f"{key}={'ok' if value.get('ok') else 'fail'}" for key, value in results.items()), request=request)
        return {"ok": all(item.get("ok") for item in results.values()), "results": results, "checkedAt": datetime.now(timezone.utc).isoformat()}

    @router.get("/api/admin/failover-history")
    async def admin_failover_history(request: Request, limit: int = 100):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        limit = max(1, min(500, core.parse_int(limit, 100)))
        rows = []
        if core.db is not None:
            try:
                cursor = core.db.runtime_incidents.find(
                    {"eventKey": {"$in": list(core.FAILOVER_HISTORY_EVENTS)}}, {"_id": 0}
                ).sort("timestamp", -1).limit(limit)
                rows = [core.format_failover_history_row(doc) for doc in cursor]
            except Exception:
                rows = []
        return {"history": rows, "count": len(rows)}

    @router.get("/api/admin/monitoring")
    async def admin_monitoring(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard

        now_iso = datetime.now(timezone.utc).isoformat()

        # 1) Echte Runtime-Telemetrie aus MongoDB (vom Node-Bot geschrieben).
        live_doc = None
        if core.db is not None:
            try:
                live_doc = core.db.runtime_health.find_one({"_id": "latest"}, {"_id": 0})
            except Exception:
                live_doc = None
        fresh = False
        if live_doc:
            dt = core._parse_iso_dt(live_doc.get("at"))
            if dt is not None:
                fresh = (datetime.now(timezone.utc) - dt).total_seconds() <= 30

        if fresh:
            proc = live_doc.get("process") or {}
            resource_model = str(proc.get("resourceModel") or "shared-process")
            split_processes = resource_model == "split-processes"
            live_nodes = []
            for n in (live_doc.get("nodes") or []):
                live_nodes.append({
                    "botId": n.get("botId"),
                    "index": n.get("index"),
                    "name": n.get("name"),
                    "role": n.get("role"),
                    "requiredTier": n.get("requiredTier") or "free",
                    "status": n.get("status"),
                    "pingMs": n.get("pingMs"),
                    "guilds": n.get("guilds", 0),
                    "guildDetails": n.get("guildDetails") or [],
                    "voiceConnections": n.get("voiceConnections", 0),
                    "listeners": n.get("listeners", 0),
                    # In split mode every Worker reports its own OS process. In the
                    # optional legacy monolith, shared values remain hidden here.
                    "cpuPct": n.get("cpuPct") if split_processes else None,
                    "ramMb": n.get("ramMb") if split_processes else None,
                    "heapUsedMb": n.get("heapUsedMb") if split_processes else None,
                    "uptimeSec": n.get("uptimeSec") if split_processes else None,
                    "pid": n.get("pid") if split_processes else None,
                    "host": n.get("host") if split_processes else None,
                    "nodeVersion": n.get("nodeVersion") if split_processes else None,
                    "resourceScope": "node-process" if split_processes else "shared-process",
                })
            real_incidents = []
            if core.db is not None:
                try:
                    for doc in core.db.runtime_incidents.find({}, {"_id": 0}).sort("at", -1).limit(25):
                        real_incidents.append(core.format_runtime_incident(doc))
                except Exception:
                    real_incidents = []
            healthy = sum(1 for n in live_nodes if n.get("status") == "online")
            return {
                "generatedAt": now_iso,
                "simulated": False,
                "live": True,
                "process": proc,
                "health": {
                    "healthyNodes": healthy,
                    "totalNodes": len(live_nodes),
                    "uptimeSec": proc.get("uptimeSec", 0),
                    "apiLatencyMs": None,
                    "mongo": core.mongo_is_reachable(),
                    "openIncidents": sum(1 for i in real_incidents if not i.get("resolved")),
                },
                "nodes": live_nodes,
                "affectedServers": core.build_affected_servers(live_doc.get("nodes") or []),
                "incidents": real_incidents,
                "logs": core.read_runtime_logs() or (live_doc.get("logs") or [])[:500],
            }

        # 2) Keine frischen Runtime-Daten und kein Demo-Modus -> ehrlich leer.
        if not core.seed_demo_enabled():
            return {
                "generatedAt": now_iso,
                "simulated": False,
                "live": False,
                "waiting": True,
                "process": None,
                "health": {"healthyNodes": 0, "totalNodes": 0, "uptimeSec": 0, "apiLatencyMs": None, "mongo": core.mongo_is_reachable(), "openIncidents": 0},
                "nodes": [],
                "affectedServers": [],
                "incidents": [],
                "logs": [],
                "message": "Warte auf Live-Daten vom OmniFM-Bot. Sobald der Node-Bot laeuft (echte Tokens im Owner-Menue) und Metriken meldet, erscheinen hier CPU/RAM/Ping, Voice, Guilds, Incidents und Live-Log in Echtzeit.",
            }

        # 3) Demo-Modus (SEED_DEMO_DATA=1): simulierte Telemetrie.
        now = time.time()
        bots = core.load_bots_from_env()
        commander_index = core.parse_int(os.environ.get("COMMANDER_BOT_INDEX", "1"), 1)

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
        raw_incidents = core._read_json_list(core.RUNTIME_INCIDENTS_FILE) or core._read_json_list(core.OPERATOR_INCIDENTS_FILE, "incidents")
        incidents = []
        for item in raw_incidents[:25]:
            if not isinstance(item, dict):
                continue
            incidents.append({
                "at": item.get("at") or item.get("timestamp") or item.get("createdAt"),
                "severity": (item.get("severity") or item.get("level") or "info").lower(),
                "source": item.get("source") or item.get("entry") or "runtime",
                "message": core.clip_text(item.get("message") or item.get("summary") or item.get("reason") or "Incident", 240),
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
            tpl = core._MONITOR_LOG_TEMPLATES[(int(now // 2) + k) % len(core._MONITOR_LOG_TEMPLATES)]
            level, src, msg = tpl
            msg = (msg
                   .replace("{g}", str(100000000000000000 + ((int(now) + k) % 900)))
                   .replace("{n}", str(22 + (k % 6)))
                   .replace("{s}", core._MONITOR_STATIONS[(int(now) + k) % len(core._MONITOR_STATIONS)])
                   .replace("{ms}", str(30 + ((int(now) + k * 3) % 50))))
            logs.append({
                "at": datetime.fromtimestamp(now - k * 3, timezone.utc).isoformat(),
                "level": level, "source": src, "message": msg,
            })

        return {
            "generatedAt": now_iso,
            "simulated": True,
            "live": False,
            "process": None,
            "health": {
                "healthyNodes": healthy,
                "totalNodes": len(nodes),
                "uptimePct": round(96 + (int(now // 5) % 40) / 10.0, 2),
                "apiLatencyMs": 8 + int(now) % 22,
                "mongo": core.mongo_is_reachable(),
                "openIncidents": sum(1 for i in incidents if not i.get("resolved")),
            },
            "nodes": nodes,
            "incidents": incidents[:25],
            "logs": logs,
        }

    @router.get("/api/admin/audit")
    async def admin_audit(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        rows = []
        if core.db is not None:
            try:
                for doc in core.db.owner_audit.find({}, {"_id": 0}).sort("at", -1).limit(200):
                    rows.append(doc)
            except Exception:
                rows = []
        if not rows:
            rows = core._read_json_list(core.OWNER_AUDIT_FILE)[:200]
        return {"audit": rows, "count": len(rows)}

    @router.get("/api/admin/config")
    async def admin_get_config(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        return {
            "company": core.get_config_section("company"),
            "plans": core.get_config_section("plans"),
            "discord": core.mask_config_secrets(core.get_config_section("discord")),
            "payments": core.mask_config_secrets(core.effective_payments_config()),
            "marketing": core.get_config_section("marketing"),
            "system": core.mask_config_secrets(core.effective_system_config()),
            "recoverySettings": core.RECOVERY_SETTINGS,
            "env": {
                "stripeEnvKey": bool((os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "").strip()),
            },
        }

    @router.put("/api/admin/config")
    async def admin_put_config(request: Request, body: dict = None):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if not isinstance(body, dict):
            return core.json_error(400, "Ungueltiger Body.")
        section = str(body.get("section") or "").strip()
        data = body.get("data")
        if section not in core.DEFAULT_OWNER_CONFIG:
            return core.json_error(400, f"Unbekannter Config-Abschnitt: {section}")
        if not isinstance(data, (dict, list)):
            return core.json_error(400, "data muss ein Objekt oder eine Liste sein.")
        if core.db is None:
            return core.json_error(503, "Keine Datenbank verbunden \u2013 Speichern nicht m\u00f6glich.")
        if not core.save_config_section(section, data):
            core.record_owner_audit("config.update", target=section, status="error", request=request)
            return core.json_error(500, "Speichern fehlgeschlagen.")
        core.record_owner_audit("config.update", target=section, detail="aktualisiert", request=request)
        fresh = core.effective_system_config() if section == "system" else core.effective_payments_config() if section == "payments" else core.get_config_section(section)
        if section in ("discord", "payments", "system"):
            fresh = core.mask_config_secrets(fresh)
        return {"ok": True, "section": section, "data": fresh}

    @router.get("/api/admin/discord/logs")
    async def admin_discord_logs(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        disc = core.get_config_section("discord")
        commander = disc.get("commander") or {}
        workers = disc.get("workers") or []
        connected = bool(str(commander.get("token") or "").strip())
        logs = []
        if core.db is not None:
            try:
                for doc in core.db.owner_audit.find({"action": {"$regex": "^(config|discord|station)"}}, {"_id": 0}).sort("at", -1).limit(60):
                    logs.append(doc)
            except Exception:
                logs = []
        if not logs:
            logs = [x for x in core._read_json_list(core.OWNER_AUDIT_FILE) if str(x.get("action", "")).startswith(("config", "discord", "station"))][:60]
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

    @router.post("/api/admin/stations/test")
    async def admin_station_test(request: Request, body: dict = None):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        url = str((body or {}).get("url") or "").strip()
        check = core.validate_custom_station_url(url)
        if not check.get("ok"):
            core.record_owner_audit("station.test", target=url, detail=check.get("error"), status="error", request=request)
            return core.json_error(400, check.get("error") or "URL ungültig.")
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
            core.record_owner_audit("station.test", target=url, detail=f"status={resp.status_code} type={ctype} {elapsed}ms", status="ok" if ok else "warn", request=request)
            return {
                "ok": ok, "reachable": reachable, "isAudioStream": is_audio,
                "status": resp.status_code, "contentType": ctype,
                "icyName": icy_name, "bitrate": icy_br, "latencyMs": elapsed,
                "message": "Stream erreichbar und liefert Audio." if ok else ("Erreichbar, aber kein eindeutiger Audio-Stream." if reachable else f"HTTP {resp.status_code}"),
            }
        except requests.exceptions.Timeout:
            core.record_owner_audit("station.test", target=url, detail="timeout", status="error", request=request)
            return {"ok": False, "reachable": False, "message": "Zeitüberschreitung – Stream nicht erreichbar.", "latencyMs": int((time.time() - started) * 1000)}
        except Exception as e:
            core.record_owner_audit("station.test", target=url, detail=core.clip_text(e, 120), status="error", request=request)
            return {"ok": False, "reachable": False, "message": f"Fehler: {core.clip_text(e, 120)}"}

    @router.post("/api/admin/stations")
    async def admin_station_upsert(request: Request, body: dict = None):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden – Stationsverwaltung nicht verfügbar.")
        data = body or {}
        key = str(data.get("key") or "").strip().lower()
        name = core.clip_text(data.get("name"), 80).strip() if data.get("name") else ""
        url = str(data.get("url") or "").strip()
        tier = str(data.get("tier") or "free").strip().lower()
        genre = core.clip_text(data.get("genre"), 60).strip() if data.get("genre") else "Radio"

        if not core.STATION_KEY_REGEX.match(key):
            return core.json_error(400, "Ungültiger Key (a-z, 0-9, . _ -, 2-49 Zeichen).")
        if not name:
            return core.json_error(400, "Name erforderlich.")
        if tier not in core.VALID_TIERS:
            return core.json_error(400, "Tier muss free, pro oder ultimate sein.")
        check = core.validate_custom_station_url(url)
        if not check.get("ok"):
            return core.json_error(400, check.get("error") or "Stream-URL ungültig.")

        existing = core.db.stations.find_one({"key": key})
        doc = {"key": key, "name": name, "url": url, "tier": tier, "genre": genre}
        if not existing:
            doc["created_at"] = datetime.now(timezone.utc).isoformat()
            doc["is_default"] = False
        doc["updated_at"] = datetime.now(timezone.utc).isoformat()
        core.db.stations.update_one({"key": key}, {"$set": doc}, upsert=True)
        core.record_owner_audit("station.update" if existing else "station.create", target=key, detail=f"{name} · {tier} · {url}", request=request)
        return {"ok": True, "created": not existing, "station": {k: v for k, v in doc.items() if k != "_id"}}

    @router.delete("/api/admin/stations/{key}")
    async def admin_station_delete(request: Request, key: str):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        key = str(key or "").strip().lower()
        existing = core.db.stations.find_one({"key": key})
        if not existing:
            return core.json_error(404, "Station nicht gefunden.")
        if existing.get("is_default"):
            return core.json_error(400, "Standard-Station kann nicht gelöscht werden. Setze zuerst eine andere Default-Station.")
        try:
            archived = core.archive_mongo_records(
                [("stations", {"_id": existing.get("_id")})],
                operation="owner.station.delete",
                target=key,
                request=request,
                actor="owner",
                delete=True,
            )
        except Exception as exc:
            return core.json_error(500, f"Station konnte nicht sicher archiviert werden: {core.clip_text(exc)}")
        if int((archived.get("deleted") or {}).get("stations") or 0) == 0:
            return core.json_error(409, "Station wurde archiviert, aber nicht aus dem aktiven Katalog entfernt.")
        core.record_owner_audit("station.delete", target=key, detail=existing.get("name"), request=request)
        return {"ok": True, "deleted": key, "archiveId": archived.get("operationId")}

    @router.get("/api/admin/stations/list")
    async def admin_station_list(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        rows = []
        if core.db is not None:
            try:
                health_by_key = {
                    str(doc.get("key") or ""): doc
                    for doc in core.db.station_health.find({}, {"_id": 0})
                    if str(doc.get("key") or "")
                }
                for doc in core.db.stations.find({"key": {"$not": {"$regex": "^custom:"}}}, {"_id": 0}).sort([("tier", 1), ("name", 1)]):
                    health = health_by_key.get(str(doc.get("key") or ""))
                    rows.append({
                        "key": doc.get("key"), "name": doc.get("name"), "url": doc.get("url"),
                        "tier": doc.get("tier", "free"), "genre": doc.get("genre") or "Radio",
                        "isDefault": bool(doc.get("is_default")), "updatedAt": doc.get("updated_at"),
                        "health": health,
                    })
            except Exception:
                rows = []
        health_rows = [row.get("health") for row in rows if isinstance(row.get("health"), dict)]
        confirmed_down = len([row for row in health_rows if row.get("status") == "down" and core.parse_int(row.get("consecutiveFailures"), 0) >= 2])
        station_health_config = (core.effective_system_config().get("stationHealth") or {})
        return {
            "stations": rows,
            "count": len(rows),
            "healthSummary": {
                "automatic": station_health_config.get("enabled") is not False,
                "intervalMs": max(2000, core.parse_int(station_health_config.get("intervalMs"), 5000)),
                "batchSize": max(1, min(10, core.parse_int(station_health_config.get("batchSize"), 2))),
                "checked": len(health_rows),
                "up": len([row for row in health_rows if row.get("status") == "up"]),
                "down": confirmed_down,
                "pending": max(0, len(rows) - len(health_rows)),
            },
        }

    @router.post("/api/admin/stations/health")
    async def admin_station_health(request: Request, body: dict = None):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        data = body or {}
        keys = data.get("keys")
        query = {"key": {"$not": {"$regex": "^custom:"}}}
        if isinstance(keys, list) and keys:
            norm = [str(k).strip().lower() for k in keys if str(k).strip()][:25]
            query = {"key": {"$in": norm}}
        rows = [r for r in core.db.stations.find(query, {"_id": 0, "key": 1, "url": 1}).limit(25) if r.get("url")]

        def run_all():
            from concurrent.futures import ThreadPoolExecutor, as_completed
            out = {}
            with ThreadPoolExecutor(max_workers=10) as ex:
                futs = {ex.submit(core._probe_station_url, r["url"]): r["key"] for r in rows}
                for fut in as_completed(futs):
                    key = futs[fut]
                    try:
                        out[key] = fut.result()
                    except Exception as e:
                        out[key] = {"ok": False, "reachable": False, "message": core.clip_text(e, 80)}
            return out

        results = await run_in_threadpool(run_all)
        now_ms = int(time.time() * 1000)
        for key, result in results.items():
            previous = core.db.station_health.find_one({"key": key}, {"_id": 0}) or {}
            ok = bool(result.get("discordOk") or result.get("ok"))
            failures = 0 if ok else core.parse_int(previous.get("consecutiveFailures"), 0) + 1
            successes = core.parse_int(previous.get("consecutiveSuccesses"), 0) + 1 if ok else 0
            health_doc = {
                **result,
                "key": key,
                "status": "up" if ok else "down",
                "responseTimeMs": result.get("latencyMs"),
                "lastCheckedAt": now_ms,
                "checkedAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "consecutiveFailures": failures,
                "consecutiveSuccesses": successes,
                "error": None if ok else result.get("message") or (f"HTTP {result.get('status')}" if result.get("status") else "nicht erreichbar"),
            }
            core.db.station_health.update_one({"key": key}, {"$set": health_doc}, upsert=True)
            result.update(health_doc)
            if failures == 2:
                core.db.runtime_incidents.insert_one({
                    "at": datetime.now(timezone.utc).isoformat(),
                    "severity": "warning", "source": "station-health",
                    "message": core.clip_text(f"Sender {key} ist offline: {health_doc.get('error')}", 240),
                    "resolved": False,
                })
            elif ok and previous.get("status") == "down" and core.parse_int(previous.get("consecutiveFailures"), 0) >= 2:
                core.db.runtime_incidents.insert_one({
                    "at": datetime.now(timezone.utc).isoformat(),
                    "severity": "info", "source": "station-health",
                    "message": core.clip_text(f"Sender {key} ist wieder erreichbar", 240),
                    "resolved": True,
                })
        truncated = isinstance(keys, list) and len([k for k in keys if str(k).strip()]) > 25
        return {"results": results, "count": len(results), "truncated": truncated}

    return router
