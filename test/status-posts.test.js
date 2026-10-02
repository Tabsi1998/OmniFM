import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType } from "discord.js";

// The status page in Discord (#478): one post per incident, maintenance or
// outage in the owner's channel; changes edit it, the end gets one reply,
// a restart sends nothing twice, and nothing goes to any other channel.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-status-posts-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { normalizeStatusPostSettings, renderStatusPost, statusPostItems, syncStatusPosts } = await import("../src/services/status-posts.js");

const CHANNEL = "123456789012345678";
const MINUTE = 60_000;
const NOW = Date.parse("2026-10-02T12:00:00Z");

// ---- a MongoDB of a few collections in memory ----
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([key, expected]) => {
    if (key === "$or") return expected.some((part) => matches(doc, part));
    const value = doc[key];
    if (expected === null) return value === null || value === undefined;
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("$gte" in expected) return value instanceof Date && value >= expected.$gte;
    }
    return value instanceof Date && expected instanceof Date ? value.getTime() === expected.getTime() : value === expected;
  });
}

function fakeDb(initial = {}) {
  const data = new Map(Object.entries(initial).map(([name, docs]) => [name, docs.map((doc) => ({ ...doc }))]));
  const docs = (name) => {
    if (!data.has(name)) data.set(name, []);
    return data.get(name);
  };
  return {
    data,
    collection(name) {
      return {
        find: (filter) => ({ toArray: async () => docs(name).filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) }),
        findOne: async (filter) => {
          const found = docs(name).find((doc) => matches(doc, filter));
          return found ? { ...found } : null;
        },
        insertOne: async (doc) => {
          if (docs(name).some((entry) => entry._id === doc._id)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
          docs(name).push({ ...doc });
          return { insertedId: doc._id };
        },
        updateOne: async (filter, update) => {
          const found = docs(name).find((doc) => matches(doc, filter));
          if (!found) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(found, update.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        },
        deleteOne: async (filter) => {
          const list = docs(name);
          const index = list.findIndex((doc) => matches(doc, filter));
          if (index >= 0) list.splice(index, 1);
          return { deletedCount: index >= 0 ? 1 : 0 };
        },
      };
    },
  };
}

// ---- a Discord channel that remembers what it got ----
function fakeRuntime({ type = ChannelType.GuildText, reachable = true } = {}) {
  const messages = new Map();
  const channel = {
    id: CHANNEL,
    type,
    sent: [],
    crossposted: [],
    isTextBased: () => true,
    async send(payload) {
      this.sent.push(payload);
      const message = {
        id: `m${this.sent.length}`,
        payload,
        edits: [],
        async edit(next) { this.edits.push(next); return this; },
        crosspost: async () => { channel.crossposted.push(message.id); },
      };
      messages.set(message.id, message);
      return message;
    },
    messages: {
      async fetch(id) {
        if (!messages.has(id)) throw Object.assign(new Error("Unknown Message"), { code: 10008 });
        return messages.get(id);
      },
    },
  };
  const fetched = [];
  return {
    channel,
    messages,
    fetched,
    client: { channels: { fetch: async (id) => { fetched.push(id); return reachable && id === CHANNEL ? channel : null; } } },
  };
}

const ON = { statusPosts: { postEnabled: true, channelId: CHANNEL, language: "de" } };
const incident = (patch = {}) => ({ _id: "n1", kind: "incident", title: "Sender starten verzögert", message: "Wir prüfen das.", impact: "minor", startsAt: new Date(NOW - MINUTE), endsAt: null, resolvedAt: null, ...patch });

test("a new incident is one post in the owner's channel; a change edits it; resolving edits it and replies once", async () => {
  const db = fakeDb({ status_notices: [incident()] });
  const runtime = fakeRuntime();
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW, raw: ON }), { posted: 1, edited: 0, replied: 0 });
  const [first] = runtime.channel.sent;
  assert.equal(first.embeds[0].title, "🟠 Störung: Sender starten verzögert");
  assert.equal(first.embeds[0].description, "Wir prüfen das.");
  assert.match(first.embeds[0].url, /\/status/);
  assert.deepEqual(first.allowedMentions, { parse: [] }, "nobody is pinged, whatever the text says");

  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW + MINUTE, raw: ON }), { posted: 0, edited: 0, replied: 0 }, "nothing changed, nothing sent");

  db.data.get("status_notices")[0].title = "Sender starten wieder normal";
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW + 2 * MINUTE, raw: ON }), { posted: 0, edited: 1, replied: 0 });
  const message = runtime.messages.get("m1");
  assert.equal(message.edits[0].embeds[0].title, "🟠 Störung: Sender starten wieder normal");
  assert.equal(runtime.channel.sent.length, 1, "a change is no new post");

  db.data.get("status_notices")[0].resolvedAt = new Date(NOW + 3 * MINUTE);
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW + 3 * MINUTE, raw: ON }), { posted: 0, edited: 1, replied: 1 });
  assert.equal(message.edits[1].embeds[0].title, "✅ Behoben: Sender starten wieder normal");
  const reply = runtime.channel.sent[1];
  assert.equal(reply.content, "✅ Behoben: Sender starten wieder normal");
  assert.equal(reply.reply.messageReference, "m1");
  assert.deepEqual(reply.allowedMentions, { parse: [] });

  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW + 4 * MINUTE, raw: ON }), { posted: 0, edited: 0, replied: 0 }, "one reply only");
});

test("after a restart nothing is sent twice, not even a post whose sending was cut off", async () => {
  const db = fakeDb({ status_notices: [incident(), incident({ _id: "n2", title: "Zweite Störung" })] });
  const before = fakeRuntime();
  await syncStatusPosts(before, { db, now: NOW, raw: ON });
  assert.equal(before.channel.sent.length, 2);
  // A send that never stored its message ID: claimed, so never sent again.
  db.data.get("status_posts").find((doc) => doc._id === "notice:n2").messageId = null;
  const after = fakeRuntime();
  assert.deepEqual(await syncStatusPosts(after, { db, now: NOW + MINUTE, raw: ON }), { posted: 0, edited: 0, replied: 0 });
  assert.equal(after.channel.sent.length, 0);
});

test("without the switch or a reachable channel nothing happens, and no post goes to another channel", async () => {
  const db = fakeDb({ status_notices: [incident()] });
  const runtime = fakeRuntime();
  assert.equal((await syncStatusPosts(runtime, { db, now: NOW, raw: { statusPosts: { postEnabled: false, channelId: CHANNEL } } })).reason, "off");
  assert.equal((await syncStatusPosts(runtime, { db, now: NOW, raw: { statusPosts: { postEnabled: true, channelId: "not-an-id" } } })).reason, "off");
  assert.equal((await syncStatusPosts(runtime, { db, now: NOW, raw: {} })).reason, "off", "nothing set: off");
  assert.equal(runtime.fetched.length, 0, "with the switch off no channel is even looked up");

  const unreachable = fakeRuntime({ reachable: false });
  assert.deepEqual(await syncStatusPosts(unreachable, { db, now: NOW, raw: ON }), { posted: 0, edited: 0, replied: 0 });
  assert.equal(db.data.get("status_posts")?.length || 0, 0, "no claim left behind; the post comes once the channel is there");

  await syncStatusPosts(runtime, { db, now: NOW, raw: ON });
  assert.deepEqual([...new Set(runtime.fetched)], [CHANNEL], "only the owner's channel");
});

test("an outage counts from 2 minutes on, like on the status page; back again edits the post and replies", async () => {
  const db = fakeDb({ status_outages: [{ bot: "worker-3", name: "OmniFM 3", startedAt: new Date(NOW - MINUTE), endedAt: null }] });
  const runtime = fakeRuntime();
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW, raw: ON }), { posted: 0, edited: 0, replied: 0 }, "a minute is no outage yet");
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW + MINUTE, raw: ON }), { posted: 1, edited: 0, replied: 0 });
  assert.equal(runtime.channel.sent[0].embeds[0].title, "🔴 OmniFM 3 ist nicht erreichbar");
  db.data.get("status_outages")[0].endedAt = new Date(NOW + 5 * MINUTE);
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW + 5 * MINUTE, raw: ON }), { posted: 0, edited: 1, replied: 1 });
  assert.equal(runtime.channel.sent[1].content, "✅ OmniFM 3 ist wieder erreichbar");

  const blip = fakeDb({ status_outages: [{ bot: "worker-2", name: "OmniFM 2", startedAt: new Date(NOW - 90_000), endedAt: new Date(NOW) }] });
  assert.equal((await statusPostItems(blip, { now: NOW })).length, 0, "a short blip the page does not show gets no post");
});

test("what was over before it could be posted gets no post", async () => {
  const db = fakeDb({
    status_notices: [incident({ resolvedAt: new Date(NOW - 10_000) })],
    status_outages: [{ bot: "worker-1", name: "OmniFM 1", startedAt: new Date(NOW - 30 * MINUTE), endedAt: new Date(NOW - 20 * MINUTE) }],
  });
  const runtime = fakeRuntime();
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW, raw: ON }), { posted: 0, edited: 0, replied: 0 });
});

test("maintenance: planned, in progress, completed in the same post", async () => {
  const db = fakeDb({ status_notices: [{ _id: "w1", kind: "maintenance", title: "Server-Update", message: "", impact: "maintenance", startsAt: new Date(NOW + 60 * MINUTE), endsAt: new Date(NOW + 90 * MINUTE), resolvedAt: null }] });
  const runtime = fakeRuntime();
  await syncStatusPosts(runtime, { db, now: NOW, raw: ON });
  assert.equal(runtime.channel.sent[0].embeds[0].title, "🛠️ Wartung geplant: Server-Update");
  assert.equal(runtime.channel.sent[0].embeds[0].description, undefined, "no text: no description");
  await syncStatusPosts(runtime, { db, now: NOW + 61 * MINUTE, raw: ON });
  assert.equal(runtime.messages.get("m1").edits[0].embeds[0].title, "🛠️ Wartung läuft: Server-Update");
  assert.deepEqual(await syncStatusPosts(runtime, { db, now: NOW + 91 * MINUTE, raw: ON }), { posted: 0, edited: 1, replied: 1 });
  assert.equal(runtime.messages.get("m1").edits[1].embeds[0].title, "✅ Wartung beendet: Server-Update");
});

test("an announcement channel publishes the post for the servers that follow it", async () => {
  const db = fakeDb({ status_notices: [incident()] });
  const runtime = fakeRuntime({ type: ChannelType.GuildAnnouncement });
  await syncStatusPosts(runtime, { db, now: NOW, raw: ON });
  assert.deepEqual(runtime.channel.crossposted, ["m1"]);
});

test("a post someone deleted stays deleted", async () => {
  const db = fakeDb({ status_notices: [incident()] });
  const runtime = fakeRuntime();
  await syncStatusPosts(runtime, { db, now: NOW, raw: ON });
  runtime.messages.delete("m1");
  db.data.get("status_notices")[0].title = "Neuer Titel";
  await syncStatusPosts(runtime, { db, now: NOW + MINUTE, raw: ON });
  db.data.get("status_notices")[0].resolvedAt = new Date(NOW + 2 * MINUTE);
  await syncStatusPosts(runtime, { db, now: NOW + 2 * MINUTE, raw: ON });
  assert.equal(runtime.channel.sent.length, 1, "no new post, no reply to a post that is gone");
  assert.equal(db.data.get("status_posts")[0].gone, true);
});

test("the settings: a channel ID only, the switch only with one, one of the bot's nine languages", () => {
  assert.deepEqual(normalizeStatusPostSettings({ postEnabled: true, channelId: ` ${CHANNEL} `, language: "fr" }), { postEnabled: true, channelId: CHANNEL, language: "fr" });
  assert.deepEqual(normalizeStatusPostSettings({ postEnabled: true, channelId: "https://discord.com/channels/1/2", language: "xx" }), { postEnabled: false, channelId: "", language: "de" });
  assert.deepEqual(normalizeStatusPostSettings(null), { postEnabled: false, channelId: "", language: "de" });
});

test("a post in English and in French: the frame in the language, the owner's title as written", () => {
  const item = { key: "notice:x", kind: "incident", title: "Sender starten verzögert", message: "", impact: "major", startsAt: NOW, endsAt: null, resolvedAt: null, over: false };
  assert.equal(renderStatusPost(item, { language: "en" }).embeds[0].title, "🔴 Incident: Sender starten verzögert");
  const french = renderStatusPost(item, { language: "fr" }).embeds[0];
  assert.equal(french.title, "🔴 Incident : Sender starten verzögert");
  assert.deepEqual(french.fields.map((field) => field.name), ["Impact", "Depuis"]);
  assert.equal(french.fields[0].value, "Majeure");
});
