---
name: omnifm-discord
description: OmniFM's own rules for touching the Discord bot, its messages, texts, stations and checks. Use for any change in this repository that sends or edits a Discord message, adds a bot text, a slash command or a button, fetches a radio stream or another URL, touches the commander/worker split, the station catalog, or runs the local check.
---

# OmniFM: building for Discord

`CLAUDE.md` (stack, local check, ratchet, code rules) and
`docs/discord-design.md` (message building blocks and rules) are the source.
This skill is the checklist for doing it right the first time.

## 1. Every Discord message goes through `src/discord/ui/`

- Build with `ui.panel`, `ui.notice`, `ui.list`, `ui.confirm`, `ui.section`,
  `ui.text`, `ui.field`, `ui.statusLine`, `ui.separator`
  (`src/discord/ui/builders.js`). Never hand-build embeds or raw components.
- Send with `ui.reply(...)` (private, the default answer to a command) or
  `ui.message(...)` (public panels only).
- Components V2 messages cannot become embeds again: buttons on them answer
  with a new message (`isComponentsV2Message`), never `interaction.update()`
  to an embed.
- Icons: `ui.icon(name, applicationId)` (the sending bot's own app emoji,
  Unicode until uploaded).
- **Every new or changed message has a test that calls
  `checkDiscordLimits(payload)`** (40 components, 4,000 characters). Look at
  `test/discord-ui.test.js` and the panel tests for the pattern; build the
  message with worst-case data (long station names, many entries, all 9
  languages), not just the happy path.

## 2. Texts in nine languages

- Bot texts: `t("Deutsch", "English", { params })` from `botTranslator(language)`
  (`src/lib/bot-i18n.js`). Values only as `{placeholders}`, never glued into the
  string, so each language keeps its own word order.
- The other seven languages (`fr es it pl tr pt nl`) live in
  `src/i18n/bot/<code>.json`, keyed by the English text.
  `scripts/extract-bot-strings.mjs` finds every text,
  `test/bot-languages.test.js` checks the tables. A new English text needs its
  seven translations in the same PR.
- Website texts: `frontend/src/i18n/` (see the README there).
- Tone: short, "du", one sentence what is going on, one what to do; an error
  gets a button that fixes it where possible.

## 3. Commander and workers

- Live runs split: one commander process (slash commands, panels, the API
  side) and worker processes (`src/entrypoints/worker.js`, started by
  `split-supervisor.js` with `BOT_PROCESS_INDEX`). The commander drives
  workers through the worker bridge (`src/core/worker-bridge.js`,
  `src/bot/remote-worker-handle.js`, `src/bot/worker-bridge-service.js`).
- A feature that a worker needs must work across that bridge: no shared
  memory between processes, state that both sides read lives in MongoDB.
- Plan limits count workers by **slot** (position among the workers), never by
  BOT number (#520): `createWorkerRuntime()` in `src/entrypoints/shared.js`.
- Slash commands: `src/commands.js` and `src/bot/commands/*`; their
  translations are checked by `test/command-translations.test.js`.

## 4. Outbound requests

- Every request to a user- or catalog-supplied URL goes through `safeFetch`
  (`src/lib/safe-outbound-http.js`): SSRF check and DNS pinning on every hop,
  redirect limit, credentials stripped on origin change. Never plain `fetch`.
- `lenientHttpParser: true` **only** for radio streams (some servers end the
  status line with a bare LF, StreamABC, #536). `test/stream-fetch-parser.test.js`
  guards that every stream fetch carries it. Images, webhooks and APIs stay
  strict.
- A stream probe reads a few KB and stops; every timer is cleared and the
  body is cancelled on every path (#539).
- SomaFM answers 403 to every non-browser client (#549): do not add SomaFM
  streams and do not fake a browser user agent.

## 5. Stations

- `stations.json` is only the seed. The live catalog is the MongoDB
  collection `stations`. A change to an existing catalog station reaches live
  servers through `STATION_CATALOG_MIGRATIONS` in `src/stations-store.js`
  (writes only where the old URL is still stored, so operator edits stay).
- Keys never change: favourites and server settings reference them.
- Prefer https, the highest bitrate the station offers (OmniFM transcodes per
  plan), and URLs without tokens or tracking tails.
- Song titles: adverts are never counted or shown as songs
  (`src/lib/advert-titles.js`, `nowPlayingTrackFields`, #548).

## 6. Checks and known traps

- Run the local check per `CLAUDE.md`, both groups, one run at a time on the
  whole machine. Never two checks in parallel.
- Each worktree gets its own `npm ci`; never link `node_modules`.
- Git Bash: do not export `MSYS_NO_PATHCONV=1` for the check (the shell-script
  tests then get `C:\tmp\...` paths and fail).
- A check that was stopped leaves the container `omnifm-local-check-mongo`
  behind: `docker rm -f omnifm-local-check-mongo` before the next run.
- `npm ci` on Windows can fail once with `ENOTEMPTY`; run it again.
- New `npm audit`/OSV findings are fixed, not recorded into
  `scripts/ci-baseline.json`.
- A test must fail without the fix: do the counter-check and say so in the PR.
