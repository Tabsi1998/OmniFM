import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// OmniFM Radio (#593) in the server dashboard: where the live announcement
// goes, which role it mentions, or off. Every plan; only on servers that see
// OmniFM Radio.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-dashboard-radio-"));
const VISIBLE = String(100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)));
const HIDDEN = String(BigInt(VISIBLE) + 1n);
// Visible, but the bot's view of it has no roles (like a worker's summary).
const ROLELESS = String(BigInt(VISIBLE) + 2n);
const env = {
  OMNIFM_RUNTIME_DATA_DIR: dataDir,
  WEB_INTERNAL_PORT: "0",
  WEB_PORT: "0",
  WEB_BIND: "127.0.0.1",
  API_RATE_LIMIT_MAX: "500",
  OMNIFM_RADIO_TEST_GUILD_IDS: `${VISIBLE},${ROLELESS}`,
  OMNIFM_RADIO_PUBLIC: "0",
};
const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const { startWebServer } = await import("../src/api/server.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { setDashboardAuthSession, deleteDashboardAuthSession } = await import("../src/dashboard-store.js");
const { buildDashboardRadioAnnounceResponse } = await import("../src/lib/omnifm-radio-announce-settings.js");

const SYSTEM = "323456789012345678";
const ROLE_LOW = "423456789012345678";
const ROLE_HIGH = "523456789012345678";
const BOT_ROLE = "623456789012345678";

const NEWS = "723456789012345679";

function guildOf(id) {
  const channels = new Map([
    [SYSTEM, { id: SYSTEM, name: "allgemein", type: 0, position: 0 }],
    [NEWS, { id: NEWS, name: "radio-news", type: 5, position: 1 }],
  ]);
  return {
    id,
    name: "Club",
    channels: { cache: channels, fetch: async () => channels },
    systemChannel: { id: SYSTEM, name: "allgemein" },
    roles: {
      cache: new Map([
        [id, { id, name: "@everyone", position: 0 }],
        [ROLE_LOW, { id: ROLE_LOW, name: "Hörer", position: 1, hexColor: "#ff0000", mentionable: true }],
        [ROLE_HIGH, { id: ROLE_HIGH, name: "Radio-Team", position: 5, hexColor: "#00ff00" }],
        [BOT_ROLE, { id: BOT_ROLE, name: "OmniFM", position: 9, managed: true }],
      ]),
    },
  };
}

test("the dashboard answer: the setting, the system channel and the roles, only where OmniFM Radio is visible", () => {
  assert.deepEqual(buildDashboardRadioAnnounceResponse(HIDDEN, {}, { guild: guildOf(HIDDEN), visible: false }), { available: false });
  const answer = buildDashboardRadioAnnounceResponse(VISIBLE, { omnifmRadioAnnounce: { enabled: false, roleId: ROLE_LOW } }, { guild: guildOf(VISIBLE), visible: true });
  assert.deepEqual(answer, {
    available: true,
    enabled: false,
    channelId: "",
    roleId: ROLE_LOW,
    systemChannel: { id: SYSTEM, name: "allgemein" },
    roles: [
      { id: ROLE_HIGH, name: "Radio-Team", color: "#00ff00", mentionable: false },
      { id: ROLE_LOW, name: "Hörer", color: "#ff0000", mentionable: true },
    ],
  }, "highest role first; no @everyone, no bot roles");
  assert.equal(buildDashboardRadioAnnounceResponse(VISIBLE, {}, { guild: null, visible: true }).systemChannel, null, "bot not on the server yet");
});

function createRuntimes() {
  const status = { id: "bot-radio-commander", botId: "bot-radio-commander", name: "OmniFM DJ", role: "commander", requiredTier: "free", ready: true, servers: 2, users: 3, connections: 0, listeners: 0, uptimeSec: 60 };
  return [{
    role: "commander",
    config: { id: "bot-radio-commander", index: 1, name: "OmniFM DJ", requiredTier: "free" },
    client: { isReady: () => true, guilds: { cache: new Map([[VISIBLE, guildOf(VISIBLE)], [HIDDEN, guildOf(HIDDEN)], [ROLELESS, { id: ROLELESS, name: "Ohne Rollen" }]]) } },
    getPublicStatus: () => status,
    getDashboardStatus: () => ({ ...status, guildDetails: [] }),
    workerManager: { refreshRemoteStates: async () => null, getStreamingWorkers: () => [] },
    collectStats: () => ({ servers: 2, users: 3, connections: 0, listeners: 0 }),
    getPlayingGuildCount: () => 0,
  }];
}

test("a Free server sets channel, role or off; a server without OmniFM Radio cannot", async (t) => {
  setLicenseProvider(() => null);
  let mongo = null;
  if (hasMongoConfig) {
    const { connect, getDb } = await import("../src/lib/db.js");
    await connect();
    mongo = getDb();
  }
  const token = `radio-dashboard-${Date.now()}`;
  const nowTs = Math.floor(Date.now() / 1000);
  setDashboardAuthSession(token, {
    user: { id: "723456789012345678", username: "Vereinsadmin" },
    guilds: [{ id: VISIBLE, name: "Club", permissions: "32", owner: true }, { id: HIDDEN, name: "Andere", permissions: "32", owner: true }, { id: ROLELESS, name: "Ohne Rollen", permissions: "32", owner: true }],
    createdAt: nowTs,
    expiresAt: nowTs + 3600,
  });
  const server = startWebServer(createRuntimes());
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    deleteDashboardAuthSession(token);
    if (mongo) await mongo.collection("guild_settings").deleteMany({ guildId: { $in: [VISIBLE, HIDDEN, ROLELESS] } }).catch(() => null);
    const { close } = await import("../src/lib/db.js");
    await close().catch(() => null);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  });
  const call = async (method, pathname, body) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        "x-session-token": token,
        "X-OmniFM-Language": "de",
        ...(method === "GET" ? {} : { "X-OmniFM-CSRF": "dashboard-intent", "Content-Type": "application/json" }),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, payload: await response.json().catch(() => ({})) };
  };

  const visible = await call("GET", `/api/dashboard/settings?serverId=${VISIBLE}`);
  assert.equal(visible.status, 200, JSON.stringify(visible.payload));
  assert.equal(visible.payload.omnifmRadioAnnounce.available, true);
  assert.equal(visible.payload.omnifmRadioAnnounce.enabled, true, "on by default");
  assert.deepEqual(visible.payload.omnifmRadioAnnounce.systemChannel, { id: SYSTEM, name: "allgemein" });
  assert.deepEqual(visible.payload.omnifmRadioAnnounce.roles.map((role) => role.id), [ROLE_HIGH, ROLE_LOW]);

  const hidden = await call("GET", `/api/dashboard/settings?serverId=${HIDDEN}`);
  assert.deepEqual(hidden.payload.omnifmRadioAnnounce, { available: false });
  // Hidden between GET and PUT: the rest of the save goes through, the radio part is left out.
  const hiddenSave = await call("PUT", `/api/dashboard/settings?serverId=${HIDDEN}`, { omnifmRadioAnnounce: { enabled: false }, serverTimeZone: "Europe/Berlin" });
  assert.notEqual(hiddenSave.status, 403);
  assert.notEqual(hiddenSave.status, 400);

  // Only a role that can be mentioned, only a real boolean.
  for (const roleId of [VISIBLE, BOT_ROLE, "823456789012345678"]) {
    // eslint-disable-next-line no-await-in-loop -- one after the other
    const bad = await call("PUT", `/api/dashboard/settings?serverId=${VISIBLE}`, { omnifmRadioAnnounce: { enabled: true, roleId } });
    assert.equal(bad.status, 400, roleId);
  }
  assert.equal((await call("PUT", `/api/dashboard/settings?serverId=${VISIBLE}`, { omnifmRadioAnnounce: { enabled: "false" } })).status, 400);

  // Where the bots' view has no roles, a role cannot be checked here: it is not refused (OmniFM 1 checks when posting).
  const unchecked = await call("PUT", `/api/dashboard/settings?serverId=${ROLELESS}`, { omnifmRadioAnnounce: { enabled: true, roleId: ROLE_LOW } });
  assert.notEqual(unchecked.status, 400, JSON.stringify(unchecked.payload));

  // Announcement channels (type 5) are offered for this card, the other pickers keep text channels only.
  const channels = await call("GET", `/api/dashboard/channels?serverId=${VISIBLE}`);
  assert.deepEqual(channels.payload.textChannels.map((channel) => channel.id), [SYSTEM]);
  assert.deepEqual(channels.payload.announcementChannels.map((channel) => channel.id), [NEWS]);

  if (!mongo) return;
  const saved = await call("PUT", `/api/dashboard/settings?serverId=${VISIBLE}`, { omnifmRadioAnnounce: { enabled: true, channelId: SYSTEM, roleId: ROLE_LOW } });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual([saved.payload.omnifmRadioAnnounce.channelId, saved.payload.omnifmRadioAnnounce.roleId], [SYSTEM, ROLE_LOW]);
  const off = await call("PUT", `/api/dashboard/settings?serverId=${VISIBLE}`, { omnifmRadioAnnounce: { enabled: false, channelId: "kaputt", roleId: "" } });
  assert.equal(off.payload.omnifmRadioAnnounce.enabled, false);
  assert.equal(off.payload.omnifmRadioAnnounce.channelId, "", "only Discord ids are kept");
  const again = await call("GET", `/api/dashboard/settings?serverId=${VISIBLE}`);
  assert.equal(again.payload.omnifmRadioAnnounce.enabled, false);
  const hiddenStored = await mongo.collection("guild_settings").findOne({ guildId: HIDDEN });
  assert.equal(hiddenStored?.timeZone, "Europe/Berlin", "the rest was saved");
  assert.equal(hiddenStored?.omnifmRadioAnnounce, undefined, "the radio part was left out");
  // A role deleted in Discord stays stored; saving anything else must still work.
  const DELETED_ROLE = "923456789012345678";
  await mongo.collection("guild_settings").updateOne({ guildId: VISIBLE }, { $set: { omnifmRadioAnnounce: { enabled: true, channelId: "", roleId: DELETED_ROLE } } });
  const keep = await call("PUT", `/api/dashboard/settings?serverId=${VISIBLE}`, { omnifmRadioAnnounce: { enabled: true, channelId: "", roleId: DELETED_ROLE }, serverTimeZone: "Europe/Berlin" });
  assert.equal(keep.status, 200, JSON.stringify(keep.payload));
  assert.equal(keep.payload.serverTimeZone.current, "Europe/Berlin");
  assert.equal(keep.payload.omnifmRadioAnnounce.roleId, DELETED_ROLE, "kept until someone picks another");
  const toEveryone = await call("PUT", `/api/dashboard/settings?serverId=${VISIBLE}`, { omnifmRadioAnnounce: { enabled: true, roleId: VISIBLE } });
  assert.equal(toEveryone.status, 400, "changing it to @everyone is refused");
  await mongo.collection("guild_settings").updateOne({ guildId: VISIBLE }, { $set: { omnifmRadioAnnounce: { enabled: false, channelId: "", roleId: "" } } });

  const stored = await mongo.collection("guild_settings").findOne({ guildId: VISIBLE });
  assert.deepEqual(stored.omnifmRadioAnnounce, { enabled: false, channelId: "", roleId: "" }, "what the commander reads");
});
