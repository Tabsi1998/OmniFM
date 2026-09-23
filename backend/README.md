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

Die Contract-Tests erwarten einen isolierten laufenden Test-Stack. Der lokale
Runner (`python scripts/local_check.py --only backend`) startet MongoDB und
FastAPI selbst und führt sie als Schritt `backend/contract-suite` aus; jeder
Fehlschlag lässt den Schritt scheitern. Die CI führt sie im Job `fastapi-smoke`
gegen denselben Server aus.

Die Fixtures in `backend/tests/conftest.py` schreiben die Daten, die ein Test
braucht, selbst in die Datenbank des Test-Stacks: Bot-Telemetrie, Logzeilen,
Vorfälle, Lizenzen, Bot- und OAuth-Konfiguration. Deshalb brauchen die Tests
`MONGO_URL` und `DB_NAME` desselben Backends. Eine Datenbank, deren Name nicht
`test`, `local`, `contract` oder `ci` enthält, fassen sie nicht an. Von Hand:

```bash
OMNIFM_RUN_BACKEND_CONTRACT_TESTS=1 OMNIFM_TEST_BASE_URL=http://127.0.0.1:8001 \
MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=omnifm_test \
OMNIFM_TEST_ADMIN_TOKEN=<API_ADMIN_TOKEN des Test-Backends> python -m pytest backend/tests -q
```
