import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";

import { compareCounts, parseDumpLog, runRestoreCheck } from "../scripts/verify-mongo-backup.mjs";

const DUMP_LOG = `2026-09-24T04:15:01.100+0000\twriting omnifm.licenses to archive 'x'
2026-09-24T04:15:01.200+0000\tdone dumping omnifm.licenses (3 documents)
2026-09-24T04:15:01.300+0000\tdone dumping omnifm.guild_stats (1 document)
2026-09-24T04:15:01.400+0000\tdone dumping other.stuff (9 documents)
`;

test("the dump log gives the document count of every collection", () => {
  assert.deepEqual(parseDumpLog(DUMP_LOG, "omnifm"), { licenses: 3, guild_stats: 1 });
});

test("missing collections and different counts are reported", () => {
  assert.deepEqual(compareCounts({ a: 2, b: 1 }, { a: 2, b: 1, c: 5 }), []);
  assert.deepEqual(compareCounts({ a: 2, b: 1 }, { a: 1 }), [
    "a: 1 documents restored, 2 dumped",
    "b: missing in the restored copy",
  ]);
});

test("the restore check never runs against the production database", async () => {
  await assert.rejects(
    runRestoreCheck({ archive: "x", mongoUrl: "mongodb://127.0.0.1:1", dbName: "omnifm", scratchName: "omnifm" }),
    /must differ/,
  );
});

test("a restored copy is compared with the dump and dropped afterwards", async (t) => {
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const dbName = `omnifm_restorecheck_test_${process.pid}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-restore-check-"));
  const archive = path.join(directory, "mongodb-test.archive.gz");
  fs.writeFileSync(archive, "not read: the restore is simulated");
  fs.writeFileSync(`${archive}.log`, DUMP_LOG.replaceAll("omnifm.", `${dbName}.`));
  const client = new MongoClient(mongoUrl);
  await client.connect();
  t.after(async () => {
    await client.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // Stands in for mongorestore: fills the scratch database like a restore.
  const restoreWith = (licenses) => async ({ scratchName }) => {
    const scratch = client.db(scratchName);
    await scratch.collection("licenses").insertMany(Array.from({ length: licenses }, (_, index) => ({ index })));
    await scratch.collection("guild_stats").insertOne({ guildId: "1" });
  };

  const good = await runRestoreCheck({ archive, mongoUrl, dbName, restore: restoreWith(3) });
  assert.equal(good.ok, true, good.problems.join("; "));
  assert.equal(good.comparedWithDumpLog, true);
  assert.equal(good.documents, 4);

  const bad = await runRestoreCheck({ archive, mongoUrl, dbName, restore: restoreWith(2) });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems, ["licenses: 2 documents restored, 3 dumped"]);

  const databases = (await client.db().admin().listDatabases()).databases.map((entry) => entry.name);
  assert.ok(!databases.includes(`${dbName}_restorecheck`), "the scratch database is dropped");
});
