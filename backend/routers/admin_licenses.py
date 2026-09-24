"""Owner console: license manager, data archive and activity log.

Moved out of server.py unchanged (#200). server.py calls build_router(core)
with itself; names defined in server.py are read as core.<name> at call
time, so tests that patch server.db still reach these routes.
"""
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from fastapi import APIRouter
from fastapi import Request


def build_router(core):
    router = APIRouter()

    @router.get("/api/admin/licenses")
    async def admin_licenses(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        full = request.query_params.get("full", "0") == "1"
        if full:
            rows = core._admin_license_rows(core.load_premium())
        else:
            rows = core._license_rows(core.load_premium())
        return {"licenses": rows, "count": len(rows)}

    @router.post("/api/admin/licenses")
    async def admin_create_license(request: Request, body: dict = None):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if core.db is None:
            return core.json_error(503, "Keine Datenbank verbunden.")
        body = body or {}
        email = str(body.get("email") or "").strip()
        tier = str(body.get("tier") or "pro").strip().lower()
        months = core.parse_int(body.get("months", 1), 1)
        seats = max(1, min(5, core.parse_int(body.get("seats", 1), 1)))
        note = str(body.get("note") or "").strip()
        if tier not in ("pro", "ultimate"):
            return core.json_error(400, "Tier muss 'pro' oder 'ultimate' sein.")
        if email and not core.is_valid_email(email):
            return core.json_error(400, "Bitte eine gültige E-Mail-Adresse angeben.")
        try:
            created = core.add_license(email, tier, months, seats=seats, activated_by="owner", note=note)
        except ValueError as e:
            return core.json_error(400, str(e))
        # Optional: direkt eine Guild verknüpfen.
        server_id = str(body.get("serverId") or body.get("guildId") or "").strip()
        key = created.get("licenseKey")
        if server_id and key:
            data = core.load_premium()
            try:
                core._set_license_server_links(data, key, [server_id])
                core.save_premium(data)
            except ValueError as error:
                data.get("licenses", {}).pop(key, None)
                core.save_premium(data)
                return core.json_error(400, str(error))
        core.record_owner_audit("license.create", target=key, detail=f"{tier} · {months}M · {seats} seats", request=request)
        return {"ok": True, "licenseKey": key, "license": created}

    @router.patch("/api/admin/licenses/{license_key}")
    async def admin_patch_license(license_key: str, request: Request, body: dict = None):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if core.db is None:
            return core.json_error(503, "Keine Datenbank verbunden.")
        body = body or {}
        data = core.load_premium()
        licenses = data.setdefault("licenses", {})
        lic = licenses.get(license_key)
        if not isinstance(lic, dict):
            return core.json_error(404, "Lizenz nicht gefunden.")

        changes = []

        if "tier" in body and body.get("tier"):
            new_tier = str(body["tier"]).strip().lower()
            if new_tier not in ("pro", "ultimate"):
                return core.json_error(400, "Tier muss 'pro' oder 'ultimate' sein.")
            lic["tier"] = new_tier
            lic["plan"] = new_tier
            changes.append(f"tier={new_tier}")

        if "seats" in body:
            seats = max(1, min(5, core.parse_int(body.get("seats", 1), 1)))
            linked_count = len(lic.get("linkedServerIds") or [])
            if seats < linked_count:
                return core.json_error(400, f"Seats können nicht unter die {linked_count} verknüpften Server reduziert werden.")
            lic["seats"] = seats
            changes.append(f"seats={seats}")

        if "email" in body:
            email = str(body.get("email") or "").strip()
            if email and not core.is_valid_email(email):
                return core.json_error(400, "Bitte eine gültige E-Mail-Adresse angeben.")
            lic["email"] = email
            lic["contactEmail"] = email
            changes.append("email")

        if "note" in body:
            lic["note"] = str(body.get("note") or "").strip()
            changes.append("note")

        # Ablauf: direkt setzen, verlängern oder verkürzen.
        base = core._parse_iso_dt(lic.get("expiresAt")) or datetime.now(timezone.utc)
        if body.get("expireNow"):
            lic["expiresAt"] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            changes.append("expireNow")
        elif body.get("expiresAt"):
            dt = core._parse_iso_dt(body.get("expiresAt"))
            if not dt:
                return core.json_error(400, "Ungültiges Ablaufdatum.")
            lic["expiresAt"] = dt.isoformat()
            changes.append("expiresAt")
        else:
            delta_days = 0
            if body.get("extendMonths") is not None:
                delta_days += core.parse_int(body.get("extendMonths"), 0) * 30
            if body.get("extendDays") is not None:
                delta_days += core.parse_int(body.get("extendDays"), 0)
            if delta_days != 0:
                lic["expiresAt"] = (base + timedelta(days=delta_days)).isoformat()
                changes.append(f"expiry{'+' if delta_days > 0 else ''}{delta_days}d")

        if "active" in body:
            lic["active"] = bool(body.get("active"))
            changes.append(f"active={bool(body.get('active'))}")

        # Guild-Verknüpfungen.
        requested_links = [str(item) for item in (lic.get("linkedServerIds") or [])]
        if isinstance(body.get("linkedServerIds"), list):
            requested_links = body["linkedServerIds"]
            changes.append("linkedServerIds")
        if body.get("addServerId"):
            sid = str(body["addServerId"]).strip()
            if sid and sid not in requested_links:
                requested_links.append(sid)
            changes.append(f"+guild {sid}")
        if body.get("removeServerId"):
            sid = str(body["removeServerId"]).strip()
            requested_links = [s for s in requested_links if str(s) != sid]
            changes.append(f"-guild {sid}")

        try:
            core._set_license_server_links(data, license_key, requested_links)
        except ValueError as error:
            return core.json_error(400, str(error))

        lic["updatedAt"] = datetime.now(timezone.utc).isoformat()
        licenses[license_key] = lic
        core.save_premium(data)
        core.record_owner_audit("license.update", target=license_key, detail=", ".join(changes) or "no-op", request=request)
        rows = [r for r in core._admin_license_rows(data) if r["licenseKey"] == license_key]
        return {"ok": True, "license": rows[0] if rows else None, "changes": changes}

    @router.delete("/api/admin/licenses/{license_key}")
    async def admin_delete_license(license_key: str, request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if core.db is None:
            return core.json_error(503, "Keine Datenbank verbunden.")
        data = core.load_premium()
        licenses = data.setdefault("licenses", {})
        if license_key not in licenses:
            return core.json_error(404, "Lizenz nicht gefunden.")
        try:
            archived = core.archive_mongo_records(
                [
                    ("licenses", {"_licenseId": str(license_key)}),
                    ("server_entitlements", {"licenseId": str(license_key)}),
                ],
                operation="owner.license.delete",
                target=license_key,
                request=request,
                actor="owner",
                delete=False,
            )
            if int(archived.get("archived") or 0) == 0:
                return core.json_error(409, "Lizenz konnte vor dem Löschen nicht archiviert werden.")
        except Exception as exc:
            return core.json_error(500, f"Lizenz konnte nicht sicher archiviert werden: {core.clip_text(exc)}")
        removed = licenses.pop(license_key)
        for server_id, entitlement in list(data.setdefault("serverEntitlements", {}).items()):
            if str((entitlement or {}).get("licenseId") or "") == str(license_key):
                data["serverEntitlements"].pop(server_id, None)
        core.save_premium(data)
        core.record_owner_audit("license.delete", target=license_key, detail=str(removed.get("tier") or removed.get("plan") or ""), request=request)
        return {"ok": True, "deleted": license_key, "archiveId": archived.get("operationId")}

    @router.get("/api/admin/activity")
    async def admin_activity(request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        events = []
        try:
            for r in core.list_recent_redemptions(50):
                events.append({
                    "type": "redemption",
                    "at": r.get("processedAt") or r.get("createdAt"),
                    "label": f"{str(r.get('tier') or 'premium').title()} Lizenz eingeloest",
                    "detail": core.mask_email(str(r.get("email") or "")),
                    "meta": {"seats": r.get("seats"), "sessionId": r.get("sessionId")},
                })
        except Exception:
            pass
        if not events:
            for r in core._license_rows(core.load_premium()):
                events.append({
                    "type": "license",
                    "at": r.get("createdAt"),
                    "label": f"{r.get('planName')} Lizenz ausgestellt",
                    "detail": r.get("contactEmail"),
                    "meta": {"seats": r.get("seats"), "source": r.get("source"), "status": "expired" if r.get("expired") else "active"},
                })
        events.sort(key=lambda e: str(e.get("at") or ""), reverse=True)
        return {"activity": events[:50], "count": len(events)}

    @router.get("/api/admin/archive")
    async def admin_archive_list(request: Request, limit: int = 100):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        if core.db is None:
            return core.json_error(503, "MongoDB nicht verbunden.")
        safe_limit = max(1, min(int(limit or 100), 250))
        pipeline = [
            {"$sort": {"archivedAt": -1}},
            {"$group": {
                "_id": "$operationId",
                "operation": {"$first": "$operation"},
                "target": {"$first": "$target"},
                "archivedAt": {"$first": "$archivedAt"},
                "archivedBy": {"$first": "$archivedBy"},
                "collections": {"$addToSet": "$collection"},
                "recordCount": {"$sum": 1},
                "restoredCount": {"$sum": {"$cond": [{"$ne": ["$restoredAt", None]}, 1, 0]}},
                "restoredAt": {"$max": "$restoredAt"},
            }},
            {"$sort": {"archivedAt": -1}},
            {"$limit": safe_limit},
        ]
        rows = []
        for row in core.db.data_archive.aggregate(pipeline):
            rows.append({
                "operationId": str(row.get("_id") or ""),
                "operation": row.get("operation"),
                "target": row.get("target"),
                "archivedAt": row.get("archivedAt"),
                "archivedBy": row.get("archivedBy"),
                "collections": sorted(str(value) for value in (row.get("collections") or [])),
                "recordCount": int(row.get("recordCount") or 0),
                "restoredCount": int(row.get("restoredCount") or 0),
                "restoredAt": row.get("restoredAt"),
            })
        return {"archive": rows, "count": len(rows)}

    @router.post("/api/admin/archive/{operation_id}/restore")
    async def admin_archive_restore(operation_id: str, request: Request):
        guard = core._admin_guard(request)
        if guard is not None:
            return guard
        try:
            result = core.restore_archived_operation(operation_id, request=request)
        except LookupError as exc:
            return core.json_error(404, str(exc))
        except ValueError as exc:
            return core.json_error(409, str(exc))
        except Exception as exc:
            core.record_owner_audit("archive.restore", target=operation_id, detail=str(exc), status="error", request=request)
            return core.json_error(500, f"Wiederherstellung fehlgeschlagen: {core.clip_text(exc)}")
        core.record_owner_audit("archive.restore", target=operation_id, detail=f"{result['restored']} Datensätze", request=request)
        return {"ok": True, **result}

    return router
