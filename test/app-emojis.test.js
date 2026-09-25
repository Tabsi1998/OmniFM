import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ICON_NAMES, clearAppEmojis, icon } from "../src/discord/ui/icons.js";
import {
  discordEmojiName,
  loadEmojiManifest,
  parseDiscordEmojiName,
  planEmojiSync,
  syncAppEmojis,
} from "../src/discord/ui/app-emojis.js";

const manifest = loadEmojiManifest();

function imageSize(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(1, 4).toString() === "PNG") return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (bytes.subarray(0, 6).toString() === "GIF89a") return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  throw new Error(`${file} is neither PNG nor GIF`);
}

test("every icon of the design system has an app emoji Discord accepts", () => {
  assert.deepEqual(manifest.emojis.map((entry) => entry.name).sort(), [...ICON_NAMES].sort());
  for (const entry of manifest.emojis) {
    const name = discordEmojiName(manifest.prefix, manifest.version, entry.name);
    assert.match(name, /^[a-zA-Z0-9_]{2,32}$/, `${name}: a valid Discord emoji name`);
    assert.ok(fs.statSync(entry.file).size <= 256 * 1024, `${entry.name}: at most 256 KB`);
    assert.deepEqual(imageSize(entry.file), [128, 128], `${entry.name}: 128x128`);
  }
  assert.ok(manifest.emojis.find((entry) => entry.name === "equalizer").animated, "the equalizer moves");
});

test("emoji names carry the icon and the manifest version", () => {
  assert.equal(discordEmojiName("omnifm", 3, "play"), "omnifm_play_v3");
  assert.deepEqual(parseDiscordEmojiName("omnifm", "omnifm_next_v12"), { logicalName: "next", version: 12 });
  assert.equal(parseDiscordEmojiName("omnifm", "partyparrot"), null);
});

function existing(version, names) {
  return names.map((name, index) => ({ id: `${version}${index}`, name: discordEmojiName("omnifm", version, name), animated: false }));
}

test("a new app uploads everything, a synced one nothing, and an old version is replaced", () => {
  const fresh = planEmojiSync([], manifest);
  assert.equal(fresh.upload.length, manifest.emojis.length);

  const names = manifest.emojis.map((entry) => entry.name);
  const synced = planEmojiSync(existing(manifest.version, names), manifest);
  assert.deepEqual([synced.upload.length, synced.remove.length, synced.keep.length], [0, 0, names.length]);

  const outdated = planEmojiSync([...existing(manifest.version - 1 || 99, names), { id: "x", name: "server_logo", animated: false }], manifest);
  assert.equal(outdated.upload.length, names.length);
  assert.equal(outdated.remove.length, names.length);
  assert.ok(!outdated.remove.some((emoji) => emoji.name === "server_logo"), "foreign emojis stay");
});

function fakeClient(applicationId, start = []) {
  const emojis = new Map(start.map((emoji) => [emoji.id, emoji]));
  const calls = { created: 0, deleted: 0 };
  return {
    calls,
    client: {
      application: {
        id: applicationId,
        emojis: {
          async fetch() { return new Map(emojis); },
          async create({ name, attachment }) {
            assert.ok(fs.existsSync(attachment));
            calls.created += 1;
            const emoji = { id: `id-${name}`, name, animated: attachment.endsWith(".gif") };
            emojis.set(emoji.id, emoji);
            return emoji;
          },
          async delete(id) { calls.deleted += 1; emojis.delete(id); },
        },
      },
    },
  };
}

test("a bot uploads its icons once and then uses its own emojis", async (t) => {
  t.after(() => clearAppEmojis());
  const { client, calls } = fakeClient("app-1");
  const first = await syncAppEmojis(client, { env: {} });
  assert.equal(first.uploaded, manifest.emojis.length);
  assert.equal(icon("play", "app-1"), `<:omnifm_play_v${manifest.version}:id-omnifm_play_v${manifest.version}>`);
  assert.match(icon("equalizer", "app-1"), /^<a:omnifm_equalizer_v\d+:/);
  assert.equal(icon("play", "app-2"), "▶️", "another application keeps Unicode");

  const second = await syncAppEmojis(client, { env: {} });
  assert.equal(second.uploaded, 0);
  assert.equal(calls.created, manifest.emojis.length);
});

test("the sync can be switched off", async () => {
  const { client, calls } = fakeClient("app-3");
  assert.deepEqual(await syncAppEmojis(client, { env: { OMNIFM_APP_EMOJIS: "0" } }), { skipped: true });
  assert.equal(calls.created, 0);
});
