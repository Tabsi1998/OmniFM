# CLAUDE.md

Notes for Claude Code sessions on OmniFM: how the local checks are set up and
how to extend them. Answer the owner (Tabsi1998) in German. Commits and PR
titles stay English, in the conventional style of the history
(`feat(scope):`, `fix(scope):`, `chore:`); PR bodies follow
`.github/PULL_REQUEST_TEMPLATE.md`.

## Local first, GitHub second

GitHub Actions is the second confirmation. Before every push:

```bash
python scripts/local_check.py                 # everything but extra
python scripts/local_check.py --all           # plus the gates GitHub does not run
python scripts/local_check.py --only node,backend
python scripts/local_check.py --list          # the steps, without running them
```

Results: `.local-testing/local-check.json`, logs in `.local-testing/logs/`,
live progress in `.local-testing/local-check.progress.json`. All of it is
ignored by Git.

| Group | Mirrors | Runs |
| --- | --- | --- |
| repository | ci.yml `syntax` | `test:repo-hygiene`, every `*.sh` parses, no CRLF in the index, Gitleaks over the history and over uncommitted files |
| node | ci.yml `syntax`, `unit`, `voice-codec`, `mongo-smoke`; nightly | Node 22 as package.json pins it, `npm ci`, the syntax gates (`scripts/check-syntax.mjs` parses every module under `src/` and `scripts/`), the ESLint ratchet (`npm run lint`), the type check (`npm run typecheck`: tsc over `src/lib` and `src/core`, shared JSDoc types in `src/lib/types.js`), the Opus codec, the Mongo smoke, `test:unit` against a MongoDB 7.0.39 container |
| backend | ci.yml `fastapi-smoke` | Python 3.12 venv, compileall, `backend/unit_tests`, the owner contract against a live uvicorn - the ci.yml assertions plus: admin routes refuse requests without the token; then the `backend/tests` contract suite against the same server (every failing test fails); then a second FastAPI with `OMNIFM_DASHBOARD_BACKEND=node` in front of the Node API started alone (`scripts/serve-node-api.mjs`, #195) |
| frontend | ci.yml `frontend-build` | `npm ci`, the Vite build, and proof it produced `build/index.html` and bundles |
| extra | - | npm audit (high and critical), settings read by the code vs `.env.example`, dependency licences, OSV over the lockfiles, ShellCheck |

Not mirrored locally: CodeQL, the live smoke against omnifm.xyz.

Tools the checks expect: Docker Desktop (MongoDB, OSV, ShellCheck), Git for
Windows, gitleaks, Python 3.12 through the `py` launcher, Node 22. A missing
tool skips its steps with a hint instead of failing.

## Ratchet

The extra group and ESLint compare against `scripts/ci-baseline.json`: known
findings are debt, new ones fail. ESLint keys a finding by file, rule and its
number within that pair; `npm run lint -- --record` rewrites only its list, and
ci.yml runs the same `npm run lint`. After paying debt down, run
`python scripts/local_check.py --all --record` and commit the baseline. Gates
that ci.yml already enforces are never ratcheted.

Debt on 2026-09-24: fast-uri in the frontend (high), six dependencies outside the
allowed licences (caniuse-lite of the ESLint tooling only in development), four OSV findings in the lockfiles, two ShellCheck findings,
and the ESLint findings from the day the linter came in (mostly unused
variables and awaits in loops).
Every setting the code reads is documented in `.env.example` (active line for a
default, `# NAME=` for an optional override); values OmniFM sets itself are
listed in `ENV_PROVIDED` in `scripts/local_check.py`.

## Extending the checks

`scripts/local_check.py` has three parts:

1. **Header** - paths, groups, versions, ports.
2. **Shared core** - `Step`, `Context`, the runner, the ratchet, Gitleaks, OSV,
   ShellCheck, MongoDB and process helpers. IT-Tabelander, dolibarr-mahnwesen
   and THE-LION_SQUAD-eSPORT-Webseite carry the same copy; a fix here is worth
   porting there.
3. **OmniFM steps** and `plan()`.

A step is a function `(context) -> str`. It returns its one-line result,
raises `StepFailed` with the reason and how to fix it, or `StepSkipped` when it
cannot run on this machine. Register it with
`Step(group, name, describe, action, needs)`; `needs` names steps of the same
group, or `group/name` across groups. A gate that counts findings goes through
`ratchet(context, key, found, what)`.

Keep the ports unique, so repositories can be checked side by side: API 18001,
MongoDB 27019 (container `omnifm-local-check-mongo`).

## Windows notes

- Node 22 comes from `~/.local-toolchain/node-v22.*`; the system Node is 24.
- The venv lives in `~/.local-ci/OmniFM/`, never inside the repository.
- Environment variables that look like credentials are withheld from every
  step; only their names are printed.
- `tzdata` goes into the venv: Windows has no zoneinfo database, and tests that
  build Europe/Vienna would fail only here.

## Machine-local helpers (not in Git)

- `.ci-panel/test_checks.py` with `.vscode/settings.json`: every step in the VS
  Code Testing panel through pytest. Hidden through `.git/info/exclude`.
- `C:\Programmieren\check-all.py --serve`: live dashboard over all
  repositories. `C:\Programmieren\Programmieren.code-workspace` opens all five.
