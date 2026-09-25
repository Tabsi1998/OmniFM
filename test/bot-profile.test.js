import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-bot-profile-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.OMNIFM_OWNER_AUDIT_FILE = path.join(scratchDir, "owner-audit.json");
process.env.DB_NAME = `omnifm_bot_profile_${process.pid}_${Date.now()}`;

const profile = await import("../src/lib/bot-profile.js");
const { createDashboardBotProfileRouteHandler } = await import("../src/api/routes/dashboard-bot-profile.js");
const { sendJson, methodNotAllowed } = await import("../src/lib/api-helpers.js");
const { getOwnerAuditSnapshot, resetOwnerAuditForTests } = await import("../src/lib/owner-audit-store.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { WorkerBridgeService } = await import("../src/bot/worker-bridge-service.js");
const { fitScale } = await import("../frontend/src/lib/profileImage.js");

const GUILD = "123456789012345678";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = Buffer.from("GIF89a....", "ascii");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const dataUrl = (buffer, mime = "image/png") => `data:${mime};base64,${buffer.toString("base64")}`;
let plan = "ultimate";
setLicenseProvider((serverId) => (String(serverId) === GUILD ? { plan, active: true, seats: 1 } : null));

test("pictures are checked by their first bytes, not by what they claim", () => {
  assert.equal(profile.detectImageType(PNG), "image/png");
  assert.equal(profile.detectImageType(JPEG), "image/jpeg");
  assert.equal(profile.detectImageType(GIF), "image/gif");
  assert.equal(profile.detectImageType(WEBP), "image/webp");
  assert.equal(profile.detectImageType(Buffer.from("<svg></svg>")), null);

  assert.equal(profile.parseProfileImage("no data url", 100).error, "invalid");
  assert.equal(profile.parseProfileImage(dataUrl(Buffer.from("<script>")), 100).error, "format", "a PNG label on text is refused");
  assert.equal(profile.parseProfileImage(dataUrl(PNG), 4).error, "size");
  const jpeg = profile.parseProfileImage(dataUrl(JPEG, "image/png"), 100);
  assert.equal(jpeg.mime, "image/jpeg", "the real type wins");
  assert.match(jpeg.dataUri, /^data:image\/jpeg;base64,/);
});

test("what the dashboard may send: a worker, pictures, a bio of at most 190 characters", () => {
  assert.equal(profile.validateBotProfileInput({ slot: 0 }).error, "slot");
  assert.deepEqual(profile.validateBotProfileInput({ slot: 2, reset: true }), { ok: true, slot: 2, reset: true, changes: { avatar: null, banner: null, bio: null } });
  assert.equal(profile.validateBotProfileInput({ slot: 1 }).error, "empty");
  assert.deepEqual(profile.validateBotProfileInput({ slot: 1, bio: "x".repeat(191) }), { ok: false, error: "size", field: "bio" });
  assert.deepEqual(profile.validateBotProfileInput({ slot: 1, banner: dataUrl(Buffer.from("text")) }), { ok: false, error: "format", field: "banner" });
  const ok = profile.validateBotProfileInput({ slot: 1, avatar: dataUrl(PNG), bio: "  Vereinsradio  " });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.changes), ["avatar", "bio"]);
  assert.equal(ok.changes.bio, "Vereinsradio");
  assert.equal(profile.validateBotProfileInput({ slot: 1, avatar: null }).changes.avatar, null, "null removes the picture");
});

test("what is stored, and at most three changes in ten minutes", () => {
  const stored = profile.summarizeProfileChange({}, { avatar: "data:..", bio: "Hi" }, { at: 0, by: "u1" });
  assert.deepEqual(stored, { avatar: true, banner: false, bio: "Hi", updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "u1" });
  assert.equal(profile.summarizeProfileChange(stored, { avatar: null, bio: null }), null, "nothing custom left");

  const limiter = profile.createProfileChangeLimiter();
  assert.equal(limiter.take("g:1", 0).ok, true);
  assert.equal(limiter.take("g:1", 1000).ok, true);
  assert.equal(limiter.take("g:1", 2000).ok, true);
  const refused = limiter.take("g:1", 3000);
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterMs, 10 * 60_000 - 3000);
  assert.equal(limiter.take("g:2", 3000).ok, true, "per worker and server");
  assert.equal(limiter.take("g:1", 10 * 60_000 + 1).ok, true, "after ten minutes again");
  assert.equal(fitScale(2048, 1024, { width: 512, height: 512 }), 0.25);
  assert.equal(fitScale(100, 100, { width: 512, height: 512 }), 1, "never larger");
});

// ---- the worker ----

function fakeWorker(slot, { fail = false } = {}) {
  const worker = Object.create(BotRuntime.prototype);
  worker.config = { name: `OmniFM ${slot}`, index: slot };
  worker.workerSlot = slot;
  worker.edits = [];
  worker.client = {
    guilds: {
      cache: new Map([[GUILD, {
        members: {
          me: { displayAvatarURL: () => `https://cdn.example/avatar-${slot}.png` },
          editMe: async (options) => {
            if (fail) throw Object.assign(new Error("You are changing your avatar too fast."), { code: 50035 });
            worker.edits.push(options);
            return { displayAvatarURL: () => "https://cdn.example/new.png" };
          },
        },
      }]]),
    },
  };
  return worker;
}

test("the worker sets only what was sent; Discord's refusal is passed on", async () => {
  const worker = fakeWorker(1);
  assert.deepEqual(await worker.applyGuildBotProfile(GUILD, { bio: "Hi" }), { ok: true, avatarUrl: "https://cdn.example/new.png" });
  assert.equal(worker.edits[0].bio, "Hi");
  assert.equal("avatar" in worker.edits[0], false, "the avatar is left alone");
  assert.match(worker.edits[0].reason, /#280/);
  const refused = await fakeWorker(2, { fail: true }).applyGuildBotProfile(GUILD, { avatar: null });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /too fast/);
  assert.equal(await fakeWorker(3).applyGuildBotProfile("999999999999999999", {}).then((r) => r.error), "guild_unavailable");
});

test("split mode: the picture reaches the worker process through the bridge", async () => {
  const calls = [];
  const service = new WorkerBridgeService({ config: { id: "w" }, applyGuildBotProfile: async (...args) => { calls.push(args); return { ok: true }; } },
    { bridge: {}, doorbell: { isDoorbellConnected: () => false, onDoorbell: () => () => {} } });
  await service.executeCommand({ type: "setGuildProfile", payload: { guildId: GUILD, changes: { bio: "Hi" } } });
  assert.deepEqual(calls, [[GUILD, { bio: "Hi" }]]);
});

// ---- the dashboard route ----

function routeWith(workers, invitedSlots = workers.map((worker) => worker.workerSlot)) {
  const commander = {
    role: "commander",
    workerManager: {
      workers,
      getInvitedWorkers: () => workers.filter((worker) => invitedSlots.includes(worker.workerSlot)),
      getWorkerByIndex: (slot) => workers.find((worker) => worker.workerSlot === slot) || null,
      getWorkerSlot: (worker) => worker.workerSlot,
    },
  };
  const handle = createDashboardBotProfileRouteHandler({
    getDashboardRequestTranslator: () => ({ language: "de" }),
    getDashboardSession: () => ({ session: { user: { id: "user-7" } } }),
    getLocalizedJsonBodyError: () => "bad body",
    languagePick: (language, de) => de,
    methodNotAllowed,
    resolveDashboardGuildForSession: () => ({ id: GUILD, tier: plan }),
    sendJson,
    sendLocalizedError: (res, status, language, de) => sendJson(res, status, { error: de }),
  });
  return async (method, body) => {
    const res = { status: 0, body: null, writeHead(status) { this.status = status; }, setHeader() {}, end(text) { this.body = text ? JSON.parse(text) : null; } };
    await handle({
      req: { method, headers: {} },
      res,
      requestUrl: new URL(`http://localhost/api/dashboard/bot-profile?serverId=${GUILD}`),
      readJsonBody: async () => body,
      runtimes: [commander],
    });
    return res;
  };
}

test("the dashboard: only Ultimate, only invited workers, clear refusals, every change audited", async () => {
  resetOwnerAuditForTests();
  const worker = fakeWorker(1);
  const other = fakeWorker(2);
  const call = routeWith([worker, other], [1]);

  const listed = await call("GET");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.available, true);
  assert.deepEqual(listed.body.workers.map((entry) => [entry.slot, entry.avatarUrl]), [[1, "https://cdn.example/avatar-1.png"]]);

  assert.match((await call("PUT", { slot: 1, avatar: dataUrl(Buffer.from("nope")) })).body.error, /PNG, JPG, GIF und WebP/);
  assert.equal((await call("PUT", { slot: 2, bio: "Hi" })).status, 404, "a worker that is not on the server");

  const saved = await call("PUT", { slot: 1, avatar: dataUrl(PNG), bio: "Vereinsradio" });
  assert.equal(saved.status, 200);
  assert.equal(worker.edits.length, 1);
  assert.match(worker.edits[0].avatar, /^data:image\/png;base64,/);
  assert.deepEqual(saved.body.workers[0].custom, { avatar: true, banner: false, bio: "Vereinsradio" });
  const [audit] = getOwnerAuditSnapshot({ limit: 5 }).events;
  assert.equal(audit.action, "guild.botProfile.update");
  assert.equal(audit.actor, "dashboard:user-7");
  assert.equal(audit.target, `${GUILD}/worker-1`);

  await call("PUT", { slot: 1, bio: "Zwei" });
  await call("PUT", { slot: 1, reset: true });
  const tooFast = await call("PUT", { slot: 1, bio: "Vier" });
  assert.equal(tooFast.status, 429);
  assert.match(tooFast.body.error, /nur wenige Änderungen/);

  plan = "pro";
  const locked = await call("PUT", { slot: 1, bio: "Hi" });
  assert.equal(locked.status, 403);
  assert.equal((await call("GET")).body.available, false);
  plan = "ultimate";
});

test("a server that leaves Ultimate gets the default look back", async (t) => {
  if (!String(process.env.MONGO_URL || "").trim()) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const dbModule = await import("../src/lib/db.js");
  await dbModule.connect();
  const database = dbModule.getDb();
  t.after(async () => {
    await database.dropDatabase().catch(() => null);
    await dbModule.close();
  });
  resetOwnerAuditForTests();
  const ULTIMATE_GUILD = "223456789012345678";
  setLicenseProvider((serverId) => (String(serverId) === ULTIMATE_GUILD ? { plan: "ultimate", active: true, seats: 1 } : null));
  t.after(() => setLicenseProvider((serverId) => (String(serverId) === GUILD ? { plan, active: true, seats: 1 } : null)));
  const settings = database.collection("guild_settings");
  await settings.insertMany([
    { guildId: GUILD, botProfiles: { 1: { avatar: true, banner: false, bio: "Alt" } } },
    { guildId: ULTIMATE_GUILD, botProfiles: { 1: { avatar: true } } },
  ]);
  const resets = [];
  const worker = { applyGuildBotProfile: async (guildId, changes) => { resets.push([guildId, changes]); return { ok: true }; } };
  const commander = Object.create(BotRuntime.prototype);
  commander.role = "commander";
  commander.config = { name: "Commander" };
  commander.workerManager = { getWorkerByIndex: () => worker };

  assert.deepEqual(await commander.resetBotProfilesAfterDowngrade(), [GUILD]);
  assert.deepEqual(resets, [[GUILD, { avatar: null, banner: null, bio: null }]]);
  assert.equal("botProfiles" in await settings.findOne({ guildId: GUILD }), false);
  assert.ok((await settings.findOne({ guildId: ULTIMATE_GUILD })).botProfiles, "Ultimate keeps its look");
  assert.equal(getOwnerAuditSnapshot({ limit: 5 }).events[0].metadata.reason, "downgrade");
});
