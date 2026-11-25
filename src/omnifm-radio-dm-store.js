// ============================================================
// OmniFM Radio (#594): what OmniFM keeps per person for the live DMs
// ============================================================
// One document per Discord account in omnifm_radio_dm:
//   unsubscribed   true after "Abbestellen", until the person subscribes again
//   subscribed     true after "Wieder abonnieren" (the opt-in mode sends only to them)
//   lastDmAt       the last DM of a real show (one in 12 hours)
//   lastTestDmAt   the last DM of a test show, counted apart
//   dmClosedUntil  Discord refused the DM (50007/403): left alone until then
//   updatedAt      the last change
//   expiresAt      for someone who neither unsubscribed nor subscribed: 30 days
//                  after the last DM (or the end of closed DMs), then a TTL
//                  index deletes the document; unset for a choice, which stays
// plus the document "last-run" with the numbers of the last distribution.
// /mydata (#285) shows a person's document and deletes it; an unsubscribe
// stays as { _id, unsubscribed: true } so the opt-out is still honoured.
// A DM is claimed before it is sent, in one conditional update, so neither
// a restart nor two runs can send a person two. Without MongoDB (local
// development) it stays in memory; a MongoDB that is configured but not
// connected is an error, never a free pass.
import { getDb, isConnected, isMongoRequested } from "./lib/db.js";

export const OMNIFM_RADIO_DM_COLLECTION = "omnifm_radio_dm";
const LAST_RUN_ID = "last-run";
const SNOWFLAKE = /^\d{17,22}$/;
const QUOTA_FIELDS = Object.freeze({ real: "lastDmAt", test: "lastTestDmAt" });
export const RADIO_DM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
    unsubscribedAt: msOf(doc.unsubscribedAt),
    subscribedAt: msOf(doc.subscribedAt),
    updatedAt: msOf(doc.updatedAt),
    expiresAt: msOf(doc.expiresAt),
  };
}

/** A pipeline value: the expiry, or no field at all for someone who made a choice. */
const expiryUnlessChosen = (expiresAt) => ({
  $cond: [{ $or: [{ $eq: ["$subscribed", true] }, { $eq: ["$unsubscribed", true] }] }, "$$REMOVE", expiresAt],
});
const chosen = (person) => Boolean(person?.subscribed || person?.unsubscribed);

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

  let indexed = false;
  /** The collection, null without MongoDB; throws while MongoDB is away. */
  const collection = () => {
    const db = getDatabase();
    if (!db && mongoRequested()) throw new Error("MongoDB ist nicht verbunden.");
    if (!db) return null;
    const people = db.collection(OMNIFM_RADIO_DM_COLLECTION);
    if (!indexed) {
      indexed = true;
      // The retention: MongoDB deletes a document once its expiresAt is past.
      people.createIndex({ expiresAt: 1 }, { name: "omnifm_radio_dm_expiry", expireAfterSeconds: 0 }).catch(() => { indexed = false; });
    }
    return people;
  };

  const memoryPerson = (id) => memory.get(id) || personFrom({});
  const toMs = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value instanceof Date ? value.getTime() : value]));

  function validId(userId) {
    const id = userIdOf(userId);
    if (!id) throw new Error("Keine gültige Discord-ID.");
    return id;
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
      const expiresAt = now + RADIO_DM_RETENTION_MS;
      if (!people) {
        const person = memory.get(id) || null;
        if (!mayClaim(person, field, { windowMs, now, subscribedOnly })) return false;
        memory.set(id, { ...memoryPerson(id), [field]: now, updatedAt: now, expiresAt: chosen(person) ? null : expiresAt });
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
        const update = [{ $set: { [field]: at, updatedAt: at, expiresAt: expiryUnlessChosen(new Date(expiresAt)) } }];
        const result = await people.updateOne(filter, update, { upsert: !subscribedOnly });
        return result.matchedCount > 0 || result.upsertedCount > 0;
      } catch (error) {
        if (error?.code === 11000) return false;
        throw error;
      }
    },

    /** "Abbestellen" (false) or "Wieder abonnieren" (true): a choice, kept without expiry. */
    async setSubscribed(userId, subscribed, { now = Date.now() } = {}) {
      const id = validId(userId);
      const at = new Date(now);
      const fields = subscribed
        ? { unsubscribed: false, subscribed: true, subscribedAt: at, updatedAt: at }
        : { unsubscribed: true, subscribed: false, unsubscribedAt: at, updatedAt: at };
      const people = collection();
      if (!people) {
        memory.set(id, { ...memoryPerson(id), ...toMs(fields), expiresAt: null });
        return;
      }
      await people.updateOne({ _id: id }, { $set: fields, $unset: { expiresAt: "" } }, { upsert: true });
    },

    /** Discord does not deliver DMs to this person: no new try before `until`. */
    async markDmsClosed(userId, { until, now = Date.now() }) {
      const id = validId(userId);
      const expiresAt = Math.max(until, now + RADIO_DM_RETENTION_MS);
      const people = collection();
      if (!people) {
        const person = memoryPerson(id);
        memory.set(id, { ...person, dmClosedUntil: until, updatedAt: now, expiresAt: chosen(person) ? null : expiresAt });
        return;
      }
      await people.updateOne(
        { _id: id },
        [{ $set: { dmClosedUntil: new Date(until), updatedAt: new Date(now), expiresAt: expiryUnlessChosen(new Date(expiresAt)) } }],
        { upsert: true },
      );
    },

    /**
     * "Delete everything" in /mydata: the person's document goes. Who
     * unsubscribed keeps only that, without any time, so no DM comes again.
     * @returns {Promise<{ found: boolean, keptUnsubscribe: boolean }>}
     */
    async forget(userId) {
      const id = userIdOf(userId);
      if (!id) return { found: false, keptUnsubscribe: false };
      const people = collection();
      const person = people ? personFrom(await people.findOne({ _id: id })) : memory.get(id) || null;
      if (!person) return { found: false, keptUnsubscribe: false };
      if (person.unsubscribed) {
        if (people) await people.replaceOne({ _id: id }, { unsubscribed: true });
        else memory.set(id, { ...personFrom({}), unsubscribed: true });
        return { found: true, keptUnsubscribe: true };
      }
      if (people) await people.deleteOne({ _id: id });
      else memory.delete(id);
      return { found: true, keptUnsubscribe: false };
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

let shared = null;

/** The one store of this process: the distribution and the DM buttons see the same people. */
export function sharedOmnifmRadioDmStore() {
  shared ||= createOmnifmRadioDmStore();
  return shared;
}
