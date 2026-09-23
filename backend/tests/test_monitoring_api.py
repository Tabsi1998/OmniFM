"""Live-Monitoring API tests (/api/admin/monitoring) + admin regression."""
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

TOKEN = os.environ.get("OMNIFM_TEST_ADMIN_TOKEN", "omnifm-owner-dev-token")


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


# --- module: monitoring payload shape (live bot data) ---
class TestMonitoringShape:
    def test_top_level_keys(self, admin, live_runtime):
        r = admin.get(f"{BASE_URL}/api/admin/monitoring")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("generatedAt", "simulated", "live", "process", "health", "nodes", "incidents", "logs"):
            assert k in d, f"missing {k}"
        assert d["simulated"] is False
        assert d["live"] is True
        assert isinstance(d["generatedAt"], str) and "T" in d["generatedAt"]
        assert '"_id"' not in r.text

    def test_health_block(self, admin, live_runtime):
        h = admin.get(f"{BASE_URL}/api/admin/monitoring").json()["health"]
        for k in ("healthyNodes", "totalNodes", "uptimeSec", "apiLatencyMs", "mongo", "openIncidents"):
            assert k in h, f"missing health.{k}"
        assert h["healthyNodes"] == 2 and h["totalNodes"] == 2
        assert h["uptimeSec"] == 7200
        assert h["mongo"] is True
        assert h["openIncidents"] == 1, "one open incident, the failback is resolved"

    def test_nodes(self, admin, live_runtime):
        d = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        nodes = d["nodes"]
        assert len(nodes) == d["health"]["totalNodes"] == 2
        assert {n["role"] for n in nodes} == {"commander", "worker"}
        for n in nodes:
            for k in ("name", "role", "status", "cpuPct", "ramMb", "pingMs", "resourceScope"):
                assert k in n, f"missing node.{k}"
            assert n["name"]
            assert n["status"] == "online"
            # Split processes: every node reports its own process.
            assert n["resourceScope"] == "node-process"
            assert 0 <= n["cpuPct"] <= 100
            assert n["ramMb"] > 0
            assert n["pingMs"] > 0

    def test_nodes_match_workers_endpoint(self, admin, live_runtime, configured_bot):
        nodes = admin.get(f"{BASE_URL}/api/admin/monitoring").json()["nodes"]
        workers = admin.get(f"{BASE_URL}/api/admin/workers").json()
        assert workers["live"] is True
        assert len(nodes) == workers["count"]

    def test_incidents(self, admin, live_runtime):
        incidents = admin.get(f"{BASE_URL}/api/admin/monitoring").json()["incidents"]
        assert len(incidents) == 2
        for i in incidents:
            for k in ("at", "severity", "source", "message", "resolved"):
                assert k in i, f"missing incident.{k}"
            assert i["at"] and i["message"]
            assert isinstance(i["resolved"], bool)
        assert incidents[0]["message"].startswith("CI Guild: zurück auf Alpha FM"), "newest first"
        assert incidents[1]["severity"] == "warning" and incidents[1]["resolved"] is False

    def test_logs(self, admin, live_runtime):
        logs = admin.get(f"{BASE_URL}/api/admin/monitoring").json()["logs"]
        assert len(logs) == 14, f"expected the 14 shipped log lines, got {len(logs)}"
        for entry in logs:
            for k in ("at", "level", "source", "message"):
                assert k in entry, f"missing log.{k}"
            assert entry["level"] in ("INFO", "WARN", "ERROR", "DEBUG")
            assert entry["source"]
            assert entry["message"]
        ats = [e["at"] for e in logs]
        assert ats == sorted(ats, reverse=True), "logs not newest-first"


# --- module: the monitoring follows what the bot writes ---
class TestMonitoringLive:
    def test_values_follow_the_bot_writes(self, admin, live_runtime, contract_db):
        first = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        contract_db.runtime_health.update_one({"_id": "latest"}, {"$set": {
            "at": datetime.now(timezone.utc).isoformat(),
            "nodes.0.cpuPct": 33.0,
        }})
        second = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        assert first["nodes"][0]["cpuPct"] == 6.5
        assert second["nodes"][0]["cpuPct"] == 33.0
        assert first["generatedAt"] <= second["generatedAt"]

    def test_stale_health_document_means_waiting(self, admin, live_runtime, contract_db):
        stale = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        contract_db.runtime_health.update_one({"_id": "latest"}, {"$set": {"at": stale}})
        d = admin.get(f"{BASE_URL}/api/admin/monitoring").json()
        assert d["live"] is False and d.get("waiting") is True
        assert d["nodes"] == [] and d["logs"] == []


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
