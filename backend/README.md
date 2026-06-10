# Legacy Python Backend

`backend/server.py` is archived as a legacy/reference implementation. It is not
the production backend, not used by Docker, and not part of the CI release gate.
The canonical backend/API runtime is the Node.js implementation under `src/`.

The Python dependency file is intentionally minimal and only covers the imports
used by this legacy folder and its archived contract tests.

To run the legacy tests intentionally:

```bash
python -m pip install -r backend/requirements.txt
OMNIFM_RUN_LEGACY_BACKEND_TESTS=1 REACT_APP_BACKEND_URL=http://127.0.0.1:8081 python -m pytest backend/tests -q
```

Without `OMNIFM_RUN_LEGACY_BACKEND_TESTS=1`, the test suite exits with an
explicit message instead of silently reporting skipped tests.
