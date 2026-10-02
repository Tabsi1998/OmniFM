import os
import time
from pathlib import Path

import pytest
import requests


# Contract parity and security guard tests for legal/privacy/workers/premium/admin endpoints
REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ENV_PATH = REPO_ROOT / "frontend" / ".env"


def _load_base_url() -> str:
    env_value = (os.environ.get("REACT_APP_BACKEND_URL") or "").strip()
    if env_value:
        return env_value.rstrip("/")

    if not FRONTEND_ENV_PATH.exists():
        pytest.skip("frontend/.env not found and REACT_APP_BACKEND_URL is unset; cannot resolve public base URL", allow_module_level=True)
    for line in FRONTEND_ENV_PATH.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if clean.startswith("REACT_APP_BACKEND_URL="):
            value = clean.split("=", 1)[1].strip().strip('"').strip("'")
            if value:
                return value.rstrip("/")
    pytest.skip("REACT_APP_BACKEND_URL missing in frontend/.env", allow_module_level=True)


BASE_URL = _load_base_url()


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def test_legal_privacy_and_terms_endpoints_return_200_json(api_client):
    legal_res = api_client.get(f"{BASE_URL}/api/legal", timeout=15)
    privacy_res = api_client.get(f"{BASE_URL}/api/privacy", timeout=15)
    terms_res = api_client.get(f"{BASE_URL}/api/terms", timeout=15)

    assert legal_res.status_code == 200
    assert privacy_res.status_code == 200
    assert terms_res.status_code == 200

    legal_data = legal_res.json()
    privacy_data = privacy_res.json()
    terms_data = terms_res.json()

    assert isinstance(legal_data, dict)
    assert isinstance(privacy_data, dict)
    assert isinstance(terms_data, dict)
    assert "legal" in legal_data
    assert "controller" in privacy_data
    assert "operator" in terms_data


def test_season_switches_are_public(api_client):
    # The owner's main switch per season for the website's decoration (#427).
    response = api_client.get(f"{BASE_URL}/api/season", timeout=15)
    assert response.status_code == 200
    enabled = response.json().get("enabled")
    assert set(enabled) == {"easter", "halloween", "advent", "christmas", "newyear"}
    assert all(isinstance(value, bool) for value in enabled.values())


def test_workers_include_bot_id_for_each_worker(api_client):
    response = api_client.get(f"{BASE_URL}/api/workers", timeout=15)
    assert response.status_code == 200

    data = response.json()
    workers = data.get("workers", [])
    assert isinstance(workers, list)

    for worker in workers:
        assert "botId" in worker
        assert isinstance(worker.get("botId"), str)
        assert worker.get("botId")


def test_premium_pricing_includes_trial_object(api_client):
    response = api_client.get(f"{BASE_URL}/api/premium/pricing", timeout=15)
    assert response.status_code == 200

    data = response.json()
    trial = data.get("trial")
    assert isinstance(trial, dict)
    assert "enabled" in trial
    assert "tier" in trial
    assert "months" in trial


def test_premium_trial_valid_email_returns_success_payload(api_client):
    unique_email = f"test_trial_{int(time.time() * 1000)}@example.com"
    payload = {"email": unique_email, "language": "en"}

    response = api_client.post(f"{BASE_URL}/api/premium/trial", json=payload, timeout=20)
    assert response.status_code == 200

    data = response.json()
    assert data.get("success") is True
    assert data.get("email") == unique_email
    assert data.get("tier") == "pro"
    assert isinstance(data.get("message"), str)
    assert data.get("message")


def test_offer_preview_empty_coupon_success_and_invalid_coupon_error(api_client):
    base_payload = {
        "tier": "pro",
        "seats": 1,
        "months": 1,
        "email": f"preview_{int(time.time() * 1000)}@example.com",
        "language": "en",
    }

    empty_coupon_response = api_client.post(
        f"{BASE_URL}/api/premium/offer/preview",
        json={**base_payload, "couponCode": ""},
        timeout=20,
    )
    assert empty_coupon_response.status_code == 200

    empty_coupon_data = empty_coupon_response.json()
    assert empty_coupon_data.get("success") is True
    assert isinstance(empty_coupon_data.get("discount"), dict)
    assert empty_coupon_data.get("discount", {}).get("code") is None

    invalid_coupon_response = api_client.post(
        f"{BASE_URL}/api/premium/offer/preview",
        json={**base_payload, "couponCode": "INVALID-COUPON-DOES-NOT-EXIST"},
        timeout=20,
    )
    assert invalid_coupon_response.status_code in (400, 404)

    invalid_coupon_data = invalid_coupon_response.json()
    assert invalid_coupon_data.get("success") is False
    assert isinstance(invalid_coupon_data.get("error"), str)
    assert invalid_coupon_data.get("error")


def test_admin_endpoints_require_admin_token(api_client):
    discord_status = api_client.get(f"{BASE_URL}/api/discordbotlist/status", timeout=15)
    offers = api_client.get(f"{BASE_URL}/api/premium/offers", timeout=15)

    assert discord_status.status_code == 401
    assert offers.status_code == 401

    discord_data = discord_status.json()
    offers_data = offers.json()

    assert "error" in discord_data
    assert "error" in offers_data
