// ============================================================
// OmniFM Radio (#593): the live announcements in MongoDB
// ============================================================
// One document per show and server, claimed BEFORE OmniFM 1 sends: the
// claim is atomic, so two commander processes never post twice, and it
// counts for the limit of one announcement per server in two hours even
// while the message is on its way. The message id is filled in after
// sending, by the commander and by the worker itself, so a post that
// outlives a bridge timeout is still edited when the show ends. A claim is
// released only when certainly nothing was sent (no channel, no rights).
// Test shows are kept for their end but never count for the limit.
// Entries expire after a week. Without MongoDB (local development) it stays
// in memory; a MongoDB that is configured but not connected is an error, so
// the limit is never skipped.
import { getDb, isConnected, isMongoRequested } from "./lib/db.js";

export const OMNIFM_RADIO_ANNOUNCE_COLLECTION = "omnifm_radio_announcements";
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const docId = ({ showId, guildId }) => `${showId}|${guildId}`;

function fromDoc(doc) {
  return {
    showId: doc.showId,
    guildId: doc.guildId,
    botId: doc.botId || null,
    test: doc.test === true,
    show: doc.show || {},
    channelId: doc.channelId || null,
    messageId: doc.messageId || null,
    claimedAt: new Date(doc.claimedAt),
    postedAt: doc.postedAt ? new Date(doc.postedAt) : null,
    endedAt: doc.endedAt ? new Date(doc.endedAt) : null,
  };
}

const isDuplicateKey = (error) => error?.code === 11000;

/**
 * @param {{ getDatabase?: () => any, mongoRequested?: () => boolean, collectionName?: string }} [options]
 */
export function createOmnifmRadioAnnounceStore({
  getDatabase = () => (isConnected() ? getDb() : null),
  mongoRequested = isMongoRequested,
  collectionName = OMNIFM_RADIO_ANNOUNCE_COLLECTION,
} = {}) {
  const memory = new Map();
  let indexed = null;

  /** The collection, null without MongoDB; throws while MongoDB is away. */
  async function collection() {
    const db = getDatabase();
    if (!db) {
      if (mongoRequested()) throw new Error("MongoDB ist nicht verbunden.");
      return null;
    }
    const announcements = db.collection(collectionName);
    indexed ||= Promise.all([
      announcements.createIndex({ guildId: 1, test: 1, claimedAt: -1 }, { name: "guild_claimed" }),
      announcements.createIndex({ showId: 1 }, { name: "show" }),
      announcements.createIndex({ endedAt: 1 }, { name: "open" }),
      announcements.createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
    ]).catch(() => { indexed = null; });
    await indexed;
    return announcements;
  }

  return {
    /**
     * Claims the announcement of one show on one server before it is sent.
     * True only for the one caller that created the claim.
     * @param {{ showId: string, guildId: string, botId?: string | null, test?: boolean, show?: any, at: Date }} entry
     */
    async claim({ showId, guildId, botId = null, test = false, show = {}, at }) {
      const doc = {
        showId,
        guildId,
        botId,
        test: test === true,
        show: {
          streamerName: String(show?.streamerName || ""),
          title: String(show?.title || ""),
          startedAt: show?.startedAt || null,
          source: show?.source || null,
        },
        claimedAt: at,
        channelId: null,
        messageId: null,
        postedAt: null,
        endedAt: null,
        expiresAt: new Date(at.getTime() + KEEP_MS),
      };
      const announcements = await collection();
      const id = docId({ showId, guildId });
      if (!announcements) {
        if (memory.has(id)) return false;
        memory.set(id, doc);
        return true;
      }
      try {
        const result = await announcements.updateOne({ _id: id }, { $setOnInsert: doc }, { upsert: true });
        return result.upsertedCount === 1;
      } catch (error) {
        // Two upserts at the same moment: the other one won.
        if (isDuplicateKey(error)) return false;
        throw error;
      }
    },

    /** Where the message went; written by the commander and by the worker that sent it. */
    async setMessage(key, { channelId, messageId, at }) {
      const update = { channelId: String(channelId), messageId: String(messageId), postedAt: at };
      const announcements = await collection();
      if (!announcements) {
        const doc = memory.get(docId(key));
        if (doc) Object.assign(doc, update);
        return;
      }
      await announcements.updateOne({ _id: docId(key) }, { $set: update });
    },

    /** Certainly nothing was sent: the claim goes, unless a message id arrived meanwhile. */
    async release(key) {
      const announcements = await collection();
      if (!announcements) {
        if (!memory.get(docId(key))?.messageId) memory.delete(docId(key));
        return;
      }
      await announcements.deleteOne({ _id: docId(key), messageId: null });
    },

    /** When the server last got (or is getting) an announcement of a real show (ms), or null. */
    async lastPostedAt(guildId) {
      const announcements = await collection();
      if (!announcements) {
        const times = [...memory.values()].filter((doc) => doc.guildId === guildId && !doc.test).map((doc) => doc.claimedAt.getTime());
        return times.length ? Math.max(...times) : null;
      }
      const doc = await announcements.findOne({ guildId, test: false }, { sort: { claimedAt: -1 }, projection: { claimedAt: 1 } });
      return doc ? new Date(doc.claimedAt).getTime() : null;
    },

    /** The announcements of one show that still say "live" (or wait for their id). */
    async listForShow(showId) {
      const announcements = await collection();
      const docs = announcements
        ? await announcements.find({ showId, endedAt: null }).toArray()
        : [...memory.values()].filter((doc) => doc.showId === showId && !doc.endedAt);
      return docs.map(fromDoc);
    },

    /** Every announcement that still says "live", of any show. */
    async listOpen() {
      const announcements = await collection();
      const docs = announcements
        ? await announcements.find({ endedAt: null }).toArray()
        : [...memory.values()].filter((doc) => !doc.endedAt);
      return docs.map(fromDoc);
    },

    /** The message was edited to "show over" (or could not be): done. */
    async markEnded(key, endedAt) {
      const announcements = await collection();
      if (!announcements) {
        const doc = memory.get(docId(key));
        if (doc) doc.endedAt = endedAt;
        return;
      }
      await announcements.updateOne({ _id: docId(key) }, { $set: { endedAt } });
    },
  };
}
