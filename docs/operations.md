# OmniFM Operations And Deployment

## Recommended Production Path

1. Prepare `.env` from `.env.example`.
2. Run `./install.sh` on a Linux host with Docker.
3. Start or rebuild with `bash ./scripts/compose.sh up -d --build`.
4. Inspect logs with `bash ./scripts/compose.sh logs -f omnifm`.
5. Run the live acceptance check after important changes.

The full release, update, and rollback checklist is documented in
[release-process.md](release-process.md).

## Compose Selection

`scripts/compose.sh` is the normal entry point for Docker Compose commands.

It exports the effective compose environment from `scripts/runtime-compose.sh` and then runs:

```bash
docker compose ...
```

Selection logic:

- `OMNIFM_DEPLOYMENT_MODE=monolith` -> `docker-compose.yml`
- `OMNIFM_DEPLOYMENT_MODE=split` -> `docker-compose.split.yml`
- `OMNIFM_DEPLOYMENT_MODE=auto` -> split when more than one bot is configured, otherwise monolith

Split mode requires MongoDB. Commander and worker startup fails when MongoDB is
not configured or unavailable. File-backed fallback stores are supported only
for monolith/local/degraded operation, not as the split-mode source of truth.

Useful examples:

```bash
bash ./scripts/compose.sh ps
bash ./scripts/compose.sh up -d --build
bash ./scripts/compose.sh logs -f omnifm
bash ./scripts/compose.sh down
```

## Compose Files

### `docker-compose.yml`

- `mongodb`
- `omnifm`

The `omnifm` container runs `docker-entrypoint.sh`, which then starts `src/index.js`.

### `docker-compose.split.yml`

- `mongodb`
- `omnifm` as the commander service
- `omnifm-worker-N` services for every configured worker profile

The commander runs `src/entrypoints/commander.js`. Workers run `src/entrypoints/worker.js`.

## Install Script

`./install.sh` is the intended first-run setup for production.

It can:

- install Docker on supported Linux hosts
- create or extend `.env`
- configure one or more bots
- set commander vs worker layout
- set web URL/ports
- set Stripe
- set SMTP
- set DiscordBotList, Top.gg, and discord.bots.gg values
- set audio recognition values
- build and start the container(s)

## Update Script

`./update.sh` is the operational admin tool for deployed environments.

Common modes:

| Command | Purpose |
| --- | --- |
| `./update.sh --update` | Pull/update/rebuild full deployment |
| `./update.sh --update-rolling` | Rolling worker restarts in split mode |
| `./update.sh --update-commander` | Rebuild only commander container in split mode |
| `./update.sh --bots` | Bot management submenu |
| `./update.sh --stripe` | Stripe secret/public key setup |
| `./update.sh --premium` | Premium CLI through the running container |
| `./update.sh --offers` | Offer/coupon/direct-grant management |
| `./update.sh --email` | SMTP setup |
| `./update.sh --settings` | Main settings menu |
| `./update.sh --settings admin` | Owner/admin token setup for `/admin` |
| `./update.sh --settings logs` | Log rotation and Docker cleanup settings |
| `./update.sh --settings legal` | Imprint/privacy/terms legal settings |
| `./update.sh --settings commands` | Slash-command settings directly |
| `./update.sh --dashboard-settings` | Dashboard OAuth setup shortcut |
| `./update.sh --status` | Interactive admin cockpit |
| `./update.sh --status quick` | Non-interactive status summary |
| `./update.sh --status live` | Live Docker logs |
| `./update.sh --status local-live` | Live local log tail |
| `./update.sh --doctor` | System/runtime diagnostics |
| `./update.sh --recognition-test <URL>` | Direct audio-recognition test |
| `./update.sh --cleanup` | Cleanup logs, backups, Docker cache |

Release gate wrappers:

| Command | Purpose |
| --- | --- |
| `npm run release:preflight` | Tests, frontend build, audit assessment, and config doctor before production update |
| `npm run release:postdeploy -- --base-url https://omnifm.xyz` | Live-smoke gate after deployment |
| `npm run release:rollback-plan` | Prints the rollback checklist |

Important warning:

- `./update.sh --update*` is intended for deployed checkouts.
- The script resets the local repository to the configured remote branch during the update path.
- Do not use it on a development checkout with uncommitted work.
- Do not run write-capable CLI tools against shared JSON files while split containers are running. Store ownership and split-safety rules are documented in [store-concurrency.md](store-concurrency.md).

## Split Mode Notes

Split mode becomes useful when you have multiple bots and want isolated worker processes.

Important variables:

- `OMNIFM_DEPLOYMENT_MODE=split`
- `MONGO_URL=mongodb://mongodb:27017` or `MONGO_ENABLED=1`
- `COMMANDER_BOT_INDEX=<bot number>`
- `BOT_N_TOKEN`, `BOT_N_CLIENT_ID`, `BOT_N_NAME`, `BOT_N_TIER`

Before switching a host to split mode, run:

```bash
node scripts/check-split-requirements.mjs --env-file .env
./update.sh --doctor
```

Windows helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-split.ps1 -Build
```

That helper:

- reads `.env`
- resolves the commander bot
- enables only the worker profiles that actually exist
- starts the split compose file with Docker

## Container Boot Behavior

`docker-entrypoint.sh` does some runtime preparation before launching OmniFM:

- ensures JSON files exist and contain valid JSON
- creates `logs/`, `bot-state/`, and `song-history/`
- waits for MongoDB when `MONGO_URL` is set
- refuses split commander/worker startup when MongoDB is required but unavailable
- checks `ffmpeg` and `fpcalc`
- deploys slash commands when `REGISTER_COMMANDS_ON_BOOT=1`
- starts `src/index.js`

## Live Acceptance Check

The repository ships with `scripts/phase6-live-check.mjs`.

Example:

```bash
node scripts/phase6-live-check.mjs --base-url https://example.com --admin-token "$API_ADMIN_TOKEN" --docker-service omnifm --log-since 30m
```

It checks:

- SPA delivery for `/`, `/dashboard`, and `/impressum`
- public SEO assets (`robots.txt`, `sitemap.xml`, manifest, favicon, base meta)
- browser security headers on HTML, static assets, and public API responses
- public API health, station catalog, bot overview, and legal/privacy/terms configuration
- absence of legacy root assets such as `/app.js` and `/styles.css`
- DiscordBotList status
- discord.bots.gg status
- Top.gg status
- unified vote-event status
- recent Docker logs for failure patterns

Supported admin token inputs:

- `--admin-token`
- `OMNIFM_ADMIN_TOKEN`
- `API_ADMIN_TOKEN`
- `ADMIN_API_TOKEN`

GitHub Actions release gate:

- Workflow: `.github/workflows/live-smoke.yml`
- Schedule: daily against `https://omnifm.xyz`
- Manual run: Actions -> `live-smoke` -> Run workflow
- Required repository secret for full checks: `OMNIFM_LIVE_ADMIN_TOKEN`
- Public-only diagnostic mode: run manually with `skip_authenticated_api=true`

The workflow intentionally passes the admin token through an environment secret
and does not echo it. Docker log scanning is skipped in GitHub Actions because
the runner has no access to the production host logs.

## Search Console

The public website Search Console workflow is documented in
[search-console.md](search-console.md).

Before website releases, run:

```bash
npm run seo:search-console
```

After production deploys that affect routing, metadata, robots, sitemap, or legal
pages, IT-Tabelander should verify Search Console property status, sitemap
submission, Indexing/Pages coverage, mobile usability, and Core Web Vitals for
`https://omnifm.xyz/`.

## Security Headers

Browser security headers are documented in [security-headers.md](security-headers.md).
Run the live acceptance check after proxy, domain, analytics, checkout, or
frontend changes so CSP/HSTS/Permissions-Policy regressions are caught before
Search Console or users see them.

## Logs And Status

Fast status overview:

```bash
./update.sh --status quick
```

Live container logs:

```bash
./update.sh --status live
```

Direct compose logs:

```bash
bash ./scripts/compose.sh logs -f omnifm
```

## Persisted Runtime Data

Both Compose files bind-mount exactly one host directory:

```text
./runtime-data:/app/runtime-data
```

It contains all mutable JSON stores, logs, split-state directories, incident
fallbacks, and `owner-audit.json`. `owner-audit.json` is the persistent
file-backed source of truth for owner actions (retention: the newest 500
sanitized events); it remains available during a controlled MongoDB outage.
The owner UI/API is the supported access path for audit events.

Run the initializer before a direct Compose command:

```bash
bash ./init-data.sh
```

`scripts/compose.sh`, `install.sh`, `update.sh`, and the PowerShell split
starter invoke it automatically for starts. On its first run it copies existing
root-level runtime files into `runtime-data/` without deleting the old files.
It creates missing files with safe defaults and refuses directory or symlink
mistakes instead of allowing an in-memory fallback. The container validates the
JSON again before it starts an application role.

The versioned root `stations.json` remains the seed catalog. It is copied into
`runtime-data/stations.json` only when that mutable runtime catalog does not
exist yet. Never delete `runtime-data/` to update the catalog; use the station
management workflow instead.

All runtime data is ignored by Git, including lock, temporary, corrupt-file,
and pre-restore artifacts. Before maintenance commits, run:

```bash
npm run test:repo-hygiene
```

### Backup and restore

Create an archive before a manual maintenance window:

```bash
bash ./scripts/backup-runtime-data.sh create
bash ./scripts/backup-runtime-data.sh list
```

Archives and optional SHA-256 sidecars live under
`.update-backups/runtime-data/`; `update.sh` creates one automatically unless
`OMNIFM_SKIP_RUNTIME_BACKUP=1` is deliberately set. To restore, stop all
OmniFM containers first. Restore requires an explicit force flag and retains
the previous directory as `runtime-data.pre-restore-<timestamp>/` for rollback:

```bash
bash ./scripts/compose.sh down
bash ./scripts/backup-runtime-data.sh restore .update-backups/runtime-data/<archive>.tar.gz --force
bash ./scripts/compose.sh up -d
```

Backups may contain user, license, session, and audit data. Store them with the
same access controls as `.env` and do not upload them to source control.

### Container hardening

The Docker build context is an allowlist, the application image runs as the
unprivileged `node` user, and Compose drops application capabilities and sets
`no-new-privileges`. The launcher maps that user to the invoking Linux host UID
and GID so bind-mounted runtime data does not become root-owned. MongoDB keeps
its image defaults because its upstream entrypoint must initialize its database
volume; the application services receive the stricter capability policy.

Node and Mongo images use fixed release tags. Review and update them together
with the Docker build/start CI job; do not replace them with broad major tags.

The canonical Git remote is `https://github.com/Tabsi1998/OmniFM.git`.

## Common Tasks

Rebuild after code changes:

```bash
bash ./scripts/compose.sh up -d --build
```

Open Premium CLI inside the running container:

```bash
./update.sh --premium
```

Open offer manager inside the running container:

```bash
./update.sh --offers
```

Show configured bots:

```bash
./update.sh --bots
```

## Operational Notes

- `frontend/build` must exist for the production website unless you explicitly allow the legacy fallback.
- `WEB_ALLOW_LEGACY_FALLBACK=1` is an emergency switch, not the normal frontend path.
- Do not copy the legacy `web/app.js` or `web/styles.css` into `frontend/public`; Create React App copies public files verbatim into `frontend/build`, which would expose stale root assets in production.
- Recognition support depends on `ffmpeg`, `fpcalc`, and the recognition env values.
- The backend can continue with file-based stores when MongoDB is unavailable.
