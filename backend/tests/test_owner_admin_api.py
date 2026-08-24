"""Owner / Super-Admin API tests (2026 rework) + public endpoint regression."""
import os
import re

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

TOKEN = "omnifm-owner-dev-token"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin(client):
    s = requests.Session()
    s.headers.update({"X-Admin-Token": TOKEN})
    return s


# --- module: admin login ---
class TestAdminLogin:
    def test_login_success(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login", json={"token": TOKEN})
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data.get("ok") is True
        assert data.get("role") == "owner"

    def test_login_wrong_token(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login", json={"token": "nope-bad-token"})
        assert r.status_code == 401, r.text[:300]

    def test_login_empty_body(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login", json={})
        assert r.status_code == 401


# --- module: auth guard on all admin routes ---
ADMIN_ROUTES = [
    "/api/admin/overview",
    "/api/admin/licenses",
    "/api/admin/workers",
    "/api/admin/stations",
    "/api/admin/integrations",
    "/api/admin/activity",
]


class TestAdminAuthGuard:
    @pytest.mark.parametrize("route", ADMIN_ROUTES)
    def test_no_token_401(self, client, route):
        r = client.get(f"{BASE_URL}{route}")
        assert r.status_code == 401, f"{route} -> {r.status_code}"

    @pytest.mark.parametrize("route", ADMIN_ROUTES)
    def test_bad_token_401(self, client, route):
        r = client.get(f"{BASE_URL}{route}", headers={"X-Admin-Token": "wrong"})
        assert r.status_code == 401, f"{route} -> {r.status_code}"

    def test_bearer_variant_ok(self, client):
        r = client.get(f"{BASE_URL}/api/admin/overview",
                       headers={"Authorization": f"Bearer {TOKEN}"})
        assert r.status_code == 200, r.text[:300]
        assert r.json()["brand"] == "OmniFM"

    def test_no_mongo_id_leak(self, admin):
        for route in ADMIN_ROUTES:
            body = admin.get(f"{BASE_URL}{route}").text
            assert '"_id"' not in body, f"_id leaked in {route}"


# --- module: /api/admin/overview ---
class TestOverview:
    def test_overview_shape(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/overview")
        assert r.status_code == 200
        d = r.json()
        lic = d["licenses"]
        for k in ("total", "active", "expired", "byPlan", "seatsSold"):
            assert k in lic, k
        assert lic["total"] >= 5
        assert lic["expired"] >= 1
        assert isinstance(lic["byPlan"], dict)
        rev = d["revenue"]
        assert rev["currency"] == "EUR"
        assert rev["mrr"] > 0
        assert round(rev["arr"], 2) == round(rev["mrr"] * 12, 2)
        st = d["stations"]
        assert st["total"] == st["free"] + st["pro"]
        assert st["total"] >= 100
        assert "configured" in d["bots"]
        assert "managed" in d["guilds"]
        assert d["integrations"]["mongo"] is True


# --- module: /api/admin/licenses ---
class TestLicenses:
    def test_licenses_shape_and_masking(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/licenses")
        assert r.status_code == 200
        d = r.json()
        assert d["count"] == len(d["licenses"])
        assert d["count"] >= 5
        for lic in d["licenses"]:
            for k in ("id", "plan", "planName", "seats", "seatsUsed",
                      "active", "expired", "contactEmail"):
                assert k in lic, f"missing {k}"
            assert isinstance(lic["seats"], int) and lic["seats"] >= 1
            assert isinstance(lic["active"], bool)
            email = lic["contactEmail"]
            if email:
                assert "***" in email, f"email not masked: {email}"
                assert not EMAIL_RE.match(email.replace("***", "x")) or "***" in email

    def test_no_raw_seed_email_leak(self, admin):
        body = admin.get(f"{BASE_URL}/api/admin/licenses").text
        for raw in ("admin@lofilounge.io", "owner@synthcity.fm"):
            assert raw not in body, f"raw email leaked: {raw}"

    def test_expired_license_not_active(self, admin):
        licenses = admin.get(f"{BASE_URL}/api/admin/licenses").json()["licenses"]
        expired = [l for l in licenses if l["expired"]]
        assert expired, "expected at least one expired seeded license"
        for l in expired:
            assert l["active"] is False


# --- module: /api/admin/workers ---
class TestWorkers:
    def test_workers(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/workers")
        assert r.status_code == 200
        d = r.json()
        assert d["count"] == len(d["workers"]) >= 1
        assert isinstance(d["commanderIndex"], int)
        roles = {w["role"] for w in d["workers"]}
        assert roles <= {"commander", "worker"}
        assert "commander" in roles
        for w in d["workers"]:
            assert "name" in w and "index" in w


# --- module: /api/admin/stations ---
class TestStations:
    def test_stations(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/stations")
        assert r.status_code == 200
        d = r.json()
        assert d["total"] == d["free"] + d["pro"]
        assert 100 <= d["total"] <= 200
        assert len(d["sample"]) > 0
        for s in d["sample"]:
            assert s["key"] and s["name"]
            assert s["tier"] in ("free", "pro")


# --- module: /api/admin/integrations ---
class TestIntegrations:
    def test_integrations(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/integrations")
        assert r.status_code == 200
        d = r.json()
        assert "discordBotList" in d
        cfg = d["config"]
        for k in ("mongo", "stripe", "discordOAuth", "smtp"):
            assert k in cfg, k
            assert isinstance(cfg[k], bool)
        assert cfg["mongo"] is True


# --- module: /api/admin/activity ---
class TestActivity:
    def test_activity(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/activity")
        assert r.status_code == 200
        d = r.json()
        assert d["count"] == len(d["activity"])
        assert d["count"] >= 1
        for e in d["activity"]:
            assert e["type"] in ("redemption", "license")
            assert e["label"]
            if e.get("detail"):
                assert "@" not in e["detail"] or "***" in e["detail"]


# --- module: public endpoint regression ---
class TestPublicRegression:
    def test_health(self, client):
        r = client.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    @pytest.mark.parametrize("route", ["/api/stats", "/api/stations", "/api/bots",
                                       "/api/commands", "/api/premium/tiers"])
    def test_public_routes(self, client, route):
        r = client.get(f"{BASE_URL}{route}")
        assert r.status_code == 200, f"{route} -> {r.status_code} {r.text[:200]}"
        assert r.json() is not None
        assert '"_id"' not in r.text, f"_id leaked in {route}"
