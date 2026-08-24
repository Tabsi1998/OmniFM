"""Iteration 9 — verify public endpoints return REAL data (no demo/fake values)."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
ADMIN_TOKEN = "omnifm-owner-dev-token"

FAKE_STRINGS = ["BassDrop", "Netsky", "Synthwave Nights", "Lofi Lounge", "Neon City FM", "Idealism", "Gunship"]


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- /api/stats -------------------------------------------------------------
class TestStats:
    def test_stats_real_numbers(self, client):
        r = client.get(f"{BASE_URL}/api/stats", timeout=30)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        for key in ("servers", "users", "connections", "listeners", "bots", "stations"):
            assert key in d, f"missing {key}"
            assert isinstance(d[key], int), f"{key} not numeric: {d[key]!r}"
        assert d["stations"] == 120, d
        assert d["servers"] == 0, f"expected 0 real servers, got {d['servers']}"
        assert d["listeners"] == 0, f"expected 0 real listeners, got {d['listeners']}"

    def test_stats_no_fabricated_values(self, client):
        d = client.get(f"{BASE_URL}/api/stats", timeout=30).json()
        assert d["servers"] not in (1280, 1240)
        assert d["listeners"] not in (1280, 1240)


# --- /api/stations ----------------------------------------------------------
class TestStations:
    def test_station_catalog(self, client):
        r = client.get(f"{BASE_URL}/api/stations", timeout=30)
        assert r.status_code == 200
        d = r.json()
        stations = d if isinstance(d, list) else d.get("stations")
        assert isinstance(stations, list)
        assert len(stations) == 120, len(stations)
        for s in stations:
            assert s.get("key") and s.get("name") and s.get("url")
            assert s.get("tier") in ("free", "pro", "ultimate"), s
        assert "_id" not in stations[0]

    def test_no_fake_station_names(self, client):
        raw = client.get(f"{BASE_URL}/api/stations", timeout=30).text
        found = [f for f in FAKE_STRINGS if f.lower() in raw.lower()]
        assert not found, f"fake station names in catalog: {found}"

    def test_tier_counts_match_stats(self, client):
        stats = client.get(f"{BASE_URL}/api/stats", timeout=30).json()
        d = client.get(f"{BASE_URL}/api/stations", timeout=30).json()
        stations = d if isinstance(d, list) else d["stations"]
        free = len([s for s in stations if s["tier"] == "free"])
        assert free == stats.get("freeStations"), (free, stats.get("freeStations"))


# --- owner console auth -----------------------------------------------------
class TestAdminLogin:
    def test_admin_login_with_token(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login", json={"token": ADMIN_TOKEN}, timeout=30)
        assert r.status_code == 200, r.text[:400]
        assert r.json().get("ok") is True or "token" in r.json()

    def test_admin_login_rejects_bad_token(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login", json={"token": "wrong-token"}, timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_admin_overview_requires_auth(self, client):
        r = client.get(f"{BASE_URL}/api/admin/overview", timeout=30)
        assert r.status_code in (401, 403)

    def test_admin_overview_with_token(self, client):
        r = client.get(f"{BASE_URL}/api/admin/overview", headers={"X-Admin-Token": ADMIN_TOKEN}, timeout=30)
        assert r.status_code == 200, r.text[:400]
        assert isinstance(r.json(), dict)


# --- cover endpoint used by hero/showcase ----------------------------------
def test_cover_endpoint(client):
    r = client.get(f"{BASE_URL}/api/cover", params={"term": "Beat Blender"}, timeout=40)
    assert r.status_code == 200, r.text[:300]
    assert "ok" in r.json()
