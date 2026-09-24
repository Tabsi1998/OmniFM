// What each bot application last wrote as guild commands, per server (#215).
//
// The guild command sync used to PUT the full command list into every server
// on every run, every 30 minutes, and each worker cleared its commands in
// every server on every start. With the fingerprint of the list per
// application and server, a sync only writes where the list differs.
// MongoDB keeps the fingerprints across restarts; without it they live in
// memory for the lifetime of the process.
import crypto from "node:crypto";

import { getDb, isConnected } from "../lib/db.js";

const COLLECTION = "guild_command_sync";

function commandPayloadHash(commands) {
  return crypto.createHash("sha256").update(JSON.stringify(Array.isArray(commands) ? commands : [])).digest("hex").slice(0, 32);
}

const EMPTY_COMMANDS_HASH = commandPayloadHash([]);

function createCommandFingerprintStore({ getDatabase = getDb, connected = isConnected } = {}) {
  const memory = new Map();
  const key = (applicationId, guildId) => `${applicationId}:${guildId}`;

  return {
    /** Fingerprints known for these servers, as a Map guildId -> hash. */
    async load(applicationId, guildIds = []) {
      const known = new Map();
      for (const guildId of guildIds) {
        const hash = memory.get(key(applicationId, guildId));
        if (hash) known.set(guildId, hash);
      }
      if (known.size === guildIds.length || !connected()) return known;
      try {
        const rows = await getDatabase().collection(COLLECTION)
          .find({ applicationId: String(applicationId) }, { projection: { guildId: 1, hash: 1 } })
          .toArray();
        for (const row of rows) {
          const guildId = String(row.guildId || "");
          if (!guildId || known.has(guildId)) continue;
          known.set(guildId, String(row.hash || ""));
          memory.set(key(applicationId, guildId), String(row.hash || ""));
        }
      } catch {
        // Without the database every server counts as unknown and is written.
      }
      return known;
    },

    async save(applicationId, guildIds = [], hash) {
      const ids = guildIds.map((guildId) => String(guildId)).filter(Boolean);
      for (const guildId of ids) memory.set(key(applicationId, guildId), hash);
      if (!ids.length || !connected()) return;
      const syncedAt = new Date();
      try {
        await getDatabase().collection(COLLECTION).bulkWrite(ids.map((guildId) => ({
          updateOne: {
            filter: { _id: key(applicationId, guildId) },
            update: { $set: { applicationId: String(applicationId), guildId, hash, syncedAt } },
            upsert: true,
          },
        })), { ordered: false });
      } catch {
        // The memory copy still saves the next periodic run in this process.
      }
    },
  };
}

const defaultCommandFingerprintStore = createCommandFingerprintStore();

export {
  EMPTY_COMMANDS_HASH,
  commandPayloadHash,
  createCommandFingerprintStore,
  defaultCommandFingerprintStore,
};
