# OmniFM Store Concurrency

This document defines the runtime ownership model for mutating stores. It is the reference for split commander/worker deployments.

## Split Rule

Split mode must run with MongoDB available. Commander and worker entrypoints call the shared startup diagnostics and refuse split startup when MongoDB is required but unavailable.

File-backed JSON stores remain useful for local development, migration, diagnostics, and monolith deployments. In split mode, global JSON files must not become a multi-writer source of truth.

## Store Ownership

| Store | Files | Scope | Split owner | Protection |
| --- | --- | --- | --- | --- |
| Bot state | `bot-state/<botId>.json`, legacy `bot-state.json` | Per bot in split mode | Owning commander/worker | Split files per bot plus legacy migration |
| Song history | `song-history/<botId>.json`, legacy `song-history.json` | Per bot in split mode | Owning commander/worker | Split files per bot plus legacy migration |
| Dashboard sessions/OAuth/telemetry | `dashboard.json` | Global | Commander/API | Inter-process file lock around mutating dashboard writes |
| Premium/licenses/Stripe dedupe | `premium.json` | Global | Commander/API/payment | Workers read; commander owns mutations |
| Custom stations | `custom-stations.json` | Global | Commander/API | Runtime mutations go through commander/dashboard |
| Scheduled events | `scheduled-events.json` | Global | Commander/API | Event scheduling runs through commander/dashboard |
| Command permissions | `command-permissions.json` | Global | Commander/API | Permission writes run through commander commands/dashboard |
| Listening stats | `listening-stats.json`, Mongo collections | Global analytics | MongoDB in split mode | MongoDB is source of truth; JSON is migration/local fallback |
| Stations catalog | `stations.json`, Mongo-backed catalog when enabled | Global catalog | Commander/admin or CLI maintenance | Do not run station CLI writes while split containers are active |
| Coupons/offers | `coupons.json` | Global billing/offers | Commander/API or CLI maintenance | Checkout/admin mutations belong to commander path |
| Provider directories | `discordbotlist.json`, `botsgg.json`, `topgg.json`, `vote-events.json` | Global provider sync | Commander sync process | Provider sync loops run in commander |
| Incidents | `operator-incidents.json`, `runtime-incidents.json`, Mongo where available | Diagnostics | MongoDB where available, otherwise process fallback | Runtime incidents prefer MongoDB; operator incidents are diagnostic fallback data |
| Guild languages | `guild-languages.json` | Global legacy language fallback | Commander/command process | Legacy fallback; language resolution is normalized at runtime |

The same classification is mirrored in `src/lib/store-concurrency.js` and covered by tests.

## Operational Rules

- Do not run write-capable CLI tools against shared JSON files while split containers are running.
- Keep MongoDB healthy before starting split workers. If MongoDB is not connected, split startup fails instead of silently falling back to shared JSON.
- Treat shared JSON files in split mode as fallback, migration, or commander-owned data, not as a safe general-purpose multi-writer database.
- If a new store is added, document its scope, owner, split safety, and protection in this document and in `STORE_CONCURRENCY_REGISTRY`.
- If a global store needs worker-side writes, use MongoDB, an inter-process file lock around the complete read/modify/write transaction, or a versioned compare-and-retry strategy.

## Current Lock Coverage

`dashboard.json` uses `src/lib/file-store-lock.js` for mutating session, OAuth, and telemetry writes. The lock covers the complete read/modify/write transaction and reloads the latest file contents while the lock is held.

The concurrency test `test/dashboard-store.test.js` starts two separate Node.js processes writing OAuth state into the same dashboard file and verifies that all writes remain present.
