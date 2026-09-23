import os
from datetime import datetime, timedelta, timezone

import pytest
import requests

# The fixtures below write into the database of the test stack. They refuse any
# database whose name does not mark it as a test database.
TEST_DATABASE_MARKERS = ("test", "local", "contract", "ci")
CI_BOT_CLIENT_ID = "100000000000000001"
CI_WORKER_CLIENT_ID = "100000000000000002"


def pytest_configure(config):
    if os.environ.get("OMNIFM_RUN_BACKEND_CONTRACT_TESTS") == "1":
        return

    pytest.exit(
        "backend/tests expects a running isolated FastAPI/Mongo test stack. "
        "Set OMNIFM_RUN_BACKEND_CONTRACT_TESTS=1 and OMNIFM_TEST_BASE_URL to run it intentionally.",
        returncode=5,
    )


def _base_url():
    return (os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("OMNIFM_TEST_BASE_URL") or "").rstrip("/")


def _admin_session():
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "X-Admin-Token": os.environ.get("OMNIFM_TEST_ADMIN_TOKEN", "omnifm-owner-dev-token"),
    })
    return session


@pytest.fixture(scope="session")
def contract_db():
    """The MongoDB database of the FastAPI under test."""
    url = os.environ.get("MONGO_URL")
    name = os.environ.get("DB_NAME")
    if not url or not name:
        pytest.skip("MONGO_URL and DB_NAME of the test stack are required for this test")
    if not any(marker in name.lower() for marker in TEST_DATABASE_MARKERS):
        pytest.fail(f"refusing to change database {name!r}: the name does not mark it as a test database")
    from pymongo import MongoClient

    client = MongoClient(url, serverSelectionTimeoutMS=4000)
    yield client[name]
    client.close()


def _clear_runtime(db):
    db.runtime_health.delete_many({})
    db.runtime_logs.drop()
    db.runtime_incidents.delete_many({})


@pytest.fixture
def no_runtime(contract_db):
    """No bot has reported: no health document, no shipped logs, no incidents."""
    _clear_runtime(contract_db)
    yield contract_db


@pytest.fixture
def live_runtime(contract_db):
    """A fresh health document of a split setup (commander and one worker), 14
    shipped log lines and two incidents, the way the Node bot writes them."""
    _clear_runtime(contract_db)
    now = datetime.now(timezone.utc)
    node_common = {"requiredTier": "free", "guildDetails": [], "resourceScope": "node-process",
                   "host": "ci", "nodeVersion": "v22.23.2", "uptimeSec": 7200}
    doc = {
        "_id": "latest",
        "at": now.isoformat(),
        "pid": 1000,
        "host": "ci",
        "process": {"cpuPct": 12.5, "ramMb": 310.2, "totalCpuPct": 12.5, "totalRamMb": 310.2,
                    "uptimeSec": 7200, "cores": 4, "nodeVersion": "v22.23.2", "processCount": 2,
                    "resourceModel": "split-processes"},
        "nodes": [
            {**node_common, "botId": CI_BOT_CLIENT_ID, "runtimeId": "bot-1", "index": 1, "name": "CI Commander",
             "role": "commander", "status": "online", "pingMs": 41, "guilds": 3,
             "guildIds": ["123456789012345671", "123456789012345672", "123456789012345673"],
             "users": 120, "voiceConnections": 1, "listeners": 4, "cpuPct": 6.5, "ramMb": 150.1,
             "heapUsedMb": 60.0, "pid": 1001},
            {**node_common, "botId": CI_WORKER_CLIENT_ID, "runtimeId": "bot-2", "index": 2, "name": "CI Worker 2",
             "role": "worker", "status": "online", "pingMs": 55, "guilds": 2,
             "guildIds": ["123456789012345671", "123456789012345672"],
             "users": 80, "voiceConnections": 1, "listeners": 3, "cpuPct": 6.0, "ramMb": 160.1,
             "heapUsedMb": 58.0, "pid": 1002},
        ],
        "healthyNodes": 2,
        "totalNodes": 2,
    }
    contract_db.runtime_health.replace_one({"_id": "latest"}, doc, upsert=True)
    levels = ("INFO", "WARN", "ERROR", "DEBUG")
    contract_db.runtime_logs.insert_many([{
        "at": (now - timedelta(seconds=14 - i)).isoformat(),
        "level": levels[i % len(levels)],
        "source": "CI Worker 2",
        "message": f"Stream line {i + 1}",
        "process": "worker-2",
        "pid": 1002,
        "host": "ci",
    } for i in range(14)])
    contract_db.runtime_incidents.insert_many([
        {"at": (now - timedelta(minutes=5)).isoformat(), "timestamp": now - timedelta(minutes=5),
         "severity": "warning", "source": "station-health", "message": "Alpha FM antwortet nicht", "resolved": False},
        {"guildId": "123456789012345671", "guildName": "CI Guild", "eventKey": "stream_failback_completed",
         "severity": "success", "timestamp": now - timedelta(minutes=1), "at": (now - timedelta(minutes=1)).isoformat(),
         "source": "CI Worker 2", "message": "CI Guild: zurück auf Alpha FM (vorher Beta FM)", "resolved": True,
         "runtime": {"id": "bot-2", "name": "CI Worker 2", "role": "worker"}, "payload": {}},
    ])
    yield doc
    _clear_runtime(contract_db)


@pytest.fixture
def configured_bot(contract_db):
    """Exactly one bot in the owner configuration; the test stack has no BOT_* variables."""
    before = (contract_db.owner_config.find_one({"_id": "global"}, {"discord": 1}) or {}).get("discord")
    contract_db.owner_config.update_one(
        {"_id": "global"},
        {"$set": {"discord": {"commander": {"name": "CI Commander", "token": "ci-token",
                                             "clientId": CI_BOT_CLIENT_ID, "inviteUrl": ""},
                              "workers": []}}},
        upsert=True,
    )
    yield
    if before is None:
        contract_db.owner_config.update_one({"_id": "global"}, {"$unset": {"discord": ""}})
    else:
        contract_db.owner_config.update_one({"_id": "global"}, {"$set": {"discord": before}})


@pytest.fixture
def discord_oauth(contract_db):
    """A Discord OAuth application in the owner configuration."""
    before = (contract_db.owner_config.find_one({"_id": "global"}, {"system": 1}) or {}).get("system") or {}
    contract_db.owner_config.update_one(
        {"_id": "global"},
        {"$set": {"system.discordOAuth": {"clientId": CI_BOT_CLIENT_ID, "clientSecret": "ci-secret",
                                          "redirectUri": "https://example.test/api/auth/discord/callback",
                                          "scopes": "identify guilds"}}},
        upsert=True,
    )
    yield
    if "discordOAuth" in before:
        contract_db.owner_config.update_one({"_id": "global"}, {"$set": {"system.discordOAuth": before["discordOAuth"]}})
    else:
        contract_db.owner_config.update_one({"_id": "global"}, {"$unset": {"system.discordOAuth": ""}})


def _clear_licenses(db):
    db.licenses.delete_many({})
    db.server_entitlements.delete_many({})


@pytest.fixture
def no_licenses(contract_db):
    """No licence and no licensed server."""
    _clear_licenses(contract_db)
    yield contract_db


@pytest.fixture
def seeded_licenses(contract_db):
    """Five licences created through the owner API, the first one expired."""
    _clear_licenses(contract_db)
    session = _admin_session()
    keys = []
    for index, (tier, seats) in enumerate((("pro", 1), ("pro", 2), ("ultimate", 1), ("pro", 3), ("ultimate", 2))):
        response = session.post(f"{_base_url()}/api/admin/licenses", timeout=30, json={
            "email": f"ci-licence-{index}@example.test", "tier": tier, "months": 1, "seats": seats})
        assert response.status_code == 200, response.text[:300]
        keys.append(response.json()["licenseKey"])
    expired_at = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    contract_db.licenses.update_one({"_licenseId": keys[0]}, {"$set": {"expiresAt": expired_at}})
    yield keys
    _clear_licenses(contract_db)
