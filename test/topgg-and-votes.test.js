import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

import {
  buildTopGGCommandsPayload,
  collectTopGGStats,
  getTopGGStatus,
  handleTopGGWebhook,
  syncTopGGCommands,
  syncTopGGProject,
  syncTopGGStats,
  syncTopGGVotes,
} from "../src/services/topgg.js";
import { getVoteEventsState } from "../src/vote-events-store.js";
import { resolveRuntimeDataPath } from "../src/lib/runtime-data-path.js";

// Where the stores write: the runtime data directory, which the unit runner
// gives every test file of its own (#553).
const topGGStatePath = resolveRuntimeDataPath("topgg.json");
const voteEventsPath = resolveRuntimeDataPath("vote-events.json");

function restoreEnvSnapshot(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function snapshotFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function restoreFile(filePath, snapshot) {
  if (snapshot === null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.writeFileSync(filePath, snapshot, "utf8");
}

test("TopGG aggregate stats deduplicate guilds across runtimes", () => {
  const runtimes = [
    {
      role: "commander",
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["1", { id: "1", memberCount: 10 }],
            ["2", { id: "2", memberCount: 20 }],
          ]),
        },
      },
      collectStats: () => ({ servers: 2, users: 30 }),
    },
    {
      role: "worker",
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["2", { id: "2", memberCount: 20 }],
            ["3", { id: "3", memberCount: 40 }],
          ]),
        },
      },
      collectStats: () => ({ servers: 2, users: 60 }),
    },
  ];

  const stats = collectTopGGStats(runtimes, "aggregate");

  assert.equal(stats.scope, "aggregate");
  assert.equal(stats.guildCount, 3);
  assert.equal(stats.userCount, 70);
});

test("TopGG stats sync posts documented server_count payload", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    TOPGG_ENABLED: process.env.TOPGG_ENABLED,
    TOPGG_TOKEN: process.env.TOPGG_TOKEN,
    TOPGG_BOT_ID: process.env.TOPGG_BOT_ID,
    TOPGG_STATS_SCOPE: process.env.TOPGG_STATS_SCOPE,
    TOPGG_REQUEST_MAX_RETRIES: process.env.TOPGG_REQUEST_MAX_RETRIES,
    TOPGG_REQUEST_RETRY_BASE_MS: process.env.TOPGG_REQUEST_RETRY_BASE_MS,
    TOPGG_REQUEST_RETRY_MAX_MS: process.env.TOPGG_REQUEST_RETRY_MAX_MS,
  };
  const topGGSnapshot = snapshotFile(topGGStatePath);

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnvSnapshot(originalEnv);
    restoreFile(topGGStatePath, topGGSnapshot);
  });

  process.env.TOPGG_ENABLED = "1";
  process.env.TOPGG_TOKEN = "test-topgg-token";
  process.env.TOPGG_BOT_ID = "1476192449721274472";
  process.env.TOPGG_STATS_SCOPE = "aggregate";

  const runtimes = [
    {
      role: "commander",
      getApplicationId: () => "1476192449721274472",
      config: { clientId: "1476192449721274472" },
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([["1", { id: "1", memberCount: 10 }]]),
        },
        shard: {
          count: 2,
          ids: [0],
        },
      },
      collectStats: () => ({ servers: 1, users: 10 }),
    },
    {
      role: "worker",
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([["2", { id: "2", memberCount: 15 }]]),
        },
      },
      collectStats: () => ({ servers: 1, users: 15 }),
    },
  ];

  global.fetch = async (url, options = {}) => {
    assert.equal(url, "https://top.gg/api/bots/1476192449721274472/stats");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "test-topgg-token");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), {
      server_count: 2,
      shard_count: 2,
      shard_id: 0,
    });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true });
      },
    };
  };

  const result = await syncTopGGStats(runtimes);

  assert.equal(result.ok, true);
  assert.equal(result.guildCount, 2);
  assert.equal(result.userCount, 25);
  assert.equal(result.shardCount, 2);
  assert.equal(result.shardId, 0);
  assert.equal(fs.existsSync(topGGStatePath), true);
});

test("TopGG stats sync retries transient 500 responses before succeeding", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    TOPGG_ENABLED: process.env.TOPGG_ENABLED,
    TOPGG_TOKEN: process.env.TOPGG_TOKEN,
    TOPGG_BOT_ID: process.env.TOPGG_BOT_ID,
    TOPGG_STATS_SCOPE: process.env.TOPGG_STATS_SCOPE,
    TOPGG_REQUEST_MAX_RETRIES: process.env.TOPGG_REQUEST_MAX_RETRIES,
    TOPGG_REQUEST_RETRY_BASE_MS: process.env.TOPGG_REQUEST_RETRY_BASE_MS,
    TOPGG_REQUEST_RETRY_MAX_MS: process.env.TOPGG_REQUEST_RETRY_MAX_MS,
  };
  const topGGSnapshot = snapshotFile(topGGStatePath);

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnvSnapshot(originalEnv);
    restoreFile(topGGStatePath, topGGSnapshot);
  });

  process.env.TOPGG_ENABLED = "1";
  process.env.TOPGG_TOKEN = "test-topgg-token";
  process.env.TOPGG_BOT_ID = "1476192449721274472";
  process.env.TOPGG_STATS_SCOPE = "aggregate";
  process.env.TOPGG_REQUEST_MAX_RETRIES = "2";
  process.env.TOPGG_REQUEST_RETRY_BASE_MS = "0";
  process.env.TOPGG_REQUEST_RETRY_MAX_MS = "0";

  const runtimes = [{
    role: "commander",
    getApplicationId: () => "1476192449721274472",
    config: { clientId: "1476192449721274472" },
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map([["1", { id: "1", memberCount: 10 }]]),
      },
      shard: {
        count: 1,
        ids: [0],
      },
    },
    collectStats: () => ({ servers: 1, users: 10 }),
  }];

  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: false,
        status: 500,
        headers: {
          get() {
            return null;
          },
        },
        async text() {
          return JSON.stringify({ message: "HTTP 500" });
        },
      };
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get() {
          return null;
        },
      },
      async text() {
        return JSON.stringify({ success: true });
      },
    };
  };

  const result = await syncTopGGStats(runtimes);

  assert.equal(callCount, 2);
  assert.equal(result.ok, true);
  assert.equal(result.guildCount, 1);
});

test("TopGG stats sync does not retry authentication failures", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    TOPGG_ENABLED: process.env.TOPGG_ENABLED,
    TOPGG_TOKEN: process.env.TOPGG_TOKEN,
    TOPGG_BOT_ID: process.env.TOPGG_BOT_ID,
    TOPGG_STATS_SCOPE: process.env.TOPGG_STATS_SCOPE,
    TOPGG_REQUEST_MAX_RETRIES: process.env.TOPGG_REQUEST_MAX_RETRIES,
    TOPGG_REQUEST_RETRY_BASE_MS: process.env.TOPGG_REQUEST_RETRY_BASE_MS,
    TOPGG_REQUEST_RETRY_MAX_MS: process.env.TOPGG_REQUEST_RETRY_MAX_MS,
  };
  const topGGSnapshot = snapshotFile(topGGStatePath);

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnvSnapshot(originalEnv);
    restoreFile(topGGStatePath, topGGSnapshot);
  });

  process.env.TOPGG_ENABLED = "1";
  process.env.TOPGG_TOKEN = "test-topgg-token";
  process.env.TOPGG_BOT_ID = "1476192449721274472";
  process.env.TOPGG_STATS_SCOPE = "aggregate";
  process.env.TOPGG_REQUEST_MAX_RETRIES = "3";
  process.env.TOPGG_REQUEST_RETRY_BASE_MS = "0";
  process.env.TOPGG_REQUEST_RETRY_MAX_MS = "0";

  const runtimes = [{
    role: "commander",
    getApplicationId: () => "1476192449721274472",
    config: { clientId: "1476192449721274472" },
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map([["1", { id: "1", memberCount: 10 }]]),
      },
      shard: {
        count: 1,
        ids: [0],
      },
    },
    collectStats: () => ({ servers: 1, users: 10 }),
  }];

  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 401,
      headers: {
        get() {
          return null;
        },
      },
      async text() {
        return JSON.stringify({ message: "Unauthorized" });
      },
    };
  };

  await assert.rejects(
    () => syncTopGGStats(runtimes),
    /failed \(401\): Unauthorized/
  );
  assert.equal(callCount, 1);
});

test("TopGG commands sync uses the v1 projects API with Bearer auth", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    TOPGG_ENABLED: process.env.TOPGG_ENABLED,
    TOPGG_TOKEN: process.env.TOPGG_TOKEN,
    TOPGG_BOT_ID: process.env.TOPGG_BOT_ID,
  };
  const topGGSnapshot = snapshotFile(topGGStatePath);

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnvSnapshot(originalEnv);
    restoreFile(topGGStatePath, topGGSnapshot);
  });

  process.env.TOPGG_ENABLED = "1";
  process.env.TOPGG_TOKEN = "test-topgg-token";
  process.env.TOPGG_BOT_ID = "1476192449721274472";

  const commands = buildTopGGCommandsPayload();

  global.fetch = async (url, options = {}) => {
    assert.equal(url, "https://top.gg/api/v1/projects/@me/commands");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-topgg-token");
    assert.equal(options.headers["Content-Type"], "application/json");
    const parsed = JSON.parse(options.body);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, commands.length);
    assert.equal(parsed.some((command) => command.name === "play"), true);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true });
      },
    };
  };

  const result = await syncTopGGCommands([{ role: "commander", getApplicationId: () => "1476192449721274472", config: { clientId: "1476192449721274472" } }]);

  assert.equal(result.ok, true);
  assert.equal(result.commandCount, commands.length);
});

test("TopGG project and vote sync normalize votes into the shared provider store", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    TOPGG_ENABLED: process.env.TOPGG_ENABLED,
    TOPGG_TOKEN: process.env.TOPGG_TOKEN,
    TOPGG_BOT_ID: process.env.TOPGG_BOT_ID,
    TOPGG_VOTE_SYNC_START_DAYS: process.env.TOPGG_VOTE_SYNC_START_DAYS,
  };
  const topGGSnapshot = snapshotFile(topGGStatePath);
  const voteEventsSnapshot = snapshotFile(voteEventsPath);

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnvSnapshot(originalEnv);
    restoreFile(topGGStatePath, topGGSnapshot);
    restoreFile(voteEventsPath, voteEventsSnapshot);
  });

  process.env.TOPGG_ENABLED = "1";
  process.env.TOPGG_TOKEN = "test-topgg-token";
  process.env.TOPGG_BOT_ID = "1476192449721274472";
  process.env.TOPGG_VOTE_SYNC_START_DAYS = "7";

  const runtimes = [{ role: "commander", getApplicationId: () => "1476192449721274472", config: { clientId: "1476192449721274472" } }];
  const requestedUrls = [];

  global.fetch = async (url, options = {}) => {
    requestedUrls.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-topgg-token");
    if (url === "https://top.gg/api/v1/projects/@me") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "proj_1",
            name: "OmniFM DJ",
            platform: "discord",
            type: "bot",
            headline: "24/7 radio bot",
            tags: ["music", "radio"],
            votes: 12,
            votes_total: 123,
            review_score: 4.8,
            review_count: 42,
          });
        },
      };
    }
    if (url.startsWith("https://top.gg/api/v1/projects/@me/votes?startDate=")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            cursor: "cursor-1",
            data: [{
              user_id: "topgg-user-1",
              platform_id: "623456789012345678",
              weight: 1,
              created_at: "2026-03-16T08:00:00.000Z",
              expires_at: "2026-03-16T20:00:00.000Z",
            }],
          });
        },
      };
    }
    if (url === "https://top.gg/api/v1/projects/@me/votes?cursor=cursor-1") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            cursor: "",
            data: [{
              user_id: "topgg-user-2",
              platform_id: "723456789012345678",
              weight: 2,
              created_at: "2026-03-16T09:00:00.000Z",
              expires_at: "2026-03-16T21:00:00.000Z",
            }],
          });
        },
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const projectResult = await syncTopGGProject(runtimes);
  const votesResult = await syncTopGGVotes(runtimes);
  const status = getTopGGStatus(runtimes, { voteLimit: 10 });
  const sharedVotes = getVoteEventsState({ provider: "topgg", limit: 10 });

  assert.equal(projectResult.ok, true);
  assert.equal(projectResult.project.id, "proj_1");
  assert.equal(projectResult.project.votesTotal, 123);
  assert.equal(votesResult.ok, true);
  assert.equal(votesResult.received, 2);
  assert.equal(votesResult.added, 2);
  assert.equal(status.state.project.id, "proj_1");
  assert.equal(status.state.totalVotes, 2);
  assert.equal(status.state.votes.length, 2);
  assert.equal(sharedVotes.totalVotes, 2);
  assert.equal(sharedVotes.votes[0].provider, "topgg");
  assert.equal(requestedUrls.includes("https://top.gg/api/v1/projects/@me"), true);
});

test("TopGG webhook accepts signed vote payloads and deduplicates retries", async (t) => {
  const originalEnv = {
    TOPGG_ENABLED: process.env.TOPGG_ENABLED,
    TOPGG_TOKEN: process.env.TOPGG_TOKEN,
    TOPGG_BOT_ID: process.env.TOPGG_BOT_ID,
    TOPGG_WEBHOOK_SECRET: process.env.TOPGG_WEBHOOK_SECRET,
  };
  const topGGSnapshot = snapshotFile(topGGStatePath);
  const voteEventsSnapshot = snapshotFile(voteEventsPath);

  t.after(() => {
    restoreEnvSnapshot(originalEnv);
    restoreFile(topGGStatePath, topGGSnapshot);
    restoreFile(voteEventsPath, voteEventsSnapshot);
  });

  process.env.TOPGG_ENABLED = "1";
  process.env.TOPGG_TOKEN = "test-topgg-token";
  process.env.TOPGG_BOT_ID = "1476192449721274472";
  process.env.TOPGG_WEBHOOK_SECRET = "whs_test_topgg";

  const rawBody = JSON.stringify({
    type: "vote.create",
    data: {
      id: "vote-1",
      weight: 1,
      created_at: "2026-03-16T10:00:00.000Z",
      expires_at: "2026-03-16T22:00:00.000Z",
      project: {
        id: "proj_1",
        type: "bot",
        platform: "discord",
        platform_id: "1476192449721274472",
      },
      user: {
        id: "topgg-user-1",
        platform_id: "623456789012345678",
        name: "VoteUser",
        avatar_url: "https://cdn.example/avatar.png",
      },
    },
  });
  const timestamp = "1710583200";
  const signature = crypto
    .createHmac("sha256", process.env.TOPGG_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const headers = {
    "x-topgg-signature": `t=${timestamp},v1=${signature}`,
  };

  const first = handleTopGGWebhook(headers, rawBody);
  const second = handleTopGGWebhook(headers, rawBody);
  const sharedVotes = getVoteEventsState({ provider: "topgg", limit: 10 });

  assert.equal(first.ok, true);
  assert.equal(first.added, true);
  assert.equal(first.totalVotes, 1);
  assert.equal(second.ok, true);
  assert.equal(second.added, false);
  assert.equal(second.totalVotes, 1);
  assert.equal(sharedVotes.totalVotes, 1);
  assert.equal(sharedVotes.votes[0].userId, "623456789012345678");
});
