import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ActivityType, ChannelType } from "discord.js";

import {
  calculatePrice,
  calculateUpgradePrice,
  seatPricingInEuro,
  isWithinWorkerPlanLimit,
  applyVolumeTransformerLevel,
  isLikelyNetworkFailureLine,
} from "../src/lib/helpers.js";
import { buildCommandsJson } from "../src/commands.js";
import { networkRecoveryCoordinator } from "../src/core/network-recovery.js";
import { WorkerManager } from "../src/bot/worker-manager.js";
import { BotRuntime } from "../src/bot/runtime.js";
import { RemoteWorkerHandle } from "../src/bot/remote-worker-handle.js";
import { WorkerBridgeService } from "../src/bot/worker-bridge-service.js";
import { shouldLogFfmpegStderrLine } from "../src/lib/logging.js";
import {
  applyWorkerAutohealRecoveryBlock,
  evaluateWorkerAutohealState,
  startWorkerAutohealMonitor,
} from "../src/entrypoints/worker-autoheal.js";
import {
  attachRuntimeConnectionHandlers,
  fetchRuntimeBotVoiceState,
  handleRuntimeBotVoiceStateUpdate,
  reconcileRuntimeGuildVoiceState,
  restoreRuntimeGuildEntry,
  restoreRuntimeState,
  scheduleRuntimeReconnect,
  tryRuntimeReconnect,
} from "../src/bot/runtime-recovery.js";
import {
  armRuntimePlaybackRecovery,
  evaluateRuntimeStreamHealth,
  restartRuntimeCurrentStation,
  scheduleRuntimeStreamRestart,
} from "../src/bot/runtime-streams.js";
import { executeScheduledEventStop } from "../src/bot/runtime-events.js";
import { NowPlayingQueue } from "../src/lib/now-playing-queue.js";
import { buildEventDateTimeFromParts } from "../src/lib/event-time.js";
import {
  buildNowPlayingSignature,
  getNowPlayingCandidateIds,
} from "../src/lib/now-playing-target.js";
import {
  parseTrackFromStreamTitle,
  extractTrackFromMetadataText,
  hasUsableStreamTrack,
  normalizeTrackSearchText,
} from "../src/services/now-playing.js";
import {
  estimatePcmWavDurationSeconds,
  extractAcoustIdCandidate,
  extractFpcalcResultFromError,
  isFpcalcMissingInputError,
  isSoftRecognitionFailure,
  parseFpcalcOutput,
  selectBestAcoustIdMatch,
  shouldLogRecognitionFailure,
} from "../src/services/audio-recognition.js";
import { getDefaultLanguage } from "../src/i18n.js";
import { getBotState, saveBotState, saveState } from "../src/bot-state.js";
import {
  executeRuntimePlay,
  openRuntimePlayWizard,
  openRuntimeStationsBrowser,
} from "../src/bot/runtime-panels.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const botStatePath = path.join(repoRoot, "bot-state.json");
const botStateBackupPath = `${botStatePath}.bak`;
const runtimeIncidentsPath = path.join(repoRoot, "runtime-incidents.json");
const runtimeIncidentsBackupPath = `${runtimeIncidentsPath}.bak`;
const scheduledEventsPath = path.join(repoRoot, "scheduled-events.json");

function snapshotOptionalTextFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function restoreOptionalTextFile(filePath, snapshot) {
  if (snapshot === null) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return;
  }
  fs.writeFileSync(filePath, snapshot, "utf8");
}

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function importFreshLoggingModule() {
  const moduleUrl = pathToFileURL(path.join(repoRoot, "src/lib/logging.js"));
  moduleUrl.searchParams.set("cacheBust", `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

test("seat pricing stays aligned with documented bundle totals", () => {
  assert.deepEqual(seatPricingInEuro("pro"), {
    1: "2.99",
    2: "5.49",
    3: "7.49",
    5: "11.49",
  });
  assert.deepEqual(seatPricingInEuro("ultimate"), {
    1: "4.99",
    2: "7.99",
    3: "10.99",
    5: "16.99",
  });
});

test("calculatePrice applies seat bundles and duration discounts together", () => {
  assert.equal(calculatePrice("pro", 1, 2), 549);
  assert.equal(calculatePrice("pro", 3, 2), 1372);
  assert.equal(calculatePrice("ultimate", 1, 5), 1699);
});

test("calculateUpgradePrice uses seat-aware deltas", () => {
  const license = {
    plan: "pro",
    seats: 5,
    expiresAt: new Date(Date.now() + (15 * 24 * 60 * 60 * 1000)).toISOString(),
  };
  const quote = calculateUpgradePrice(license, "ultimate");

  assert.ok(quote);
  assert.equal(quote.seats, 5);
  assert.equal(quote.oldTier, "pro");
  assert.equal(quote.targetTier, "ultimate");
  assert.equal(quote.upgradeCost, Math.round((1699 - 1149) * (quote.daysLeft / 30)));
});

test("ffmpeg decode spam is suppressed in default logging mode", () => {
  const originalVerbosity = process.env.FFMPEG_STDERR_VERBOSITY;
  delete process.env.FFMPEG_STDERR_VERBOSITY;

  try {
    assert.equal(
      shouldLogFfmpegStderrLine("Error while decoding stream #0:0: Invalid data found when processing input"),
      false
    );
    assert.equal(
      shouldLogFfmpegStderrLine("HTTP error 502 Bad Gateway"),
      true
    );
    assert.equal(
      shouldLogFfmpegStderrLine("Error writing trailer of pipe:1: Broken pipe"),
      false
    );
  } finally {
    if (originalVerbosity === undefined) {
      delete process.env.FFMPEG_STDERR_VERBOSITY;
    } else {
      process.env.FFMPEG_STDERR_VERBOSITY = originalVerbosity;
    }
  }
});

test("logging isolates test runs into logs/test by default", async () => {
  const restoreEnv = setEnv({
    NODE_TEST_CONTEXT: "child",
    LOGS_DIR: undefined,
  });

  try {
    const logging = await importFreshLoggingModule();
    assert.equal(
      path.normalize(logging.logsDir),
      path.normalize(path.join(repoRoot, "logs", "test"))
    );
  } finally {
    restoreEnv();
  }
});

test("logging respects LOGS_DIR override for file output", async () => {
  const tempLogsDir = path.join(repoRoot, "logs", "unit-override");
  const restoreEnv = setEnv({
    LOGS_DIR: tempLogsDir,
    NODE_TEST_CONTEXT: undefined,
  });

  try {
    fs.rmSync(tempLogsDir, { recursive: true, force: true });
    const logging = await importFreshLoggingModule();
    assert.equal(path.normalize(logging.logsDir), path.normalize(tempLogsDir));

    logging.log("INFO", "isolated log target");
    await logging.getLogWriteQueue();

    const written = fs.readFileSync(path.join(tempLogsDir, "bot.log"), "utf8");
    assert.match(written, /isolated log target/);
  } finally {
    fs.rmSync(tempLogsDir, { recursive: true, force: true });
    restoreEnv();
  }
});

test("serialized guild operations run sequentially for the same guild", async () => {
  const fakeRuntime = {
    guildOperationLocks: new Map(),
  };
  const events = [];

  const first = BotRuntime.prototype.runSerializedGuildOperation.call(fakeRuntime, "guild-1", "play", async () => {
    events.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    events.push("first:end");
    return "first";
  });

  const second = BotRuntime.prototype.runSerializedGuildOperation.call(fakeRuntime, "guild-1", "stop", async () => {
    events.push("second:start");
    events.push("second:end");
    return "second";
  });

  const results = await Promise.all([first, second]);
  assert.deepEqual(results, ["first", "second"]);
  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
  assert.equal(fakeRuntime.guildOperationLocks.size, 0);
});

test("serialized guild operations release the lock after failures", async () => {
  const fakeRuntime = {
    guildOperationLocks: new Map(),
  };

  await assert.rejects(
    BotRuntime.prototype.runSerializedGuildOperation.call(fakeRuntime, "guild-1", "play", async () => {
      throw new Error("boom");
    }),
    /boom/
  );

  const result = await BotRuntime.prototype.runSerializedGuildOperation.call(fakeRuntime, "guild-1", "stop", async () => "ok");
  assert.equal(result, "ok");
  assert.equal(fakeRuntime.guildOperationLocks.size, 0);
});

test("stream restart scheduler keeps an earlier pending restart instead of delaying it", () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  let clearCalls = 0;

  global.setTimeout = ((handler, delay, ...args) => {
    const timer = { handler, delay, args };
    scheduled.push(timer);
    return timer;
  });
  global.clearTimeout = (() => {
    clearCalls += 1;
  });

  try {
    const runtime = {
      config: { name: "OmniFM Test" },
      restartCurrentStation() {
        return Promise.resolve();
      },
    };
    const state = {
      streamRestartTimer: null,
      streamRestartScheduledAt: 0,
      currentStationKey: "nightwave",
      lastChannelId: "123",
      player: { state: { status: "idle" } },
    };

    scheduleRuntimeStreamRestart(runtime, "guild-1", state, 1000, "first");
    const firstTimer = state.streamRestartTimer;
    const firstScheduledAt = state.streamRestartScheduledAt;

    scheduleRuntimeStreamRestart(runtime, "guild-1", state, 5000, "later");

    assert.equal(state.streamRestartTimer, firstTimer);
    assert.equal(state.streamRestartScheduledAt, firstScheduledAt);
    assert.equal(scheduled.length, 1);
    assert.equal(clearCalls, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("reconnect scheduler can replace a pending timer when a materially earlier retry is needed", () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  let clearCalls = 0;

  global.setTimeout = ((handler, delay, ...args) => {
    const timer = { handler, delay, args };
    scheduled.push(timer);
    return timer;
  });
  global.clearTimeout = (() => {
    clearCalls += 1;
  });

  try {
    const runtime = {
      config: { name: "OmniFM Test", id: "bot-1" },
      getState() {
        return state;
      },
      isScheduledEventStopDue() {
        return false;
      },
      getNetworkRecoveryDelayMs() {
        return 0;
      },
      persistState() {},
      tryReconnect() {
        return Promise.resolve({ attempted: false, retryRecommended: false });
      },
    };
    const state = {
      shouldReconnect: true,
      lastChannelId: "123",
      reconnectAttempts: 0,
      reconnectCircuitTripCount: 0,
      reconnectCircuitOpenUntil: 0,
      reconnectTimer: null,
      reconnectScheduledAt: 0,
      reconnectScheduledReason: null,
      reconnectScheduledDelayMs: 0,
      reconnectInFlight: false,
      voiceConnectInFlight: false,
    };

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "slow", minDelayMs: 5000, jitterFactor: 0 });
    const firstTimer = state.reconnectTimer;
    const firstScheduledAt = state.reconnectScheduledAt;

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "fast", minDelayMs: 1000, jitterFactor: 0, countAttempt: false });

    assert.notEqual(state.reconnectTimer, firstTimer);
    assert.ok(state.reconnectScheduledAt < firstScheduledAt);
    assert.equal(scheduled.length, 2);
    assert.equal(clearCalls, 1);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("reconnect scheduler keeps the original attempt count when a later retry is deduped", () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;

  global.setTimeout = ((handler, delay, ...args) => ({ handler, delay, args }));
  global.clearTimeout = (() => {});

  try {
    const runtime = {
      config: { name: "OmniFM Test", id: "bot-1" },
      getState() {
        return state;
      },
      isScheduledEventStopDue() {
        return false;
      },
      getNetworkRecoveryDelayMs() {
        return 0;
      },
      persistState() {},
      tryReconnect() {
        return Promise.resolve({ attempted: false, retryRecommended: false });
      },
    };
    const state = {
      shouldReconnect: true,
      lastChannelId: "123",
      reconnectAttempts: 0,
      reconnectCircuitTripCount: 0,
      reconnectCircuitOpenUntil: 0,
      reconnectTimer: null,
      reconnectScheduledAt: 0,
      reconnectScheduledReason: null,
      reconnectScheduledDelayMs: 0,
      reconnectInFlight: false,
      voiceConnectInFlight: false,
    };

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "first", minDelayMs: 1000, jitterFactor: 0 });
    const firstTimer = state.reconnectTimer;
    assert.equal(state.reconnectAttempts, 1);

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "later", minDelayMs: 5000, jitterFactor: 0 });

    assert.equal(state.reconnectTimer, firstTimer);
    assert.equal(state.reconnectAttempts, 1);
    assert.equal(state.reconnectScheduledReason, "first");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("scheduled event stop awaits the local async stop before skipping worker fallback", async (t) => {
  const scheduledEventsSnapshot = snapshotOptionalTextFile(scheduledEventsPath);
  t.after(() => {
    restoreOptionalTextFile(scheduledEventsPath, scheduledEventsSnapshot);
  });

  const order = [];
  const runtime = {
    config: { name: "OmniFM Test", id: "bot-1" },
    guildState: new Map([["guild-1", { activeScheduledEventId: "event-1" }]]),
    async stopInGuild() {
      order.push("local-stop:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("local-stop:end");
      return { ok: true };
    },
    workerManager: {
      async refreshRemoteStates() {
        order.push("refresh");
      },
      findWorkerByScheduledEvent() {
        order.push("worker-lookup");
        return {
          config: { name: "Worker A" },
          async stopInGuild() {
            order.push("worker-stop");
            return { ok: true };
          },
        };
      },
    },
  };

  await executeScheduledEventStop(runtime, {
    id: "event-1",
    guildId: "guild-1",
    activeUntilMs: Date.now() + 60_000,
    deleteAfterStop: false,
  });

  assert.deepEqual(order, [
    "refresh",
    "local-stop:start",
    "local-stop:end",
  ]);
});

test("logging prefixes every line of a multiline error in error.log", async () => {
  const tempLogsDir = path.join(repoRoot, "logs", "unit-multiline");
  const restoreEnv = setEnv({
    LOGS_DIR: tempLogsDir,
    NODE_TEST_CONTEXT: undefined,
  });

  try {
    fs.rmSync(tempLogsDir, { recursive: true, force: true });
    const logging = await importFreshLoggingModule();

    logging.log("ERROR", "first line\n    at fakeStack");
    await logging.getLogWriteQueue();

    const written = fs.readFileSync(path.join(tempLogsDir, "error.log"), "utf8").trim().split(/\r?\n/);
    assert.equal(written.length, 2);
    assert.match(written[0], /\[ERROR\] first line$/);
    assert.match(written[1], /\[ERROR\]\s+at fakeStack$/);
  } finally {
    fs.rmSync(tempLogsDir, { recursive: true, force: true });
    restoreEnv();
  }
});

test("logError writes context, metadata, and cause details into error.log", async () => {
  const tempLogsDir = path.join(repoRoot, "logs", "unit-error-details");
  const restoreEnv = setEnv({
    LOGS_DIR: tempLogsDir,
    NODE_TEST_CONTEXT: undefined,
  });

  try {
    fs.rmSync(tempLogsDir, { recursive: true, force: true });
    const logging = await importFreshLoggingModule();

    const cause = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const err = new Error("stats sync failed", { cause });
    err.name = "TopGGRequestError";
    err.status = 500;
    err.retryable = true;
    err.path = "/bots/1476192449721274472/stats";
    err.endpoint = "https://top.gg/api/bots/1476192449721274472/stats";

    logging.logError("[TopGG] Stats sync (periodic) fehlgeschlagen", err, {
      context: {
        service: "topgg",
        source: "periodic",
        bot: "1476192449721274472",
      },
    });
    await logging.getLogWriteQueue();

    const written = fs.readFileSync(path.join(tempLogsDir, "error.log"), "utf8");
    assert.match(written, /\[ERROR\] \[TopGG\] Stats sync \(periodic\) fehlgeschlagen/);
    assert.match(written, /\[ERROR\] context .*service=topgg.*source=periodic.*bot=1476192449721274472/);
    assert.match(written, /\[ERROR\] error TopGGRequestError: stats sync failed/);
    assert.match(written, /\[ERROR\] errorMeta .*status=500/);
    assert.match(written, /\[ERROR\] errorMeta .*retryable=true/);
    assert.match(written, /\[ERROR\] errorMeta .*path=\/bots\/1476192449721274472\/stats/);
    assert.match(written, /\[ERROR\] stack /);
    assert.match(written, /\[ERROR\] cause\[1\] Error: socket hang up/);
    assert.match(written, /\[ERROR\] cause\[1\]\.meta code=ECONNRESET/);
  } finally {
    fs.rmSync(tempLogsDir, { recursive: true, force: true });
    restoreEnv();
  }
});

test("recognition no-match logging is throttled with a longer cooldown", () => {
  const originalNow = Date.now;
  const baseNow = 1_700_000_000_000;
  Date.now = () => baseNow;

  try {
    assert.equal(
      shouldLogRecognitionFailure("https://example.com/stream-a", new Error("AcoustID returned no matches"), "acoustid-no-match"),
      true
    );
    assert.equal(
      shouldLogRecognitionFailure("https://example.com/stream-a", new Error("AcoustID returned no matches"), "acoustid-no-match"),
      false
    );
    Date.now = () => baseNow + (20 * 60_000) + 1;
    assert.equal(
      shouldLogRecognitionFailure("https://example.com/stream-a", new Error("AcoustID returned no matches"), "acoustid-no-match"),
      true
    );
  } finally {
    Date.now = originalNow;
  }
});

test("invite and workers components ack before rebuilding slow payloads", async () => {
  const inviteCalls = [];
  const workersCalls = [];
  const runtime = {
    role: "commander",
    workerManager: {},
    createInteractionTranslator() {
      return {
        language: "en",
        t: (de, en) => en,
      };
    },
    buildInviteMenuPayload: async (_interaction, options = {}) => {
      inviteCalls.push(`build:${options.selectedWorkerSlot ?? "open"}`);
      return { content: `invite payload ${options.selectedWorkerSlot ?? "open"}` };
    },
    buildWorkersStatusPayload: async (_interaction, options = {}) => {
      workersCalls.push(`build:${options.page ?? "open"}`);
      return { content: `workers payload ${options.page ?? "open"}` };
    },
  };

  const inviteOpenInteraction = {
    guildId: "guild-1",
    customId: "omnifm:invite:open",
    isStringSelectMenu: () => false,
    deferUpdate: async () => {
      inviteCalls.push("defer");
    },
    editReply: async (payload) => {
      inviteCalls.push(`edit:${payload.content}`);
    },
    reply: async () => {
      inviteCalls.push("reply");
    },
  };

  const inviteSelectInteraction = {
    guildId: "guild-1",
    customId: "omnifm:invite:select",
    values: ["4"],
    isStringSelectMenu: () => true,
    deferUpdate: async () => {
      inviteCalls.push("defer");
    },
    editReply: async (payload) => {
      inviteCalls.push(`edit:${payload.content}`);
    },
    reply: async () => {
      inviteCalls.push("reply");
    },
  };

  const workersOpenInteraction = {
    guildId: "guild-1",
    customId: "omnifm:workers:open",
    isStringSelectMenu: () => false,
    deferUpdate: async () => {
      workersCalls.push("defer");
    },
    editReply: async (payload) => {
      workersCalls.push(`edit:${payload.content}`);
    },
    reply: async () => {
      workersCalls.push("reply");
    },
  };

  const workersPageInteraction = {
    guildId: "guild-1",
    customId: "omnifm:workers:page:3",
    isStringSelectMenu: () => false,
    deferUpdate: async () => {
      workersCalls.push("defer");
    },
    editReply: async (payload) => {
      workersCalls.push(`edit:${payload.content}`);
    },
    reply: async () => {
      workersCalls.push("reply");
    },
  };

  await BotRuntime.prototype.handleInviteComponentInteraction.call(runtime, inviteOpenInteraction);
  await BotRuntime.prototype.handleInviteComponentInteraction.call(runtime, inviteSelectInteraction);
  await BotRuntime.prototype.handleWorkersComponentInteraction.call(runtime, workersOpenInteraction);
  await BotRuntime.prototype.handleWorkersComponentInteraction.call(runtime, workersPageInteraction);

  assert.deepEqual(inviteCalls, [
    "defer",
    "build:open",
    "edit:invite payload open",
    "defer",
    "build:4",
    "edit:invite payload 4",
  ]);
  assert.deepEqual(workersCalls, [
    "defer",
    "build:open",
    "edit:workers payload open",
    "defer",
    "build:3",
    "edit:workers payload 3",
  ]);
});

test("worker access limit uses worker slot instead of absolute BOT_N index", () => {
  assert.equal(
    isWithinWorkerPlanLimit({ role: "worker", workerSlot: 2, botIndex: 3, maxBots: 2 }),
    true
  );
  assert.equal(
    isWithinWorkerPlanLimit({ role: "worker", workerSlot: null, botIndex: 3, maxBots: 2 }),
    false
  );
});

test("premium access denial restricts runtime without leaving the guild by default", async () => {
  const state = {
    shouldReconnect: true,
    currentStationKey: "station-a",
    lastChannelId: "voice-1",
  };
  let resetVoiceArgs = null;
  let leaveCalled = 0;
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM 4", requiredTier: "ultimate", id: "bot-4" };
  runtime.guildState = new Map([["guild-1", state]]);
  runtime.getGuildAccess = () => ({
    allowed: false,
    guildTier: "free",
    requiredTier: "ultimate",
    tierAllowed: false,
    botIndex: 4,
    workerSlot: 3,
    maxBots: 2,
  });
  runtime.resetVoiceSession = (guildId, passedState, options) => {
    resetVoiceArgs = { guildId, passedState, options };
  };

  const allowed = await BotRuntime.prototype.enforceGuildAccessForGuild.call(runtime, {
    id: "guild-1",
    name: "Guild One",
    leave: async () => {
      leaveCalled += 1;
    },
  }, "restore");

  assert.equal(allowed, false);
  assert.equal(leaveCalled, 0);
  assert.deepEqual(resetVoiceArgs, {
    guildId: "guild-1",
    passedState: state,
    options: { preservePlaybackTarget: false, clearLastChannel: true },
  });
});

test("premium access denial can still leave the guild when explicitly forced", async () => {
  let resetCount = 0;
  let leaveCalled = 0;
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM 9", requiredTier: "ultimate", id: "bot-9" };
  runtime.guildState = new Map();
  runtime.getGuildAccess = () => ({
    allowed: false,
    guildTier: "free",
    requiredTier: "ultimate",
    tierAllowed: false,
    botIndex: 9,
    workerSlot: 8,
    maxBots: 2,
  });
  runtime.getGuildAccessEnforcementMode = () => "leave";
  runtime.resetGuildRuntimeState = () => {
    resetCount += 1;
  };

  const allowed = await BotRuntime.prototype.enforceGuildAccessForGuild.call(runtime, {
    id: "guild-2",
    name: "Guild Two",
    leave: async () => {
      leaveCalled += 1;
    },
  }, "startup");

  assert.equal(allowed, false);
  assert.equal(resetCount, 1);
  assert.equal(leaveCalled, 1);
});

test("reconnect circuit breaker pauses retries after too many failed attempts", () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    scheduled.push(timer);
    return timer;
  };

  try {
    const state = {
      shouldReconnect: true,
      lastChannelId: "voice-1",
      activeScheduledEventStopAtMs: 0,
      reconnectAttempts: 30,
      reconnectTimer: null,
      reconnectCount: 0,
      lastReconnectAt: null,
      connection: null,
    };
    const runtime = {
      config: { name: "OmniFM 6", id: "bot-6" },
      getState() {
        return state;
      },
      isScheduledEventStopDue() {
        return false;
      },
      stopInGuild() {
        throw new Error("stopInGuild should not be called");
      },
      tryReconnect: async () => {
        throw new Error("tryReconnect should not run during scheduling");
      },
      scheduleReconnect() {
        throw new Error("scheduleReconnect should not run during scheduling");
      },
    };

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "retry" });

    assert.equal(state.reconnectAttempts, 0);
    assert.equal(state.reconnectCount, 0);
    assert.equal(scheduled.length, 1);
    assert.ok(scheduled[0].delay >= 15 * 60 * 1000);
    assert.equal(state.reconnectTimer, scheduled[0]);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("recoverable voice connection errors stay on reconnect flow", () => {
  const originalNoteFailure = networkRecoveryCoordinator.noteFailure;
  const notedFailures = [];
  networkRecoveryCoordinator.noteFailure = (source, detail) => {
    notedFailures.push({ source, detail });
  };

  try {
    const handlers = new Map();
    const connection = {
      on(event, handler) {
        handlers.set(String(event), handler);
      },
    };
    const scheduled = [];
    const state = {
      connection,
      shouldReconnect: true,
      currentStationKey: "station-a",
      lastChannelId: "voice-1",
    };
    const runtime = {
      config: { name: "OmniFM 6", id: "bot-6" },
      getState() {
        return state;
      },
      scheduleReconnect(guildId, options = {}) {
        scheduled.push({ guildId, options });
      },
    };

    attachRuntimeConnectionHandlers(runtime, "guild-1", connection);
    handlers.get("error")(new Error("Unexpected server response: 521"));

    assert.equal(state.connection, connection);
    assert.deepEqual(scheduled, [{
      guildId: "guild-1",
      options: { reason: "voice-network-error", minDelayMs: 15000, jitterFactor: 0.6 },
    }]);
    assert.equal(notedFailures.length, 1);
  } finally {
    networkRecoveryCoordinator.noteFailure = originalNoteFailure;
  }
});

test("network failure detection treats unexpected 52x voice responses as recoverable", () => {
  assert.equal(isLikelyNetworkFailureLine("Unexpected server response: 521"), true);
  assert.equal(isLikelyNetworkFailureLine("Unexpected server response: 522"), true);
  assert.equal(isLikelyNetworkFailureLine("Unexpected server response: 401"), false);
});

test("scheduleReconnect persists a recoverable playback target for restart restore", () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    scheduled.push(timer);
    return timer;
  };

  try {
    let persistCount = 0;
    const state = {
      shouldReconnect: true,
      currentStationKey: "station-a",
      lastChannelId: "voice-1",
      activeScheduledEventStopAtMs: 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnectCount: 0,
      lastReconnectAt: null,
      connection: null,
    };
    const runtime = {
      config: { name: "OmniFM 6", id: "bot-6" },
      getState() {
        return state;
      },
      isScheduledEventStopDue() {
        return false;
      },
      stopInGuild() {
        throw new Error("stopInGuild should not be called");
      },
      persistState() {
        persistCount += 1;
      },
    };

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "retry" });

    assert.equal(scheduled.length, 1);
    assert.equal(persistCount, 1);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("scheduleReconnect keeps the attempt counter stable when reconnect work was only deferred", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    scheduled.push(timer);
    return timer;
  };

  try {
    let reconnectCalls = 0;
    const state = {
      shouldReconnect: true,
      currentStationKey: "station-a",
      lastChannelId: "voice-1",
      activeScheduledEventStopAtMs: 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnectCount: 0,
      lastReconnectAt: null,
      connection: null,
      reconnectInFlight: false,
      voiceConnectInFlight: false,
    };
    const runtime = {
      config: { name: "OmniFM 6", id: "bot-6" },
      getState() {
        return state;
      },
      getNetworkRecoveryDelayMs() {
        return 0;
      },
      isScheduledEventStopDue() {
        return false;
      },
      stopInGuild() {
        throw new Error("stopInGuild should not be called");
      },
      async tryReconnect() {
        reconnectCalls += 1;
        return {
          attempted: false,
          retryRecommended: true,
          minDelayMs: 5_000,
          reason: "network-cooldown",
        };
      },
      scheduleReconnect(guildId, options = {}) {
        return scheduleRuntimeReconnect(this, guildId, options);
      },
      persistState() {},
    };

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "retry" });
    assert.equal(state.reconnectAttempts, 1);
    assert.equal(scheduled.length, 1);

    await scheduled[0].fn();

    assert.equal(reconnectCalls, 1);
    assert.equal(state.reconnectAttempts, 1);
    assert.equal(scheduled.length, 2);
    assert.ok(scheduled[1].delay >= 5_000);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("syncVoiceChannelStatus reapplies the status after reconnect invalidation", async () => {
  let putCalls = 0;
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM Status" };
  runtime.client = {
    guilds: {
      cache: new Map([["guild-1", {
        channels: {
          cache: new Map([["123456789012345678", {
            id: "123456789012345678",
            type: ChannelType.GuildVoice,
          }]]),
          fetch: async () => null,
        },
      }]]),
    },
  };
  runtime.rest = {
    put: async () => {
      putCalls += 1;
    },
    delete: async () => {},
  };
  const state = {
    connection: { joinConfig: { channelId: "123456789012345678" } },
    lastChannelId: "123456789012345678",
    voiceStatusText: BotRuntime.prototype.renderVoiceStatusText.call(runtime, "Station A"),
    voiceStatusChannelId: "123456789012345678",
    voiceStatusNeedsSync: true,
    lastVoiceStatusSyncAt: Date.now(),
    lastVoiceStatusErrorAt: 0,
  };
  runtime.guildState = new Map([["guild-1", state]]);

  await BotRuntime.prototype.syncVoiceChannelStatus.call(runtime, "guild-1", "Station A");

  assert.equal(putCalls, 1);
  assert.equal(state.voiceStatusNeedsSync, false);
  assert.equal(state.voiceStatusChannelId, "123456789012345678");
});

test("syncVoiceChannelStatus uses the observed voice channel when the local handle is missing", async () => {
  let putCalls = 0;
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM Status" };
  runtime.client = {
    guilds: {
      cache: new Map([["guild-1", {
        members: {
          me: {
            voice: {
              channelId: "123456789012345678",
            },
          },
        },
        channels: {
          cache: new Map([["123456789012345678", {
            id: "123456789012345678",
            type: ChannelType.GuildVoice,
          }]]),
          fetch: async () => null,
        },
      }]]),
    },
  };
  runtime.rest = {
    put: async () => {
      putCalls += 1;
    },
    delete: async () => {},
  };
  const state = {
    connection: null,
    lastChannelId: null,
    voiceStatusText: "",
    voiceStatusChannelId: "",
    voiceStatusNeedsSync: true,
    lastVoiceStatusSyncAt: 0,
    lastVoiceStatusErrorAt: 0,
  };
  runtime.guildState = new Map([["guild-1", state]]);

  await BotRuntime.prototype.syncVoiceChannelStatus.call(runtime, "guild-1", "Station B");

  assert.equal(putCalls, 1);
  assert.equal(state.voiceStatusNeedsSync, false);
  assert.equal(state.voiceStatusChannelId, "123456789012345678");
});

test("scheduleReconnect skips when a connect or reconnect is already in flight", () => {
  const originalSetTimeout = global.setTimeout;
  let scheduled = 0;
  global.setTimeout = () => {
    scheduled += 1;
    return { unref() {} };
  };

  try {
    const state = {
      shouldReconnect: true,
      lastChannelId: "voice-1",
      activeScheduledEventStopAtMs: 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnectCount: 0,
      lastReconnectAt: null,
      connection: null,
      reconnectInFlight: true,
      voiceConnectInFlight: false,
    };
    const runtime = {
      config: { name: "OmniFM 6", id: "bot-6" },
      getState() {
        return state;
      },
      isScheduledEventStopDue() {
        return false;
      },
      stopInGuild() {
        throw new Error("stopInGuild should not be called");
      },
    };

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "retry" });
    assert.equal(scheduled, 0);

    state.reconnectInFlight = false;
    state.voiceConnectInFlight = true;
    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "retry" });
    assert.equal(scheduled, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("scheduleReconnect honors explicit minimum delay and jitter overrides", () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    scheduled.push(timer);
    return timer;
  };

  try {
    const state = {
      shouldReconnect: true,
      lastChannelId: "voice-1",
      activeScheduledEventStopAtMs: 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnectCount: 0,
      lastReconnectAt: null,
      connection: null,
      reconnectInFlight: false,
      voiceConnectInFlight: false,
    };
    const runtime = {
      config: { name: "OmniFM 6", id: "bot-6" },
      getState() {
        return state;
      },
      getNetworkRecoveryDelayMs() {
        return 0;
      },
      isScheduledEventStopDue() {
        return false;
      },
      stopInGuild() {
        throw new Error("stopInGuild should not be called");
      },
      persistState() {},
    };

    scheduleRuntimeReconnect(runtime, "guild-1", {
      reason: "voice-network-error",
      minDelayMs: 15_000,
      jitterFactor: 0,
    });

    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 15_000);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("fetchBotVoiceState falls back to cached member voice when voice-state fetch fails", async () => {
  const guild = {
    voiceStates: {
      fetch: async () => {
        throw new Error("temporary discord failure");
      },
    },
    members: {
      me: {
        voice: {
          channelId: "voice-1",
        },
      },
      fetchMe: async () => null,
    },
  };
  const runtime = {
    client: {
      guilds: {
        cache: new Map([["guild-1", guild]]),
        fetch: async () => guild,
      },
    },
  };

  const result = await fetchRuntimeBotVoiceState(runtime, "guild-1");
  assert.equal(result.guild, guild);
  assert.equal(result.channelId, "voice-1");
});

test("voice reconcile waits for confirmation before tearing down an active session", async () => {
  const queued = [];
  let resetCount = 0;
  let reconnectCount = 0;
  const state = {
    connection: { joinConfig: { channelId: "voice-1" } },
    currentStationKey: "station-a",
    currentProcess: { pid: 1 },
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      isReady: () => true,
    },
    guildState: new Map([["guild-1", state]]),
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: null, channelId: null }),
    markNowPlayingTargetDirty() {},
    persistState() {},
    queueVoiceStateReconcile(guildId, reason, delayMs) {
      queued.push({ guildId, reason, delayMs });
    },
    resetVoiceSession() {
      resetCount += 1;
    },
    scheduleReconnect() {
      reconnectCount += 1;
    },
    scheduleStreamRestart() {
      throw new Error("scheduleStreamRestart should not run");
    },
    syncVoiceChannelStatus() {
      return Promise.resolve();
    },
  };

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(resetCount, 0);
  assert.equal(reconnectCount, 0);
  assert.equal(queued.length, 1);
  assert.equal(state.transientVoiceIssues["voice-state-missing"].count, 1);

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(resetCount, 1);
  assert.equal(reconnectCount, 1);
});

test("voiceStateUpdate does not tear down an auto-reconnect session on first missing channel event", () => {
  const queued = [];
  let resetCount = 0;
  const state = {
    shouldReconnect: true,
    currentStationKey: "station-a",
    lastChannelId: "voice-1",
    transientVoiceIssues: {},
    voiceConnectInFlight: false,
    reconnectInFlight: false,
    reconnectTimer: null,
    voiceDisconnectObservedAt: 0,
  };
  const runtime = {
    client: {
      user: { id: "bot-1" },
    },
    config: { name: "OmniFM Test" },
    getState() {
      return state;
    },
    queueVoiceStateReconcile(guildId, reason, delayMs) {
      queued.push({ guildId, reason, delayMs });
    },
    resetVoiceSession() {
      resetCount += 1;
    },
  };

  handleRuntimeBotVoiceStateUpdate(
    runtime,
    { channelId: "voice-1" },
    { id: "bot-1", guild: { id: "guild-1" }, channelId: null }
  );

  assert.equal(resetCount, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].guildId, "guild-1");
  assert.equal(queued[0].reason, "voice-state-update-missing");
  assert.equal(state.transientVoiceIssues["voice-state-update-missing"].count, 1);
  assert.ok(state.voiceDisconnectObservedAt > 0);
});

test("voiceStateUpdate keeps the locked voice target when the bot is moved unexpectedly", () => {
  const restoreEnv = setEnv({ VOICE_MOVE_POLICY: "return" });
  try {
    const queued = [];
    let dirtyCount = 0;
    let persistCount = 0;
    const state = {
      shouldReconnect: true,
      currentStationKey: "station-a",
      lastChannelId: "voice-1",
      connection: { joinConfig: { channelId: "voice-1" } },
      transientVoiceIssues: {},
      voiceConnectInFlight: false,
      reconnectInFlight: false,
      reconnectTimer: null,
      voiceDisconnectObservedAt: 0,
      voiceGuardEffectivePolicy: "return",
    };
    const runtime = {
      client: {
        user: { id: "bot-1" },
      },
      config: { name: "OmniFM Test" },
      getState() {
        return state;
      },
      markNowPlayingTargetDirty() {
        dirtyCount += 1;
      },
      persistState() {
        persistCount += 1;
      },
      queueVoiceStateReconcile(guildId, reason, delayMs) {
        queued.push({ guildId, reason, delayMs });
      },
    };

    handleRuntimeBotVoiceStateUpdate(
      runtime,
      { channelId: "voice-1" },
      { id: "bot-1", guild: { id: "guild-1" }, channelId: "voice-2" }
    );

    assert.equal(state.lastChannelId, "voice-1");
    assert.equal(dirtyCount, 0);
    assert.equal(persistCount, 0);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].reason, "voice-state-update-mismatch");
    assert.equal(state.transientVoiceIssues["voice-channel-mismatch"].count, 1);
  } finally {
    restoreEnv();
  }
});

test("voiceStateUpdate still protects an active session when shouldReconnect is false", () => {
  const restoreEnv = setEnv({ VOICE_MOVE_POLICY: "return" });
  try {
    const queued = [];
    const state = {
      shouldReconnect: false,
      currentStationKey: "station-a",
      lastChannelId: "voice-1",
      connection: { joinConfig: { channelId: "voice-1" } },
      transientVoiceIssues: {},
      voiceConnectInFlight: false,
      reconnectInFlight: false,
      reconnectTimer: null,
      voiceDisconnectObservedAt: 0,
      voiceGuardEffectivePolicy: "return",
      player: { state: { status: "playing" } },
    };
    const runtime = {
      client: {
        user: { id: "bot-1" },
      },
      config: { name: "OmniFM Test" },
      getState() {
        return state;
      },
      markNowPlayingTargetDirty() {
        throw new Error("markNowPlayingTargetDirty should not run");
      },
      persistState() {
        throw new Error("persistState should not run");
      },
      queueVoiceStateReconcile(guildId, reason, delayMs) {
        queued.push({ guildId, reason, delayMs });
      },
    };

    handleRuntimeBotVoiceStateUpdate(
      runtime,
      { channelId: "voice-1" },
      { id: "bot-1", guild: { id: "guild-1" }, channelId: "voice-2" }
    );

    assert.equal(state.lastChannelId, "voice-1");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].reason, "voice-state-update-mismatch");
    assert.equal(state.transientVoiceIssues["voice-channel-mismatch"].count, 1);
  } finally {
    restoreEnv();
  }
});

test("resolveStreamingRuntimeForInteraction honors explicit bot selection without requiring voice membership", async () => {
  const selectedRuntime = {
    getState(guildId) {
      assert.equal(guildId, "guild-1");
      return { currentStationKey: "station-b" };
    },
  };
  const fakeRuntime = {
    role: "commander",
    workerManager: {
      resolveWorker(index) {
        if (index === 2) return { worker: selectedRuntime, workerSlot: 2, mode: "slot" };
        return null;
      },
      getStreamingWorkers() {
        return [selectedRuntime];
      },
    },
    getIntegerOptionFlexible: BotRuntime.prototype.getIntegerOptionFlexible,
  };
  const interaction = {
    guildId: "guild-1",
    options: {
      getInteger(name) {
        return name === "bot" ? 2 : null;
      },
      getString() {
        return null;
      },
      get() {
        return null;
      },
    },
  };

  const resolved = await BotRuntime.prototype.resolveStreamingRuntimeForInteraction.call(fakeRuntime, interaction);

  assert.equal(resolved.runtime, selectedRuntime);
  assert.equal(resolved.reason, null);
  assert.equal(resolved.requestedWorkerSlot, 2);
});

test("resolveStreamingRuntimeForInteraction refreshes remote states before inspecting streaming workers", async () => {
  const selectedRuntime = {
    getState() {
      return { currentStationKey: "station-b" };
    },
    getGuildInfo() {
      return { channelId: "voice-1" };
    },
  };
  let refreshed = 0;
  const fakeRuntime = {
    role: "commander",
    workerManager: {
      async refreshRemoteStates() {
        refreshed += 1;
      },
      getStreamingWorkers() {
        return [selectedRuntime];
      },
    },
    client: {
      guilds: {
        cache: new Map([
          ["guild-1", {
            id: "guild-1",
            members: {
              async fetch() {
                return { voice: { channelId: "voice-1" } };
              },
            },
          }],
        ]),
        async fetch() {
          return {
            id: "guild-1",
            members: {
              async fetch() {
                return { voice: { channelId: "voice-1" } };
              },
            },
          };
        },
      },
    },
    getIntegerOptionFlexible: BotRuntime.prototype.getIntegerOptionFlexible,
  };
  const interaction = {
    guildId: "guild-1",
    guild: {
      id: "guild-1",
      members: {
        async fetch() {
          return { voice: { channelId: "voice-1" } };
        },
      },
    },
    user: { id: "user-1" },
    options: {
      getInteger() {
        return null;
      },
      getString() {
        return null;
      },
      get() {
        return null;
      },
    },
  };

  const resolved = await BotRuntime.prototype.resolveStreamingRuntimeForInteraction.call(fakeRuntime, interaction);

  assert.equal(refreshed, 1);
  assert.equal(resolved.runtime, selectedRuntime);
  assert.equal(resolved.reason, null);
});

test("remote worker handle forwards voice guard refresh and unlock commands", async () => {
  const worker = new RemoteWorkerHandle({ id: "bot-remote-voiceguard", name: "OmniFM Remote" });
  worker.latestStatus.guildDetails = [{
    guildId: "guild-1",
    guildName: "Guild One",
    channelId: "voice-1",
    channelName: "Radio",
    stationKey: "station-a",
    stationName: "Station A",
    voiceConnected: true,
    playing: true,
  }];
  worker.guildState.set("guild-1", worker.getState("guild-1"));

  const sent = [];
  worker.sendCommand = async (type, payload) => {
    sent.push({ type, payload });
    if (type === "voiceGuardRefresh") {
      return {
        ok: true,
        summary: {
          available: true,
          policy: "default",
          effectivePolicy: "return",
          moveConfirmations: 2,
          returnCooldownMs: 15000,
          moveWindowMs: 120000,
          maxMovesPerWindow: 4,
          escalation: "disconnect",
          escalationCooldownMs: 600000,
        },
      };
    }
    if (type === "voiceGuardUnlock") {
      return {
        ok: true,
        unlockUntil: Date.now() + 600000,
        durationMs: 600000,
        label: "10m",
        summary: {
          available: true,
          policy: "default",
          effectivePolicy: "return",
          unlockUntil: Date.now() + 600000,
          lastAction: "manual-unlock",
          lastActionReason: "slash-unlock",
          moveConfirmations: 2,
          returnCooldownMs: 15000,
          moveWindowMs: 120000,
          maxMovesPerWindow: 4,
          escalation: "disconnect",
          escalationCooldownMs: 600000,
        },
      };
    }
    if (type === "voiceGuardLock") {
      return {
        ok: true,
        unlockUntil: 0,
        summary: {
          available: true,
          policy: "default",
          effectivePolicy: "return",
          unlockUntil: 0,
          lastAction: "manual-lock",
          lastActionReason: "slash-lock",
          moveConfirmations: 2,
          returnCooldownMs: 15000,
          moveWindowMs: 120000,
          maxMovesPerWindow: 4,
          escalation: "disconnect",
          escalationCooldownMs: 600000,
        },
      };
    }
    return { ok: false, error: "unexpected" };
  };

  const refreshed = await worker.refreshVoiceGuardSettings("guild-1", { force: true });
  const unlockResult = await worker.setVoiceGuardTemporaryUnlock("guild-1", 600000, "slash-unlock");
  const lockResult = await worker.clearVoiceGuardTemporaryUnlock("guild-1", "slash-lock");
  const summary = worker.getVoiceGuardRuntimeSummary("guild-1");

  assert.equal(refreshed.effectivePolicy, "return");
  assert.equal(unlockResult.label, "10m");
  assert.equal(lockResult.unlockUntil, 0);
  assert.equal(summary.lastAction, "manual-lock");
  assert.deepEqual(sent.map((entry) => entry.type), ["voiceGuardRefresh", "voiceGuardUnlock", "voiceGuardLock"]);
});

test("clearVoiceGuardTemporaryUnlockForGuild skips workers without a voice guard lock helper", async () => {
  const calls = [];
  const fakeRuntime = {
    workerManager: {
      workers: [
        {
          async clearVoiceGuardTemporaryUnlock(guildId, reason) {
            calls.push(`remote:${guildId}:${reason}`);
            return { unlockUntil: 0 };
          },
        },
        {},
      ],
    },
    async clearVoiceGuardTemporaryUnlock(guildId, reason) {
      calls.push(`local:${guildId}:${reason}`);
      return { unlockUntil: 0 };
    },
  };

  const result = await BotRuntime.prototype.clearVoiceGuardTemporaryUnlockForGuild.call(fakeRuntime, "guild-1", "slash-lock");

  assert.deepEqual(calls, ["local:guild-1:slash-lock", "remote:guild-1:slash-lock"]);
  assert.equal(result.length, 3);
  assert.equal(result[2], null);
});

test("armPlaybackRecovery keeps the worker connected and schedules a stream retry", () => {
  let scheduledRestart = null;
  let scheduledReconnect = 0;
  let persistCount = 0;
  let presenceCount = 0;
  const state = {
    connection: { joinConfig: { channelId: "voice-1" } },
    currentStationKey: null,
    currentStationName: null,
    currentMeta: { title: "Old" },
    nowPlayingSignature: "sig-1",
    shouldReconnect: false,
    lastChannelId: "voice-1",
    currentProcess: null,
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    clearCurrentProcess() {},
    clearNowPlayingTimer() {},
    updatePresence() {
      presenceCount += 1;
    },
    persistState() {
      persistCount += 1;
    },
    scheduleStreamRestart(guildId, passedState, delayMs, reason) {
      scheduledRestart = { guildId, passedState, delayMs, reason };
    },
    scheduleReconnect() {
      scheduledReconnect += 1;
    },
  };

  const recovery = armRuntimePlaybackRecovery(
    runtime,
    "guild-1",
    state,
    { stations: { rock: { name: "Rock Radio" } } },
    "rock",
    new Error("Stream konnte nicht geladen werden: 503"),
    { reason: "play-start-failed" }
  );

  assert.equal(recovery.scheduled, true);
  assert.equal(state.shouldReconnect, true);
  assert.equal(state.currentStationKey, "rock");
  assert.equal(state.currentStationName, "Rock Radio");
  assert.equal(state.currentMeta, null);
  assert.equal(state.nowPlayingSignature, null);
  assert.equal(persistCount, 1);
  assert.equal(presenceCount, 1);
  assert.equal(scheduledReconnect, 0);
  assert.equal(scheduledRestart.guildId, "guild-1");
  assert.equal(scheduledRestart.passedState, state);
  assert.equal(scheduledRestart.reason, "play-start-failed");
});

test("playInGuild returns recovering instead of leaving when initial stream start fails", async () => {
  let resetCount = 0;
  let recoveryCalls = 0;
  const state = {
    volume: 100,
    shouldReconnect: false,
    lastChannelId: null,
    currentStationKey: null,
    currentStationName: null,
  };
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM 2" };
  runtime.client = {
    guilds: {
      cache: new Map([["guild-1", { id: "guild-1" }]]),
    },
  };
  runtime.getState = () => state;
  runtime.clearScheduledEventPlayback = () => {};
  runtime.markScheduledEventPlayback = () => {};
  runtime.ensureVoiceConnectionForChannel = async () => ({ channel: { type: "voice" } });
  runtime.playStation = async () => {
    throw new Error("Stream konnte nicht geladen werden: 503");
  };
  runtime.armPlaybackRecovery = () => {
    recoveryCalls += 1;
    return { scheduled: true, message: "retry active" };
  };
  runtime.resetVoiceSession = () => {
    resetCount += 1;
  };

  const result = await BotRuntime.prototype.playInGuild.call(
    runtime,
    "guild-1",
    "voice-1",
    "rock",
    { stations: { rock: { name: "Rock Radio" } } },
    100
  );

  assert.equal(result.ok, true);
  assert.equal(result.recovering, true);
  assert.equal(recoveryCalls, 1);
  assert.equal(resetCount, 0);
  assert.equal(state.shouldReconnect, true);
  assert.equal(state.lastChannelId, "voice-1");
});

test("voice reconcile waits while a connect or reconnect is already in flight", async () => {
  const queued = [];
  let resetCount = 0;
  let reconnectCount = 0;
  const state = {
    connection: { joinConfig: { channelId: "voice-1" } },
    currentStationKey: "station-a",
    currentProcess: { pid: 1 },
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
    voiceConnectInFlight: true,
    reconnectInFlight: false,
    reconnectTimer: null,
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      isReady: () => true,
    },
    guildState: new Map([["guild-1", state]]),
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: null, channelId: null }),
    markNowPlayingTargetDirty() {},
    persistState() {},
    queueVoiceStateReconcile(guildId, reason, delayMs) {
      queued.push({ guildId, reason, delayMs });
    },
    resetVoiceSession() {
      resetCount += 1;
    },
    scheduleReconnect() {
      reconnectCount += 1;
    },
    scheduleStreamRestart() {
      throw new Error("scheduleStreamRestart should not run");
    },
    syncVoiceChannelStatus() {
      return Promise.resolve();
    },
  };

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  assert.equal(resetCount, 0);
  assert.equal(reconnectCount, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].reason, "voice-op-inflight-timer");
});

test("voice reconcile refreshes voice channel status for active playback", async () => {
  let syncCount = 0;
  const state = {
    connection: { joinConfig: { channelId: "voice-1" } },
    currentStationKey: "station-a",
    currentStationName: "Station A",
    currentProcess: { pid: 1 },
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
    voiceConnectInFlight: false,
    reconnectInFlight: false,
    reconnectTimer: null,
    streamRestartTimer: null,
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      isReady: () => true,
    },
    guildState: new Map([["guild-1", state]]),
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-1" }),
    syncVoiceChannelStatus() {
      syncCount += 1;
      return Promise.resolve();
    },
    scheduleReconnect() {
      throw new Error("scheduleReconnect should not run");
    },
    scheduleStreamRestart() {
      throw new Error("scheduleStreamRestart should not run");
    },
  };

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  assert.equal(syncCount, 1);
});

test("tryReconnect tolerates transient missing channels before clearing playback target", async () => {
  let resetCount = 0;
  const state = {
    shouldReconnect: true,
    lastChannelId: "voice-1",
    currentStationKey: "station-a",
    activeScheduledEventStopAtMs: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
    transientVoiceIssues: {},
    connection: null,
  };
  const guild = {
    channels: {
      cache: new Map(),
      fetch: async () => null,
    },
  };
  const runtime = {
    config: { name: "OmniFM Recover" },
    getState() {
      return state;
    },
    isScheduledEventStopDue() {
      return false;
    },
    client: {
      guilds: {
        cache: new Map([["guild-1", guild]]),
        fetch: async () => guild,
      },
    },
    resolveBotMember: async () => ({ id: "bot" }),
    resetVoiceSession() {
      resetCount += 1;
    },
  };

  await tryRuntimeReconnect(runtime, "guild-1");
  await tryRuntimeReconnect(runtime, "guild-1");
  assert.equal(resetCount, 0);
  assert.equal(state.transientVoiceIssues["reconnect-channel-missing"].count, 2);

  await tryRuntimeReconnect(runtime, "guild-1");
  assert.equal(resetCount, 0);
  assert.equal(state.transientVoiceIssues["reconnect-channel-missing"].count, 3);
});

test("tryReconnect clears playback target when Discord confirms a deleted reconnect channel", async () => {
  let resetCount = 0;
  const state = {
    shouldReconnect: true,
    lastChannelId: "voice-1",
    currentStationKey: "station-a",
    activeScheduledEventStopAtMs: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
    transientVoiceIssues: {},
    connection: null,
  };
  const guild = {
    channels: {
      cache: new Map(),
      fetch: async () => {
        const err = new Error("Unknown Channel");
        err.code = 10003;
        throw err;
      },
    },
  };
  const runtime = {
    config: { name: "OmniFM Recover" },
    getState() {
      return state;
    },
    isScheduledEventStopDue() {
      return false;
    },
    client: {
      guilds: {
        cache: new Map([["guild-1", guild]]),
        fetch: async () => guild,
      },
    },
    resolveBotMember: async () => ({ id: "bot" }),
    resetVoiceSession() {
      resetCount += 1;
    },
  };

  await tryRuntimeReconnect(runtime, "guild-1");
  assert.equal(resetCount, 1);
});

test("tryReconnect keeps playback target while bot member or permissions are transiently unavailable", async () => {
  let resetCount = 0;
  const state = {
    shouldReconnect: true,
    lastChannelId: "voice-1",
    currentStationKey: "station-a",
    activeScheduledEventStopAtMs: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
    transientVoiceIssues: {},
    connection: null,
  };
  const guild = {
    channels: {
      cache: new Map([["voice-1", {
        id: "voice-1",
        isVoiceBased: () => true,
        type: 2,
        permissionsFor: () => ({ has: () => false }),
      }]]),
      fetch: async () => null,
    },
  };
  const runtime = {
    config: { name: "OmniFM Recover" },
    getState() {
      return state;
    },
    isScheduledEventStopDue() {
      return false;
    },
    client: {
      guilds: {
        cache: new Map([["guild-1", guild]]),
        fetch: async () => guild,
      },
    },
    resolveBotMember: async () => ({ id: "bot" }),
    resetVoiceSession() {
      resetCount += 1;
    },
  };

  await tryRuntimeReconnect(runtime, "guild-1");
  await tryRuntimeReconnect(runtime, "guild-1");
  await tryRuntimeReconnect(runtime, "guild-1");

  assert.equal(resetCount, 0);
  assert.equal(state.transientVoiceIssues["reconnect-permissions-missing"].count, 3);
});

test("tryReconnect stops auto-reconnect after repeated permission failures", async () => {
  let resetArgs = null;
  const state = {
    shouldReconnect: true,
    lastChannelId: "voice-1",
    currentStationKey: "station-a",
    activeScheduledEventStopAtMs: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
    transientVoiceIssues: {},
    connection: null,
  };
  const guild = {
    channels: {
      cache: new Map([["voice-1", {
        id: "voice-1",
        isVoiceBased: () => true,
        type: 2,
        permissionsFor: () => ({ has: () => false }),
      }]]),
      fetch: async () => null,
    },
  };
  const runtime = {
    config: { name: "OmniFM Recover" },
    getState() {
      return state;
    },
    isScheduledEventStopDue() {
      return false;
    },
    client: {
      guilds: {
        cache: new Map([["guild-1", guild]]),
        fetch: async () => guild,
      },
    },
    resolveBotMember: async () => ({ id: "bot" }),
    resetVoiceSession(guildId, passedState, options) {
      resetArgs = { guildId, passedState, options };
    },
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await tryRuntimeReconnect(runtime, "guild-1");
  }

  assert.deepEqual(resetArgs, {
    guildId: "guild-1",
    passedState: state,
    options: {
      preservePlaybackTarget: false,
      clearLastChannel: true,
    },
  });
});

test("reconnect circuit exhaustion stops auto-reconnect entirely", () => {
  const originalSetTimeout = global.setTimeout;
  let scheduled = 0;
  global.setTimeout = () => {
    scheduled += 1;
    return { unref() {} };
  };

  try {
    let resetArgs = null;
    const state = {
      shouldReconnect: true,
      lastChannelId: "voice-1",
      currentStationKey: "station-a",
      activeScheduledEventStopAtMs: 0,
      reconnectAttempts: 30,
      reconnectCircuitTripCount: 2,
      reconnectTimer: null,
      reconnectCount: 0,
      lastReconnectAt: null,
      connection: null,
    };
    const runtime = {
      config: { name: "OmniFM 6", id: "bot-6" },
      getState() {
        return state;
      },
      isScheduledEventStopDue() {
        return false;
      },
      stopInGuild() {
        throw new Error("stopInGuild should not be called");
      },
      resetVoiceSession(guildId, passedState, options) {
        resetArgs = { guildId, passedState, options };
      },
    };

    scheduleRuntimeReconnect(runtime, "guild-1", { reason: "retry" });

    assert.equal(scheduled, 0);
    assert.deepEqual(resetArgs, {
      guildId: "guild-1",
      passedState: state,
      options: {
        preservePlaybackTarget: false,
        clearLastChannel: true,
      },
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("voice reconcile keeps the reconnect target until a channel mismatch is confirmed", async () => {
  const queued = [];
  let dirtyCount = 0;
  let persistCount = 0;
  let reconnectCount = 0;
  const state = {
    connection: { joinConfig: { channelId: "voice-1" } },
    currentStationKey: "station-a",
    currentProcess: { pid: 1 },
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      isReady: () => true,
    },
    guildState: new Map([["guild-1", state]]),
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-2" }),
    markNowPlayingTargetDirty() {
      dirtyCount += 1;
    },
    persistState() {
      persistCount += 1;
    },
    queueVoiceStateReconcile(guildId, reason, delayMs) {
      queued.push({ guildId, reason, delayMs });
    },
    resetVoiceSession() {
      throw new Error("resetVoiceSession should not run");
    },
    scheduleReconnect() {
      reconnectCount += 1;
    },
    scheduleStreamRestart() {
      throw new Error("scheduleStreamRestart should not run");
    },
    syncVoiceChannelStatus() {
      return Promise.resolve();
    },
  };

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  assert.equal(state.lastChannelId, "voice-1");
  assert.equal(dirtyCount, 0);
  assert.equal(persistCount, 0);
  assert.equal(reconnectCount, 0);
  assert.equal(queued.length, 1);
  assert.equal(state.transientVoiceIssues["voice-channel-mismatch"].count, 1);
});

test("voice reconcile syncs the remembered channel when active connection and voice state agree", async () => {
  let dirtyCount = 0;
  let persistCount = 0;
  const state = {
    connection: { joinConfig: { channelId: "voice-2" } },
    currentStationKey: "station-a",
    currentProcess: { pid: 1 },
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      isReady: () => true,
    },
    guildState: new Map([["guild-1", state]]),
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-2" }),
    markNowPlayingTargetDirty() {
      dirtyCount += 1;
    },
    persistState() {
      persistCount += 1;
    },
    queueVoiceStateReconcile() {},
    resetVoiceSession() {
      throw new Error("resetVoiceSession should not run");
    },
    scheduleReconnect() {
      throw new Error("scheduleReconnect should not run");
    },
    scheduleStreamRestart() {
      throw new Error("scheduleStreamRestart should not run");
    },
    syncVoiceChannelStatus() {
      return Promise.resolve();
    },
  };

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  assert.equal(state.lastChannelId, "voice-2");
  assert.equal(dirtyCount, 1);
  assert.equal(persistCount, 1);
  assert.equal(state.transientVoiceIssues["voice-channel-mismatch"], undefined);
});

test("voice reconcile schedules a return to the locked channel after a confirmed foreign move", async () => {
  const restoreEnv = setEnv({ VOICE_MOVE_POLICY: "return" });
  try {
    let destroyed = 0;
    let scheduledReconnect = null;
    let persistCount = 0;
    const state = {
      connection: {
        joinConfig: { channelId: "voice-1" },
        destroy() {
          destroyed += 1;
        },
      },
      currentStationKey: "station-a",
      currentProcess: { pid: 1 },
      lastChannelId: "voice-1",
      shouldReconnect: true,
      player: { state: { status: "playing" } },
      transientVoiceIssues: {
        "voice-channel-mismatch": {
          count: 1,
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          lastDetail: "voice-1:voice-2:test",
        },
      },
      voiceConnectInFlight: false,
      reconnectInFlight: false,
      reconnectTimer: null,
      voiceGuardEffectivePolicy: "return",
      voiceGuardMoveConfirmations: 2,
    };
    const runtime = {
      config: { name: "OmniFM Test" },
      client: {
        isReady: () => true,
      },
      guildState: new Map([["guild-1", state]]),
      fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-2" }),
      markNowPlayingTargetDirty() {
        throw new Error("markNowPlayingTargetDirty should not run");
      },
      persistState() {
        persistCount += 1;
      },
      queueVoiceStateReconcile() {
        throw new Error("queueVoiceStateReconcile should not run");
      },
      resetVoiceSession() {
        throw new Error("resetVoiceSession should not run");
      },
      scheduleReconnect(guildId, options) {
        scheduledReconnect = { guildId, options };
      },
      scheduleStreamRestart() {
        throw new Error("scheduleStreamRestart should not run");
      },
      syncVoiceChannelStatus() {
        throw new Error("syncVoiceChannelStatus should not run");
      },
    };

    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

    assert.equal(destroyed, 1);
    assert.equal(persistCount, 0);
    assert.equal(state.lastChannelId, "voice-1");
    assert.equal(state.transientVoiceIssues["voice-channel-mismatch"], undefined);
    assert.deepEqual(scheduledReconnect, {
      guildId: "guild-1",
      options: {
        resetAttempts: true,
        reason: "voice-channel-mismatch-guard",
      },
    });
  } finally {
    restoreEnv();
  }
});

test("voice reconcile does not let a pending reconnect timer block a guarded return", async () => {
  const restoreEnv = setEnv({ VOICE_MOVE_POLICY: "return" });
  try {
    let destroyed = 0;
    let scheduledReconnect = null;
    const state = {
      connection: {
        joinConfig: { channelId: "voice-1" },
        destroy() {
          destroyed += 1;
        },
      },
      currentStationKey: "station-a",
      currentProcess: { pid: 1 },
      lastChannelId: "voice-1",
      shouldReconnect: true,
      player: { state: { status: "playing" } },
      transientVoiceIssues: {
        "voice-channel-mismatch": {
          count: 1,
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          lastDetail: "voice-1:voice-2:test",
        },
      },
      voiceConnectInFlight: false,
      reconnectInFlight: false,
      reconnectTimer: { pending: true },
      voiceGuardEffectivePolicy: "return",
      voiceGuardMoveConfirmations: 2,
    };
    const runtime = {
      config: { name: "OmniFM Test" },
      client: {
        isReady: () => true,
      },
      guildState: new Map([["guild-1", state]]),
      fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-2" }),
      markNowPlayingTargetDirty() {
        throw new Error("markNowPlayingTargetDirty should not run");
      },
      persistState() {},
      queueVoiceStateReconcile() {
        throw new Error("queueVoiceStateReconcile should not run");
      },
      resetVoiceSession() {
        throw new Error("resetVoiceSession should not run");
      },
      scheduleReconnect(guildId, options) {
        scheduledReconnect = { guildId, options };
      },
      scheduleStreamRestart() {
        throw new Error("scheduleStreamRestart should not run");
      },
      syncVoiceChannelStatus() {
        throw new Error("syncVoiceChannelStatus should not run");
      },
    };

    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

    assert.equal(destroyed, 1);
    assert.equal(state.transientVoiceIssues["voice-channel-mismatch"], undefined);
    assert.deepEqual(scheduledReconnect, {
      guildId: "guild-1",
      options: {
        resetAttempts: true,
        reason: "voice-channel-mismatch-guard",
      },
    });
  } finally {
    restoreEnv();
  }
});

test("voice reconcile still returns an active session when shouldReconnect is false", async () => {
  const restoreEnv = setEnv({ VOICE_MOVE_POLICY: "return" });
  try {
    let destroyed = 0;
    let scheduledReconnect = null;
    const state = {
      connection: {
        joinConfig: { channelId: "voice-1" },
        destroy() {
          destroyed += 1;
        },
      },
      currentStationKey: "station-a",
      currentProcess: { pid: 1 },
      lastChannelId: "voice-1",
      shouldReconnect: false,
      player: { state: { status: "playing" } },
      transientVoiceIssues: {
        "voice-channel-mismatch": {
          count: 1,
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          lastDetail: "voice-1:voice-2:test",
        },
      },
      voiceConnectInFlight: false,
      reconnectInFlight: false,
      reconnectTimer: null,
      voiceGuardEffectivePolicy: "return",
      voiceGuardMoveConfirmations: 2,
    };
    const runtime = {
      config: { name: "OmniFM Test" },
      client: {
        isReady: () => true,
      },
      guildState: new Map([["guild-1", state]]),
      fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-2" }),
      markNowPlayingTargetDirty() {
        throw new Error("markNowPlayingTargetDirty should not run");
      },
      persistState() {},
      queueVoiceStateReconcile() {
        throw new Error("queueVoiceStateReconcile should not run");
      },
      resetVoiceSession() {
        throw new Error("resetVoiceSession should not run");
      },
      scheduleReconnect(guildId, options) {
        scheduledReconnect = { guildId, options };
      },
      scheduleStreamRestart() {
        throw new Error("scheduleStreamRestart should not run");
      },
      syncVoiceChannelStatus() {
        return Promise.resolve();
      },
    };

    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

    assert.equal(destroyed, 1);
    assert.equal(state.voiceGuardReturnCount, 1);
    assert.equal(scheduledReconnect.guildId, "guild-1");
    assert.equal(scheduledReconnect.options.reason, "voice-channel-mismatch-guard");
  } finally {
    restoreEnv();
  }
});

test("voice reconcile can disconnect instead of accepting a confirmed foreign move", async () => {
  const restoreEnv = setEnv({ VOICE_MOVE_POLICY: "disconnect" });
  try {
    let resetArgs = null;
    const state = {
      connection: { joinConfig: { channelId: "voice-1" } },
      currentStationKey: "station-a",
      currentProcess: { pid: 1 },
      lastChannelId: "voice-1",
      shouldReconnect: true,
      player: { state: { status: "playing" } },
      transientVoiceIssues: {
        "voice-channel-mismatch": {
          count: 1,
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          lastDetail: "voice-1:voice-2:test",
        },
      },
      voiceConnectInFlight: false,
      reconnectInFlight: false,
      reconnectTimer: null,
      voiceGuardEffectivePolicy: "disconnect",
      voiceGuardMoveConfirmations: 2,
    };
    const runtime = {
      config: { name: "OmniFM Test" },
      client: {
        isReady: () => true,
      },
      guildState: new Map([["guild-1", state]]),
      fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-2" }),
      markNowPlayingTargetDirty() {
        throw new Error("markNowPlayingTargetDirty should not run");
      },
      persistState() {
        throw new Error("persistState should not run");
      },
      queueVoiceStateReconcile() {
        throw new Error("queueVoiceStateReconcile should not run");
      },
      resetVoiceSession(guildId, passedState, options) {
        resetArgs = { guildId, passedState, options };
      },
      scheduleReconnect() {
        throw new Error("scheduleReconnect should not run");
      },
      scheduleStreamRestart() {
        throw new Error("scheduleStreamRestart should not run");
      },
      syncVoiceChannelStatus() {
        throw new Error("syncVoiceChannelStatus should not run");
      },
    };

    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

    assert.equal(state.shouldReconnect, false);
    assert.equal(state.transientVoiceIssues["voice-channel-mismatch"], undefined);
    assert.deepEqual(resetArgs, {
      guildId: "guild-1",
      passedState: state,
      options: {
        preservePlaybackTarget: false,
        clearLastChannel: true,
      },
    });
  } finally {
    restoreEnv();
  }
});

test("voiceStateUpdate accepts a foreign move while the voice guard is temporarily unlocked", () => {
  const queued = [];
  let persistCount = 0;
  const state = {
    shouldReconnect: true,
    currentStationKey: "station-a",
    lastChannelId: "voice-1",
    connection: { joinConfig: { channelId: "voice-1" } },
    transientVoiceIssues: {},
    voiceConnectInFlight: false,
    reconnectInFlight: false,
    reconnectTimer: null,
    voiceDisconnectObservedAt: 0,
    voiceGuardEffectivePolicy: "return",
    voiceGuardUnlockUntil: Date.now() + 60_000,
  };
  const runtime = {
    client: {
      user: { id: "bot-1" },
    },
    config: { name: "OmniFM Test" },
    getState() {
      return state;
    },
    markNowPlayingTargetDirty() {},
    invalidateVoiceStatus() {},
    persistState() {
      persistCount += 1;
    },
    queueVoiceStateReconcile(guildId, reason) {
      queued.push({ guildId, reason });
    },
    clearReconnectTimer() {},
    syncVoiceChannelStatus() {
      return Promise.resolve();
    },
  };

  handleRuntimeBotVoiceStateUpdate(
    runtime,
    { channelId: "voice-1" },
    { id: "bot-1", guild: { id: "guild-1" }, channelId: "voice-2" }
  );

  assert.equal(state.lastChannelId, "voice-2");
  assert.equal(persistCount, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].reason, "voice-state-update");
});

test("voice reconcile escalates repeated foreign moves to a disconnect", async () => {
  const restoreEnv = setEnv({ VOICE_MOVE_POLICY: "return" });
  try {
    let resetArgs = null;
    const nowMs = Date.now();
    const state = {
      connection: { joinConfig: { channelId: "voice-1" } },
      currentStationKey: "station-a",
      currentProcess: { pid: 1 },
      lastChannelId: "voice-1",
      shouldReconnect: true,
      player: { state: { status: "playing" } },
      transientVoiceIssues: {
        "voice-channel-mismatch": {
          count: 1,
          firstSeenAt: nowMs - 1000,
          lastSeenAt: nowMs - 500,
          lastDetail: "voice-1:voice-2:test",
        },
      },
      voiceConnectInFlight: false,
      reconnectInFlight: false,
      reconnectTimer: null,
      voiceGuardEffectivePolicy: "return",
      voiceGuardMoveConfirmations: 2,
      voiceGuardMoveWindowMs: 120000,
      voiceGuardMaxMovesPerWindow: 2,
      voiceGuardEscalation: "disconnect",
      voiceGuardWindowStartedAt: nowMs - 20_000,
      voiceGuardWindowMoveCount: 1,
      voiceGuardMoveCount: 1,
    };
    const runtime = {
      config: { name: "OmniFM Test" },
      client: {
        isReady: () => true,
      },
      guildState: new Map([["guild-1", state]]),
      fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-2" }),
      markNowPlayingTargetDirty() {
        throw new Error("markNowPlayingTargetDirty should not run");
      },
      persistState() {},
      queueVoiceStateReconcile() {
        throw new Error("queueVoiceStateReconcile should not run");
      },
      resetVoiceSession(guildId, passedState, options) {
        resetArgs = { guildId, passedState, options };
      },
      scheduleReconnect() {
        throw new Error("scheduleReconnect should not run");
      },
      scheduleStreamRestart() {
        throw new Error("scheduleStreamRestart should not run");
      },
      syncVoiceChannelStatus() {
        throw new Error("syncVoiceChannelStatus should not run");
      },
    };

    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

    assert.equal(state.shouldReconnect, false);
    assert.equal(state.voiceGuardMoveCount, 2);
    assert.equal(state.voiceGuardEscalationCount, 1);
    assert.equal(state.voiceGuardDisconnectCount, 1);
    assert.equal(state.voiceGuardLastAction, "disconnect");
    assert.deepEqual(resetArgs, {
      guildId: "guild-1",
      passedState: state,
      options: {
        preservePlaybackTarget: false,
        clearLastChannel: true,
      },
    });
  } finally {
    restoreEnv();
  }
});

test("voice reconcile treats a missing local handle as stale state while playback is still active", async () => {
  const queued = [];
  let reconnectCount = 0;
  const state = {
    connection: null,
    currentStationKey: "station-a",
    currentStationName: "Station A",
    currentProcess: { pid: 42 },
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
    voiceConnectInFlight: false,
    reconnectInFlight: false,
    reconnectTimer: null,
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      isReady: () => true,
    },
    guildState: new Map([["guild-1", state]]),
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-1" }),
    markNowPlayingTargetDirty() {},
    persistState() {},
    queueVoiceStateReconcile(guildId, reason, delayMs) {
      queued.push({ guildId, reason, delayMs });
    },
    resetVoiceSession() {
      throw new Error("resetVoiceSession should not run");
    },
    scheduleReconnect() {
      reconnectCount += 1;
    },
    scheduleStreamRestart() {
      throw new Error("scheduleStreamRestart should not run");
    },
    syncVoiceChannelStatus() {
      throw new Error("syncVoiceChannelStatus should not run");
    },
  };

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(reconnectCount, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].reason, "voice-local-connection-confirm-timer");
  assert.equal(state.transientVoiceIssues["voice-local-connection-missing"].count, 1);

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(reconnectCount, 0);
  assert.equal(queued.length, 2);
  assert.equal(queued[1].reason, "voice-local-stale-timer");
  assert.ok(queued[1].delayMs >= 8_000);
  assert.equal(state.transientVoiceIssues["voice-local-connection-missing"].count, 2);
});

test("voice reconcile forces a reconnect when the local handle is missing and playback is idle", async () => {
  const queued = [];
  const reconnectCalls = [];
  const state = {
    connection: null,
    currentStationKey: "station-a",
    currentStationName: "Station A",
    currentProcess: null,
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "idle" } },
    transientVoiceIssues: {},
    voiceConnectInFlight: false,
    reconnectInFlight: false,
    reconnectTimer: null,
  };
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      isReady: () => true,
    },
    guildState: new Map([["guild-1", state]]),
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-1" }),
    markNowPlayingTargetDirty() {},
    persistState() {},
    queueVoiceStateReconcile(guildId, reason, delayMs) {
      queued.push({ guildId, reason, delayMs });
    },
    resetVoiceSession() {
      throw new Error("resetVoiceSession should not run");
    },
    scheduleReconnect(guildId, options = {}) {
      reconnectCalls.push({ guildId, options });
    },
    scheduleStreamRestart() {
      throw new Error("scheduleStreamRestart should not run");
    },
    syncVoiceChannelStatus() {
      throw new Error("syncVoiceChannelStatus should not run");
    },
  };

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(reconnectCalls.length, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].reason, "voice-local-connection-confirm-timer");
  assert.equal(state.transientVoiceIssues["voice-local-connection-missing"].count, 1);

  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(reconnectCalls.length, 1);
  assert.deepEqual(reconnectCalls[0], {
    guildId: "guild-1",
    options: {
      resetAttempts: true,
      reason: "voice-local-stale-timer",
    },
  });
  assert.equal(queued.length, 1);
  assert.equal(state.transientVoiceIssues["voice-local-connection-missing"], undefined);
});

test("voice state update without auto reconnect resets the voice session exactly once", () => {
  const state = {
    shouldReconnect: false,
    currentStationKey: "station-a",
    lastChannelId: "voice-1",
  };
  let resetCalls = 0;
  const runtime = {
    config: { name: "OmniFM Test" },
    client: {
      user: { id: "bot-1" },
    },
    getState() {
      return state;
    },
    resetVoiceSession(guildId, passedState, options) {
      resetCalls += 1;
      assert.equal(guildId, "guild-1");
      assert.equal(passedState, state);
      assert.deepEqual(options, {
        preservePlaybackTarget: false,
        clearLastChannel: true,
      });
    },
    scheduleReconnect() {
      throw new Error("scheduleReconnect should not run");
    },
    markNowPlayingTargetDirty() {},
    clearReconnectTimer() {},
    persistState() {},
    queueVoiceStateReconcile() {},
  };

  handleRuntimeBotVoiceStateUpdate(
    runtime,
    {
      channelId: "voice-1",
    },
    {
      id: "bot-1",
      guild: { id: "guild-1" },
      channelId: null,
    }
  );

  assert.equal(resetCalls, 1);
});

test("restore keeps saved state and schedules retry when the guild is transiently unavailable", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    scheduled.push(timer);
    return timer;
  };

  try {
    const runtime = {
      config: { name: "OmniFM Restore", id: "bot-1" },
      guildState: new Map(),
      client: {
        guilds: {
          cache: new Map(),
          fetch: async () => {
            const err = new Error("temporary gateway outage");
            err.code = "ECONNRESET";
            throw err;
          },
        },
      },
    };

    const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
      channelId: "voice-1",
      stationKey: "station-a",
      volume: 100,
    });

    assert.equal(result.ok, false);
    assert.equal(result.transient, true);
    assert.equal(result.resource, "guild");
    assert.equal(runtime.pendingRestoreTimers instanceof Map, true);
    assert.equal(runtime.pendingRestoreTimers.size, 1);
    assert.equal(runtime.restoreRetryCounts instanceof Map, true);
    assert.equal(runtime.restoreRetryCounts.get("guild-1"), 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay >= 5_000, true);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("restore keeps saved state and schedules retry when the voice channel is transiently unavailable", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    scheduled.push(timer);
    return timer;
  };

  try {
    const guild = {
      id: "guild-1",
      name: "Guild One",
      channels: {
        cache: new Map(),
        fetch: async () => {
          const err = new Error("temporary channel fetch failure");
          err.code = "ETIMEDOUT";
          throw err;
        },
      },
    };
    const runtime = {
      config: { name: "OmniFM Restore", id: "bot-1" },
      guildState: new Map(),
      client: {
        guilds: {
          cache: new Map(),
          fetch: async () => guild,
        },
      },
      enforceGuildAccessForGuild: async () => true,
    };

    const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
      channelId: "voice-1",
      stationKey: "station-a",
      volume: 100,
    });

    assert.equal(result.ok, false);
    assert.equal(result.transient, true);
    assert.equal(result.resource, "channel");
    assert.equal(runtime.pendingRestoreTimers instanceof Map, true);
    assert.equal(runtime.pendingRestoreTimers.size, 1);
    assert.equal(runtime.restoreRetryCounts instanceof Map, true);
    assert.equal(runtime.restoreRetryCounts.get("guild-1"), 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay >= 5_000, true);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("restore rejoins the saved channel and restarts the same station", async () => {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, _delay) => {
    fn();
    return { unref() {} };
  };

  try {
    const channel = {
      id: "voice-1",
      name: "Radio",
      isVoiceBased: () => true,
    };
    const guild = {
      id: "guild-1",
      name: "Guild One",
      channels: {
        cache: new Map([["voice-1", channel]]),
        fetch: async () => channel,
      },
    };
    const state = {
      volume: 50,
      shouldReconnect: false,
      lastChannelId: null,
      currentStationKey: null,
      currentStationName: null,
      connection: null,
    };
    const calls = [];
    const runtime = {
      config: { name: "OmniFM Restore", id: "bot-restore-success" },
      guildState: new Map(),
      client: {
        guilds: {
          cache: new Map([["guild-1", guild]]),
          fetch: async () => guild,
        },
      },
      getState(passedGuildId) {
        this.guildState.set(passedGuildId, state);
        return state;
      },
      enforceGuildAccessForGuild: async () => true,
      resolveGuildLanguage: () => "en",
      resolveStationForGuild: (_guildId, stationKey) => ({
        ok: true,
        key: stationKey,
        station: { name: "Rock Radio" },
        stations: { stations: { [stationKey]: { name: "Rock Radio", url: "https://example.com/stream" } } },
      }),
      markScheduledEventPlayback(passedState, eventId, stopAtMs) {
        passedState.activeScheduledEventId = eventId;
        passedState.activeScheduledEventStopAtMs = stopAtMs;
      },
      persistState() {
        calls.push("persist");
      },
      ensureVoiceConnectionForChannel: async (passedGuildId, passedChannelId, passedState) => {
        calls.push(`ensure:${passedGuildId}:${passedChannelId}`);
        passedState.connection = { joinConfig: { channelId: passedChannelId } };
      },
      playStation: async (passedState, _stations, stationKey, passedGuildId) => {
        calls.push(`play:${passedGuildId}:${stationKey}`);
        passedState.currentStationKey = stationKey;
      },
    };

    const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
      channelId: "voice-1",
      stationKey: "station-a",
      volume: 77,
      scheduledEventId: "event-1",
      scheduledEventStopAtMs: 12345,
      restoreBlockedUntil: Date.now() - 1_000,
      restoreBlockCount: 2,
      restoreBlockReason: "worker-autoheal",
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(state.volume, 77);
    assert.equal(state.shouldReconnect, true);
    assert.equal(state.lastChannelId, "voice-1");
    assert.equal(state.currentStationKey, "station-a");
    assert.equal(state.currentStationName, "Rock Radio");
    assert.equal(state.activeScheduledEventId, "event-1");
    assert.equal(state.activeScheduledEventStopAtMs, 12345);
    assert.equal(state.restoreBlockedUntil, 0);
    assert.equal(state.restoreBlockCount, 0);
    assert.equal(state.restoreBlockReason, null);
    assert.deepEqual(calls, [
      "persist",
      "ensure:guild-1:voice-1",
      "play:guild-1:station-a",
    ]);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("restore clears persisted state when Discord reports the guild as permanently unavailable", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-permanent-guild": {
      "guild-1": {
        channelId: "voice-1",
        stationKey: "station-a",
        volume: 100,
      },
    },
  });

  const runtime = {
    config: { name: "OmniFM Restore", id: "bot-permanent-guild" },
    guildState: new Map(),
    client: {
      guilds: {
        cache: new Map(),
        fetch: async () => {
          const err = new Error("Unknown Guild");
          err.code = 10004;
          throw err;
        },
      },
    },
  };

  const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
    channelId: "voice-1",
    stationKey: "station-a",
    volume: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.permanent, true);
  assert.equal(result.resource, "guild");
  assert.equal(getBotState("bot-permanent-guild")["guild-1"]?.volume, 100);
  assert.equal(getBotState("bot-permanent-guild")["guild-1"]?.volumePreference, true);
  assert.equal(getBotState("bot-permanent-guild")["guild-1"]?.stationKey, undefined);
  assert.equal(getBotState("bot-permanent-guild")["guild-1"]?.channelId, undefined);
});

test("restore clears persisted state when Discord reports the voice channel as deleted", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-permanent-channel": {
      "guild-1": {
        channelId: "voice-1",
        stationKey: "station-a",
        volume: 100,
      },
    },
  });

  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map(),
      fetch: async () => {
        const err = new Error("Unknown Channel");
        err.code = 10003;
        throw err;
      },
    },
  };
  const runtime = {
    config: { name: "OmniFM Restore", id: "bot-permanent-channel" },
    guildState: new Map(),
    client: {
      guilds: {
        cache: new Map(),
        fetch: async () => guild,
      },
    },
    enforceGuildAccessForGuild: async () => true,
  };

  const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
    channelId: "voice-1",
    stationKey: "station-a",
    volume: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.permanent, true);
  assert.equal(result.resource, "channel");
  assert.equal(getBotState("bot-permanent-channel")["guild-1"]?.volume, 100);
  assert.equal(getBotState("bot-permanent-channel")["guild-1"]?.volumePreference, true);
  assert.equal(getBotState("bot-permanent-channel")["guild-1"]?.stationKey, undefined);
  assert.equal(getBotState("bot-permanent-channel")["guild-1"]?.channelId, undefined);
});

test("restore clears persisted state when the saved channel is no longer a voice channel", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-channel-type": {
      "guild-1": {
        channelId: "voice-1",
        stationKey: "station-a",
        volume: 100,
      },
    },
  });

  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map(),
      fetch: async () => ({
        id: "voice-1",
        name: "general",
        isVoiceBased: () => false,
      }),
    },
  };
  const runtime = {
    config: { name: "OmniFM Restore", id: "bot-channel-type" },
    guildState: new Map(),
    client: {
      guilds: {
        cache: new Map(),
        fetch: async () => guild,
      },
    },
    enforceGuildAccessForGuild: async () => true,
  };

  const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
    channelId: "voice-1",
    stationKey: "station-a",
    volume: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.permanent, true);
  assert.equal(result.resource, "channel-type");
  assert.equal(getBotState("bot-channel-type")["guild-1"]?.volume, 100);
  assert.equal(getBotState("bot-channel-type")["guild-1"]?.volumePreference, true);
  assert.equal(getBotState("bot-channel-type")["guild-1"]?.stationKey, undefined);
  assert.equal(getBotState("bot-channel-type")["guild-1"]?.channelId, undefined);
});

test("restore clears persisted state only when the saved station is permanently missing", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-missing-station": {
      "guild-1": {
        channelId: "voice-1",
        stationKey: "station-a",
        volume: 100,
      },
    },
  });

  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map(),
      fetch: async () => ({
        id: "voice-1",
        name: "Radio",
        isVoiceBased: () => true,
      }),
    },
  };
  const runtime = {
    config: { name: "OmniFM Restore", id: "bot-missing-station" },
    guildState: new Map(),
    client: {
      guilds: {
        cache: new Map(),
        fetch: async () => guild,
      },
    },
    enforceGuildAccessForGuild: async () => true,
    resolveGuildLanguage: () => "en",
    resolveStationForGuild: () => ({
      ok: false,
      message: "station missing",
    }),
  };

  const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
    channelId: "voice-1",
    stationKey: "station-a",
    volume: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.permanent, true);
  assert.equal(result.resource, "station");
  assert.equal(getBotState("bot-missing-station")["guild-1"]?.volume, 100);
  assert.equal(getBotState("bot-missing-station")["guild-1"]?.volumePreference, true);
  assert.equal(getBotState("bot-missing-station")["guild-1"]?.stationKey, undefined);
  assert.equal(getBotState("bot-missing-station")["guild-1"]?.channelId, undefined);
});

test("persistState stores reconnectable guilds even without a live voice connection", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({});

  const runtime = {
    config: { name: "OmniFM Persist", id: "bot-persist-reconnect" },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-a",
        currentStationName: "Station A",
        lastChannelId: "voice-7",
        connection: null,
        volume: 77,
        activeScheduledEventId: null,
        activeScheduledEventStopAtMs: 0,
      }],
    ]),
    lastPersistLoggedPersistableCount: null,
    lastPersistLoggedActiveCount: null,
  };

  BotRuntime.prototype.persistState.call(runtime);

  const saved = getBotState("bot-persist-reconnect");
  assert.equal(saved["guild-1"]?.channelId, "voice-7");
  assert.equal(saved["guild-1"]?.stationKey, "station-a");
  assert.equal(saved["guild-1"]?.stationName, "Station A");
  assert.equal(saved["guild-1"]?.volume, 77);
});

test("setVolumeInGuild persists a worker volume preference even without active playback", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({});

  const runtime = {
    config: { id: "bot-volume-pref", name: "OmniFM Volume" },
    guildState: new Map(),
    getState: BotRuntime.prototype.getState,
    persistState: BotRuntime.prototype.persistState,
    lastPersistLoggedPersistableCount: null,
    lastPersistLoggedActiveCount: null,
  };

  const result = await BotRuntime.prototype.setVolumeInGuild.call(runtime, "guild-1", 37);

  assert.equal(result.ok, true);
  assert.equal(result.appliedLive, false);
  assert.equal(result.value, 37);

  const saved = getBotState("bot-volume-pref");
  assert.equal(saved["guild-1"]?.volume, 37);
  assert.equal(saved["guild-1"]?.volumePreference, true);
  assert.equal(saved["guild-1"]?.stationKey, undefined);
  assert.equal(saved["guild-1"]?.channelId, undefined);
});

test("setVolumeInGuild refreshes the now-playing embed and keeps zero volume intact", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({});

  const liveVolumes = [];
  const nowPlayingUpdates = [];
  const runtime = {
    config: { id: "bot-live-volume", name: "OmniFM Live" },
    guildState: new Map([[
      "guild-1",
      {
        player: {
          state: {
            resource: {
              volume: {
                setVolume(value) {
                  liveVolumes.push(value);
                },
              },
            },
          },
        },
        currentStationKey: "station-a",
        currentStationName: "Station A",
        connection: { joinConfig: { channelId: "voice-1" } },
        lastChannelId: "voice-1",
        volume: 55,
      },
    ]]),
    getState: BotRuntime.prototype.getState,
    persistState() {},
    updateNowPlayingEmbed: async (guildId, state, options = {}) => {
      nowPlayingUpdates.push({
        guildId,
        volume: state.volume,
        force: options.force === true,
      });
    },
  };

  const result = await BotRuntime.prototype.setVolumeInGuild.call(runtime, "guild-1", 0);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(result.ok, true);
  assert.equal(result.appliedLive, true);
  assert.equal(result.value, 0);
  assert.deepEqual(liveVolumes, [0]);
  assert.deepEqual(nowPlayingUpdates, [{ guildId: "guild-1", volume: 0, force: true }]);
  assert.equal(runtime.guildState.get("guild-1")?.volume, 0);

  const saved = getBotState("bot-live-volume");
  assert.equal(saved["guild-1"]?.volume, 0);
  assert.equal(saved["guild-1"]?.volumePreference, true);
});

test("setVolumeInGuild refreshes the now-playing embed when Discord still reports active voice playback", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({});

  const nowPlayingUpdates = [];
  const runtime = {
    config: { id: "bot-live-volume-observed", name: "OmniFM Live" },
    client: {
      guilds: {
        cache: new Map([["guild-1", {
          members: {
            me: {
              voice: {
                channelId: "voice-1",
              },
            },
          },
        }]]),
      },
    },
    guildState: new Map([[
      "guild-1",
      {
        player: {
          state: {
            status: "playing",
            resource: {
              volume: {
                setVolume(value) {
                  return value;
                },
              },
            },
          },
        },
        currentProcess: { pid: 42 },
        currentStationKey: "station-a",
        currentStationName: "Station A",
        connection: null,
        lastChannelId: null,
        volume: 55,
      },
    ]]),
    getState: BotRuntime.prototype.getState,
    persistState() {},
    updateNowPlayingEmbed: async (guildId, state, options = {}) => {
      nowPlayingUpdates.push({
        guildId,
        volume: state.volume,
        force: options.force === true,
      });
    },
  };

  const result = await BotRuntime.prototype.setVolumeInGuild.call(runtime, "guild-1", 12);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(result.ok, true);
  assert.equal(result.playing, true);
  assert.deepEqual(nowPlayingUpdates, [{ guildId: "guild-1", volume: 12, force: true }]);
});

test("updateNowPlayingEmbed keeps refreshing when Discord still reports the worker in voice", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    headers: {
      get() {
        return null;
      },
    },
    body: null,
  });

  try {
    let payloadContext = null;
    let upsertCalls = 0;

    const runtime = Object.create(BotRuntime.prototype);
    runtime.config = { id: "bot-now-observed", name: "OmniFM Now" };
    runtime.client = {
      user: {
        id: "bot-now-observed",
        displayAvatarURL: () => null,
      },
      guilds: {
        cache: new Map([["guild-1", {
          members: {
            me: {
              voice: {
                channelId: "voice-77",
              },
            },
          },
          voiceStates: {
            cache: new Map(),
          },
        }]]),
      },
    };
    runtime.getResolvedCurrentStation = () => ({
      station: {
        name: "Tomorrowland One World Radio",
        url: "https://example.com/live",
      },
    });
    runtime.resolveNowPlayingChannel = async () => ({ id: "text-1" });
    runtime.recordSongHistory = () => {};
    runtime.getCurrentListenerCount = () => 2;
    runtime.buildNowPlayingMessagePayload = (guildId, station, meta, context = {}) => {
      payloadContext = context;
      return { embeds: [], components: [] };
    };
    runtime.upsertNowPlayingMessage = async () => {
      upsertCalls += 1;
      return true;
    };
    runtime.logNowPlayingIssue = () => {};

    const state = {
      currentStationKey: "station-a",
      currentStationName: "Tomorrowland One World Radio",
      currentMeta: null,
      currentProcess: { pid: 1 },
      player: {
        state: {
          status: "playing",
        },
      },
      connection: null,
      lastChannelId: null,
      nowPlayingSignature: null,
      volume: 25,
    };

    await BotRuntime.prototype.updateNowPlayingEmbed.call(runtime, "guild-1", state, { force: true });

    assert.equal(upsertCalls, 1);
    assert.equal(payloadContext?.channelId, "voice-77");
    assert.equal(payloadContext?.volume, 25);
    assert.ok(state.currentMeta);
  } finally {
    global.fetch = originalFetch;
  }
});

test("applyVolumeTransformerLevel prefers logarithmic scaling for perceived volume", () => {
  const calls = [];
  const transformer = {
    setVolumeLogarithmic(value) {
      calls.push({ type: "logarithmic", value });
    },
    setVolume(value) {
      calls.push({ type: "linear", value });
    },
  };

  const applied = applyVolumeTransformerLevel(transformer, 50);

  assert.equal(applied, true);
  assert.deepEqual(calls, [{ type: "logarithmic", value: 0.5 }]);
});

test("playInGuild reuses the stored guild volume when no explicit volume is provided", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-play-volume": {
      "guild-1": {
        volume: 41,
        volumePreference: true,
        savedAt: new Date().toISOString(),
      },
    },
  });

  const observed = [];
  const guild = {
    id: "guild-1",
    voiceAdapterCreator: () => ({}),
  };
  const runtime = {
    config: { id: "bot-play-volume", name: "OmniFM Worker" },
    guildState: new Map(),
    client: {
      guilds: {
        cache: new Map([["guild-1", guild]]),
      },
    },
    getState: BotRuntime.prototype.getState,
    clearRestoreRetry() {},
    markScheduledEventPlayback() {},
    clearScheduledEventPlayback() {},
    ensureVoiceConnectionForChannel: async (_guildId, channelId, state) => {
      state.connection = { joinConfig: { channelId } };
      return {
        guild,
        channel: {
          id: channelId,
          type: ChannelType.GuildVoice,
        },
      };
    },
    playStation: async (state) => {
      observed.push(state.volume);
      state.currentStationKey = "station-a";
      state.currentStationName = "Station A";
    },
    ensureStageChannelReady: async () => {},
    updatePresence() {},
    scheduleReconnect() {},
    armPlaybackRecovery() {
      return { scheduled: false };
    },
    resetVoiceSession() {},
  };

  const result = await BotRuntime.prototype.playInGuild.call(
    runtime,
    "guild-1",
    "voice-1",
    "station-a",
    {
      stations: {
        "station-a": { name: "Station A" },
      },
    },
    undefined
  );

  assert.equal(result.ok, true);
  assert.deepEqual(observed, [41]);
  assert.equal(runtime.guildState.get("guild-1")?.volume, 41);
  assert.equal(runtime.guildState.get("guild-1")?.volumePreferenceSet, true);
});

test("restoreRuntimeState skips volume-only entries without trying to reconnect", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-volume-only": {
      "guild-1": {
        volume: 55,
        volumePreference: true,
        savedAt: new Date().toISOString(),
      },
    },
  });

  const runtime = {
    config: { id: "bot-volume-only", name: "OmniFM Restore" },
    guildState: new Map(),
    ensureVoiceConnectionForChannel: async () => {
      throw new Error("restore should not connect for volume-only entries");
    },
    playStation: async () => {
      throw new Error("restore should not play for volume-only entries");
    },
  };

  await restoreRuntimeState(runtime, {});

  assert.equal(runtime.guildState.size, 0);
});

test("restore respects temporary cooldowns and schedules a later resume", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    scheduled.push(timer);
    return timer;
  };

  try {
    const blockedUntil = Date.now() + 60_000;
    const runtime = {
      config: { id: "bot-restore-blocked", name: "OmniFM Restore" },
      guildState: new Map(),
    };

    const result = await restoreRuntimeGuildEntry(runtime, "guild-1", {
      channelId: "voice-1",
      stationKey: "station-a",
      volume: 100,
      restoreBlockedUntil: blockedUntil,
      restoreBlockedAt: Date.now(),
      restoreBlockCount: 2,
      restoreBlockReason: "worker-autoheal",
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.retryScheduled, true);
    assert.equal(runtime.pendingRestoreTimers instanceof Map, true);
    assert.equal(runtime.pendingRestoreTimers.size, 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay > 0, true);
    assert.equal(scheduled[0].delay <= 60_000, true);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("worker bridge keeps mute volume and omitted play volume intact", async () => {
  const calls = [];
  const service = new WorkerBridgeService({
    config: { id: "bot-bridge", name: "OmniFM Bridge" },
    setVolumeInGuild(guildId, value) {
      calls.push({ type: "setVolume", guildId, value });
      return { ok: true };
    },
    playInGuild(guildId, channelId, stationKey, stationsData, volume, options) {
      calls.push({
        type: "play",
        guildId,
        channelId,
        stationKey,
        stationsData,
        volume,
        options,
      });
      return { ok: true };
    },
  });

  await service.executeCommand({
    type: "setVolume",
    payload: {
      guildId: "guild-1",
      value: 0,
    },
  });

  await service.executeCommand({
    type: "play",
    payload: {
      guildId: "guild-1",
      channelId: "voice-1",
      stationKey: "station-a",
      stationsData: { stations: {} },
      options: { test: true },
    },
  });

  assert.deepEqual(calls, [
    { type: "setVolume", guildId: "guild-1", value: 0 },
    {
      type: "play",
      guildId: "guild-1",
      channelId: "voice-1",
      stationKey: "station-a",
      stationsData: { stations: {} },
      volume: undefined,
      options: { test: true },
    },
  ]);
});

test("remote worker handle preserves zero volume in guild details", () => {
  const worker = new RemoteWorkerHandle({ id: "bot-remote-zero", name: "OmniFM Remote" });
  worker.applyRemoteStatus({
    heartbeatAt: new Date().toISOString(),
    status: {
      ready: true,
      guildDetails: [{
        guildId: "guild-1",
        guildName: "Guild One",
        channelId: "voice-1",
        channelName: "Radio",
        playing: true,
        stationKey: "station-a",
        stationName: "Station A",
        volume: 0,
        listenerCount: 2,
      }],
    },
  });

  assert.equal(worker.getState("guild-1")?.volume, 0);
  assert.equal(worker.getGuildInfo("guild-1")?.volume, 0);
});

test("remote worker handle does not fabricate a live voice member for recovering guilds", () => {
  const worker = new RemoteWorkerHandle({ id: "bot-remote-recovering", name: "OmniFM Remote" });
  worker.applyRemoteStatus({
    heartbeatAt: new Date().toISOString(),
    status: {
      ready: true,
      guildDetails: [{
        guildId: "guild-1",
        guildName: "Guild One",
        channelId: "voice-1",
        channelName: "Radio",
        playing: false,
        voiceConnected: false,
        recovering: true,
        shouldReconnect: true,
        stationKey: "station-a",
        stationName: "Station A",
      }],
    },
    guilds: [{
      guildId: "guild-1",
      guildName: "Guild One",
    }],
  });

  const guild = worker.client.guilds.cache.get("guild-1");
  assert.equal(worker.getState("guild-1")?.connection, null);
  assert.equal(guild?.members?.me || null, null);
});

test("buildNowPlayingEmbed shows the current worker volume", () => {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-now-volume", name: "OmniFM Embed" };
  runtime.client = {
    user: {
      displayAvatarURL: () => null,
    },
  };
  runtime.resolveGuildLanguage = () => "de";

  const embed = BotRuntime.prototype.buildNowPlayingEmbed.call(
    runtime,
    "guild-1",
    { name: "Reggaeton FM" },
    {
      artist: "Artist",
      title: "Track",
      displayTitle: "Artist - Track",
      metadataSource: "icy",
      metadataStatus: "ok",
      updatedAt: new Date().toISOString(),
    },
    {
      channelId: "voice-1",
      listenerCount: 3,
      volume: 37,
      workerName: "OmniFM 4",
    }
  );

  const volumeField = (embed.data.fields || []).find((field) => String(field?.name || "").includes("Lautst"));
  assert.equal(volumeField?.value, "37%");
});

test("restoreState reconnects the saved radio in the same voice channel", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-restore-cycle": {
      "guild-1": {
        channelId: "voice-9",
        stationKey: "station-a",
        volume: 64,
      },
    },
  });

  const calls = [];
  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map([
        ["voice-9", {
          id: "voice-9",
          name: "Radio",
          isVoiceBased: () => true,
        }],
      ]),
      fetch: async () => null,
    },
  };
  const runtime = {
    config: { name: "OmniFM Restore", id: "bot-restore-cycle" },
    guildState: new Map(),
    pendingRestoreTimers: new Map(),
    restoreRetryCounts: new Map(),
    client: {
      guilds: {
        cache: new Map([
          ["guild-1", guild],
        ]),
        fetch: async () => guild,
      },
    },
    getState(guildId) {
      if (!this.guildState.has(guildId)) {
        this.guildState.set(guildId, {});
      }
      return this.guildState.get(guildId);
    },
    enforceGuildAccessForGuild: async () => true,
    resolveGuildLanguage: () => "en",
    resolveStationForGuild: () => ({
      ok: true,
      key: "station-a",
      station: { name: "Station A" },
      stations: {
        stations: {
          "station-a": { name: "Station A" },
        },
      },
    }),
    markScheduledEventPlayback() {},
    ensureVoiceConnectionForChannel: async (guildId, channelId, state) => {
      calls.push({ type: "connect", guildId, channelId });
      state.connection = { joinConfig: { channelId } };
      return {
        guild,
        channel: guild.channels.cache.get(channelId),
      };
    },
    playStation: async (state, stations, key, guildId) => {
      calls.push({ type: "play", guildId, key, stationName: stations?.stations?.[key]?.name || null });
      state.currentStationKey = key;
      state.currentStationName = stations?.stations?.[key]?.name || key;
    },
  };

  await restoreRuntimeState(runtime, {});

  assert.deepEqual(calls, [
    { type: "connect", guildId: "guild-1", channelId: "voice-9" },
    { type: "play", guildId: "guild-1", key: "station-a", stationName: "Station A" },
  ]);
  const restoredState = runtime.guildState.get("guild-1");
  assert.equal(restoredState.lastChannelId, "voice-9");
  assert.equal(restoredState.currentStationKey, "station-a");
  assert.equal(restoredState.currentStationName, "Station A");
  assert.equal(restoredState.volume, 64);
});

test("restoreState refreshes voice guard settings before reconnecting restored playback", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-restore-guard": {
      "guild-1": {
        channelId: "voice-9",
        stationKey: "station-a",
        volume: 64,
      },
    },
  });

  const calls = [];
  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map([
        ["voice-9", {
          id: "voice-9",
          name: "Radio",
          isVoiceBased: () => true,
        }],
      ]),
      fetch: async () => null,
    },
  };
  const runtime = {
    config: { name: "OmniFM Restore", id: "bot-restore-guard" },
    guildState: new Map(),
    pendingRestoreTimers: new Map(),
    restoreRetryCounts: new Map(),
    client: {
      guilds: {
        cache: new Map([
          ["guild-1", guild],
        ]),
        fetch: async () => guild,
      },
    },
    getState(guildId) {
      if (!this.guildState.has(guildId)) {
        this.guildState.set(guildId, {});
      }
      return this.guildState.get(guildId);
    },
    refreshVoiceGuardSettings: async (guildId) => {
      calls.push({ type: "voice-guard", guildId });
      const state = runtime.getState(guildId);
      state.voiceGuardAvailable = true;
      state.voiceGuardPolicy = "default";
      state.voiceGuardEffectivePolicy = "return";
    },
    enforceGuildAccessForGuild: async () => true,
    resolveGuildLanguage: () => "en",
    resolveStationForGuild: () => ({
      ok: true,
      key: "station-a",
      station: { name: "Station A" },
      stations: {
        stations: {
          "station-a": { name: "Station A" },
        },
      },
    }),
    markScheduledEventPlayback() {},
    ensureVoiceConnectionForChannel: async (guildId, channelId, state) => {
      calls.push({
        type: "connect",
        guildId,
        channelId,
        voiceGuardAvailable: state.voiceGuardAvailable === true,
        voiceGuardEffectivePolicy: state.voiceGuardEffectivePolicy || null,
      });
      state.connection = { joinConfig: { channelId } };
      return {
        guild,
        channel: guild.channels.cache.get(channelId),
      };
    },
    playStation: async (state, stations, key, guildId) => {
      calls.push({ type: "play", guildId, key, stationName: stations?.stations?.[key]?.name || null });
      state.currentStationKey = key;
      state.currentStationName = stations?.stations?.[key]?.name || key;
    },
  };

  await restoreRuntimeState(runtime, {});

  assert.deepEqual(calls, [
    { type: "voice-guard", guildId: "guild-1" },
    {
      type: "connect",
      guildId: "guild-1",
      channelId: "voice-9",
      voiceGuardAvailable: true,
      voiceGuardEffectivePolicy: "return",
    },
    { type: "play", guildId: "guild-1", key: "station-a", stationName: "Station A" },
  ]);
});

test("restartCurrentStation retries after transient restart failures", async () => {
  const originalNoteFailure = networkRecoveryCoordinator.noteFailure;
  const originalGetRecoveryDelayMs = networkRecoveryCoordinator.getRecoveryDelayMs;
  const notedFailures = [];
  let recoveryDelayCalls = 0;
  networkRecoveryCoordinator.noteFailure = (source, detail) => {
    notedFailures.push({ source, detail });
  };
  networkRecoveryCoordinator.getRecoveryDelayMs = () => {
    recoveryDelayCalls += 1;
    return recoveryDelayCalls === 1 ? 0 : 12_345;
  };

  try {
    let scheduled = null;
    const state = {
      shouldReconnect: true,
      currentStationKey: "station-a",
      currentStationName: "Station A",
      connection: { joinConfig: { channelId: "voice-1" } },
      lastChannelId: "voice-1",
      activeScheduledEventStopAtMs: 0,
    };
    const runtime = {
      config: { name: "OmniFM Test" },
      isScheduledEventStopDue() {
        return false;
      },
      getResolvedCurrentStation() {
        return {
          key: "station-a",
          station: { name: "Station A" },
          stations: {
            stations: {
              "station-a": { name: "Station A" },
            },
          },
        };
      },
      clearCurrentProcess() {},
      playStation() {
        throw new Error("Host konnte nicht aufgelöst werden.");
      },
      normalizeStationReference() {
        return { isCustom: false };
      },
      resolveStationForGuild() {
        return null;
      },
      scheduleStreamRestart(guildId, passedState, delayMs, reason) {
        scheduled = { guildId, passedState, delayMs, reason };
      },
    };

    await restartRuntimeCurrentStation(runtime, state, "guild-1");

    assert.equal(notedFailures.length, 1);
    assert.deepEqual(scheduled, {
      guildId: "guild-1",
      passedState: state,
      delayMs: 12_345,
      reason: "restart-error",
    });
  } finally {
    networkRecoveryCoordinator.noteFailure = originalNoteFailure;
    networkRecoveryCoordinator.getRecoveryDelayMs = originalGetRecoveryDelayMs;
  }
});

test("stream healthcheck forces an early restart when audio stalls", async () => {
  const originalNoteFailure = networkRecoveryCoordinator.noteFailure;
  const originalGetRecoveryDelayMs = networkRecoveryCoordinator.getRecoveryDelayMs;
  const incidentsSnapshot = snapshotOptionalTextFile(runtimeIncidentsPath);
  const incidentsBackupSnapshot = snapshotOptionalTextFile(runtimeIncidentsBackupPath);
  const notedFailures = [];
  networkRecoveryCoordinator.noteFailure = (source, detail) => {
    notedFailures.push({ source, detail });
  };
  networkRecoveryCoordinator.getRecoveryDelayMs = () => 0;

  try {
    let scheduled = null;
    let killedWith = null;
    let persisted = 0;
    const dispatchedIncidentAlerts = [];
    const runtime = {
      role: "worker",
      config: { id: "bot-test-1", name: "OmniFM Test" },
      client: {
        guilds: {
          cache: new Map([["123456789012345678", { id: "123456789012345678", name: "OmniFM Test Guild" }]]),
        },
      },
      getCurrentListenerCount() {
        return 4;
      },
      scheduleStreamRestart(guildId, state, delayMs, reason) {
        scheduled = { guildId, state, delayMs, reason };
      },
      async dispatchIncidentAlert(payload) {
        dispatchedIncidentAlerts.push(payload);
        return { attempted: true, delivered: true };
      },
      persistState() {
        persisted += 1;
      },
    };
    const process = {
      kill(signal) {
        killedWith = signal;
      },
    };
    const nowMs = Date.parse("2026-04-07T12:00:00.000Z");
    const state = {
      currentProcess: process,
      shouldReconnect: true,
      currentStationKey: "nightwave",
      currentStationName: "Nightwave FM",
      connection: { joinConfig: { channelId: "voice-1" } },
      reconnectTimer: null,
      reconnectInFlight: false,
      voiceConnectInFlight: false,
      streamRestartTimer: null,
      streamHealthTimer: null,
      lastAudioPacketAt: nowMs - 60_000,
      streamHealthStartedAt: nowMs - 120_000,
      streamErrorCount: 0,
      reconnectAttempts: 0,
      lastStreamErrorAt: null,
      lastHealthcheckFailureAt: null,
      lastStreamEndReason: null,
      lastProcessExitDetail: null,
      lastProcessExitAt: 0,
    };

    const result = await evaluateRuntimeStreamHealth(runtime, "123456789012345678", state, process, {
      nowMs,
      graceMs: 10_000,
      stallMs: 30_000,
      restartDelayMs: 900,
    });

    assert.equal(result.action, "restart");
    assert.equal(result.reason, "stream-health-stalled");
    assert.equal(result.silenceMs, 60_000);
    assert.equal(killedWith, "SIGKILL");
    assert.equal(state.currentProcess, null);
    assert.equal(state.streamErrorCount, 1);
    assert.equal(state.lastStreamEndReason, "stream-health-stalled");
    assert.equal(state.lastProcessExitDetail, "healthcheck-stall");
    assert.match(String(state.lastStreamErrorAt || ""), /^2026-04-07T12:00:00/);
    assert.equal(persisted, 1);
    assert.deepEqual(scheduled, {
      guildId: "123456789012345678",
      state,
      delayMs: 900,
      reason: "stream-health-stalled",
    });
    assert.equal(notedFailures.length, 1);
    assert.match(notedFailures[0].detail, /silenceMs=60000/);
    assert.equal(dispatchedIncidentAlerts.length, 1);
    assert.equal(dispatchedIncidentAlerts[0].eventKey, "stream_healthcheck_stalled");
    assert.equal(dispatchedIncidentAlerts[0].payload.previousStationKey, "nightwave");
    assert.equal(dispatchedIncidentAlerts[0].payload.silenceMs, 60000);
  } finally {
    networkRecoveryCoordinator.noteFailure = originalNoteFailure;
    networkRecoveryCoordinator.getRecoveryDelayMs = originalGetRecoveryDelayMs;
    restoreOptionalTextFile(runtimeIncidentsPath, incidentsSnapshot);
    restoreOptionalTextFile(runtimeIncidentsBackupPath, incidentsBackupSnapshot);
  }
});

test("dashboard snapshot treats pending stream restarts as recovering", () => {
  const voiceChannel = { id: "voice-1", name: "radio-lounge" };
  const guild = {
    id: "guild-1",
    name: "OmniFM Test Guild",
    memberCount: 12,
    channels: { cache: new Map([["voice-1", voiceChannel]]) },
  };
  const fakeRuntime = {
    config: { id: "bot-test-1", index: 1, name: "OmniFM Test", requiredTier: "free", clientId: "client-1" },
    role: "worker",
    client: {
      isReady: () => true,
      user: null,
      guilds: { cache: new Map([["guild-1", guild]]) },
    },
    startedAt: Date.now() - 5_000,
    startError: null,
    guildState: new Map([["guild-1", {
      currentStationKey: "nightwave",
      currentStationName: "Nightwave FM",
      lastChannelId: "voice-1",
      connection: { joinConfig: { channelId: "voice-1" } },
      shouldReconnect: true,
      reconnectTimer: null,
      reconnectAttempts: 0,
      streamRestartTimer: { pending: true },
      streamErrorCount: 1,
      currentMeta: null,
      volume: 100,
    }]]),
    collectStats() {
      return { servers: 1, users: 12, connections: 1, listeners: 0 };
    },
    getApplicationId() {
      return "client-1";
    },
    getCurrentListenerCount() {
      return 0;
    },
    buildStatusSnapshot: BotRuntime.prototype.buildStatusSnapshot,
  };

  const snapshot = BotRuntime.prototype.getDashboardStatus.call(fakeRuntime);
  const detail = snapshot.guildDetails[0];

  assert.ok(detail);
  assert.equal(detail.playing, true);
  assert.equal(detail.recovering, true);
  assert.equal(detail.streamRestartPending, true);
});

test("dashboard snapshot keeps the observed live voice channel when the local connection handle is gone", () => {
  const voiceChannel = {
    id: "voice-1",
    name: "tomorrowland-live",
    isVoiceBased() {
      return true;
    },
    members: new Map(),
  };
  const guild = {
    id: "guild-1",
    name: "OmniFM Test Guild",
    memberCount: 12,
    members: {
      me: {
        voice: {
          channelId: "voice-1",
        },
      },
    },
    voiceStates: {
      cache: new Map(),
    },
    channels: { cache: new Map([["voice-1", voiceChannel]]) },
  };
  const fakeRuntime = {
    config: { id: "bot-test-2", index: 2, name: "OmniFM Test 2", requiredTier: "free", clientId: "client-2" },
    role: "worker",
    client: {
      isReady: () => true,
      user: null,
      guilds: { cache: new Map([["guild-1", guild]]) },
    },
    startedAt: Date.now() - 5_000,
    startError: null,
    guildState: new Map([["guild-1", {
      currentStationKey: "tomorrowland",
      currentStationName: "Tomorrowland One World Radio",
      lastChannelId: null,
      connection: null,
      currentProcess: { pid: 22 },
      player: {
        state: {
          status: "playing",
        },
      },
      shouldReconnect: false,
      reconnectTimer: null,
      reconnectAttempts: 0,
      streamRestartTimer: null,
      streamErrorCount: 0,
      currentMeta: null,
      volume: 25,
    }]]),
    collectStats() {
      return { servers: 1, users: 12, connections: 1, listeners: 0 };
    },
    getApplicationId() {
      return "client-2";
    },
    getCurrentListenerCount: BotRuntime.prototype.getCurrentListenerCount,
    getVoiceListenerCount: BotRuntime.prototype.getVoiceListenerCount,
    buildStatusSnapshot: BotRuntime.prototype.buildStatusSnapshot,
    getDashboardStatus: BotRuntime.prototype.getDashboardStatus,
  };

  const snapshot = BotRuntime.prototype.getDashboardStatus.call(fakeRuntime);
  const detail = snapshot.guildDetails[0];

  assert.ok(detail);
  assert.equal(detail.playing, true);
  assert.equal(detail.voiceConnected, true);
  assert.equal(detail.channelId, "voice-1");
  assert.equal(detail.channelName, "tomorrowland-live");
});

test("worker manager reuses the worker already streaming in the requested channel", () => {
  const workerA = {
    config: { index: 2 },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-a",
        connection: { joinConfig: { channelId: "voice-1" } },
        lastChannelId: "voice-1",
      }],
    ]),
  };
  const workerB = {
    config: { index: 3 },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-b",
        connection: { joinConfig: { channelId: "voice-2" } },
        lastChannelId: "voice-2",
      }],
    ]),
  };

  const manager = new WorkerManager([workerA, workerB]);
  assert.equal(manager.findStreamingWorkerByChannel("guild-1", "voice-1"), workerA);
  assert.equal(manager.findStreamingWorkerByChannel("guild-1", "voice-2"), workerB);
  assert.equal(manager.findStreamingWorkerByChannel("guild-1", "voice-9"), null);
});

test("worker manager resolves visible bot numbers separately from internal worker slots", () => {
  const workerForBot2 = {
    config: { index: 2, name: "OmniFM 2" },
    guildState: new Map(),
  };
  const workerForBot3 = {
    config: { index: 3, name: "OmniFM 3" },
    guildState: new Map(),
  };

  const manager = new WorkerManager([workerForBot2, workerForBot3]);

  assert.equal(manager.resolveWorker(2, { prefer: "botIndex" }).worker, workerForBot2);
  assert.equal(manager.resolveWorker(2, { prefer: "slot" }).worker, workerForBot3);
  assert.equal(manager.resolveWorker(1, { prefer: "botIndex" }), null);
  assert.equal(manager.getWorkerByIndex(3, { prefer: "botIndex" }), workerForBot3);
  assert.equal(manager.getWorkerByIndex(1, { prefer: "slot" }), workerForBot2);
});

test("worker manager keeps reconnecting workers reserved for their remembered voice channel", async () => {
  const reconnectingWorker = {
    config: { index: 2 },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-a",
        connection: null,
        currentProcess: null,
        lastChannelId: "voice-7",
        shouldReconnect: true,
        reconnectTimer: { unref() {} },
        reconnectInFlight: false,
        voiceConnectInFlight: false,
      }],
    ]),
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map([
          ["guild-1", {
            members: {
              me: {
                voice: {
                  channelId: null,
                },
              },
              fetchMe: async () => ({
                voice: {
                  channelId: null,
                },
              }),
            },
          }],
        ]),
        fetch: async () => null,
      },
    },
  };
  const freeWorker = {
    config: { index: 3 },
    guildState: new Map(),
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map([
          ["guild-1", {
            members: {
              me: {
                voice: {
                  channelId: null,
                },
              },
              fetchMe: async () => ({
                voice: {
                  channelId: null,
                },
              }),
            },
          }],
        ]),
        fetch: async () => null,
      },
    },
  };

  const manager = new WorkerManager([reconnectingWorker, freeWorker]);
  assert.equal(manager.findStreamingWorkerByChannel("guild-1", "voice-7"), reconnectingWorker);
  assert.equal(await manager.findConnectedWorkerByChannel("guild-1", "voice-7", "pro"), reconnectingWorker);
  assert.equal(manager.findFreeWorker("guild-1", "pro"), freeWorker);
});

test("saveBotState keeps reconnectable targets even without an active voice connection", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({});
  const restoreBlockedUntil = Date.now() + 45 * 60_000;
  saveBotState("bot-reconnectable", new Map([
    ["guild-1", {
      currentStationKey: "station-a",
      currentStationName: "Station A",
      lastChannelId: "voice-1",
      connection: null,
      volume: 88,
      activeScheduledEventId: null,
      activeScheduledEventStopAtMs: 0,
      restoreBlockedAt: Date.now(),
      restoreBlockedUntil,
      restoreBlockCount: 2,
      restoreBlockReason: "worker-autoheal",
    }],
  ]));

  const saved = getBotState("bot-reconnectable");
  assert.equal(saved["guild-1"]?.channelId, "voice-1");
  assert.equal(saved["guild-1"]?.stationKey, "station-a");
  assert.equal(saved["guild-1"]?.stationName, "Station A");
  assert.equal(saved["guild-1"]?.volume, 88);
  assert.equal(saved["guild-1"]?.scheduledEventId, null);
  assert.equal(saved["guild-1"]?.scheduledEventStopAtMs, 0);
  assert.equal(saved["guild-1"]?.restoreBlockedUntil, restoreBlockedUntil);
  assert.equal(saved["guild-1"]?.restoreBlockCount, 2);
  assert.equal(saved["guild-1"]?.restoreBlockReason, "worker-autoheal");
  assert.match(String(saved["guild-1"]?.savedAt || ""), /^\d{4}-\d{2}-\d{2}T/);
});

test("getBotState normalizes malformed persisted guild state entries", async (t) => {
  const botStateSnapshot = snapshotOptionalTextFile(botStatePath);
  const botStateBackupSnapshot = snapshotOptionalTextFile(botStateBackupPath);
  t.after(() => {
    restoreOptionalTextFile(botStatePath, botStateSnapshot);
    restoreOptionalTextFile(botStateBackupPath, botStateBackupSnapshot);
  });

  saveState({
    "bot-normalize": {
      invalid: {
        volume: 50,
        volumePreference: true,
      },
      "123456789012345678": {
        savedAt: "invalid-date",
        volume: "150",
        stationKey: " station-a ",
        stationName: " Station A ",
        channelId: "223456789012345678",
        scheduledEventId: "not-a-snowflake",
        scheduledEventStopAtMs: "invalid",
        restoreBlockedUntil: "invalid",
        restoreBlockCount: "-5",
        restoreBlockReason: "  worker-autoheal  ",
      },
      "323456789012345678": {
        volume: "not-a-number",
        volumePreference: true,
      },
    },
  });

  const normalized = getBotState("bot-normalize");
  assert.deepEqual(Object.keys(normalized), ["123456789012345678"]);
  assert.equal(normalized["123456789012345678"].volume, 100);
  assert.equal(normalized["123456789012345678"].stationKey, "station-a");
  assert.equal(normalized["123456789012345678"].stationName, "Station A");
  assert.equal(normalized["123456789012345678"].channelId, "223456789012345678");
  assert.equal(normalized["123456789012345678"].scheduledEventId, null);
  assert.equal(normalized["123456789012345678"].scheduledEventStopAtMs, 0);
  assert.equal(normalized["123456789012345678"].restoreBlockReason, "worker-autoheal");
  assert.match(String(normalized["123456789012345678"].savedAt || ""), /^\d{4}-\d{2}-\d{2}T/);
});

test("public bot status omits guild details while dashboard status keeps them", () => {
  const fakeRuntime = {
    collectStats() {
      return { servers: 3, users: 42, connections: 1, listeners: 7 };
    },
    getApplicationId() {
      return "app-123";
    },
    getCurrentListenerCount() {
      return 7;
    },
    config: {
      id: "bot-1",
      index: 1,
      name: "OmniFM Bot 1",
      clientId: "client-123",
      requiredTier: "free",
    },
    role: "commander",
    client: {
      isReady: () => true,
      user: {
        tag: "OmniFM#0001",
        displayAvatarURL: () => "https://example.com/avatar.png",
      },
      guilds: {
        cache: new Map([
          ["guild-1", {
            name: "Guild One",
            channels: {
              cache: new Map([
                ["voice-1", { name: "Radio" }],
              ]),
            },
          }],
        ]),
      },
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "custom:secret-fm",
        currentStationName: "Secret FM",
        lastChannelId: "voice-1",
        volume: 80,
        connection: { joinConfig: { channelId: "voice-1" } },
        currentMeta: { title: "Hidden Track" },
        shouldReconnect: true,
      }],
    ]),
    startedAt: Date.now() - 5_000,
    startError: null,
  };

  fakeRuntime.buildStatusSnapshot = BotRuntime.prototype.buildStatusSnapshot;

  const publicStatus = BotRuntime.prototype.getPublicStatus.call(fakeRuntime);
  assert.equal("guildDetails" in publicStatus, false);
  assert.equal(publicStatus.listeners, 7);
  assert.equal(typeof publicStatus.inviteUrl, "string");

  const dashboardStatus = BotRuntime.prototype.getDashboardStatus.call(fakeRuntime);
  assert.equal(Array.isArray(dashboardStatus.guildDetails), true);
  assert.equal(dashboardStatus.guildDetails.length, 1);
  assert.deepEqual(dashboardStatus.guildDetails[0], {
    guildId: "guild-1",
    guildName: "Guild One",
    stationKey: "custom:secret-fm",
    stationName: "Secret FM",
    channelId: "voice-1",
    channelName: "Radio",
    listenerCount: 7,
    volume: 80,
    voiceConnected: true,
    playing: true,
    recovering: false,
    reconnectAttempts: 0,
    streamErrorCount: 0,
    shouldReconnect: true,
    meta: { title: "Hidden Track" },
  });
});

test("dashboard status and stats stay live when Discord voice state survives a stale local connection handle", () => {
  const guildCache = new Map([[
    "guild-1",
    {
      name: "Guild One",
      memberCount: 24,
      channels: {
        cache: new Map([
          ["voice-1", { name: "Radio" }],
        ]),
      },
      members: {
        me: {
          voice: {
            channelId: "voice-1",
          },
        },
      },
    },
  ]]);
  guildCache.reduce = function reduce(reducer, initialValue) {
    let current = initialValue;
    for (const value of this.values()) {
      current = reducer(current, value);
    }
    return current;
  };

  const fakeRuntime = {
    config: {
      id: "bot-7",
      index: 7,
      name: "OmniFM 7",
      clientId: "client-7",
      requiredTier: "free",
    },
    role: "worker",
    client: {
      isReady: () => true,
      user: {
        tag: "OmniFM7#0007",
        displayAvatarURL: () => null,
      },
      guilds: {
        cache: guildCache,
      },
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "tomorrowland",
        currentStationName: "Tomorrowland - Anthems",
        lastChannelId: "voice-1",
        connection: null,
        currentProcess: { pid: 777 },
        player: { state: { status: "playing" } },
        shouldReconnect: true,
        volume: 90,
      }],
    ]),
    getCurrentListenerCount() {
      return 3;
    },
    getApplicationId() {
      return "client-7";
    },
    collectStats: BotRuntime.prototype.collectStats,
    buildStatusSnapshot: BotRuntime.prototype.buildStatusSnapshot,
    startedAt: Date.now() - 30_000,
    startError: null,
  };

  const stats = BotRuntime.prototype.collectStats.call(fakeRuntime);
  const dashboardStatus = BotRuntime.prototype.getDashboardStatus.call(fakeRuntime);

  assert.equal(stats.connections, 1);
  assert.equal(stats.listeners, 3);
  assert.equal(dashboardStatus.guildDetails[0]?.voiceConnected, true);
  assert.equal(dashboardStatus.guildDetails[0]?.playing, true);
  assert.equal(dashboardStatus.guildDetails[0]?.listenerCount, 3);
});

test("help payload exposes dashboard, website, support and premium links", () => {
  const fakeRuntime = {
    resolveInteractionLanguage() {
      return "en";
    },
  };

  const payload = BotRuntime.prototype.buildHelpMessage.call(fakeRuntime, {
    guildId: "guild-1",
    guild: { name: "Guild One" },
  });

  const actionButtons = payload.components?.[0]?.components?.map((button) => button?.data || {}) || [];
  assert.equal(actionButtons.length, 3);
  assert.equal(actionButtons[0].label, "Quick start");
  assert.equal(actionButtons[1].label, "Stations");
  assert.equal(actionButtons[2].label, "Workers");

  const linkButtons = payload.components?.[1]?.components?.map((button) => button?.data || {}) || [];
  assert.equal(linkButtons.length, 4);
  assert.equal(linkButtons[0].label, "📊 Dashboard");
  assert.match(String(linkButtons[0].url || ""), /\?page=dashboard&lang=en$/);
  assert.equal(linkButtons[1].label, "🌐 Website");
  assert.match(String(linkButtons[1].url || ""), /\?lang=en$/);
  assert.equal(linkButtons[2].label, "🛟 Support");
  assert.equal(linkButtons[3].label, "💎 Premium");
});

test("setup payload exposes worker actions and useful links", () => {
  const fakeRuntime = Object.create(BotRuntime.prototype);
  fakeRuntime.resolveInteractionLanguage = () => "en";
  fakeRuntime.workerManager = {
    getMaxWorkerIndex() {
      return 8;
    },
    getInvitedWorkers() {
      return [];
    },
  };

  const payload = fakeRuntime.buildSetupMessage({
    guildId: "guild-1",
    guild: {
      name: "Guild One",
      channels: {
        cache: {
          filter(callback) {
            const channels = [
              { type: 2, isVoiceBased() { return true; } },
              { type: 0, isVoiceBased() { return false; } },
            ];
            return {
              size: channels.filter(callback).length,
            };
          },
        },
      },
    },
  });

  const firstEmbed = payload.embeds?.[0]?.data || {};
  const fieldNames = Array.isArray(firstEmbed.fields) ? firstEmbed.fields.map((field) => field.name) : [];
  assert.ok(fieldNames.includes("Current status"));
  assert.ok(fieldNames.includes("Next step"));
  assert.ok(fieldNames.includes("Before the first /play"));

  const actionButtons = payload.components?.[0]?.components?.map((button) => button?.data || {}) || [];
  assert.equal(actionButtons.length, 4);
  assert.equal(actionButtons[0].label, "Quick start");
  assert.equal(actionButtons[0].custom_id, "omnifm:play:open");
  assert.equal(actionButtons[1].label, "Stations");
  assert.equal(actionButtons[1].custom_id, "omnifm:stations:open");
  assert.equal(actionButtons[2].label, "Worker status");
  assert.equal(actionButtons[2].custom_id, "omnifm:workers:open");
  assert.equal(actionButtons[3].label, "Invite worker");
  assert.equal(actionButtons[3].custom_id, "omnifm:invite:open");

  const linkButtons = payload.components?.[1]?.components?.map((button) => button?.data || {}) || [];
  assert.equal(linkButtons.length, 3);
  assert.equal(linkButtons[0].label, "📊 Dashboard");
  assert.match(String(linkButtons[0].url || ""), /\?page=dashboard&lang=en$/);
  assert.equal(linkButtons[1].label, "🌐 Website");
  assert.match(String(linkButtons[1].url || ""), /\?lang=en$/);
  assert.equal(linkButtons[2].label, "🛟 Support");
});

test("play wizard payload exposes modern quick-start controls", async () => {
  const fakeRuntime = Object.create(BotRuntime.prototype);
  fakeRuntime.interactiveUiSessions = new Map();
  fakeRuntime.workerManager = {
    getMaxWorkerIndex() {
      return 4;
    },
    getWorkerByIndex(index) {
      return { config: { name: `Worker ${index}` } };
    },
  };
  fakeRuntime.role = "commander";
  fakeRuntime.client = {
    guilds: {
      cache: new Map(),
    },
  };
  fakeRuntime.createInteractionTranslator = () => ({
    language: "en",
    t: (_de, en) => en,
  });
  fakeRuntime.resolveInteractionLanguage = () => "en";

  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map([
        ["voice-1", {
          id: "voice-1",
          guildId: "guild-1",
          name: "Radio",
          type: ChannelType.GuildVoice,
          rawPosition: 1,
          isVoiceBased() {
            return true;
          },
        }],
      ]),
    },
  };
  fakeRuntime.client.guilds.cache.set("guild-1", guild);

  const payload = await openRuntimePlayWizard(fakeRuntime, {
    guildId: "guild-1",
    guild,
    user: { id: "user-1" },
    member: { voice: { channelId: "voice-1" } },
  });

  assert.equal(payload.embeds?.[0]?.data?.title, "🎛 OmniFM Quick start");
  assert.equal(payload.components?.length >= 4, true);
  assert.equal(payload.components?.[0]?.components?.[0]?.data?.custom_id.startsWith("omnifm:play:station:"), true);
  assert.equal(payload.components?.[1]?.components?.[0]?.data?.custom_id.startsWith("omnifm:play:channel:"), true);
  const actionRow = payload.components?.find((row) => row?.components?.[0]?.data?.custom_id?.startsWith("omnifm:play:start:"));
  assert.equal(Boolean(actionRow), true);
});

test("stations browser payload exposes paging and quick-start actions", async () => {
  const fakeRuntime = Object.create(BotRuntime.prototype);
  fakeRuntime.interactiveUiSessions = new Map();
  fakeRuntime.client = {
    guilds: {
      cache: new Map(),
    },
  };
  fakeRuntime.createInteractionTranslator = () => ({
    language: "en",
    t: (_de, en) => en,
  });
  fakeRuntime.resolveInteractionLanguage = () => "en";

  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map(),
    },
  };
  fakeRuntime.client.guilds.cache.set("guild-1", guild);

  const payload = await openRuntimeStationsBrowser(fakeRuntime, {
    guildId: "guild-1",
    guild,
    user: { id: "user-1" },
  });

  assert.equal(payload.embeds?.[0]?.data?.title, "📻 Station browser");
  assert.equal(payload.components?.[0]?.components?.[0]?.data?.custom_id.startsWith("omnifm:stations:station:"), true);
  const actionLabels = payload.components?.[1]?.components?.map((component) => component?.data?.label) || [];
  assert.ok(actionLabels.includes("🎛 Quick start"));
  assert.ok(actionLabels.includes("🔄 Refresh"));
});

test("executeRuntimePlay does not block explicit remote workers on a synthetic channel precheck", async () => {
  const replies = [];
  const remoteWorker = {
    remote: true,
    config: { name: "Worker 2" },
    client: {
      guilds: {
        cache: new Map(),
        async fetch() {
          return null;
        },
      },
    },
    clearScheduledEventPlaybackInGuild() {
      return { ok: true };
    },
    async playInGuild(guildId, channelId, stationKey) {
      return {
        ok: true,
        workerName: "Worker 2",
        guildId,
        channelId,
        stationKey,
      };
    },
  };

  const fakeRuntime = Object.create(BotRuntime.prototype);
  fakeRuntime.config = { name: "Commander" };
  fakeRuntime.role = "commander";
  fakeRuntime.client = {
    guilds: {
      cache: new Map(),
    },
  };
  fakeRuntime.workerManager = {
    canUseWorker(index) {
      if (index === 2) {
        return { ok: true, worker: remoteWorker };
      }
      return { ok: false, reason: "not_configured", maxIndex: 2 };
    },
  };
  fakeRuntime.respondInteraction = async (_interaction, payload) => {
    replies.push(payload);
    return payload;
  };
  fakeRuntime.createInteractionTranslator = () => ({
    language: "en",
    t: (_de, en) => en,
  });
  fakeRuntime.resolveInteractionLanguage = () => "en";

  const voiceChannel = {
    id: "voice-1",
    guildId: "guild-1",
    name: "Radio",
    type: ChannelType.GuildVoice,
    rawPosition: 1,
    isVoiceBased() {
      return true;
    },
    toString() {
      return "<#voice-1>";
    },
  };
  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map([["voice-1", voiceChannel]]),
    },
    members: {
      async fetch() {
        return { voice: { channelId: "voice-1" } };
      },
    },
  };
  fakeRuntime.client.guilds.cache.set("guild-1", guild);

  await executeRuntimePlay(fakeRuntime, {
    guildId: "guild-1",
    guild,
    user: { id: "user-1" },
  }, {
    station: "groovesalad",
    requestedVoiceChannel: voiceChannel,
    requestedBotIndex: 2,
    openWizardWhenIncomplete: false,
  });

  const finalReply = replies.at(-1);
  assert.equal(replies.length >= 2, true);
  assert.equal(finalReply?.embeds?.[0]?.data?.title, "✅ Stream started");
  assert.match(String(finalReply?.embeds?.[0]?.data?.description || ""), /Worker 2/);
});

test("executeRuntimePlay refreshes remote worker states before and after commander worker selection", async () => {
  let refreshCalls = 0;
  const replies = [];
  const remoteWorker = {
    remote: true,
    config: { name: "Worker 2" },
    client: {
      guilds: {
        cache: new Map(),
        async fetch() {
          return null;
        },
      },
    },
    clearScheduledEventPlaybackInGuild() {
      return { ok: true };
    },
    async playInGuild() {
      return { ok: true, workerName: "Worker 2" };
    },
  };

  const fakeRuntime = Object.create(BotRuntime.prototype);
  fakeRuntime.config = { name: "Commander" };
  fakeRuntime.role = "commander";
  fakeRuntime.client = {
    guilds: {
      cache: new Map(),
    },
  };
  fakeRuntime.workerManager = {
    async refreshRemoteStates() {
      refreshCalls += 1;
    },
    canUseWorker(index) {
      if (index === 2) {
        return { ok: true, worker: remoteWorker };
      }
      return { ok: false, reason: "not_configured", maxIndex: 2 };
    },
  };
  fakeRuntime.respondInteraction = async (_interaction, payload) => {
    replies.push(payload);
    return payload;
  };
  fakeRuntime.createInteractionTranslator = () => ({
    language: "en",
    t: (_de, en) => en,
  });
  fakeRuntime.resolveInteractionLanguage = () => "en";

  const voiceChannel = {
    id: "voice-1",
    guildId: "guild-1",
    name: "Radio",
    type: ChannelType.GuildVoice,
    rawPosition: 1,
    isVoiceBased() {
      return true;
    },
    toString() {
      return "<#voice-1>";
    },
  };
  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      cache: new Map([["voice-1", voiceChannel]]),
    },
    members: {
      async fetch() {
        return { voice: { channelId: "voice-1" } };
      },
    },
  };
  fakeRuntime.client.guilds.cache.set("guild-1", guild);

  await executeRuntimePlay(fakeRuntime, {
    guildId: "guild-1",
    guild,
    user: { id: "user-1" },
  }, {
    station: "groovesalad",
    requestedVoiceChannel: voiceChannel,
    requestedBotIndex: 2,
    openWizardWhenIncomplete: false,
  });

  assert.equal(refreshCalls, 2);
  assert.equal(replies.at(-1)?.embeds?.[0]?.data?.title, "✅ Stream started");
});

test("workers status payload paginates and exposes page controls", async () => {
  const statuses = Array.from({ length: 18 }, (_, index) => ({
    index: index + 1,
    botIndex: index + 1,
    name: `Worker ${index + 1}`,
    online: true,
    totalGuilds: 100 + index,
    activeStreams: index % 4,
    streams: index === 0 ? [{ guildId: "guild-1", stationName: "Deep House Session" }] : [],
  }));

  const fakeRuntime = {
    workerManager: {
      getMaxWorkerIndex() {
        return 16;
      },
      getAllStatuses() {
        return statuses;
      },
      getWorkerByIndex() {
        return {
          client: {
            guilds: {
              cache: {
                has(guildId) {
                  return guildId === "guild-1";
                },
              },
            },
          },
        };
      },
    },
    createInteractionTranslator() {
      return {
        language: "en",
        t: (de, en) => en,
      };
    },
    formatTierLabel() {
      return "Free";
    },
  };

  const interaction = { guildId: "guild-1" };
  const firstPage = await BotRuntime.prototype.buildWorkersStatusPayload.call(fakeRuntime, interaction, { page: 0 });
  const secondPage = await BotRuntime.prototype.buildWorkersStatusPayload.call(fakeRuntime, interaction, { page: 1 });

  const firstValue = firstPage?.embeds?.[0]?.data?.fields?.[0]?.value || "";
  const secondValue = secondPage?.embeds?.[0]?.data?.fields?.[0]?.value || "";
  assert.notEqual(firstValue, secondValue);
  assert.match(String(firstPage?.embeds?.[0]?.data?.footer?.text || ""), /^Page 1\/\d+/);
  assert.match(String(secondPage?.embeds?.[0]?.data?.footer?.text || ""), /^Page 2\/\d+/);

  const firstButtons = firstPage?.components?.[0]?.components?.map((button) => button?.data || {}) || [];
  assert.equal(firstButtons.length, 4);
  assert.equal(firstButtons[1]?.disabled, true);
  assert.equal(firstButtons[2]?.disabled, false);
  assert.match(String(firstButtons[2]?.custom_id || ""), /^omnifm:workers:page:/);
});

test("presence shows dynamic commander and worker activity with listener totals", () => {
  const commanderRuntime = {
    role: "commander",
    config: { index: 1, name: "OmniFM DJ" },
    client: { guilds: { cache: { size: 42 } } },
    guildState: new Map([
      ["g1", { currentStationKey: "chill", currentStationName: "Chillout FM", connection: {}, listenerCount: 3 }],
      ["g2", { currentStationKey: "hiphop", currentStationName: "Hip Hop Radio", connection: {}, listenerCount: 4 }],
    ]),
  };
  const workerRuntime = {
    role: "worker",
    config: { index: 7, name: "OmniFM 7" },
    client: { guilds: { cache: { size: 8 } } },
    guildState: new Map([
      ["g1", { currentStationKey: "house", currentStationName: "House Beats", connection: {}, listenerCount: 2 }],
    ]),
  };

  const commanderPresence = BotRuntime.prototype.buildPresenceActivity.call(commanderRuntime);
  const workerPresence = BotRuntime.prototype.buildPresenceActivity.call(workerRuntime);

  assert.equal(commanderPresence?.type, ActivityType.Playing);
  assert.match(String(commanderPresence?.name || ""), /DJ routing 2 servers \| 7 listeners/);
  assert.doesNotMatch(String(commanderPresence?.name || ""), /Chillout FM|Hip Hop Radio/);
  assert.equal(workerPresence?.type, ActivityType.Playing);
  assert.match(String(workerPresence?.name || ""), /^1 server live \| 2 listeners$/);
  assert.doesNotMatch(String(workerPresence?.name || ""), /OmniFM 7|House Beats/);
});

test("presence keeps workers live when Discord still sees voice playback but the local handle is stale", () => {
  const workerRuntime = {
    role: "worker",
    config: { index: 5, name: "OmniFM 5" },
    client: {
      guilds: {
        cache: new Map([[
          "g1",
          {
            members: {
              me: {
                voice: {
                  channelId: "voice-9",
                },
              },
            },
          },
        ]]),
      },
    },
    guildState: new Map([
      ["g1", {
        currentStationKey: "uptempo",
        currentStationName: "Uptempo Radio",
        lastChannelId: "voice-9",
        connection: null,
        currentProcess: { pid: 1234 },
        player: { state: { status: "playing" } },
      }],
    ]),
    getCurrentListenerCount() {
      return 6;
    },
  };

  const workerPresence = BotRuntime.prototype.buildPresenceActivity.call(workerRuntime);

  assert.equal(workerPresence?.type, ActivityType.Playing);
  assert.match(String(workerPresence?.name || ""), /^1 server live \| 6 listeners$/);
});

test("presence keeps commander and worker idle copy clean with /play and website", () => {
  const commanderRuntime = {
    role: "commander",
    config: { index: 1, name: "OmniFM DJ" },
    client: { guilds: { cache: { size: 42 } } },
    guildState: new Map(),
  };
  const workerRuntime = {
    role: "worker",
    config: { index: 3, name: "OmniFM 3" },
    client: { guilds: { cache: { size: 8 } } },
    guildState: new Map(),
  };

  const commanderPresence = BotRuntime.prototype.buildPresenceActivity.call(commanderRuntime);
  const workerPresence = BotRuntime.prototype.buildPresenceActivity.call(workerRuntime);

  assert.equal(commanderPresence?.type, ActivityType.Listening);
  assert.match(String(commanderPresence?.name || ""), /^OmniFM DJ \| \/play \| https:\/\/omnifm\.xyz$/);
  assert.equal(workerPresence?.type, ActivityType.Listening);
  assert.match(String(workerPresence?.name || ""), /^OmniFM 3 ready \| \/play \| https:\/\/omnifm\.xyz$/);
});

test("programmatic stop routes through resetVoiceSession so listening sessions are finalized", async () => {
  let resetArgs = null;
  const fakeState = { shouldReconnect: true };
  const fakeRuntime = {
    guildState: new Map([["guild-1", fakeState]]),
    clearRestoreRetry() {},
    resetVoiceSession(guildId, state, options) {
      resetArgs = { guildId, state, options };
    },
  };

  const result = await BotRuntime.prototype.stopInGuild.call(fakeRuntime, "guild-1");

  assert.deepEqual(result, { ok: true });
  assert.equal(fakeState.shouldReconnect, false);
  assert.deepEqual(resetArgs, {
    guildId: "guild-1",
    state: fakeState,
    options: { preservePlaybackTarget: false, clearLastChannel: true },
  });
});

test("runtime stop preserves active restore targets during shutdown", async () => {
  let persisted = 0;
  let connectionDestroyed = 0;
  let clientDestroyed = 0;
  let playerStops = 0;
  let removedIdleListeners = 0;
  let removedErrorListeners = 0;

  const fakeState = {
    currentStationKey: "station-a",
    currentStationName: "Station A",
    lastChannelId: "voice-1",
    shouldReconnect: true,
    currentMeta: { title: "Track" },
    nowPlayingSignature: "sig-1",
    streamErrorCount: 2,
    ignoreNextIdleEvent: false,
    player: {
      stop() {
        playerStops += 1;
      },
      removeAllListeners(event) {
        if (event === "idle") removedIdleListeners += 1;
        if (event === "error") removedErrorListeners += 1;
      },
    },
    connection: {
      destroy() {
        connectionDestroyed += 1;
      },
    },
  };

  const fakeRuntime = Object.create(BotRuntime.prototype);
  fakeRuntime.config = { id: "bot-2", name: "Worker 2" };
  fakeRuntime.guildState = new Map([["123456789012345678", fakeState]]);
  fakeRuntime.client = {
    destroy() {
      clientDestroyed += 1;
    },
  };
  fakeRuntime.invalidateVoiceStatus = () => {};
  fakeRuntime.syncVoiceChannelStatus = () => Promise.resolve();
  fakeRuntime.stopEventScheduler = () => {};
  fakeRuntime.stopVoiceStateReconciler = () => {};
  fakeRuntime.stopListenerStatsSampler = () => {};
  fakeRuntime.clearReconnectTimer = () => {};
  fakeRuntime.clearNowPlayingTimer = () => {};
  fakeRuntime.clearCurrentProcess = () => {};
  fakeRuntime.persistState = () => {
    persisted += 1;
  };
  fakeRuntime.unsubscribeNetworkRecovery = () => {};
  fakeRuntime.shuttingDown = false;

  await BotRuntime.prototype.stop.call(fakeRuntime);

  assert.equal(fakeRuntime.shuttingDown, true);
  assert.equal(fakeState.shouldReconnect, true);
  assert.equal(fakeState.currentStationKey, "station-a");
  assert.equal(fakeState.currentStationName, "Station A");
  assert.equal(fakeState.lastChannelId, "voice-1");
  assert.deepEqual(fakeState.currentMeta, null);
  assert.equal(fakeState.nowPlayingSignature, null);
  assert.equal(fakeState.streamErrorCount, 0);
  assert.equal(fakeState.ignoreNextIdleEvent, true);
  assert.equal(playerStops, 1);
  assert.equal(removedIdleListeners, 1);
  assert.equal(removedErrorListeners, 1);
  assert.equal(connectionDestroyed, 1);
  assert.equal(clientDestroyed, 1);
  assert.equal(persisted, 1);
});

test("repeated long idle endings progressively back off and change restart reason", () => {
  const originalNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;

  const capturedRestarts = [];
  const fakeRuntime = {
    config: { name: "OmniFM Test" },
    isScheduledEventStopDue() {
      return false;
    },
    stopInGuild() {
      throw new Error("stopInGuild should not be called");
    },
    scheduleStreamRestart(guildId, state, delay, reason) {
      capturedRestarts.push({ guildId, delay, reason, streak: state.idleRestartStreak });
    },
  };

  const state = {
    shouldReconnect: true,
    currentStationKey: "rockradio",
    connection: {},
    activeScheduledEventStopAtMs: 0,
    activeScheduledEventId: null,
    lastStreamStartAt: now - (10 * 60_000),
    lastProcessExitCode: 0,
    lastProcessExitAt: 0,
    lastProcessExitDetail: null,
    lastNetworkFailureAt: 0,
    streamErrorCount: 0,
    idleRestartStreak: 0,
    lastIdleRestartAt: 0,
  };

  try {
    BotRuntime.prototype.handleStreamEnd.call(fakeRuntime, "123456789012345678", state, "idle");
    now += 60_000;
    state.lastStreamStartAt = now - (10 * 60_000);
    BotRuntime.prototype.handleStreamEnd.call(fakeRuntime, "123456789012345678", state, "idle");

    assert.equal(capturedRestarts.length, 2);
    assert.equal(capturedRestarts[0].reason, "provider-eof");
    assert.equal(capturedRestarts[1].reason, "provider-eof-repeat");
    assert.ok(capturedRestarts[1].delay > capturedRestarts[0].delay);
    assert.equal(state.idleRestartStreak, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("idle endings after broken pipe are classified separately", () => {
  const originalNow = Date.now;
  const now = 1_700_000_000_000;
  Date.now = () => now;

  let capturedRestart = null;
  const fakeRuntime = {
    config: { name: "OmniFM Test" },
    isScheduledEventStopDue() {
      return false;
    },
    stopInGuild() {
      throw new Error("stopInGuild should not be called");
    },
    scheduleStreamRestart(guildId, state, delay, reason) {
      capturedRestart = { guildId, delay, reason, errors: state.streamErrorCount };
    },
  };

  const state = {
    shouldReconnect: true,
    currentStationKey: "custom:mountainreggaeradio",
    connection: {},
    activeScheduledEventStopAtMs: 0,
    activeScheduledEventId: null,
    lastStreamStartAt: now - (20 * 60_000),
    lastProcessExitCode: 1,
    lastProcessExitAt: now - 500,
    lastProcessExitDetail: "broken-pipe",
    lastNetworkFailureAt: 0,
    streamErrorCount: 0,
    idleRestartStreak: 0,
    lastIdleRestartAt: 0,
  };

  try {
    BotRuntime.prototype.handleStreamEnd.call(fakeRuntime, "123456789012345678", state, "idle");
    assert.ok(capturedRestart);
    assert.equal(capturedRestart.reason, "idle-after-broken-pipe");
    assert.equal(capturedRestart.errors, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("commander live playback snapshots include the commander's own stream and worker streams", () => {
  const workerRuntime = {
    config: { id: "bot-worker" },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "worker-station",
        currentStationName: "Worker FM",
        lastChannelId: "voice-2",
        connection: { joinConfig: { channelId: "voice-2" } },
      }],
    ]),
    getState(guildId) {
      return this.guildState.get(guildId);
    },
    getGuildInfo(guildId) {
      const state = this.guildState.get(guildId);
      return {
        stationKey: state.currentStationKey,
        stationName: state.currentStationName,
        channelId: state.lastChannelId,
      };
    },
    getCurrentListenerCount() {
      return 4;
    },
  };
  const fakeRuntime = {
    role: "commander",
    workerManager: {
      getStreamingWorkers() {
        return [workerRuntime];
      },
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "commander-station",
        currentStationName: "Commander FM",
        lastChannelId: "voice-1",
        connection: { joinConfig: { channelId: "voice-1" } },
      }],
    ]),
    getGuildInfo(guildId) {
      const state = this.guildState.get(guildId);
      return {
        stationKey: state.currentStationKey,
        stationName: state.currentStationName,
        channelId: state.lastChannelId,
      };
    },
    getCurrentListenerCount(guildId, state) {
      return state.lastChannelId === "voice-1" ? 2 : 0;
    },
  };

  fakeRuntime.buildLocalLivePlaybackSnapshot = BotRuntime.prototype.buildLocalLivePlaybackSnapshot;

  const snapshot = BotRuntime.prototype.getLiveGuildPlaybackSnapshot.call(fakeRuntime, "guild-1");

  assert.equal(snapshot.length, 2);
  assert.deepEqual(
    snapshot.map((entry) => ({ stationName: entry.stationName, listenerCount: entry.listenerCount })),
    [
      { stationName: "Commander FM", listenerCount: 2 },
      { stationName: "Worker FM", listenerCount: 4 },
    ]
  );
});

test("worker manager can reuse a bot that is still connected in the target channel", async () => {
  const connectedWorker = {
    config: { index: 2 },
    guildState: new Map(),
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map([
          ["guild-1", {
            members: {
              me: {
                voice: {
                  channelId: "voice-7",
                },
              },
              fetchMe: async () => ({
                voice: {
                  channelId: "voice-7",
                },
              }),
            },
          }],
        ]),
        fetch: async () => null,
      },
    },
  };
  const idleWorker = {
    config: { index: 3 },
    guildState: new Map(),
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map(),
        fetch: async () => null,
      },
    },
  };

  const manager = new WorkerManager([connectedWorker, idleWorker]);
  const resolved = await manager.findConnectedWorkerByChannel("guild-1", "voice-7", "pro");

  assert.equal(resolved, connectedWorker);
});

test("now playing prefers the active voice channel over a remembered legacy target", () => {
  const candidateIds = getNowPlayingCandidateIds({
    nowPlayingChannelId: "legacy-text",
    connection: { joinConfig: { channelId: "voice-1" } },
    lastChannelId: "voice-1",
  }, {
    systemChannelId: "system-1",
  });

  assert.deepEqual(candidateIds, ["voice-1", "legacy-text", "system-1"]);
});

test("now playing signature changes when the embed target channel changes", () => {
  const meta = {
    displayTitle: "Artist - Track",
    artist: "Artist",
    title: "Track",
    artworkUrl: "https://example.com/cover.jpg",
    album: "Album",
    metadataStatus: "ok",
    metadataSource: "icy",
    musicBrainzRecordingId: "recording-1",
    musicBrainzReleaseId: "release-1",
  };
  const state = {
    connection: { joinConfig: { channelId: "voice-1" } },
    lastChannelId: "voice-1",
  };

  const activeVoiceSignature = buildNowPlayingSignature("station-a", meta, state, "voice-1");
  const legacyTargetSignature = buildNowPlayingSignature("station-a", meta, state, "legacy-text");

  assert.notEqual(activeVoiceSignature, legacyTargetSignature);
});

test("track parsing removes common prefixes and dash variants", () => {
  const parsed = parseTrackFromStreamTitle("Now Playing: Artist \u2013 Song Title");

  assert.equal(parsed.artist, "Artist");
  assert.equal(parsed.title, "Song Title");
  assert.equal(parsed.displayTitle, "Artist - Song Title");
});

test("metadata parser falls back to artist/title fields when StreamTitle is missing", () => {
  const parsed = extractTrackFromMetadataText("artist='Don Diablo';title='The Rhythm Of The Night';");

  assert.equal(parsed.artist, "Don Diablo");
  assert.equal(parsed.title, "The Rhythm Of The Night");
  assert.equal(parsed.displayTitle, "Don Diablo - The Rhythm Of The Night");
});

test("metadata parser accepts double-quoted artist/title/album fields", () => {
  const parsed = extractTrackFromMetadataText('artist="Martin Ikin";title="Out of my Head";album="Out of my Head";');

  assert.equal(parsed.artist, "Martin Ikin");
  assert.equal(parsed.title, "Out of my Head");
  assert.equal(parsed.album, "Out of my Head");
  assert.equal(parsed.displayTitle, "Martin Ikin - Out of my Head");
});

test("usable stream metadata is enough to skip audio recognition fallback", () => {
  assert.equal(hasUsableStreamTrack({ displayTitle: "Artist - Title" }), true);
  assert.equal(hasUsableStreamTrack({ raw: "Station Artist - Song" }), true);
  assert.equal(hasUsableStreamTrack({ artist: "", title: "" }), false);
});

test("track search text removes broadcast noise for better cover lookup", () => {
  const cleaned = normalizeTrackSearchText("Metro (Played by Mau P Freedom TML 24)");

  assert.equal(cleaned, "Metro");
});

test("AcoustID candidate extraction keeps artist, title, album, and score", () => {
  const candidate = extractAcoustIdCandidate(
    { id: "acoustid-1", score: 0.91 },
    {
      id: "2f1f6b1f-0d34-4d84-ae8e-9b2d4c69f555",
      title: "The Rhythm Of The Night",
      artists: [{ name: "Corona" }],
      releases: [{ id: "e50d244f-97db-4f3b-8208-0f5e4f89b8e1", title: "The Rhythm Of The Night" }],
    }
  );

  assert.equal(candidate.artist, "Corona");
  assert.equal(candidate.title, "The Rhythm Of The Night");
  assert.equal(candidate.album, "The Rhythm Of The Night");
  assert.equal(candidate.score, 0.91);
});

test("fpcalc output parser extracts duration and fingerprint", () => {
  const parsed = parseFpcalcOutput("FILE=sample.wav\nDURATION=17.8\nFINGERPRINT=abc123\n");

  assert.deepEqual(parsed, {
    duration: 18,
    fingerprint: "abc123",
  });
});

test("fpcalc code 3 with usable stdout still yields a fingerprint result", () => {
  const error = Object.assign(new Error("fpcalc exited with code 3"), {
    code: 3,
    command: "fpcalc",
    stdout: "ERROR: Error decoding audio frame (End of file)\nDURATION=22\nFINGERPRINT=abc123\n",
  });

  assert.deepEqual(extractFpcalcResultFromError(error), {
    duration: 22,
    fingerprint: "abc123",
  });
});

test("wav duration estimate matches mono 11025 Hz PCM sizing", () => {
  const bytesForTwelveSeconds = 44 + (12 * 11025 * 2);
  assert.equal(estimatePcmWavDurationSeconds(bytesForTwelveSeconds), 12);
});

test("wav duration estimate respects configured sample rate and channels", () => {
  const bytesForEightSecondsStereo = 44 + (8 * 44100 * 2 * 2);
  assert.equal(estimatePcmWavDurationSeconds(bytesForEightSecondsStereo, 44100, 2), 8);
});

test("recognition decode EOF errors are treated as soft failures", () => {
  const error = new Error("fpcalc exited with code 3: ERROR: Error decoding audio frame (End of file)");
  assert.equal(isSoftRecognitionFailure(error), true);
});

test("recognition EOF errors remain soft failures for retryable sample repair", () => {
  const error = new Error("fpcalc exited with code 3: ERROR: Error decoding audio frame (End of file)");
  assert.equal(isSoftRecognitionFailure(error), true);
});

test("recognition missing-input errors are treated as soft failures", () => {
  const error = new Error("fpcalc exited with code 2: ERROR: Could not open the input file (No such file or directory)");
  assert.equal(isFpcalcMissingInputError(error), true);
  assert.equal(isSoftRecognitionFailure(error), true);
});

test("now playing queue coalesces duplicate queued task ids", async () => {
  const queue = new NowPlayingQueue(1);
  let releaseFirstTask;
  let secondTaskRuns = 0;

  const firstTask = queue.enqueue("guild-1", async () => new Promise((resolve) => {
    releaseFirstTask = resolve;
  }));
  const secondTaskA = queue.enqueue("guild-2", async () => {
    secondTaskRuns += 1;
    return "first";
  });
  const secondTaskB = queue.enqueue("guild-2", async () => {
    secondTaskRuns += 1;
    return "second";
  });

  assert.equal(secondTaskA, secondTaskB);
  releaseFirstTask();
  await firstTask;
  const result = await secondTaskB;

  assert.equal(result, "second");
  assert.equal(secondTaskRuns, 1);
});

test("AcoustID best-match selection rejects weak matches and prefers the richest strong match", () => {
  const match = selectBestAcoustIdMatch({
    status: "ok",
    results: [
      {
        id: "weak",
        score: 0.31,
        recordings: [{ title: "Unknown Song", artists: [{ name: "Unknown Artist" }] }],
      },
      {
        id: "strong",
        score: 0.88,
        recordings: [{
          id: "2f1f6b1f-0d34-4d84-ae8e-9b2d4c69f555",
          title: "Starlight",
          artists: [{ name: "The Supermen Lovers", joinphrase: " feat. " }, { name: "Mani Hoffman" }],
          releases: [{ id: "e50d244f-97db-4f3b-8208-0f5e4f89b8e1", title: "The Player" }],
        }],
      },
    ],
  });

  assert.ok(match);
  assert.equal(match.displayTitle, "The Supermen Lovers feat. Mani Hoffman - Starlight");
  assert.equal(match.album, "The Player");
  assert.equal(match.acoustidId, "strong");
});

test("event time parser accepts screenshot-style YYYY-DD-MM input", () => {
  const parsed = buildEventDateTimeFromParts({
    rawDateTime: "2026-28-02 20:15",
    language: "de",
    preferredTimeZone: "Europe/Berlin",
    nowMs: Date.UTC(2026, 1, 20, 12, 0, 0, 0),
  });

  assert.equal(parsed.ok, true);
  assert.equal(new Date(parsed.runAtMs).toISOString(), "2026-02-28T19:15:00.000Z");
});

test("event time parser accepts time-only input and starts immediately around now", () => {
  const nowMs = Date.UTC(2026, 1, 28, 19, 0, 30, 0);
  const parsed = buildEventDateTimeFromParts({
    rawDateTime: "20:00",
    language: "de",
    preferredTimeZone: "Europe/Berlin",
    nowMs,
    fallbackRunAtMs: nowMs,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.runAtMs, nowMs);
});

test("default language falls back to English when nothing explicit is set", () => {
  assert.equal(getDefaultLanguage(), "en");
});

test("slash commands expose English defaults with German localizations", () => {
  const commands = buildCommandsJson();
  const play = commands.find((command) => command.name === "play");
  const language = commands.find((command) => command.name === "language");
  const setup = commands.find((command) => command.name === "setup");

  assert.ok(play);
  assert.equal(play.description, "Start a radio stream in your voice channel");
  assert.equal(play.description_localizations.de, "Startet einen Radio-Stream in deinem Voice-Channel");

  assert.ok(setup);
  assert.equal(setup.description, "Show the guided first-run setup for this server");
  assert.equal(setup.description_localizations.de, "Zeigt den geführten Erststart für diesen Server");

  assert.ok(language);
  assert.equal(language.description, "Manage the language for this server");
  assert.equal(language.description_localizations.de, "Sprache für diesen Server verwalten");
});

test("workers command exposes private and panel view options", () => {
  const commands = buildCommandsJson();
  const workers = commands.find((command) => command.name === "workers");
  assert.ok(workers);

  const viewOption = (workers.options || []).find((option) => option.name === "view");
  assert.ok(viewOption);
  const choices = Array.isArray(viewOption.choices) ? viewOption.choices : [];
  assert.equal(choices.length, 2);
  assert.equal(choices[0].value, "private");
  assert.equal(choices[1].value, "panel");
});

test("worker autoheal exits only when the whole worker is stuck recovering for too long", () => {
  const runtime = {
    startedAt: Date.now() - (40 * 60 * 1000),
    client: {
      isReady: () => true,
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-a",
        shouldReconnect: true,
        lastChannelId: "channel-a",
        connection: null,
        reconnectAttempts: 7,
        reconnectCount: 12,
        reconnectTimer: { active: true },
        reconnectInFlight: false,
        voiceConnectInFlight: false,
        streamRestartTimer: null,
        reconnectCircuitOpenUntil: 0,
      }],
    ]),
  };

  const options = {
    unhealthyMs: 10 * 60 * 1000,
    graceMs: 5 * 60 * 1000,
  };
  const firstNow = Date.now();
  const firstPass = evaluateWorkerAutohealState(runtime, new Map(), options, firstNow);
  assert.equal(firstPass.shouldExit, false);
  assert.equal(firstPass.recoveringGuilds.length, 1);

  const secondPass = evaluateWorkerAutohealState(
    runtime,
    firstPass.unhealthySinceByGuild,
    options,
    firstNow + (11 * 60 * 1000)
  );
  assert.equal(secondPass.shouldExit, true);
  assert.equal(secondPass.stuckGuilds.length, 1);
});

test("worker autoheal does not restart a worker while another guild is still healthy", () => {
  const now = Date.now();
  const runtime = {
    startedAt: now - (50 * 60 * 1000),
    client: {
      isReady: () => true,
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-a",
        shouldReconnect: true,
        lastChannelId: "channel-a",
        connection: null,
        reconnectAttempts: 9,
        reconnectTimer: { active: true },
      }],
      ["guild-2", {
        currentStationKey: "station-b",
        shouldReconnect: true,
        lastChannelId: "channel-b",
        connection: {
          joinConfig: {
            channelId: "channel-b",
          },
        },
      }],
    ]),
  };

  const evaluation = evaluateWorkerAutohealState(
    runtime,
    new Map([["guild-1", now - (20 * 60 * 1000)]]),
    {
      unhealthyMs: 10 * 60 * 1000,
      graceMs: 5 * 60 * 1000,
    },
    now
  );

  assert.equal(evaluation.activeVoiceCount, 1);
  assert.equal(evaluation.shouldExit, false);
  assert.equal(evaluation.stuckGuilds.length, 1);
});

test("worker autoheal blocks stuck recovery targets before a restart", () => {
  const now = Date.now();
  const reconnectTimer = setTimeout(() => {}, 1_000);
  const streamRestartTimer = setTimeout(() => {}, 1_000);
  try {
    const runtime = {
      guildState: new Map([
        ["guild-1", {
          currentStationKey: "station-a",
          shouldReconnect: true,
          lastChannelId: "channel-a",
          reconnectTimer,
          streamRestartTimer,
          reconnectInFlight: true,
          voiceConnectInFlight: true,
          restoreBlockCount: 1,
        }],
      ]),
    };

    const applied = applyWorkerAutohealRecoveryBlock(
      runtime,
      [{ guildId: "guild-1" }],
      {
        WORKER_AUTOHEAL_BLOCK_MS: String(15 * 60_000),
        WORKER_AUTOHEAL_BLOCK_MAX_MS: String(60 * 60_000),
      },
      now
    );

    const state = runtime.guildState.get("guild-1");
    assert.equal(applied.length, 1);
    assert.equal(applied[0].delayMs, 30 * 60_000);
    assert.equal(state.shouldReconnect, false);
    assert.equal(state.reconnectTimer, null);
    assert.equal(state.streamRestartTimer, null);
    assert.equal(state.reconnectInFlight, false);
    assert.equal(state.voiceConnectInFlight, false);
    assert.equal(state.restoreBlockCount, 2);
    assert.equal(state.restoreBlockReason, "worker-autoheal");
    assert.equal(state.restoreBlockedAt, now);
    assert.equal(state.restoreBlockedUntil, now + (30 * 60_000));
  } finally {
    clearTimeout(reconnectTimer);
    clearTimeout(streamRestartTimer);
  }
});

test("worker autoheal skips the forced restart when Discord still reports an active voice channel", async () => {
  const originalDateNow = Date.now;
  let queued = 0;
  let persistCalls = 0;
  let exitCode = null;
  const now = Date.now();
  const runtime = {
    config: { name: "OmniFM 9", index: 9 },
    startedAt: now - (50 * 60 * 1000),
    client: {
      isReady: () => true,
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-a",
        currentStationName: "Station A",
        shouldReconnect: true,
        lastChannelId: "voice-1",
        connection: null,
        reconnectAttempts: 8,
        reconnectTimer: { active: true },
      }],
    ]),
    async fetchBotVoiceState() {
      return { guild: {}, voiceState: {}, channelId: "voice-1" };
    },
    queueVoiceStateReconcile() {
      queued += 1;
    },
    persistState() {
      persistCalls += 1;
    },
  };

  const monitor = startWorkerAutohealMonitor({
    runtime,
    exit(code) {
      exitCode = code;
    },
    env: {
      WORKER_AUTOHEAL_ENABLED: "1",
      WORKER_AUTOHEAL_CHECK_MS: "30000",
      WORKER_AUTOHEAL_GRACE_MS: "600000",
      WORKER_AUTOHEAL_RECOVERING_MS: "1200000",
    },
  });

  try {
    Date.now = () => now;
    const firstPass = await monitor.tick();
    assert.equal(firstPass.shouldExit, false);

    Date.now = () => now + (22 * 60 * 1000);
    const secondPass = await monitor.tick();

    assert.equal(secondPass.shouldExit, false);
    assert.equal(Array.isArray(secondPass.observedVoiceGuilds), true);
    assert.equal(secondPass.observedVoiceGuilds.length, 1);
    assert.equal(queued, 1);
    assert.equal(persistCalls >= 1, true);
    assert.equal(exitCode, null);
  } finally {
    Date.now = originalDateNow;
    monitor.stop();
  }
});
