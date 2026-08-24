"""Iteration 6 backend tests: pricing propagation from owner plans config,
secret merge by identity, localized legal tax note, regression on public/admin endpoints."""
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


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def get_section(client, name):
    r = client.get(f"{BASE_URL}/api/admin/config", params={"section": name}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()[name]


def put_section(client, name, data):
    r = client.put(f"{BASE_URL}/api/admin/config", json={"section": name, "data": data}, timeout=30)
    return r


# ---------------- Health / auth ----------------
class TestAuth:
    def test_admin_login(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login", json={"token": TOKEN}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True or r.json().get("authenticated") is True

    def test_admin_login_bad_token(self):
        r = requests.post(f"{BASE_URL}/api/admin/login", json={"token": "nope"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_config_requires_token(self):
        r = requests.get(f"{BASE_URL}/api/admin/config?section=plans", timeout=30)
        assert r.status_code in (401, 403)


# ---------------- Pricing propagation (HIGH bug retest) ----------------
class TestPricingPropagation:
    def test_configured_price_and_features_propagate(self, client):
        original = get_section(client, "plans")
        try:
            plans = dict(original or {})
            pro = dict(plans.get("pro") or {})
            pro.update({"pricePerMonth": 349, "maxBots": 9,
                        "features": ["QA Feat A", "QA Feat B"]})
            plans["pro"] = pro
            r = put_section(client, "plans", plans)
            assert r.status_code == 200, r.text[:400]

            saved = get_section(client, "plans")
            assert saved["pro"]["pricePerMonth"] == 349
            assert saved["pro"]["maxBots"] == 9
            assert saved["pro"]["features"] == ["QA Feat A", "QA Feat B"]

            pr = requests.get(f"{BASE_URL}/api/premium/pricing", timeout=30)
            assert pr.status_code == 200
            tier = pr.json()["tiers"]["pro"]
            assert tier["pricePerMonth"] == 349
            assert tier["features"] == ["QA Feat A", "QA Feat B"]
            # startingAt derived from configured price
            assert tier["startingAt"].replace(",", ".") == "3.49", tier["startingAt"]
            # duration/seat pricing scaled proportionally (base 2.99 -> ratio 349/299)
            dp = tier["durationPricing"]
            assert dp["1"].replace(",", ".") == "3.49", dp
            twelve = float(dp["12"].replace(",", "."))
            assert 2.2 < twelve < 2.5, dp
            sp = tier["seatPricing"]
            assert sp["1"].replace(",", ".") == "3.49", sp
            assert float(sp["2"].replace(",", ".")) > 3.49

            tr = requests.get(f"{BASE_URL}/api/premium/tiers", timeout=30)
            assert tr.status_code == 200
        finally:
            put_section(client, "plans", original)

    def test_defaults_after_restore(self, client):
        pr = requests.get(f"{BASE_URL}/api/premium/pricing", timeout=30)
        assert pr.status_code == 200
        tier = pr.json()["tiers"]["pro"]
        assert tier["startingAt"].replace(",", ".") == "2.99", tier["startingAt"]

    def test_no_mongo_id_leak(self):
        r = requests.get(f"{BASE_URL}/api/premium/pricing", timeout=30)
        assert "_id" not in r.text


# ---------------- Secret merge by identity ----------------
class TestSecretMergeIdentity:
    def test_worker_token_not_leaked_on_reorder(self, client):
        original = get_section(client, "discord")
        try:
            base = dict(original or {})
            base["workers"] = [
                {"name": "QA W1", "clientId": "111111111111111111", "token": "QA_TOKEN_ONE"},
            ]
            assert put_section(client, "discord", base).status_code == 200

            got = get_section(client, "discord")
            w = got["workers"][0]
            assert w["token"].startswith("\u2022") or w.get("tokenSet") is True

            # add a second worker BEFORE the first (reorder) with masked token for W1
            base2 = dict(got)
            base2["workers"] = [
                {"name": "QA W2", "clientId": "222222222222222222", "token": ""},
                {"name": "QA W1", "clientId": "111111111111111111", "token": w["token"]},
            ]
            assert put_section(client, "discord", base2).status_code == 200
            got2 = get_section(client, "discord")
            by_name = {x["name"]: x for x in got2["workers"]}
            assert by_name["QA W1"].get("tokenSet") is True, got2["workers"]
            assert not by_name["QA W2"].get("tokenSet"), "token leaked to new worker QA W2"

            # remove W1 -> W2 must still have no token
            base3 = dict(got2)
            base3["workers"] = [
                {"name": "QA W2", "clientId": "222222222222222222", "token": ""},
            ]
            assert put_section(client, "discord", base3).status_code == 200
            got3 = get_section(client, "discord")
            assert not got3["workers"][0].get("tokenSet"), got3["workers"]
        finally:
            put_section(client, "discord", original)

    def test_secrets_masked_on_get(self, client):
        original = get_section(client, "payments")
        try:
            data = dict(original or {})
            stripe = dict(data.get("stripe") or {})
            stripe["secretKey"] = "sk_test_QA_SECRET_123"
            data["stripe"] = stripe
            assert put_section(client, "payments", data).status_code == 200
            got = get_section(client, "payments")
            assert "sk_test_QA_SECRET_123" not in str(got)
            assert got["stripe"].get("secretKeySet") is True
        finally:
            put_section(client, "payments", original)


# ---------------- Localized legal tax note ----------------
class TestLegalLocalization:
    def test_kleinunternehmer_note_de_en(self, client):
        original = get_section(client, "company")
        try:
            data = dict(original or {})
            data["kleinunternehmer"] = True
            assert put_section(client, "company", data).status_code == 200

            de = requests.get(f"{BASE_URL}/api/legal", params={"lang": "de"}, timeout=30)
            en = requests.get(f"{BASE_URL}/api/legal", params={"lang": "en"}, timeout=30)
            assert de.status_code == 200 and en.status_code == 200
            assert de.json()["legal"]["kleinunternehmer"] is True, de.json()
            assert "UStG" in de.json()["legal"]["taxNote"], de.json()["legal"]["taxNote"]
            # localization itself happens in the frontend copy (verified via UI test)
            assert en.json()["legal"]["kleinunternehmer"] is True
        finally:
            put_section(client, "company", original)


# ---------------- Regression: public + admin endpoints ----------------
@pytest.mark.parametrize("path", [
    "/api/health", "/api/stations", "/api/bots", "/api/premium/tiers",
    "/api/premium/pricing", "/api/legal", "/api/privacy", "/api/terms",
])
def test_public_endpoints_ok(path):
    r = requests.get(f"{BASE_URL}{path}", timeout=30)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


@pytest.mark.parametrize("path", [
    "/api/admin/overview", "/api/admin/licenses", "/api/admin/workers",
    "/api/admin/stations", "/api/admin/integrations", "/api/admin/activity",
    "/api/admin/discord/logs", "/api/admin/monitoring",
])
def test_admin_endpoints_ok(client, path):
    r = client.get(f"{BASE_URL}{path}", timeout=30)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


class TestStationCrud:
    def test_create_update_delete_station(self, client):
        payload = {"key": "test-qa-iter6", "name": "TEST_QA Station",
                   "url": "https://ice4.somafm.com/beatblender-128-mp3",
                   "genre": "test", "tier": "free"}
        r = client.post(f"{BASE_URL}/api/admin/stations", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        sid = r.json()["station"]["key"]

        items = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        assert any(s.get("key") == sid for s in items)

        up = client.post(f"{BASE_URL}/api/admin/stations", json={**payload, "name": "TEST_QA Station 2"}, timeout=30)
        assert up.status_code == 200, up.text[:300]

        items2 = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        found = [s for s in items2 if s.get("key") == sid]
        assert found and found[0]["name"] == "TEST_QA Station 2"

        d = client.delete(f"{BASE_URL}/api/admin/stations/{sid}", timeout=30)
        assert d.status_code in (200, 204), d.text[:300]
        items3 = client.get(f"{BASE_URL}/api/admin/stations/list", timeout=30).json()["stations"]
        assert not any(s.get("key") == sid for s in items3)
