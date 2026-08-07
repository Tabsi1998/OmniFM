# Dependency Management

OmniFM uses Dependabot for weekly GitHub Actions, backend npm, and frontend npm
updates. A dependency update is only ready to merge when its lockfile is
reproducible and the affected runtime paths have passed their checks.

## Required Update Checks

Use Node.js 22 and run the following from a clean working tree:

```bash
npm ci --no-audit --no-fund
npm test
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build
```

The CI frontend-build job deliberately uses `npm ci` before `npm run build`.
That catches an out-of-sync lockfile before a deployment image is produced.
Do not repair a broken lockfile by deleting a transitive entry manually; use
the supported npm resolver, inspect the resulting diff, and rerun the clean
install.

## Security Audit Scope

The frontend is built into static files. `react-scripts` is therefore a build
dependency, while browser-delivered packages remain production dependencies.
Check the deployable dependency surfaces separately:

```bash
npm audit --omit=dev --audit-level=high
npm --prefix frontend audit --omit=dev --audit-level=high
```

`npm audit` without `--omit=dev` remains useful for planning, but it includes
the legacy CRA build chain. Do not use `npm audit fix --force`: it can replace
`react-scripts` with an invalid package and hide a breaking toolchain change.

## Current Reviewed Exceptions

- The frontend production audit is clean after the 2026-08 dependency refresh.
  The remaining build-tool advisories are confined to the legacy
  `react-scripts`/CRA chain and are tracked by #83; the frontend migration must
  remove that chain instead of papering it over with unsafe overrides.
- The root production audit is clean. OmniFM deliberately keeps the native
  `@discordjs/opus` implementation and constrains its unmaintained
  `@discordjs/node-pre-gyp` transitive `tar` dependency with the root npm
  override `tar@7.5.22`. This is a targeted compatibility override, not an
  `npm audit fix --force`: Node 22 installs it cleanly and the native
  encode/decode smoke covers the actual codec binding on Linux and Windows.
  Re-evaluate and remove the override when the upstream native package ships a
  maintained dependency range. This decision and its regression coverage close
  #132.

## Review Cadence

- Review Dependabot pull requests weekly. Patch and compatible minor updates
  may be batched when they share the same clean-install verification.
- Review major upgrades independently with a targeted runtime test plan,
  especially Discord voice, Stripe, MongoDB, mail delivery, React, and the
  frontend build toolchain.
- Record unresolved audit findings in an issue with package chain, severity,
  mitigation, and exit criteria. A passing build is not a substitute for a
  security decision.
