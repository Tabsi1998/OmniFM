"""Owner station CRUD + stream test + audit log (iteration 3)."""
import os
import time

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
TOKEN = "omnifm-owner-dev-token"
QA_KEY = "qa-station"
GOOD_URL = "https://ice4.somafm.com/dronezone-128-mp3"
TEST_URL = "https://ice4.somafm.com/groovesalad-128-mp3"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Admin-Token": TOKEN})
    yield s
    # cleanup any leftovers
    for key in (QA_KEY, "fe-qa"):
        try:
            s.delete(f"{BASE_URL}/api/admin/stations/{key}", timeout=20)
        except Exception:
            pass


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- auth guard ---
class TestAuthGuard:
    @pytest.mark.parametrize("path,method", [
        ("/api/admin/stations/list", "get"),
        ("/api/admin/audit", "get"),
        ("/api/admin/stations", "post"),
        ("/api/admin/stations/test", "post"),
        ("/api/admin/stations/nope", "delete"),
    ])
    def test_requires_token(self, anon, path, method):
        resp = getattr(anon, method)(f"{BASE_URL}{path}", json={}, timeout=30)
        assert resp.status_code == 401, f"{method} {path} -> {resp.status_code}"


# --- station list / CRUD ---
class TestStationCrud:
    def test_list_shape(self, client):
        r = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["stations"], list)
        assert d["count"] == len(d["stations"])
        assert d["count"] >= 100, f"expected ~120 stations, got {d['count']}"
        row = d["stations"][0]
        for k in ("key", "name", "url", "tier", "genre", "isDefault"):
            assert k in row, f"missing {k} in {row}"
        assert isinstance(row["isDefault"], bool)
        assert "_id" not in row

    def test_create_update_delete_flow(self, client):
        # CREATE
        r = client.post(f"{BASE_URL}/api/admin/stations", timeout=30, json={
            "key": QA_KEY, "name": "QA Station", "url": GOOD_URL, "tier": "pro", "genre": "Ambient"})
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["ok"] is True and d["created"] is True

        rows = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        found = [s for s in rows if s["key"] == QA_KEY]
        assert found, "created station not in list"
        assert found[0]["name"] == "QA Station"
        assert found[0]["tier"] == "pro"
        assert found[0]["genre"] == "Ambient"
        assert found[0]["isDefault"] is False

        # UPDATE (same key)
        r2 = client.post(f"{BASE_URL}/api/admin/stations", timeout=30, json={
            "key": QA_KEY, "name": "QA Station Renamed", "url": GOOD_URL, "tier": "pro", "genre": "Ambient"})
        assert r2.status_code == 200
        assert r2.json()["created"] is False
        rows = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        assert [s for s in rows if s["key"] == QA_KEY][0]["name"] == "QA Station Renamed"

        # DELETE
        r3 = client.delete(f"{BASE_URL}/api/admin/stations/{QA_KEY}", timeout=30)
        assert r3.status_code == 200
        assert r3.json() == {"ok": True, "deleted": QA_KEY}
        rows = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        assert not [s for s in rows if s["key"] == QA_KEY]

        # delete again -> 404
        assert client.delete(f"{BASE_URL}/api/admin/stations/{QA_KEY}", timeout=30).status_code == 404


# --- validation ---
class TestStationValidation:
    @pytest.mark.parametrize("payload,label", [
        ({"key": "BAD KEY!", "name": "X", "url": GOOD_URL, "tier": "pro"}, "invalid key"),
        ({"key": "qa-nokey-name", "url": GOOD_URL, "tier": "pro"}, "missing name"),
        ({"key": "qa-tier", "name": "X", "url": GOOD_URL, "tier": "gold"}, "bad tier"),
        ({"key": "qa-ssrf", "name": "X", "url": "http://127.0.0.1/x", "tier": "pro"}, "ssrf"),
        ({"key": "qa-scheme", "name": "X", "url": "ftp://example.com/x", "tier": "pro"}, "bad scheme"),
        ({"key": "a", "name": "X", "url": GOOD_URL, "tier": "pro"}, "key too short"),
    ])
    def test_invalid_payload_400(self, client, payload, label):
        r = client.post(f"{BASE_URL}/api/admin/stations", json=payload, timeout=30)
        assert r.status_code == 400, f"{label} -> {r.status_code} {r.text[:200]}"
        body = r.json()
        assert body.get("detail") or body.get("error") or body.get("message")
        # ensure nothing persisted
        rows = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        assert not [s for s in rows if s["key"] == payload.get("key")]


# --- stream test ---
class TestStreamTest:
    def test_valid_audio_stream(self, client):
        r = client.post(f"{BASE_URL}/api/admin/stations/test", json={"url": TEST_URL}, timeout=40)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["ok"] is True, d
        assert d["isAudioStream"] is True
        assert "audio" in str(d.get("contentType", "")).lower(), d.get("contentType")
        assert d.get("bitrate") or d.get("icyName"), d
        assert isinstance(d.get("latencyMs"), int)

    def test_ssrf_blocked(self, client):
        r = client.post(f"{BASE_URL}/api/admin/stations/test", json={"url": "http://127.0.0.1/x"}, timeout=30)
        assert r.status_code == 400

    def test_non_audio_url(self, client):
        r = client.post(f"{BASE_URL}/api/admin/stations/test", json={"url": "https://example.com"}, timeout=40)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is False or d.get("isAudioStream") is False
        assert "reachable" in d


# --- audit log ---
class TestAuditLog:
    def test_audit_records_actions(self, client):
        # perform actions
        client.post(f"{BASE_URL}/api/admin/stations", timeout=30, json={
            "key": "qa-audit-x", "name": "QA Audit", "url": GOOD_URL, "tier": "free", "genre": "Test"})
        client.post(f"{BASE_URL}/api/admin/stations/test", json={"url": TEST_URL}, timeout=40)
        client.delete(f"{BASE_URL}/api/admin/stations/qa-audit-x", timeout=30)
        time.sleep(1)

        r = client.get(f"{BASE_URL}/api/admin/audit", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["audit"], list) and d["count"] == len(d["audit"])
        rows = d["audit"]
        assert rows, "audit empty"
        for row in rows[:10]:
            for k in ("at", "actor", "action", "status"):
                assert k in row, f"missing {k} in {row}"
            assert row["actor"] == "owner"
            assert "_id" not in row
        actions = [r_["action"] for r_ in rows[:20]]
        for expected in ("station.create", "station.test", "station.delete"):
            assert expected in actions, f"{expected} not in recent audit {actions}"
        # newest first
        ats = [r_["at"] for r_ in rows[:20]]
        assert ats == sorted(ats, reverse=True), "audit not newest-first"


# --- regression ---
class TestRegression:
    def test_health(self, anon):
        r = anon.get(f"{BASE_URL}/api/health", timeout=30)
        assert r.status_code == 200
        assert r.json().get("status") in ("ok", "healthy", True) or r.json().get("ok")

    @pytest.mark.parametrize("path", ["/api/admin/overview", "/api/admin/monitoring", "/api/admin/stations"])
    def test_admin_endpoints_ok(self, client, path):
        assert client.get(f"{BASE_URL}{path}", timeout=30).status_code == 200

    def test_stats_station_count_unchanged(self, client, anon):
        before = anon.get(f"{BASE_URL}/api/stats", timeout=30).json()
        c_before = before.get("stations")
        client.post(f"{BASE_URL}/api/admin/stations", timeout=30, json={
            "key": "qa-count", "name": "QA Count", "url": GOOD_URL, "tier": "free"})
        client.delete(f"{BASE_URL}/api/admin/stations/qa-count", timeout=30)
        after = anon.get(f"{BASE_URL}/api/stats", timeout=30).json()
        assert after.get("stations") == c_before, f"{c_before} -> {after.get('stations')}"
        assert isinstance(c_before, int) and c_before >= 100
