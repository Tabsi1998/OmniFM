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
