"""
Test cases for P1 (Rich Message Editor) and P2 (Lifetime Stats Info) features
P1: Rich Message Editor with Discord Markdown support, formatting toolbar, and emoji picker
P2: Lifetime Stats verification info banner in DashboardOverview
"""

import os
from pathlib import Path

import pytest
import requests


def _load_base_url() -> str:
    env_value = (os.environ.get("REACT_APP_BACKEND_URL") or "").strip()
    if env_value:
        return env_value.rstrip("/")

    frontend_env = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if not frontend_env.exists():
        pytest.skip("frontend/.env not found and REACT_APP_BACKEND_URL is unset; cannot resolve public base URL", allow_module_level=True)

    for line in frontend_env.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if clean.startswith("REACT_APP_BACKEND_URL="):
            value = clean.split("=", 1)[1].strip().strip('"').strip("'")
            if value:
                return value.rstrip("/")

    pytest.skip("REACT_APP_BACKEND_URL missing in frontend/.env", allow_module_level=True)


BASE_URL = _load_base_url()


@pytest.fixture(scope="module", autouse=True)
def ensure_api_available():
    try:
        response = requests.get(f"{BASE_URL}/api/health", timeout=5)
        if response.status_code != 200:
            pytest.skip(f"OmniFM API at {BASE_URL} returned {response.status_code} for /api/health")
    except Exception as exc:
        pytest.skip(f"OmniFM API not reachable at {BASE_URL}: {exc}")


class TestHealthEndpoint:
    """Health endpoint tests"""
    
    def test_health_returns_ok(self):
        """GET /api/health should return 200 with ok:true"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert data.get("status") == "online"
        assert data.get("brand") == "OmniFM"
        print(f"Health endpoint OK: {data}")


class TestEmojisEndpoint:
    """Emoji API endpoint tests - requires authentication"""
    
    def test_emojis_returns_401_without_auth(self):
        """GET /api/dashboard/emojis should return 401 when not authenticated"""
        response = requests.get(
            f"{BASE_URL}/api/dashboard/emojis?serverId=123456789012345678",
            timeout=10
        )
        assert response.status_code == 401
        
        data = response.json()
        assert "error" in data
        print(f"Emojis endpoint returns 401 without auth: {data}")
    
    def test_emojis_returns_401_with_invalid_token(self):
        """GET /api/dashboard/emojis should return 401 with invalid bearer token"""
        response = requests.get(
            f"{BASE_URL}/api/dashboard/emojis?serverId=123456789012345678",
            headers={"Authorization": "Bearer invalid_token_123"},
            timeout=10
        )
        assert response.status_code == 401
        print(f"Emojis endpoint returns 401 with invalid token")


class TestAuthEndpoints:
    """Auth endpoint tests"""
    
    def test_auth_session_returns_200(self):
        """GET /api/auth/session should return 200 with auth status"""
        response = requests.get(f"{BASE_URL}/api/auth/session", timeout=10)
        assert response.status_code == 200
        
        data = response.json()
        assert "authenticated" in data
        assert "oauthConfigured" in data
        print(f"Auth session endpoint OK: {data}")
    
    def test_discord_login_returns_auth_url(self):
        """GET /api/auth/discord/login should return auth URL when OAuth configured"""
        response = requests.get(f"{BASE_URL}/api/auth/discord/login", timeout=10)
        # Can be 200 (configured) or 503 (not configured)
        assert response.status_code in [200, 503]
        
        data = response.json()
        assert "oauthConfigured" in data
        print(f"Discord login endpoint: {data.get('oauthConfigured')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
