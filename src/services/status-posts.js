// ============================================================
// OmniFM: the status page in Discord (#478)
// ============================================================
// Incidents and maintenance from the owner console and the outages the
// status page measures (#299) become one post each in the channel the owner
// sets (owner console, "Statusseite"). A change edits the same post; when it
// is over, the post says so and a short reply below makes it noticed.
//
// Only what the public status page shows goes into a post: kind, title,
// text, impact, times, the bot of an outage and the link to the page.
// Nothing goes anywhere but the channel the owner set. Each post is claimed
// in status_posts before it is sent, so a restart or a second commander
// never sends it twice.

import { createHash } from "node:crypto";
import { ChannelType, EmbedBuilder } from "discord.js";
import { getDb, isConnected } from "../lib/db.js";
import { log } from "../lib/logging.js";
import { configSectionFrom, loadOwnerConfigRaw } from "../lib/owner-config.js";
import { OUTAGE_GRACE_MS, STATUS_KEEP_MS } from "../lib/status-page.js";
import { botTranslator, normalizeBotLanguage } from "../lib/bot-i18n.js";
import { WEBSITE_URL, withLanguageParam } from "../bot/runtime-links.js";

export const STATUS_POSTS_COLLECTION = "status_posts";
const CHECK_MS = 30_000;
// Outages are looked at as long as the status page lists them.
const RECENT_OUTAGES_MS = 14 * 86_400_000;
const COLORS = Object.freeze({ major: 0xed4245, minor: 0xfaa61a, maintenance: 0x5865f2, over: 0x57f287 });
const NO_PINGS = Object.freeze({ parse: [] });
const CHANNEL_ID = /^\d{17,22}$/;
// A post's entry goes when the status page forgets the item; one that never ended after 200 days.
const CLAIM_KEEP_MS = 200 * 86_400_000;

/** The owner's settings for the posts: on only with a real channel ID. */
export function normalizeStatusPostSettings(data) {
  const source = data && typeof data === "object" ? data : {};
  const channelId = String(source.channelId || "").trim();
  const valid = CHANNEL_ID.test(channelId);
  return {
    postEnabled: source.postEnabled === true && valid,
    channelId: valid ? channelId : "",
    language: normalizeBotLanguage(source.language, "de"),
  };
}

/** What the service reads from the owner configuration. */
export function statusPostSettings(raw) {
  const settings = normalizeStatusPostSettings(configSectionFrom(raw, "statusPosts"));
  return { enabled: settings.postEnabled, channelId: settings.channelId, language: settings.language };
}

const msOf = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
};

/**
 * What the status page shows now, as posts: every notice, and the outages
 * long enough for the page (OUTAGE_GRACE_MS). `over` is a resolved
 * incident, a finished maintenance or a bot that is back.
 */
export async function statusPostItems(db, { now = Date.now() } = {}) {
  const [notices, outages] = await Promise.all([
    db.collection("status_notices").find({}).toArray(),
    db.collection("status_outages")
      .find({ $or: [{ endedAt: null }, { endedAt: { $gte: new Date(now - RECENT_OUTAGES_MS) } }] })
      .toArray(),
  ]);
  const items = [];
  for (const notice of notices) {
    const startsAt = msOf(notice.startsAt);
    const endsAt = msOf(notice.endsAt);
    const resolvedAt = msOf(notice.resolvedAt);
    const kind = notice.kind === "maintenance" ? "maintenance" : "incident";
    const overAt = kind === "incident" ? resolvedAt : resolvedAt ?? endsAt;
    items.push({
      key: `notice:${notice._id}`,
      kind,
      title: String(notice.title || ""),
      message: String(notice.message || ""),
      impact: notice.impact === "major" ? "major" : "minor",
      startsAt,
      endsAt,
      resolvedAt,
      running: kind === "maintenance" && startsAt !== null && startsAt <= now,
      over: overAt !== null && overAt <= now,
    });
  }
  for (const outage of outages) {
    const startedAt = msOf(outage.startedAt);
    if (startedAt === null) continue;
    const endedAt = msOf(outage.endedAt);
    if ((endedAt ?? now) - startedAt < OUTAGE_GRACE_MS) continue;
    items.push({
      key: `outage:${outage.bot}:${startedAt}`,
      kind: "outage",
      bot: String(outage.name || outage.bot || "OmniFM"),
      startsAt: startedAt,
      endsAt: endedAt,
      over: endedAt !== null,
    });
  }
  return items;
}

const stamp = (ms, style = "f") => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** The headline of a post, also the text of the reply when it is over. */
function headline(item, t) {
  if (item.kind === "outage") {
    return item.over
      ? t("✅ {bot} ist wieder erreichbar", "✅ {bot} is reachable again", { bot: item.bot })
      : t("🔴 {bot} ist nicht erreichbar", "🔴 {bot} is unreachable", { bot: item.bot });
  }
  if (item.kind === "maintenance") {
    if (item.over) return t("✅ Wartung beendet: {title}", "✅ Maintenance completed: {title}", { title: item.title });
    return item.running
      ? t("🛠️ Wartung läuft: {title}", "🛠️ Maintenance in progress: {title}", { title: item.title })
      : t("🛠️ Wartung geplant: {title}", "🛠️ Planned maintenance: {title}", { title: item.title });
  }
  if (item.over) return t("✅ Behoben: {title}", "✅ Resolved: {title}", { title: item.title });
  return item.impact === "major"
    ? t("🔴 Störung: {title}", "🔴 Incident: {title}", { title: item.title })
    : t("🟠 Störung: {title}", "🟠 Incident: {title}", { title: item.title });
}

/** The post as the status page shows it: headline, text, impact, times, link. */
export function renderStatusPost(item, { language = "de" } = {}) {
  const t = botTranslator(language);
  const fields = [];
  if (item.kind === "incident") {
    fields.push({ name: t("Auswirkung", "Impact"), value: item.impact === "major" ? t("Größer", "Major") : t("Teilweise", "Partial"), inline: true });
    if (item.startsAt !== null) fields.push({ name: t("Seit", "Since"), value: stamp(item.startsAt), inline: true });
    if (item.over && item.resolvedAt !== null) fields.push({ name: t("Behoben", "Resolved"), value: stamp(item.resolvedAt), inline: true });
  } else if (item.kind === "maintenance") {
    if (item.startsAt !== null && item.endsAt !== null) {
      fields.push({ name: t("Zeitraum", "Window"), value: t("{from} bis {to}", "{from} to {to}", { from: stamp(item.startsAt), to: stamp(item.endsAt) }), inline: false });
    }
  } else {
    fields.push({ name: t("Seit", "Since"), value: stamp(item.startsAt), inline: true });
    if (item.over && item.endsAt !== null) fields.push({ name: t("Wieder da", "Back"), value: stamp(item.endsAt), inline: true });
  }
  const color = item.over ? COLORS.over : item.kind === "maintenance" ? COLORS.maintenance : item.kind === "outage" ? COLORS.major : COLORS[item.impact];
  const description = item.kind === "outage"
    ? t("Die Statusseite hat den Ausfall gemessen. Wir kümmern uns darum.", "The status page measured the outage. We are on it.")
    : item.message;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(headline(item, t).slice(0, 256))
    .setURL(withLanguageParam(`${String(WEBSITE_URL).replace(/\/+$/, "")}/status`, language))
    .setFooter({ text: t("OmniFM-Status", "OmniFM status") });
  if (description) embed.setDescription(description.slice(0, 4000));
  if (fields.length) embed.addFields(fields);
  const data = embed.toJSON();
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return { embeds: [data], allowedMentions: NO_PINGS, hash, reply: headline(item, t) };
}

async function fetchChannel(runtime, channelId) {
  const channel = await runtime?.client?.channels?.fetch?.(channelId).catch(() => null);
  return channel?.isTextBased?.() && typeof channel.send === "function" ? channel : null;
}

/**
 * One round: new posts into the owner's channel, changes into the same post,
 * a reply when it is over. Without the switch or a channel nothing happens.
 */
export async function syncStatusPosts(runtime, { db = isConnected() ? getDb() : null, now = Date.now(), raw = null } = {}) {
  const done = { posted: 0, edited: 0, replied: 0 };
  if (!db) return { ...done, reason: "no-database" };
  const settings = statusPostSettings(raw || await loadOwnerConfigRaw({ db }));
  if (!settings.enabled) return { ...done, reason: "off" };
  const posts = db.collection(STATUS_POSTS_COLLECTION);
  const items = await statusPostItems(db, { now });
  let channel;
  for (const item of items) {
    const post = renderStatusPost(item, { language: settings.language });
    // eslint-disable-next-line no-await-in-loop -- a handful of posts, one after the other
    const stored = await posts.findOne({ _id: item.key });
    if (!stored) {
      // Something already over before it was posted (or before the switch) gets no post.
      if (item.over) continue;
      if (channel === undefined) {
        // eslint-disable-next-line no-await-in-loop
        channel = await fetchChannel(runtime, settings.channelId);
        if (!channel) log("WARN", `[Status] Kanal ${settings.channelId} nicht erreichbar; Status-Posts warten.`);
      }
      if (!channel) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await posts.insertOne({ _id: item.key, channelId: settings.channelId, claimedAt: new Date(now), expiresAt: new Date(now + CLAIM_KEEP_MS) });
      } catch (err) {
        if (err?.code === 11000) continue;
        throw err;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const sent = await channel.send({ embeds: post.embeds, allowedMentions: post.allowedMentions });
        // eslint-disable-next-line no-await-in-loop
        await posts.updateOne({ _id: item.key }, { $set: { messageId: sent?.id || null, hash: post.hash, postedAt: new Date(now), over: false } });
        done.posted += 1;
        if (channel.type === ChannelType.GuildAnnouncement) {
          // eslint-disable-next-line no-await-in-loop
          await sent?.crosspost?.().catch((err) => log("WARN", `[Status] Veröffentlichen im Ankündigungskanal fehlgeschlagen: ${err?.message || err}`));
        }
      } catch (err) {
        // eslint-disable-next-line no-await-in-loop
        await posts.deleteOne({ _id: item.key }).catch(() => null);
        log("WARN", `[Status] Post fehlgeschlagen (${item.key}): ${err?.message || err}`);
      }
      continue;
    }
    // Claimed but not sent yet (or the send was cut off): never a second post.
    if (!stored.messageId || stored.gone) continue;
    if (stored.hash !== post.hash) {
      // eslint-disable-next-line no-await-in-loop
      const edited = await editPost(runtime, stored, post);
      if (edited === "gone") {
        // eslint-disable-next-line no-await-in-loop
        await posts.updateOne({ _id: item.key }, { $set: { gone: true } });
        continue;
      }
      if (edited) {
        // eslint-disable-next-line no-await-in-loop
        await posts.updateOne({ _id: item.key }, { $set: { hash: post.hash, editedAt: new Date(now) } });
        done.edited += 1;
      }
    }
    if (item.over && !stored.repliedAt) {
      // Claim the reply first: one reply, even with two commanders.
      // eslint-disable-next-line no-await-in-loop
      const claim = await posts.updateOne({ _id: item.key, repliedAt: null }, { $set: { repliedAt: new Date(now), over: true, expiresAt: new Date(now + STATUS_KEEP_MS) } });
      if (Number(claim?.modifiedCount || 0) !== 1) continue;
      // eslint-disable-next-line no-await-in-loop
      const replied = await replyToPost(runtime, stored, post.reply);
      if (replied) done.replied += 1;
      // eslint-disable-next-line no-await-in-loop
      else await posts.updateOne({ _id: item.key }, { $set: { repliedAt: null } });
    }
  }
  return done;
}

async function editPost(runtime, stored, post) {
  const channel = await fetchChannel(runtime, stored.channelId);
  if (!channel) return false;
  try {
    const message = await channel.messages.fetch(stored.messageId);
    await message.edit({ embeds: post.embeds, allowedMentions: post.allowedMentions });
    return true;
  } catch (err) {
    // Unknown Message: someone deleted the post; it stays deleted.
    if (err?.code === 10008) return "gone";
    log("WARN", `[Status] Post nicht bearbeitet (${stored._id}): ${err?.message || err}`);
    return false;
  }
}

async function replyToPost(runtime, stored, text) {
  const channel = await fetchChannel(runtime, stored.channelId);
  if (!channel) return false;
  try {
    await channel.send({ content: text, reply: { messageReference: stored.messageId, failIfNotExists: false }, allowedMentions: NO_PINGS });
    return true;
  } catch (err) {
    log("WARN", `[Status] Antwort nicht gesendet (${stored._id}): ${err?.message || err}`);
    return false;
  }
}

let timer = null;

/** Every 30 seconds in the commander; a failure is logged once until it changes. */
export function startStatusPostService(runtime, { intervalMs = CHECK_MS } = {}) {
  if (timer) return;
  let lastError = "";
  const tick = async () => {
    try {
      await syncStatusPosts(runtime);
      lastError = "";
    } catch (err) {
      const message = String(err?.message || err);
      if (message !== lastError) log("WARN", `[Status] Status-Posts fehlgeschlagen: ${message}`);
      lastError = message;
    }
  };
  timer = setInterval(() => { tick(); }, Math.max(10_000, intervalMs));
  timer.unref?.();
  setTimeout(() => { tick(); }, 15_000).unref?.();
}

export function stopStatusPostService() {
  if (timer) clearInterval(timer);
  timer = null;
}
