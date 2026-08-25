import os

import pytest
import requests


BASE_URL = os.environ.get("OMNIFM_TEST_BASE_URL", "http://127.0.0.1:8001").rstrip("/")


@pytest.fixture(scope="module", autouse=True)
def ensure_api_available():
  try:
    response = requests.get(f"{BASE_URL}/api/health", timeout=5)
    response.raise_for_status()
  except Exception as exc:
    pytest.skip(f"OmniFM API not reachable at {BASE_URL}: {exc}")


def test_health_returns_online_status():
  response = requests.get(f"{BASE_URL}/api/health", timeout=5)
  assert response.status_code == 200

  data = response.json()
  assert data.get("ok") is True
  assert data.get("status") == "online"
  assert data.get("brand") == "OmniFM"
  assert "timestamp" in data


def test_stats_returns_expected_shape():
  response = requests.get(f"{BASE_URL}/api/stats", timeout=5)
  assert response.status_code == 200

  data = response.json()
  for field in ["servers", "users", "connections", "listeners", "bots", "stations"]:
    assert field in data
  assert isinstance(data["bots"], int)
  assert isinstance(data["stations"], int)
  assert data["bots"] >= 1
  assert data["stations"] >= 1


def test_stations_return_total_and_structure():
  response = requests.get(f"{BASE_URL}/api/stations", timeout=5)
  assert response.status_code == 200

  data = response.json()
  stations = data.get("stations", [])
  assert data.get("total") == len(stations)
  assert len(stations) >= 1

  for station in stations[:10]:
    assert "key" in station
    assert "name" in station
    assert "url" in station
    assert "tier" in station


def test_commands_include_core_commands():
  response = requests.get(f"{BASE_URL}/api/commands", timeout=5)
  assert response.status_code == 200

  data = response.json()
  commands = data.get("commands", [])
  names = {command.get("name") for command in commands}
  assert "/help" in names
  assert "/play" in names
  assert "/premium" in names


def test_bots_return_list_and_totals():
  response = requests.get(f"{BASE_URL}/api/bots", timeout=5)
  assert response.status_code == 200

  data = response.json()
  bots = data.get("bots", [])
  totals = data.get("totals", {})

  assert isinstance(bots, list)
  assert isinstance(totals, dict)
  assert len(bots) >= 1

  for bot in bots[:5]:
    for field in ["botId", "index", "name", "requiredTier", "servers", "users", "connections", "listeners"]:
      assert field in bot


def test_workers_return_commander_worker_architecture():
  response = requests.get(f"{BASE_URL}/api/workers", timeout=5)
  assert response.status_code == 200

  data = response.json()
  assert data.get("architecture") == "commander_worker"
  assert "commander" in data
  assert "workers" in data
  assert "tiers" in data

  commander = data.get("commander")
  assert commander is None or commander.get("role") == "commander"


def test_premium_check_rejects_invalid_server_id():
  response = requests.get(f"{BASE_URL}/api/premium/check?serverId=invalid", timeout=5)
  assert response.status_code == 400
  assert "error" in response.json()


def test_premium_pricing_exposes_duration_and_seat_data():
  response = requests.get(f"{BASE_URL}/api/premium/pricing", timeout=5)
  assert response.status_code == 200

  data = response.json()
  assert data.get("brand") == "OmniFM"
  assert data.get("seatOptions") == [1, 2, 3, 5]
  assert data.get("durations") == [1, 3, 6, 12]
  assert "seatPricing" in data.get("tiers", {}).get("pro", {})
  assert "seatPricing" in data.get("tiers", {}).get("ultimate", {})
