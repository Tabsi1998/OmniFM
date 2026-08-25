import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("FastAPI Mongo writes are consumed by the Discord runtime stores", async (t) => {
  if (!String(process.env.MONGO_URL || "").trim()) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-shared-stores-"));
  process.env.DB_NAME = `omnifm_shared_stores_${process.pid}_${Date.now()}`;
  process.env.OMNIFM_RUNTIME_DATA_DIR = runtimeDir;

  const dbModule = await import("../src/lib/db.js");
  const customStore = await import("../src/custom-stations.js");
  const permissionStore = await import("../src/command-permissions-store.js");
  const eventStore = await import("../src/scheduled-events-store.js");
  await dbModule.connect();
  const database = dbModule.getDb();
  const guildId = "123456789012345678";
  const roleId = "223456789012345678";
  const voiceChannelId = "323456789012345678";

  t.after(async () => {
    await Promise.all([
      customStore.stopCustomStationsStore(),
      permissionStore.stopCommandPermissionsStore(),
      eventStore.stopScheduledEventsStore(),
    ]);
    await database.dropDatabase().catch(() => null);
    await dbModule.close();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  await customStore.initCustomStationsStore({ refreshMs: 1000 });
  await permissionStore.initCommandPermissionsStore({ refreshMs: 1000 });
  await eventStore.initScheduledEventsStore({ refreshMs: 1000 });

  await database.collection("custom_stations").insertOne({
    guildId, key: "dashboard-radio", name: "Dashboard Radio", url: "https://radio.example/stream", genre: "Test",
  });
  await database.collection("command_permissions").insertOne({
    _guildId: guildId, guildId, commands: { play: { allowRoleIds: [roleId], denyRoleIds: [] } },
  });
  await database.collection("scheduled_events").insertOne({
    _eventId: "evt_dashboard",
    id: "evt_dashboard",
    guildId,
    botId: "bot-1",
    name: "Dashboard Event",
    stationKey: "groovesalad",
    voiceChannelId,
    repeat: "none",
    runAtMs: Date.now() + 3600000,
    durationMs: 60000,
    enabled: true,
    lastRunAtMs: 0,
    lastStopAtMs: 0,
    activeUntilMs: 0,
    deleteAfterStop: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(customStore.getGuildStations(guildId)["dashboard-radio"]?.name, "Dashboard Radio");
  assert.deepEqual(permissionStore.getCommandPermissionRule(guildId, "play").allowRoleIds, [roleId]);
  assert.equal(eventStore.listScheduledEvents({ guildId })[0]?.name, "Dashboard Event");

  assert.equal(customStore.removeGuildStation(guildId, "dashboard-radio"), true);
  const permissionResult = permissionStore.setCommandRolePermission(guildId, "stop", roleId, "allow");
  assert.equal(permissionResult.ok, true);
  const eventResult = eventStore.patchScheduledEvent("evt_dashboard", { enabled: false });
  assert.equal(eventResult.ok, true);
  await Promise.all([
    customStore.stopCustomStationsStore(),
    permissionStore.stopCommandPermissionsStore(),
    eventStore.stopScheduledEventsStore(),
  ]);

  assert.equal(await database.collection("custom_stations").countDocuments({ guildId, key: "dashboard-radio" }), 0);
  assert.deepEqual((await database.collection("command_permissions").findOne({ _guildId: guildId })).commands.stop.allowRoleIds, [roleId]);
  assert.equal((await database.collection("scheduled_events").findOne({ _eventId: "evt_dashboard" })).enabled, false);
});
