// Built-in catalog migrations for the 12 Nov 2026 catalog clean-up (#549):
// SomaFM stations replaced (SomaFM blocks non-browser clients), http:// streams
// moved to https://, path remnants and ?ref= tails dropped, expiring token removed.
//
// The rows live in station-catalog-migrations.json, so the FastAPI fallback
// (backend/services/catalog.py) applies exactly the same list. Generated from the
// before/after of stations.json. Row format:
//   [key, fromUrl, toUrl]                    only the URL changes
//   [key, fromUrl, toUrl, set, unset]        station replaced: extra fields to set / to remove
// stations-store.js turns each row into one migration with its own marker, so a
// row runs once and only touches a row whose URL still equals fromUrl.

import fs from "node:fs";

const ROWS = JSON.parse(fs.readFileSync(new URL("./station-catalog-migrations.json", import.meta.url), "utf8"));

function catalogKeys(key) {
  // MongoDB stores the sanitized key (lowercase a-z0-9), the seed file the raw one.
  const sanitized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sanitized === key ? [key] : [sanitized, key];
}

export const CATALOG_549_MIGRATIONS = Object.freeze(ROWS.map(([key, fromUrl, toUrl, set, unset]) => Object.freeze({
  id: `2026-11-12-catalog-549-${key}`,
  key: catalogKeys(key)[0],
  keys: Object.freeze(catalogKeys(key)),
  fromUrl,
  toUrl,
  ...(set ? { set: Object.freeze({ ...set }) } : {}),
  ...(unset?.length ? { unset: Object.freeze([...unset]) } : {}),
})));
