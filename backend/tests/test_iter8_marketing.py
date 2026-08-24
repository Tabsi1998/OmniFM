"""Iteration 8: Marketing & Listings (owner config section) + public /api/marketing + regression."""
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


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin(client):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Admin-Token": TOKEN})
    r = s.post(f"{BASE_URL}/api/admin/login", json={"token": TOKEN}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:300]}")
    return s


def _no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"_id leaked: {list(obj.keys())}"
        for v in obj.values():
            _no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_mongo_id(v)


# ---------- public /api/marketing ----------
class TestPublicMarketing:
    def test_marketing_shape(self, client):
        r = client.get(f"{BASE_URL}/api/marketing", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert isinstance(d.get("sponsors"), list)
        assert isinstance(d.get("botListings"), list)
        _no_mongo_id(d)

    def test_defaults_yield_empty_lists(self, admin, client):
        """Fresh/default marketing config -> no listings (urls empty) and no sponsors."""
        cfg = admin.get(f"{BASE_URL}/api/admin/config", timeout=30).json()
        m = cfg.get("marketing")
        assert m is not None, "admin config GET missing 'marketing' section"
        assert isinstance(m.get("botListings"), list) and len(m["botListings"]) >= 5
        names = [b["name"] for b in m["botListings"]]
        assert "top.gg" in names
        # only enabled+url listings become public
        pub = client.get(f"{BASE_URL}/api/marketing", timeout=30).json()
        expected = [b for b in m["botListings"] if b.get("enabled") and str(b.get("url") or "").strip()]
        assert len(pub["botListings"]) == len(expected)
        expected_sponsors = [s for s in (m.get("sponsors") or []) if str(s.get("name") or "").strip()]
        assert len(pub["sponsors"]) == len(expected_sponsors)


# ---------- owner marketing save flow ----------
class TestMarketingSave:
    def test_save_listing_and_sponsor_then_public(self, admin, client):
        cfg = admin.get(f"{BASE_URL}/api/admin/config", timeout=30).json()
        m = cfg["marketing"]
        listings = m["botListings"]
        listings[0]["url"] = "https://top.gg/bot/TEST123"
        listings[0]["enabled"] = True
        m["sponsors"] = [{"name": "TEST_Sponsor", "logoUrl": "", "url": "https://test-sponsor.example"}]
        r = admin.put(f"{BASE_URL}/api/admin/config", json={"section": "marketing", "data": m}, timeout=30)
        assert r.status_code == 200, r.text[:300]

        # GET verifies persistence
        cfg2 = admin.get(f"{BASE_URL}/api/admin/config", timeout=30).json()
        assert cfg2["marketing"]["botListings"][0]["url"] == "https://top.gg/bot/TEST123"
        assert cfg2["marketing"]["sponsors"][0]["name"] == "TEST_Sponsor"

        pub = client.get(f"{BASE_URL}/api/marketing", timeout=30).json()
        urls = [b["url"] for b in pub["botListings"]]
        assert "https://top.gg/bot/TEST123" in urls
        assert any(b["name"] == "top.gg" for b in pub["botListings"])
        assert [s["name"] for s in pub["sponsors"]] == ["TEST_Sponsor"]

    def test_disabled_listing_hidden(self, admin, client):
        cfg = admin.get(f"{BASE_URL}/api/admin/config", timeout=30).json()
        m = cfg["marketing"]
        m["botListings"][0]["enabled"] = False
        assert admin.put(f"{BASE_URL}/api/admin/config", json={"section": "marketing", "data": m}, timeout=30).status_code == 200
        pub = client.get(f"{BASE_URL}/api/marketing", timeout=30).json()
        assert "https://top.gg/bot/TEST123" not in [b["url"] for b in pub["botListings"]]
        # re-enable for the frontend test run
        m["botListings"][0]["enabled"] = True
        admin.put(f"{BASE_URL}/api/admin/config", json={"section": "marketing", "data": m}, timeout=30)

    def test_unnamed_sponsor_filtered(self, admin, client):
        cfg = admin.get(f"{BASE_URL}/api/admin/config", timeout=30).json()
        m = cfg["marketing"]
        m["sponsors"] = [{"name": "TEST_Sponsor", "url": ""}, {"name": "  ", "url": "https://x.example"}]
        assert admin.put(f"{BASE_URL}/api/admin/config", json={"section": "marketing", "data": m}, timeout=30).status_code == 200
        pub = client.get(f"{BASE_URL}/api/marketing", timeout=30).json()
        assert [s["name"] for s in pub["sponsors"]] == ["TEST_Sponsor"]

    def test_marketing_requires_admin(self, client):
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "marketing", "data": {}}, timeout=30)
        assert r.status_code in (401, 403), r.status_code


# ---------- regression on other owner endpoints ----------
class TestOwnerRegression:
    @pytest.mark.parametrize("path", [
        "/api/admin/overview", "/api/admin/licenses", "/api/admin/workers",
        "/api/admin/stations", "/api/admin/integrations", "/api/admin/activity",
        "/api/admin/config", "/api/admin/discord/logs",
    ])
    def test_admin_endpoints_ok(self, admin, path):
        r = admin.get(f"{BASE_URL}{path}", timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"
        _no_mongo_id(r.json())

    def test_secrets_masked(self, admin):
        cfg = admin.get(f"{BASE_URL}/api/admin/config", timeout=30).json()
        for key in ("secretKey", "webhookSecret"):
            val = cfg["payments"]["stripe"].get(key, "")
            assert "****" in val or val == "", f"{key} not masked: {val!r}"

    @pytest.mark.parametrize("path", [
        "/api/stations", "/api/stats", "/api/legal", "/api/premium/pricing", "/api/bots", "/api/marketing",
    ])
    def test_public_endpoints_ok(self, client, path):
        r = client.get(f"{BASE_URL}{path}", timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
        _no_mongo_id(r.json())

    def test_station_tiers_present(self, client):
        d = client.get(f"{BASE_URL}/api/stations", timeout=30).json()
        stations = d if isinstance(d, list) else d.get("stations", [])
        tiers = {str(s.get("tier") or s.get("plan") or "").lower() for s in stations}
        assert stations, "no stations returned"
        assert tiers & {"free", "pro", "ultimate"}, f"unexpected tiers: {tiers}"
