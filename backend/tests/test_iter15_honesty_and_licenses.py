"""Iteration 15 — retest of honesty fixes (post-iteration-14 follow-ups)
   + full license-manager regression + LIVE runtime telemetry path.

Modules covered:
  * public   : GET /api/stats
  * admin    : GET /api/admin/overview, GET /api/admin/monitoring
  * live path: seed db.runtime_health {_id: "latest"} -> stats/overview/monitoring must
               report real guild/bot totals; seed is removed afterwards.
  * licenses : POST/GET/PATCH/DELETE /api/admin/licenses (tier, seats clamp,
               extend/shorten, guild link/unlink, search)
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
OWNER_TOKEN = "omnifm-owner-dev-token"
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Admin-Token": OWNER_TOKEN})
    return s


@pytest.fixture(scope="module")
def mongo():
    if not MONGO_URL or not DB_NAME:
        pytest.skip("MONGO_URL/DB_NAME missing")
    c = MongoClient(MONGO_URL, serverSelectionTimeoutMS=4000)
    yield c[DB_NAME]
    c.close()


# ---------------------------------------------------------------- honest zeros
class TestHonestZeros:
    def test_stats_zeros_without_runtime(self, client):
        r = client.get(f"{BASE_URL}/api/stats", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["servers"] == 0, d
        assert d["bots"] == 0, d
        assert d["live"] is False
        assert d["connections"] == 0
        assert d["listeners"] == 0
        assert d["stations"] == 120, d["stations"]
        assert d["botsConfigured"] == 1, d["botsConfigured"]

    def test_overview_zeros_without_runtime(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/overview", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["guilds"]["managed"] == 0, d["guilds"]
        assert d["guilds"]["live"] is False
        assert d["bots"]["online"] == 0, d["bots"]
        assert d["bots"]["configured"] == 1
        assert isinstance(d["licenses"]["total"], int)
        assert d["revenue"]["currency"] == "EUR"
        assert d["stations"]["total"] == 120

    def test_monitoring_waiting_state(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/monitoring", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["simulated"] is False
        assert d["live"] is False
        assert d.get("waiting") is True
        assert d["nodes"] == []
        assert d["incidents"] == []
        assert d["logs"] == []
        assert d["process"] is None
        assert d["health"]["healthyNodes"] == 0 and d["health"]["totalNodes"] == 0
        assert "Warte auf Live-Daten" in (d.get("message") or "")

    def test_admin_endpoints_require_token(self, client):
        for path in ("/api/admin/overview", "/api/admin/monitoring", "/api/admin/licenses"):
            r = client.get(f"{BASE_URL}{path}", timeout=30)
            assert r.status_code == 401, f"{path} -> {r.status_code}"


# ------------------------------------------------------------- live telemetry
class TestLiveRuntimeTelemetry:
    def test_seeded_live_doc_is_reflected_everywhere(self, admin, client, mongo):
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "_id": "latest",
            "at": now,
            "process": {"cpuPct": 17, "ramMb": 412, "uptimeSec": 7321, "cores": 4, "nodeVersion": "v20.11.0"},
            "nodes": [
                {"botId": "bot1", "index": 1, "name": "OmniFM Commander", "role": "commander",
                 "status": "online", "pingMs": 42, "guilds": 7, "voiceConnections": 3},
                {"botId": "bot2", "index": 2, "name": "OmniFM Worker 2", "role": "worker",
                 "status": "online", "pingMs": 55, "guilds": 5, "voiceConnections": 2},
                {"botId": "bot3", "index": 3, "name": "OmniFM Worker 3", "role": "worker",
                 "status": "offline", "pingMs": None, "guilds": 99, "voiceConnections": 9},
            ],
            "logs": [{"level": "INFO", "source": "commander", "message": "TEST_iter15 seeded"}],
        }
        existing = mongo.runtime_health.find_one({"_id": "latest"})
        try:
            mongo.runtime_health.replace_one({"_id": "latest"}, doc, upsert=True)

            s = client.get(f"{BASE_URL}/api/stats", timeout=30).json()
            assert s["live"] is True, s
            assert s["bots"] == 2, s          # only online nodes counted
            assert s["servers"] == 12, s      # 7 + 5, offline node excluded
            assert s["connections"] == 5, s

            o = admin.get(f"{BASE_URL}/api/admin/overview", timeout=30).json()
            assert o["guilds"]["managed"] == 12, o["guilds"]
            assert o["guilds"]["live"] is True
            assert o["bots"]["online"] == 2, o["bots"]

            m = admin.get(f"{BASE_URL}/api/admin/monitoring", timeout=30).json()
            assert m["live"] is True and m["simulated"] is False, m
            assert m.get("waiting") in (None, False)
            assert len(m["nodes"]) == 3
            assert m["health"]["healthyNodes"] == 2
            assert m["health"]["totalNodes"] == 3
            assert m["health"]["uptimeSec"] == 7321
            assert m["process"]["cpuPct"] == 17
            assert m["nodes"][0]["ramMb"] == 412
        finally:
            mongo.runtime_health.delete_one({"_id": "latest"})
            if existing:
                mongo.runtime_health.insert_one(existing)

        # cleanup verified: back to honest zeros
        s2 = client.get(f"{BASE_URL}/api/stats", timeout=30).json()
        assert s2["live"] is False and s2["servers"] == 0 and s2["bots"] == 0

    def test_stale_runtime_doc_is_ignored(self, client, mongo):
        stale = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        doc = {
            "_id": "latest",
            "at": stale,
            "process": {"cpuPct": 50, "ramMb": 900, "uptimeSec": 10, "cores": 4},
            "nodes": [{"botId": "b", "index": 1, "name": "x", "role": "commander",
                       "status": "online", "guilds": 42, "voiceConnections": 8}],
        }
        try:
            mongo.runtime_health.replace_one({"_id": "latest"}, doc, upsert=True)
            s = client.get(f"{BASE_URL}/api/stats", timeout=30).json()
            assert s["live"] is False, s
            assert s["servers"] == 0 and s["bots"] == 0, s
        finally:
            mongo.runtime_health.delete_one({"_id": "latest"})


# ------------------------------------------------------------ license manager
@pytest.fixture(scope="class")
def created_keys():
    return []


@pytest.fixture(scope="class", autouse=True)
def cleanup_licenses(created_keys):
    yield
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Admin-Token": OWNER_TOKEN})
    for k in created_keys:
        s.delete(f"{BASE_URL}/api/admin/licenses/{k}", timeout=30)


def _create(admin, created_keys, **over):
    payload = {"email": f"TEST_iter15_{uuid.uuid4().hex[:8]}@example.test",
               "tier": "pro", "seats": 2, "months": 1, "note": "TEST_iter15"}
    payload.update(over)
    r = admin.post(f"{BASE_URL}/api/admin/licenses", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text[:400]
    body = r.json()
    key = body.get("licenseKey")
    assert key, body
    created_keys.append(key)
    return key, payload


def _row(admin, key):
    r = admin.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30)
    assert r.status_code == 200
    rows = r.json().get("licenses") or []
    match = [x for x in rows if x.get("licenseKey") == key]
    return match[0] if match else None


class TestLicenseManager:
    def test_create_and_persist(self, admin, created_keys):
        key, payload = _create(admin, created_keys)
        row = _row(admin, key)
        assert row, "created license missing from listing"
        assert row["plan"] == "pro"
        assert row["seats"] == 2
        assert row["email"] == payload["email"]
        assert row["active"] is True and row["expired"] is False
        assert row["note"] == "TEST_iter15"

    def test_search_by_key_email_guild(self, admin, created_keys):
        key, payload = _create(admin, created_keys, serverId="900000000000000001")
        rows = admin.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30).json()["licenses"]
        assert any(r["licenseKey"] == key for r in rows)
        assert any(r["email"] == payload["email"] for r in rows)
        row = _row(admin, key)
        assert "900000000000000001" in row["linkedServerIds"], row
        assert row["seatsUsed"] == 1

    def test_change_tier(self, admin, created_keys):
        key, _ = _create(admin, created_keys)
        r = admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"tier": "ultimate"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["license"]["plan"] == "ultimate"
        assert _row(admin, key)["plan"] == "ultimate"

    def test_invalid_tier_rejected(self, admin, created_keys):
        key, _ = _create(admin, created_keys)
        r = admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"tier": "diamond"}, timeout=30)
        assert r.status_code == 400, r.status_code
        assert _row(admin, key)["plan"] == "pro"

    def test_seats_clamp_1_to_5(self, admin, created_keys):
        key, _ = _create(admin, created_keys)
        for sent, expected in ((0, 1), (-9, 1), (3, 3), (5, 5), (99, 5)):
            r = admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"seats": sent}, timeout=30)
            assert r.status_code == 200, r.text[:200]
            assert _row(admin, key)["seats"] == expected, f"seats {sent} -> expected {expected}"

    def test_extend_and_shorten(self, admin, created_keys):
        key, _ = _create(admin, created_keys)
        start = _row(admin, key)["daysLeft"]
        assert isinstance(start, int)
        admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"extendMonths": 3}, timeout=30)
        after_ext = _row(admin, key)["daysLeft"]
        assert after_ext - start == 90, (start, after_ext)
        admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"extendMonths": -1}, timeout=30)
        after_short = _row(admin, key)["daysLeft"]
        assert after_ext - after_short == 30, (after_ext, after_short)

    def test_expire_now(self, admin, created_keys):
        key, _ = _create(admin, created_keys)
        r = admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"expireNow": True}, timeout=30)
        assert r.status_code == 200
        row = _row(admin, key)
        assert row["expired"] is True and row["active"] is False, row

    def test_guild_link_and_unlink(self, admin, created_keys):
        key, _ = _create(admin, created_keys)
        gid = "900000000000000123"
        admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"addServerId": gid}, timeout=30)
        assert gid in _row(admin, key)["linkedServerIds"]
        admin.patch(f"{BASE_URL}/api/admin/licenses/{key}", json={"removeServerId": gid}, timeout=30)
        assert gid not in _row(admin, key)["linkedServerIds"]

    def test_patch_unknown_license_404(self, admin):
        r = admin.patch(f"{BASE_URL}/api/admin/licenses/NOPE-NOPE-NOPE", json={"seats": 2}, timeout=30)
        assert r.status_code == 404, r.status_code

    def test_delete_and_verify_removal(self, admin, created_keys):
        key, _ = _create(admin, created_keys)
        r = admin.delete(f"{BASE_URL}/api/admin/licenses/{key}", timeout=30)
        assert r.status_code in (200, 204), r.text[:200]
        assert _row(admin, key) is None
        again = admin.delete(f"{BASE_URL}/api/admin/licenses/{key}", timeout=30)
        assert again.status_code == 404
