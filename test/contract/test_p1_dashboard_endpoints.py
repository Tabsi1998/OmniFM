"""
P1 Dashboard Endpoint Tests
Tests all new dashboard endpoints added in iteration 8:
- GET /api/dashboard/stats/detail
- DELETE /api/dashboard/stats/reset  
- GET /api/dashboard/settings
- PUT /api/dashboard/settings
- GET /api/dashboard/channels
- GET /api/dashboard/roles
- GET /api/dashboard/stations
- GET /api/dashboard/custom-stations
- POST /api/dashboard/custom-stations
- PUT /api/dashboard/custom-stations
- DELETE /api/dashboard/custom-stations

Also regression tests for P0 fixes:
- GET /api/stations (should return 120 stations, no custom stations)
- GET /api/stats (should return station count 120)
- GET /api/dashboard/license (should return 401 without auth)
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
# The dashboard sends this with every change; the Node API refuses changes
# without it before it looks at the session (CSRF, #195).
DASHBOARD_INTENT = {"X-OmniFM-CSRF": "dashboard-intent"}


@pytest.fixture(scope="module", autouse=True)
def ensure_api_available():
    try:
        response = requests.get(f"{BASE_URL}/api/health", timeout=5)
        if response.status_code != 200:
            pytest.skip(f"OmniFM API at {BASE_URL} returned {response.status_code} for /api/health")
    except Exception as exc:
        pytest.skip(f"OmniFM API not reachable at {BASE_URL}: {exc}")

class TestDashboardEndpointsAuth:
    """All dashboard endpoints should return 401 without authentication"""
    
    def test_stats_detail_returns_401_unauthenticated(self):
        """GET /api/dashboard/stats/detail returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats/detail?serverId=123456789012345678")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ GET /api/dashboard/stats/detail returns 401")
    
    def test_stats_reset_returns_401_unauthenticated(self):
        """DELETE /api/dashboard/stats/reset returns 401 without auth"""
        response = requests.delete(f"{BASE_URL}/api/dashboard/stats/reset?serverId=123456789012345678", headers=DASHBOARD_INTENT)
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ DELETE /api/dashboard/stats/reset returns 401")
    
    def test_settings_get_returns_401_unauthenticated(self):
        """GET /api/dashboard/settings returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/dashboard/settings?serverId=123456789012345678")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ GET /api/dashboard/settings returns 401")
    
    def test_settings_put_returns_401_unauthenticated(self):
        """PUT /api/dashboard/settings returns 401 without auth"""
        response = requests.put(
            f"{BASE_URL}/api/dashboard/settings?serverId=123456789012345678",
            headers=DASHBOARD_INTENT,
            json={"weeklyDigest": {"enabled": True}}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ PUT /api/dashboard/settings returns 401")
    
    def test_channels_returns_401_unauthenticated(self):
        """GET /api/dashboard/channels returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/dashboard/channels?serverId=123456789012345678")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ GET /api/dashboard/channels returns 401")
    
    def test_roles_returns_401_unauthenticated(self):
        """GET /api/dashboard/roles returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/dashboard/roles?serverId=123456789012345678")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ GET /api/dashboard/roles returns 401")
    
    def test_stations_returns_401_unauthenticated(self):
        """GET /api/dashboard/stations returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stations?serverId=123456789012345678")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ GET /api/dashboard/stations returns 401")
    
    def test_custom_stations_get_returns_401_unauthenticated(self):
        """GET /api/dashboard/custom-stations returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/dashboard/custom-stations?serverId=123456789012345678")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ GET /api/dashboard/custom-stations returns 401")
    
    def test_custom_stations_post_returns_401_unauthenticated(self):
        """POST /api/dashboard/custom-stations returns 401 without auth"""
        response = requests.post(
            f"{BASE_URL}/api/dashboard/custom-stations?serverId=123456789012345678",
            headers=DASHBOARD_INTENT,
            json={"key": "test", "name": "Test", "url": "http://test.com"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ POST /api/dashboard/custom-stations returns 401")
    
    def test_custom_stations_put_returns_401_unauthenticated(self):
        """PUT /api/dashboard/custom-stations returns 401 without auth"""
        response = requests.put(
            f"{BASE_URL}/api/dashboard/custom-stations?serverId=123456789012345678",
            headers=DASHBOARD_INTENT,
            json={"key": "test", "name": "Updated"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ PUT /api/dashboard/custom-stations returns 401")
    
    def test_custom_stations_delete_returns_401_unauthenticated(self):
        """DELETE /api/dashboard/custom-stations returns 401 without auth"""
        response = requests.delete(f"{BASE_URL}/api/dashboard/custom-stations?serverId=123456789012345678&key=test", headers=DASHBOARD_INTENT)
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ DELETE /api/dashboard/custom-stations returns 401")


class TestP0RegressionPublicEndpoints:
    """Regression tests for P0 fixes - public station and stats endpoints"""
    
    def test_public_stations_returns_120(self):
        """GET /api/stations returns 120 stations (free + pro only)"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        data = response.json()
        stations = data.get("stations", [])
        assert len(stations) == 120, f"Expected 120 stations, got {len(stations)}"
        print(f"✓ GET /api/stations returns {len(stations)} stations")
    
    def test_public_stations_no_custom_leak(self):
        """GET /api/stations contains no custom: prefix stations"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        data = response.json()
        stations = data.get("stations", [])
        custom_stations = [s for s in stations if s.get("key", "").startswith("custom:")]
        assert len(custom_stations) == 0, f"Found {len(custom_stations)} custom stations leaked"
        print(f"✓ No custom stations leaked in public /api/stations")
    
    def test_public_stations_no_ultimate_tier(self):
        """GET /api/stations contains no ultimate tier stations"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        data = response.json()
        stations = data.get("stations", [])
        ultimate_stations = [s for s in stations if s.get("tier", "free") == "ultimate"]
        assert len(ultimate_stations) == 0, f"Found {len(ultimate_stations)} ultimate stations"
        print(f"✓ No ultimate tier stations in public /api/stations")
    
    def test_public_stats_station_count(self):
        """GET /api/stats returns station count 120"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 200
        data = response.json()
        stations_count = data.get("stations", 0)
        assert stations_count == 120, f"Expected stations=120, got {stations_count}"
        free_stations = data.get("freeStations", 0)
        pro_stations = data.get("proStations", 0)
        assert free_stations == 20, f"Expected freeStations=20, got {free_stations}"
        assert pro_stations == 100, f"Expected proStations=100, got {pro_stations}"
        print(f"✓ GET /api/stats shows stations={stations_count} (free={free_stations}, pro={pro_stations})")
    
    def test_dashboard_license_returns_401(self):
        """GET /api/dashboard/license returns 401 without auth (P0 bug fix)"""
        response = requests.get(f"{BASE_URL}/api/dashboard/license")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Nicht eingeloggt" in str(data)
        print(f"✓ GET /api/dashboard/license returns 401 (not 404)")


class TestPublicEndpointsBasic:
    """Basic health and public endpoint tests"""
    
    def test_health_endpoint(self):
        """GET /api/health returns ok"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        assert data.get("brand") == "OmniFM"
        print(f"✓ GET /api/health returns ok:true brand=OmniFM")
    
    def test_bots_endpoint(self):
        """GET /api/bots returns bots list"""
        response = requests.get(f"{BASE_URL}/api/bots")
        assert response.status_code == 200
        data = response.json()
        assert "bots" in data
        print(f"✓ GET /api/bots returns bots list")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
