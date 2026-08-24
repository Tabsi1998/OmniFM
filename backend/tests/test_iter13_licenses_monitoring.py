"""Iteration 13 — Owner console License Manager CRUD + honest live monitoring."""
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
TEST_GUILD = "999000111222333444"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


@pytest.fixture(scope="module")
def created_keys():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(client, created_keys):
    yield
    for k in created_keys:
        try:
            client.delete(f"{BASE_URL}/api/admin/licenses/{k}", timeout=30)
        except Exception:
            pass


# ---------- Auth guard ----------
class TestAuthGuard:
    def test_licenses_requires_token(self):
        r = requests.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30)
        assert r.status_code == 401, r.text[:300]

    def test_licenses_invalid_token(self):
        r = requests.get(f"{BASE_URL}/api/admin/licenses?full=1",
                         headers={"X-Admin-Token": "wrong-token"}, timeout=30)
        assert r.status_code == 401, r.text[:300]

    def test_monitoring_invalid_token(self):
        r = requests.get(f"{BASE_URL}/api/admin/monitoring",
                         headers={"X-Admin-Token": "wrong"}, timeout=30)
        assert r.status_code == 401


# ---------- License list ----------
class TestLicenseList:
    def test_full_list_shape(self, client):
        r = client.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert isinstance(data.get("licenses"), list)
        assert data.get("count") == len(data["licenses"])
        if data["licenses"]:
            row = data["licenses"][0]
            for field in ("licenseKey", "plan", "seats", "email", "note",
                          "linkedServerIds", "daysLeft", "expired"):
                assert field in row, f"missing {field} in {row}"
            assert row["licenseKey"].startswith("OMNI-")
            assert "_id" not in row


# ---------- Create ----------
class TestLicenseCreate:
    def test_create_bad_tier(self, client):
        r = client.post(f"{BASE_URL}/api/admin/licenses",
                        json={"email": "TEST_bad@example.com", "tier": "gold", "months": 1}, timeout=30)
        assert r.status_code == 400, r.text[:300]

    def test_create_and_persist(self, client, created_keys):
        payload = {"email": "TEST_iter13@example.com", "tier": "pro", "months": 3,
                   "seats": 2, "note": "TEST_note", "guildId": TEST_GUILD}
        r = client.post(f"{BASE_URL}/api/admin/licenses", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert body.get("ok") is True
        key = body.get("licenseKey")
        assert key and key.startswith("OMNI-")
        assert len(key.split("-")) == 4
        created_keys.append(key)

        rows = client.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30).json()["licenses"]
        row = next((x for x in rows if x["licenseKey"] == key), None)
        assert row is not None, "created license not in list"
        assert row["email"] == "TEST_iter13@example.com"
        assert row["plan"] == "pro"
        assert row["seats"] == 2
        assert row["note"] == "TEST_note"
        assert TEST_GUILD in row["linkedServerIds"]
        assert row["expired"] is False
        assert 85 <= row["daysLeft"] <= 92, row["daysLeft"]


# ---------- Patch flows ----------
def _row(client, key):
    rows = client.get(f"{BASE_URL}/api/admin/licenses?full=1", timeout=30).json()["licenses"]
    return next((x for x in rows if x["licenseKey"] == key), None)


@pytest.fixture(scope="class")
def lic_key(created_keys):
    s = requests.Session()
    s.headers.update(HEADERS)
    r = s.post(f"{BASE_URL}/api/admin/licenses",
               json={"email": "TEST_patch@example.com", "tier": "pro", "months": 6,
                     "seats": 1, "note": "TEST_patch"}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    key = r.json()["licenseKey"]
    created_keys.append(key)
    return key


class TestLicensePatch:
    def test_extend_days_plus_30(self, client, lic_key):
        before = _row(client, lic_key)["daysLeft"]
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"extendDays": 30}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        after = _row(client, lic_key)["daysLeft"]
        assert after - before in (29, 30, 31), f"{before} -> {after}"

    def test_shorten_days_minus_60(self, client, lic_key):
        before = _row(client, lic_key)["daysLeft"]
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"extendDays": -60}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        after = _row(client, lic_key)["daysLeft"]
        assert before - after in (59, 60, 61), f"{before} -> {after}"

    def test_extend_months(self, client, lic_key):
        before = _row(client, lic_key)["daysLeft"]
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"extendMonths": 1}, timeout=30)
        assert r.status_code == 200
        after = _row(client, lic_key)["daysLeft"]
        assert after - before in (29, 30, 31), f"{before} -> {after}"

    def test_tier_upgrade(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"tier": "ultimate"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert _row(client, lic_key)["plan"] == "ultimate"

    def test_tier_invalid(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"tier": "diamond"}, timeout=30)
        assert r.status_code == 400

    def test_email_note_seats(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}",
                         json={"email": "TEST_new@example.com", "note": "TEST_updated", "seats": 3}, timeout=30)
        assert r.status_code == 200
        row = _row(client, lic_key)
        assert row["email"] == "TEST_new@example.com"
        assert row["note"] == "TEST_updated"
        assert row["seats"] == 3

    def test_add_then_remove_server(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"addServerId": "123456789012345678"}, timeout=30)
        assert r.status_code == 200
        assert "123456789012345678" in _row(client, lic_key)["linkedServerIds"]
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"removeServerId": "123456789012345678"}, timeout=30)
        assert r.status_code == 200
        assert "123456789012345678" not in _row(client, lic_key)["linkedServerIds"]

    def test_replace_linked_server_ids(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}",
                         json={"linkedServerIds": ["111111111111111111", "222222222222222222"]}, timeout=30)
        assert r.status_code == 200
        assert sorted(_row(client, lic_key)["linkedServerIds"]) == ["111111111111111111", "222222222222222222"]

    def test_set_expires_at_date_string(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"expiresAt": "2030-01-15"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        row = _row(client, lic_key)
        assert str(row["expiresAt"]).startswith("2030-01-15")
        assert row["expired"] is False

    def test_expires_at_invalid(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"expiresAt": "not-a-date"}, timeout=30)
        assert r.status_code == 400

    def test_expire_now(self, client, lic_key):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/{lic_key}", json={"expireNow": True}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        row = _row(client, lic_key)
        assert row["expired"] is True
        assert row["active"] is False

    def test_patch_unknown_key(self, client):
        r = client.patch(f"{BASE_URL}/api/admin/licenses/OMNI-XXXX-XXXX-XXXX", json={"note": "x"}, timeout=30)
        assert r.status_code == 404, r.text[:300]


# ---------- Delete ----------
class TestLicenseDelete:
    def test_delete_and_verify_removal(self, client):
        r = client.post(f"{BASE_URL}/api/admin/licenses",
                        json={"email": "TEST_del@example.com", "tier": "ultimate", "months": 1}, timeout=30)
        assert r.status_code == 200
        key = r.json()["licenseKey"]
        d = client.delete(f"{BASE_URL}/api/admin/licenses/{key}", timeout=30)
        assert d.status_code == 200, d.text[:300]
        assert d.json().get("ok") is True
        assert _row(client, key) is None

    def test_delete_unknown_key(self, client):
        r = client.delete(f"{BASE_URL}/api/admin/licenses/OMNI-ZZZZ-ZZZZ-ZZZZ", timeout=30)
        assert r.status_code == 404


# ---------- Monitoring honesty ----------
class TestMonitoringHonesty:
    def test_waiting_state(self, client):
        r = client.get(f"{BASE_URL}/api/admin/monitoring", timeout=30)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d.get("simulated") is False
        assert d.get("live") is False
        assert d.get("waiting") is True
        assert d.get("nodes") == []
        assert d.get("incidents") == []
        assert isinstance(d.get("message"), str) and "Live-Daten" in d["message"]
        assert d["health"]["totalNodes"] == 0
        assert d["health"]["mongo"] is True


# ---------- Regression ----------
class TestRegression:
    def test_stats(self):
        r = requests.get(f"{BASE_URL}/api/stats", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_admin_login_valid(self):
        r = requests.post(f"{BASE_URL}/api/admin/login", json={"token": TOKEN}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True

    def test_admin_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/admin/login", json={"token": "nope"}, timeout=30)
        assert r.status_code == 401

    def test_admin_overview(self, client):
        r = client.get(f"{BASE_URL}/api/admin/overview", timeout=30)
        assert r.status_code == 200

    def test_admin_stations_summary(self, client):
        r = client.get(f"{BASE_URL}/api/admin/stations", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("total") == 120, data.get("total")
        assert isinstance(data.get("sample"), list)

    def test_public_stations_count(self):
        r = requests.get(f"{BASE_URL}/api/stations", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("total") == 120
        assert len(data.get("stations") or []) == 120
