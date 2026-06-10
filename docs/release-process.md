# Release, Update, And Rollback Process

This document is the production release checklist for OmniFM. It connects local
preflight checks, Docker/Compose updates, live-smoke verification, and rollback
steps into one repeatable flow.

## Release Gate Script

The release gate is `scripts/release-gate.mjs`.

Useful commands:

```bash
npm run release:preflight
node scripts/release-gate.mjs --preflight --dry-run
node scripts/release-gate.mjs --post-deploy --base-url https://omnifm.xyz --admin-token "$API_ADMIN_TOKEN"
node scripts/release-gate.mjs --all --base-url https://omnifm.xyz --admin-token "$API_ADMIN_TOKEN"
npm run release:rollback-plan
```

Dry-run mode prints the commands that would run without changing the deployment.
Use it before changing a production host or when testing a new release procedure.

## Preflight

Run this before updating production:

```bash
npm run release:preflight
```

The preflight covers:

- clean Git worktree unless `--allow-dirty` is used intentionally
- full repository test gate through `npm test`
- React production build through `npm --prefix frontend run build`
- dependency audit assessment through `npm audit --omit=dev --audit-level=high`
- config doctor through `./update.sh --doctor` on Linux deployments
- migration readiness through existing tests, CI Mongo smoke, and boot-time JSON
  to Mongo migration logs

For a no-change rehearsal:

```bash
node scripts/release-gate.mjs --preflight --dry-run
```

## Update Flow

Recommended production sequence:

```bash
git fetch origin
git log --oneline -5
npm run release:preflight
./update.sh --update
node scripts/release-gate.mjs --post-deploy --base-url https://omnifm.xyz --admin-token "$API_ADMIN_TOKEN"
```

Split deployments can use rolling worker restarts when the change is compatible:

```bash
./update.sh --update-rolling
```

Commander/API/dashboard-only changes can use:

```bash
./update.sh --update-commander
```

Do not run write-capable CLI tools against shared JSON files while split
containers are running. Store ownership and split safety rules are documented in
[store-concurrency.md](store-concurrency.md).

## Post-Deploy Checks

The post-deploy gate calls `scripts/phase6-live-check.mjs` and verifies:

- SPA delivery for `/`, `/dashboard`, and `/impressum`
- public SEO assets and base metadata
- security headers
- `/api/health`, `/api/stations`, `/api/bots`
- legal/privacy/terms configuration
- absence of legacy root assets such as `/app.js` and `/styles.css`
- provider status endpoints when an admin token is available
- Docker log patterns when the check runs on the production host

GitHub Actions also provides the `live-smoke` workflow for scheduled and manual
checks. Configure repository secret `OMNIFM_LIVE_ADMIN_TOKEN` for the full
authenticated run.

## Owner Visibility

The protected admin/owner surface exposes release information in:

- `/admin?token=<token>` release card
- `/api/admin/overview?token=<token>` under `release`
- `/api/health/detail` under `release`

The release payload includes app version, Git commit, branch, frontend build
stamp, web root source, deploy status, and live-smoke status. Production
deployments can set:

| Variable | Purpose |
| --- | --- |
| `OMNIFM_RELEASE_SHA` | Commit SHA shown in owner/admin status |
| `OMNIFM_RELEASE_BRANCH` | Branch shown in owner/admin status |
| `OMNIFM_DEPLOYED_AT` | Deployment timestamp |
| `OMNIFM_LAST_DEPLOY_STATUS` | `success`, `failed`, `running`, or `skipped` |
| `OMNIFM_LAST_LIVE_SMOKE_STATUS` | Latest live-smoke result |

When these variables are absent, OmniFM falls back to local Git metadata where
available and marks deploy/smoke status as `unknown`.

## Rollback

Start with:

```bash
npm run release:rollback-plan
```

Operational rollback steps:

1. Stop risky rollout activity. Do not start another update while triaging.
2. Record the failing commit and current container state.
3. Roll code back:

```bash
git fetch origin
git checkout <known-good-commit-or-tag>
bash ./scripts/compose.sh up -d --build
```

4. In split mode, restart commander first when API/dashboard/commands are
   affected. Restart workers first only for worker-only playback incidents.
5. Restore runtime JSON files only for data-related incidents and only from a
   verified backup. Keep `stations.json` under Git ownership unless the station
   catalog itself is the rollback target.
6. For MongoDB incidents, stop OmniFM containers before restoring a database
   backup. Prefer forward fixes for already-applied schema/data migrations.
7. Run the post-deploy gate again and inspect `/admin`, `/api/health/detail`,
   GitHub `live-smoke`, and Docker logs.

Rollback is complete only when the live-smoke gate passes and user-facing bot/API
behavior is back to the known-good state.
