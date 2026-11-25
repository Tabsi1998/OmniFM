// ============================================================
// OmniFM Radio (#593): the posted live announcements in MongoDB
// ============================================================
// One document per show and server: where OmniFM 1 posted the message, so
// the end of the show edits it, also after a restart; and when, for the
// limit of one announcement per server in two hours. Test shows are kept
// too (their end edits the message) but never count for the limit.
// Entries expire after a week. Only the commander (or the monolith) writes.
// Without MongoDB (local development) it stays in memory; a MongoDB that is
// configured but not connected is an error, so the limit is never skipped.
import { getDb, isConnected, isMongoRequested } from "./lib/db.js";

export const OMNIFM_RADIO_ANNOUNCE_COLLECTION = "omnifm_radio_announcements";
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const docId = (showId, guildId) => `${showId}|${guildId}`;

function fromDoc(doc) {
  return {
    showId: doc.showId,
    guildId: doc.guildId,
    botId: doc.botId || null,
    channelId: doc.channelId,
    messageId: doc.messageId,
    test: doc.test === true,
    postedAt: new Date(doc.postedAt),
    endedAt: doc.endedAt ? new Date(doc.endedAt) : null,
  };
}

export function createOmnifmRadioAnnounceStore({
  getDatabase = () => (isConnected() ? getDb() : null),
  mongoRequested = isMongoRequested,
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
    const announcements = db.collection(OMNIFM_RADIO_ANNOUNCE_COLLECTION);
    indexed ||= Promise.all([
      announcements.createIndex({ guildId: 1, test: 1, postedAt: -1 }, { name: "guild_posted" }),
      announcements.createIndex({ showId: 1 }, { name: "show" }),
      announcements.createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
    ]).catch(() => { indexed = null; });
    await indexed;
    return announcements;
  }

  return {
    /** @param {{ showId: string, guildId: string, botId?: string | null, channelId: string, messageId: string, test?: boolean, postedAt: Date }} entry */
    async record({ showId, guildId, botId = null, channelId, messageId, test = false, postedAt }) {
      const doc = {
        showId,
        guildId,
        botId,
        channelId,
        messageId,
        test: test === true,
        postedAt,
        endedAt: null,
        expiresAt: new Date(postedAt.getTime() + KEEP_MS),
      };
      const announcements = await collection();
      if (!announcements) {
        memory.set(docId(showId, guildId), doc);
        return;
      }
      await announcements.updateOne({ _id: docId(showId, guildId) }, { $set: doc }, { upsert: true });
    },

    /** When the server last got an announcement of a real show (ms), or null. */
    async lastPostedAt(guildId) {
      const announcements = await collection();
      if (!announcements) {
        const times = [...memory.values()].filter((doc) => doc.guildId === guildId && !doc.test).map((doc) => doc.postedAt.getTime());
        return times.length ? Math.max(...times) : null;
      }
      const doc = await announcements.findOne({ guildId, test: false }, { sort: { postedAt: -1 }, projection: { postedAt: 1 } });
      return doc ? new Date(doc.postedAt).getTime() : null;
    },

    /** The messages of one show that still say "live". */
    async listForShow(showId) {
      const announcements = await collection();
      const docs = announcements
        ? await announcements.find({ showId, endedAt: null }).toArray()
        : [...memory.values()].filter((doc) => doc.showId === showId && !doc.endedAt);
      return docs.map(fromDoc);
    },

    /** The message was edited to "show over" (or could not be): done. */
    async markEnded({ showId, guildId }, endedAt) {
      const announcements = await collection();
      if (!announcements) {
        const doc = memory.get(docId(showId, guildId));
        if (doc) doc.endedAt = endedAt;
        return;
      }
      await announcements.updateOne({ _id: docId(showId, guildId) }, { $set: { endedAt } });
    },
  };
}
