# CLAUDE.md

What every contributor (and Claude Code) needs to build and check OmniFM.
Commits and PR titles in English, conventional style (`feat(scope):`,
`fix(scope):`, `perf:`, `chore:`); PR bodies follow
`.github/pull_request_template.md` with one `Closes #N` line per issue.

## Stack

Node 22 (Discord bot and API under `src/`), React + Vite (website, dashboard
and owner console under `frontend/`), MongoDB. `backend/` (FastAPI) is only the
way back until #291 removes it.

## Local first

The local check is the gate; the GitHub workflows run only when started by
hand. Before every push:

```bash
python scripts/local_check.py --only repository,node,backend
python scripts/local_check.py --only frontend,extra   # Lighthouse needs frontend in the same run
python scripts/local_check.py --list                  # the steps, without running them
```

- `npm ci` (root and `frontend/`) is skipped while `package.json`,
  `package-lock.json`, Node and npm match the last successful install
  (`node_modules/.omnifm-install.json`), npm's `node_modules/.package-lock.json`
  is unchanged with every package it lists on disk, and `npm ls --depth=0` is
  clean. `--fresh` installs anyway; the full check before a release always
  runs with `--all --fresh`.
- `--changed` picks the groups from the files changed against the merge base
  with `origin/main` (new and uncommitted files included): only documentation
  (`*.md` but `CHANGELOG.md`, `docs/`, `.claude/`, `LICENSE`) → repository;
  only `frontend/` (plus documentation) → everything but backend; anything else
  → all five groups. With `--only` it keeps the chosen groups that are
  affected. The full run stays the gate before a release.
- The unit suite runs its files in parallel (`npm run test:unit`, at most 8 at
  once); `test/support/isolate-test-file.mjs` gives every file its own
  database (`<DB_NAME>_unit_<file>`) and always a fresh runtime data
  directory; afterwards the runner drops only the databases it recorded in this
  run and reports leftovers on stderr. Tests reach store files through
  `resolveRuntimeDataPath(...)`, never the repository root. One after the other:
  `npm run test:unit -- --test-concurrency=1`.

Results in `.local-testing/` (ignored by Git). Tools: Docker Desktop, Git,
gitleaks, Python 3.12, Node 22 (a missing tool skips its steps with a hint).
Ports: API 18001, MongoDB 27019 (container `omnifm-local-check-mongo`).

| Group | Runs |
| --- | --- |
| repository | repo hygiene and route check, shell scripts parse, no CRLF, Gitleaks |
| node | `npm ci`, syntax gates, ESLint ratchet, type check, Opus codec, unit suite against MongoDB |
| backend | FastAPI unit tests, the owner contract and the contract suite against FastAPI and the Node API, the public Node entry |
| frontend | build, image size, Vitest, Playwright smoke with axe |
| extra | npm audit, settings vs `.env.example`, licences, OSV, ShellCheck, Opus on Linux, Semgrep, Lighthouse, live smoke |

## Ratchet

Known findings live in `scripts/ci-baseline.json`; new ones fail. Record only
when a list shrinks (`--record`); ESLint only through `npm run lint -- --record`.
New audit/OSV findings are fixed, not recorded. The Lighthouse floor is raised
by hand.

## Code rules

- No source file over 800 lines (`test/file-size.test.js`).
- Every setting the code reads is documented in `.env.example`.
- Discord messages are built with `src/discord/ui/` (`docs/discord-design.md`).
- Bot texts: `t("Deutsch", "English", params)`; the other seven languages in
  `src/i18n/bot/<code>.json`. Website texts: `frontend/src/i18n/` (README there).
- Voice encryption: native AES-256-GCM plus `sodium-native` only (#214).
- Releases: `node scripts/release.mjs notes|next|prepare|tag` (see the file).
