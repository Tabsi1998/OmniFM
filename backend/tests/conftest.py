import os

import pytest


def pytest_configure(config):
    if os.environ.get("OMNIFM_RUN_BACKEND_CONTRACT_TESTS") == "1":
        return

    pytest.exit(
        "backend/tests expects a running isolated FastAPI/Mongo test stack. "
        "Set OMNIFM_RUN_BACKEND_CONTRACT_TESTS=1 and OMNIFM_TEST_BASE_URL to run it intentionally.",
        returncode=5,
    )
