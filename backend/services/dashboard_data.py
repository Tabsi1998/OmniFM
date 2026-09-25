"""Dashboard data: scheduled events, permissions, telemetry and guild statistics.

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from zoneinfo import ZoneInfo
import calendar
import json
import re
import secrets
import time

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def load_dashboard_data():
    default_data = {
        "events": {},
        "perms": {},
        "telemetry": {},
    }

    if core.db is not None:
        try:
            doc = core.db.dashboard_state.find_one({"_id": "dashboard_state"}, {"_id": 0})
            if isinstance(doc, dict):
                return {
                    "events": doc.get("events", {}),
                    "perms": doc.get("perms", {}),
                    "telemetry": doc.get("telemetry", {}),
                }
        except Exception:
            pass

    if core.DASHBOARD_FILE.exists():
        try:
            payload = json.loads(core.DASHBOARD_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return {
                    "events": payload.get("events", {}),
                    "perms": payload.get("perms", {}),
                    "telemetry": payload.get("telemetry", {}),
                }
        except Exception:
            pass
    return default_data


def save_dashboard_data(payload):
    safe_payload = {
        "events": payload.get("events", {}) if isinstance(payload, dict) else {},
        "perms": payload.get("perms", {}) if isinstance(payload, dict) else {},
        "telemetry": payload.get("telemetry", {}) if isinstance(payload, dict) else {},
    }
    if core.db is not None:
        try:
            core.db.dashboard_state.update_one(
                {"_id": "dashboard_state"},
                {"$set": safe_payload},
                upsert=True,
            )
            return
        except Exception:
            pass
    try:
        core.DASHBOARD_FILE.write_text(json.dumps(safe_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def normalize_dashboard_event(event_payload):
    payload = event_payload if isinstance(event_payload, dict) else {}
    event_id = re.sub(r"[^a-z0-9_-]", "", str(payload.get("id") or f"evt_{int(time.time() * 1000):x}{secrets.token_hex(3)}").strip().lower())[:40]
    title = core.clip_text(payload.get("title") or payload.get("name") or "OmniFM Event", 120).strip()
    station_key = re.sub(r"[^a-z0-9:_-]", "", str(payload.get("stationKey") or payload.get("station") or "").strip().lower())[:120]
    timezone_name = core.clip_text(payload.get("timezone") or payload.get("timeZone") or "Europe/Vienna", 80)
    event_timezone = core.dashboard_event_zone(timezone_name)
    channel_id = str(payload.get("voiceChannelId") or payload.get("channelId") or "").strip()
    text_channel_id = str(payload.get("textChannelId") or "").strip()
    enabled = payload.get("enabled") is not False
    now_iso = datetime.now(timezone.utc).isoformat()
    run_at_ms = core.parse_int(payload.get("runAtMs"), 0)
    if run_at_ms <= 0:
        starts_at = str(payload.get("startsAtLocal") or payload.get("startsAt") or payload.get("startAt") or "").strip()
        if not starts_at:
            raise ValueError("Startzeit ist erforderlich.")
        try:
            parsed_start = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
            if parsed_start.tzinfo is None:
                parsed_start = parsed_start.replace(tzinfo=event_timezone)
            run_at_ms = int(parsed_start.timestamp() * 1000)
        except Exception as exc:
            raise ValueError("Startzeit oder Zeitzone ist ungültig.") from exc
    repeat = str(payload.get("repeat") or "none").strip().lower()
    supported_repeat = {"none", "daily", "weekdays", "weekly", "biweekly", "yearly", "monthly_first_weekday", "monthly_second_weekday", "monthly_third_weekday", "monthly_fourth_weekday", "monthly_last_weekday"}
    if repeat not in supported_repeat:
        repeat = "none"
    duration_ms = core.parse_int(payload.get("durationMs"), 0)
    if duration_ms <= 0:
        duration_ms = max(0, min(525600, core.parse_int(payload.get("durationMinutes"), 0))) * 60 * 1000
    return {
        "id": event_id,
        "guildId": str(payload.get("guildId") or "").strip(),
        "botId": core.clip_text(payload.get("botId") or "bot-1", 60),
        "name": title,
        "stationKey": station_key,
        "voiceChannelId": channel_id,
        "textChannelId": text_channel_id or None,
        "announceMessage": core.clip_text(payload.get("announceMessage") or "", 1200) or None,
        "description": core.clip_text(payload.get("description") or "", 1000) or None,
        "stageTopic": core.clip_text(payload.get("stageTopic") or "", 120) or None,
        "timeZone": timezone_name,
        "createDiscordEvent": payload.get("createDiscordEvent") is True,
        "discordScheduledEventId": payload.get("discordScheduledEventId") or None,
        "discordSyncError": payload.get("discordSyncError") or None,
        "repeat": repeat,
        "runAtMs": run_at_ms,
        "durationMs": duration_ms,
        "activeUntilMs": max(0, core.parse_int(payload.get("activeUntilMs"), 0)),
        "enabled": enabled,
        "lastRunAtMs": max(0, core.parse_int(payload.get("lastRunAtMs"), 0)),
        "lastStopAtMs": max(0, core.parse_int(payload.get("lastStopAtMs"), 0)),
        "deleteAfterStop": payload.get("deleteAfterStop") is True,
        "createdByUserId": str(payload.get("createdByUserId") or "").strip() or None,
        "updatedAt": now_iso,
        "createdAt": core.clip_text(payload.get("createdAt") or now_iso, 80),
    }


def dashboard_event_response(event):
    row = event if isinstance(event, dict) else {}
    run_at_ms = max(0, core.parse_int(row.get("runAtMs"), 0))
    starts_at = datetime.fromtimestamp(run_at_ms / 1000, timezone.utc).isoformat() if run_at_ms else None
    timezone_name = row.get("timeZone") or "Europe/Vienna"
    discord_scheduled_event_id = str(row.get("discordScheduledEventId") or "").strip() or None
    discord_sync_error = core.clip_text(row.get("discordSyncError") or "", 300) or None
    return {
        **{key: value for key, value in row.items() if key not in ("_id", "_eventId")},
        "title": row.get("name") or "OmniFM Event",
        "channelId": row.get("voiceChannelId") or "",
        "timezone": timezone_name,
        "startsAt": starts_at,
        "startsAtLocal": core.format_dashboard_event_local(run_at_ms, timezone_name),
        "repeatLabelDe": core.dashboard_event_repeat_label(row.get("repeat"), "de", run_at_ms, timezone_name),
        "repeatLabelEn": core.dashboard_event_repeat_label(row.get("repeat"), "en", run_at_ms, timezone_name),
        "durationMinutes": round(max(0, core.parse_int(row.get("durationMs"), 0)) / 60000),
        "announceMessage": row.get("announceMessage") or "",
        "description": row.get("description") or "",
        "stageTopic": row.get("stageTopic") or "",
        "discordScheduledEventId": discord_scheduled_event_id,
        "discordEventSynced": row.get("createDiscordEvent") is True and bool(discord_scheduled_event_id) and not discord_sync_error,
        "discordSyncError": discord_sync_error,
    }


def dashboard_event_zone(timezone_name):
    try:
        return ZoneInfo(str(timezone_name or "Europe/Vienna"))
    except Exception as exc:
        raise ValueError("Startzeit oder Zeitzone ist ungültig.") from exc


def format_dashboard_event_local(run_at_ms, timezone_name):
    value = max(0, core.parse_int(run_at_ms, 0))
    if not value:
        return ""
    return datetime.fromtimestamp(value / 1000, timezone.utc).astimezone(core.dashboard_event_zone(timezone_name)).strftime("%Y-%m-%dT%H:%M")


def dashboard_event_repeat_label(repeat, language, run_at_ms=0, timezone_name="Europe/Vienna"):
    mode = str(repeat or "none").strip().lower()
    is_de = core.normalize_language(language, "de") == "de"
    local_start = None
    if core.parse_int(run_at_ms, 0) > 0:
        local_start = datetime.fromtimestamp(core.parse_int(run_at_ms, 0) / 1000, timezone.utc).astimezone(core.dashboard_event_zone(timezone_name))
    weekday_de = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
    weekday_en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    weekday = (weekday_de if is_de else weekday_en)[local_start.weekday()] if local_start else ("Wochentag" if is_de else "weekday")
    if mode == "daily":
        return "Jeden Tag" if is_de else "Every day"
    if mode == "weekdays":
        return "Werktäglich (Montag bis Freitag)" if is_de else "Weekdays (Monday to Friday)"
    if mode == "weekly":
        return f"Jeden {weekday}" if is_de else f"Every {weekday}"
    if mode == "biweekly":
        return f"Alle 2 Wochen ({weekday})" if is_de else f"Every 2 weeks ({weekday})"
    if mode in core.MONTHLY_EVENT_REPEAT_NTH:
        nth = core.MONTHLY_EVENT_REPEAT_NTH[mode]
        if nth == -1:
            return f"Jeden letzten {weekday} im Monat" if is_de else f"Every last {weekday} of the month"
        ordinal_en = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}.get(nth, f"{nth}th")
        return f"Jeden {nth}. {weekday} im Monat" if is_de else f"Every {ordinal_en} {weekday} of the month"
    if mode == "yearly":
        if not local_start:
            return "Jährlich" if is_de else "Yearly"
        if is_de:
            return f"Jährlich am {local_start.day:02d}.{local_start.month:02d}."
        return f"Yearly on {local_start.strftime('%B')} {local_start.day}"
    return "Einmalig" if is_de else "Once"


def next_dashboard_event_run_ms(run_at_ms, repeat, timezone_name="Europe/Vienna"):
    value = max(0, core.parse_int(run_at_ms, 0))
    mode = str(repeat or "none").strip().lower()
    if not value or mode == "none":
        return 0
    tz = core.dashboard_event_zone(timezone_name)
    local_start = datetime.fromtimestamp(value / 1000, timezone.utc).astimezone(tz)
    if mode in {"daily", "weekdays", "weekly", "biweekly"}:
        step_days = 7 if mode == "weekly" else 14 if mode == "biweekly" else 1
        candidate = local_start + timedelta(days=step_days)
        while mode == "weekdays" and candidate.weekday() >= 5:
            candidate += timedelta(days=1)
        return int(candidate.timestamp() * 1000)
    if mode == "yearly":
        year = local_start.year + 1
        while year < local_start.year + 401:
            try:
                return int(local_start.replace(year=year).timestamp() * 1000)
            except ValueError:
                year += 1
        return 0
    nth = core.MONTHLY_EVENT_REPEAT_NTH.get(mode)
    if nth is None:
        return 0
    month = 1 if local_start.month == 12 else local_start.month + 1
    year = local_start.year + 1 if local_start.month == 12 else local_start.year
    _, last_day = calendar.monthrange(year, month)
    if nth == -1:
        day = last_day
        while datetime(year, month, day).weekday() != local_start.weekday():
            day -= 1
    else:
        first_weekday = datetime(year, month, 1).weekday()
        day = 1 + ((local_start.weekday() - first_weekday) % 7) + ((nth - 1) * 7)
        if day > last_day:
            return core.next_dashboard_event_run_ms(
                int(local_start.replace(year=year, month=month, day=last_day).timestamp() * 1000),
                repeat,
                timezone_name,
            )
    candidate = datetime(year, month, day, local_start.hour, local_start.minute, tzinfo=tz)
    return int(candidate.timestamp() * 1000)


def build_dashboard_event_preview_rows(event, limit=5):
    row = event if isinstance(event, dict) else {}
    safe_limit = max(1, min(10, core.parse_int(limit, 5)))
    run_at_ms = max(0, core.parse_int(row.get("runAtMs"), 0))
    duration_ms = max(0, core.parse_int(row.get("durationMs"), 0))
    timezone_name = row.get("timeZone") or row.get("timezone") or "Europe/Vienna"
    repeat = row.get("repeat") or "none"
    result = []
    for _ in range(safe_limit):
        if not run_at_ms:
            break
        end_at_ms = run_at_ms + duration_ms if duration_ms > 0 else 0
        result.append({
            "runAtMs": run_at_ms,
            "durationMs": duration_ms,
            "startsAt": datetime.fromtimestamp(run_at_ms / 1000, timezone.utc).isoformat(),
            "startsAtLocal": core.format_dashboard_event_local(run_at_ms, timezone_name),
            "endsAt": datetime.fromtimestamp(end_at_ms / 1000, timezone.utc).isoformat() if end_at_ms else "",
            "endsAtLocal": core.format_dashboard_event_local(end_at_ms, timezone_name) if end_at_ms else "",
        })
        run_at_ms = core.next_dashboard_event_run_ms(run_at_ms, repeat, timezone_name)
    return result


def build_dashboard_event_conflicts(candidate, existing_events, language="de", ignore_event_id=""):
    candidate_rows = core.build_dashboard_event_preview_rows(candidate, 5)
    candidate_duration = max(0, core.parse_int(candidate.get("durationMs"), 0))
    conflicts = []
    seen = set()
    for existing in existing_events if isinstance(existing_events, list) else []:
        if not isinstance(existing, dict) or existing.get("enabled") is False:
            continue
        if str(existing.get("id") or "") == str(ignore_event_id or ""):
            continue
        if str(existing.get("voiceChannelId") or "") != str(candidate.get("voiceChannelId") or ""):
            continue
        existing_rows = core.build_dashboard_event_preview_rows(existing, 5)
        existing_duration = max(0, core.parse_int(existing.get("durationMs"), 0))
        for candidate_row in candidate_rows:
            for existing_row in existing_rows:
                severity = ""
                if candidate_duration > 0 and existing_duration > 0:
                    overlaps = candidate_row["runAtMs"] < existing_row["runAtMs"] + existing_duration and existing_row["runAtMs"] < candidate_row["runAtMs"] + candidate_duration
                    if not overlaps:
                        continue
                    severity = "error"
                    message = f'Überschneidet sich mit „{existing.get("name") or "Event"}“ im selben Voice-Kanal.' if language == "de" else f'Overlaps with "{existing.get("name") or "Event"}" in the same voice channel.'
                elif candidate_duration <= 0 and existing_row["runAtMs"] >= candidate_row["runAtMs"]:
                    severity = "warning"
                    message = f'Dieses Event hat keine Endzeit und könnte „{existing.get("name") or "Event"}“ blockieren.' if language == "de" else f'This event has no end time and may block "{existing.get("name") or "Event"}."'
                elif existing_duration <= 0 and existing_row["runAtMs"] <= candidate_row["runAtMs"]:
                    severity = "warning"
                    message = f'„{existing.get("name") or "Event"}“ hat keine Endzeit und könnte dieses Event blockieren.' if language == "de" else f'"{existing.get("name") or "Event"}" has no end time and may block this event.'
                else:
                    continue
                key = (str(existing.get("id") or ""), candidate_row["runAtMs"], existing_row["runAtMs"], severity)
                if key in seen:
                    continue
                seen.add(key)
                existing_response = core.dashboard_event_response(existing)
                conflicts.append({
                    "severity": severity,
                    "message": message,
                    "eventId": existing_response.get("id"),
                    "title": existing_response.get("title"),
                    "repeat": existing_response.get("repeat"),
                    "repeatLabelDe": existing_response.get("repeatLabelDe"),
                    "repeatLabelEn": existing_response.get("repeatLabelEn"),
                    "startsAt": existing_row.get("startsAt"),
                    "startsAtLocal": existing_row.get("startsAtLocal"),
                    "endsAt": existing_row.get("endsAt"),
                    "endsAtLocal": existing_row.get("endsAtLocal"),
                    "channelId": existing_response.get("channelId"),
                })
    return sorted(conflicts, key=lambda item: (0 if item.get("severity") == "error" else 1, item.get("startsAt") or ""))


def dashboard_event_runtime_id(guild_id):
    live_doc = core.read_runtime_health_fresh()
    nodes = (live_doc or {}).get("nodes") or []
    candidates = [
        node for node in nodes
        if str(guild_id) in {str(item) for item in node.get("guildIds") or []}
        or any(str(detail.get("guildId") or detail.get("id") or "") == str(guild_id) for detail in node.get("guildDetails") or [])
    ]
    commander = next((node for node in candidates if node.get("role") == "commander"), None)
    selected = commander or (candidates[0] if candidates else {})
    return str(selected.get("runtimeId") or "bot-1").strip() or "bot-1"


def validate_dashboard_event(guild_id, event):
    if not event.get("name"):
        raise ValueError("Event-Name ist erforderlich.")
    if not event.get("stationKey"):
        raise ValueError("Sender ist erforderlich.")
    if not core.is_valid_server_id(event.get("voiceChannelId")):
        raise ValueError("Gültiger Voice-Kanal ist erforderlich.")
    directory = core._runtime_guild_directory([guild_id], with_lists=True).get(guild_id) or {}
    known_voice_ids = {str(row.get("id") or "") for row in directory.get("voiceChannels") or []}
    if known_voice_ids and event.get("voiceChannelId") not in known_voice_ids:
        raise ValueError("Voice-Kanal gehört nicht zu diesem Server.")
    text_channel_id = event.get("textChannelId")
    known_text_ids = {str(row.get("id") or "") for row in directory.get("textChannels") or []}
    if text_channel_id and (not core.is_valid_server_id(text_channel_id) or (known_text_ids and text_channel_id not in known_text_ids)):
        raise ValueError("Text-Kanal gehört nicht zu diesem Server.")
    key = str(event.get("stationKey") or "")
    if key.startswith("custom:"):
        custom_key = key.split(":", 1)[1]
        exists = core.db is not None and core.db.custom_stations.find_one({"guildId": guild_id, "key": custom_key}, {"_id": 1}) is not None
    else:
        exists = core.db is not None and core.db.stations.find_one({"key": key}, {"_id": 1}) is not None
        if not exists:
            exists = key in (core.load_stations_from_file().get("stations") or {})
    if not exists:
        raise ValueError("Sender wurde nicht gefunden.")


def dashboard_event_station_name(guild_id, station_key):
    key = str(station_key or "").strip()
    if key.startswith("custom:"):
        custom_key = key.split(":", 1)[1]
        if core.db is not None:
            row = core.db.custom_stations.find_one({"guildId": str(guild_id), "key": custom_key}, {"_id": 0, "name": 1})
            if isinstance(row, dict) and row.get("name"):
                return str(row.get("name"))
        return custom_key
    if core.db is not None:
        row = core.db.stations.find_one({"key": key}, {"_id": 0, "name": 1})
        if isinstance(row, dict) and row.get("name"):
            return str(row.get("name"))
    file_row = (core.load_stations_from_file().get("stations") or {}).get(key) or {}
    return str(file_row.get("name") or key)


def normalize_dashboard_perms(payload):
    body = payload if isinstance(payload, dict) else {}
    incoming = body.get("commandRoleMap") if isinstance(body.get("commandRoleMap"), dict) else {}
    supported = {"play", "pause", "resume", "stop", "setvolume", "sleep", "stations", "list", "now", "stats", "history", "status", "health", "diag", "addstation", "removestation", "mystations", "event"}
    normalized = {}
    for raw_command, raw_roles in incoming.items():
        command = core.clip_text(raw_command, 64).lstrip("/").lower()
        if command not in supported:
            continue
        roles = []
        if isinstance(raw_roles, list):
            for role in raw_roles:
                role_id = str(role or "").strip()
                if core.is_valid_server_id(role_id) and role_id not in roles:
                    roles.append(role_id)
        if roles:
            normalized[command] = roles
    return {
        "commandRoleMap": normalized,
        "commands": {command: {"allowRoleIds": role_ids, "denyRoleIds": []} for command, role_ids in normalized.items()},
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def dashboard_permission_response(document):
    row = document if isinstance(document, dict) else {}
    commands = row.get("commands") if isinstance(row.get("commands"), dict) else {}
    command_role_map = {}
    for command, rule in commands.items():
        if not isinstance(rule, dict):
            continue
        role_ids = []
        for role_id in rule.get("allowRoleIds") or []:
            normalized_id = str(role_id or "").strip()
            if core.is_valid_server_id(normalized_id) and normalized_id not in role_ids:
                role_ids.append(normalized_id)
        if role_ids:
            command_role_map[str(command)] = role_ids
    return {"commandRoleMap": command_role_map, "commands": commands, "updatedAt": row.get("updatedAt")}


def normalize_dashboard_telemetry(payload):
    body = payload if isinstance(payload, dict) else {}
    listeners_now = max(0, core.parse_int(body.get("listenersNow"), 0))
    active_streams = max(0, core.parse_int(body.get("activeStreams"), 0))
    peak_listeners = max(0, core.parse_int(body.get("peakListeners"), listeners_now))
    peak_time = core.clip_text(body.get("peakTime") or datetime.now(timezone.utc).isoformat(), 80)
    top_station_name = core.clip_text((body.get("topStation") or {}).get("name") if isinstance(body.get("topStation"), dict) else body.get("topStationName"), 120)
    top_station_listeners = max(0, core.parse_int((body.get("topStation") or {}).get("listeners") if isinstance(body.get("topStation"), dict) else body.get("topStationListeners"), 0))

    listeners_by_channel = []
    raw_channels = body.get("listenersByChannel") if isinstance(body.get("listenersByChannel"), list) else []
    for item in raw_channels[:20]:
        if not isinstance(item, dict):
            continue
        listeners_by_channel.append({
            "name": core.clip_text(item.get("name") or item.get("channel") or "Voice", 80),
            "listeners": max(0, core.parse_int(item.get("listeners"), 0)),
        })

    daily_report = []
    raw_daily = body.get("dailyReport") if isinstance(body.get("dailyReport"), list) else body.get("daily") if isinstance(body.get("daily"), list) else []
    for item in raw_daily[:31]:
        if not isinstance(item, dict):
            continue
        day_key = core.clip_text(item.get("day"), 20)
        if not day_key:
            continue
        daily_report.append({
            "day": day_key,
            "starts": max(0, core.parse_int(item.get("starts"), 0)),
            "peakListeners": max(0, core.parse_int(item.get("peakListeners"), 0)),
        })

    station_breakdown = []
    raw_station_breakdown = body.get("stationBreakdown") if isinstance(body.get("stationBreakdown"), list) else []
    for item in raw_station_breakdown[:20]:
        if not isinstance(item, dict):
            continue
        station_breakdown.append({
            "name": core.clip_text(item.get("name") or item.get("station") or "Station", 80),
            "starts": max(0, core.parse_int(item.get("starts"), 0)),
            "peakListeners": max(0, core.parse_int(item.get("peakListeners"), 0)),
        })

    return {
        "listenersNow": listeners_now,
        "activeStreams": active_streams,
        "peakListeners": peak_listeners,
        "peakTime": peak_time,
        "topStation": {
            "name": top_station_name or "-",
            "listeners": top_station_listeners,
        },
        "listenersByChannel": listeners_by_channel,
        "dailyReport": daily_report,
        "stationBreakdown": station_breakdown,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def get_dashboard_guild_stats(server_id, tier):
    dashboard_data = core.load_dashboard_data()
    events_map = dashboard_data.get("events", {}) if isinstance(dashboard_data.get("events"), dict) else {}
    perms_map = dashboard_data.get("perms", {}) if isinstance(dashboard_data.get("perms"), dict) else {}
    telemetry_map = dashboard_data.get("telemetry", {}) if isinstance(dashboard_data.get("telemetry"), dict) else {}

    guild_events = events_map.get(server_id, []) if isinstance(events_map.get(server_id), list) else []
    if core.db is not None:
        try:
            guild_events = list(core.db.scheduled_events.find({"guildId": server_id}, {"_id": 0, "_eventId": 0}).limit(200))
        except Exception:
            pass
    guild_perms = perms_map.get(server_id, {}) if isinstance(perms_map.get(server_id), dict) else {}
    if core.db is not None:
        try:
            guild_perms = core.dashboard_permission_response(core.db.command_permissions.find_one({"_guildId": server_id}, {"_id": 0}) or {})
        except Exception:
            pass
    telemetry_raw = telemetry_map.get(server_id, {}) if isinstance(telemetry_map.get(server_id), dict) else {}
    telemetry = core.normalize_dashboard_telemetry(telemetry_raw)

    live_rows = []
    parked_rows = []
    live_doc = core.read_runtime_health_fresh()
    for node in (live_doc or {}).get("nodes", []):
        for detail in node.get("guildDetails") or []:
            detail_id = str(detail.get("guildId") or detail.get("id") or "").strip()
            if detail_id != server_id:
                continue
            row = {
                **detail,
                "botId": str(node.get("botId") or ""),
                "botIndex": core.parse_int(node.get("index"), 0),
                "botName": core.clip_text(node.get("name") or "OmniFM", 80),
                "botRole": str(node.get("role") or "worker"),
            }
            if detail.get("playing") is True or detail.get("voiceConnected") is True:
                live_rows.append(row)
            elif detail.get("parkedReason"):
                # A parked target plays nothing, but the server admin must see
                # it and why (#216).
                parked_rows.append(row)

    live_listeners = sum(max(0, core.parse_int(row.get("listenerCount"), 0)) for row in live_rows)
    live_top = None
    if live_rows:
        live_top_row = sorted(live_rows, key=lambda row: core.parse_int(row.get("listenerCount"), 0), reverse=True)[0]
        live_top = {
            "name": core.clip_text(live_top_row.get("stationName") or live_top_row.get("stationKey") or "-", 120),
            "listeners": max(0, core.parse_int(live_top_row.get("listenerCount"), 0)),
        }

    live_stream_details = []
    for row in sorted(live_rows + parked_rows, key=lambda item: (core.parse_int(item.get("botIndex"), 999), str(item.get("botName") or ""))):
        live_stream_details.append({
            "botId": str(row.get("botId") or ""),
            "botIndex": core.parse_int(row.get("botIndex"), 0),
            "botName": core.clip_text(row.get("botName") or "OmniFM", 80),
            "botRole": str(row.get("botRole") or "worker"),
            "stationKey": core.clip_text(row.get("stationKey") or "", 100),
            "stationName": core.clip_text(row.get("stationName") or row.get("stationKey") or "Unbekannter Sender", 120),
            "desiredStationKey": core.clip_text(row.get("desiredStationKey") or row.get("stationKey") or "", 100),
            "desiredStationName": core.clip_text(row.get("desiredStationName") or row.get("stationName") or row.get("stationKey") or "", 120),
            "failoverActive": row.get("failoverActive") is True,
            "failoverStartedAt": max(0, core.parse_int(row.get("failoverStartedAt"), 0)),
            "failoverReason": core.clip_text(row.get("failoverReason") or "", 300),
            "failoverFromStationKey": core.clip_text(row.get("failoverFromStationKey") or "", 100),
            "failoverFromStationName": core.clip_text(row.get("failoverFromStationName") or "", 120),
            "channelId": str(row.get("channelId") or ""),
            "channelName": core.clip_text(row.get("channelName") or row.get("channelId") or "Voice-Kanal", 120),
            "listeners": max(0, core.parse_int(row.get("listenerCount"), 0)),
            "volume": max(0, min(200, core.parse_int(row.get("volume"), 100))),
            "playing": row.get("playing") is True,
            "voiceConnected": row.get("voiceConnected") is True,
            "recovering": row.get("recovering") is True,
            "lastStreamStartAt": row.get("lastStreamStartAt"),
            "reconnectAttempts": max(0, core.parse_int(row.get("reconnectAttempts"), 0)),
            "streamErrorCount": max(0, core.parse_int(row.get("streamErrorCount"), 0)),
            "failbackNextProbeAt": max(0, core.parse_int(row.get("failbackNextProbeAt"), 0)),
            "parkedReason": core.clip_text(row.get("parkedReason") or "", 40) or None,
            "parkedAt": max(0, core.parse_int(row.get("parkedAt"), 0)),
            "serverMuted": row.get("serverMuted") is True,
        })

    process_uptime_sec = max(0, core.parse_int(((live_doc or {}).get("process") or {}).get("uptimeSec"), 0))
    total_listening_ms = 0
    if core.db is not None:
        try:
            guild_stat = core.db.guild_stats.find_one({"guildId": server_id}, {"_id": 0, "totalListeningMs": 1})
            total_listening_ms = max(0, core.parse_int((guild_stat or {}).get("totalListeningMs"), 0))
        except Exception:
            total_listening_ms = 0

    active_events = len([item for item in guild_events if isinstance(item, dict) and item.get("enabled") is not False])
    basic = {
        "listenersNow": live_listeners if live_doc else telemetry.get("listenersNow", 0),
        "activeStreams": len(live_rows) if live_doc else telemetry.get("activeStreams", 0),
        "peakListeners": max(live_listeners, telemetry.get("peakListeners", 0)),
        "peakTime": telemetry.get("peakTime"),
        "topStation": live_top or telemetry.get("topStation", {"name": "-", "listeners": 0}),
        "activeStreamDetails": live_stream_details,
        "runtimeUptimeSec": process_uptime_sec if live_doc else 0,
        "totalListeningMs": total_listening_ms,
        "eventsConfigured": len(guild_events),
        "eventsActive": active_events,
        "permRules": len((guild_perms.get("commandRoleMap") or {}).keys()) if isinstance(guild_perms.get("commandRoleMap"), dict) else 0,
        "updatedAt": telemetry.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
    }

    if tier != "ultimate":
        return {"basic": basic, "advanced": None}

    advanced = {
        "listenersByChannel": telemetry.get("listenersByChannel", []),
        "dailyReport": telemetry.get("dailyReport", []),
        "stationBreakdown": telemetry.get("stationBreakdown", []),
    }
    return {"basic": basic, "advanced": advanced}


__all__ = [
    "load_dashboard_data",
    "save_dashboard_data",
    "normalize_dashboard_event",
    "dashboard_event_response",
    "dashboard_event_zone",
    "format_dashboard_event_local",
    "dashboard_event_repeat_label",
    "next_dashboard_event_run_ms",
    "build_dashboard_event_preview_rows",
    "build_dashboard_event_conflicts",
    "dashboard_event_runtime_id",
    "validate_dashboard_event",
    "dashboard_event_station_name",
    "normalize_dashboard_perms",
    "dashboard_permission_response",
    "normalize_dashboard_telemetry",
    "get_dashboard_guild_stats",
]
