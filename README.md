# OmniFM

**OmniFM** ist eine moderne, professionelle 24/7 **Discord Radio- & Music-Plattform** – gehört wird direkt in Discord-Voice-Channels, verwaltet über ein hochwertiges Web-Dashboard.

<p align="center">
  <img src="frontend/public/brand/omnifm-banner.png" alt="OmniFM" width="720" />
</p>

---

## ✨ Überblick

| Bereich | Beschreibung | Route |
|---|---|---|
| **Landing** | Marketing-Seite mit Live „Now Playing", Discord-Embed-Showcase, Sticky-Player | `/` |
| **Server-Dashboard** | Für Server-Admins (Discord OAuth): My Stations, Rollen & Rechte, Statistiken, Abo | `/dashboard` |
| **Owner-Konsole** | Passwortgeschützt (nur Betreiber): Stationen-Verwaltung, Stream-Test, Live-Monitoring, Lizenzen, Audit-Log | `/admin` |
| **Brand-Kit** | Öffentliche Logo-/Presse-Seite mit Downloads & Sponsor-Badge-Einbettcode | `/brand` |

## 🧱 Architektur (dieser Stack)

```
┌────────────┐     /api/*      ┌──────────────┐        ┌───────────┐
│  React SPA │ ───────────────▶│  FastAPI     │ ─────▶ │  MongoDB  │
│ (frontend) │                 │  (backend)   │        └───────────┘
└────────────┘                 └──────────────┘
      :3000                          :8001
```

- **Frontend:** React (CRA), Design-System „Broadcast Studio" (Obsidian + Signal-Orange + Cyber-Cyan), `recharts`, `lucide-react`.
- **Backend:** FastAPI, alle Endpunkte unter `/api`, MongoDB über `MONGO_URL`.
- **Discord-Voice-Bot:** Node.js / `discord.js` (Commander/Worker-Split) – der eigentliche Streaming-Runtime. Läuft separat (Docker/systemd) und teilt sich die MongoDB.

## 🎨 Marke

Ein einziges Vektor-Logo (Unendlichkeit + Schallwelle) in allen Varianten unter
`frontend/public/brand/` – SVG + transparente PNGs (hell/dunkel/mono), Wortmarken, Banner
(dunkel/hell/transparent), Discord-Avatar, Favicon und Sponsor-Badge. Siehe `/brand`.

- **Farben:** Obsidian `#08090d`, Surface `#0e111a`, Orange `#ff6b00`, Live-Rot `#ff2a5f`, Cyan `#00e5ff`
- **Fonts:** Syne (Display), DM Sans (Body), JetBrains Mono (Labels)

## 🚀 Schnellstart (lokal)

```bash
# Backend (FastAPI)
cd backend && pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend (React)
cd frontend && yarn install && yarn start
```

MongoDB muss erreichbar sein (siehe `.env`).

## 🖥️ Deployment auf Ubuntu (Web-Stack)

```bash
./start.sh     # Backend (uvicorn) + Frontend-Build starten
./stop.sh      # Alles stoppen
./update.sh    # Code aktualisieren, Abhängigkeiten & Neustart
```

`start.sh` erstellt bei Bedarf ein Python-venv, installiert Abhängigkeiten,
baut das Frontend und serviert es. Ports via `BACKEND_PORT` / `FRONTEND_PORT` überschreibbar.

## ⚙️ Konfiguration

**`backend/.env`**
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=omnifm
API_ADMIN_TOKEN=<geheimer-owner-token>      # Zugang zur Owner-Konsole /admin
CORS_ALLOWED_ORIGINS=*
```

**`frontend/.env`**
```
REACT_APP_BACKEND_URL=https://deine-domain.tld
```

Optional (aktivieren einzelne Features): `STRIPE_*`, `DISCORD_CLIENT_ID/SECRET` (OAuth),
`SMTP_*`, `DISCORDBOTLIST_TOKEN`.

## 🔑 Owner-Konsole

`/admin` → mit `API_ADMIN_TOKEN` anmelden. Funktionen:
- **Global Overview** (Lizenzen, MRR/ARR, Server, Stationen)
- **Live-Monitoring** (Worker-Health, Incidents, Log-Stream)
- **Radio-Katalog** vollständig verwalten (anlegen/bearbeiten/löschen) inkl. **Stream-Test**
- **Lizenz-Manager**, **Integrationen**, **Audit-Log** (jede Änderung protokolliert)
- **Brand-Kit** (Assets downloaden & Einbettcodes kopieren)

## 📡 Wichtige API-Endpunkte

```
GET  /api/health
GET  /api/stats | /api/stations | /api/bots | /api/commands
GET  /api/cover?artist=&title=              # keyless Cover-Art (iTunes)
# Owner (Header: X-Admin-Token)
POST /api/admin/login
GET  /api/admin/overview | /workers | /licenses | /stations | /monitoring | /audit | /integrations
POST /api/admin/stations   DELETE /api/admin/stations/{key}   POST /api/admin/stations/test
# Server-Dashboard (Discord OAuth Session)
GET  /api/auth/session   GET/PUT /api/dashboard/perms   GET/POST/DELETE /api/dashboard/custom-stations
```

## 📄 Lizenz

Proprietär – © OmniFM. Alle Rechte vorbehalten.
