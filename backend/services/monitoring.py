"""Runtime monitoring and the dashboard proxy: health document, logs, incidents,
affected servers, failover history, guild directory and the Node API forwarding.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timezone
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.responses import Response
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from urllib.parse import urlparse
import requests
import socket
import time

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


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
        if key.lower() in core.NODE_PROXY_SKIPPED_HEADERS:
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
        if key.lower() in core.NODE_PROXY_SKIPPED_HEADERS:
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
    target = f"{core.NODE_API_URL}{request.url.path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    headers = core.build_node_proxy_headers(request.headers, getattr(request.client, "host", ""), request.url.scheme)
    body = await request.body()
    try:
        status_code, pairs, content = await run_in_threadpool(core._forward_to_node_api, request.method, target, headers, body)
    except requests.RequestException:
        return JSONResponse(
            status_code=503,
            content={"error": core.NODE_PROXY_UNAVAILABLE, "retryable": True},
            headers={"Retry-After": "5"},
        )
    return core.build_node_proxy_response(status_code, pairs, content)


def install_node_dashboard_proxy(target_app):
    """Put the forwarding routes in front of every FastAPI route of the prefixes."""
    for prefix in core.NODE_PROXY_PREFIXES:
        for route_path in (f"{prefix}/{{path:path}}", prefix):
            target_app.router.routes.insert(
                0, APIRoute(route_path, core.proxy_to_node_api, methods=core.NODE_PROXY_METHODS, include_in_schema=False)
            )


def node_api_reachable():
    """Whether the Node API answers, cached for ten seconds (health only)."""
    now = time.time()
    if now - core._NODE_API_REACHABLE["at"] < 10:
        return core._NODE_API_REACHABLE["value"]
    parsed = urlparse(core.NODE_API_URL)
    try:
        with socket.create_connection((parsed.hostname or "127.0.0.1", parsed.port or 80), timeout=1):
            value = True
    except OSError:
        value = False
    core._NODE_API_REACHABLE.update(at=now, value=value)
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
        "message": core.clip_text(message or "Incident", 240),
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
            since_ms = max(0, core.parse_int(since, 0))
            rows.append({
                "guildId": str(detail.get("guildId") or detail.get("id") or ""),
                "guildName": core.clip_text(detail.get("name") or detail.get("guildName") or detail.get("guildId") or "", 120),
                "botName": core.clip_text(node.get("name") or "OmniFM", 80),
                "state": state,
                "sinceMs": since_ms,
                "durationSec": max(0, (now_ms - since_ms) // 1000) if since_ms else None,
                "stationName": core.clip_text(detail.get("stationName") or detail.get("stationKey") or "", 120),
                "desiredStationName": core.clip_text(detail.get("desiredStationName") or detail.get("desiredStationKey") or "", 120),
                "detail": core.clip_text(detail.get("parkedReason") or detail.get("failoverReason") or "", 200),
                "failbackNextProbeAt": max(0, core.parse_int(detail.get("failbackNextProbeAt"), 0)),
            })
    rows.sort(key=lambda row: row["sinceMs"] or now_ms)
    return rows


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
    duration_ms = core.parse_int(payload.get("failoverDurationMs"), 0)
    runtime = doc.get("runtime") if isinstance(doc.get("runtime"), dict) else {}
    return {
        "at": at,
        "guildId": str(doc.get("guildId") or ""),
        "guildName": core.clip_text(doc.get("guildName") or doc.get("guildId") or "", 120),
        "event": event,
        "kind": kind,
        "from": core.clip_text(from_name, 120),
        "to": core.clip_text(to_name, 120),
        "reason": core.clip_text(payload.get("triggerError") or payload.get("reason") or "", 240),
        "durationSec": duration_ms // 1000 if duration_ms > 0 else None,
        "runtime": core.clip_text(runtime.get("name") or doc.get("source") or "", 80),
    }


def read_runtime_logs(limit=500):
    """Newest log lines of every bot process (capped collection runtime_logs)."""
    if core.db is None:
        return []
    try:
        rows = list(core.db.runtime_logs.find({}, {"_id": 0}).sort("$natural", -1).limit(max(1, int(limit))))
    except Exception:
        return []
    return [{
        "at": row.get("at"),
        "level": row.get("level") or "INFO",
        "source": row.get("source") or row.get("process") or "runtime",
        "message": core.clip_text(row.get("message") or "", 240),
        "process": row.get("process"),
    } for row in rows]


def read_runtime_health_fresh(max_age_sec=30):
    """Liest die echte Runtime-Telemetrie (vom Node-Bot) aus MongoDB, wenn frisch."""
    if core.db is None:
        return None
    try:
        doc = core.db.runtime_health.find_one({"_id": "latest"}, {"_id": 0})
    except Exception:
        return None
    if not doc:
        return None
    dt = core._parse_iso_dt(doc.get("at"))
    if dt is None:
        return None
    if (datetime.now(timezone.utc) - dt).total_seconds() > max_age_sec:
        return None
    return doc


def live_runtime_totals():
    """Echte Live-Zahlen (0, wenn kein Bot laeuft) – EINE Quelle der Wahrheit."""
    doc = core.read_runtime_health_fresh()
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


def _read_guild_directory_entries(guild_ids, with_lists=False):
    """Per-server entries the bot writes on change into runtime_guild_directory."""
    if core.db is None or not guild_ids:
        return {}
    projection = None if with_lists else {"roles": 0, "voiceChannels": 0, "textChannels": 0}
    try:
        rows = core.db.runtime_guild_directory.find({"_id": {"$in": list(guild_ids)}}, projection)
        return {str(row.get("_id")): row for row in rows}
    except Exception:
        return {}


def _merge_guild_directory_fields(guild, source):
    if not guild["name"] and source.get("name"):
        guild["name"] = source.get("name")
    guild["memberCount"] = max(core.parse_int(guild.get("memberCount"), 0), core.parse_int(source.get("memberCount"), 0))
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
    live_doc = core.read_runtime_health_fresh()
    for node in (live_doc or {}).get("nodes", []):
        bot_name = str(node.get("name") or node.get("index") or "Bot")
        inline = {}
        for detail in node.get("guildDetails") or []:
            if isinstance(detail, dict):
                inline[str(detail.get("guildId") or detail.get("id") or "").strip()] = detail
        member_ids = [str(item or "").strip() for item in node.get("guildIds") or []] + list(inline.keys())
        for guild_id in member_ids:
            if not core.is_valid_server_id(guild_id) or (wanted is not None and guild_id not in wanted):
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
            core._merge_guild_directory_fields(guild, inline.get(guild_id) or {})
            if bot_name not in guild["bots"]:
                guild["bots"].append(bot_name)
            guilds[guild_id] = guild
    entries = core._read_guild_directory_entries(list(guilds.keys()), with_lists=with_lists)
    for guild_id, guild in guilds.items():
        core._merge_guild_directory_fields(guild, entries.get(guild_id) or {})
        guild["name"] = str(guild["name"] or guild_id)[:120]
        guild["bots"] = sorted(set(guild["bots"]))
    return guilds


__all__ = [
    "build_node_proxy_headers",
    "build_node_proxy_response",
    "_forward_to_node_api",
    "proxy_to_node_api",
    "install_node_dashboard_proxy",
    "node_api_reachable",
    "format_runtime_incident",
    "build_affected_servers",
    "format_failover_history_row",
    "read_runtime_logs",
    "read_runtime_health_fresh",
    "live_runtime_totals",
    "_read_guild_directory_entries",
    "_merge_guild_directory_fields",
    "_runtime_guild_directory",
]
