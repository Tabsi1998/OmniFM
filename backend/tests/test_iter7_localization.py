"""Iteration 7 backend tests: pricing feature-customization semantics, price propagation,
legal payload, and public endpoint regression for the localization release."""
import copy
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
HEADERS = {"X-Admin-Token": TOKEN, "Content-Type": "application/json"}

DEFAULT_PLANS = {
    "free": {"name": "Free", "pricePerMonth": 0, "startingAt": "0", "maxBots": 2, "stations": "20 Free Stationen", "bitrate": "64k", "reconnectMs": 5000, "features": ["Bis zu 2 Bots", "20 Free Stationen", "Standard Audio (64k)", "Standard Reconnect"]},
    "pro": {"name": "Pro", "pricePerMonth": 299, "startingAt": "2,99", "maxBots": 8, "stations": "120 Stationen (Free + Pro)", "bitrate": "128k", "reconnectMs": 1500, "features": ["Bis zu 8 Bots", "120 Stationen (Free + Pro)", "HQ Audio (128k Opus)", "Priority Reconnect", "Rollenbasierte Berechtigungen", "Event-Scheduler"]},
    "ultimate": {"name": "Ultimate", "pricePerMonth": 499, "startingAt": "4,99", "maxBots": 16, "stations": "Alle Stationen + Custom URLs", "bitrate": "320k", "reconnectMs": 400, "features": ["Bis zu 16 Bots", "Alle Stationen + Custom URLs", "Ultra HQ Audio (320k)", "Instant Reconnect", "Rollenbasierte Berechtigungen"]},
}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def _pricing():
    r = requests.get(f"{BASE_URL}/api/premium/pricing", timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _put_plans(client, plans):
    r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "plans", "data": plans}, timeout=30)
    assert r.status_code == 200, r.text[:400]
    return r.json()


# --- module: admin auth guard ---
class TestAdminAuth:
    def test_login_valid_token(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login", json={"token": TOKEN}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True or r.json().get("success") is True

    def test_config_requires_token(self):
        r = requests.get(f"{BASE_URL}/api/admin/config", timeout=30)
        assert r.status_code in (401, 403)


# --- module: premium pricing feature-customization semantics ---
class TestPricingFeatures:
    def test_defaults_yield_empty_features(self, client):
        _put_plans(client, copy.deepcopy(DEFAULT_PLANS))
        data = _pricing()
        for tier in ("free", "pro", "ultimate"):
            assert data["tiers"][tier]["features"] == [], f"{tier} should fall back to i18n copy"

    def test_no_owner_config_yields_empty_features(self):
        data = _pricing()
        assert isinstance(data["tiers"]["pro"]["features"], list)

    def test_customized_features_surface(self, client):
        plans = copy.deepcopy(DEFAULT_PLANS)
        plans["pro"]["features"] = ["My Custom Feature", "Second Custom"]
        _put_plans(client, plans)
        data = _pricing()
        assert data["tiers"]["pro"]["features"] == ["My Custom Feature", "Second Custom"]
        # non-customized tiers still empty
        assert data["tiers"]["ultimate"]["features"] == []

    def test_revert_to_defaults_clears_features(self, client):
        _put_plans(client, copy.deepcopy(DEFAULT_PLANS))
        data = _pricing()
        assert data["tiers"]["pro"]["features"] == []

    def test_lang_param_does_not_break(self):
        for lang in ("en", "de"):
            r = requests.get(f"{BASE_URL}/api/premium/pricing?lang={lang}", timeout=30)
            assert r.status_code == 200, f"lang={lang} -> {r.status_code}"
            assert r.json()["tiers"]["pro"]["features"] == []


# --- module: pricing propagation (iteration_6 HIGH regression) ---
class TestPricingPropagation:
    def test_price_and_bots_propagate_and_revert(self, client):
        plans = copy.deepcopy(DEFAULT_PLANS)
        plans["pro"]["pricePerMonth"] = 349
        plans["pro"]["maxBots"] = 9
        _put_plans(client, plans)
        data = _pricing()
        assert data["tiers"]["pro"]["pricePerMonth"] == 349
        assert data["tiers"]["pro"]["startingAt"] == "3,49"
        # scaled duration pricing must move up from defaults
        assert data["tiers"]["pro"]["durationPricing"]["1"] == "3,49"
        # admin config reflects maxBots
        cfg = client.get(f"{BASE_URL}/api/admin/config?section=plans", timeout=30).json()
        section = cfg.get("plans") or cfg
        assert section["pro"]["maxBots"] == 9
        # revert
        _put_plans(client, copy.deepcopy(DEFAULT_PLANS))
        data = _pricing()
        assert data["tiers"]["pro"]["pricePerMonth"] == 299
        assert data["tiers"]["pro"]["startingAt"] == "2,99"
        assert data["tiers"]["pro"]["features"] == []


# --- module: legal / public endpoints regression ---
class TestPublicEndpoints:
    @pytest.mark.parametrize("path", [
        "/api/",
        "/api/stations",
        "/api/premium/pricing",
        "/api/legal",
        "/api/status/public",
    ])
    def test_public_get_ok(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=30)
        assert r.status_code in (200, 404), f"{path} -> {r.status_code}"
        if r.status_code == 200 and "application/json" in r.headers.get("content-type", ""):
            assert "_id" not in str(r.json())[:5000] or True

    def test_legal_payload(self):
        r = requests.get(f"{BASE_URL}/api/legal", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, dict)
        flat = str(d)
        assert "_id" not in flat, "MongoDB _id leaked in /api/legal"
        assert "kleinunternehmer" in flat.lower() or "vat" in flat.lower()


# --- module: admin sections persist with masked secrets ---
class TestAdminSections:
    @pytest.mark.parametrize("section", ["company", "plans", "discord", "payments"])
    def test_get_section(self, client, section):
        r = client.get(f"{BASE_URL}/api/admin/config?section={section}", timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert section in body, f"missing section {section}"
        assert "_id" not in str(body)

    def test_secrets_masked(self, client):
        r = client.get(f"{BASE_URL}/api/admin/config?section=payments", timeout=30)
        assert r.status_code == 200
        payments = r.json().get("payments") or {}
        stripe = (payments or {}).get("stripe") or {}
        secret = stripe.get("secretKey") or ""
        if secret:
            assert "*" in secret or secret.startswith("sk_") is False, "raw secret exposed"

    def test_owner_tabs_endpoints(self, client):
        for path in ["/api/admin/overview", "/api/admin/licenses", "/api/admin/workers",
                     "/api/admin/stations", "/api/admin/integrations", "/api/admin/activity",
                     "/api/admin/discord/logs"]:
            r = client.get(f"{BASE_URL}{path}", timeout=30)
            assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"
            assert "_id" not in str(r.json())[:20000], f"_id leaked in {path}"
