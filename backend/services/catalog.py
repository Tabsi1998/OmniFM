"""Stations, bots and seed data: catalog file, bot configuration, demo data and
bot directory status.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from urllib.parse import urlparse
from datetime import datetime
from datetime import timezone
import json
import os
import re
import requests
import time

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def load_stations_from_file():
    fallback = {"defaultStationKey": None, "stations": {}, "qualityPreset": "custom"}
    if not core.STATIONS_FILE.exists():
        return fallback
    try:
        with open(core.STATIONS_FILE, "r", encoding="utf-8") as f:
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
        color = core.BOT_COLORS[(i - 1) % len(core.BOT_COLORS)]
        img = core.BOT_IMAGES[(i - 1) % len(core.BOT_IMAGES)] if i <= len(core.BOT_IMAGES) else ""
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
        disc = core.get_config_section("discord")
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
                "color": core.BOT_COLORS[(idx - 1) % len(core.BOT_COLORS)],
                "avatarUrl": core.BOT_IMAGES[(idx - 1) % len(core.BOT_IMAGES)] if idx <= len(core.BOT_IMAGES) else "",
                "servers": 0, "users": 0, "connections": 0, "listeners": 0,
                "ready": False, "userTag": None, "uptimeSec": 0, "guildDetails": [],
            })

    return bots


def seed_stations_if_empty():
    if core.db is None:
        return
    try:
        if core.db.stations.count_documents({}) == 0:
            file_data = core.load_stations_from_file()
            stations_list = []
            file_stations = file_data.get("stations", {})
            for key, val in file_stations.items():
                stations_list.append({
                    "key": key,
                    "name": val.get("name", key),
                    "url": val.get("url", ""),
                    "tier": val.get("tier", "free"),
                    **core.station_catalog_fields(val),
                    "is_default": key == file_data.get("defaultStationKey"),
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            if stations_list:
                core.db.stations.insert_many(stations_list)
    except Exception:
        # Mongo is optional for this API process.
        return


HEX_COLOR = re.compile(r"^#?([0-9a-fA-F]{6})$")
CATALOG_FIELDS = ("genre", "country", "language", "color", "logo", "homepage")

# Streams the catalog audit of 2026-09-25 found dead or playing something
# else (#267). Replaced in MongoDB only where the old URL is still stored, so
# a URL the owner changed on purpose stays.
REPLACED_STREAMS = {
    "pro_edm_06": ("https://streams.ilovemusic.de/iloveradio103.mp3", "https://stream.technolovers.fm/edm"),
    "pro_tech_15": ("http://lw2.mp3.tb-group.fm/tb.mp3", "https://streams.rautemusik.fm/harder/mp3-192/"),
    "pro_tech_20": ("https://ice4.somafm.com/scanner-128-mp3", "https://stream.technolovers.fm/dark-techno"),
    "pro_house_06": ("https://ice4.somafm.com/7soul-128-mp3", "https://streams.rautemusik.fm/house/mp3-192/"),
    "pro_house_12": ("https://radio.edm1.fm/proxy/15_clubhouse?mp=/stream", "http://radio.edm1.fm/proxy/15_clubhouse?mp=/stream"),
}


def _https_url(value, limit=500):
    text = str(value or "").strip()
    if not text or len(text) > limit:
        return ""
    parsed = urlparse(text)
    return text if parsed.scheme == "https" and parsed.netloc else ""


def station_catalog_fields(raw):
    """Genre, country, language, colour, logo and homepage of a station (#267),
    cleaned like src/lib/station-fields.js: only https links and #RRGGBB
    colours; empty fields are left out."""
    raw = raw if isinstance(raw, dict) else {}
    color = HEX_COLOR.match(str(raw.get("color") or "").strip())
    fields = {
        "genre": core.clip_text(raw.get("genre") or raw.get("category") or "", 80).strip() or "Radio",
        "country": core.clip_text(raw.get("country") or "", 60).strip(),
        "language": core.clip_text(raw.get("language") or "", 40).strip(),
        "color": f"#{color.group(1).upper()}" if color else "",
        "logo": _https_url(raw.get("logo")),
        "homepage": _https_url(raw.get("homepage")),
    }
    return {key: value for key, value in fields.items() if value}


def catalog_updates_for(doc, file_station):
    """What a catalog file entry adds to a stored station: only fields the
    owner has not set (genre "Radio" counts as unset), plus a replaced stream
    when the stored URL is the broken one."""
    updates = {}
    wanted = station_catalog_fields(file_station)
    for field in CATALOG_FIELDS:
        current = doc.get(field)
        if field == "genre" and str(current or "").strip() in ("", "Radio"):
            current = None
        if not current and wanted.get(field):
            updates[field] = wanted[field]
    replacement = REPLACED_STREAMS.get(str(doc.get("key") or ""))
    if replacement and str(doc.get("url") or "").strip() == replacement[0]:
        updates["url"] = replacement[1]
    return updates


def fill_station_catalog_fields():
    """Adds the catalog fields of stations.json to stations already in
    MongoDB; runs at every start and changes nothing once filled."""
    if core.db is None:
        return 0
    try:
        file_stations = (core.load_stations_from_file() or {}).get("stations", {})
        changed = 0
        for doc in core.db.stations.find({"key": {"$in": list(file_stations.keys())}}):
            updates = catalog_updates_for(doc, file_stations.get(doc.get("key")) or {})
            if updates:
                updates["updated_at"] = datetime.now(timezone.utc).isoformat()
                core.db.stations.update_one({"_id": doc["_id"]}, {"$set": updates})
                changed += 1
        return changed
    except Exception:
        # Mongo is optional for this API process.
        return 0


# Seed premium data to MongoDB
def seed_premium_if_needed():
    if core.db is None:
        return
    try:
        if core.db.licenses.count_documents({}) == 0 and core.PREMIUM_FILE.exists():
            data = core.ensure_premium_state(json.loads(core.PREMIUM_FILE.read_text(encoding="utf-8")))
            if isinstance(data, dict):
                licenses = data.get("licenses", {})
                for lic_id, lic in licenses.items():
                    if isinstance(lic, dict):
                        lic["_licenseId"] = lic_id
                        core.db.licenses.replace_one({"_licenseId": lic_id}, lic, upsert=True)
                entitlements = data.get("serverEntitlements", {})
                for srv_id, ent in entitlements.items():
                    if isinstance(ent, dict):
                        ent["_serverId"] = srv_id
                        core.db.server_entitlements.replace_one({"_serverId": srv_id}, ent, upsert=True)
                sessions = data.get("processedSessions", {})
                for sess_id, sess in sessions.items():
                    if isinstance(sess, dict):
                        sess["_sessionId"] = sess_id
                        core.db.processed_sessions.replace_one({"_sessionId": sess_id}, sess, upsert=True)
                events = data.get("processedEvents", {})
                for event_id, event in events.items():
                    if isinstance(event, dict):
                        event["_eventId"] = event_id
                        core.db.processed_events.replace_one({"_eventId": event_id}, event, upsert=True)
                extra_state = {
                    "trialClaims": data.get("trialClaims", {}),
                    "offers": data.get("offers", {}),
                    "discordBotListState": data.get("discordBotListState", {}),
                    "recentRedemptions": data.get("recentRedemptions", []),
                }
                core.db.premium_state.replace_one({"_id": "meta"}, {"_id": "meta", **extra_state}, upsert=True)
    except Exception:
        pass


# Demo-Lizenzen/-Entitlements NUR seeden, wenn ausdrücklich aktiviert (nicht im Live-Betrieb).
def seed_demo_enabled() -> bool:
    return (os.environ.get("SEED_DEMO_DATA") or "").strip().lower() in ("1", "true", "yes")


def purge_demo_data_if_live():
    """Entfernt beim Live-Betrieb übrig gebliebene Demo-Dokumente (idempotent, sicher)."""
    if core.db is None:
        return
    if core.seed_demo_enabled():
        return
    try:
        rx = {"$regex": "^demo-", "$options": "i"}
        removed = core.db.licenses.delete_many({"_licenseId": rx}).deleted_count
        core.db.server_entitlements.delete_many({"_serverId": rx})
        core.db.processed_sessions.delete_many({"_sessionId": rx})
        if removed:
            print(f"[live] Demo-Lizenzen entfernt: {removed}")
    except Exception:
        pass


def get_discordbotlist_status(vote_limit=20):
    token = str(core.directory_setting("discordBotList", "token", "DISCORDBOTLIST_TOKEN") or "").strip()
    explicit_bot_id = str(core.directory_setting("discordBotList", "botId", "DISCORDBOTLIST_BOT_ID") or "").strip()
    commander_bot_id = (os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    bot_id = explicit_bot_id or commander_bot_id
    configured = core.config_bool(core.directory_setting("discordBotList", "enabled", "DISCORDBOTLIST_ENABLED", bool(token))) and bool(token) and bool(re.match(r"^\d{17,22}$", bot_id))
    stats_scope = "aggregate" if str(core.directory_setting("discordBotList", "statsScope", "DISCORDBOTLIST_STATS_SCOPE", "aggregate")).strip().lower() == "aggregate" else "commander"

    data = core.load_premium()
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
                "totalVotes": core.parse_int(state.get("votes", {}).get("totalVotes"), 0) if isinstance(state.get("votes"), dict) else 0,
                "recent": recent_votes[: max(0, int(vote_limit))],
            },
        },
    }


def _station_summary():
    free_count = 0
    pro_count = 0
    sample = []
    if core.db is not None:
        try:
            free_count = core.db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": "free"})
            pro_count = core.db.stations.count_documents({"key": {"$not": {"$regex": "^custom:"}}, "tier": "pro"})
            for doc in core.db.stations.find({"key": {"$not": {"$regex": "^custom:"}}}, {"_id": 0}).limit(60):
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
        data = core.load_stations_from_file()
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


def get_bot_directory_config_status(directory, enabled_env, token_env, bot_id_env):
    enabled = core.config_bool(core.directory_setting(directory, "enabled", enabled_env, False))
    token = str(core.directory_setting(directory, "token", token_env) or "").strip()
    bot_id = str(core.directory_setting(directory, "botId", bot_id_env) or "").strip()
    return {
        "enabled": enabled,
        "configured": enabled and bool(token) and bool(re.match(r"^\d{17,22}$", bot_id)),
        "botId": bot_id or None,
    }


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
        return {"ok": False, "reachable": False, "discordOk": False, "status": 0, "latencyMs": int((time.time() - started) * 1000), "message": core.clip_text(e, 80)}


__all__ = [
    "load_stations_from_file",
    "load_bots_from_env",
    "seed_stations_if_empty",
    "station_catalog_fields",
    "catalog_updates_for",
    "fill_station_catalog_fields",
    "seed_premium_if_needed",
    "seed_demo_enabled",
    "purge_demo_data_if_live",
    "get_discordbotlist_status",
    "_station_summary",
    "get_bot_directory_config_status",
    "_read_json_list",
    "_probe_station_url",
]
