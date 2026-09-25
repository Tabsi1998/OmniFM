// ============================================================
// OmniFM Discord design system: app emojis (#265)
// ============================================================
// Every bot is its own Discord application and uploads the OmniFM icons of
// assets/discord-emojis/ as its own app emojis when it logs in: they work in
// every server without using the server's emoji slots. Names carry the
// manifest version ("omnifm_play_v1"); a new version uploads the new icons
// first, then removes the old ones. Until the upload is done, and whenever
// it fails, the icons fall back to Unicode (icons.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { log } from "../../lib/logging.js";
import { registerAppEmojis } from "./icons.js";

export const EMOJI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "discord-emojis");

export function loadEmojiManifest(dir = EMOJI_DIR) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  return {
    version: Number(manifest.version) || 1,
    prefix: String(manifest.prefix || "omnifm"),
    emojis: (manifest.emojis || []).map((entry) => ({
      name: String(entry.name),
      file: path.join(dir, String(entry.file)),
      animated: entry.animated === true,
    })),
  };
}

/** "omnifm_play_v1": Discord allows 2-32 characters, letters, digits, underscore. */
export function discordEmojiName(prefix, version, name) {
  return `${prefix}_${name}_v${version}`;
}

export function parseDiscordEmojiName(prefix, discordName) {
  const match = String(discordName || "").match(new RegExp(`^${prefix}_([a-z0-9_]+?)_v(\\d+)$`));
  return match ? { logicalName: match[1], version: Number(match[2]) } : null;
}

/**
 * What to upload, keep and remove. Emojis of the app that do not carry the
 * prefix are never touched.
 */
export function planEmojiSync(existing, manifest) {
  const wanted = new Map(manifest.emojis.map((entry) => [discordEmojiName(manifest.prefix, manifest.version, entry.name), entry]));
  const keep = [];
  const remove = [];
  const present = new Set();
  for (const emoji of existing) {
    const parsed = parseDiscordEmojiName(manifest.prefix, emoji.name);
    if (!parsed) continue;
    if (wanted.has(emoji.name)) {
      keep.push({ ...emoji, logicalName: parsed.logicalName });
      present.add(emoji.name);
    } else {
      remove.push(emoji);
    }
  }
  const upload = [...wanted.entries()]
    .filter(([name]) => !present.has(name))
    .map(([name, entry]) => ({ ...entry, discordName: name }));
  return { keep, upload, remove };
}

/** Uploads missing icons for the bot's own application and registers them. */
export async function syncAppEmojis(client, { manifest = null, env = process.env } = {}) {
  if (String(env.OMNIFM_APP_EMOJIS ?? "1").trim() === "0") return { skipped: true };
  const application = client?.application;
  if (!application?.id || !application.emojis) return { skipped: true };
  const plan = loadEmojiPlan(await application.emojis.fetch(), manifest || loadEmojiManifest());
  const registered = [...plan.keep];
  for (const entry of plan.upload) {
    // One at a time: Discord rate-limits emoji uploads per application.
    // eslint-disable-next-line no-await-in-loop
    const created = await application.emojis.create({ attachment: entry.file, name: entry.discordName });
    registered.push({ id: created.id, name: created.name, animated: created.animated === true, logicalName: entry.name });
  }
  for (const emoji of plan.remove) {
    // eslint-disable-next-line no-await-in-loop
    await application.emojis.delete(emoji.id).catch(() => null);
  }
  registerAppEmojis(application.id, registered);
  return { uploaded: plan.upload.length, removed: plan.remove.length, registered: registered.length };
}

function loadEmojiPlan(fetched, manifest) {
  const existing = [...(typeof fetched?.values === "function" ? fetched.values() : fetched || [])]
    .map((emoji) => ({ id: String(emoji.id), name: String(emoji.name), animated: emoji.animated === true }));
  return planEmojiSync(existing, manifest);
}

/** For the runtime: never throws, logs what happened. */
export async function syncAppEmojisSafely(client, botName = "OmniFM") {
  try {
    const result = await syncAppEmojis(client);
    if (!result.skipped && (result.uploaded || result.removed)) {
      log("INFO", `[${botName}] App-Emojis: ${result.uploaded} hochgeladen, ${result.removed} ersetzt, ${result.registered} aktiv.`);
    }
    return result;
  } catch (error) {
    log("WARN", `[${botName}] App-Emojis nicht abgeglichen (Unicode bleibt): ${error?.message || error}`);
    return { failed: true };
  }
}
