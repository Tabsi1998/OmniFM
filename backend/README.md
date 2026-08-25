# FastAPI-Backend

`backend/server.py` ist das produktive HTTP-Backend von OmniFM. Es läuft auf
Port `8001`, stellt alle Endpunkte unter `/api` bereit und verwendet MongoDB
über `MONGO_URL`. Das React-Frontend läuft separat auf Port `3000`; der
Discord-Voice-Runtime unter `src/` ist ein eigener Node.js-Prozess.

Lokaler Start:

```bash
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8001
```

Die Contract-Tests erwarten einen isolierten laufenden Test-Stack:

```bash
OMNIFM_RUN_BACKEND_CONTRACT_TESTS=1 OMNIFM_TEST_BASE_URL=http://127.0.0.1:8001 python -m pytest backend/tests -q
```
