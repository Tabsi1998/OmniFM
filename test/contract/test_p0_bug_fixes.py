import os
from pathlib import Path

import pytest
import requests

"""
P0 Bug Fix Tests - Station Count & Dashboard License
Tests the fixes for three critical P0 bugs:
1. Custom stations from Ultimate subscribers were leaking into public station listing
2. /api/dashboard/license endpoint was missing (should return 401 without auth, not 404)
3. Station count should be 120 (20 free + 100 pro), not including custom stations

Date: 2026-03-03
"""


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


class TestStationsEndpoint:
    """Test /api/stations endpoint for P0 fix: no custom station leakage"""
    
    def test_stations_returns_correct_count(self):
        """GET /api/stations should return exactly 120 stations (20 free + 100 pro)"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "stations" in data, "Response should contain 'stations' field"
        assert "total" in data, "Response should contain 'total' field"
        
        # Verify total count
        assert data["total"] == 120, f"Expected 120 stations, got {data['total']}"
        assert len(data["stations"]) == 120, f"Expected 120 stations in list, got {len(data['stations'])}"
    
    def test_stations_no_custom_prefix_leaked(self):
        """No station keys should start with 'custom:' prefix"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        
        data = response.json()
        custom_stations = [s for s in data["stations"] if s.get("key", "").startswith("custom:")]
        
        assert len(custom_stations) == 0, f"Found {len(custom_stations)} custom stations leaked: {[s['key'] for s in custom_stations]}"
    
    def test_stations_no_ultimate_tier_leaked(self):
        """No stations should have 'ultimate' tier"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        
        data = response.json()
        ultimate_stations = [s for s in data["stations"] if s.get("tier", "").lower() == "ultimate"]
        
        assert len(ultimate_stations) == 0, f"Found {len(ultimate_stations)} ultimate tier stations leaked"
    
    def test_stations_correct_tier_distribution(self):
        """Should have exactly 20 free and 100 pro stations"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        
        data = response.json()
        free_count = len([s for s in data["stations"] if s.get("tier", "free").lower() == "free"])
        pro_count = len([s for s in data["stations"] if s.get("tier", "free").lower() == "pro"])
        
        assert free_count == 20, f"Expected 20 free stations, got {free_count}"
        assert pro_count == 100, f"Expected 100 pro stations, got {pro_count}"
    
    def test_stations_only_free_and_pro_tiers(self):
        """All stations should be either 'free' or 'pro' tier only"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        
        data = response.json()
        for station in data["stations"]:
            tier = station.get("tier", "free").lower()
            assert tier in ["free", "pro"], f"Station '{station.get('key')}' has invalid tier: {tier}"


class TestStatsEndpoint:
    """Test /api/stats endpoint for P0 fix: correct station count"""
    
    def test_stats_correct_station_count(self):
        """GET /api/stats should return stations=120"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "stations" in data, "Response should contain 'stations' field"
        assert data["stations"] == 120, f"Expected 120 stations, got {data['stations']}"
    
    def test_stats_correct_free_station_count(self):
        """GET /api/stats should return freeStations=20"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 200
        
        data = response.json()
        assert "freeStations" in data, "Response should contain 'freeStations' field"
        assert data["freeStations"] == 20, f"Expected 20 free stations, got {data['freeStations']}"
    
    def test_stats_correct_pro_station_count(self):
        """GET /api/stats should return proStations=100"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 200
        
        data = response.json()
        assert "proStations" in data, "Response should contain 'proStations' field"
        assert data["proStations"] == 100, f"Expected 100 pro stations, got {data['proStations']}"


class TestDashboardLicenseEndpoint:
    """Test /api/dashboard/license endpoint for P0 fix: returns 401, not 404"""
    
    def test_license_returns_401_without_auth(self):
        """GET /api/dashboard/license should return 401 when not authenticated"""
        response = requests.get(f"{BASE_URL}/api/dashboard/license")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    
    def test_license_returns_german_error_message(self):
        """GET /api/dashboard/license answers a German browser with 'Nicht eingeloggt.'
        (#347: German browser German, otherwise English)."""
        response = requests.get(f"{BASE_URL}/api/dashboard/license", headers={"Accept-Language": "de-DE,de;q=0.9"})
        assert response.status_code == 401
        
        data = response.json()
        assert "error" in data, "Response should contain 'error' field"
        assert data["error"] == "Nicht eingeloggt.", f"Expected 'Nicht eingeloggt.', got '{data['error']}'"
    
    def test_license_with_invalid_bearer_returns_401(self):
        """GET /api/dashboard/license with invalid bearer token should return 401"""
        headers = {"Authorization": "Bearer invalid_token_12345"}
        response = requests.get(f"{BASE_URL}/api/dashboard/license", headers=headers)
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    
    def test_license_endpoint_exists(self):
        """Verify the endpoint exists and doesn't return 404"""
        response = requests.get(f"{BASE_URL}/api/dashboard/license")
        # Should get 401 (unauthorized) not 404 (not found)
        assert response.status_code != 404, "Endpoint should exist (got 404 - not found)"
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"


class TestHealthEndpoint:
    """Test /api/health endpoint is working"""
    
    def test_health_returns_ok(self):
        """GET /api/health should return ok:true"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("ok") == True, f"Expected ok=true, got {data.get('ok')}"
        assert data.get("brand") == "OmniFM", f"Expected brand='OmniFM', got {data.get('brand')}"
