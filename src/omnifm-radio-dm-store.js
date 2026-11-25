// ============================================================
// OmniFM Radio (#594): what OmniFM keeps per person for the live DMs
// ============================================================
// One document per Discord account in omnifm_radio_dm:
//   unsubscribed   true after "Abbestellen", until the person subscribes again
//   subscribed     true after "Wieder abonnieren" (the opt-in mode sends only to them)
//   lastDmAt       the last DM of a real show (one in 12 hours)
//   lastTestDmAt   the last DM of a test show, counted apart
//   dmClosedUntil  Discord refused the DM (50007/403): left alone until then
// plus the document "last-run" with the numbers of the last distribution.
// A DM is claimed before it is sent, in one conditional update, so neither
// a restart nor two runs can send a person two. Without MongoDB (local
// development) it stays in memory; a MongoDB that is configured but not
// connected is an error, never a free pass.
import { getDb, isConnected, isMongoRequested } from "./lib/db.js";

export const OMNIFM_RADIO_DM_COLLECTION = "omnifm_radio_dm";
const LAST_RUN_ID = "last-run";
const SNOWFLAKE = /^\d{17,22}$/;
const QUOTA_FIELDS = Object.freeze({ real: "lastDmAt", test: "lastTestDmAt" });

const clone = (value) => JSON.parse(JSON.stringify(value));
const msOf = (value) => {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(ms) ? ms : null;
};
const userIdOf = (value) => {
  const id = String(value ?? "").trim();
  return SNOWFLAKE.test(id) ? id : "";
};

function personFrom(doc) {
  if (!doc) return null;
  return {
    unsubscribed: doc.unsubscribed === true,
    subscribed: doc.subscribed === true,
    lastDmAt: msOf(doc.lastDmAt),
    lastTestDmAt: msOf(doc.lastTestDmAt),
    dmClosedUntil: msOf(doc.dmClosedUntil),
  };
}

/** The rule of a claim, for the memory store; MongoDB gets the same as a filter. */
function mayClaim(person, field, { windowMs, now, subscribedOnly }) {
  if (!person) return !subscribedOnly;
  if (person.unsubscribed) return false;
  if (subscribedOnly && !person.subscribed) return false;
  if (person.dmClosedUntil !== null && person.dmClosedUntil > now) return false;
  return person[field] === null || person[field] <= now - windowMs;
}

export function createOmnifmRadioDmStore({
  getDatabase = () => (isConnected() ? getDb() : null),
  mongoRequested = isMongoRequested,
} = {}) {
  const memory = new Map();
  let memoryRun = null;

  /** The collection, null without MongoDB; throws while MongoDB is away. */
  const collection = () => {
    const db = getDatabase();
    if (!db && mongoRequested()) throw new Error("MongoDB ist nicht verbunden.");
    return db ? db.collection(OMNIFM_RADIO_DM_COLLECTION) : null;
  };

  async function update(userId, fields) {
    const id = userIdOf(userId);
    if (!id) throw new Error("Keine gültige Discord-ID.");
    const people = collection();
    if (!people) {
      const person = memory.get(id) || personFrom({});
      memory.set(id, { ...person, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value instanceof Date ? value.getTime() : value])) });
      return;
    }
    await people.updateOne({ _id: id }, { $set: { ...fields, updatedAt: new Date() } }, { upsert: true });
  }

  return {
    /** @returns {Promise<{ unsubscribed: boolean, subscribed: boolean, lastDmAt: number | null, lastTestDmAt: number | null, dmClosedUntil: number | null } | null>} */
    async get(userId) {
      const id = userIdOf(userId);
      if (!id) return null;
      const people = collection();
      if (!people) return memory.has(id) ? { ...memory.get(id) } : null;
      return personFrom(await people.findOne({ _id: id }));
    },

    /**
     * Takes the DM slot of one person: true only when the person may get a
     * DM now (not unsubscribed, DMs not closed, the quota's time over, in
     * opt-in subscribed); the slot is then used. Opt-in never creates a person.
     * @param {string} userId
     * @param {{ quota: "real" | "test", windowMs: number, now: number, subscribedOnly?: boolean }} options
     */
    async claim(userId, { quota, windowMs, now, subscribedOnly = false }) {
      const id = userIdOf(userId);
      const field = QUOTA_FIELDS[quota];
      if (!id || !field || !Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(now)) return false;
      const people = collection();
      if (!people) {
        const person = memory.get(id) || null;
        if (!mayClaim(person, field, { windowMs, now, subscribedOnly })) return false;
        memory.set(id, { ...(person || personFrom({})), [field]: now });
        return true;
      }
      const at = new Date(now);
      const filter = {
        _id: id,
        unsubscribed: { $ne: true },
        $and: [
          { $or: [{ dmClosedUntil: null }, { dmClosedUntil: { $lte: at } }] },
          { $or: [{ [field]: null }, { [field]: { $lte: new Date(now - windowMs) } }] },
        ],
        ...(subscribedOnly ? { subscribed: true } : {}),
      };
      try {
        // A person who does not match makes the upsert insert a second _id: that is the "no".
        const result = await people.updateOne(filter, { $set: { [field]: at, updatedAt: at } }, { upsert: !subscribedOnly });
        return result.matchedCount > 0 || result.upsertedCount > 0;
      } catch (error) {
        if (error?.code === 11000) return false;
        throw error;
      }
    },

    /** "Abbestellen" (false) or "Wieder abonnieren" (true). */
    setSubscribed(userId, subscribed, { now = Date.now() } = {}) {
      const at = new Date(now);
      return update(userId, subscribed
        ? { unsubscribed: false, subscribed: true, subscribedAt: at }
        : { unsubscribed: true, subscribed: false, unsubscribedAt: at });
    },

    /** Discord does not deliver DMs to this person: no new try before `until`. */
    markDmsClosed(userId, { until }) {
      return update(userId, { dmClosedUntil: new Date(until) });
    },

    async saveLastRun(run) {
      const people = collection();
      if (!people) {
        memoryRun = clone(run);
        return;
      }
      await people.updateOne({ _id: LAST_RUN_ID }, { $set: { run: clone(run), updatedAt: new Date() } }, { upsert: true });
    },

    async loadLastRun() {
      const people = collection();
      if (!people) return memoryRun ? clone(memoryRun) : null;
      return (await people.findOne({ _id: LAST_RUN_ID }))?.run ?? null;
    },
  };
}
