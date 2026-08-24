"""Iteration 12: station health 3-status backend + regressions."""
import os
import requests
import pytest
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
TOKEN = "omnifm-owner-dev-token"
HDR = {"X-Admin-Token": TOKEN, "Content-Type": "application/json"}

SOMA = ["groovesalad", "dronezone", "beatblender"]
PLAYABLE = ["chartsradio", "chilloutradio", "bluesradio"]


# --- Module: /api/admin/stations/health ---
class TestStationHealth:
    def test_health_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/admin/stations/health", json={"keys": ["groovesalad"]}, timeout=60)
        assert r.status_code in (401, 403), r.text

    def test_health_invalid_token(self):
        r = requests.post(f"{BASE_URL}/api/admin/stations/health", json={"keys": ["groovesalad"]},
                          headers={"X-Admin-Token": "nope"}, timeout=60)
        assert r.status_code in (401, 403)

    @pytest.mark.parametrize("keys", [SOMA, PLAYABLE])
    def test_health_returns_discordok_field(self, keys):
        r = requests.post(f"{BASE_URL}/api/admin/stations/health", json={"keys": keys}, headers=HDR, timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        results = data.get("results") or data.get("health") or data
        assert isinstance(results, dict), data
        for k in keys:
            assert k in results, f"{k} missing in {list(results)[:10]}"
            entry = results[k]
            for field in ("ok", "reachable", "discordOk", "status", "latencyMs"):
                assert field in entry, f"{field} missing for {k}: {entry}"
            assert isinstance(entry["discordOk"], bool)
            assert isinstance(entry["reachable"], bool)
        assert "_id" not in str(data)

    def test_health_empty_keys(self):
        r = requests.post(f"{BASE_URL}/api/admin/stations/health", json={"keys": []}, headers=HDR, timeout=60)
        assert r.status_code in (200, 400), r.text

    def test_health_unknown_key(self):
        r = requests.post(f"{BASE_URL}/api/admin/stations/health", json={"keys": ["TEST_does_not_exist"]},
                          headers=HDR, timeout=60)
        assert r.status_code in (200, 400, 404), r.text


# --- Module: owner auth ---
class TestOwnerAuth:
    def test_login_valid(self):
        r = requests.post(f"{BASE_URL}/api/admin/login", json={"token": TOKEN}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/admin/login", json={"token": "bad-token"}, timeout=30)
        assert r.status_code in (401, 403), r.text


# --- Module: public regressions ---
class TestPublicRegressions:
    def test_stats(self):
        r = requests.get(f"{BASE_URL}/api/stats", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for f in ("servers", "stations", "bots"):
            assert f in d, d
        assert int(d["stations"]) >= 100, d

    def test_radio_catalog_120(self):
        r = requests.get(f"{BASE_URL}/api/stations", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        stations = d.get("stations") if isinstance(d, dict) else d
        assert isinstance(stations, list)
        assert len(stations) >= 100, len(stations)
        keys = {s["key"] for s in stations}
        for k in SOMA + PLAYABLE:
            assert k in keys, f"{k} missing from catalog"

    def test_admin_stations_list(self):
        r = requests.get(f"{BASE_URL}/api/admin/stations", headers=HDR, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("total", 0) >= 100 or len(d.get("stations", [])) >= 100, d
