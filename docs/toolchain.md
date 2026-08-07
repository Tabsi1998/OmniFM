# Node And Frontend Toolchain

This document defines the Node.js and frontend build contract for OmniFM.

## Version Contract

Frontend production builds use Node.js 22.

| Surface | Version | Reason |
| --- | --- | --- |
| Production runtime Docker image | Node.js 22 | Current LTS runtime for the bot, API, dashboard, and worker entrypoints |
| Docker frontend builder | Node.js 22 | Matches the production runtime family and avoids Node 24-only CRA deprecation noise |
| Local production-like frontend build | Node.js 22.x | Reproduces the Docker and CI frontend build path |
| CI syntax, unit, Mongo smoke, CodeQL, live smoke, and recovery checks | Node.js 22 | Exercises the exact supported runtime in every release gate |

Both root and frontend packages declare:

```json
{
  "type": "module",
  "engines": {
    "node": ">=22 <23"
  }
}
```

The root package and frontend package both run as ES module packages. This keeps
the package format explicit across runtime and frontend tooling.

Use Node.js 22 when rehearsing production updates locally:

```bash
node --version
npm test
npm --prefix frontend run build
```

## Node 24 And Native Audio Dependencies

Node 24 is outside the supported OmniFM runtime contract. On Windows,
`@discordjs/opus@0.10.0` has no matching prebuilt binary for Node 24, so a clean
`npm ci` falls back to a local C++ build and fails on a normal operator machine.
The root `.npmrc` enables `engine-strict=true` so this is reported immediately;
install Node.js 22.x instead.

Do not re-enable Node 24 in the engine range or CI matrix until the native audio
dependencies ship tested Node-24 Windows prebuilds and `npm ci` succeeds there.

## Native Opus Security And Runtime Check

OmniFM keeps `@discordjs/opus@0.10.0` as the codec implementation because it
is the native Discord voice integration and avoids the performance compromise
of switching the production radio path to a JavaScript fallback. Its package is
MIT licensed. The package currently brings in the unmaintained
`@discordjs/node-pre-gyp` installer, so the root npm `overrides` block pins only
its `tar` dependency to `7.5.22` (BlueOak-1.0.0, Node 18+). This removes the
production audit finding without replacing the codec or weakening the Node 22
runtime contract.

Run the native binding smoke after every dependency or image update:

```bash
npm ci --no-audit --no-fund
npm run test:voice-codec
npm audit --omit=dev --audit-level=high
```

CI runs the encode/decode smoke on both `ubuntu-latest` and `windows-latest`
with Node 22. The Docker CI job also runs it inside the final Linux runtime
image and verifies that FFmpeg accepts a 48 kHz stereo PCM frame. These checks
prove the codec binding and transcode hand-off; a real Discord guild playback
and reconnect rehearsal remains a release-operations check because it requires
an authorized live voice channel.

## CRA Build Warning

The frontend still uses `react-scripts 5.0.1`. On unsupported Node.js 24, this toolchain can
emit:

```text
DEP0176: fs.F_OK is deprecated, use fs.constants.F_OK instead
```

That warning comes from the legacy Create React App dependency chain, not from
OmniFM application code. The production frontend build path is pinned to Node.js
22 in Docker, CI, and nightly checks.

Do not patch transitive CRA files inside `node_modules`. The long-term fix is
tracked separately in the frontend modernization issue and should replace
`react-scripts` with the chosen maintained build stack.

## CI Expectations

- `.github/workflows/ci.yml` runs backend/runtime syntax, unit tests, and Mongo
  smoke checks on Node 22.
- `.github/workflows/ci.yml` builds the frontend on Node 22.
- `.github/workflows/nightly.yml` repeats the supported runtime and frontend
  checks on Node 22.
- `Dockerfile` builds the frontend and runtime image from Node 22 images.

If a future Node line becomes the production target, update this document,
`package.json`, `frontend/package.json`, CI, nightly, Dockerfile, and
`test/github-automation.test.js` only after a clean install and test run succeeds
on every supported deployment platform.
