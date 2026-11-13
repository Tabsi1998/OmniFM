// Built-in catalog migrations for the 12 Nov 2026 catalog clean-up (#549):
// SomaFM stations replaced (SomaFM blocks non-browser clients), http:// streams
// moved to https://, path remnants and ?ref= tails dropped, expiring token removed.
//
// The rows live in station-catalog-migrations.json, so the FastAPI fallback
// (backend/services/catalog.py) applies exactly the same list. Generated from the
// before/after of stations.json. Row format:
//   [key, fromUrl, toUrl]                    only the URL changes
//   [key, fromUrl, toUrl, set, unset]        station replaced: extra fields to set / to remove
//   [key, fromUrl, toUrl, set, unset, "561"] a later round (#561, 13 Nov 2026): its own id series,
//                                            so it also runs where the #549 rows are already marked
// stations-store.js turns each row into one migration with its own marker, so a
// row runs once and only touches a row whose URL still equals fromUrl.

import fs from "node:fs";

const ROWS = JSON.parse(fs.readFileSync(new URL("./station-catalog-migrations.json", import.meta.url), "utf8"));

function catalogKeys(key) {
  // MongoDB stores the sanitized key (lowercase a-z0-9), the seed file the raw one.
  const sanitized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sanitized === key ? [key] : [sanitized, key];
}

function toMigration([key, fromUrl, toUrl, set, unset, series]) {
  return Object.freeze({
    id: series === "561" ? `2026-11-13-catalog-561-${key}` : `2026-11-12-catalog-549-${key}`,
    key: catalogKeys(key)[0],
    keys: Object.freeze(catalogKeys(key)),
    fromUrl,
    toUrl,
    ...(set ? { set: Object.freeze({ ...set }) } : {}),
    ...(unset?.length ? { unset: Object.freeze([...unset]) } : {}),
  });
}

export const CATALOG_549_MIGRATIONS = Object.freeze(ROWS.filter((row) => row[5] !== "561").map(toMigration));
// #561: the Hardcore Radio stream only answers 401, replaced by Happy Hardcore.
export const CATALOG_561_MIGRATIONS = Object.freeze(ROWS.filter((row) => row[5] === "561").map(toMigration));
