# OmniFM Local Development

## Goal

Run the canonical Node.js bot, API, and website locally and test real Discord flows without deploying a container first.

## Prerequisites

- Node.js 22+ for the app runtime
- npm
- At least one Discord bot token and client ID
- `ffmpeg` recommended for real playback tests
- MongoDB optional

## Minimum `.env`

Create `.env` from `.env.example` and fill at least:

- `BOT_1_TOKEN`
- `BOT_1_CLIENT_ID`

Recommended local defaults:

- `BOT_1_NAME=OmniFM Commander`
- `BOT_1_TIER=free`
- `COMMANDER_BOT_INDEX=1`
- `OMNIFM_DEPLOYMENT_MODE=monolith`
- `WEB_PORT=8081`
- `WEB_INTERNAL_PORT=8080`
- `PUBLIC_WEB_URL=http://localhost:8081`
- `MONGO_ENABLED=0`

## Optional Dashboard OAuth

If you want to test dashboard login, also set:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI=http://localhost:8081/api/auth/discord/callback`

Your Discord application must allow that redirect URI.

## Install Dependencies

```bash
npm install
npm --prefix frontend install
```

## Run The Monolith Locally

Start the bot, API, and integrated website:

```bash
npm start
```

Open:

- `http://localhost:8081`
- `http://localhost:8081/api/health`

## Optional React Hot Reload

Start the frontend dev server in a second terminal:

```bash
npm run frontend:start
```

Then open:

- `http://localhost:3000`

By default the React dev server talks to `http://localhost:8081` when it detects the browser is running on `localhost:3000`.

Frontend overrides:

- `REACT_APP_BACKEND_URL`
- `REACT_APP_BACKEND_PORT`

Those are frontend dev-server variables and are typically set in `frontend/.env` or the shell that starts `npm run frontend:start`.

## Archived Python Backend

The Python backend in `backend/server.py` is an archived legacy/reference path.
It is not the production runtime and is not part of the CI release gate.

Only run its old contract tests when intentionally comparing against a live API:

```bash
python -m pip install -r backend/requirements.txt
OMNIFM_RUN_LEGACY_BACKEND_TESTS=1 REACT_APP_BACKEND_URL=http://127.0.0.1:8081 python -m pytest backend/tests -q
```

Without `OMNIFM_RUN_LEGACY_BACKEND_TESTS=1`, the legacy Python tests exit with
a clear message instead of silently skipping the whole suite.

## Run Split Mode Locally Without Docker

This is only useful when you want to debug commander and worker processes separately.

Required:

- Configure at least two bots in `.env`, for example `BOT_1_*` and `BOT_2_*`
- Set `COMMANDER_BOT_INDEX=1`

Terminal 1, commander:

```bash
npm run start:commander
```

Terminal 2, worker 2:

```powershell
$env:BOT_PROCESS_INDEX='2'
npm run start:worker
```

Each additional worker needs its own terminal and its own `BOT_PROCESS_INDEX`.

## Local Docker Alternative

If you want the production-style path locally:

```bash
bash ./scripts/compose.sh up -d --build
bash ./scripts/compose.sh logs -f omnifm
```

PowerShell helper for split Docker startup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-split.ps1 -Build
```

## First Local Discord Test

1. Invite the commander bot to a test guild.
2. Use `/setup` or `/workers`.
3. Invite at least one worker with `/invite`.
4. Join a voice or stage channel.
5. Run `/play`.

Without an invited worker, the commander can answer commands, but playback cannot start.

Useful current Discord behavior while testing locally:

- `/play` opens a guided quick-start if station, worker, or voice-channel input is missing.
- `/stations` and `/list` open the browser-style station picker instead of a text wall.
- `/pause`, `/resume`, `/stop`, and `/setvolume` support `bot:<slot>` when you want to target a specific worker.
- `/status`, `/health`, `/diag`, `/now`, and `/history` also support `bot:<slot>` if multiple workers are streaming at once.
- `/stats` counts deliberate starts, not automatic reconnect, restore, or recovery restarts.

## What Works Without Extra Services

- Website
- Public API routes
- Station browsing
- Core Discord playback/runtime
- Slash command handling
- File-based persistence

## What Needs More Configuration

- Dashboard login: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`
- Stripe checkout: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- SMTP mail: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Mongo-backed persistence: `MONGO_URL` or `MONGO_ENABLED=1`
- Audio recognition: `NOW_PLAYING_RECOGNITION_ENABLED=1`, `ACOUSTID_API_KEY`

## Common Local Blockers

- Empty `.env`: OmniFM exits with `No bot configuration found. Set BOT_1_TOKEN/BOT_1_CLIENT_ID.`
- Missing `ffmpeg`: the process can start, but real playback and metadata tooling are limited.
- Missing OAuth redirect configuration: the dashboard loads, but login fails.
- Missing worker invite: the commander responds, but no stream starts.
- Missing `frontend/build`: the monolith serves the integrated site only after `npm --prefix frontend run build`, unless you use the React dev server.
