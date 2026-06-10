# OmniFM v3

OmniFM is a Discord radio bot stack with a commander/worker architecture, a Node.js API, a React website/dashboard, Premium licensing, scheduled events, statistics, legal pages, and directory sync integrations.

The canonical production runtime is Node.js:

- Monolith entrypoint: `src/index.js`
- Split commander entrypoint: `src/entrypoints/commander.js`
- Split worker entrypoint: `src/entrypoints/worker.js`

`backend/server.py` stays in the repository as an archived legacy/reference path.
It is not the production backend and is not part of the CI release gate.

## Documentation

- [Architecture and API](docs/architecture.md)
- [Configuration Reference](docs/configuration-reference.md)
- [Operations and Deployment](docs/operations.md)
- [Release, Update, and Rollback Process](docs/release-process.md)
- [Local Development](docs/local-development.md)
- [Website Foundation Contract](docs/website-foundation.md)
- [Google Search Console Workflow](docs/search-console.md)
- [Security Headers](docs/security-headers.md)

## What Is Implemented

- 24/7 radio streaming into Discord voice and stage channels
- Commander bot for slash commands plus worker bots for playback
- Free, Pro, and Ultimate entitlements with seat-based Premium licensing
- React website and dashboard served by the Node backend
- Discord OAuth dashboard login
- Scheduled events, role-based command permissions, weekly digest, runtime health, and analytics
- Ultimate-only custom station URLs, failover chain rules, exports/webhooks, and license workspace management
- Now-playing embeds, song history, cover art lookup, and optional audio recognition with AcoustID + MusicBrainz
- Guided Discord embeds, buttons, station browser panels, and worker-aware command selection
- DiscordBotList, Top.gg, and discord.bots.gg sync/status/vote integrations
- Public legal pages for imprint, privacy, and terms

## Quick Start

1. Copy `.env.example` to `.env`.
2. Fill at least `BOT_1_TOKEN` and `BOT_1_CLIENT_ID`.
3. Run the installer or start directly with Docker:

```bash
./install.sh
bash ./scripts/compose.sh up -d --build
bash ./scripts/compose.sh logs -f omnifm
```

4. Check the backend:

```bash
curl http://localhost:8081/api/health
```

`scripts/compose.sh` auto-selects `docker-compose.yml` or `docker-compose.split.yml` from `OMNIFM_DEPLOYMENT_MODE` and the configured bot count. Details live in [docs/operations.md](docs/operations.md).

## Minimum Configuration

Required:

- `BOT_1_TOKEN`
- `BOT_1_CLIENT_ID`

Usually recommended from day one:

- `BOT_1_NAME`
- `BOT_1_TIER`
- `COMMANDER_BOT_INDEX`
- `OMNIFM_DEPLOYMENT_MODE`
- `PUBLIC_WEB_URL`
- `API_ADMIN_TOKEN`

Optional integrations:

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Dashboard OAuth: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- MongoDB: `MONGO_URL` or `MONGO_ENABLED=1`
- Audio recognition: `NOW_PLAYING_RECOGNITION_ENABLED=1`, `ACOUSTID_API_KEY`
- Bot directories: `DISCORDBOTLIST_*`, `TOPGG_*`, `BOTSGG_*`

The maintained operator-facing template is [`.env.example`](.env.example). The grouped runtime reference is [docs/configuration-reference.md](docs/configuration-reference.md).

For public legal pages, keep product and operator identity separate: `LEGAL_PRODUCT_NAME` is the service name, for example `OmniFM`, while `LEGAL_PROVIDER_NAME` is the legal operator, for example `IT-Tabelander`.
Replace all placeholder address, email, and website values before production use; obvious sample values are treated as missing by the public Legal APIs.

## GitHub Automation

This repository ships with GitHub automation for CI, nightly recovery smoke checks, CodeQL, Dependabot, CODEOWNERS, and issue/PR templates.
The `live-smoke` workflow can be run manually or on schedule against `https://omnifm.xyz`; configure the repository secret `OMNIFM_LIVE_ADMIN_TOKEN` for authenticated provider/API checks.
Production updates should use `npm run release:preflight` before `./update.sh --update` and `npm run release:postdeploy -- --base-url https://omnifm.xyz` after deployment.

Recommended required checks for `main`:

- `ci`
- `codeql`

Operational reminder: the voice/channel status system is part of the maintained runtime surface. Keep the documented `.env.example` toggles in sync, especially `VOICE_CHANNEL_STATUS_ENABLED`, `VOICE_CHANNEL_STATUS_TEMPLATE`, `VOICE_CHANNEL_STATUS_REFRESH_MS`, `VOICE_STATE_RECONCILE_ENABLED`, `VOICE_STATE_RECONCILE_MS`, `VOICE_MOVE_POLICY`, `VOICE_MOVE_CONFIRMATIONS`, `VOICE_MOVE_RETURN_COOLDOWN_MS`, `VOICE_MOVE_WINDOW_MS`, `VOICE_MOVE_MAX_EVENTS_PER_WINDOW`, `VOICE_MOVE_ESCALATION`, and `VOICE_MOVE_ESCALATION_COOLDOWN_MS`.

Voice guard can now be controlled globally through env defaults and per guild through the dashboard or `/voiceguard`. The protection itself is active on all plans so active OmniFM sessions do not silently accept foreign channel moves. The per-guild layer overrides the move policy, while repeated foreign moves are still governed by the documented global guard thresholds. In split mode, `/voiceguard status`, `/voiceguard unlock`, and `/voiceguard lock` also accept an optional `bot` worker slot so you can target the active worker directly without joining its voice channel first.

## Deployment Modes

### Monolith

- Compose file: `docker-compose.yml`
- Runtime entrypoint: `src/index.js`
- Commander, workers, API, and website run inside one app process
- Best fit for simpler deployments or single-host setups

### Split

- Compose file: `docker-compose.split.yml`
- Commander service runs `src/entrypoints/commander.js`
- Each worker service runs `src/entrypoints/worker.js`
- The commander owns slash commands, dashboard/API routes, and remote worker routing
- Workers expose status through the internal worker bridge

Selection rules:

- `OMNIFM_DEPLOYMENT_MODE=monolith` forces `docker-compose.yml`
- `OMNIFM_DEPLOYMENT_MODE=split` forces `docker-compose.split.yml`
- `OMNIFM_DEPLOYMENT_MODE=auto` picks split when more than one bot is configured and the split compose file exists

Windows helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-split.ps1 -Build
```

## First Run In Discord

1. Invite the commander bot.
2. Run `/setup` or `/workers`.
3. Invite at least one worker with `/invite`.
4. Join a voice or stage channel and run `/play`.

If you run `/play` without all details, OmniFM opens a guided quick-start with station, voice-channel, and worker controls.

If no worker is invited, the commander can answer commands but cannot start a radio stream.

## Plans And Capabilities

| Plan | Worker slots per server | Audio preset | Main capabilities |
| --- | --- | --- | --- |
| Free | 2 | 64k | Core playback, station browsing, status/health, licensing basics |
| Pro | 8 | 128k | Dashboard access, event scheduler, role permissions, weekly digest, basic health dashboard |
| Ultimate | 16 | 320k | Everything in Pro plus custom station URLs, advanced analytics, failover rules, exports/webhooks, license workspace |

Notes:

- Worker-slot limits come from the plan definition in `src/config/plans.js`.
- Premium licenses are seat-based across servers. Seats and worker slots are separate concepts.
- Ultimate custom stations are limited per guild and reject local/private URLs.

## Slash Commands

Available on all plans:

- `/help`, `/setup`, `/play`, `/stations`, `/list`
- `/pause`, `/resume`, `/stop`, `/setvolume`
- `/status`, `/health`, `/diag`, `/stats`
- `/premium`, `/license`, `/language`
- `/invite`, `/workers`

Available from Pro:

- `/now`, `/history`
- `/event`
- `/perm`

Available only on Ultimate:

- `/addstation`, `/removestation`, `/mystations`
- `/voiceguard`

`/license activate` and `/license remove` require Discord `Manage Server`.

Command notes:

- `/play` opens a guided quick-start when station, voice channel, or worker selection is incomplete.
- `/stations` and `/list` use a paged browser instead of plain text lists.
- `/pause`, `/resume`, `/stop`, and `/setvolume` support `bot:<slot>` for targeted worker control.
- `/now`, `/history`, `/status`, `/health`, and `/diag` support `bot:<slot>` when multiple workers are active.
- `/stats` reflects intentional playback starts. Automatic reconnects, restores, failovers, and recovery restarts do not count as new manual starts.

## API Surfaces

Public routes:

- `GET /api/health`
- `GET /api/stats`
- `GET /api/stations`
- `GET /api/commands`
- `GET /api/bots`
- `GET /api/workers`
- `GET /api/legal`
- `GET /api/privacy`
- `GET /api/terms`

Dashboard, Premium, provider, and admin routes are documented in [docs/architecture.md](docs/architecture.md). Split-mode store ownership and JSON fallback rules are documented in [docs/store-concurrency.md](docs/store-concurrency.md).

Admin API authentication supports:

- `X-Admin-Token: <token>`
- `Authorization: Bearer <token>`

The runtime reads `API_ADMIN_TOKEN` or the legacy alias `ADMIN_API_TOKEN`.

## Repository Layout

- `src/`: canonical Node.js runtime, API, Discord runtime, stores, services, and entrypoints
- `frontend/`: React app that builds into `frontend/build`; `frontend/public` is only for assets that should ship with the React app
- `docs/`: project documentation
- `test/`: Node test suite for the canonical runtime
- `backend/`: archived legacy/reference Python backend and opt-in tests
- `scripts/`: Docker/runtime helper scripts
- `data/`: legacy station catalog files used by the older station service layer
- `web/`: emergency legacy static website fallback, only used when `WEB_ALLOW_LEGACY_FALLBACK=1`; standalone `app.js`/`styles.css` live here, not in `frontend/public`

Repository hygiene:

- Canonical remote: `https://github.com/Tabsi1998/OmniFM.git`
- Run `npm run test:repo-hygiene` before committing repository maintenance changes.
- `stations.json` is intentionally versioned as the canonical station catalog.
- Runtime state in the repository root is local deployment data and must stay ignored:
  `premium.json`, `bot-state.json`, `dashboard.json`, `custom-stations.json`,
  `command-permissions.json`, `guild-languages.json`, `song-history.json`,
  `listening-stats.json`, `scheduled-events.json`, `coupons.json`,
  `discordbotlist.json`, `botsgg.json`, `topgg.json`, `vote-events.json`,
  `operator-incidents.json`, and `runtime-incidents.json`.
- Backup, lock, log, and report artifacts such as `*.json.bak`, `*.lock`,
  `*.log`, `logs/`, and `test_reports/` must not be committed.

## Testing

Canonical Node.js tests:

```bash
npm test
```

Frontend production build:

```bash
npm --prefix frontend install
npm --prefix frontend run build
```

Archived legacy/reference Python tests:

```bash
python -m pip install -r backend/requirements.txt
OMNIFM_RUN_LEGACY_BACKEND_TESTS=1 REACT_APP_BACKEND_URL=http://127.0.0.1:8081 python -m pytest backend/tests -q
```

The Python test path is not a release gate. Without
`OMNIFM_RUN_LEGACY_BACKEND_TESTS=1`, it exits with an explicit message instead
of silently reporting a fully skipped test run.

## Notes

- Production expects `frontend/build` to exist. If it is missing, the runtime only serves `web/` when `WEB_ALLOW_LEGACY_FALLBACK=1`.
- The normal React deployment must not expose legacy root assets such as `/app.js` or `/styles.css`; those files belong only to the explicit `web/` fallback.
- Audio recognition is disabled by default and only works when `NOW_PLAYING_RECOGNITION_ENABLED=1`, `ACOUSTID_API_KEY` is set, and `fpcalc` is available.
- The current runtime reads `STRIPE_SECRET_KEY` or the legacy alias `STRIPE_API_KEY`.
- License reminder mails are controlled by `EXPIRY_REMINDER_DAYS`.
- `stations.json` is the canonical station store for the current runtime. `data/stations.free.json` and `data/stations.pro.json` remain in the repository for the older station service layer.
