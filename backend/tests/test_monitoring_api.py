"""Live-Monitoring API tests (/api/admin/monitoring) + admin regression."""
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


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"X-Admin-Token": TOKEN})
    return s


# --- module: monitoring auth guard ---
class TestMonitoringAuth:
    def test_no_token_401(self, client):
        r = client.get(f"{BASE_URL}/api/admin/monitoring")
        assert r.status_code == 401, r.text[:300]

    def test_bad_token_401(self, client):
        r = client.get(f"{BASE_URL}/api/admin/monitoring",
                       headers={"X-Admin-Token": "nope"})
        assert r.status_code == 401

    def test_bearer_ok(self, client):
        r = client.get(f"{BASE_URL}/api/admin/monitoring",
                       headers={"Authorization": f"Bearer {TOKEN}"})
        assert r.status_code == 200


# --- module: monitoring payload shape ---
class TestMonitoringShape:
    def test_top_level_keys(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/monitoring")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("generatedAt", "simulated", "health", "nodes", "incidents", "logs"):
            assert k in d, f"missing {k}"
        assert d["simulated"] is True
        assert isinstance(d["generatedAt"], str) and "T" in d["generatedAt"]
        assert '"_id"' not in r.text

    def test_health_block(self, admin):
        h = admin.get(f"{BASE_URL}/api/admin/monitoring").json()["health"]
        for k in ("healthyNodes", "totalNodes", "uptimePct", "apiLatencyMs",
                  "mongo", "openIncidents"):
            assert k in h, f"missing health.{k}"
        assert isinstance(h["healthyNodes"], int)
        assert isinstance(h["totalNodes"], int) and h["totalNodes"] >= 1
        assert 0 <= h["healthyNodes"] <= h["totalNodes"]
        assert 0 < h["uptimePct"] <= 100
        assert isinstance(h["apiLatencyMs"], int) and h["apiLatencyMs"] > 0
        assert h["mongo"] is True
        assert isinstance(h["openIncidents"], int) and h["openIncidents"] >= 0

    def test_nodes(self, admin):
        d = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        nodes = d["nodes"]
        assert len(nodes) == d["health"]["totalNodes"]
        assert len(nodes) == 2, f"expected 2 configured bots, got {len(nodes)}"
        roles = {n["role"] for n in nodes}
        assert "commander" in roles
        assert roles <= {"commander", "worker"}
        for n in nodes:
            for k in ("name", "role", "status", "cpuPct", "ramMb", "pingMs"):
                assert k in n, f"missing node.{k}"
            assert n["name"]
            assert n["status"] in ("online", "degraded", "offline")
            assert 0 <= n["cpuPct"] <= 100
            assert n["ramMb"] > 0
            assert n["pingMs"] > 0

    def test_nodes_match_bots_endpoint(self, admin, client):
        nodes = admin.get(f"{BASE_URL}/api/admin/monitoring").json()["nodes"]
        workers = admin.get(f"{BASE_URL}/api/admin/workers").json()
        assert len(nodes) == workers["count"]

    def test_incidents(self, admin):
        incidents = admin.get(f"{BASE_URL}/api/admin/monitoring").json()["incidents"]
        assert isinstance(incidents, list) and len(incidents) >= 1
        assert len(incidents) <= 25
        for i in incidents:
            for k in ("at", "severity", "source", "message", "resolved"):
                assert k in i, f"missing incident.{k}"
            assert i["at"]
            assert i["severity"] in ("info", "warning", "critical", "error", "warn")
            assert isinstance(i["resolved"], bool)
            assert i["message"]

    def test_logs(self, admin):
        d = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        logs = d["logs"]
        assert len(logs) == 14, f"expected 14 log rows, got {len(logs)}"
        for entry in logs:
            for k in ("at", "level", "source", "message"):
                assert k in entry, f"missing log.{k}"
            assert entry["level"] in ("INFO", "WARN", "ERROR", "DEBUG")
            assert entry["source"]
            assert entry["message"]
            assert "{" not in entry["message"], f"unsubstituted placeholder: {entry['message']}"
        # newest first
        ats = [e["at"] for e in logs]
        assert ats == sorted(ats, reverse=True), "logs not newest-first"


# --- module: live jitter behaviour ---
class TestMonitoringLive:
    def test_values_change_over_time(self, admin):
        first = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        time.sleep(5)
        second = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        assert first["generatedAt"] != second["generatedAt"]
        changed = (
            first["logs"][0]["at"] != second["logs"][0]["at"]
            or first["health"]["apiLatencyMs"] != second["health"]["apiLatencyMs"]
            or first["nodes"][0]["cpuPct"] != second["nodes"][0]["cpuPct"]
        )
        assert changed, "no time-based jitter detected between two calls 5s apart"


# --- module: admin regression ---
class TestAdminRegression:
    @pytest.mark.parametrize("route", ["/api/admin/overview", "/api/admin/licenses",
                                       "/api/admin/workers", "/api/admin/stations",
                                       "/api/admin/integrations", "/api/admin/activity"])
    def test_admin_routes_ok(self, admin, route):
        r = admin.get(f"{BASE_URL}{route}")
        assert r.status_code == 200, f"{route} -> {r.status_code} {r.text[:200]}"
        assert '"_id"' not in r.text

    def test_health(self, client):
        r = client.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json().get("ok") is True
