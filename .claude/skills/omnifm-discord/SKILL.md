---
name: omnifm-discord
description: OmniFM's own rules for touching the Discord bot, its messages, texts, stations and checks. Use for any change in this repository that sends or edits a Discord message, adds a bot text, a slash command or a button, fetches a radio stream or another URL, touches the commander/worker split, the station catalog, or runs the local check.
---

# OmniFM: building for Discord

`CLAUDE.md` (stack, local check, ratchet, code rules) and
`docs/discord-design.md` (message building blocks and rules) are the source.
This skill is the checklist for doing it right the first time.

## 1. Every bot message goes through `src/discord/ui/`

This covers every new or changed message the bot sends in channels and as
interaction answers. Some older paths still send hand-built embeds
(`src/bot/commands/server-commands.js`) or plain text messages
(`src/bot/runtime-failback.js`):
when you touch one, move it to `src/discord/ui/`. Operator alerts posted to a
webhook (`src/services/operator-webhook.js`) build their own embeds on purpose.

- The top level of a message is `ui.panel`, `ui.notice`, `ui.confirm`, or
  the `.container` that `ui.list(...)` returns (it returns
  `{ container, page, pages }`) (`src/discord/ui/builders.js`): they add the
  brand line with the version that `docs/discord-design.md` requires. A raw
  `ui.container({ blocks })` does not; if you need it, add
  `ui.brandLine(...)` yourself. Inside use `ui.section`, `ui.text`,
  `ui.field`, `ui.statusLine`, `ui.separator`. Never hand-build embeds or raw
  components.
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

- Two modes (`src/entrypoints/from-owner-config.mjs`): with more than one bot
  (or `OMNIFM_DEPLOYMENT_MODE=split`) OmniFM runs split, which is how it runs
  live: one commander process (slash commands, panels, the API side) and
  worker processes (`src/entrypoints/worker.js`, started by
  `split-supervisor.js` with `BOT_PROCESS_INDEX`). With one bot or
  `OMNIFM_DEPLOYMENT_MODE=monolith` everything runs in `src/index.js`. A change
  must work in both. The commander drives
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
  redirect limit, credentials stripped on origin change. That is the rule for
  every URL a user, a server admin, the owner or the station catalog supplies;
  the operator webhook service (`src/services/operator-webhook.js`) uses it
  too. Plain `fetch` exists only for fixed third-party API hosts (iTunes,
  MusicBrainz and similar in `src/services/now-playing.js`) and two older
  checked paths (the Discord CDN download in `src/bot/runtime-methods/forms.js`,
  the owner console's test alert in `src/api/routes/admin-routes.js`). New code
  that fetches a supplied URL uses `safeFetch`.
- `lenientHttpParser: true` **only** for radio streams (some servers end the
  status line with a bare LF, StreamABC, #536). `test/stream-fetch-parser.test.js`
  checks the files in its `STREAM_FETCHERS` list: **a new file that opens
  streams must be added to that list**, or the guard does not see it. Images,
  webhooks and APIs stay strict.
- A stream probe reads a few KB and stops; every timer is cleared and the
  body is cancelled on every path (#539).
- Whether a URL is a station that plays is asked in one place:
  `probeStreamAudio` (`src/lib/stream-audio-probe.js`, #538). It does a small
  GET and reads the bytes (MP3, AAC, Ogg, FLAC); a HEAD answer, a
  Content-Type or a 401 never counts as playable. Use its `reachable`,
  `authorized` and `playableAudio` instead of a new check.
- SomaFM answers 403 to every non-browser client (#542, #549): do not add new
  SomaFM streams (the existing ones are being replaced in #549) and do not
  fake a browser user agent.

## 5. Stations

- `stations.json` is only the seed. The live catalog is the MongoDB
  collection `stations`; without MongoDB the bot falls back to
  `runtime-data/stations.json`. A change to an existing catalog station needs
  an entry in `STATION_CATALOG_MIGRATIONS` (`src/stations-store.js`); check
  that both paths apply it, MongoDB (`applyStationCatalogMigrations`) and the
  file fallback (`migrateStationsFileCatalog`, which applies the same list
  since #549). Both write only where the old URL is still stored, so operator
  edits stay.
- Keys never change: favourites and server settings reference them.
- Prefer https, the highest bitrate the station offers (OmniFM transcodes per
  plan), and URLs without tokens or tracking tails.
- Song titles: adverts are never counted or shown as songs
  (`src/lib/advert-titles.js`, `nowPlayingTrackFields`, #548).

## 6. Checks and known traps

- Options (#553, once merged): `--changed` picks the groups from the files
  you changed (docs only: `repository`), `--fresh` forces a clean `npm ci`;
  the unit suite runs in parallel with one database per test file. See
  `CLAUDE.md`.
- Every setting the code reads is documented in `.env.example`; the local
  check compares them.
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
