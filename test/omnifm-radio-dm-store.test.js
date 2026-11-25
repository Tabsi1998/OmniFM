import test, { after } from "node:test";
import assert from "node:assert/strict";

// OmniFM Radio DMs (#594): what OmniFM keeps per person. Unsubscribed for
// good, subscribed (opt-in), the last DM (12 h) and the last test DM
// (10 min) counted apart, closed DMs left alone for a while. The same rules
// in memory and in MongoDB; a claim is atomic, so one person never gets two.
import { OMNIFM_RADIO_DM_COLLECTION, createOmnifmRadioDmStore } from "../src/omnifm-radio-dm-store.js";

const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-25T20:00:00Z");
const REAL = { quota: "real", windowMs: 12 * HOUR };
const TEST = { quota: "test", windowMs: 10 * MINUTE };

let userCounter = 0;
const nextUser = () => String(300000000000000000n + BigInt((userCounter += 1)));

after(async () => {
  if (!hasMongoConfig) return;
  const { close } = await import("../src/lib/db.js");
  await close().catch(() => null);
});

async function mongoStore() {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  return createOmnifmRadioDmStore({ getDatabase: () => getDb(), mongoRequested: () => true });
}

const backends = [
  ["memory", async () => createOmnifmRadioDmStore({ getDatabase: () => null, mongoRequested: () => false }), {}],
  ["MongoDB", mongoStore, { skip: !hasMongoConfig }],
];

for (const [name, make, options] of backends) {
  test(`${name}: one DM per person in 12 hours`, options, async () => {
    const store = await make();
    const user = nextUser();
    assert.equal(await store.claim(user, { ...REAL, now: T0 }), true, "the first DM");
    assert.equal(await store.claim(user, { ...REAL, now: T0 + 11 * HOUR }), false, "11 hours later: no");
    assert.equal(await store.claim(user, { ...REAL, now: T0 + 12 * HOUR }), true, "12 hours later: yes");
    assert.equal((await store.get(user)).lastDmAt, T0 + 12 * HOUR);
  });

  test(`${name}: a test DM has its own short quota and leaves the real one alone`, options, async () => {
    const store = await make();
    const user = nextUser();
    assert.equal(await store.claim(user, { ...TEST, now: T0 }), true);
    assert.equal(await store.claim(user, { ...TEST, now: T0 + 9 * MINUTE }), false);
    assert.equal(await store.claim(user, { ...REAL, now: T0 + 9 * MINUTE }), true, "a test DM uses no real quota");
    assert.equal(await store.claim(user, { ...TEST, now: T0 + 10 * MINUTE }), true, "and a real DM no test quota");
    const person = await store.get(user);
    assert.equal(person.lastDmAt, T0 + 9 * MINUTE);
    assert.equal(person.lastTestDmAt, T0 + 10 * MINUTE);
  });

  test(`${name}: unsubscribed stays unsubscribed until the person subscribes again`, options, async () => {
    const store = await make();
    const user = nextUser();
    await store.setSubscribed(user, false, { now: T0 });
    assert.equal(await store.claim(user, { ...REAL, now: T0 + 30 * DAY }), false);
    assert.equal(await store.claim(user, { ...TEST, now: T0 + 30 * DAY }), false, "no test DM either");
    assert.deepEqual(
      { unsubscribed: (await store.get(user)).unsubscribed, subscribed: (await store.get(user)).subscribed },
      { unsubscribed: true, subscribed: false },
    );
    await store.setSubscribed(user, true, { now: T0 + 31 * DAY });
    assert.equal(await store.claim(user, { ...REAL, now: T0 + 31 * DAY }), true);
  });

  test(`${name}: opt-in reaches only who subscribed, and creates nobody`, options, async () => {
    const store = await make();
    const stranger = nextUser();
    const fan = nextUser();
    assert.equal(await store.claim(stranger, { ...REAL, now: T0, subscribedOnly: true }), false);
    assert.equal(await store.get(stranger), null, "a refused opt-in claim stores nothing");
    await store.setSubscribed(fan, true, { now: T0 });
    assert.equal(await store.claim(fan, { ...REAL, now: T0, subscribedOnly: true }), true);
    assert.equal(await store.claim(fan, { ...REAL, now: T0 + HOUR, subscribedOnly: true }), false, "12 hours in opt-in too");
  });

  test(`${name}: closed DMs are left alone until the given time`, options, async () => {
    const store = await make();
    const user = nextUser();
    await store.markDmsClosed(user, { until: T0 + 30 * DAY });
    assert.equal(await store.claim(user, { ...REAL, now: T0 + 29 * DAY }), false);
    assert.equal(await store.claim(user, { ...TEST, now: T0 + 29 * DAY }), false);
    assert.equal(await store.claim(user, { ...REAL, now: T0 + 30 * DAY }), true);
  });

  test(`${name}: the last run is kept`, options, async () => {
    const store = await make();
    const run = { test: false, total: 3, sent: 1, skipped: 1, failed: 0, remaining: 1, stoppedBy: "end", startedAt: "2026-11-25T20:00:00.000Z" };
    await store.saveLastRun(run);
    assert.deepEqual(await store.loadLastRun(), run);
  });

  test(`${name}: /mydata: forgetting a person keeps only an unsubscribe`, options, async () => {
    const store = await make();
    const fan = nextUser();
    const quitter = nextUser();
    await store.claim(fan, { ...REAL, now: T0 });
    await store.markDmsClosed(fan, { until: T0 + 30 * DAY });
    await store.claim(quitter, { ...TEST, now: T0 });
    await store.setSubscribed(quitter, false, { now: T0 + HOUR });
    assert.equal((await store.get(quitter)).unsubscribedAt, T0 + HOUR, "the export can say since when");

    assert.deepEqual(await store.forget(fan), { found: true, keptUnsubscribe: false });
    assert.equal(await store.get(fan), null, "nothing left of someone who never unsubscribed");
    assert.deepEqual(await store.forget(quitter), { found: true, keptUnsubscribe: true });
    assert.deepEqual(await store.get(quitter), {
      unsubscribed: true, subscribed: false, lastDmAt: null, lastTestDmAt: null, dmClosedUntil: null, unsubscribedAt: null, subscribedAt: null,
    }, "only the opt-out stays, no times");
    assert.equal(await store.claim(quitter, { ...REAL, now: T0 + 2 * DAY }), false, "and it is still honoured");
    assert.deepEqual(await store.forget(nextUser()), { found: false, keptUnsubscribe: false });
  });
}

test("MongoDB: the kept opt-out is the Discord ID and one flag, nothing else", { skip: !hasMongoConfig }, async () => {
  const store = await mongoStore();
  const user = nextUser();
  await store.claim(user, { ...REAL, now: T0 });
  await store.setSubscribed(user, false, { now: T0 });
  await store.forget(user);
  const { getDb } = await import("../src/lib/db.js");
  assert.deepEqual(await getDb().collection(OMNIFM_RADIO_DM_COLLECTION).findOne({ _id: user }), { _id: user, unsubscribed: true });
});

test("MongoDB: ten claims at once for one person, exactly one wins", { skip: !hasMongoConfig }, async () => {
  const store = await mongoStore();
  const user = nextUser();
  const results = await Promise.all(Array.from({ length: 10 }, () => store.claim(user, { ...REAL, now: T0 })));
  assert.equal(results.filter(Boolean).length, 1);
});

test("MongoDB: a restart keeps the 12 hours", { skip: !hasMongoConfig }, async () => {
  const user = nextUser();
  assert.equal(await (await mongoStore()).claim(user, { ...REAL, now: T0 }), true);
  const afterRestart = await mongoStore();
  assert.equal(await afterRestart.claim(user, { ...REAL, now: T0 + HOUR }), false);
  const { getDb } = await import("../src/lib/db.js");
  const doc = await getDb().collection(OMNIFM_RADIO_DM_COLLECTION).findOne({ _id: user });
  assert.ok(doc.lastDmAt instanceof Date, "times are stored as dates");
});

test("a MongoDB that is configured but not connected is an error, never a free pass", async () => {
  const store = createOmnifmRadioDmStore({ getDatabase: () => null, mongoRequested: () => true });
  await assert.rejects(store.claim(nextUser(), { ...REAL, now: T0 }), /MongoDB/);
  await assert.rejects(store.setSubscribed(nextUser(), false, { now: T0 }), /MongoDB/);
});

test("only Discord IDs are stored", async () => {
  const store = createOmnifmRadioDmStore({ getDatabase: () => null, mongoRequested: () => false });
  assert.equal(await store.claim("last-run", { ...REAL, now: T0 }), false);
  assert.equal(await store.claim("", { ...REAL, now: T0 }), false);
  await assert.rejects(store.setSubscribed("abc", false, { now: T0 }), /Discord-ID/);
  assert.equal(await store.get("abc"), null);
});
