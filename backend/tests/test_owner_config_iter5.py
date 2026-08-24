"""Iteration 5 — Owner dynamic config (company/plans/discord/payments),
legal auto-generation, plans -> public pricing, discord logs endpoint."""
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
MASK = "\u2022" * 8


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Admin-Token": TOKEN})
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ---------- auth ----------
class TestAdminAuth:
    def test_login_ok(self, anon):
        r = anon.post(f"{BASE_URL}/api/admin/login", json={"token": TOKEN}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True or r.json().get("token")

    def test_login_bad_token(self, anon):
        r = anon.post(f"{BASE_URL}/api/admin/login", json={"token": "wrong"}, timeout=30)
        assert r.status_code in (401, 403), r.text[:300]

    def test_config_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/admin/config", timeout=30)
        assert r.status_code in (401, 403), r.text[:300]


# ---------- GET config shape ----------
class TestConfigShape:
    def test_get_config_sections(self, client):
        r = client.get(f"{BASE_URL}/api/admin/config", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for sec in ("company", "plans", "discord", "payments", "env"):
            assert sec in d, f"missing section {sec}"
        assert "_id" not in str(d)
        assert d["company"]["country"] == "\u00d6sterreich"
        assert set(["free", "pro", "ultimate"]).issubset(d["plans"].keys())

    def test_put_unknown_section(self, client):
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "bogus", "data": {}}, timeout=30)
        assert r.status_code == 400, r.text[:300]

    def test_put_bad_data(self, client):
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "company", "data": "str"}, timeout=30)
        assert r.status_code == 400, r.text[:300]


# ---------- company + legal auto-generation ----------
class TestCompanyConfig:
    def test_save_company_and_persist(self, client):
        data = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["company"]
        data.update({
            "providerName": "TEST_Max Mustermann e.U.",
            "city": "Graz",
            "postalCode": "8010",
            "streetAddress": "Teststrasse 7",
            "email": "test_owner@omnifm.test",
            "kleinunternehmer": True,
        })
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "company", "data": data}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["data"]["providerName"] == "TEST_Max Mustermann e.U."

        got = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["company"]
        assert got["providerName"] == "TEST_Max Mustermann e.U."
        assert got["city"] == "Graz"
        assert got["email"] == "test_owner@omnifm.test"

    def test_legal_notice_reflects_company(self, anon):
        r = anon.get(f"{BASE_URL}/api/legal", timeout=30)
        assert r.status_code == 200, r.text[:300]
        legal = r.json()["legal"]
        assert legal["providerName"] == "TEST_Max Mustermann e.U."
        assert legal["city"] == "Graz"
        assert legal["kleinunternehmer"] is True
        assert "6 Abs. 1 Z 27 UStG" in legal["taxNote"]
        assert r.json()["isConfigured"] is True

    def test_privacy_and_terms_reflect_company(self, anon):
        p = anon.get(f"{BASE_URL}/api/privacy", timeout=30)
        t = anon.get(f"{BASE_URL}/api/terms", timeout=30)
        assert p.status_code == 200, p.text[:300]
        assert t.status_code == 200, t.text[:300]
        assert "TEST_Max Mustermann e.U." in p.text
        assert "TEST_Max Mustermann e.U." in t.text

    def test_kleinunternehmer_off_removes_tax_note(self, client, anon):
        data = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["company"]
        data["kleinunternehmer"] = False
        assert client.put(f"{BASE_URL}/api/admin/config", json={"section": "company", "data": data}, timeout=30).status_code == 200
        legal = anon.get(f"{BASE_URL}/api/legal", timeout=30).json()["legal"]
        assert legal["kleinunternehmer"] is False
        assert legal["taxNote"] == ""
        # restore
        data["kleinunternehmer"] = True
        client.put(f"{BASE_URL}/api/admin/config", json={"section": "company", "data": data}, timeout=30)


# ---------- plans -> public pricing ----------
class TestPlansConfig:
    def test_save_pro_plan(self, client):
        plans = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["plans"]
        plans["pro"]["pricePerMonth"] = 399
        plans["pro"]["maxBots"] = 9
        plans["pro"]["features"] = ["TEST Feature A", "TEST Feature B"]
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "plans", "data": plans}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        got = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["plans"]
        assert got["pro"]["pricePerMonth"] == 399
        assert got["pro"]["maxBots"] == 9
        assert got["pro"]["features"] == ["TEST Feature A", "TEST Feature B"]

    def test_tiers_endpoint_reflects_plans(self, anon):
        r = anon.get(f"{BASE_URL}/api/premium/tiers", timeout=30)
        assert r.status_code == 200, r.text[:300]
        pro = r.json()["tiers"]["pro"]
        assert pro["pricePerMonth"] == 399
        assert pro["maxBots"] == 9

    def test_pricing_endpoint_reflects_plans(self, anon):
        r = anon.get(f"{BASE_URL}/api/premium/pricing", timeout=30)
        assert r.status_code == 200, r.text[:300]
        pro = r.json()["tiers"]["pro"]
        assert pro["pricePerMonth"] == 399, "pricePerMonth not propagated"
        assert pro["features"] == ["TEST Feature A", "TEST Feature B"]
        # startingAt is what the website actually displays
        assert pro["startingAt"] == "3,99", f"startingAt stale: {pro['startingAt']} (website shows this, not pricePerMonth)"

    def test_restore_plans(self, client):
        plans = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["plans"]
        plans["pro"]["pricePerMonth"] = 299
        plans["pro"]["maxBots"] = 8
        plans["pro"]["features"] = ["Bis zu 8 Bots", "120 Stationen (Free + Pro)", "HQ Audio (128k Opus)", "Priority Reconnect", "Rollenbasierte Berechtigungen", "Event-Scheduler"]
        assert client.put(f"{BASE_URL}/api/admin/config", json={"section": "plans", "data": plans}, timeout=30).status_code == 200


# ---------- discord ----------
class TestDiscordConfig:
    def test_save_commander_and_worker(self, client):
        disc = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["discord"]
        disc["commander"] = {"name": "TEST Commander", "clientId": "123456789012345678",
                             "token": "TESTtoken-commander", "inviteUrl": ""}
        disc["workers"] = [{"name": "TEST Worker 1", "clientId": "223456789012345678",
                            "token": "TESTtoken-worker", "tier": "pro", "inviteUrl": ""}]
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "discord", "data": disc}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        got = r.json()["data"]
        assert got["commander"]["name"] == "TEST Commander"
        assert got["commander"]["token"] == MASK, "commander token not masked in PUT response"
        assert got["commander"].get("tokenSet") is True
        assert got["workers"][0]["token"] == MASK
        assert got["workers"][0]["tier"] == "pro"

    def test_get_masks_tokens(self, client):
        disc = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["discord"]
        assert disc["commander"]["token"] == MASK
        assert "TESTtoken" not in str(disc)

    def test_resave_blank_token_keeps_secret(self, client):
        disc = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["discord"]
        disc["commander"]["token"] = ""  # UI sends blank when tokenSet
        disc["commander"]["name"] = "TEST Commander 2"
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "discord", "data": disc}, timeout=30)
        assert r.status_code == 200
        got = r.json()["data"]
        assert got["commander"]["name"] == "TEST Commander 2"
        assert got["commander"]["token"] == MASK, "secret wiped after blank re-save"
        assert got["commander"].get("tokenSet") is True

    def test_discord_logs_endpoint(self, client):
        r = client.get(f"{BASE_URL}/api/admin/discord/logs", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["connected"] is True  # token set above
        assert d["commanderConfigured"] is True
        assert d["workerCount"] == 1
        assert isinstance(d["logs"], list)
        assert d["note"]

    def test_remove_worker(self, client):
        disc = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["discord"]
        disc["workers"] = []
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "discord", "data": disc}, timeout=30)
        assert r.status_code == 200
        assert r.json()["data"]["workers"] == []
        assert client.get(f"{BASE_URL}/api/admin/discord/logs", timeout=30).json()["workerCount"] == 0


# ---------- payments ----------
class TestPaymentsConfig:
    def test_save_stripe_secret_masked(self, client):
        pay = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["payments"]
        pay["stripe"].update({"enabled": True, "mode": "test",
                              "publishableKey": "pk_test_TEST", "secretKey": "sk_test_TESTSECRET"})
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "payments", "data": pay}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        got = r.json()["data"]
        assert got["stripe"]["enabled"] is True
        assert got["stripe"]["secretKey"] == MASK
        assert got["stripe"].get("secretKeySet") is True
        assert got["stripe"]["publishableKey"] == "pk_test_TEST"

        fresh = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["payments"]
        assert "sk_test_TESTSECRET" not in str(fresh)

    def test_resave_keeps_stripe_secret(self, client):
        pay = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["payments"]
        pay["stripe"]["secretKey"] = ""
        pay["stripe"]["publishableKey"] = "pk_test_TEST2"
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "payments", "data": pay}, timeout=30)
        assert r.status_code == 200
        got = r.json()["data"]
        assert got["stripe"]["secretKey"] == MASK, "stripe secret wiped on blank re-save"
        assert got["stripe"]["publishableKey"] == "pk_test_TEST2"

    def test_resave_masked_value_keeps_secret(self, client):
        pay = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["payments"]
        # send back the masked value verbatim
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "payments", "data": pay}, timeout=30)
        assert r.status_code == 200
        assert r.json()["data"]["stripe"]["secretKey"] == MASK

    def test_paypal_and_custom_provider(self, client):
        pay = client.get(f"{BASE_URL}/api/admin/config", timeout=30).json()["payments"]
        pay["paypal"].update({"enabled": True, "mode": "sandbox", "clientId": "TEST_pp", "secret": "TEST_pp_secret"})
        pay["providers"] = [{"name": "TEST_Klarna", "enabled": False, "note": "later"}]
        r = client.put(f"{BASE_URL}/api/admin/config", json={"section": "payments", "data": pay}, timeout=30)
        assert r.status_code == 200
        got = r.json()["data"]
        assert got["paypal"]["enabled"] is True
        assert got["paypal"]["secret"] == MASK
        assert got["providers"][0]["name"] == "TEST_Klarna"


# ---------- regression on existing owner endpoints ----------
class TestOwnerRegression:
    @pytest.mark.parametrize("path", [
        "/api/admin/overview", "/api/admin/licenses", "/api/admin/workers",
        "/api/admin/stations", "/api/admin/integrations", "/api/admin/activity",
        "/api/admin/audit",
    ])
    def test_admin_endpoints_ok(self, client, path):
        r = client.get(f"{BASE_URL}{path}", timeout=40)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"

    @pytest.mark.parametrize("path", [
        "/api/health", "/api/stations", "/api/bots", "/api/premium/tiers",
        "/api/premium/pricing", "/api/legal",
        "/api/privacy", "/api/terms",
    ])
    def test_public_endpoints_ok(self, anon, path):
        r = anon.get(f"{BASE_URL}{path}", timeout=40)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
