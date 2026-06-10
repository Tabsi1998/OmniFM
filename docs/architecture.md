# OmniFM Architecture And API

## Runtime Topology

OmniFM supports two runtime topologies.

### Monolith

- Entry point: `src/index.js`
- One Node.js process starts the commander runtime, local worker runtimes, web server, and recurring jobs
- Best fit for smaller or simpler deployments

### Split

- Commander entry point: `src/entrypoints/commander.js`
- Worker entry point: `src/entrypoints/worker.js`
- Commander owns slash commands, dashboard/API routes, Premium logic, provider sync, and remote worker routing
- Workers run playback and publish state through the worker bridge
- Compose file: `docker-compose.split.yml`

Both modes use the same stores, Discord command definitions, API handlers, and frontend build.

## Commander / Worker Model

The commander is the control plane:

- registers slash commands
- receives interactions
- serves the website and API
- resolves entitlements and worker routing
- exposes guided Discord command UX such as `/play`, `/stations`, `/invite`, and `/workers`

Workers are the data plane:

- join voice or stage channels
- transcode and stream audio
- maintain playback state
- execute reconnect/recovery logic

Typical flow:

1. A user runs a slash command on the commander.
2. The commander resolves guild access, plan, worker availability, station access, and optional `bot:<slot>` routing.
3. A worker is selected or reused.
4. The worker joins the voice target and starts playback.
5. OmniFM updates runtime state, embeds, history, and stats.

Discord UX notes:

- `/play` can fall back to a guided quick-start panel when the user does not provide all parameters.
- `/stations` and `/list` use a paged browser panel rather than plain-text dumps.
- Multi-worker read and control commands can resolve a specific worker through `bot:<slot>` when more than one runtime is active.

## Storage Model

The canonical runtime is file-first with optional MongoDB support.

Always persisted as root-level JSON files:

- `stations.json`
- `premium.json`
- `bot-state.json`
- `dashboard.json`
- `custom-stations.json`
- `command-permissions.json`
- `guild-languages.json`
- `song-history.json`
- `listening-stats.json`
- `scheduled-events.json`
- `coupons.json`
- `discordbotlist.json`
- `botsgg.json`
- `topgg.json`
- `vote-events.json`

Runtime directories:

- `logs/`
- `bot-state/`
- `song-history/`

MongoDB usage:

- When `MONGO_URL` or `MONGO_ENABLED=1` is set, OmniFM connects to MongoDB.
- Listening stats can migrate from JSON into MongoDB.
- `guild_settings` in MongoDB is used for dashboard settings such as weekly digest, failover chain, incident alerts, and exports/webhooks.
- In monolith mode, if Mongo is unavailable, file-based stores stay active for fallback/degraded operation.
- In split mode, MongoDB is required. Commander and worker entrypoints stop startup instead of using shared JSON files as a multi-process source of truth.
- Split-mode store ownership is explicit: per-bot runtime files stay per bot, global stores are commander-owned, Mongo-backed, or protected by a file lock. Details live in [store-concurrency.md](store-concurrency.md).

Listening-stats semantics:

- Stats track user-driven playback starts for analytics and digest summaries.
- Automatic reconnects, restore resumes, guarded voice returns, failovers, and recovery restarts do not count as fresh manual starts.

## Stations And Entitlements

Current canonical station storage:

- `stations.json` is the primary station catalog for the current runtime.
- Stations are normalized into `free`, `pro`, or `ultimate` tiers.
- `defaultStationKey`, `qualityPreset`, and `fallbackKeys` are stored alongside the station map.

Plan capabilities come from `src/config/plans.js`.

Current plan limits:

| Plan | Max workers | Bitrate |
| --- | --- | --- |
| Free | 2 | 64k |
| Pro | 8 | 128k |
| Ultimate | 16 | 320k |

Capability highlights:

- Pro: dashboard access, event scheduler, role permissions, weekly digest, basic health
- Ultimate: custom station URLs, advanced analytics, failover rules, license workspace, exports/webhooks

Custom station rules:

- only on Ultimate
- stored per guild
- public `http` or `https` only
- local/private URLs are rejected

## Playback, Metadata, And Recovery

Core playback services live under:

- `src/bot/runtime.js`
- `src/bot/runtime-streams.js`
- `src/bot/runtime-voice.js`
- `src/services/now-playing.js`
- `src/services/audio-recognition.js`

Metadata flow:

1. Read ICY metadata from the station stream.
2. Enrich with cover art providers.
3. If enabled and needed, run audio recognition.

Audio recognition flow:

1. `ffmpeg` captures a short WAV sample from the live stream.
2. `fpcalc` creates a Chromaprint fingerprint.
3. AcoustID resolves the fingerprint.
4. MusicBrainz optionally enriches title, artist, album, and release data.
5. Cover Art Archive can provide artwork.

Important runtime facts:

- Recognition is disabled by default.
- It needs `NOW_PLAYING_RECOGNITION_ENABLED=1`, `ACOUSTID_API_KEY`, and `fpcalc`.
- Soft failures are cached to avoid repeated noisy retries on unstable stations.

Recovery and reliability:

- voice-state reconciliation
- reconnect backoff and circuit breaking
- stream health checks and restarts
- optional voice channel status text
- Ultimate failover chain rules
- runtime incident alerts and dashboard incident feeds

## Dashboard, OAuth, And Premium

Dashboard login:

- Discord OAuth is handled by `src/api/routes/auth-routes.js`
- sessions are stored in `dashboard.json`
- the backend sets the dashboard session cookie and redirects back to the frontend

Premium model:

- licenses are stored in `premium.json`
- coupons/offers are stored in `coupons.json`
- seat bundles are linked to Discord guilds
- Ultimate adds a license workspace to link or unlink multiple guilds to one license
- checkout, renewal, offer preview, direct grants, and trial activation live in `src/services/payment.js`

Current runtime details worth documenting exactly:

- the runtime reads `STRIPE_SECRET_KEY` or the legacy alias `STRIPE_API_KEY`
- reminder mails use `EXPIRY_REMINDER_DAYS`
- the one-time Pro trial is controlled by `PRO_TRIAL_ENABLED`
- duration options are `1`, `3`, `6`, and `12` months
- seat options are `1`, `2`, `3`, and `5`

## Website And Frontend

- Public website source: `frontend/`
- Production build target: `frontend/build`
- React public assets: `frontend/public`, limited to files that should be copied into the React build
- Served by the Node backend
- Legacy static fallback: `web/`, only when `WEB_ALLOW_LEGACY_FALLBACK=1`
- Legacy standalone assets such as `web/app.js` and `web/styles.css` must not be duplicated in `frontend/public`, otherwise the React build exposes stale `/app.js` and `/styles.css` root files.

Legal pages:

- `/imprint`, `/impressum`
- `/privacy`, `/datenschutz`
- `/terms`, `/nutzungsbedingungen`

Public JSON payloads:

- `GET /api/legal`
- `GET /api/privacy`
- `GET /api/terms`

## Provider Integrations

DiscordBotList:

- status endpoint
- manual sync endpoint
- vote webhook
- vote history/status endpoint

Top.gg:

- project/command/stats/vote sync
- live status endpoint
- vote webhook
- vote polling/status endpoints

discord.bots.gg:

- stats sync
- live status endpoint

Unified vote events:

- votes from supported providers are normalized into `vote-events.json`
- current admin visibility endpoint: `GET /api/vote-events/status`

## API Authentication Rules

Public routes require no auth.

Dashboard routes require a valid dashboard session cookie.

Mutating dashboard session routes additionally require the browser intent header
`X-OmniFM-CSRF: dashboard-intent`. This applies to `POST`, `PUT`, `PATCH`, and
`DELETE` requests under `/api/dashboard/*` plus `POST /api/auth/logout`. The
server-to-server telemetry writer at `POST /api/dashboard/telemetry` is not a
cookie-session route and remains protected by the admin API token instead.

Admin routes use the admin token from `API_ADMIN_TOKEN` or `ADMIN_API_TOKEN` and accept either:

- `X-Admin-Token: <token>`
- `Authorization: Bearer <token>`

Browser CORS responses allow credentials and include `X-OmniFM-CSRF` in the
allowed request headers for dashboard mutations. Production deployments must
set `PUBLIC_WEB_URL` and/or `CORS_ALLOWED_ORIGINS` to the exact frontend origin.
Dashboard session cookies are HttpOnly; HTTPS deployments use secure cross-site
cookie attributes, while local development uses the local-safe fallback.

## Route Inventory

### Public Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Basic runtime health |
| `GET` | `/api/health/detail` | Detailed health, binaries, DB, stores, runtimes, admin token required |
| `GET` | `/api/stats` | Public counters for bots/stations/listeners |
| `GET` | `/api/stats/global` | Global listening stats payload |
| `GET` | `/api/stations` | Public station catalog |
| `GET` | `/api/commands` | Public command list payload |
| `GET` | `/api/bots` | Public bot status list |
| `GET` | `/api/workers` | Commander/worker topology snapshot |
| `GET` | `/api/legal` | Public imprint payload |
| `GET` | `/api/privacy` | Public privacy payload |
| `GET` | `/api/terms` | Public terms payload |

### Auth Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/discord/login` | Create OAuth state and return Discord authorize URL |
| `GET` | `/api/auth/discord/callback` | OAuth callback handler |
| `GET` | `/api/auth/session` | Return current dashboard session |
| `POST` | `/api/auth/logout` | Delete dashboard session |

### Dashboard Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/guilds` | Dashboard guild list for the signed-in user |
| `GET` | `/api/dashboard/capabilities` | Effective plan/capability payload for one guild |
| `GET` | `/api/dashboard/channels` | Text/voice/stage channel options |
| `GET` | `/api/dashboard/emojis` | Emoji catalog for dashboard editors |
| `GET` / `PUT` | `/api/dashboard/settings` | Guild settings, digest, failover, incident alerts, exports |
| `POST` | `/api/dashboard/settings/digest-preview` | Weekly digest preview |
| `POST` | `/api/dashboard/settings/digest-test` | Weekly digest test send |
| `GET` / `PUT` | `/api/dashboard/perms` | Command role permission rules |
| `GET` | `/api/dashboard/roles` | Guild role list for permission editor |
| `GET` | `/api/dashboard/stations` | Station catalog visible to the guild |
| `GET` / `POST` / `PUT` / `DELETE` | `/api/dashboard/custom-stations` | Ultimate custom station management |
| `POST` | `/api/dashboard/telemetry` | Dashboard client telemetry |
| `GET` | `/api/dashboard/stats` | Dashboard stats summary |
| `GET` | `/api/dashboard/stats/detail` | Advanced stats detail |
| `GET` / `PATCH` | `/api/dashboard/stats/incidents` | Runtime incident feed and acknowledgement |
| `DELETE` | `/api/dashboard/stats/reset` | Reset guild stats |
| `GET` / `PUT` | `/api/dashboard/license` | License workspace summary and billing email update |
| `POST` | `/api/dashboard/license/workspace` | Ultimate workspace link/unlink actions |
| `POST` | `/api/dashboard/license/offer-preview` | Renewal/upgrade offer preview |
| `POST` | `/api/dashboard/license/checkout` | Dashboard renewal/upgrade checkout |
| `POST` | `/api/dashboard/events/preview` | Validate and preview a scheduled event |
| `GET` / `POST` | `/api/dashboard/events` | List or create scheduled events |
| `PATCH` / `DELETE` | `/api/dashboard/events/<eventId>` | Update or delete a scheduled event |
| `POST` | `/api/dashboard/exports/webhook-test` | Test dashboard export webhook |
| `GET` | `/api/dashboard/exports/stats` | Export stats JSON |
| `GET` | `/api/dashboard/exports/custom-stations` | Export custom stations JSON |

### Premium Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/premium/check` | Premium/license summary for a guild |
| `GET` | `/api/premium/invite-links` | Invite link payloads |
| `GET` | `/api/premium/tiers` | Tier/capability payloads |
| `GET` | `/api/premium/pricing` | Public pricing payload |
| `GET` | `/api/premium/offer` | Read one offer by code |
| `POST` | `/api/premium/trial` | Claim one-time Pro trial |
| `POST` | `/api/premium/checkout` | Create checkout session |
| `POST` | `/api/premium/offer/preview` | Public offer preview |
| `POST` | `/api/premium/verify` | Verify a checkout/session result |
| `POST` | `/api/premium/webhook` | Stripe webhook |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/premium/offers` | Admin offer management |
| `POST` | `/api/premium/offers/active` | Admin offer activation toggle |
| `GET` | `/api/premium/redemptions` | Admin redemption history |

### Directory / Provider Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/discordbotlist/status` | DiscordBotList status |
| `GET` | `/api/discordbotlist/votes` | DiscordBotList votes |
| `POST` | `/api/discordbotlist/vote` | DiscordBotList vote webhook |
| `POST` | `/api/discordbotlist/sync` | Admin force sync |
| `GET` | `/api/botsgg/status` | discord.bots.gg status |
| `POST` | `/api/botsgg/sync` | Admin force stats sync |
| `GET` | `/api/topgg/status` | Top.gg status |
| `GET` | `/api/topgg/votes` | Top.gg vote history |
| `GET` | `/api/topgg/vote-status` | Top.gg vote status for a user |
| `POST` | `/api/topgg/webhook` | Top.gg vote webhook |
| `POST` | `/api/topgg/sync` | Admin force sync |
| `GET` | `/api/vote-events/status` | Unified vote-event status |

## Legacy Paths Kept In The Repository

- `backend/` contains the archived legacy/reference Python backend and opt-in
  tests. It is not the production backend and is intentionally not a CI release
  gate; the canonical backend/API implementation is the Node.js runtime under
  `src/`.
- `data/stations.free.json` and `data/stations.pro.json` are used by the older station service layer but are not the canonical station store for the current runtime.
- `web/` is an emergency frontend fallback and is not served automatically unless explicitly enabled.
