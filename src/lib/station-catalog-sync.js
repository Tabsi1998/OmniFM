// ============================================================
// OmniFM: what every deployment does to the database before the switch
// ============================================================
// Until #291 importing FastAPI did this as a side effect of start.sh's
// preflight. Now scripts/database.mjs runs it, once per start, before the
// running version is stopped:
//   - an empty station catalogue in MongoDB gets the shipped stations.json,
//     so the owner console lists and edits the same stations the bot plays
//   - stations already stored get the catalogue fields of stations.json the
//     owner left empty, and the stream and name fixes below where the old
//     value is still stored, so an owner's own change stays
//   - demo licences of old test setups (keys "demo-...") are removed
import { normalizeStationCatalogFields } from "./station-fields.js";

export const CATALOG_FIELDS = Object.freeze(["genre", "country", "language", "color", "logo", "homepage"]);

// Streams the catalogue audit of 2026-09-25 found dead or playing something
// else (#267): key -> [old URL, new URL].
export const REPLACED_STREAMS = Object.freeze({
  pro_edm_06: ["https://streams.ilovemusic.de/iloveradio103.mp3", "https://stream.technolovers.fm/edm"],
  pro_tech_15: ["http://lw2.mp3.tb-group.fm/tb.mp3", "https://streams.rautemusik.fm/harder/mp3-192/"],
  pro_tech_20: ["https://ice4.somafm.com/scanner-128-mp3", "https://stream.technolovers.fm/dark-techno"],
  pro_house_06: ["https://ice4.somafm.com/7soul-128-mp3", "https://streams.rautemusik.fm/house/mp3-192/"],
  pro_house_12: ["https://radio.edm1.fm/proxy/15_clubhouse?mp=/stream", "http://radio.edm1.fm/proxy/15_clubhouse?mp=/stream"],
});

// Decisions of #325 on streams that only roughly matched their name:
// key -> { field: [old, new] }.
export const CATALOG_CORRECTIONS = Object.freeze({
  technoradio: { name: ["Techno Radio", "Dance Radio"] },
  pro_tech_19: { name: ["Minimal Grooves", "IDM & Glitch"] },
  pro_urban_14: { name: ["Chill R&B", "2000er Hits"], genre: ["R&B", "Pop & Charts"], color: ["#A855F7", "#EC4899"] },
  pro_tech_16: { name: ["Deep Underground", "Deep Tech House"], genre: ["Techno", "House"], color: ["#7C3AED", "#06B6D4"] },
  reggaeradio: { url: ["http://streams.bigfm.de/bigfm-reggaevibes-128-mp3", "https://ice1.somafm.com/reggae-128-mp3"], country: ["DE", "US"] },
  // These two played the stream of another catalogue station; now what their name says.
  pro_urban_04: { url: ["http://streams.bigfm.de/bigfm-rapfeature-128-mp3?usid=0-0-H-M-D-60", "https://stream.laut.fm/drill"], language: ["de", ""] },
  pro_hard_06: { url: ["http://mp3.stream.tb-group.fm/hb.mp3?", "https://stream.laut.fm/hardstyle"], country: ["DE", ""] },
});

const text = (value) => String(value ?? "").trim();

/**
 * What a stations.json entry adds to a stored station: the catalogue fields
 * the owner has not set (genre "Radio" counts as unset), a replaced stream
 * where the stored URL is the broken one, the #325 fixes where the old value
 * is still stored.
 * @param {Record<string, any>} doc
 * @param {Record<string, any>} fileStation
 */
export function catalogUpdatesFor(doc, fileStation) {
  /** @type {Record<string, string>} */
  const updates = {};
  const wanted = normalizeStationCatalogFields(fileStation || {});
  for (const field of CATALOG_FIELDS) {
    const current = field === "genre" && ["", "Radio"].includes(text(doc[field])) ? "" : doc[field];
    if (!current && wanted[field] && wanted[field] !== doc[field]) updates[field] = wanted[field];
  }
  const key = text(doc.key);
  const replacement = Object.hasOwn(REPLACED_STREAMS, key) ? REPLACED_STREAMS[key] : null;
  if (replacement && text(doc.url) === replacement[0]) updates.url = replacement[1];
  const corrections = Object.hasOwn(CATALOG_CORRECTIONS, key) ? CATALOG_CORRECTIONS[key] : {};
  for (const [field, [before, after]] of Object.entries(corrections)) {
    if (text(doc[field]) === before) updates[field] = after;
  }
  return updates;
}

/**
 * An empty catalogue gets the shipped stations; a filled one stays as it is.
 * @returns {Promise<number>} how many stations were added
 */
export async function seedStationsIfEmpty(db, fileData, { now = new Date() } = {}) {
  const stations = db.collection("stations");
  if (await stations.countDocuments({}, { limit: 1 }) > 0) return 0;
  const entries = Object.entries(fileData?.stations || {});
  if (!entries.length) return 0;
  const createdAt = now.toISOString();
  // Upserts by key: two starts at once still leave each station once.
  const result = await stations.bulkWrite(entries.map(([key, station]) => ({
    updateOne: {
      filter: { key },
      update: {
        $setOnInsert: {
          key,
          name: station.name || key,
          url: station.url || "",
          tier: station.tier || "free",
          ...normalizeStationCatalogFields(station),
          is_default: key === fileData.defaultStationKey,
          created_at: createdAt,
        },
      },
      upsert: true,
    },
  })), { ordered: false });
  return Number(result?.upsertedCount || 0);
}

/**
 * The catalogue fields and fixes of catalogUpdatesFor() for the stations
 * already stored. Changes nothing once everything is filled.
 * @returns {Promise<number>} how many stations were changed
 */
export async function fillStationCatalogFields(db, fileData, { now = new Date() } = {}) {
  const fileStations = fileData?.stations || {};
  const keys = Object.keys(fileStations);
  if (!keys.length) return 0;
  const stations = db.collection("stations");
  let changed = 0;
  for (const doc of await stations.find({ key: { $in: keys } }).toArray()) {
    const updates = catalogUpdatesFor(doc, fileStations[doc.key]);
    if (!Object.keys(updates).length) continue;
    // eslint-disable-next-line no-await-in-loop -- a handful of stations, once per start
    await stations.updateOne({ _id: doc._id }, { $set: { ...updates, updated_at: now.toISOString() } });
    changed += 1;
  }
  return changed;
}

/**
 * Removes the demo licences, entitlements and sessions of old test setups.
 * Real licence keys start with OMNI-, so nothing else matches.
 * @returns {Promise<number>} how many licences were removed
 */
export async function purgeDemoData(db) {
  const demo = { $regex: "^demo-", $options: "i" };
  const removed = await db.collection("licenses").deleteMany({ _licenseId: demo });
  await db.collection("server_entitlements").deleteMany({ _serverId: demo });
  await db.collection("processed_sessions").deleteMany({ _sessionId: demo });
  return Number(removed?.deletedCount || 0);
}
