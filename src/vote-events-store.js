import fs from "node:fs";
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STATE_FILE = resolveRuntimeDataPath("vote-events.json");
const MAX_STORED_VOTE_EVENTS = 1000;
const SUPPORTED_PROVIDERS = new Set(["discordbotlist", "topgg"]);

function emptyProviderState() {
  return {
    totalVotes: 0,
    lastVoteAt: null,
    lastReceivedAt: null,
  };
}

function buildEmptyProvidersState() {
  return {
    discordbotlist: emptyProviderState(),
    topgg: emptyProviderState(),
  };
}

function emptyState() {
  return {
    version: 1,
    totalVotes: 0,
    votes: [],
    providers: buildEmptyProvidersState(),
  };
}

function normalizeIso(rawValue, fallback = new Date().toISOString()) {
  const value = String(rawValue || "").trim();
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeProvider(rawValue) {
  const provider = String(rawValue || "").trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(provider) ? provider : null;
}

function normalizeProviderState(rawState) {
  const input = rawState && typeof rawState === "object" ? rawState : {};
  return {
    totalVotes: Math.max(0, Number.parseInt(String(input.totalVotes || 0), 10) || 0),
    lastVoteAt: input.lastVoteAt ? normalizeIso(input.lastVoteAt) : null,
    lastReceivedAt: input.lastReceivedAt ? normalizeIso(input.lastReceivedAt) : null,
  };
}

function normalizeVoteEvent(rawVote) {
  if (!rawVote || typeof rawVote !== "object") return null;

  const provider = normalizeProvider(rawVote.provider);
  if (!provider) return null;

  const userId = String(
    rawVote.userId
      || rawVote.platformUserId
      || rawVote.discordUserId
      || ""
  ).trim();
  if (!/^\d{17,22}$/.test(userId)) return null;

  const voteId = String(rawVote.voteId || rawVote.providerVoteId || rawVote.id || "").trim().slice(0, 120) || null;
  const votedAt = normalizeIso(
    rawVote.votedAt
      || rawVote.createdAt
      || rawVote.timestamp
  );
  const receivedAt = normalizeIso(rawVote.receivedAt);
  const key = String(rawVote.key || "").trim().slice(0, 180)
    || (voteId ? `${provider}:${voteId}` : `${provider}:${userId}:${votedAt}`);

  return {
    key,
    provider,
    voteId,
    projectId: String(rawVote.projectId || "").trim().slice(0, 40) || null,
    botId: String(rawVote.botId || "").trim().slice(0, 40) || null,
    userId,
    providerUserId: String(rawVote.providerUserId || rawVote.user_id || "").trim().slice(0, 40) || null,
    username: String(rawVote.username || userId).trim().slice(0, 120) || userId,
    avatarUrl: String(rawVote.avatarUrl || rawVote.avatar || "").trim().slice(0, 500) || null,
    source: String(rawVote.source || "webhook").trim().slice(0, 40) || "webhook",
    weight: Math.max(1, Number.parseInt(String(rawVote.weight || 1), 10) || 1),
    votedAt,
    expiresAt: rawVote.expiresAt ? normalizeIso(rawVote.expiresAt) : null,
    receivedAt,
  };
}

function normalizeState(rawState) {
  const input = rawState && typeof rawState === "object" ? rawState : {};
  const providers = buildEmptyProvidersState();

  for (const provider of SUPPORTED_PROVIDERS) {
    providers[provider] = normalizeProviderState(input.providers?.[provider]);
  }

  const seenKeys = new Set();
  const votes = Array.isArray(input.votes)
    ? input.votes
      .map((vote) => normalizeVoteEvent(vote))
      .filter((vote) => {
        if (!vote) return false;
        if (seenKeys.has(vote.key)) return false;
        seenKeys.add(vote.key);
        return true;
      })
    : [];

  votes.sort((a, b) => {
    const aTime = new Date(a.votedAt || a.receivedAt).getTime();
    const bTime = new Date(b.votedAt || b.receivedAt).getTime();
    return bTime - aTime;
  });

  for (const provider of SUPPORTED_PROVIDERS) {
    const providerVotes = votes.filter((vote) => vote.provider === provider);
    providers[provider].totalVotes = Math.max(providers[provider].totalVotes, providerVotes.length);
    if (!providers[provider].lastVoteAt && providerVotes[0]?.votedAt) {
      providers[provider].lastVoteAt = providerVotes[0].votedAt;
    }
    if (!providers[provider].lastReceivedAt && providerVotes[0]?.receivedAt) {
      providers[provider].lastReceivedAt = providerVotes[0].receivedAt;
    }
  }

  const totalVotes = Math.max(
    Number.parseInt(String(input.totalVotes || 0), 10) || 0,
    Object.values(providers).reduce((sum, providerState) => sum + providerState.totalVotes, 0)
  );

  return {
    version: 1,
    totalVotes,
    votes: votes.slice(0, MAX_STORED_VOTE_EVENTS),
    providers,
  };
}

// ---- MongoDB (#292) ----
// Votes arrive through the webhooks of the public entry and through the
// commander's sync loops since #290. In MongoDB every vote is its own
// document in vote_events (unique key), and vote_counters holds the totals
// per provider, raised with $inc only when a vote really is new. Two
// processes that see the same vote count it once. Reads come from a cache
// refreshed every few seconds; without MongoDB vote-events.json stays the store.
const EVENTS = "vote_events";
const COUNTERS = "vote_counters";
let mongoActive = false;
let mongoCache = null;
let mongoRefreshTimer = null;
let mongoWritesPending = 0;
let mongoWriteQueue = Promise.resolve();

async function readMongoState() {
  if (!mongoActive || !isConnected() || mongoWritesPending > 0) return;
  const database = getDb();
  const [counters, events] = await Promise.all([
    database.collection(COUNTERS).find({}).toArray(),
    database.collection(EVENTS).find({}, { projection: { _id: 0, _key: 0 } }).sort({ votedAt: -1 }).limit(MAX_STORED_VOTE_EVENTS).toArray(),
  ]);
  if (mongoWritesPending > 0) return;
  const providers = {};
  for (const counter of counters) {
    providers[counter._id] = { totalVotes: counter.totalVotes || 0, lastVoteAt: counter.lastVoteAt || null, lastReceivedAt: counter.lastReceivedAt || null };
  }
  mongoCache = normalizeState({ votes: events, providers });
}

function queueMongoVotes(votes) {
  if (!votes.length) return;
  mongoWritesPending += 1;
  mongoWriteQueue = mongoWriteQueue
    .then(async () => {
      if (!isConnected()) return;
      const database = getDb();
      for (const vote of votes) {
        let inserted = false;
        try {
          // eslint-disable-next-line no-await-in-loop -- one vote after the other, the counter follows the insert
          await database.collection(EVENTS).insertOne({ _key: vote.key, ...vote });
          inserted = true;
        } catch (err) {
          if (err?.code !== 11000) throw err;
        }
        // eslint-disable-next-line no-await-in-loop
        await database.collection(COUNTERS).updateOne(
          { _id: vote.provider },
          { ...(inserted ? { $inc: { totalVotes: 1 } } : {}), $max: { lastVoteAt: vote.votedAt, lastReceivedAt: vote.receivedAt } },
          { upsert: true },
        );
      }
    })
    .catch((err) => log("ERROR", `[vote-events] MongoDB-Speichern fehlgeschlagen: ${err?.message || err}`))
    .finally(() => { mongoWritesPending = Math.max(0, mongoWritesPending - 1); });
}

/** MongoDB becomes the store; the votes and totals of vote-events.json are copied once. */
export async function initVoteEventsStore({ refreshMs = 5000 } = {}) {
  if (!isConnected() || !getDb()) return { backend: "file" };
  const database = getDb();
  await database.collection(EVENTS).createIndex({ _key: 1 }, { name: "vote_key", unique: true }).catch(() => null);
  await database.collection(EVENTS).createIndex({ votedAt: -1 }, { name: "vote_time" }).catch(() => null);
  if (!(await database.collection(COUNTERS).countDocuments({})) && fs.existsSync(STATE_FILE)) {
    const fileState = loadRawState();
    for (const vote of fileState.votes) {
      // eslint-disable-next-line no-await-in-loop -- a one-time copy
      await database.collection(EVENTS).updateOne({ _key: vote.key }, { $setOnInsert: { _key: vote.key, ...vote } }, { upsert: true });
    }
    for (const [provider, counter] of Object.entries(fileState.providers || {})) {
      // eslint-disable-next-line no-await-in-loop
      await database.collection(COUNTERS).updateOne({ _id: provider }, { $setOnInsert: counter }, { upsert: true });
    }
    log("INFO", `[vote-events] ${fileState.votes.length} Votes aus vote-events.json nach MongoDB übernommen.`);
  }
  mongoActive = true;
  await readMongoState();
  if (!mongoRefreshTimer) {
    mongoRefreshTimer = setInterval(() => {
      readMongoState().catch((err) => log("WARN", `[vote-events] MongoDB-Refresh fehlgeschlagen: ${err?.message || err}`));
    }, Math.max(1000, Number(refreshMs) || 5000));
    mongoRefreshTimer.unref?.();
  }
  return { backend: "mongo" };
}

export async function stopVoteEventsStore() {
  if (mongoRefreshTimer) clearInterval(mongoRefreshTimer);
  mongoRefreshTimer = null;
  await mongoWriteQueue.catch(() => null);
}

function loadRawState() {
  if (mongoActive && mongoCache) return normalizeState(JSON.parse(JSON.stringify(mongoCache)));
  try {
    if (!fs.existsSync(STATE_FILE)) return emptyState();
    if (fs.statSync(STATE_FILE).isDirectory()) return emptyState();
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    if (!raw.trim()) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

function saveRawState(state, votes = []) {
  const normalized = normalizeState(state);
  if (mongoActive) {
    mongoCache = normalized;
    queueMongoVotes(votes);
    return normalized;
  }
  const tempPath = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, serialized, "utf8");
    try {
      fs.renameSync(tempPath, STATE_FILE);
    } catch (renameErr) {
      const code = String(renameErr?.code || "");
      if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) {
        fs.writeFileSync(STATE_FILE, serialized, "utf8");
      } else {
        throw renameErr;
      }
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

  return normalized;
}

function mergeVoteIntoState(state, rawVote) {
  const vote = normalizeVoteEvent(rawVote);
  if (!vote) return { state, added: false, vote: null };

  const providerState = state.providers[vote.provider] || emptyProviderState();
  state.providers[vote.provider] = providerState;
  const hasVote = state.votes.some((entry) => entry.key === vote.key);
  if (!hasVote) {
    state.votes.unshift(vote);
    state.votes.sort((a, b) => new Date(b.votedAt).getTime() - new Date(a.votedAt).getTime());
    state.votes = state.votes.slice(0, MAX_STORED_VOTE_EVENTS);
    providerState.totalVotes = Math.max(providerState.totalVotes, 0) + 1;
    state.totalVotes = Math.max(state.totalVotes, 0) + 1;
  }
  providerState.lastVoteAt = vote.votedAt;
  providerState.lastReceivedAt = vote.receivedAt;
  return { state, added: !hasVote, vote };
}

function recordVoteEvent(rawVote) {
  const state = loadRawState();
  const merged = mergeVoteIntoState(state, rawVote);
  const saved = saveRawState(state, merged.vote ? [merged.vote] : []);
  const providerState = merged.vote ? saved.providers?.[merged.vote.provider] || emptyProviderState() : emptyProviderState();
  return {
    ok: Boolean(merged.vote),
    added: merged.added,
    vote: merged.vote,
    totalVotes: providerState.totalVotes,
    providerTotals: saved.providers,
  };
}

function mergeVoteEvents(rawVotes, hints = {}) {
  const votes = Array.isArray(rawVotes) ? rawVotes : [];
  const state = loadRawState();
  let added = 0;
  const merged = [];

  for (const rawVote of votes) {
    const result = mergeVoteIntoState(state, { ...hints, ...rawVote });
    if (result.added) added += 1;
    if (result.vote) merged.push(result.vote);
  }

  const saved = saveRawState(state, merged);
  return {
    added,
    totalVotes: saved.totalVotes,
    providers: saved.providers,
    votes: saved.votes,
  };
}

function getVoteEventsState({ limit = 50, provider = "" } = {}) {
  const state = loadRawState();
  const normalizedProvider = normalizeProvider(provider);
  const votes = normalizedProvider
    ? state.votes.filter((vote) => vote.provider === normalizedProvider)
    : state.votes;

  return {
    ...state,
    totalVotes: normalizedProvider
      ? state.providers?.[normalizedProvider]?.totalVotes || 0
      : state.totalVotes,
    votes: votes.slice(0, Math.max(0, Number.parseInt(String(limit || 0), 10) || 0)),
  };
}

export {
  getVoteEventsState,
  mergeVoteEvents,
  normalizeVoteEvent,
  recordVoteEvent,
};
