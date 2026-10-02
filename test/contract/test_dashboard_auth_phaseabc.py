import json
import os
from pathlib import Path

import pytest
import requests


# Phase A/B/C regression tests for auth, dashboard guards, and core public APIs
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


@pytest.mark.parametrize(
    "endpoint,expected_keys",
    [
        ("/api/health", ["ok", "status", "brand", "timestamp"]),
        ("/api/bots", ["bots", "totals"]),
        ("/api/stations", ["stations", "total"]),
        ("/api/stats", ["servers", "users", "connections", "listeners", "bots", "stations"]),
        ("/api/commands", ["commands"]),
        ("/api/premium/pricing", ["brand", "tiers", "durations", "seatOptions", "trial"]),
    ],
)
def test_core_endpoints_healthy(api_client, endpoint, expected_keys):
    response = api_client.get(f"{BASE_URL}{endpoint}", timeout=20)
    assert response.status_code == 200

    data = response.json()
    assert isinstance(data, dict)
    for key in expected_keys:
        assert key in data


def test_auth_session_unauthenticated_shape(api_client):
    response = api_client.get(f"{BASE_URL}/api/auth/session", timeout=20)
    assert response.status_code == 200

    data = response.json()
    assert data.get("authenticated") is False
    assert "oauthConfigured" in data
    assert data.get("user") is None
    assert data.get("guilds") == []


def test_auth_discord_login_url_generation(api_client):
    response = api_client.get(f"{BASE_URL}/api/auth/discord/login?nextPage=dashboard", timeout=20)
    assert response.status_code in (200, 503)

    data = response.json()
    if response.status_code == 200:
        assert data.get("oauthConfigured") is True
        auth_url = data.get("authUrl")
        assert isinstance(auth_url, str)
        assert "discord.com/api/oauth2/authorize" in auth_url
        assert "state=" in auth_url
    else:
        assert data.get("oauthConfigured") is False
        assert "error" in data


def test_auth_logout_without_session_returns_success(api_client):
    # The dashboard sends its CSRF intent with the logout (#195).
    response = api_client.post(f"{BASE_URL}/api/auth/logout", timeout=20, headers={"X-OmniFM-CSRF": "dashboard-intent"})
    assert response.status_code == 200

    data = response.json()
    assert data.get("success") is True


@pytest.mark.parametrize(
    "method,endpoint",
    [
        ("GET", "/api/dashboard/guilds"),
        ("GET", "/api/dashboard/stats?serverId=123456789012345678"),
        ("GET", "/api/dashboard/events?serverId=123456789012345678"),
        ("POST", "/api/dashboard/events?serverId=123456789012345678"),
        ("GET", "/api/dashboard/perms?serverId=123456789012345678"),
        ("PUT", "/api/dashboard/perms?serverId=123456789012345678"),
    ],
)
def test_dashboard_endpoints_require_auth(api_client, method, endpoint):
    url = f"{BASE_URL}{endpoint}"

    if method == "GET":
        response = api_client.get(url, timeout=20)
    elif method == "POST":
        response = api_client.post(url, json={"title": "TEST_Event"}, timeout=20)
    elif method == "PUT":
        response = api_client.put(url, json={"commandRoleMap": {"play": ["DJ"]}}, timeout=20)
    else:
        pytest.fail(f"Unsupported method: {method}")

    assert response.status_code in (401, 403)

    data = response.json()
    assert isinstance(data, dict)
    assert "error" in data
