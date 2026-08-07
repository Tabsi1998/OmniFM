import crypto from "node:crypto";

import { connect, getDb, isConnected } from "../lib/db.js";
import { log } from "../lib/logging.js";

const WORKER_STATUS_COLLECTION = "worker_bridge_status";
const WORKER_COMMAND_COLLECTION = "worker_bridge_commands";
const WORKER_STATUS_TTL_MS = Math.max(30_000, Number.parseInt(String(process.env.REMOTE_WORKER_STATUS_STALE_MS || "45000"), 10) || 45_000);
const WORKER_COMMAND_TTL_MS = Math.max(60_000, Number.parseInt(String(process.env.REMOTE_WORKER_COMMAND_TTL_MS || "300000"), 10) || 300_000);
const WORKER_COMMAND_WAIT_POLL_MS = Math.max(100, Number.parseInt(String(process.env.REMOTE_WORKER_COMMAND_POLL_MS || "500"), 10) || 500);
const WORKER_COMMAND_MIN_DEADLINE_MS = 5_000;
const WORKER_COMMAND_MIN_WAIT_MS = 2_000;

let bridgeIndexesPromise = null;

function buildWorkerIdFilter(workerIds = []) {
  const normalized = Array.isArray(workerIds)
    ? workerIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!normalized.length) return {};
  return { workerId: { $in: normalized } };
}

function getHeartbeatExpiryDate(baseTime = Date.now()) {
  return new Date(Number(baseTime) + WORKER_STATUS_TTL_MS);
}

function getCommandExpiryDate(baseTime = Date.now(), ttlMs = WORKER_COMMAND_TTL_MS) {
  return new Date(Number(baseTime) + Math.max(60_000, Number(ttlMs) || WORKER_COMMAND_TTL_MS));
}

function getCommandDeadlineDate(baseTime = Date.now(), timeoutMs = WORKER_COMMAND_TTL_MS) {
  return new Date(Number(baseTime) + Math.max(WORKER_COMMAND_MIN_DEADLINE_MS, Number(timeoutMs) || WORKER_COMMAND_TTL_MS));
}

function getCommandDeadlineMs(value, fallbackMs = WORKER_COMMAND_TTL_MS) {
  const parsed = Number(value);
  return Math.max(
    WORKER_COMMAND_MIN_DEADLINE_MS,
    Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs
  );
}

function getPendingCommandDeadlineFilter(now) {
  // Old commands created before deadlineAt existed remain executable until their
  // existing TTL, while every newly queued command gets a caller-bound deadline.
  return {
    $or: [
      { deadlineAt: { $gt: now } },
      { deadlineAt: { $exists: false } },
    ],
  };
}

async function ensureWorkerBridgeCollections() {
  if (bridgeIndexesPromise) return bridgeIndexesPromise;

  bridgeIndexesPromise = (async () => {
    if (!isConnected()) {
      await connect();
    }

    const db = getDb();
    if (!db) {
      throw new Error("MongoDB-Verbindung fuer Worker-Bridge nicht verfuegbar.");
    }

    const existing = await db.listCollections().toArray();
    const names = new Set(existing.map((entry) => String(entry?.name || "").trim()));

    if (!names.has(WORKER_STATUS_COLLECTION)) {
      await db.createCollection(WORKER_STATUS_COLLECTION);
    }
    if (!names.has(WORKER_COMMAND_COLLECTION)) {
      await db.createCollection(WORKER_COMMAND_COLLECTION);
    }

    await db.collection(WORKER_STATUS_COLLECTION).createIndexes([
      { key: { workerId: 1 }, name: "worker_unique", unique: true },
      { key: { expiresAt: 1 }, name: "ttl", expireAfterSeconds: 0 },
      { key: { updatedAt: -1 }, name: "updated" },
    ]).catch(() => null);

    await db.collection(WORKER_COMMAND_COLLECTION).createIndexes([
      { key: { commandId: 1 }, name: "command_unique", unique: true },
      { key: { workerId: 1, status: 1, createdAt: 1 }, name: "worker_status_created" },
      { key: { workerId: 1, status: 1, deadlineAt: 1, createdAt: 1 }, name: "worker_status_deadline_created" },
      { key: { expiresAt: 1 }, name: "ttl", expireAfterSeconds: 0 },
    ]).catch(() => null);

    log("INFO", "[WorkerBridge] Mongo-Kollektionen bereit.");
  })().catch((err) => {
    bridgeIndexesPromise = null;
    throw err;
  });

  return bridgeIndexesPromise;
}

async function getWorkerBridgeDb() {
  await ensureWorkerBridgeCollections();
  const db = getDb();
  if (!db) {
    throw new Error("MongoDB-Verbindung fuer Worker-Bridge nicht verfuegbar.");
  }
  return db;
}

async function publishWorkerSnapshot(workerId, snapshot = {}) {
  const normalizedWorkerId = String(workerId || "").trim();
  if (!normalizedWorkerId) {
    throw new Error("Worker-ID fehlt fuer Snapshot.");
  }

  const db = await getWorkerBridgeDb();
  const now = new Date();
  const payload = {
    workerId: normalizedWorkerId,
    status: snapshot?.status || {},
    guilds: Array.isArray(snapshot?.guilds) ? snapshot.guilds : [],
    runtimeMetrics: snapshot?.runtimeMetrics && typeof snapshot.runtimeMetrics === "object"
      ? snapshot.runtimeMetrics
      : {},
    heartbeatAt: now,
    updatedAt: now,
    expiresAt: getHeartbeatExpiryDate(now.getTime()),
  };

  await db.collection(WORKER_STATUS_COLLECTION).updateOne(
    { workerId: normalizedWorkerId },
    { $set: payload },
    { upsert: true }
  );
}

async function clearWorkerSnapshot(workerId) {
  const normalizedWorkerId = String(workerId || "").trim();
  if (!normalizedWorkerId) return;
  const db = await getWorkerBridgeDb();
  await db.collection(WORKER_STATUS_COLLECTION).deleteOne({ workerId: normalizedWorkerId }).catch(() => null);
}

async function listWorkerSnapshots({ workerIds = [] } = {}) {
  const db = await getWorkerBridgeDb();
  const docs = await db.collection(WORKER_STATUS_COLLECTION)
    .find(buildWorkerIdFilter(workerIds))
    .sort({ workerId: 1 })
    .toArray();
  return Array.isArray(docs) ? docs : [];
}

async function getWorkerSnapshot(workerId) {
  const normalizedWorkerId = String(workerId || "").trim();
  if (!normalizedWorkerId) return null;
  const db = await getWorkerBridgeDb();
  return db.collection(WORKER_STATUS_COLLECTION).findOne({ workerId: normalizedWorkerId });
}

async function createWorkerCommand(workerId, type, payload = {}, options = {}) {
  const normalizedWorkerId = String(workerId || "").trim();
  const normalizedType = String(type || "").trim();
  if (!normalizedWorkerId || !normalizedType) {
    throw new Error("Worker-Command benoetigt workerId und type.");
  }

  const db = await getWorkerBridgeDb();
  const now = new Date();
  const commandId = crypto.randomUUID();
  const timeoutMs = getCommandDeadlineMs(options?.timeoutMs);
  const doc = {
    commandId,
    workerId: normalizedWorkerId,
    type: normalizedType,
    payload: payload && typeof payload === "object" ? payload : {},
    status: "pending",
    createdAt: now,
    updatedAt: now,
    // expiresAt controls document retention. deadlineAt controls whether a
    // pending command may still start, so a visible caller timeout cannot turn
    // into a delayed action after the caller was told that it timed out.
    expiresAt: getCommandExpiryDate(now.getTime()),
    deadlineAt: getCommandDeadlineDate(now.getTime(), timeoutMs),
    claimedAt: null,
    cancelledAt: null,
    completedAt: null,
    error: null,
    result: null,
  };

  await db.collection(WORKER_COMMAND_COLLECTION).insertOne(doc);
  return doc;
}

async function claimNextWorkerCommand(workerId) {
  const normalizedWorkerId = String(workerId || "").trim();
  if (!normalizedWorkerId) return null;

  const db = await getWorkerBridgeDb();
  const now = new Date();
  const commands = db.collection(WORKER_COMMAND_COLLECTION);
  const doc = await commands.findOne(
    {
      workerId: normalizedWorkerId,
      status: "pending",
      expiresAt: { $gt: now },
      ...getPendingCommandDeadlineFilter(now),
    },
    {
      sort: { createdAt: 1 },
    }
  );

  if (!doc) return null;

  const update = await commands.updateOne(
    {
      commandId: doc.commandId,
      status: "pending",
      expiresAt: { $gt: now },
      ...getPendingCommandDeadlineFilter(now),
    },
    {
      $set: {
        status: "running",
        claimedAt: now,
        updatedAt: now,
      },
    }
  );

  if (!update.modifiedCount) {
    return null;
  }

  return {
    ...doc,
    status: "running",
    claimedAt: now,
    updatedAt: now,
  };
}

async function completeWorkerCommand(commandId, result = {}) {
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) return;
  const db = await getWorkerBridgeDb();
  const now = new Date();
  await db.collection(WORKER_COMMAND_COLLECTION).updateOne(
    { commandId: normalizedCommandId, status: "running" },
    {
      $set: {
        status: "completed",
        result: result && typeof result === "object" ? result : { value: result },
        error: null,
        updatedAt: now,
        completedAt: now,
      },
    }
  );
}

async function failWorkerCommand(commandId, error) {
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) return;
  const db = await getWorkerBridgeDb();
  const now = new Date();
  const errorText = error instanceof Error
    ? error.message || String(error)
    : String(error || "unknown error");

  await db.collection(WORKER_COMMAND_COLLECTION).updateOne(
    { commandId: normalizedCommandId, status: "running" },
    {
      $set: {
        status: "failed",
        error: errorText,
        updatedAt: now,
        completedAt: now,
      },
    }
  );
}

async function cancelWorkerCommand(commandId, reason = "Worker-Command Timeout.") {
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) return false;
  const db = await getWorkerBridgeDb();
  const now = new Date();
  const update = await db.collection(WORKER_COMMAND_COLLECTION).updateOne(
    { commandId: normalizedCommandId, status: "pending" },
    {
      $set: {
        status: "cancelled",
        error: String(reason || "Worker-Command abgebrochen."),
        updatedAt: now,
        cancelledAt: now,
      },
    }
  );
  return update.modifiedCount > 0;
}

async function getWorkerCommand(commandId) {
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) return null;
  const db = await getWorkerBridgeDb();
  return db.collection(WORKER_COMMAND_COLLECTION).findOne({ commandId: normalizedCommandId });
}

async function waitForWorkerCommandResult(commandId, options = {}) {
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) {
    throw new Error("Command-ID fehlt.");
  }

  const timeoutMs = Math.max(
    WORKER_COMMAND_MIN_WAIT_MS,
    Number(options?.timeoutMs || 0) || WORKER_COMMAND_TTL_MS
  );
  const pollMs = Math.max(100, Number(options?.pollMs || 0) || WORKER_COMMAND_WAIT_POLL_MS);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const doc = await getWorkerCommand(normalizedCommandId);
    if (!doc) {
      throw new Error("Worker-Command wurde nicht gefunden.");
    }
    if (doc.status === "completed") {
      return {
        ok: true,
        result: doc.result || {},
        command: doc,
      };
    }
    if (doc.status === "failed") {
      throw new Error(String(doc.error || "Worker-Command fehlgeschlagen."));
    }
    if (doc.status === "cancelled") {
      throw new Error(String(doc.error || "Worker-Command abgebrochen."));
    }
    await new Promise((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }

  const timeoutError = "Worker-Command Timeout.";
  const cancelled = await cancelWorkerCommand(normalizedCommandId, timeoutError).catch(() => false);
  if (!cancelled) {
    // If a worker claimed the command before its deadline, it is intentionally
    // not interrupted: playback operations are not safely reversible midway.
    // A late completion is still reported accurately when it won the race.
    const finalDoc = await getWorkerCommand(normalizedCommandId).catch(() => null);
    if (finalDoc?.status === "completed") {
      return {
        ok: true,
        result: finalDoc.result || {},
        command: finalDoc,
      };
    }
    if (finalDoc?.status === "failed" || finalDoc?.status === "cancelled") {
      throw new Error(String(finalDoc.error || timeoutError));
    }
  }

  throw new Error(timeoutError);
}

async function sendWorkerCommandAndWait(workerId, type, payload = {}, options = {}) {
  const timeoutMs = getCommandDeadlineMs(options?.timeoutMs);
  const pollMs = Math.max(100, Number(options?.pollMs || 0) || WORKER_COMMAND_WAIT_POLL_MS);
  const command = await createWorkerCommand(workerId, type, payload, { timeoutMs });
  return waitForWorkerCommandResult(command.commandId, { timeoutMs, pollMs });
}

export {
  WORKER_STATUS_TTL_MS,
  WORKER_COMMAND_TTL_MS,
  ensureWorkerBridgeCollections,
  publishWorkerSnapshot,
  clearWorkerSnapshot,
  listWorkerSnapshots,
  getWorkerSnapshot,
  createWorkerCommand,
  claimNextWorkerCommand,
  completeWorkerCommand,
  failWorkerCommand,
  cancelWorkerCommand,
  getWorkerCommand,
  waitForWorkerCommandResult,
  sendWorkerCommandAndWait,
};
