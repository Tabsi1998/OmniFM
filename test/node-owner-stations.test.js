import test from "node:test";
import assert from "node:assert/strict";

const stations = await import("../src/lib/owner-stations.js");

const PUBLIC_URL = "http://93.184.216.34/stream";

// A tiny in-memory MongoDB: equality, $in and $not regex are all these routes use.
function memoryDb(seed = {}) {
  const data = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const matches = (row, query = {}) => Object.entries(query).every(([field, rule]) => {
    const value = row[field];
    if (rule && typeof rule === "object" && !(rule instanceof RegExp)) {
      if (rule.$in) return rule.$in.includes(value);
      if (rule.$not) return !rule.$not.test(String(value ?? ""));
    }
    return value === rule;
  });
  const cursor = (rows) => ({
    sort: (order) => cursor([...rows].sort((a, b) => {
      for (const [field, direction] of Object.entries(order)) {
        const diff = String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
        if (diff) return diff * direction;
      }
      return 0;
    })),
    limit: (count) => cursor(rows.slice(0, count)),
    toArray: async () => rows.map((row) => ({ ...row })),
  });
  return {
    data,
    collection: (name) => {
      data[name] ||= [];
      const rows = data[name];
      return {
        find: (query) => cursor(rows.filter((row) => matches(row, query))),
        findOne: async (query) => {
          const row = rows.find((entry) => matches(entry, query));
          return row ? { ...row } : null;
        },
        insertOne: async (doc) => { rows.push({ ...doc }); return { insertedId: rows.length }; },
        updateOne: async (query, update, { upsert } = {}) => {
          const row = rows.find((entry) => matches(entry, query));
          if (row) Object.assign(row, update.$set);
          else if (upsert) rows.push({ ...query, ...update.$set });
        },
      };
    },
  };
}

const fakeResponse = (status, headers = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  body: { cancel: async () => {} },
});

test("station documents follow FastAPI's rules and keep the catalogue fields", async () => {
  const doc = await stations.buildStationDocument({
    key: "Lounge.FM", name: "  Lounge FM ", url: PUBLIC_URL, tier: "PRO",
    color: "a1b2c3", logo: "https://cdn.example/logo.png", homepage: "http://insecure.example", country: "AT",
  });
  assert.deepEqual(doc, {
    key: "lounge.fm", name: "Lounge FM", url: PUBLIC_URL, tier: "pro", genre: "Radio",
    country: "AT", language: "", color: "#A1B2C3", logo: "https://cdn.example/logo.png", homepage: "",
  });

  const refused = async (body) => {
    try {
      await stations.buildStationDocument({ key: "ok-key", name: "Name", url: PUBLIC_URL, ...body });
    } catch (err) {
      assert.ok(err instanceof stations.OwnerStationError);
      return [err.status, err.message];
    }
    return null;
  };
  assert.deepEqual(await refused({ key: "x" }), [400, "Ungültiger Key (a-z, 0-9, . _ -, 2-49 Zeichen)."]);
  assert.deepEqual(await refused({ name: "" }), [400, "Name erforderlich."]);
  assert.deepEqual(await refused({ tier: "gold" }), [400, "Tier muss free, pro oder ultimate sein."]);
  assert.equal((await refused({ url: "http://127.0.0.1/stream" }))[0], 400, "no local hosts");
  assert.equal((await refused({ url: "http://user:pw@93.184.216.34/" }))[1], "URLs mit Benutzername/Passwort sind nicht erlaubt.");
  assert.equal((await refused({ url: "ftp://93.184.216.34/" }))[0], 400);
});

test("the stream test tells audio, a plain page and a timeout apart", async () => {
  const audio = await stations.testStationStream(PUBLIC_URL, { fetchImpl: async () => fakeResponse(200, { "content-type": "audio/mpeg", "icy-name": "Lounge", "icy-br": "128" }) });
  assert.equal(audio.ok, true);
  assert.equal(audio.icyName, "Lounge");
  assert.equal(audio.bitrate, "128");
  assert.equal(audio.message, "Stream erreichbar und liefert Audio.");

  const page = await stations.testStationStream(PUBLIC_URL, { fetchImpl: async () => fakeResponse(200, { "content-type": "text/html" }) });
  assert.deepEqual([page.ok, page.reachable, page.message], [false, true, "Erreichbar, aber kein eindeutiger Audio-Stream."]);

  const timeout = await stations.testStationStream(PUBLIC_URL, {
    fetchImpl: async () => { throw Object.assign(new Error("slow"), { code: "OUTBOUND_TIMEOUT" }); },
  });
  assert.equal(timeout.message, "Zeitüberschreitung – Stream nicht erreichbar.");

  await assert.rejects(stations.testStationStream("http://localhost/stream"), (err) => err.status === 400);
});

test("the list shows each station's health and counts only confirmed outages", async () => {
  const db = memoryDb({
    stations: [
      { key: "b", name: "Beta", url: "u", tier: "pro" },
      { key: "a", name: "Alpha", url: "u", tier: "free", is_default: true },
      { key: "custom:1:x", name: "Private", url: "u", tier: "ultimate" },
      { key: "c", name: "Gamma", url: "u", tier: "free" },
    ],
    station_health: [
      { key: "a", status: "up" },
      { key: "b", status: "down", consecutiveFailures: 1 },
      { key: "c", status: "down", consecutiveFailures: 3 },
    ],
  });
  const list = await stations.stationListResponse(db, { enabled: false, intervalMs: 500, batchSize: 50 });
  assert.deepEqual(list.stations.map((row) => row.key), ["a", "c", "b"], "tier, then name; no custom stations");
  assert.equal(list.stations[0].isDefault, true);
  assert.deepEqual(list.healthSummary, { automatic: false, intervalMs: 2000, batchSize: 10, checked: 3, up: 1, down: 1, pending: 0 });
});

test("the health run stores the result and raises an incident on the second failure", async () => {
  const db = memoryDb({
    stations: [{ key: "a", url: "http://a" }, { key: "b", url: "http://b" }],
    station_health: [{ key: "a", status: "down", consecutiveFailures: 1 }, { key: "b", status: "down", consecutiveFailures: 4 }],
  });
  const probe = async (url) => (url === "http://a"
    ? { ok: false, reachable: false, discordOk: false, status: 0, latencyMs: 5, message: "timeout", timedOut: true, reason: "x" }
    : { ok: true, reachable: true, discordOk: true, status: 200, latencyMs: 40, contentType: "audio/mpeg" });
  const run = await stations.runStationHealth(db, [], { probe, now: () => Date.parse("2026-09-25T12:00:00Z") });

  assert.equal(run.count, 2);
  assert.equal(run.truncated, false);
  const [a, b] = ["a", "b"].map((key) => db.data.station_health.find((row) => row.key === key));
  assert.deepEqual([a.status, a.consecutiveFailures, a.error], ["down", 2, "timeout"]);
  assert.equal(Object.hasOwn(a, "timedOut"), false);
  assert.deepEqual([b.status, b.consecutiveFailures, b.consecutiveSuccesses, b.responseTimeMs], ["up", 0, 1, 40]);
  assert.equal(Object.hasOwn(b, "contentType"), false, "only FastAPI's probe fields reach the health document");
  assert.deepEqual(db.data.runtime_incidents.map((row) => [row.severity, row.message, row.resolved]), [
    ["warning", "Sender a ist offline: timeout", false],
    ["info", "Sender b ist wieder erreichbar", true],
  ]);

  const many = Array.from({ length: 30 }, (_, index) => `k${index}`);
  assert.equal((await stations.runStationHealth(db, many, { probe })).truncated, true);
});
