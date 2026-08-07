import fs from "node:fs";
import path from "node:path";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STATE_FILE = resolveRuntimeDataPath("discordbotlist.json");
const MAX_STORED_VOTES = 500;

function emptyState() {
  return {
    version: 1,
    totalVotes: 0,
    votes: [],
    lastWebhookVoteAt: null,
    lastCommandsSync: null,
    lastStatsSync: null,
    lastVoteSync: null,
  };
}

function normalizeIso(rawValue, fallback = new Date().toISOString()) {
  const value = String(rawValue || "").trim();
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeVote(rawVote, source = "webhook") {
  if (!rawVote || typeof rawVote !== "object") return null;

  const userId = String(rawVote.id || rawVote.user_id || rawVote.userId || "").trim();
  if (!/^\d{17,22}$/.test(userId)) return null;

  const discriminator = String(rawVote.discriminator || "").trim();
  const usernameBase = String(rawVote.username || "").trim() || userId;
  const username = discriminator && discriminator !== "0"
    ? `${usernameBase}#${discriminator}`
    : usernameBase;
  const votedAt = normalizeIso(rawVote.timestamp || rawVote.votedAt);
  const voteSource = String(rawVote.source || source || "webhook").trim() || "webhook";

  return {
    userId,
    username: username.slice(0, 120),
    avatar: String(rawVote.avatar || "").trim() || null,
    admin: rawVote.admin === true,
    source: voteSource,
    votedAt,
    receivedAt: normalizeIso(rawVote.receivedAt),
  };
}

function normalizeSyncEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object") return null;
  return {
    at: normalizeIso(rawEntry.at),
    ok: rawEntry.ok !== false,
    source: rawEntry.source ? String(rawEntry.source).slice(0, 60) : null,
    botId: rawEntry.botId ? String(rawEntry.botId).slice(0, 40) : null,
    details: rawEntry.details && typeof rawEntry.details === "object"
      ? rawEntry.details
      : null,
    error: rawEntry.error ? String(rawEntry.error).slice(0, 240) : null,
  };
}

function normalizeState(rawState) {
  const input = rawState && typeof rawState === "object" ? rawState : {};
  const votes = Array.isArray(input.votes)
    ? input.votes.map((vote) => normalizeVote(vote, vote?.source || "webhook")).filter(Boolean)
    : [];

  votes.sort((a, b) => new Date(b.votedAt).getTime() - new Date(a.votedAt).getTime());

  return {
    version: 1,
    totalVotes: Math.max(
      Number.parseInt(String(input.totalVotes || 0), 10) || 0,
      votes.length
    ),
    votes: votes.slice(0, MAX_STORED_VOTES),
    lastWebhookVoteAt: input.lastWebhookVoteAt ? normalizeIso(input.lastWebhookVoteAt) : null,
    lastCommandsSync: normalizeSyncEntry(input.lastCommandsSync),
    lastStatsSync: normalizeSyncEntry(input.lastStatsSync),
    lastVoteSync: normalizeSyncEntry(input.lastVoteSync),
  };
}

function loadRawState() {
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

function saveRawState(state) {
  const normalized = normalizeState(state);
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

function mergeVoteIntoState(state, rawVote, { source = "webhook" } = {}) {
  const vote = normalizeVote(rawVote, source);
  if (!vote) return { state, added: false, vote: null };

  const key = `${vote.userId}:${vote.votedAt}`;
  const hasVote = state.votes.some((entry) => `${entry.userId}:${entry.votedAt}` === key);
  if (!hasVote) {
    state.votes.unshift(vote);
    state.votes.sort((a, b) => new Date(b.votedAt).getTime() - new Date(a.votedAt).getTime());
    state.votes = state.votes.slice(0, MAX_STORED_VOTES);
    state.totalVotes = Math.max(Number(state.totalVotes || 0), state.votes.length);
  }
  state.lastWebhookVoteAt = vote.receivedAt;
  return { state, added: !hasVote, vote };
}

function recordDiscordBotListVote(rawVote, { source = "webhook" } = {}) {
  const state = loadRawState();
  const merged = mergeVoteIntoState(state, rawVote, { source });
  const saved = saveRawState(state);
  return {
    ok: Boolean(merged.vote),
    added: merged.added,
    vote: merged.vote,
    totalVotes: saved.totalVotes,
  };
}

function mergeDiscordBotListVotes(rawVotes, { source = "api", total = null } = {}) {
  const votes = Array.isArray(rawVotes) ? rawVotes : [];
  const state = loadRawState();
  let added = 0;

  for (const rawVote of votes) {
    const merged = mergeVoteIntoState(state, rawVote, { source });
    if (merged.added) added += 1;
  }

  const normalizedTotal = Number.parseInt(String(total || 0), 10);
  if (Number.isFinite(normalizedTotal) && normalizedTotal > 0) {
    state.totalVotes = Math.max(state.totalVotes, normalizedTotal);
  }

  const saved = saveRawState(state);
  return {
    added,
    totalVotes: saved.totalVotes,
    votes: saved.votes,
  };
}

function setDiscordBotListSyncStatus(kind, payload = {}) {
  const keyMap = {
    commands: "lastCommandsSync",
    stats: "lastStatsSync",
    votes: "lastVoteSync",
  };
  const field = keyMap[String(kind || "").trim().toLowerCase()];
  if (!field) return null;

  const state = loadRawState();
  state[field] = normalizeSyncEntry({
    at: new Date().toISOString(),
    ...payload,
  });
  return saveRawState(state)[field];
}

function getDiscordBotListState({ voteLimit = 50 } = {}) {
  const state = loadRawState();
  return {
    ...state,
    votes: state.votes.slice(0, Math.max(0, Number.parseInt(String(voteLimit || 0), 10) || 0)),
  };
}

export {
  getDiscordBotListState,
  recordDiscordBotListVote,
  mergeDiscordBotListVotes,
  setDiscordBotListSyncStatus,
};
