"""Owner audit log and the data archive (archive and restore of deleted records).

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timezone
import json
import re
import secrets

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def record_owner_audit(action, target=None, detail=None, status="ok", request=None):
    entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": "owner",
        "action": str(action),
        "target": (str(target) if target is not None else None),
        "detail": core.clip_text(detail, 300) if detail else None,
        "status": status,
        "ip": core._client_ip_safe(request) if request is not None else "-",
    }
    if core.db is not None:
        try:
            core.db.owner_audit.insert_one({**entry})
            return entry
        except Exception:
            pass
    try:
        core.OWNER_AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing = []
        if core.OWNER_AUDIT_FILE.exists():
            existing = json.loads(core.OWNER_AUDIT_FILE.read_text(encoding="utf-8") or "[]")
        existing.insert(0, entry)
        core.OWNER_AUDIT_FILE.write_text(json.dumps(existing[:500], ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    return entry


def archive_mongo_records(queries, operation, target, request=None, actor="owner", delete=True):
    if core.db is None:
        raise RuntimeError("MongoDB nicht verbunden.")

    operation_id = f"arc_{secrets.token_urlsafe(18)}"
    archived_at = datetime.now(timezone.utc).isoformat()
    archive_rows = []
    source_rows = []

    for collection_name, query in queries:
        if collection_name not in core.ARCHIVABLE_COLLECTIONS:
            raise ValueError(f"Collection ist nicht archivierbar: {collection_name}")
        collection = core.db[collection_name]
        documents = list(collection.find(query))
        source_rows.append((collection_name, collection, documents))
        for document in documents:
            archive_rows.append({
                "recordId": f"rec_{secrets.token_urlsafe(18)}",
                "operationId": operation_id,
                "operation": core.clip_text(operation, 100),
                "target": core.clip_text(target, 200),
                "collection": collection_name,
                "originalId": str(document.get("_id") or ""),
                "payload": document,
                "archivedAt": archived_at,
                "archivedBy": core.clip_text(actor, 120),
                "ip": core._client_ip_safe(request) if request is not None else "-",
                "restoredAt": None,
                "restoredBy": None,
            })

    if not archive_rows:
        return {"operationId": None, "archived": 0, "deleted": {name: 0 for name, _, _ in source_rows}}

    # Insert must succeed completely before any active record is removed.
    inserted = core.db.data_archive.insert_many(archive_rows, ordered=True)
    if len(inserted.inserted_ids) != len(archive_rows):
        raise RuntimeError("Archivierung wurde nicht vollständig bestätigt.")

    deleted_counts = {name: 0 for name, _, _ in source_rows}
    if delete:
        for collection_name, collection, documents in source_rows:
            document_ids = [document.get("_id") for document in documents if document.get("_id") is not None]
            if not document_ids:
                continue
            result = collection.delete_many({"_id": {"$in": document_ids}})
            deleted_counts[collection_name] = result.deleted_count

    return {"operationId": operation_id, "archived": len(archive_rows), "deleted": deleted_counts}


def restore_archived_operation(operation_id, request=None):
    if core.db is None:
        raise RuntimeError("MongoDB nicht verbunden.")
    operation_id = str(operation_id or "").strip()
    if not re.fullmatch(r"arc_[A-Za-z0-9_-]{12,80}", operation_id):
        raise ValueError("Ungültige Archiv-ID.")

    rows = list(core.db.data_archive.find({"operationId": operation_id, "restoredAt": None}).sort("archivedAt", 1))
    if not rows:
        existing = core.db.data_archive.find_one({"operationId": operation_id})
        if existing:
            raise ValueError("Dieser Archivvorgang wurde bereits wiederhergestellt.")
        raise LookupError("Archivvorgang nicht gefunden.")

    conflicts = []
    restore_rows = []
    for row in rows:
        collection_name = str(row.get("collection") or "")
        payload = row.get("payload")
        if collection_name not in core.ARCHIVABLE_COLLECTIONS or not isinstance(payload, dict) or payload.get("_id") is None:
            raise ValueError("Archiv enthält einen nicht wiederherstellbaren Datensatz.")
        existing = core.db[collection_name].find_one({"_id": payload.get("_id")})
        if existing is not None and existing != payload:
            conflicts.append(f"{collection_name}:{row.get('originalId') or payload.get('_id')}")
        restore_rows.append((collection_name, payload))

    if conflicts:
        raise ValueError(
            "Wiederherstellung würde neuere aktive Daten überschreiben: " + ", ".join(conflicts[:8])
        )

    restored = 0
    for collection_name, payload in restore_rows:
        core.db[collection_name].replace_one({"_id": payload.get("_id")}, payload, upsert=True)
        restored += 1

    restored_at = datetime.now(timezone.utc).isoformat()
    core.db.data_archive.update_many(
        {"operationId": operation_id, "restoredAt": None},
        {"$set": {"restoredAt": restored_at, "restoredBy": "owner", "restoredIp": core._client_ip_safe(request)}},
    )
    return {"operationId": operation_id, "restored": restored, "restoredAt": restored_at}


__all__ = [
    "record_owner_audit",
    "archive_mongo_records",
    "restore_archived_operation",
]
