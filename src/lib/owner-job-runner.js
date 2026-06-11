import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { rootDir } from "./logging.js";

const MAX_OUTPUT_CHARS = 120_000;
const MAX_RECENT_JOBS = 30;

const OWNER_JOB_ACTIONS = [
  {
    id: "split-preflight",
    title: "Split/Mongo Preflight",
    area: "Betrieb",
    risk: "low",
    timeoutMs: 30_000,
    command: process.execPath,
    args: ["scripts/check-split-requirements.mjs", "--env-file", ".env", "--json"],
    description: "Prueft Bot-Anzahl, Commander-Index, Deployment-Modus und MongoDB-Pflicht fuer Split-Betrieb.",
  },
  {
    id: "release-preflight-plan",
    title: "Release Preflight Plan",
    area: "Deployment",
    risk: "low",
    timeoutMs: 30_000,
    command: process.execPath,
    args: ["scripts/release-gate.mjs", "--preflight", "--dry-run", "--allow-dirty"],
    description: "Zeigt, welche Release-Gates ein echter Preflight ausfuehren wuerde, ohne Tests/Build/Audit zu starten.",
  },
  {
    id: "rollback-plan",
    title: "Rollback Plan",
    area: "Deployment",
    risk: "low",
    timeoutMs: 15_000,
    command: process.execPath,
    args: ["scripts/release-gate.mjs", "--rollback-plan"],
    description: "Gibt den dokumentierten Rollback-Ablauf aus.",
  },
  {
    id: "system-doctor",
    title: "System Doctor",
    area: "Betrieb",
    risk: "medium",
    timeoutMs: 120_000,
    command: "bash",
    args: ["./update.sh", "--doctor"],
    description: "Fuehrt den bestehenden update.sh Doctor aus. Kann fehlende Runtime-JSON-Dateien reparieren.",
  },
];

const ACTION_BY_ID = new Map(OWNER_JOB_ACTIONS.map((action) => [action.id, action]));
const jobs = new Map();

function stripAnsi(value) {
  return String(value || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function appendOutput(job, chunk) {
  const next = `${job.output}${stripAnsi(chunk)}`;
  job.output = next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next;
  job.outputTruncated = next.length > MAX_OUTPUT_CHARS;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    actionId: job.actionId,
    title: job.title,
    status: job.status,
    risk: job.risk,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    exitCode: job.exitCode,
    signal: job.signal,
    timedOut: Boolean(job.timedOut),
    output: job.output,
    outputTruncated: Boolean(job.outputTruncated),
    error: job.error || null,
  };
}

function pruneJobs() {
  const ordered = Array.from(jobs.values()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  for (const job of ordered.slice(MAX_RECENT_JOBS)) {
    if (job.status !== "running") jobs.delete(job.id);
  }
}

function hasRunningJob() {
  return Array.from(jobs.values()).some((job) => job.status === "running");
}

function getOwnerJobActions() {
  return OWNER_JOB_ACTIONS.map(({ command, args, ...action }) => ({
    ...action,
    command: [command, ...args].join(" "),
  }));
}

function getOwnerJobsSnapshot() {
  pruneJobs();
  return {
    generatedAt: new Date().toISOString(),
    running: hasRunningJob(),
    actions: getOwnerJobActions(),
    jobs: Array.from(jobs.values())
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .map(publicJob),
  };
}

function getOwnerJob(jobId) {
  return publicJob(jobs.get(String(jobId || "")));
}

function finishJob(job, patch = {}) {
  if (job.status !== "running") return;
  Object.assign(job, patch);
  job.finishedAt = new Date().toISOString();
  job.durationMs = Date.parse(job.finishedAt) - Date.parse(job.startedAt);
  if (typeof job.onFinish === "function") {
    job.onFinish(publicJob(job));
  }
  pruneJobs();
}

function startOwnerJob(actionId, { actor = "owner", onFinish = null } = {}) {
  const action = ACTION_BY_ID.get(String(actionId || ""));
  if (!action) {
    const error = new Error("Unbekannte Owner-Aktion.");
    error.statusCode = 404;
    throw error;
  }
  if (hasRunningJob()) {
    const error = new Error("Es laeuft bereits ein Owner-Job.");
    error.statusCode = 409;
    throw error;
  }

  const job = {
    id: randomUUID(),
    actionId: action.id,
    title: action.title,
    risk: action.risk,
    actor,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    output: "",
    outputTruncated: false,
    error: null,
    onFinish,
  };
  jobs.set(job.id, job);

  const child = spawn(action.command, action.args, {
    cwd: rootDir,
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });

  const timer = setTimeout(() => {
    job.timedOut = true;
    appendOutput(job, `\n[OwnerJob] Timeout nach ${action.timeoutMs}ms. Prozess wird beendet.\n`);
    child.kill("SIGTERM");
  }, action.timeoutMs);

  child.stdout?.on("data", (chunk) => appendOutput(job, chunk));
  child.stderr?.on("data", (chunk) => appendOutput(job, chunk));
  child.on("error", (error) => {
    clearTimeout(timer);
    appendOutput(job, `\n[OwnerJob] Start fehlgeschlagen: ${error?.message || String(error)}\n`);
    finishJob(job, {
      status: "failed",
      error: error?.message || String(error),
    });
  });
  child.on("close", (exitCode, signal) => {
    clearTimeout(timer);
    finishJob(job, {
      status: exitCode === 0 && !job.timedOut ? "succeeded" : "failed",
      exitCode,
      signal,
    });
  });

  pruneJobs();
  return publicJob(job);
}

function resetOwnerJobsForTests() {
  jobs.clear();
}

export {
  getOwnerJob,
  getOwnerJobActions,
  getOwnerJobsSnapshot,
  resetOwnerJobsForTests,
  startOwnerJob,
};
