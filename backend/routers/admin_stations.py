"""Owner console: station management (list, stream test, save, delete, health check).

Split out of routers/admin.py (#200) so every module stays below 800 lines;
same pattern: server.py calls build_router(core) with itself.
"""
from datetime import datetime
from datetime import timezone
from fastapi import APIRouter
from fastapi import Request
from starlette.concurrency import run_in_threadpool
import requests
import time


def build_router(core):
    router = APIRouter()

    @router.get("/api/admin/stations")
    async def admin_stations(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        return core._station_summary()

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
        # Country, language, colour, logo, homepage (#267): only https links and
        # #RRGGBB colours are kept; an emptied field is removed.
        extra = core.station_catalog_fields({**data, "genre": genre})
        for field in ("country", "language", "color", "logo", "homepage"):
            doc[field] = extra.get(field, "")
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
                        "country": doc.get("country") or "", "language": doc.get("language") or "",
                        "color": doc.get("color") or "", "logo": doc.get("logo") or "",
                        "homepage": doc.get("homepage") or "",
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
