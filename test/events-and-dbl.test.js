import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveRuntimeDataPath } from "../src/lib/runtime-data-path.js";

import { buildCustomStationReference } from "../src/custom-stations.js";
import { normalizeScheduledEventInput } from "../src/scheduled-events-store.js";
import { buildPublicStationCatalog } from "../src/lib/public-stations.js";
import { buildScopedStationsData, filterStationsByTier } from "../src/stations-store.js";
import {
  collectBotsGGStats,
  syncBotsGGStats,
} from "../src/services/botsgg.js";
import {
  buildDiscordBotListCommandsPayload,
  buildDiscordBotListPublicUrls,
  collectDiscordBotListStats,
  fetchDiscordBotListPublicBotSummary,
  syncDiscordBotListCommands,
  syncDiscordBotListStats,
} from "../src/services/discordbotlist.js";

// The runtime data directory, which the unit runner gives every test file of its own (#553).
const botsGGStatePath = resolveRuntimeDataPath("botsgg.json");

test("scheduled events keep custom station references intact", () => {
  const customStationKey = buildCustomStationReference("nightshift");
  const normalized = normalizeScheduledEventInput({
    id: "evt_custom_ref",
    guildId: "123456789012345678",
    botId: "bot-main",
    name: "Night Shift",
    stationKey: customStationKey,
    voiceChannelId: "234567890123456789",
    runAtMs: Date.now() + 60_000,
    durationMs: 90 * 60 * 1000,
  });

  assert.ok(normalized);
  assert.equal(normalized.stationKey, customStationKey);
  assert.equal(normalized.durationMs, 90 * 60 * 1000);
});

test("scheduled events keep monthly repeat modes and sync metadata", () => {
  const normalized = normalizeScheduledEventInput({
    id: "evt_monthly_sync",
    guildId: "123456789012345678",
    botId: "bot-main",
    name: "Monthly Stage Night",
    stationKey: "lofi",
    voiceChannelId: "234567890123456789",
    runAtMs: Date.now() + 120_000,
    repeat: "monthly_first_weekday",
    discordSyncError: "Missing Create Events permission.",
    updatedAt: "2026-03-03T10:00:00.000Z",
  });

  assert.ok(normalized);
  assert.equal(normalized.repeat, "monthly_first_weekday");
  assert.equal(normalized.discordSyncError, "Missing Create Events permission.");
  assert.equal(normalized.updatedAt, "2026-03-03T10:00:00.000Z");
});

test("scheduled events accept extended dashboard repeat modes", () => {
  const normalized = normalizeScheduledEventInput({
    id: "evt_extended_repeat",
    guildId: "123456789012345678",
    botId: "bot-main",
    name: "Extended Repeat",
    stationKey: "dance",
    voiceChannelId: "234567890123456789",
    runAtMs: Date.now() + 120_000,
    repeat: "weekdays",
  });

  assert.ok(normalized);
  assert.equal(normalized.repeat, "weekdays");
});

test("scheduled events still downgrade unknown repeat modes to none", () => {
  const normalized = normalizeScheduledEventInput({
    id: "evt_bad_repeat",
    guildId: "123456789012345678",
    botId: "bot-main",
    name: "Broken Repeat",
    stationKey: "dance",
    voiceChannelId: "234567890123456789",
    runAtMs: Date.now() + 120_000,
    repeat: "every_three_days",
  });

  assert.ok(normalized);
  assert.equal(normalized.repeat, "none");
});

test("public station catalog excludes custom and ultimate stations from public totals", () => {
  const catalog = buildPublicStationCatalog({
    defaultStationKey: "lofi",
    qualityPreset: "high",
    stations: {
      lofi: { name: "LoFi", url: "https://example.com/lofi", tier: "free" },
      hits: { name: "Hits", url: "https://example.com/hits", tier: "pro" },
      premium: { name: "Premium", url: "https://example.com/premium", tier: "ultimate" },
      "custom:secret": { name: "Secret", url: "https://example.com/secret", tier: "ultimate" },
    },
  });

  assert.equal(catalog.total, 2);
  assert.equal(catalog.freeStations, 1);
  assert.equal(catalog.proStations, 1);
  assert.equal(catalog.ultimateStations, 0);
  assert.deepEqual(catalog.stations.map((station) => station.key), ["lofi", "hits"]);
});

test("tier filtering excludes leaked custom station keys from official station lists", () => {
  const filtered = filterStationsByTier({
    lofi: { name: "LoFi", url: "https://example.com/lofi", tier: "free" },
    hits: { name: "Hits", url: "https://example.com/hits", tier: "pro" },
    "custom:secret": { name: "Secret", url: "https://example.com/secret", tier: "ultimate" },
  }, "ultimate");

  assert.deepEqual(Object.keys(filtered), ["lofi", "hits"]);
});

test("scoped station catalogs clone station maps instead of mutating the source catalog", () => {
  const source = {
    defaultStationKey: "lofi",
    qualityPreset: "high",
    locked: false,
    fallbackKeys: ["lofi", "hits", "custom:secret"],
    stations: {
      lofi: { name: "LoFi", url: "https://example.com/lofi", tier: "free" },
      hits: { name: "Hits", url: "https://example.com/hits", tier: "pro" },
    },
  };

  const scoped = buildScopedStationsData(source, {
    ...source.stations,
    "custom:secret": { name: "Secret", url: "https://example.com/secret", tier: "ultimate" },
  });

  assert.equal(Object.prototype.hasOwnProperty.call(source.stations, "custom:secret"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(scoped.stations, "custom:secret"), true);
  assert.deepEqual(scoped.fallbackKeys, ["lofi", "hits", "custom:secret"]);
});

test("DiscordBotList aggregate stats deduplicate guilds across runtimes", () => {
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
      collectStats: () => ({ servers: 2, users: 30, connections: 1 }),
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
      collectStats: () => ({ servers: 2, users: 60, connections: 2 }),
    },
  ];

  const stats = collectDiscordBotListStats(runtimes, "aggregate");

  assert.equal(stats.scope, "aggregate");
  assert.equal(stats.guilds, 3);
  assert.equal(stats.users, 70);
  assert.equal(stats.voiceConnections, 3);
});

test("DiscordBotList commands payload includes slash commands for publish", () => {
  const commands = buildDiscordBotListCommandsPayload();
  const names = commands.map((command) => command.name);

  assert.ok(names.includes("play"));
  assert.ok(names.includes("event"));
  assert.ok(names.includes("license"));
});

test("DiscordBotList public URL helper targets the DiscordBotList page and owner API", () => {
  process.env.DISCORDBOTLIST_SLUG = "omnifm-dj";
  const urls = buildDiscordBotListPublicUrls("1476192449721274472");

  assert.equal(urls.listingUrl, "https://discordbotlist.com/bots/omnifm-dj");
  assert.equal(urls.publicApiUrl, null);
  assert.equal(urls.ownerApiUrl, "https://discordbotlist.com/api/v1/bots/1476192449721274472");
  delete process.env.DISCORDBOTLIST_SLUG;
});

test("DiscordBotList public summary inspects the DiscordBotList page when a slug is configured", async (t) => {
  const originalFetch = global.fetch;
  const originalSlug = process.env.DISCORDBOTLIST_SLUG;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalSlug === undefined) delete process.env.DISCORDBOTLIST_SLUG;
    else process.env.DISCORDBOTLIST_SLUG = originalSlug;
  });

  process.env.DISCORDBOTLIST_SLUG = "omnifm-dj";
  global.fetch = async (url) => {
    assert.equal(url, "https://discordbotlist.com/bots/omnifm-dj");
    return {
      ok: true,
      status: 200,
      async text() {
        return `
          <html>
            <head>
              <title>OmniFM DJ Discord Bot | Discord Bot List</title>
              <meta property="og:title" content="OmniFM DJ Discord Bot" />
              <meta property="og:description" content="Reliable 24/7 radio streaming for Discord communities." />
            </head>
            <body>
              42 upvotes in the last month
            </body>
          </html>
        `;
      },
    };
  };

  const summary = await fetchDiscordBotListPublicBotSummary("1476192449721274472");

  assert.equal(summary.ok, true);
  assert.equal(summary.botId, "1476192449721274472");
  assert.equal(summary.username, "OmniFM DJ");
  assert.equal(summary.description, "Reliable 24/7 radio streaming for Discord communities.");
  assert.equal(summary.monthVotes, 42);
  assert.equal(summary.listingUrl, "https://discordbotlist.com/bots/omnifm-dj");
  assert.equal(summary.publicApiUrl, null);
  assert.equal(summary.ownerApiUrl, "https://discordbotlist.com/api/v1/bots/1476192449721274472");
  assert.equal(summary.source, "public_html");
});

test("DiscordBotList commands sync uses the documented Bot token auth header", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    DISCORDBOTLIST_ENABLED: process.env.DISCORDBOTLIST_ENABLED,
    DISCORDBOTLIST_TOKEN: process.env.DISCORDBOTLIST_TOKEN,
    DISCORDBOTLIST_BOT_ID: process.env.DISCORDBOTLIST_BOT_ID,
  };

  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.DISCORDBOTLIST_ENABLED = "1";
  process.env.DISCORDBOTLIST_TOKEN = "test-discordbotlist-token";
  process.env.DISCORDBOTLIST_BOT_ID = "1476192449721274472";

  global.fetch = async (url, options = {}) => {
    assert.equal(url, "https://discordbotlist.com/api/v1/bots/1476192449721274472/commands");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bot test-discordbotlist-token");
    assert.equal(options.headers["Content-Type"], "application/json");
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true });
      },
    };
  };

  const result = await syncDiscordBotListCommands([
    {
      role: "commander",
      getApplicationId: () => "1476192449721274472",
      config: { clientId: "1476192449721274472" },
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.commandCount > 0, true);
});

test("DiscordBotList stats sync includes shard_id when the commander shard is known", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    DISCORDBOTLIST_ENABLED: process.env.DISCORDBOTLIST_ENABLED,
    DISCORDBOTLIST_TOKEN: process.env.DISCORDBOTLIST_TOKEN,
    DISCORDBOTLIST_BOT_ID: process.env.DISCORDBOTLIST_BOT_ID,
    DISCORDBOTLIST_STATS_SCOPE: process.env.DISCORDBOTLIST_STATS_SCOPE,
  };

  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.DISCORDBOTLIST_ENABLED = "1";
  process.env.DISCORDBOTLIST_TOKEN = "test-discordbotlist-token";
  process.env.DISCORDBOTLIST_BOT_ID = "1476192449721274472";
  process.env.DISCORDBOTLIST_STATS_SCOPE = "aggregate";

  global.fetch = async (url, options = {}) => {
    assert.equal(url, "https://discordbotlist.com/api/v1/bots/1476192449721274472/stats");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "test-discordbotlist-token");
    assert.deepEqual(JSON.parse(options.body), {
      guilds: 2,
      users: 30,
      voice_connections: 2,
      shard_id: 2,
    });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true });
      },
    };
  };

  const result = await syncDiscordBotListStats([
    {
      role: "commander",
      getApplicationId: () => "1476192449721274472",
      config: { clientId: "1476192449721274472" },
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["1", { id: "1", memberCount: 10 }],
          ]),
        },
        shard: {
          count: 4,
          ids: [2],
        },
      },
      collectStats: () => ({ servers: 1, users: 10, connections: 1 }),
    },
    {
      role: "worker",
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["2", { id: "2", memberCount: 20 }],
          ]),
        },
      },
      collectStats: () => ({ servers: 1, users: 20, connections: 1 }),
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.guilds, 2);
  assert.equal(result.users, 30);
  assert.equal(result.voice_connections, 2);
  assert.equal(result.shard_id, 2);
});

test("BotsGG aggregate stats deduplicate guilds across runtimes", () => {
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
      collectStats: () => ({ servers: 2, users: 30, connections: 1 }),
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
      collectStats: () => ({ servers: 2, users: 60, connections: 2 }),
    },
  ];

  const stats = collectBotsGGStats(runtimes, "aggregate");

  assert.equal(stats.scope, "aggregate");
  assert.equal(stats.guildCount, 3);
  assert.equal(stats.userCount, 70);
});

test("BotsGG stats sync posts documented guildCount payload", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    BOTSGG_ENABLED: process.env.BOTSGG_ENABLED,
    BOTSGG_TOKEN: process.env.BOTSGG_TOKEN,
    BOTSGG_BOT_ID: process.env.BOTSGG_BOT_ID,
    BOTSGG_STATS_SCOPE: process.env.BOTSGG_STATS_SCOPE,
  };
  const hadStateFile = fs.existsSync(botsGGStatePath);
  const originalState = hadStateFile ? fs.readFileSync(botsGGStatePath, "utf8") : null;

  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (hadStateFile) {
      fs.writeFileSync(botsGGStatePath, originalState, "utf8");
    } else if (fs.existsSync(botsGGStatePath)) {
      fs.unlinkSync(botsGGStatePath);
    }
  });

  process.env.BOTSGG_ENABLED = "1";
  process.env.BOTSGG_TOKEN = "test-botsgg-token";
  process.env.BOTSGG_BOT_ID = "1476192449721274472";
  process.env.BOTSGG_STATS_SCOPE = "aggregate";

  const runtimes = [
    {
      role: "commander",
      getApplicationId: () => "1476192449721274472",
      config: { clientId: "1476192449721274472" },
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["1", { id: "1", memberCount: 10 }],
          ]),
        },
        shard: {
          count: 3,
          ids: [1],
        },
      },
      collectStats: () => ({ servers: 1, users: 10, connections: 1 }),
    },
    {
      role: "worker",
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["2", { id: "2", memberCount: 20 }],
          ]),
        },
      },
      collectStats: () => ({ servers: 1, users: 20, connections: 1 }),
    },
  ];

  global.fetch = async (url, options = {}) => {
    assert.equal(url, "https://discord.bots.gg/api/v1/bots/1476192449721274472/stats");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "test-botsgg-token");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), {
      guildCount: 2,
      shardCount: 3,
      shardId: 1,
    });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          guildCount: 2,
          shardCount: 3,
        });
      },
    };
  };

  const result = await syncBotsGGStats(runtimes);

  assert.equal(result.ok, true);
  assert.equal(result.guildCount, 2);
  assert.equal(result.userCount, 30);
  assert.equal(result.shardCount, 3);
  assert.equal(result.shardId, 1);
  assert.equal(fs.existsSync(botsGGStatePath), true);
});
