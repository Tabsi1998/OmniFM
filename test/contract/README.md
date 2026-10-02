# Vertragstests der API

Was die Owner-Konsole, die Website und das Dashboard von der API erwarten,
geprüft über HTTP gegen eine laufende Node-API (pytest). Bis #291 liefen sie
gegen FastAPI und Node; seitdem gibt es nur noch Node.

Der lokale Runner startet MongoDB und die Node-API selbst und führt sie als
Schritt `contract/contract-suite` aus; jeder Fehlschlag lässt den Schritt
scheitern:

```bash
python scripts/local_check.py --only node,contract
```

Die CI führt sie im Job `contract` aus.

Die Fixtures in `conftest.py` schreiben die Daten, die ein Test braucht, selbst
in die Datenbank des Test-Stacks: Bot-Telemetrie, Logzeilen, Vorfälle,
Lizenzen, Bot- und OAuth-Konfiguration. Deshalb brauchen die Tests `MONGO_URL`
und `DB_NAME` derselben API. Eine Datenbank, deren Name nicht `test`, `local`,
`contract` oder `ci` enthält, fassen sie nicht an. Von Hand, gegen eine
Node-API mit eigener Testdatenbank (`node scripts/serve-node-api.mjs`):

```bash
python -m pip install -r test/contract/requirements.txt
OMNIFM_RUN_BACKEND_CONTRACT_TESTS=1 OMNIFM_TEST_BASE_URL=http://127.0.0.1:8001 \
MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=omnifm_test \
OMNIFM_TEST_ADMIN_TOKEN=<API_ADMIN_TOKEN der Test-API> python -m pytest test/contract -q
```
