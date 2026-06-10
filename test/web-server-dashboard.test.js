import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startWebServer } from "../src/api/server.js";
import { setLicenseProvider } from "../src/core/entitlements.js";
import { connect as connectDb, close as closeDb, getDb } from "../src/lib/db.js";
import {
  createLicense,
  linkServerToLicense,
  markSessionProcessed,
  reserveTrialClaim,
  finalizeTrialClaim,
  listLicensesByContactEmail,
  upgradeLicenseForServer,
} from "../src/premium-store.js";
import { upsertOffer, markOfferRedemption } from "../src/coupon-store.js";
import {
  setDashboardAuthSession,
  deleteDashboardAuthSession,
} from "../src/dashboard-store.js";
import { createScheduledEvent } from "../src/scheduled-events-store.js";
import { recordRuntimeIncident } from "../src/runtime-incidents-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const GUILD_ID = "123456789012345678";
const SECOND_GUILD_ID = "123456789012345679";
const BLOCKED_GUILD_ID = "123456789012345680";
const ROLE_DJ_ID = "223456789012345678";
const ROLE_ADMIN_ID = "323456789012345678";
const VOICE_CHANNEL_ID = "423456789012345678";
const TEXT_CHANNEL_ID = "523456789012345678";

async function snapshotFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath),
    };
  } catch {
    return { exists: false, content: null };
  }
}

async function restoreFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await fs.writeFile(filePath, snapshot.content);
    return;
  }
  await fs.rm(filePath, { force: true });
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

function formatLocalDateTimeForZone(timestampMs, timeZone = "Europe/Vienna") {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(timestampMs))
    .reduce((map, part) => {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
      return map;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function createGuildStub() {
  const sentMessages = [];
  const roles = new Map([
    [ROLE_DJ_ID, { id: ROLE_DJ_ID, name: "DJ", managed: false, hexColor: "#5865F2", position: 2 }],
    [ROLE_ADMIN_ID, { id: ROLE_ADMIN_ID, name: "Admin", managed: false, hexColor: "#10B981", position: 1 }],
  ]);
  const voiceChannel = {
    id: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    name: "radio-lounge",
    type: 2,
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    toString: () => `<#${VOICE_CHANNEL_ID}>`,
  };
  const textChannel = {
    id: TEXT_CHANNEL_ID,
    guildId: GUILD_ID,
    name: "announcements",
    type: 0,
    send: async (payload) => {
      sentMessages.push(payload);
      return payload;
    },
    permissionsFor: () => ({ has: () => true }),
    toString: () => `<#${TEXT_CHANNEL_ID}>`,
  };
  const channels = new Map([
    [VOICE_CHANNEL_ID, voiceChannel],
    [TEXT_CHANNEL_ID, textChannel],
  ]);

  return {
    id: GUILD_ID,
    name: "OmniFM Test Guild",
    __sentMessages: sentMessages,
    roles: {
      cache: roles,
      fetch: async () => roles,
    },
    channels: {
      cache: channels,
      fetch: async (channelId) => (channelId ? channels.get(channelId) || null : channels),
    },
    emojis: {
      cache: new Map(),
      fetch: async () => new Map(),
    },
  };
}

function createRuntimeStub() {
  const guild = createGuildStub();
  const guilds = new Map([[GUILD_ID, guild]]);

  return {
    __sentMessages: guild.__sentMessages,
    role: "commander",
    config: {
      id: "bot-test-1",
      index: 1,
      name: "OmniFM Test",
      requiredTier: "free",
    },
    client: {
      isReady: () => true,
      guilds: { cache: guilds },
    },
    collectStats() {
      return { servers: 1, users: 12, connections: 0, listeners: 0 };
    },
    getPlayingGuildCount() {
      return 0;
    },
    getPublicStatus() {
      return {
        id: "bot-test-1",
        botId: "bot-test-1",
        name: "OmniFM Test",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        users: 12,
        connections: 0,
        listeners: 0,
      };
    },
    getDashboardStatus() {
      return {
        id: "bot-test-1",
        botId: "bot-test-1",
        name: "OmniFM Test",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        users: 12,
        connections: 1,
        listeners: 4,
        guildDetails: [{
          guildId: GUILD_ID,
          guildName: "OmniFM Test Guild",
          stationKey: "rock",
          stationName: "Rock FM",
          channelId: VOICE_CHANNEL_ID,
          channelName: "radio-lounge",
          listenerCount: 4,
          playing: true,
          recovering: true,
          reconnectAttempts: 2,
          streamErrorCount: 1,
          shouldReconnect: true,
        }],
      };
    },
    buildStatusSnapshot() {
      return {
        id: "bot-test-1",
        name: "OmniFM Test",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        listeners: 0,
        connections: 0,
        uptimeSec: 5,
        error: null,
      };
    },
    normalizeClearableText(value, maxLen) {
      const text = String(value || "").trim();
      return text ? text.slice(0, maxLen) : null;
    },
    resolveStationForGuild(_guildId, rawStationKey) {
      const key = String(rawStationKey || "").trim().toLowerCase();
      if (!key) {
        return { ok: false, message: "Station key is invalid." };
      }
      return {
        ok: true,
        key,
        station: {
          name: key === "rock" ? "Rock FM" : "Test Station",
        },
      };
    },
    parseEventWindowInput({
      startRaw = "",
      baseRunAtMs = 0,
      baseDurationMs = 0,
      requestedTimeZone = "Europe/Vienna",
    } = {}) {
      let runAtMs = Number.parseInt(String(baseRunAtMs || 0), 10);
      if (String(startRaw || "").trim()) {
        const normalized = String(startRaw).trim();
        const isoLike = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
          ? `${normalized}:00.000Z`
          : normalized;
        runAtMs = Date.parse(isoLike);
      }
      if (!Number.isFinite(runAtMs) || runAtMs <= 0) {
        return { ok: false, message: "Start time is invalid." };
      }
      const durationMs = Math.max(0, Number(baseDurationMs || 0) || 0);
      return {
        ok: true,
        runAtMs,
        timeZone: requestedTimeZone,
        durationMs,
        endAtMs: durationMs > 0 ? runAtMs + durationMs : 0,
      };
    },
    async resolveBotMember() {
      return { id: "bot-test-user" };
    },
    async resolveGuildVoiceChannel(guildId, channelId) {
      const selectedGuild = guilds.get(guildId) || null;
      return {
        guild: selectedGuild,
        channel: selectedGuild?.channels?.cache?.get(channelId) || null,
      };
    },
    validateDiscordScheduledEventPermissions() {
      return null;
    },
  };
}

async function requestJson(baseUrl, pathname, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body,
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, headers: response.headers };
}

test("dashboard capability, permissions, and health routes work end-to-end", async (t) => {
  const trackedFiles = [
    path.join(repoRoot, "dashboard.json"),
    path.join(repoRoot, "dashboard.json.bak"),
    path.join(repoRoot, "command-permissions.json"),
    path.join(repoRoot, "command-permissions.json.bak"),
    path.join(repoRoot, "listening-stats.json"),
    path.join(repoRoot, "listening-stats.json.bak"),
    path.join(repoRoot, "runtime-incidents.json"),
    path.join(repoRoot, "runtime-incidents.json.bak"),
    path.join(repoRoot, "premium.json"),
    path.join(repoRoot, "premium.json.bak"),
    path.join(repoRoot, "coupons.json"),
    path.join(repoRoot, "coupons.json.bak"),
    path.join(repoRoot, "custom-stations.json"),
    path.join(repoRoot, "custom-stations.json.bak"),
    path.join(repoRoot, "botsgg.json"),
    path.join(repoRoot, "discordbotlist.json"),
    path.join(repoRoot, "topgg.json"),
    path.join(repoRoot, "vote-events.json"),
    path.join(repoRoot, "scheduled-events.json"),
  ];
  const snapshots = new Map();
  for (const filePath of trackedFiles) {
    snapshots.set(filePath, await snapshotFile(filePath));
  }

  const restoreEnv = setEnv({
    WEB_INTERNAL_PORT: "0",
    WEB_PORT: "0",
    WEB_BIND: "127.0.0.1",
    API_ADMIN_TOKEN: "test-admin-token",
    API_RATE_LIMIT_MAX: "200",
    API_RATE_LIMIT_PREMIUM_MAX: "50",
    API_RATE_LIMIT_WEBHOOK_MAX: "200",
    OMNIFM_ALLOW_LOCAL_WEBHOOKS: "1",
    DISCORDBOTLIST_ENABLED: "1",
    DISCORDBOTLIST_TOKEN: "test-discordbotlist-token",
    DISCORDBOTLIST_BOT_ID: "923456789012345678",
    DISCORDBOTLIST_SLUG: "omnifm-dj",
    DISCORDBOTLIST_WEBHOOK_SECRET: "test-discordbotlist-secret",
    BOTSGG_ENABLED: "1",
    BOTSGG_TOKEN: "test-botsgg-token",
    BOTSGG_BOT_ID: "923456789012345678",
    BOTSGG_STATS_SCOPE: "aggregate",
    TOPGG_ENABLED: "1",
    TOPGG_TOKEN: "test-topgg-token",
    TOPGG_BOT_ID: "923456789012345678",
    TOPGG_WEBHOOK_SECRET: "test-topgg-secret",
    DISCORD_CLIENT_ID: undefined,
    DISCORD_CLIENT_SECRET: undefined,
    DISCORD_REDIRECT_URI: undefined,
  });

  let activePlan = "pro";
  let activeSeats = 2;
  let mongoAvailable = false;
  setLicenseProvider((serverId) => {
    if (String(serverId) !== GUILD_ID) return null;
    return {
      plan: activePlan,
      active: activePlan !== "free",
      seats: activeSeats,
    };
  });

  const seededLicense = createLicense({
    plan: "pro",
    seats: 2,
    billingPeriod: "monthly",
    months: 3,
    activatedBy: "test-suite",
    contactEmail: "owner@example.com",
    preferredLanguage: "en",
  });
  const seededLink = linkServerToLicense(GUILD_ID, seededLicense.id);
  assert.equal(seededLink.ok, true);
  const blockedWorkspaceLicense = createLicense({
    plan: "pro",
    seats: 1,
    billingPeriod: "monthly",
    months: 1,
    activatedBy: "test-suite",
    contactEmail: "blocked@example.com",
    preferredLanguage: "en",
  });
  const blockedWorkspaceLink = linkServerToLicense(BLOCKED_GUILD_ID, blockedWorkspaceLicense.id);
  assert.equal(blockedWorkspaceLink.ok, true);
  markSessionProcessed("cs_dashboard_paid_1", {
    email: "owner@example.com",
    tier: "ultimate",
    licenseId: seededLicense.id,
    source: "verify",
    seats: 2,
    months: 3,
    expiresAt: seededLicense.expiresAt,
    renewed: false,
    upgraded: true,
    replayProtected: true,
    amountPaidCents: 1438,
    baseAmountCents: 1917,
    discountCents: 479,
    finalAmountCents: 1438,
    appliedOfferCode: "RENEW25",
    appliedOfferKind: "coupon",
  });
  markOfferRedemption("cs_dashboard_paid_1", {
    source: "verify",
    email: "owner@example.com",
    code: "RENEW25",
    kind: "coupon",
    tier: "ultimate",
    seats: 2,
    months: 3,
    baseAmountCents: 1917,
    discountCents: 479,
    finalAmountCents: 1438,
  });
  const trialReservation = reserveTrialClaim("owner@example.com", {
    source: "api:trial",
    preferredLanguage: "en",
  });
  assert.equal(trialReservation.ok, true);
  finalizeTrialClaim("owner@example.com", {
    source: "api:trial",
    licenseId: "trial_lic_1",
    tier: "pro",
    seats: 1,
    months: 1,
    expiresAt: "2026-04-09T00:00:00.000Z",
  });
  upsertOffer({
    code: "RENEW25",
    kind: "coupon",
    active: true,
    percentOff: 25,
    allowedTiers: ["ultimate"],
    allowedSeats: [2],
    minMonths: 3,
    ownerLabel: "Spring Promo",
    createdBy: "test-suite",
  });
  upsertOffer({
    code: "FREEPRO1",
    kind: "coupon",
    fulfillmentMode: "direct_grant",
    active: true,
    grantPlan: "pro",
    grantSeats: 1,
    grantMonths: 1,
    createdBy: "test-suite",
  });
  upsertOffer({
    code: "RENEWGIFT",
    kind: "coupon",
    fulfillmentMode: "direct_grant",
    active: true,
    grantPlan: "pro",
    grantSeats: 2,
    grantMonths: 1,
    createdBy: "test-suite",
  });

  try {
    await connectDb();
    if (getDb()) {
      mongoAvailable = true;
      await getDb().collection("guild_settings").deleteMany({ guildId: GUILD_ID });
      await getDb().collection("runtime_incidents").deleteMany({ guildId: GUILD_ID });
    }
  } catch {}

  const sessionToken = `test-session-${Date.now()}`;
  const nowTs = Math.floor(Date.now() / 1000);
  setDashboardAuthSession(sessionToken, {
    user: {
      id: "423456789012345678",
      username: "TestUser",
    },
    guilds: [{
      id: GUILD_ID,
      name: "OmniFM Test Guild",
      permissions: "32",
      owner: true,
    }, {
      id: SECOND_GUILD_ID,
      name: "OmniFM Lounge",
      permissions: "32",
      owner: false,
    }, {
      id: BLOCKED_GUILD_ID,
      name: "OmniFM Backup",
      permissions: "32",
      owner: false,
    }],
    createdAt: nowTs,
    expiresAt: nowTs + 3600,
  });

  const scheduledEventsFile = path.join(repoRoot, "scheduled-events.json");
  await fs.rm(scheduledEventsFile, { force: true });
  const conflictStartMs = Date.now() + (24 * 60 * 60 * 1000);
  const conflictStartLocal = formatLocalDateTimeForZone(conflictStartMs);
  const createEventStartLocal = formatLocalDateTimeForZone(Date.now() + (48 * 60 * 60 * 1000) + (75 * 60 * 1000));
  const updateEventStartLocal = formatLocalDateTimeForZone(Date.now() + (72 * 60 * 60 * 1000) + (90 * 60 * 1000));
  const seededEvent = createScheduledEvent({
    guildId: GUILD_ID,
    botId: "bot-test-1",
    name: "Existing Show",
    stationKey: "rock",
    voiceChannelId: VOICE_CHANNEL_ID,
    textChannelId: TEXT_CHANNEL_ID,
    runAtMs: conflictStartMs,
    durationMs: 60 * 60 * 1000,
    repeat: "none",
    timeZone: "Europe/Vienna",
  });
  assert.equal(seededEvent.ok, true);

  const runtimeStub = createRuntimeStub();
  const webhookRequests = [];
  const webhookServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    webhookRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: JSON.parse(rawBody || "{}"),
    });
    res.writeHead(204);
    res.end();
  });
  webhookServer.listen(0, "127.0.0.1");
  await once(webhookServer, "listening");
  const webhookAddress = webhookServer.address();
  const webhookUrl = `http://127.0.0.1:${webhookAddress.port}/exports`;
  const server = startWebServer([runtimeStub]);
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => webhookServer.close(resolve));
    deleteDashboardAuthSession(sessionToken);
    setLicenseProvider(() => null);
    restoreEnv();
    if (mongoAvailable && getDb()) {
      await getDb().collection("guild_settings").deleteMany({ guildId: GUILD_ID }).catch(() => null);
      await getDb().collection("runtime_incidents").deleteMany({ guildId: GUILD_ID }).catch(() => null);
      await closeDb().catch(() => null);
    }
    for (const [filePath, snapshot] of snapshots.entries()) {
      await restoreFile(filePath, snapshot);
    }
  });

  const sessionOnlyHeaders = { "x-session-token": sessionToken };
  const authHeaders = { ...sessionOnlyHeaders, "X-OmniFM-CSRF": "dashboard-intent" };

  const dashboardCorsPreflightResponse = await requestJson(baseUrl, "/api/dashboard/settings", {
    method: "OPTIONS",
    headers: {
      Origin: baseUrl,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "Content-Type, X-OmniFM-CSRF",
    },
  });
  assert.equal(dashboardCorsPreflightResponse.status, 204);
  assert.match(
    dashboardCorsPreflightResponse.headers.get("access-control-allow-headers") || "",
    /X-OmniFM-CSRF/i
  );

  const missingCsrfLogoutResponse = await requestJson(baseUrl, "/api/auth/logout", {
    method: "POST",
    headers: sessionOnlyHeaders,
  });
  assert.equal(missingCsrfLogoutResponse.status, 403);
  assert.match(missingCsrfLogoutResponse.payload.error, /CSRF.*intent/i);

  const wrongCsrfDashboardMutationResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats/reset?serverId=${GUILD_ID}`,
    {
      method: "DELETE",
      headers: { ...sessionOnlyHeaders, "X-OmniFM-CSRF": "wrong-intent" },
    }
  );
  assert.equal(wrongCsrfDashboardMutationResponse.status, 403);
  assert.match(wrongCsrfDashboardMutationResponse.payload.error, /CSRF.*intent/i);

  const publicHealthResponse = await requestJson(baseUrl, "/api/health");
  assert.equal(publicHealthResponse.status, 200);
  assert.equal(publicHealthResponse.payload.ok, true);
  assert.equal(publicHealthResponse.payload.readyBots, 1);

  const publicBotsResponse = await requestJson(baseUrl, "/api/bots");
  assert.equal(publicBotsResponse.status, 200);
  assert.equal(publicBotsResponse.payload.bots.length, 1);
  assert.equal(publicBotsResponse.payload.totals.servers, 1);

  const publicWorkersResponse = await requestJson(baseUrl, "/api/workers");
  assert.equal(publicWorkersResponse.status, 200);
  assert.equal(publicWorkersResponse.payload.architecture, "commander_worker");
  assert.equal(publicWorkersResponse.payload.commander.id, "bot-test-1");
  assert.deepEqual(publicWorkersResponse.payload.workers, []);

  const publicCommandsResponse = await requestJson(baseUrl, "/api/commands");
  assert.equal(publicCommandsResponse.status, 200);
  assert.equal(Array.isArray(publicCommandsResponse.payload.commands), true);
  assert.ok(publicCommandsResponse.payload.commands.length > 0);

  const publicStatsResponse = await requestJson(baseUrl, "/api/stats");
  assert.equal(publicStatsResponse.status, 200);
  assert.equal(publicStatsResponse.payload.bots, 1);
  assert.ok(publicStatsResponse.payload.stations >= 1);

  const publicStationsResponse = await requestJson(baseUrl, "/api/stations");
  assert.equal(publicStationsResponse.status, 200);
  assert.ok(publicStationsResponse.payload.total >= 1);
  assert.equal(typeof publicStationsResponse.payload.defaultStationKey, "string");

  const globalStatsResponse = await requestJson(baseUrl, "/api/stats/global?lang=en");
  assert.equal(globalStatsResponse.status, 200);
  assert.equal(typeof globalStatsResponse.payload, "object");

  const discordBotListUnauthorizedResponse = await requestJson(
    baseUrl,
    "/api/discordbotlist/status?lang=de"
  );
  assert.equal(discordBotListUnauthorizedResponse.status, 401);
  assert.match(discordBotListUnauthorizedResponse.payload.error, /API-Admin-Token erforderlich/i);

  const discordBotListStatusResponse = await requestJson(
    baseUrl,
    "/api/discordbotlist/status?limit=5",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(discordBotListStatusResponse.status, 200);
  assert.equal(discordBotListStatusResponse.payload.configured, true);
  assert.equal(discordBotListStatusResponse.payload.botId, "923456789012345678");
  assert.equal(discordBotListStatusResponse.payload.slug, "omnifm-dj");
  assert.equal(discordBotListStatusResponse.payload.listingUrl, "https://discordbotlist.com/bots/omnifm-dj");
  assert.equal(discordBotListStatusResponse.payload.publicApiUrl, null);
  assert.equal(discordBotListStatusResponse.payload.ownerApiUrl, "https://discordbotlist.com/api/v1/bots/923456789012345678");
  assert.equal(discordBotListStatusResponse.payload.state.totalVotes, 0);
  assert.deepEqual(discordBotListStatusResponse.payload.state.votes, []);

  const botsGGUnauthorizedResponse = await requestJson(
    baseUrl,
    "/api/botsgg/status?lang=de"
  );
  assert.equal(botsGGUnauthorizedResponse.status, 401);
  assert.match(botsGGUnauthorizedResponse.payload.error, /API-Admin-Token erforderlich/i);

  const botsGGStatusResponse = await requestJson(
    baseUrl,
    "/api/botsgg/status",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(botsGGStatusResponse.status, 200);
  assert.equal(botsGGStatusResponse.payload.configured, true);
  assert.equal(botsGGStatusResponse.payload.botId, "923456789012345678");
  assert.equal(botsGGStatusResponse.payload.statsScope, "aggregate");
  assert.equal(botsGGStatusResponse.payload.listingUrl, "https://discord.bots.gg/bots/923456789012345678");
  assert.equal(botsGGStatusResponse.payload.publicApiUrl, "https://discord.bots.gg/api/v1/bots/923456789012345678");
  assert.equal(typeof botsGGStatusResponse.payload.state, "object");

  const topGGUnauthorizedResponse = await requestJson(
    baseUrl,
    "/api/topgg/status?lang=de"
  );
  assert.equal(topGGUnauthorizedResponse.status, 401);
  assert.match(topGGUnauthorizedResponse.payload.error, /API-Admin-Token erforderlich/i);

  const topGGStatusResponse = await requestJson(
    baseUrl,
    "/api/topgg/status",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(topGGStatusResponse.status, 200);
  assert.equal(topGGStatusResponse.payload.configured, true);
  assert.equal(topGGStatusResponse.payload.botId, "923456789012345678");
  assert.equal(topGGStatusResponse.payload.statsScope, "aggregate");
  assert.equal(topGGStatusResponse.payload.listingUrl, "https://top.gg/bot/923456789012345678");
  assert.equal(topGGStatusResponse.payload.projectApiUrl, "https://top.gg/api/v1/projects/@me");
  assert.equal(topGGStatusResponse.payload.votesApiUrl, "https://top.gg/api/v1/projects/@me/votes");
  assert.equal(topGGStatusResponse.payload.state.totalVotes, 0);
  assert.deepEqual(topGGStatusResponse.payload.state.votes, []);

  const discordBotListVoteResponse = await requestJson(
    baseUrl,
    "/api/discordbotlist/vote",
    {
      method: "POST",
      headers: {
        Authorization: "test-discordbotlist-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "623456789012345678",
        username: "VoteUser",
        discriminator: "0420",
        avatar: "avatar-hash",
        timestamp: "2026-03-09T12:00:00.000Z",
      }),
    }
  );
  assert.equal(discordBotListVoteResponse.status, 200);
  assert.equal(discordBotListVoteResponse.payload.success, true);
  assert.equal(discordBotListVoteResponse.payload.added, true);
  assert.equal(discordBotListVoteResponse.payload.totalVotes, 1);

  const topGGVoteResponse = await requestJson(
    baseUrl,
    "/api/topgg/webhook",
    {
      method: "POST",
      headers: {
        Authorization: "test-topgg-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bot: "923456789012345678",
        user: "723456789012345678",
        type: "upvote",
        query: {},
      }),
    }
  );
  assert.equal(topGGVoteResponse.status, 200);
  assert.equal(topGGVoteResponse.payload.success, true);
  assert.equal(topGGVoteResponse.payload.added, true);
  assert.equal(topGGVoteResponse.payload.totalVotes, 1);

  const discordBotListVotesResponse = await requestJson(
    baseUrl,
    "/api/discordbotlist/votes?limit=10",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(discordBotListVotesResponse.status, 200);
  assert.equal(discordBotListVotesResponse.payload.totalVotes, 1);
  assert.equal(discordBotListVotesResponse.payload.votes.length, 1);
  assert.equal(discordBotListVotesResponse.payload.votes[0].userId, "623456789012345678");
  assert.equal(discordBotListVotesResponse.payload.votes[0].username, "VoteUser#0420");

  const topGGVotesResponse = await requestJson(
    baseUrl,
    "/api/topgg/votes?limit=10",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(topGGVotesResponse.status, 200);
  assert.equal(topGGVotesResponse.payload.totalVotes, 1);
  assert.equal(topGGVotesResponse.payload.votes.length, 1);
  assert.equal(topGGVotesResponse.payload.votes[0].provider, "topgg");
  assert.equal(topGGVotesResponse.payload.votes[0].userId, "723456789012345678");

  const voteEventsUnauthorizedResponse = await requestJson(
    baseUrl,
    "/api/vote-events/status?provider=topgg"
  );
  assert.equal(voteEventsUnauthorizedResponse.status, 401);
  assert.match(voteEventsUnauthorizedResponse.payload.error, /API admin token required/i);

  const voteEventsStatusResponse = await requestJson(
    baseUrl,
    "/api/vote-events/status?limit=10",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(voteEventsStatusResponse.status, 200);
  assert.equal(voteEventsStatusResponse.payload.totalVotes, 2);
  assert.equal(voteEventsStatusResponse.payload.votes.length, 2);
  assert.equal(voteEventsStatusResponse.payload.rewardReadiness.unifiedStore, true);
  assert.equal(voteEventsStatusResponse.payload.rewardReadiness.rewardEngineReady, true);
  assert.deepEqual(voteEventsStatusResponse.payload.rewardReadiness.supportedVoteProviders, ["discordbotlist", "topgg"]);
  assert.deepEqual(voteEventsStatusResponse.payload.rewardReadiness.unsupportedVoteProviders, ["botsgg"]);

  const topGGVoteEventsResponse = await requestJson(
    baseUrl,
    "/api/vote-events/status?provider=topgg&userId=723456789012345678&limit=10",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(topGGVoteEventsResponse.status, 200);
  assert.equal(topGGVoteEventsResponse.payload.provider, "topgg");
  assert.equal(topGGVoteEventsResponse.payload.userId, "723456789012345678");
  assert.equal(topGGVoteEventsResponse.payload.totalVotes, 1);
  assert.equal(topGGVoteEventsResponse.payload.votes.length, 1);
  assert.equal(topGGVoteEventsResponse.payload.votes[0].provider, "topgg");
  assert.equal(topGGVoteEventsResponse.payload.votes[0].userId, "723456789012345678");

  const discordBotListSyncUnauthorizedResponse = await requestJson(
    baseUrl,
    "/api/discordbotlist/sync",
    {
      method: "POST",
      headers: {
        "X-OmniFM-Language": "de",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  assert.equal(discordBotListSyncUnauthorizedResponse.status, 401);
  assert.match(discordBotListSyncUnauthorizedResponse.payload.error, /API-Admin-Token erforderlich/i);

  const premiumCheckResponse = await requestJson(
    baseUrl,
    `/api/premium/check?serverId=${GUILD_ID}`
  );
  assert.equal(premiumCheckResponse.status, 200);
  assert.equal(premiumCheckResponse.payload.serverId, GUILD_ID);
  assert.equal(premiumCheckResponse.payload.tier, "pro");
  assert.equal(premiumCheckResponse.payload.maxBots, 8);
  assert.equal(premiumCheckResponse.payload.license.tier, "pro");
  assert.equal(premiumCheckResponse.payload.license.plan, "pro");
  assert.equal(premiumCheckResponse.payload.license.active, true);

  const premiumInviteLinksResponse = await requestJson(
    baseUrl,
    `/api/premium/invite-links?serverId=${GUILD_ID}`
  );
  assert.equal(premiumInviteLinksResponse.status, 200);
  assert.equal(premiumInviteLinksResponse.payload.serverTier, "pro");
  assert.equal(premiumInviteLinksResponse.payload.bots.length, 1);
  assert.equal(premiumInviteLinksResponse.payload.bots[0].botId, "bot-test-1");
  assert.equal(premiumInviteLinksResponse.payload.bots[0].role, "commander");
  assert.equal(premiumInviteLinksResponse.payload.bots[0].hasAccess, true);
  assert.equal(premiumInviteLinksResponse.payload.bots[0].requiredTier, "free");

  const premiumTiersResponse = await requestJson(baseUrl, "/api/premium/tiers");
  assert.equal(premiumTiersResponse.status, 200);
  assert.equal(typeof premiumTiersResponse.payload.tiers, "object");
  assert.equal(premiumTiersResponse.payload.tiers.free.name, "Free");
  assert.equal(premiumTiersResponse.payload.tiers.pro.name, "Pro");
  assert.equal(premiumTiersResponse.payload.tiers.ultimate.name, "Ultimate");

  const premiumPricingResponse = await requestJson(
    baseUrl,
    `/api/premium/pricing?lang=en&serverId=${GUILD_ID}`
  );
  assert.equal(premiumPricingResponse.status, 200);
  assert.equal(premiumPricingResponse.payload.brand, "OmniFM");
  assert.equal(premiumPricingResponse.payload.currentLicense.tier, "pro");
  assert.equal(premiumPricingResponse.payload.currentLicense.seats, 2);
  assert.equal(premiumPricingResponse.payload.upgrade.to, "ultimate");
  assert.equal(premiumPricingResponse.payload.trial.enabled, true);

  const premiumTrialInvalidEmailResponse = await requestJson(
    baseUrl,
    "/api/premium/trial",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "de",
      },
      body: JSON.stringify({
        email: "bad-email",
      }),
    }
  );
  assert.equal(premiumTrialInvalidEmailResponse.status, 400);
  assert.match(premiumTrialInvalidEmailResponse.payload.message, /E-Mail-Adresse/i);

  const premiumOfferPreviewResponse = await requestJson(
    baseUrl,
    "/api/premium/offer/preview",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "en",
      },
      body: JSON.stringify({
        tier: "ultimate",
        email: "owner@example.com",
        months: 3,
        seats: 2,
        couponCode: "RENEW25",
      }),
    }
  );
  assert.equal(premiumOfferPreviewResponse.status, 200);
  assert.equal(premiumOfferPreviewResponse.payload.success, true);
  assert.equal(premiumOfferPreviewResponse.payload.discount.applied.code, "RENEW25");
  assert.equal(premiumOfferPreviewResponse.payload.pricing.baseAmountCents, 1917);
  assert.equal(premiumOfferPreviewResponse.payload.pricing.finalAmountCents, 1438);

  const premiumGrantPreviewResponse = await requestJson(
    baseUrl,
    "/api/premium/offer/preview",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "en",
      },
      body: JSON.stringify({
        tier: "pro",
        email: "gift@example.com",
        months: 12,
        seats: 1,
        couponCode: "FREEPRO1",
      }),
    }
  );
  assert.equal(premiumGrantPreviewResponse.status, 200);
  assert.equal(premiumGrantPreviewResponse.payload.success, true);
  assert.equal(premiumGrantPreviewResponse.payload.discount.applied.code, "FREEPRO1");
  assert.equal(premiumGrantPreviewResponse.payload.discount.applied.fulfillmentMode, "direct_grant");
  assert.equal(premiumGrantPreviewResponse.payload.discount.applied.grantPlan, "pro");
  assert.equal(premiumGrantPreviewResponse.payload.discount.applied.grantMonths, 1);
  assert.equal(premiumGrantPreviewResponse.payload.pricing.finalAmountCents, 0);

  const premiumGrantCheckoutResponse = await requestJson(
    baseUrl,
    "/api/premium/checkout",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "en",
      },
      body: JSON.stringify({
        tier: "pro",
        email: "gift@example.com",
        months: 12,
        seats: 1,
        couponCode: "FREEPRO1",
      }),
    }
  );
  assert.equal(premiumGrantCheckoutResponse.status, 200);
  assert.equal(premiumGrantCheckoutResponse.payload.activated, true);
  assert.equal(premiumGrantCheckoutResponse.payload.directGrant, true);
  assert.equal(premiumGrantCheckoutResponse.payload.licenseKey.startsWith("lic_"), true);
  assert.equal(premiumGrantCheckoutResponse.payload.pricing.finalAmountCents, 0);
  assert.equal(listLicensesByContactEmail("gift@example.com")[0]?.plan, "pro");

  const premiumCheckoutUnavailableResponse = await requestJson(
    baseUrl,
    "/api/premium/checkout",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "en",
      },
      body: JSON.stringify({
        tier: "pro",
        email: "owner@example.com",
        months: 1,
        seats: 1,
      }),
    }
  );
  assert.equal(premiumCheckoutUnavailableResponse.status, 503);
  assert.match(premiumCheckoutUnavailableResponse.payload.error, /Stripe is not configured/i);

  const premiumOffersUnauthorizedResponse = await requestJson(
    baseUrl,
    "/api/premium/offers?lang=de"
  );
  assert.equal(premiumOffersUnauthorizedResponse.status, 401);
  assert.match(premiumOffersUnauthorizedResponse.payload.error, /API-Admin-Token erforderlich/i);

  const premiumOffersResponse = await requestJson(
    baseUrl,
    "/api/premium/offers?includeStats=1",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(premiumOffersResponse.status, 200);
  assert.equal(premiumOffersResponse.payload.offers.some((offer) => offer.code === "RENEW25"), true);
  assert.equal(
    premiumOffersResponse.payload.offers.some((offer) => offer.code === "RENEW25" && offer.redemptions?.total === 1),
    true
  );

  const premiumCreateOfferResponse = await requestJson(
    baseUrl,
    "/api/premium/offers",
    {
      method: "POST",
      headers: {
        "x-admin-token": "test-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: "FLASH10",
        kind: "coupon",
        percentOff: 10,
        allowedTiers: ["pro"],
        createdBy: "test-suite",
      }),
    }
  );
  assert.equal(premiumCreateOfferResponse.status, 200);
  assert.equal(premiumCreateOfferResponse.payload.success, true);
  assert.equal(premiumCreateOfferResponse.payload.offer.code, "FLASH10");
  assert.equal(premiumCreateOfferResponse.payload.offer.percentOff, 10);

  const premiumCreateGrantOfferResponse = await requestJson(
    baseUrl,
    "/api/premium/offers",
    {
      method: "POST",
      headers: {
        "x-admin-token": "test-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: "FREEULT1",
        kind: "coupon",
        fulfillmentMode: "direct_grant",
        grantPlan: "ultimate",
        grantSeats: 1,
        grantMonths: 1,
        createdBy: "test-suite",
      }),
    }
  );
  assert.equal(premiumCreateGrantOfferResponse.status, 200);
  assert.equal(premiumCreateGrantOfferResponse.payload.success, true);
  assert.equal(premiumCreateGrantOfferResponse.payload.offer.fulfillmentMode, "direct_grant");
  assert.equal(premiumCreateGrantOfferResponse.payload.offer.grantPlan, "ultimate");

  const premiumOfferLookupResponse = await requestJson(
    baseUrl,
    "/api/premium/offer?code=flash10"
  );
  assert.equal(premiumOfferLookupResponse.status, 200);
  assert.equal(premiumOfferLookupResponse.payload.offer.code, "FLASH10");
  assert.equal(premiumOfferLookupResponse.payload.offer.percentOff, 10);

  const premiumGrantOfferLookupResponse = await requestJson(
    baseUrl,
    "/api/premium/offer?code=freeult1"
  );
  assert.equal(premiumGrantOfferLookupResponse.status, 200);
  assert.equal(premiumGrantOfferLookupResponse.payload.offer.fulfillmentMode, "direct_grant");
  assert.equal(premiumGrantOfferLookupResponse.payload.offer.grantPlan, "ultimate");

  const premiumDeactivateOfferResponse = await requestJson(
    baseUrl,
    "/api/premium/offers/active",
    {
      method: "POST",
      headers: {
        "x-admin-token": "test-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: "FLASH10",
        active: false,
      }),
    }
  );
  assert.equal(premiumDeactivateOfferResponse.status, 200);
  assert.equal(premiumDeactivateOfferResponse.payload.success, true);
  assert.equal(premiumDeactivateOfferResponse.payload.offer.active, false);

  const premiumRedemptionsResponse = await requestJson(
    baseUrl,
    "/api/premium/redemptions?limit=5",
    {
      headers: { "x-admin-token": "test-admin-token" },
    }
  );
  assert.equal(premiumRedemptionsResponse.status, 200);
  assert.equal(premiumRedemptionsResponse.payload.redemptions.some((entry) => entry.code === "RENEW25"), true);

  const premiumVerifyUnavailableResponse = await requestJson(
    baseUrl,
    "/api/premium/verify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "en",
      },
      body: JSON.stringify({
        sessionId: "cs_test_missing_stripe",
      }),
    }
  );
  assert.equal(premiumVerifyUnavailableResponse.status, 503);
  assert.match(premiumVerifyUnavailableResponse.payload.error, /Stripe is not configured/i);

  const premiumWebhookUnavailableResponse = await requestJson(
    baseUrl,
    "/api/premium/webhook",
    {
      method: "POST",
      headers: {
        "X-OmniFM-Language": "en",
      },
    }
  );
  assert.equal(premiumWebhookUnavailableResponse.status, 503);
  assert.match(premiumWebhookUnavailableResponse.payload.error, /Stripe webhook is not configured/i);

  const oauthUnavailableResponse = await requestJson(baseUrl, "/api/auth/discord/login?lang=en");
  assert.equal(oauthUnavailableResponse.status, 503);
  assert.match(oauthUnavailableResponse.payload.error, /Discord OAuth is not configured yet/i);

  const sessionResponse = await requestJson(baseUrl, "/api/auth/session", { headers: authHeaders });
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.payload.authenticated, true);
  assert.equal(
    sessionResponse.payload.guilds.some((guild) => guild.id === GUILD_ID && guild.capabilities?.dashboardAccess === true),
    true
  );

  const dashboardGuildsResponse = await requestJson(baseUrl, "/api/dashboard/guilds", { headers: authHeaders });
  assert.equal(dashboardGuildsResponse.status, 200);
  assert.equal(dashboardGuildsResponse.payload.guilds.length, 3);
  assert.equal(
    dashboardGuildsResponse.payload.guilds.some((guild) => guild.id === GUILD_ID && guild.capabilities?.dashboardAccess === true),
    true
  );

  const capabilityResponse = await requestJson(
    baseUrl,
    `/api/dashboard/capabilities?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(capabilityResponse.status, 200);
  assert.equal(capabilityResponse.payload.tier, "pro");
  assert.equal(capabilityResponse.payload.capabilities.dashboardAccess, true);
  assert.equal(capabilityResponse.payload.capabilities.advancedAnalytics, false);
  assert.equal(capabilityResponse.payload.limits.seats, 2);
  assert.equal(capabilityResponse.payload.upgradeHints.nextTier, "ultimate");
  assert.ok(capabilityResponse.payload.upgradeHints.blockedFeatures.includes("advancedAnalytics"));

  const telemetryResponse = await requestJson(
    baseUrl,
    `/api/dashboard/telemetry?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": "test-admin-token",
      },
      body: JSON.stringify({
        listenersNow: 11,
        activeStreams: 2,
        peakListeners: 17,
        topStation: {
          name: "Nightwave FM",
          listeners: 9,
        },
        listenersByChannel: [{
          name: "radio-lounge",
          listeners: 4,
        }],
        stationBreakdown: [{
          name: "Nightwave FM",
          starts: 3,
          peakListeners: 9,
        }],
      }),
    }
  );
  assert.equal(telemetryResponse.status, 200);
  assert.equal(telemetryResponse.payload.success, true);
  assert.equal(telemetryResponse.payload.serverId, GUILD_ID);
  assert.equal(telemetryResponse.payload.telemetry.listenersNow, 11);
  assert.equal(telemetryResponse.payload.telemetry.activeStreams, 2);
  assert.equal(telemetryResponse.payload.telemetry.topStation.name, "Nightwave FM");
  assert.deepEqual(telemetryResponse.payload.telemetry.listenersByChannel, [{
    name: "radio-lounge",
    listeners: 4,
  }]);

  const telemetryUnauthorizedEnResponse = await requestJson(
    baseUrl,
    `/api/dashboard/telemetry?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "en",
      },
      body: JSON.stringify({}),
    }
  );
  assert.equal(telemetryUnauthorizedEnResponse.status, 401);
  assert.match(telemetryUnauthorizedEnResponse.payload.error, /API admin token required/i);

  const telemetryUnauthorizedDeResponse = await requestJson(
    baseUrl,
    `/api/dashboard/telemetry?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniFM-Language": "de",
      },
      body: JSON.stringify({}),
    }
  );
  assert.equal(telemetryUnauthorizedDeResponse.status, 401);
  assert.match(telemetryUnauthorizedDeResponse.payload.error, /API-Admin-Token erforderlich/i);

  const initialLicenseResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(initialLicenseResponse.status, 200);
  assert.equal(initialLicenseResponse.payload.license.plan, "pro");
  assert.equal(initialLicenseResponse.payload.license.seats, 2);
  assert.equal(initialLicenseResponse.payload.license.seatsUsed, 1);
  assert.equal(initialLicenseResponse.payload.license.seatsAvailable, 1);
  assert.equal(initialLicenseResponse.payload.license.emailMasked, "ow***@example.com");
  assert.equal(initialLicenseResponse.payload.license.workspace, null);
  assert.equal(initialLicenseResponse.payload.currentPlan.limits.maxBots, 8);
  assert.equal(initialLicenseResponse.payload.currentPlan.pricing.monthlyCents, 549);
  assert.equal(initialLicenseResponse.payload.recommendedUpgrade.tier, "ultimate");
  assert.equal(initialLicenseResponse.payload.recommendedUpgrade.pricing.monthlyCents, 799);
  assert.equal(initialLicenseResponse.payload.promotions.couponCodesSupported, true);
  assert.equal(initialLicenseResponse.payload.promotions.proTrialEnabled, true);
  assert.equal(initialLicenseResponse.payload.promotions.proTrialMonths, 1);
  assert.equal(initialLicenseResponse.payload.activity.replayProtection.enabled, true);
  assert.equal(initialLicenseResponse.payload.activity.replayProtection.recentSessionCount, 1);
  assert.equal(initialLicenseResponse.payload.activity.replayProtection.lastSessionId, "cs_dashboard_paid_1");
  assert.equal(initialLicenseResponse.payload.activity.recentSessions.length, 1);
  assert.equal(initialLicenseResponse.payload.activity.recentSessions[0].upgraded, true);
  assert.equal(initialLicenseResponse.payload.activity.recentSessions[0].finalAmountCents, 1438);
  assert.equal(initialLicenseResponse.payload.activity.recentSessions[0].appliedOfferCode, "RENEW25");
  assert.equal(initialLicenseResponse.payload.activity.trial.status, "claimed");
  assert.equal(initialLicenseResponse.payload.activity.trial.months, 1);

  const invalidLicenseEmailUpdate = await requestJson(
    baseUrl,
    `/api/dashboard/license?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactEmail: "invalid-email",
        language: "en",
      }),
    }
  );
  assert.equal(invalidLicenseEmailUpdate.status, 400);
  assert.match(invalidLicenseEmailUpdate.payload.error, /valid license email/i);

  const updatedLicenseResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactEmail: "billing@example.com",
        language: "en",
      }),
    }
  );
  assert.equal(updatedLicenseResponse.status, 200);
  assert.equal(updatedLicenseResponse.payload.success, true);
  assert.equal(updatedLicenseResponse.payload.license.emailMasked, "bi***@example.com");
  assert.equal(updatedLicenseResponse.payload.license.contactEmailDomain, "example.com");

  const offerPreviewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/offer-preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tier: "ultimate",
        months: 3,
        couponCode: "renew25",
        language: "en",
      }),
    }
  );
  assert.equal(offerPreviewResponse.status, 200);
  assert.equal(offerPreviewResponse.payload.success, true);
  assert.equal(offerPreviewResponse.payload.pricing.baseAmountCents, 1917);
  assert.equal(offerPreviewResponse.payload.pricing.discountCents, 479);
  assert.equal(offerPreviewResponse.payload.pricing.finalAmountCents, 1438);
  assert.equal(offerPreviewResponse.payload.discount.applied.code, "RENEW25");
  assert.equal(offerPreviewResponse.payload.discount.applied.ownerLabel, "Spring Promo");
  assert.equal(offerPreviewResponse.payload.renewal.targetPlan, "ultimate");
  assert.equal(offerPreviewResponse.payload.renewal.seats, 2);

  const directGrantOfferPreviewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/offer-preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tier: "pro",
        months: 12,
        couponCode: "RENEWGIFT",
        language: "en",
      }),
    }
  );
  assert.equal(directGrantOfferPreviewResponse.status, 200);
  assert.equal(directGrantOfferPreviewResponse.payload.success, true);
  assert.equal(directGrantOfferPreviewResponse.payload.discount.applied.fulfillmentMode, "direct_grant");
  assert.equal(directGrantOfferPreviewResponse.payload.discount.applied.grantMonths, 1);
  assert.equal(directGrantOfferPreviewResponse.payload.pricing.finalAmountCents, 0);

  const directGrantCheckoutResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/checkout?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tier: "pro",
        months: 12,
        couponCode: "RENEWGIFT",
        language: "en",
      }),
    }
  );
  assert.equal(directGrantCheckoutResponse.status, 200);
  assert.equal(directGrantCheckoutResponse.payload.activated, true);
  assert.equal(directGrantCheckoutResponse.payload.directGrant, true);
  assert.equal(directGrantCheckoutResponse.payload.pricing.finalAmountCents, 0);

  const invalidOfferPreviewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/offer-preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tier: "ultimate",
        months: 3,
        couponCode: "INVALID",
        language: "en",
      }),
    }
  );
  assert.equal(invalidOfferPreviewResponse.status, 400);
  assert.match(invalidOfferPreviewResponse.payload.error, /(coupon|offer_not_found)/i);

  const settingsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    { headers: { ...authHeaders, "X-OmniFM-Language": "de" } }
  );
  assert.equal(settingsResponse.status, 200);
  assert.equal(settingsResponse.payload.weeklyDigest.language, "de");
  assert.equal(settingsResponse.payload.weeklyDigestMeta.ready, false);
  assert.equal(typeof settingsResponse.payload.weeklyDigestMeta.nextRunAt, "string");
  assert.deepEqual(settingsResponse.payload.failoverChain, []);
  assert.deepEqual(settingsResponse.payload.failoverChainPreview, []);
  assert.equal(settingsResponse.payload.fallbackStation, "");
  assert.equal(settingsResponse.payload.fallbackStationPreview.valid, true);
  assert.equal(settingsResponse.payload.incidentAlerts.enabled, false);
  assert.equal(settingsResponse.payload.incidentAlerts.channelId, "");
  assert.deepEqual(settingsResponse.payload.incidentAlerts.events, []);
  assert.equal(settingsResponse.payload.exportsWebhook.enabled, false);
  assert.equal(settingsResponse.payload.exportsWebhook.url, "");
  assert.deepEqual(settingsResponse.payload.exportsWebhook.events, []);
  assert.equal(settingsResponse.payload.capabilities.voiceGuard, true);
  assert.equal(settingsResponse.payload.voiceGuard.policy, "default");
  assert.equal(settingsResponse.payload.voiceGuard.available, true);
  assert.equal(settingsResponse.payload.voiceGuard.effectivePolicy, "return");

  if (mongoAvailable && getDb()) {
    await getDb().collection("guild_settings").updateOne(
      { guildId: GUILD_ID },
      {
        $set: {
          guildId: GUILD_ID,
          weeklyDigest: {
            enabled: true,
            channelId: ` ${TEXT_CHANNEL_ID} `,
            dayOfWeek: "9",
            hour: "-3",
            language: "fr",
          },
          weeklyDigestLastSent: "not-a-date",
          failoverChain: ["Rock", "rock", "Jazz"],
          fallbackStation: "Pop",
          incidentAlerts: {
            enabled: true,
            channelId: "invalid",
            events: ["stream_recovered", "stream_failover_exhausted"],
          },
          exportsWebhook: {
            enabled: true,
            url: " https://example.com/hook ",
            secret: "x".repeat(200),
            events: ["stats_exported", "stream_recovered", "stream_failover_activated"],
          },
          voiceGuard: {
            policy: "invalid",
          },
        },
      },
      { upsert: true }
    );

    const normalizedSettingsResponse = await requestJson(
      baseUrl,
      `/api/dashboard/settings?serverId=${GUILD_ID}`,
      { headers: { ...authHeaders, "X-OmniFM-Language": "de" } }
    );
    assert.equal(normalizedSettingsResponse.status, 200);
    assert.deepEqual(normalizedSettingsResponse.payload.weeklyDigest, {
      enabled: true,
      channelId: TEXT_CHANNEL_ID,
      dayOfWeek: 6,
      hour: 0,
      language: "de",
    });
    assert.equal(normalizedSettingsResponse.payload.weeklyDigestMeta.ready, true);
    assert.equal(normalizedSettingsResponse.payload.weeklyDigestMeta.lastSentAt, null);
    assert.deepEqual(normalizedSettingsResponse.payload.failoverChain, ["rock", "jazz"]);
    assert.equal(normalizedSettingsResponse.payload.fallbackStation, "rock");
    assert.deepEqual(normalizedSettingsResponse.payload.incidentAlerts, {
      enabled: true,
      channelId: "",
      events: ["stream_failover_exhausted"],
    });
    assert.equal(normalizedSettingsResponse.payload.exportsWebhook.url, "https://example.com/hook");
    assert.deepEqual(normalizedSettingsResponse.payload.exportsWebhook.events, ["stats_exported", "stream_recovered", "stream_failover_activated"]);
    assert.equal(normalizedSettingsResponse.payload.voiceGuard.policy, "default");
    assert.equal(normalizedSettingsResponse.payload.voiceGuard.effectivePolicy, "return");

    const repairedSettings = await getDb().collection("guild_settings").findOne(
      { guildId: GUILD_ID },
      { projection: { _id: 0 } }
    );
    assert.deepEqual(repairedSettings.failoverChain, ["rock", "jazz"]);
    assert.equal(repairedSettings.fallbackStation, "rock");
    assert.equal(repairedSettings.weeklyDigest.dayOfWeek, 6);
    assert.equal(repairedSettings.weeklyDigest.hour, 0);
    assert.equal(repairedSettings.exportsWebhook.secret.length, 120);
    assert.equal(Object.prototype.hasOwnProperty.call(repairedSettings, "weeklyDigestLastSent"), false);
  }

  const settingsAcceptLanguageResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      headers: {
        ...authHeaders,
        "Accept-Language": "en-US,en;q=0.9",
      },
    }
  );
  assert.equal(settingsAcceptLanguageResponse.status, 200);
  assert.equal(settingsAcceptLanguageResponse.payload.weeklyDigest.language, "en");

  const invalidDigestSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        weeklyDigest: {
          enabled: true,
          channelId: "",
          dayOfWeek: 1,
          hour: 9,
          language: "en",
        },
      }),
    }
  );
  assert.equal(invalidDigestSettings.status, 400);
  assert.match(invalidDigestSettings.payload.error, /text channel/i);

  const invalidIncidentAlertSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        incidentAlerts: {
          enabled: true,
          channelId: "",
          events: ["stream_failover_exhausted"],
        },
      }),
    }
  );
  assert.equal(invalidIncidentAlertSettings.status, 403);
  assert.match(invalidIncidentAlertSettings.payload.error, /incident alert/i);

  const voiceGuardSettingsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voiceGuard: {
          policy: "disconnect",
        },
      }),
    }
  );
  if (mongoAvailable && getDb()) {
    assert.equal(voiceGuardSettingsResponse.status, 200);
    assert.equal(voiceGuardSettingsResponse.payload.voiceGuard.policy, "disconnect");
    assert.equal(voiceGuardSettingsResponse.payload.voiceGuard.effectivePolicy, "disconnect");
  } else {
    assert.equal(voiceGuardSettingsResponse.status, 503);
  }

  const digestPreviewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings/digest-preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        weeklyDigest: {
          enabled: true,
          channelId: TEXT_CHANNEL_ID,
          dayOfWeek: 1,
          hour: 9,
          language: "en",
        },
      }),
    }
  );
  assert.equal(digestPreviewResponse.status, 200);
  assert.equal(digestPreviewResponse.payload.preview.channelName, "announcements");
  assert.equal(digestPreviewResponse.payload.preview.embed.title, "Weekly radio report");
  assert.ok(Array.isArray(digestPreviewResponse.payload.preview.fields));
  assert.ok(digestPreviewResponse.payload.preview.fields.length >= 6);

  const digestTestResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings/digest-test?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        weeklyDigest: {
          enabled: true,
          channelId: TEXT_CHANNEL_ID,
          dayOfWeek: 1,
          hour: 9,
          language: "en",
        },
      }),
    }
  );
  assert.equal(digestTestResponse.status, 200);
  assert.equal(digestTestResponse.payload.channelName, "announcements");
  assert.equal(runtimeStub.__sentMessages.length, 1);
  assert.equal(runtimeStub.__sentMessages[0].embeds[0].title, "Weekly radio report");

  const blockedCustomStationsEnResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    {
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
      },
    }
  );
  assert.equal(blockedCustomStationsEnResponse.status, 403);
  assert.match(blockedCustomStationsEnResponse.payload.error, /only available for Ultimate/i);

  const blockedCustomStationsDeResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    {
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "de",
      },
    }
  );
  assert.equal(blockedCustomStationsDeResponse.status, 403);
  assert.match(blockedCustomStationsDeResponse.payload.error, /Custom-Stationen/i);

  activePlan = "ultimate";
  activeSeats = 2;
  upgradeLicenseForServer(GUILD_ID, "ultimate");
  const workspaceLicenseResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(workspaceLicenseResponse.status, 200);
  assert.equal(workspaceLicenseResponse.payload.license.plan, "ultimate");
  assert.equal(workspaceLicenseResponse.payload.license.canManageWorkspace, true);
  assert.equal(workspaceLicenseResponse.payload.license.workspace.linkedServers.length, 1);
  assert.equal(workspaceLicenseResponse.payload.license.workspace.linkedServers[0].id, GUILD_ID);
  assert.equal(workspaceLicenseResponse.payload.license.workspace.availableServers.some((server) => server.id === SECOND_GUILD_ID), true);
  assert.equal(workspaceLicenseResponse.payload.license.workspace.blockedServers.some((server) => server.id === BLOCKED_GUILD_ID), true);

  const blockedWorkspaceMoveResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/workspace?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "link",
        targetServerId: BLOCKED_GUILD_ID,
      }),
    }
  );
  assert.equal(blockedWorkspaceMoveResponse.status, 409);
  assert.match(blockedWorkspaceMoveResponse.payload.error, /another active license/i);

  const workspaceLinkResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/workspace?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "link",
        targetServerId: SECOND_GUILD_ID,
      }),
    }
  );
  assert.equal(workspaceLinkResponse.status, 200);
  assert.equal(workspaceLinkResponse.payload.success, true);
  assert.equal(workspaceLinkResponse.payload.license.seatsUsed, 2);
  assert.equal(workspaceLinkResponse.payload.license.seatsAvailable, 0);
  assert.equal(workspaceLinkResponse.payload.license.workspace.linkedServers.some((server) => server.id === SECOND_GUILD_ID), true);
  assert.equal(workspaceLinkResponse.payload.license.workspace.availableServers.length, 0);

  const workspaceUnlinkResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/workspace?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "unlink",
        targetServerId: SECOND_GUILD_ID,
      }),
    }
  );
  assert.equal(workspaceUnlinkResponse.status, 200);
  assert.equal(workspaceUnlinkResponse.payload.success, true);
  assert.equal(workspaceUnlinkResponse.payload.license.seatsUsed, 1);
  assert.equal(workspaceUnlinkResponse.payload.license.seatsAvailable, 1);
  assert.equal(workspaceUnlinkResponse.payload.license.workspace.availableServers.some((server) => server.id === SECOND_GUILD_ID), true);

  const detailStatsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats/detail?serverId=${GUILD_ID}&days=30`,
    { headers: authHeaders }
  );
  assert.equal(detailStatsResponse.status, 200);
  assert.equal(detailStatsResponse.payload.connectionHealth.timeline.length, 30);

  const webhookTestResponse = await requestJson(
    baseUrl,
    `/api/dashboard/exports/webhook-test?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        exportsWebhook: {
          enabled: false,
          url: webhookUrl,
          secret: "test-secret",
          events: ["stats_exported", "custom_stations_exported"],
        },
      }),
    }
  );
  assert.equal(webhookTestResponse.status, 200);
  assert.equal(webhookTestResponse.payload.delivery.delivered, true);
  assert.equal(webhookRequests.length, 1);
  assert.equal(webhookRequests[0].headers["x-omnifm-event"], "test");
  assert.equal(webhookRequests[0].headers["x-omnifm-webhook-secret"], "test-secret");
  assert.equal(webhookRequests[0].payload.event, "test");

  const initialCustomStationsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(initialCustomStationsResponse.status, 200);
  assert.deepEqual(initialCustomStationsResponse.payload.stations, []);

  const createCustomStationResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "nightwave",
        name: "Nightwave FM",
        url: "https://1.1.1.1/live",
        genre: "Synthwave",
        folder: "Night Rotation",
        tags: "night, synthwave, night",
      }),
    }
  );
  assert.equal(createCustomStationResponse.status, 201);
  assert.equal(createCustomStationResponse.payload.station.folder, "Night Rotation");
  assert.deepEqual(createCustomStationResponse.payload.station.tags, ["night", "synthwave"]);

  const updateCustomStationResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "nightwave",
        name: "Nightwave Live",
        url: "https://1.1.1.1/live",
        genre: "Synthwave",
        folder: "Featured",
        tags: ["featured", "live"],
      }),
    }
  );
  assert.equal(updateCustomStationResponse.status, 200);
  assert.equal(updateCustomStationResponse.payload.station.name, "Nightwave Live");
  assert.equal(updateCustomStationResponse.payload.station.folder, "Featured");
  assert.deepEqual(updateCustomStationResponse.payload.station.tags, ["featured", "live"]);

  const customStationsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(customStationsResponse.status, 200);
  assert.equal(customStationsResponse.payload.stations.length, 1);
  assert.equal(customStationsResponse.payload.stations[0].folder, "Featured");
  assert.deepEqual(customStationsResponse.payload.stations[0].tags, ["featured", "live"]);

  const exportSettingsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        incidentAlerts: {
          enabled: true,
          channelId: TEXT_CHANNEL_ID,
          events: ["stream_healthcheck_stalled", "stream_failover_exhausted"],
        },
        exportsWebhook: {
          enabled: true,
          url: webhookUrl,
          secret: "test-secret",
          events: ["stats_exported", "custom_stations_exported", "stream_healthcheck_stalled", "stream_recovered"],
        },
      }),
    }
  );
  assert.equal(exportSettingsResponse.status, mongoAvailable ? 200 : 503);
  if (mongoAvailable) {
    assert.equal(exportSettingsResponse.payload.incidentAlerts.enabled, true);
    assert.equal(exportSettingsResponse.payload.incidentAlerts.channelId, TEXT_CHANNEL_ID);
    assert.deepEqual(exportSettingsResponse.payload.incidentAlerts.events, ["stream_healthcheck_stalled", "stream_failover_exhausted"]);
    assert.equal(exportSettingsResponse.payload.exportsWebhook.enabled, true);
    assert.equal(exportSettingsResponse.payload.exportsWebhook.url, webhookUrl);
    assert.deepEqual(exportSettingsResponse.payload.exportsWebhook.events, ["stats_exported", "custom_stations_exported", "stream_healthcheck_stalled", "stream_recovered"]);
  }

  const stationsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(stationsResponse.status, 200);
  assert.equal(stationsResponse.payload.custom.length, 1);
  assert.equal(stationsResponse.payload.custom[0].folder, "Featured");
  assert.deepEqual(stationsResponse.payload.custom[0].tags, ["featured", "live"]);

  const statsExportResponse = await requestJson(
    baseUrl,
    `/api/dashboard/exports/stats?serverId=${GUILD_ID}&days=14`,
    { headers: authHeaders }
  );
  assert.equal(statsExportResponse.status, 200);
  assert.equal(statsExportResponse.payload.exportType, "stats");
  assert.equal(statsExportResponse.payload.detail.days, 14);
  if (mongoAvailable) {
    assert.equal(statsExportResponse.payload.webhookDelivery.delivered, true);
    assert.equal(webhookRequests.length, 2);
    assert.equal(webhookRequests[1].payload.event, "stats_exported");
  }

  const stationsExportResponse = await requestJson(
    baseUrl,
    `/api/dashboard/exports/custom-stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(stationsExportResponse.status, 200);
  assert.equal(stationsExportResponse.payload.exportType, "custom_stations");
  assert.equal(stationsExportResponse.payload.stations.length, 1);
  if (mongoAvailable) {
    assert.equal(stationsExportResponse.payload.webhookDelivery.delivered, true);
    assert.equal(webhookRequests.length, 3);
    assert.equal(webhookRequests[2].payload.event, "custom_stations_exported");
  }

  const availableFailoverStations = [
    ...(stationsResponse.payload.custom || []).map((station) => `custom:${station.key}`),
    ...(stationsResponse.payload.free || []).map((station) => station.key),
    ...(stationsResponse.payload.pro || []).map((station) => station.key),
    ...(stationsResponse.payload.ultimate || []).map((station) => station.key),
  ].filter(Boolean);
  assert.ok(availableFailoverStations.length >= 2);
  const selectedFailoverChain = availableFailoverStations.slice(0, 2);

  const validFailoverSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        failoverChain: selectedFailoverChain,
      }),
    }
  );
  assert.equal(validFailoverSettings.status, mongoAvailable ? 200 : 503);
  if (mongoAvailable) {
    assert.deepEqual(validFailoverSettings.payload.failoverChain, selectedFailoverChain);
    assert.equal(validFailoverSettings.payload.fallbackStation, selectedFailoverChain[0]);
    assert.equal(validFailoverSettings.payload.failoverChainPreview.length, selectedFailoverChain.length);
  }

  const legacyFallbackSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fallbackStation: selectedFailoverChain[0],
      }),
    }
  );
  assert.equal(legacyFallbackSettings.status, mongoAvailable ? 200 : 503);
  if (mongoAvailable) {
    assert.deepEqual(legacyFallbackSettings.payload.failoverChain, [selectedFailoverChain[0]]);
    assert.equal(legacyFallbackSettings.payload.fallbackStation, selectedFailoverChain[0]);
  }

  const invalidFallbackSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        failoverChain: ["custom:missing-station"],
      }),
    }
  );
  assert.equal(invalidFallbackSettings.status, 400);
  assert.match(invalidFallbackSettings.payload.error, /fallback station/i);
  activePlan = "pro";

  const previewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/events/preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Preview Show",
        stationKey: "rock",
        channelId: VOICE_CHANNEL_ID,
        textChannelId: TEXT_CHANNEL_ID,
        startsAtLocal: conflictStartLocal,
        timezone: "Europe/Vienna",
        durationMs: 30 * 60 * 1000,
        repeat: "none",
        createDiscordEvent: false,
      }),
    }
  );
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.payload.event.stationName, "Rock FM");
  assert.equal(previewResponse.payload.schedule.nextRuns.length, 1);
  assert.equal(previewResponse.payload.schedule.hasConflicts, true);
  assert.equal(previewResponse.payload.conflicts.length, 1);
  assert.equal(previewResponse.payload.conflicts[0].severity, "error");
  assert.match(previewResponse.payload.conflicts[0].message, /Existing Show/);

  const channelsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/channels?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(channelsResponse.status, 200);
  assert.deepEqual(channelsResponse.payload.voiceChannels, [{
    id: VOICE_CHANNEL_ID,
    name: "radio-lounge",
    position: 0,
    parentName: "",
    type: "voice",
  }]);
  assert.deepEqual(channelsResponse.payload.textChannels, [{
    id: TEXT_CHANNEL_ID,
    name: "announcements",
    position: 0,
    parentName: "",
  }]);

  const emojisResponse = await requestJson(
    baseUrl,
    `/api/dashboard/emojis?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(emojisResponse.status, 200);
  assert.deepEqual(emojisResponse.payload.emojis, []);

  const rolesResponse = await requestJson(
    baseUrl,
    `/api/dashboard/roles?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(rolesResponse.status, 200);
  assert.deepEqual(rolesResponse.payload.roles, [
    { id: ROLE_DJ_ID, name: "DJ", color: "#5865F2", position: 2 },
    { id: ROLE_ADMIN_ID, name: "Admin", color: "#10B981", position: 1 },
  ]);

  const createEventResponse = await requestJson(
    baseUrl,
    `/api/dashboard/events?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Night Shift",
        stationKey: "rock",
        channelId: VOICE_CHANNEL_ID,
        textChannelId: TEXT_CHANNEL_ID,
        startsAtLocal: createEventStartLocal,
        timezone: "Europe/Vienna",
        durationMs: 45 * 60 * 1000,
        repeat: "none",
        createDiscordEvent: false,
      }),
    }
  );
  assert.equal(createEventResponse.status, 200);
  assert.equal(createEventResponse.payload.success, true);
  assert.equal(createEventResponse.payload.event.title, "Night Shift");
  assert.equal(createEventResponse.payload.event.channelId, VOICE_CHANNEL_ID);
  const createdEventId = createEventResponse.payload.event.id;
  assert.equal(Boolean(createdEventId), true);

  const listEventsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/events?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(listEventsResponse.status, 200);
  assert.equal(listEventsResponse.payload.events.length, 2);
  assert.equal(listEventsResponse.payload.events.some((eventRow) => eventRow.title === "Existing Show"), true);
  assert.equal(listEventsResponse.payload.events.some((eventRow) => eventRow.id === createdEventId), true);

  const updateEventResponse = await requestJson(
    baseUrl,
    `/api/dashboard/events/${encodeURIComponent(createdEventId)}?serverId=${GUILD_ID}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Night Shift Deluxe",
        startsAtLocal: updateEventStartLocal,
        durationMs: 60 * 60 * 1000,
        repeat: "weekly",
      }),
    }
  );
  assert.equal(updateEventResponse.status, 200);
  assert.equal(updateEventResponse.payload.success, true);
  assert.equal(updateEventResponse.payload.event.title, "Night Shift Deluxe");
  assert.equal(updateEventResponse.payload.event.repeat, "weekly");

  const deleteEventResponse = await requestJson(
    baseUrl,
    `/api/dashboard/events/${encodeURIComponent(createdEventId)}?serverId=${GUILD_ID}`,
    {
      method: "DELETE",
      headers: authHeaders,
    }
  );
  assert.equal(deleteEventResponse.status, 200);
  assert.equal(deleteEventResponse.payload.success, true);
  assert.equal(deleteEventResponse.payload.eventId, createdEventId);

  const eventsAfterDeleteResponse = await requestJson(
    baseUrl,
    `/api/dashboard/events?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(eventsAfterDeleteResponse.status, 200);
  assert.equal(eventsAfterDeleteResponse.payload.events.length, 1);
  assert.equal(eventsAfterDeleteResponse.payload.events.some((eventRow) => eventRow.id === createdEventId), false);

  await recordRuntimeIncident({
    guildId: GUILD_ID,
    guildName: "OmniFM Test Guild",
    tier: "pro",
    eventKey: "stream_failover_activated",
    runtime: {
      id: "bot-test-1",
      name: "OmniFM Test",
      role: "commander",
    },
    payload: {
      previousStationKey: "nightwave",
      previousStationName: "Nightwave FM",
      failoverStationKey: "rock",
      failoverStationName: "Rock FM",
      attemptedCandidates: ["rock", "jazz"],
      triggerError: "timeout",
      listenerCount: 4,
    },
  });

  const incidentsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats/incidents?serverId=${GUILD_ID}&status=all&limit=10`,
    { headers: authHeaders }
  );
  assert.equal(incidentsResponse.status, 200);
  assert.equal(incidentsResponse.payload.incidents.length >= 1, true);
  assert.equal(incidentsResponse.payload.incidents[0].status, "open");

  const acknowledgeIncidentResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats/incidents?serverId=${GUILD_ID}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        incidentId: incidentsResponse.payload.incidents[0].id,
      }),
    }
  );
  assert.equal(acknowledgeIncidentResponse.status, 200);
  assert.equal(acknowledgeIncidentResponse.payload.success, true);
  assert.equal(acknowledgeIncidentResponse.payload.incident.status, "acknowledged");
  assert.equal(acknowledgeIncidentResponse.payload.incident.acknowledgedBy.username, "TestUser");

  const acknowledgedIncidentsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats/incidents?serverId=${GUILD_ID}&status=acknowledged&limit=10`,
    { headers: authHeaders }
  );
  assert.equal(acknowledgedIncidentsResponse.status, 200);
  assert.equal(acknowledgedIncidentsResponse.payload.incidents.length >= 1, true);
  assert.equal(acknowledgedIncidentsResponse.payload.incidents[0].status, "acknowledged");

  const statsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(statsResponse.status, 200);
  assert.equal(statsResponse.payload.basic.setupStatus.commanderReady, true);
  assert.equal(statsResponse.payload.basic.setupStatus.invitedWorkerCount, 0);
  assert.equal(statsResponse.payload.basic.setupStatus.maxWorkerSlots, 8);
  assert.equal(statsResponse.payload.basic.setupStatus.activeStreamCount, 1);
  assert.equal(statsResponse.payload.basic.setupStatus.firstStreamLive, true);
  assert.equal(statsResponse.payload.basic.setupStatus.completedSteps, 2);
  assert.equal(statsResponse.payload.basic.health.status, "warning");
  assert.equal(statsResponse.payload.basic.health.managedBots, 1);
  assert.equal(statsResponse.payload.basic.health.unavailableBots, 0);
  assert.equal(statsResponse.payload.basic.health.liveStreams, 1);
  assert.equal(statsResponse.payload.basic.health.recoveringStreams, 1);
  assert.equal(statsResponse.payload.basic.health.streamErrors, 1);
  assert.equal(statsResponse.payload.basic.health.nextEventTitle, "Existing Show");
  assert.equal(statsResponse.payload.basic.health.alerts.length >= 1, true);
  assert.equal(statsResponse.payload.basic.health.incidents.length >= 1, true);
  assert.equal(statsResponse.payload.basic.health.incidents[0].eventKey, "stream_failover_activated");
  assert.equal(statsResponse.payload.basic.health.incidents[0].status, "acknowledged");
  assert.equal(statsResponse.payload.basic.health.incidents[0].payload.failoverStationName, "Rock FM");

  const initialPerms = await requestJson(
    baseUrl,
    `/api/dashboard/perms?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(initialPerms.status, 200);
  assert.ok(Array.isArray(initialPerms.payload.rules));
  assert.ok(initialPerms.payload.rules.some((rule) => rule.command === "play"));

  const updatePerms = await requestJson(
    baseUrl,
    `/api/dashboard/perms?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        commandRoleMap: {
          play: ["DJ"],
          stop: [ROLE_ADMIN_ID],
        },
      }),
    }
  );
  assert.equal(updatePerms.status, 200);
  const playRule = updatePerms.payload.rules.find((rule) => rule.command === "play");
  const stopRule = updatePerms.payload.rules.find((rule) => rule.command === "stop");
  assert.deepEqual(playRule.allowRoleIds, [ROLE_DJ_ID]);
  assert.deepEqual(stopRule.allowRoleIds, [ROLE_ADMIN_ID]);
  assert.deepEqual(updatePerms.payload.commandRoleMap.play, ["DJ"]);
  assert.deepEqual(updatePerms.payload.commandRoleMap.stop, ["Admin"]);

  activePlan = "free";
  activeSeats = 0;
  const blockedPerms = await requestJson(
    baseUrl,
    `/api/dashboard/perms?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(blockedPerms.status, 403);

  activePlan = "pro";
  activeSeats = 2;
  const unauthorizedHealth = await requestJson(baseUrl, "/api/health/detail?lang=de");
  assert.equal(unauthorizedHealth.status, 401);
  assert.match(unauthorizedHealth.payload.error, /API-Admin-Token erforderlich/i);

  const authorizedHealth = await requestJson(baseUrl, "/api/health/detail", {
    headers: { "x-admin-token": "test-admin-token" },
  });
  assert.equal(authorizedHealth.status, 200);
  assert.equal(authorizedHealth.payload.discord.readyBots, 1);
  assert.equal(authorizedHealth.payload.stores.commandPermissions.filePresent, true);
  assert.equal(typeof authorizedHealth.payload.binaries.ffmpeg.available, "boolean");

  const resetStatsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats/reset?serverId=${GUILD_ID}`,
    {
      method: "DELETE",
      headers: authHeaders,
    }
  );
  assert.equal(resetStatsResponse.status, 200);
  assert.equal(resetStatsResponse.payload.success, true);
  assert.equal(resetStatsResponse.payload.serverId, GUILD_ID);
  assert.equal(typeof resetStatsResponse.payload.deleted, "object");

  const logoutResponse = await requestJson(baseUrl, "/api/auth/logout", {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(logoutResponse.status, 200);
  assert.equal(logoutResponse.payload.success, true);

  const sessionAfterLogoutResponse = await requestJson(baseUrl, "/api/auth/session", { headers: authHeaders });
  assert.equal(sessionAfterLogoutResponse.status, 200);
  assert.equal(sessionAfterLogoutResponse.payload.authenticated, false);
});

test("dashboard stats keep recovering workers visible even without an active voice connection", async (t) => {
  const trackedFiles = [
    path.join(repoRoot, "dashboard.json"),
    path.join(repoRoot, "dashboard.json.bak"),
    path.join(repoRoot, "command-permissions.json"),
    path.join(repoRoot, "command-permissions.json.bak"),
    path.join(repoRoot, "listening-stats.json"),
    path.join(repoRoot, "listening-stats.json.bak"),
    path.join(repoRoot, "runtime-incidents.json"),
    path.join(repoRoot, "runtime-incidents.json.bak"),
    path.join(repoRoot, "scheduled-events.json"),
  ];
  const snapshots = new Map();
  for (const filePath of trackedFiles) {
    snapshots.set(filePath, await snapshotFile(filePath));
  }

  const restoreEnv = setEnv({
    WEB_INTERNAL_PORT: "0",
    WEB_PORT: "0",
    WEB_BIND: "127.0.0.1",
    API_RATE_LIMIT_MAX: "200",
    API_RATE_LIMIT_PREMIUM_MAX: "50",
    API_RATE_LIMIT_WEBHOOK_MAX: "200",
  });

  setLicenseProvider((serverId) => {
    if (String(serverId) !== GUILD_ID) return null;
    return {
      plan: "pro",
      active: true,
      seats: 1,
    };
  });

  const sessionToken = `test-session-recovering-${Date.now()}`;
  const nowTs = Math.floor(Date.now() / 1000);
  setDashboardAuthSession(sessionToken, {
    user: {
      id: "523456789012345678",
      username: "RecoveringUser",
    },
    guilds: [{
      id: GUILD_ID,
      name: "OmniFM Test Guild",
      permissions: "32",
      owner: true,
    }],
    createdAt: nowTs,
    expiresAt: nowTs + 3600,
  });

  const guild = createGuildStub();
  const commanderRuntime = {
    role: "commander",
    config: {
      id: "bot-test-commander",
      index: 1,
      name: "OmniFM DJ",
      requiredTier: "free",
    },
    guildState: new Map(),
    client: {
      isReady: () => true,
      guilds: { cache: new Map([[GUILD_ID, guild]]) },
    },
    collectStats() {
      return { servers: 1, users: 12, connections: 0, listeners: 0 };
    },
    getPlayingGuildCount() {
      return 0;
    },
    getPublicStatus() {
      return {
        id: "bot-test-commander",
        botId: "bot-test-commander",
        name: "OmniFM DJ",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        users: 12,
        connections: 0,
        listeners: 0,
      };
    },
    getDashboardStatus() {
      return {
        id: "bot-test-commander",
        botId: "bot-test-commander",
        name: "OmniFM DJ",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        users: 12,
        connections: 0,
        listeners: 0,
        guildDetails: [],
      };
    },
  };

  const offlineWorkerRuntime = {
    role: "worker",
    workerSlot: 1,
    config: {
      id: "bot-test-worker-1",
      index: 2,
      name: "OmniFM 1",
      requiredTier: "free",
    },
    guildState: new Map([[
      GUILD_ID,
      {
        currentStationKey: "rock",
        currentStationName: "Rock FM",
        lastChannelId: VOICE_CHANNEL_ID,
        shouldReconnect: true,
        reconnectAttempts: 3,
        reconnectTimer: { pending: true },
        restoreBlockedUntil: Date.now() + (20 * 60_000),
        restoreBlockedAt: Date.now() - (5 * 60_000),
        restoreBlockCount: 2,
        restoreBlockReason: "worker-autoheal",
        lastProcessExitCode: 1,
        lastProcessExitDetail: "broken-pipe",
        lastProcessExitAt: Date.now() - (3 * 60_000),
        lastStreamEndReason: "stream-health-stalled",
        voiceDisconnectObservedAt: Date.now() - (2 * 60_000),
        streamErrorCount: 0,
        currentMeta: null,
        connection: null,
      },
    ]]),
    client: {
      isReady: () => false,
      guilds: { cache: new Map() },
    },
    getCurrentListenerCount() {
      return 0;
    },
    getPublicStatus() {
      return {
        id: "bot-test-worker-1",
        botId: "bot-test-worker-1",
        name: "OmniFM 1",
        role: "worker",
        requiredTier: "free",
        ready: false,
        servers: 0,
        users: 0,
        connections: 0,
        listeners: 0,
      };
    },
    getDashboardStatus() {
      return {
        id: "bot-test-worker-1",
        botId: "bot-test-worker-1",
        name: "OmniFM 1",
        role: "worker",
        requiredTier: "free",
        ready: false,
        servers: 0,
        users: 0,
        connections: 0,
        listeners: 0,
        guildDetails: [],
      };
    },
  };

  const server = startWebServer([commanderRuntime, offlineWorkerRuntime]);
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    deleteDashboardAuthSession(sessionToken);
    setLicenseProvider(() => null);
    restoreEnv();
    for (const [filePath, snapshot] of snapshots.entries()) {
      await restoreFile(filePath, snapshot);
    }
  });

  const statsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats?serverId=${GUILD_ID}`,
    { headers: { "x-session-token": sessionToken } }
  );

  assert.equal(statsResponse.status, 200);
  assert.equal(statsResponse.payload.basic.setupStatus.commanderReady, true);
  assert.equal(statsResponse.payload.basic.setupStatus.invitedWorkerCount, 1);
  assert.equal(statsResponse.payload.basic.setupStatus.activeStreamCount, 1);
  assert.equal(statsResponse.payload.basic.setupStatus.firstStreamLive, true);
  assert.equal(statsResponse.payload.basic.health.status, "warning");
  assert.equal(statsResponse.payload.basic.health.managedBots, 2);
  assert.equal(statsResponse.payload.basic.health.readyBots, 1);
  assert.equal(statsResponse.payload.basic.health.unavailableBots, 1);
  assert.equal(statsResponse.payload.basic.health.liveStreams, 1);
  assert.equal(statsResponse.payload.basic.health.recoveringStreams, 1);
  assert.equal(statsResponse.payload.basic.health.degradedStreams, 0);

  const workerRow = statsResponse.payload.basic.health.bots.find((row) => row.botId === "bot-test-worker-1");
  assert.ok(workerRow);
  assert.equal(workerRow.ready, false);
  assert.equal(workerRow.status, "offline");
  assert.equal(workerRow.recovering, true);
  assert.equal(workerRow.stationName, "Rock FM");
  assert.equal(workerRow.restoreBlockReason, "worker-autoheal");
  assert.equal(workerRow.restoreBlockCount, 2);
  assert.equal(workerRow.lastProcessExitDetail, "broken-pipe");
  assert.equal(workerRow.lastStreamEndReason, "stream-health-stalled");
  assert.ok(Number(workerRow.restoreCooldownMs || 0) > 0);
});
