import os

import pytest


def pytest_configure(config):
    if os.environ.get("OMNIFM_RUN_LEGACY_BACKEND_TESTS") == "1":
        return

    pytest.exit(
        "backend/tests is an archived legacy test path. "
        "Set OMNIFM_RUN_LEGACY_BACKEND_TESTS=1 and REACT_APP_BACKEND_URL to run it intentionally.",
        returncode=5,
    )
