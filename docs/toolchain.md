# Node And Frontend Toolchain

This document defines the Node.js and frontend build contract for OmniFM.

## Version Contract

Frontend production builds use Node.js 22.

| Surface | Version | Reason |
| --- | --- | --- |
| Production runtime Docker image | Node.js 22 | Current LTS runtime for the bot, API, dashboard, and worker entrypoints |
| Docker frontend builder | Node.js 22 | Matches the production runtime family and avoids Node 24-only CRA deprecation noise |
| Local production-like frontend build | Node.js 22.x | Reproduces the Docker and CI frontend build path |
| CI syntax and unit matrix | Node.js 22 and 24 | Keeps the maintained runtime green and detects upcoming Node compatibility problems |
| Mongo smoke, CodeQL, live smoke, and recovery checks | Node.js 24 where configured | Exercises scripts against the newer Node line without making it the frontend production build path |

Both root and frontend packages declare:

```json
{
  "type": "module",
  "engines": {
    "node": ">=22 <25"
  }
}
```

The root package and frontend package both run as ES module packages. This keeps
Node 24 tests from reparsing frontend helper modules heuristically.

Use Node.js 22 when rehearsing production updates locally:

```bash
node --version
npm test
npm --prefix frontend run build
```

## CRA Build Warning

The frontend still uses `react-scripts 5.0.1`. On Node.js 24, this toolchain can
emit:

```text
DEP0176: fs.F_OK is deprecated, use fs.constants.F_OK instead
```

That warning comes from the legacy Create React App dependency chain, not from
OmniFM application code. The production frontend build path is pinned to Node.js
22 in Docker, CI, and nightly checks so releases do not depend on the noisier
Node 24 behavior.

Do not patch transitive CRA files inside `node_modules`. The long-term fix is
tracked separately in the frontend modernization issue and should replace
`react-scripts` with the chosen maintained build stack.

## CI Expectations

- `.github/workflows/ci.yml` runs backend/runtime syntax and unit tests on Node
  22 and 24.
- `.github/workflows/ci.yml` builds the frontend on Node 22.
- `.github/workflows/nightly.yml` repeats the frontend build on Node 22.
- `Dockerfile` builds the frontend and runtime image from Node 22 images.

If a future Node line becomes the production target, update this document,
`package.json`, `frontend/package.json`, CI, nightly, Dockerfile, and
`test/github-automation.test.js` in the same change.
