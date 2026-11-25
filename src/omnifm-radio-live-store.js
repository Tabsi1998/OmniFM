// ============================================================
// OmniFM Radio (#592): the live state in MongoDB
// ============================================================
// One document: the current state, the last shows, the last test shows and
// what the state machine tracks. Only the commander (or the monolith) writes
// it, through src/services/omnifm-radio-live.js.
// Without MongoDB (local development) it stays in memory.
import { getDb, isConnected } from "./lib/db.js";

export const OMNIFM_RADIO_LIVE_COLLECTION = "omnifm_radio_live";
const DOC_ID = "state";

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createOmnifmRadioLiveStore({ getDatabase = () => (isConnected() ? getDb() : null) } = {}) {
  let memory = null;
  return {
    /** @returns {Promise<{ current: any, shows: any[], testShows: any[], track: any } | null>} */
    async load() {
      const db = getDatabase();
      if (!db) return memory ? clone(memory) : null;
      const doc = await db.collection(OMNIFM_RADIO_LIVE_COLLECTION).findOne({ _id: DOC_ID });
      return doc ? { current: doc.current ?? null, shows: doc.shows ?? [], testShows: doc.testShows ?? [], track: doc.track ?? null } : null;
    },
    /** @param {{ current: any, shows: any[], testShows?: any[], track?: any }} state */
    async save({ current, shows, testShows = [], track = null }) {
      memory = clone({ current, shows, testShows, track });
      const db = getDatabase();
      if (!db) return;
      await db.collection(OMNIFM_RADIO_LIVE_COLLECTION).updateOne(
        { _id: DOC_ID },
        { $set: { current, shows, testShows, track, updatedAt: new Date().toISOString() } },
        { upsert: true },
      );
    },
  };
}
