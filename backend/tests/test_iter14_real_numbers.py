"""Iteration 14 — honest/real live numbers (no fake demo values).

Covers:
  * GET /api/stats  -> zeros for live figures when no bot reports
  * GET /api/admin/overview -> guilds.managed == 0 (not stale config count)
  * GET /api/admin/monitoring -> simulated=false + waiting=true
  * Regression: /api/stations, license CRUD, owner login
"""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
OWNER_TOKEN = "omnifm-owner-dev-token"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin(client):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Admin-Token": OWNER_TOKEN})
    return s


# --- public stats honesty -------------------------------------------------
class TestPublicStats:
    def test_stats_live_numbers_are_zero_without_bot(self, client):
        r = client.get(f"{BASE_URL}/api/stats", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["servers"] == 0, f"servers should be 0, got {d['servers']}"
        assert d["bots"] == 0, f"bots online should be 0, got {d['bots']}"
        assert d["live"] is False
        assert d["listeners"] == 0
        assert d["connections"] == 0
        assert d["stations"] == 120, d["stations"]
        assert d["freeStations"] == 20
        assert d["proStations"] == 100
        assert d["botsConfigured"] >= 1


# --- owner overview -------------------------------------------------------
class TestAdminOverview:
    def test_overview_guilds_and_bots_honest(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/overview", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["guilds"]["managed"] == 0, d["guilds"]
        assert d["guilds"]["live"] is False
        assert d["bots"]["online"] == 0
        assert d["bots"]["configured"] >= 1
        assert "licenses" in d and "revenue" in d and "stations" in d
        assert d["stations"]["total"] == 120

    def test_overview_requires_token(self, client):
        r = client.get(f"{BASE_URL}/api/admin/overview", timeout=30)
        assert r.status_code == 401


# --- monitoring -----------------------------------------------------------
class TestAdminMonitoring:
    def test_monitoring_waiting_state(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/monitoring", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["simulated"] is False
        assert d.get("waiting") is True
        assert d["live"] is False
        assert d["nodes"] == []
        assert d["health"]["healthyNodes"] == 0
        assert d["health"]["totalNodes"] == 0


# --- regression -----------------------------------------------------------
class TestRegression:
    def test_stations_count(self, client):
        r = client.get(f"{BASE_URL}/api/stations", timeout=30)
        assert r.status_code == 200
        d = r.json()
        items = d.get("stations") if isinstance(d, dict) else d
        if isinstance(items, dict):
            items = list(items.values())
        assert len(items) == 120, len(items)

    def test_owner_login_valid_and_invalid(self, client):
        ok = client.post(f"{BASE_URL}/api/admin/login", json={"token": OWNER_TOKEN}, timeout=30)
        assert ok.status_code == 200, ok.text[:300]
        assert ok.json().get("ok") is True
        bad = client.post(f"{BASE_URL}/api/admin/login", json={"token": "nope-invalid"}, timeout=30)
        assert bad.status_code == 401

    def test_license_crud(self, admin):
        email = f"TEST_iter14_{uuid.uuid4().hex[:8]}@example.test"
        create = admin.post(
            f"{BASE_URL}/api/admin/licenses",
            json={"plan": "pro", "seats": 1, "email": email, "days": 30},
            timeout=30,
        )
        assert create.status_code in (200, 201), create.text[:400]
        body = create.json()
        lic = body.get("license") or {}
        lic_key = body.get("licenseKey") or lic.get("licenseKey") or lic.get("key")
        assert lic_key, body
        assert lic.get("plan") == "pro"
        assert lic.get("email") == email

        listing = admin.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30)
        assert listing.status_code == 200
        rows = listing.json().get("licenses") or []
        match = [r for r in rows if email in str(r.get("email")) or str(r.get("licenseKey") or r.get("key")) == lic_key]
        assert match, "created license not found in listing"
        lic_id = match[0].get("id") or match[0].get("licenseId") or lic_key

        delete = admin.delete(f"{BASE_URL}/api/admin/licenses/{lic_id}", timeout=30)
        assert delete.status_code in (200, 204), delete.text[:300]

        after = admin.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30)
        rows2 = after.json().get("licenses") or []
        assert not any(email in str(r.get("email")) for r in rows2), "license still present after delete"
