// ============================================================
// OmniFM: a small state object in MongoDB, written field by field (#292)
// ============================================================
// The bot list stores (top.gg, discordbotlist, bots.gg) are one small object
// each. Since #290 two processes write them: the commander's sync loops and
// the public entry's webhooks, each into other fields. In MongoDB the object
// is one document in provider_state, and a save sets only the fields that
// changed, so neither overwrites what the other wrote. Reads come from a
// cache refreshed every few seconds. Without MongoDB (development) the JSON
// file stays the store, exactly as before.
import fs from "node:fs";
import { getDb, isConnected } from "./db.js";
import { log } from "./logging.js";

const COLLECTION = "provider_state";
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * @param {{ id: string, file: string, emptyState: () => object, normalize: (raw: any) => object }} options
 */
export function createStateDocumentStore({ id, file, emptyState, normalize }) {
  let active = false;
  let cache = null;
  let refreshTimer = null;
  let writesPending = 0;
  let writeQueue = Promise.resolve();

  function readFile() {
    try {
      if (!fs.existsSync(file)) return emptyState();
      if (fs.statSync(file).isDirectory()) return emptyState();
      const raw = fs.readFileSync(file, "utf8");
      if (!raw.trim()) return emptyState();
      return normalize(JSON.parse(raw));
    } catch {
      return emptyState();
    }
  }

  function writeFile(normalized) {
    const tempPath = `${file}.tmp-${process.pid}-${Date.now()}`;
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    try {
      fs.writeFileSync(tempPath, serialized, "utf8");
      try {
        fs.renameSync(tempPath, file);
      } catch (renameErr) {
        const code = String(renameErr?.code || "");
        if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) fs.writeFileSync(file, serialized, "utf8");
        else throw renameErr;
      }
    } catch {
      // ignore store write failures
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup failures
      }
    }
  }

  async function refresh() {
    if (!active || !isConnected() || writesPending > 0) return;
    const doc = await getDb().collection(COLLECTION).findOne({ _id: id });
    if (writesPending > 0) return;
    const { _id, ...fields } = doc || {};
    cache = normalize(fields);
  }

  /** The current state (a copy). */
  function load() {
    if (active && cache) return clone(cache);
    return readFile();
  }

  /** Saves the state; with MongoDB only the fields that changed. Returns the normalized state. */
  function save(state) {
    const normalized = normalize(state);
    if (!active) {
      writeFile(normalized);
      return normalized;
    }
    const before = cache || emptyState();
    const changed = {};
    for (const [key, value] of Object.entries(normalized)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(value)) changed[key] = value;
    }
    cache = clone(normalized);
    if (Object.keys(changed).length) {
      writesPending += 1;
      writeQueue = writeQueue
        .then(async () => {
          if (isConnected()) await getDb().collection(COLLECTION).updateOne({ _id: id }, { $set: changed }, { upsert: true });
        })
        .catch((err) => log("ERROR", `[${id}] MongoDB-Speichern fehlgeschlagen: ${err?.message || err}`))
        .finally(() => { writesPending = Math.max(0, writesPending - 1); });
    }
    return normalized;
  }

  /** MongoDB becomes the store; a state left in the JSON file is copied once. */
  async function init({ refreshMs = 5000 } = {}) {
    if (!isConnected() || !getDb()) return { backend: "file" };
    const collection = getDb().collection(COLLECTION);
    if (!(await collection.findOne({ _id: id }, { projection: { _id: 1 } })) && fs.existsSync(file)) {
      await collection.updateOne({ _id: id }, { $setOnInsert: readFile() }, { upsert: true });
      log("INFO", `[${id}] Zustand aus ${file} nach MongoDB übernommen.`);
    }
    active = true;
    await refresh();
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        refresh().catch((err) => log("WARN", `[${id}] MongoDB-Refresh fehlgeschlagen: ${err?.message || err}`));
      }, Math.max(1000, Number(refreshMs) || 5000));
      refreshTimer.unref?.();
    }
    return { backend: "mongo" };
  }

  async function stop() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    await writeQueue.catch(() => null);
  }

  return { load, save, init, stop };
}
