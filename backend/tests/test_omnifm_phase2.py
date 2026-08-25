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


def test_workers_endpoint_exposes_tier_limits():
  response = requests.get(f"{BASE_URL}/api/workers", timeout=5)
  assert response.status_code == 200

  data = response.json()
  tiers = data.get("tiers", {})
  assert tiers.get("free", {}).get("maxWorkers") == 2
  assert tiers.get("pro", {}).get("maxWorkers") == 8
  assert tiers.get("ultimate", {}).get("maxWorkers") == 16


def test_workers_endpoint_returns_worker_shape():
  response = requests.get(f"{BASE_URL}/api/workers", timeout=5)
  assert response.status_code == 200

  data = response.json()
  for worker in data.get("workers", [])[:10]:
    for field in ["botId", "index", "name", "role", "requiredTier", "online", "servers", "activeStreams"]:
      assert field in worker
    assert worker["role"] == "worker"


def test_premium_tiers_endpoint_returns_all_plans():
  response = requests.get(f"{BASE_URL}/api/premium/tiers", timeout=5)
  assert response.status_code == 200

  data = response.json()
  tiers = data.get("tiers", {})
  assert {"free", "pro", "ultimate"}.issubset(set(tiers.keys()))


def test_premium_invite_links_reject_invalid_server_id():
  response = requests.get(f"{BASE_URL}/api/premium/invite-links?serverId=invalid", timeout=5)
  assert response.status_code == 400
  assert "error" in response.json()


def test_premium_pricing_contains_current_contract_fields():
  response = requests.get(f"{BASE_URL}/api/premium/pricing", timeout=5)
  assert response.status_code == 200

  data = response.json()
  assert data.get("brand") == "OmniFM"
  assert "trial" in data
  assert data.get("tiers", {}).get("pro", {}).get("durationPricing")
  assert data.get("tiers", {}).get("pro", {}).get("seatPricing")
  assert data.get("tiers", {}).get("ultimate", {}).get("durationPricing")
  assert data.get("tiers", {}).get("ultimate", {}).get("seatPricing")
