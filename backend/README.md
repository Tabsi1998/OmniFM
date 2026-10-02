# backend/

Hier liegt nur noch `backend/.env`: die Einstellungen dieser Installation
(MongoDB, Owner-Token, Adresse der Website, Feineinstellungen der Bots).
`./start.sh` legt die Datei beim ersten Start an; Git ignoriert sie.

Das Python-Backend (FastAPI), das früher hier lag, gibt es seit #291 nicht
mehr. Die öffentliche API auf Port `8001` ist `src/entrypoints/api.js`, alles
andere ist Node unter `src/`. Der Ordnername bleibt, weil systemd-Units,
Skripte und bestehende Server diese Datei unter genau diesem Pfad lesen.

Die Vertragstests der API liegen in `test/contract/`.
