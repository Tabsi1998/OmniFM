#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

import { loadBotConfigs } from "../src/bot-config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(repoRoot, ".env");

dotenv.config({ path: envPath });

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveWorkerConfig(env = process.env) {
  const workerIndex = Number.parseInt(String(env.BOT_PROCESS_INDEX || ""), 10);
  if (!Number.isFinite(workerIndex) || workerIndex < 1) {
    throw new Error("BOT_PROCESS_INDEX is missing or invalid.");
  }

  const configs = loadBotConfigs(env);
  const config = configs.find((entry) => Number(entry?.index || 0) === workerIndex) || null;
  if (!config?.id) {
    throw new Error(`BOT_${workerIndex} is not configured.`);
  }

  return config;
}

function toDateMs(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveStaleMs(env = process.env) {
  const bridgeStaleMs = toPositiveInt(env.REMOTE_WORKER_STATUS_STALE_MS, 45_000);
  const defaultStaleMs = Math.max(60_000, bridgeStaleMs + 30_000);
  return Math.max(30_000, toPositiveInt(env.WORKER_HEALTHCHECK_STALE_MS, defaultStaleMs));
}

async function checkWorkerHealth(env = process.env) {
  const mongoUrl = String(env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    throw new Error("MONGO_URL is required for worker health checks.");
  }

  const worker = resolveWorkerConfig(env);
  const dbName = String(env.DB_NAME || "radio_bot").trim() || "radio_bot";
  const staleMs = resolveStaleMs(env);
  const requireReady = String(env.WORKER_HEALTHCHECK_REQUIRE_READY || "1").trim() !== "0";
  const nowMs = Date.now();

  const client = new MongoClient(mongoUrl, {
    appName: "omnifm-worker-healthcheck",
    connectTimeoutMS: 4_000,
    serverSelectionTimeoutMS: 4_000,
    socketTimeoutMS: 5_000,
    maxPoolSize: 1,
    minPoolSize: 0,
  });

  try {
    await client.connect();
    const doc = await client.db(dbName).collection("worker_bridge_status").findOne(
      { workerId: worker.id },
      {
        projection: {
          _id: 0,
          workerId: 1,
          heartbeatAt: 1,
          updatedAt: 1,
          "status.ready": 1,
          "status.userTag": 1,
          "runtimeMetrics.pid": 1,
          "runtimeMetrics.uptimeSec": 1,
        },
      }
    );

    if (!doc) {
      throw new Error(`No worker snapshot found for ${worker.id}.`);
    }

    const heartbeatMs = toDateMs(doc.heartbeatAt || doc.updatedAt);
    if (!heartbeatMs) {
      throw new Error(`Worker snapshot for ${worker.id} has no valid heartbeat.`);
    }

    const ageMs = nowMs - heartbeatMs;
    if (ageMs > staleMs) {
      throw new Error(`Worker ${worker.id} heartbeat is stale (${Math.round(ageMs / 1000)}s > ${Math.round(staleMs / 1000)}s).`);
    }

    const ready = doc?.status?.ready === true;
    if (requireReady && !ready) {
      throw new Error(`Worker ${worker.id} is not Discord-ready.`);
    }

    return {
      workerId: worker.id,
      ready,
      heartbeatAgeSec: Math.max(0, Math.round(ageMs / 1000)),
      pid: doc?.runtimeMetrics?.pid || null,
      uptimeSec: Number(doc?.runtimeMetrics?.uptimeSec || 0) || 0,
    };
  } finally {
    await client.close().catch(() => null);
  }
}

async function main() {
  const result = await checkWorkerHealth();
  console.log(
    `OK worker=${result.workerId} ready=${result.ready ? "1" : "0"} heartbeatAgeSec=${result.heartbeatAgeSec} pid=${result.pid || "-"} uptimeSec=${result.uptimeSec}`
  );
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error?.message || String(error)}`);
    process.exitCode = 1;
  });
}

export {
  checkWorkerHealth,
  resolveStaleMs,
  resolveWorkerConfig,
  toDateMs,
};
