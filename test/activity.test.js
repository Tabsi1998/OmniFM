import test from "node:test";
import assert from "node:assert/strict";

// The Discord Activity (#308, prototype): Discord's SDK signs the person in
// through the commander's app; OmniFM keeps only a hashed session in memory
// and shows what plays in a voice channel only to someone in that channel.
const { createActivityRoutes, activityOrigin, isActivityRequest } = await import("../src/api/routes/activity-routes.js");
const { collectChannelNowPlaying } = await import("../src/api/helpers/runtime-status.js");
const { sendJson, methodNotAllowed } = await import("../src/lib/api-helpers.js");
const { getApiRateLimitSpec } = await import("../src/lib/api-rate-limit.js");

const CLIENT = "100000000000000001";
const USER = "200000000000000001";
const OTHER = "200000000000000002";
const GUILD = "300000000000000001";
const CHANNEL = "400000000000000001";
const ELSEWHERE = "400000000000000002";
const env = { DISCORD_CLIENT_ID: CLIENT, DISCORD_CLIENT_SECRET: "secret" };

function fakeDiscord({ tokenStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/oauth2/token")) return { ok: tokenStatus < 400, status: tokenStatus, json: async () => ({ access_token: "access-1" }) };
    if (String(url).endsWith("/users/@me")) return { ok: true, status: 200, json: async () => ({ id: USER }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

function commander({ voiceChannelOf = { [USER]: CHANNEL, [OTHER]: ELSEWHERE } } = {}) {
  const member = (id, name, bot = false) => ({ id, displayName: name, user: { bot }, displayAvatarURL: ({ size }) => `https://cdn.discordapp.com/avatars/${id}/a.png?size=${size}` });
  const channel = { name: "Radio", members: new Map([[USER, member(USER, "Ada")], ["9", member("900000000000000009", "OmniFM 1", true)]]) };
  const guild = {
    name: "Lofi Lounge",
    voiceStates: { cache: new Map(Object.entries(voiceChannelOf).map(([id, channelId]) => [id, { channelId }])) },
    channels: { cache: new Map([[CHANNEL, channel]]) },
  };
  return { role: "commander", client: { guilds: { cache: new Map([[GUILD, guild]]) } } };
}

function worker(detail) {
  return {
    role: "worker",
    getPublicStatus: () => ({ name: "OmniFM 1", guildDetails: [{ guildId: GUILD, ...detail }] }),
  };
}

function routes(overrides = {}) {
  const discord = fakeDiscord(overrides.discord);
  const handle = createActivityRoutes({ sendJson, methodNotAllowed, fetchImpl: discord.fetchImpl, now: () => 1_000_000, env: overrides.env || env });
  const call = async (method, pathname, { body, headers = {}, runtimes = [] } = {}) => {
    const res = { status: 0, body: null, writeHead(status) { this.status = status; }, setHeader() {}, end(text) { this.body = text ? JSON.parse(text) : null; } };
    const handled = await handle({ req: { method, headers }, res, requestUrl: new URL(`https://omnifm.xyz${pathname}`), readJsonBody: async () => body, runtimes });
    return { handled, ...res };
  };
  return { call, discord };
}

test("the Activity's own address counts for /api/activity only", () => {
  assert.equal(activityOrigin(env), `https://${CLIENT}.discordsays.com`);
  assert.equal(activityOrigin({}), "");
  const from = (origin) => ({ headers: { origin } });
  assert.equal(isActivityRequest(from(`https://${CLIENT}.discordsays.com`), "/api/activity/now", env), true);
  assert.equal(isActivityRequest(from(`https://${CLIENT}.discordsays.com`), "/api/dashboard/stats", env), false, "nowhere else");
  assert.equal(isActivityRequest(from("https://100000000000000002.discordsays.com"), "/api/activity/now", env), false, "another app");
  assert.equal(isActivityRequest(from("https://evil.example"), "/api/activity/now", env), false);
  assert.equal(getApiRateLimitSpec("/api/activity/now").scope, "activity", "many people behind few Discord addresses");
});

test("config gives the client ID; the code becomes the SDK's token and a session, kept as a hash", async () => {
  const { call, discord } = routes();
  assert.equal((await call("GET", "/api/other/x")).handled, false);
  assert.deepEqual((await call("GET", "/api/activity/config")).body, { clientId: CLIENT });
  assert.equal((await routes({ env: {} }).call("GET", "/api/activity/config")).status, 503);
  assert.equal((await call("POST", "/api/activity/token", { body: {} })).status, 400);

  const signedIn = await call("POST", "/api/activity/token", { body: { code: "code-1" } });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.access_token, "access-1");
  assert.match(signedIn.body.session, /^[\w-]{43}$/);
  const exchange = String(discord.calls[0].options.body);
  assert.match(exchange, /grant_type=authorization_code&code=code-1/);
  assert.doesNotMatch(exchange, /redirect_uri/, "the SDK's code needs no redirect");
  assert.equal(discord.calls[1].options.headers.Authorization, "Bearer access-1");

  const refused = await routes({ discord: { tokenStatus: 400 } }).call("POST", "/api/activity/token", { body: { code: "bad" } });
  assert.equal(refused.status, 502);
  assert.equal((await call("GET", "/api/activity/token")).status, 405);
});

test("what plays in the channel, only for someone in that channel", async () => {
  const { call } = routes();
  const { session } = (await call("POST", "/api/activity/token", { body: { code: "code-1" } })).body;
  const auth = { authorization: `Bearer ${session}` };
  const playing = worker({ channelId: CHANNEL, playing: true, stationKey: "groovesalad", stationName: "Groove Salad", meta: { artist: "Air", title: "La Femme d'Argent" } });
  const query = `/api/activity/now?guildId=${GUILD}&channelId=${CHANNEL}`;

  assert.equal((await call("GET", query)).status, 401, "no session");
  assert.equal((await call("GET", query, { headers: { authorization: "Bearer made-up" } })).status, 401);
  assert.equal((await call("GET", `/api/activity/now?guildId=x&channelId=${CHANNEL}`, { headers: auth })).status, 400);
  assert.equal((await call("GET", query, { headers: auth, runtimes: [] })).status, 404, "no commander, no server");
  const away = await call("GET", query, { headers: auth, runtimes: [commander({ voiceChannelOf: { [USER]: ELSEWHERE } }), playing] });
  assert.equal(away.status, 403);
  assert.equal(away.body.error, "not_in_channel");

  const here = await call("GET", query, { headers: auth, runtimes: [commander(), playing] });
  assert.equal(here.status, 200);
  assert.equal(here.body.channelName, "Radio");
  assert.deepEqual(here.body.streams, [{
    botName: "OmniFM 1",
    stationKey: "groovesalad",
    stationName: "Groove Salad",
    recovering: false,
    song: "Air - La Femme d'Argent",
    logoUrl: "/api/image/station/groovesalad",
  }]);
  assert.deepEqual(here.body.listeners, [{ id: USER, name: "Ada", avatarUrl: `https://cdn.discordapp.com/avatars/${USER}/a.png?size=64` }], "people, not bots");
  assert.equal(here.body.refreshMs, 10_000);
});

test("the channel's streams: only the ones in that channel and playing", () => {
  const rows = collectChannelNowPlaying([
    worker({ channelId: CHANNEL, playing: true, stationKey: "a", stationName: "A", meta: { displayTitle: "Song" } }),
    worker({ channelId: ELSEWHERE, playing: true, stationKey: "b", stationName: "B" }),
    worker({ channelId: CHANNEL, playing: false, recovering: false, stationKey: "c" }),
  ], GUILD, CHANNEL);
  assert.deepEqual(rows.map((row) => [row.stationKey, row.song]), [["a", "Song"]]);
});
