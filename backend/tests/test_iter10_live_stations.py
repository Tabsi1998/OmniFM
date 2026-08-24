"""Iteration 10: clean/live owner overview, station CRUD, station live-health."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
TOKEN = "omnifm-owner-dev-token"
HDR = {"X-Admin-Token": TOKEN, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update(HDR)
    return s


# --- module: public stats -------------------------------------------------
class TestPublicStats:
    def test_stats_real_values(self, client):
        r = requests.get(f"{BASE_URL}/api/stats", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("servers") == 0, d
        assert d.get("stations") == 120, d
        assert d.get("bots") == 1, d
        assert d.get("listeners") == 0, d

    def test_stations_public_no_objectid(self):
        r = requests.get(f"{BASE_URL}/api/stations", timeout=30)
        assert r.status_code == 200
        d = r.json()
        st = d.get("stations") or d
        assert isinstance(st, list) and len(st) == 120, len(st)
        assert all("_id" not in s for s in st)


# --- module: admin overview (clean live values) ---------------------------
class TestAdminOverview:
    def test_requires_token(self):
        r = requests.get(f"{BASE_URL}/api/admin/overview", timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_overview_clean(self, client):
        r = client.get(f"{BASE_URL}/api/admin/overview", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["licenses"]["total"] == 0, d["licenses"]
        assert d["licenses"]["active"] == 0, d["licenses"]
        assert d["licenses"]["seatsSold"] == 0, d["licenses"]
        assert d["revenue"]["mrr"] == 0, d["revenue"]
        assert d["revenue"]["arr"] == 0, d["revenue"]
        assert d["guilds"]["managed"] == 0, d["guilds"]
        assert d["stations"]["total"] == 120, d["stations"]
        assert d["stations"]["free"] + d["stations"]["pro"] <= d["stations"]["total"]

    def test_licenses_empty(self, client):
        r = client.get(f"{BASE_URL}/api/admin/licenses", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["count"] == 0, d
        assert d["licenses"] == []


# --- module: admin station list ------------------------------------------
class TestStationList:
    def test_list(self, client):
        r = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["count"] >= 120, d["count"]
        row = d["stations"][0]
        for f in ("key", "name", "url", "tier"):
            assert f in row, row
        assert "_id" not in row
        tiers = {s["tier"] for s in d["stations"]}
        assert "free" in tiers and "pro" in tiers, tiers


# --- module: station live health -----------------------------------------
class TestStationHealth:
    def test_health_requires_token(self):
        r = requests.post(f"{BASE_URL}/api/admin/stations/health",
                          json={"keys": ["groovesalad"]}, timeout=60)
        assert r.status_code in (401, 403), r.status_code

    def test_health_specific_keys(self, client):
        r = client.post(f"{BASE_URL}/api/admin/stations/health",
                        json={"keys": ["groovesalad", "dronezone"]}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        res = d.get("results")
        assert isinstance(res, dict), d
        assert set(res.keys()) == {"groovesalad", "dronezone"}, res.keys()
        for k, v in res.items():
            assert set(["ok", "reachable", "status", "latencyMs"]).issubset(v.keys()), v
            assert isinstance(v["ok"], bool)
            assert isinstance(v["reachable"], bool)
            assert isinstance(v["latencyMs"], int)
        # somafm streams should be genuinely reachable
        assert res["groovesalad"]["reachable"] is True, res["groovesalad"]

    def test_health_batch_of_15(self, client):
        lst = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        keys = [s["key"] for s in lst[:15]]
        r = client.post(f"{BASE_URL}/api/admin/stations/health", json={"keys": keys}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["count"] == len(keys), (d["count"], len(keys))

    def test_health_empty_body_defaults(self, client):
        r = client.post(f"{BASE_URL}/api/admin/stations/health", json={}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["count"] > 0
        assert d["count"] <= 25


# --- module: station CRUD -------------------------------------------------
class TestStationCRUD:
    KEY = "testlive"

    def test_create_list_delete(self, client):
        payload = {"key": self.KEY, "name": "Test Live",
                   "url": "https://ice4.somafm.com/groovesalad-128-mp3", "tier": "free"}
        c = client.post(f"{BASE_URL}/api/admin/stations", json=payload, timeout=30)
        assert c.status_code in (200, 201), c.text[:300]

        lst = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        found = [s for s in lst if s["key"] == self.KEY]
        assert found, "created station not present in list"
        assert found[0]["name"] == "Test Live"
        assert found[0]["url"] == payload["url"]
        assert found[0]["tier"] == "free"

        # health check on newly created station works
        h = client.post(f"{BASE_URL}/api/admin/stations/health",
                        json={"keys": [self.KEY]}, timeout=60).json()
        assert self.KEY in h["results"], h

        d = client.delete(f"{BASE_URL}/api/admin/stations/{self.KEY}", timeout=30)
        assert d.status_code in (200, 204), d.text[:300]

        lst2 = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        assert not [s for s in lst2 if s["key"] == self.KEY], "station still present after delete"

    def test_update_existing_station(self, client):
        key = "testlive2"
        client.post(f"{BASE_URL}/api/admin/stations",
                    json={"key": key, "name": "TEST_A",
                          "url": "https://ice4.somafm.com/dronezone-128-mp3", "tier": "free"}, timeout=30)
        u = client.post(f"{BASE_URL}/api/admin/stations",
                        json={"key": key, "name": "TEST_B",
                              "url": "https://ice4.somafm.com/dronezone-128-mp3", "tier": "pro"}, timeout=30)
        assert u.status_code in (200, 201), u.text[:300]
        lst = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        row = next((s for s in lst if s["key"] == key), None)
        assert row is not None
        assert row["name"] == "TEST_B", row
        assert row["tier"] == "pro", row
        client.delete(f"{BASE_URL}/api/admin/stations/{key}", timeout=30)

    def test_create_invalid_payload(self, client):
        r = client.post(f"{BASE_URL}/api/admin/stations", json={"key": "", "name": "", "url": ""}, timeout=30)
        assert r.status_code == 400, (r.status_code, r.text[:200])

    def test_cleanup_verify(self, client):
        lst = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()
        assert not [s for s in lst["stations"] if s["key"].startswith("testlive")]
        assert lst["count"] == 120, lst["count"]
