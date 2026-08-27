import copy

import pytest

from backend import server


class WriteResult:
    def __init__(self, *, deleted_count=0, inserted_ids=None):
        self.deleted_count = deleted_count
        self.inserted_ids = inserted_ids or []


class Cursor(list):
    def sort(self, *_args, **_kwargs):
        return self


def matches(document, query):
    for key, expected in (query or {}).items():
        actual = document.get(key)
        if isinstance(expected, dict) and "$in" in expected:
            if actual not in expected["$in"]:
                return False
        elif actual != expected:
            return False
    return True


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = [copy.deepcopy(document) for document in (documents or [])]
        self.sequence = len(self.documents)

    def find(self, query=None):
        return Cursor(copy.deepcopy(document) for document in self.documents if matches(document, query or {}))

    def find_one(self, query):
        for document in self.documents:
            if matches(document, query):
                return copy.deepcopy(document)
        return None

    def insert_many(self, documents, ordered=True):
        assert ordered is True
        inserted_ids = []
        for document in documents:
            payload = copy.deepcopy(document)
            if payload.get("_id") is None:
                self.sequence += 1
                payload["_id"] = f"generated-{self.sequence}"
            inserted_ids.append(payload["_id"])
            self.documents.append(payload)
        return WriteResult(inserted_ids=inserted_ids)

    def delete_many(self, query):
        before = len(self.documents)
        self.documents = [document for document in self.documents if not matches(document, query)]
        return WriteResult(deleted_count=before - len(self.documents))

    def replace_one(self, query, payload, upsert=False):
        for index, document in enumerate(self.documents):
            if matches(document, query):
                self.documents[index] = copy.deepcopy(payload)
                return WriteResult()
        if upsert:
            self.documents.append(copy.deepcopy(payload))
        return WriteResult()

    def update_many(self, query, update):
        for document in self.documents:
            if matches(document, query):
                document.update(copy.deepcopy(update.get("$set") or {}))
        return WriteResult()


class FakeDatabase:
    def __init__(self, **collections):
        self.collections = {
            name: FakeCollection(documents)
            for name, documents in collections.items()
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, FakeCollection())

    def __getattr__(self, name):
        return self[name]


@pytest.fixture(autouse=True)
def restore_database():
    previous = server.db
    yield
    server.db = previous


def test_archive_delete_and_restore_group_without_data_loss():
    server.db = FakeDatabase(
        licenses=[{"_id": "license-object", "_licenseId": "OMNI-1", "plan": "ultimate"}],
        server_entitlements=[{"_id": "entitlement-object", "_serverId": "123", "licenseId": "OMNI-1"}],
    )

    archived = server.archive_mongo_records(
        [
            ("licenses", {"_licenseId": "OMNI-1"}),
            ("server_entitlements", {"licenseId": "OMNI-1"}),
        ],
        operation="owner.license.delete",
        target="OMNI-1",
        delete=True,
    )

    assert archived["archived"] == 2
    assert archived["deleted"] == {"licenses": 1, "server_entitlements": 1}
    assert server.db.licenses.documents == []
    assert server.db.server_entitlements.documents == []
    assert len(server.db.data_archive.documents) == 2

    restored = server.restore_archived_operation(archived["operationId"])
    assert restored["restored"] == 2
    assert server.db.licenses.find_one({"_licenseId": "OMNI-1"})["plan"] == "ultimate"
    assert server.db.server_entitlements.find_one({"_serverId": "123"})["licenseId"] == "OMNI-1"
    assert all(row.get("restoredAt") for row in server.db.data_archive.documents)


def test_restore_refuses_to_overwrite_newer_active_data():
    server.db = FakeDatabase(stations=[{"_id": "station-object", "key": "rock", "name": "Original"}])
    archived = server.archive_mongo_records(
        [("stations", {"key": "rock"})],
        operation="owner.station.delete",
        target="rock",
        delete=True,
    )
    server.db.stations.documents.append({"_id": "station-object", "key": "rock", "name": "Newer"})

    with pytest.raises(ValueError, match="neuere aktive Daten"):
        server.restore_archived_operation(archived["operationId"])

    assert server.db.stations.find_one({"key": "rock"})["name"] == "Newer"
    assert server.db.data_archive.documents[0].get("restoredAt") is None
