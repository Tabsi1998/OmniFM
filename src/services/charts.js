// ============================================================
// OmniFM: the OmniFM charts (#300), counted and posted
// ============================================================
// Sums the song plays of a week over every server with one MongoDB
// aggregation, keeps only songs that ran on enough servers (src/lib/charts.js)
// and posts the chart once a week into a channel the owner chooses (owner
// console, "OmniFM-Charts"). The commander posts; a week is posted once
// (charts_posts), even across restarts.

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { getDb, isConnected } from "../lib/db.js";
import { log } from "../lib/logging.js";
import { configSectionFrom, loadOwnerConfigRaw } from "../lib/owner-config.js";
import { coverLookup } from "../lib/owner-public.js";
import { CHART_MIN_SERVERS, CHART_SIZE, chartWeek, rankChart, splitDisplayTitle } from "../lib/charts.js";
import { SONG_PLAYS_COLLECTION } from "../song-plays-store.js";
import { WEBSITE_URL, withLanguageParam } from "../bot/runtime-links.js";
import * as ui from "../discord/ui/index.js";

const CACHE_MS = 10 * 60_000;
const POST_CHECK_MS = 15 * 60_000;
const POSTS_COLLECTION = "charts_posts";
const COVERED_ENTRIES = 3;
const POSTED_ENTRIES = 10;
let cached = null;

async function weekRows(db, week) {
  return db.collection(SONG_PLAYS_COLLECTION).aggregate([
    { $match: { day: { $gte: new Date(week.start), $lt: new Date(week.end) } } },
    { $sort: { lastPlayedAt: 1 } },
    {
      $group: {
        _id: "$trackKey",
        plays: { $sum: "$count" },
        guilds: { $addToSet: "$guildId" },
        displayTitle: { $last: "$displayTitle" },
      },
    },
    { $project: { _id: 0, trackKey: "$_id", plays: 1, displayTitle: 1, servers: { $size: "$guilds" } } },
    { $match: { servers: { $gte: CHART_MIN_SERVERS } } },
    { $sort: { plays: -1, servers: -1, displayTitle: 1 } },
    { $limit: CHART_SIZE },
  ], { allowDiskUse: true }).toArray();
}

/**
 * GET /api/charts: the last completed week with the movement against the
 * week before, each song with its cover when one is found. Without MongoDB
 * the chart is empty and says it measures nothing.
 */
export async function weeklyChart(db, { now = Date.now(), cacheMs = CACHE_MS, coverFor = defaultCoverFor } = {}) {
  const week = chartWeek(now, 1);
  if (db && cached?.week === week.id && Date.now() - cached.at < cacheMs) return cached.body;
  let entries = [];
  if (db) {
    const [rows, previousRows] = await Promise.all([weekRows(db, week), weekRows(db, chartWeek(now, 2))]);
    entries = await Promise.all(rankChart(rows, previousRows).map(async (entry) => ({
      ...entry,
      cover: await coverFor(entry.displayTitle).catch(() => null),
    })));
  }
  const body = {
    week,
    minServers: CHART_MIN_SERVERS,
    size: CHART_SIZE,
    measuring: Boolean(db),
    entries,
    generatedAt: new Date(now).toISOString(),
  };
  if (db) cached = { week: week.id, at: Date.now(), body };
  return body;
}

/** The owner's post settings: on only with a real channel ID. */
export function chartsPostSettings(raw) {
  const section = configSectionFrom(raw, "charts") || {};
  const channelId = String(section.channelId || "").trim();
  const valid = /^\d{17,22}$/.test(channelId);
  return {
    enabled: section.postEnabled === true && valid,
    channelId: valid ? channelId : "",
    language: section.language === "en" ? "en" : "de",
  };
}

const berlinClock = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short", hour: "numeric", hourCycle: "h23" });

/** The chart of the week before is due from Monday 10:00 German time on. */
export function chartPostDue(now = Date.now()) {
  const parts = Object.fromEntries(berlinClock.formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  return parts.weekday !== "Mon" || Number(parts.hour) >= 10;
}

const MOVEMENT = { up: "▲", down: "▼", same: "–" };

function movementLabel(entry, t) {
  if (entry.movement === "new") return t("NEU", "NEW");
  return `${MOVEMENT[entry.movement]}${entry.previousRank && entry.movement !== "same" ? ` ${Math.abs(entry.previousRank - entry.rank)}` : ""}`;
}

/**
 * The weekly post: the top 3 with their covers, places 4 to 10 as a list,
 * a button to all 20 on the website.
 */
export function buildChartsMessage(chart, { language = "de" } = {}) {
  const t = (de, en) => (language === "en" ? en : de);
  const numbers = new Intl.NumberFormat(language === "en" ? "en-US" : "de-DE");
  const [firstDay, lastDay] = [new Date(chart.week.start), new Date(Date.parse(chart.week.end) - 86_400_000)];
  const dates = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const line = (entry) => `${movementLabel(entry, t)} · ${numbers.format(entry.plays)} ${t("Plays", "plays")} · ${t(`${entry.servers} Server`, `${entry.servers} servers`)}`;
  const top = chart.entries.slice(0, COVERED_ENTRIES).map((entry) => {
    const content = `**${entry.rank}. ${entry.displayTitle}**\n${line(entry)}`;
    return entry.cover ? ui.section({ content, thumbnailUrl: entry.cover }) : ui.text(content);
  });
  const rest = chart.entries.slice(COVERED_ENTRIES, POSTED_ENTRIES)
    .map((entry) => `\`${String(entry.rank).padStart(2, " ")}\` ${entry.displayTitle} · ${movementLabel(entry, t)}`);
  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(t(`Alle ${chart.entries.length} auf omnifm.xyz`, `All ${chart.entries.length} on omnifm.xyz`))
    .setURL(withLanguageParam(`${String(WEBSITE_URL).replace(/\/+$/, "")}/charts`, language));
  return ui.message(ui.panel({
    title: t(`🎶 OmniFM-Charts · KW ${chart.week.week}`, `🎶 OmniFM Charts · week ${chart.week.week}`),
    subtitle: t(
      `Die meistgespielten Songs vom ${dates.format(firstDay)} bis ${dates.format(lastDay)}, über alle Server.`,
      `The most played songs from ${dates.format(firstDay)} to ${dates.format(lastDay)}, across all servers.`,
    ),
    body: [...top, rest.length ? ui.separator({ divider: false }) : null, rest.length ? ui.text(rest.join("\n")) : null].filter(Boolean),
    actions: [new ActionRowBuilder().addComponents(button)],
    footer: t("Charts", "Charts"),
  }));
}

async function defaultCoverFor(displayTitle) {
  const { artist, title } = splitDisplayTitle(displayTitle);
  const found = await coverLookup({ artist, title, term: artist ? "" : title });
  return found?.ok && found.artwork ? String(found.artwork) : null;
}

/** Posts the last week's chart once, when it is due, the post is on and the chart has songs. */
export async function postWeeklyChartIfDue(runtime, { now = Date.now(), db = isConnected() ? getDb() : null } = {}) {
  if (!db || !chartPostDue(now)) return { posted: false, reason: "not-due" };
  const settings = chartsPostSettings(await loadOwnerConfigRaw({ db }));
  if (!settings.enabled) return { posted: false, reason: "off" };
  const week = chartWeek(now, 1);
  const posts = db.collection(POSTS_COLLECTION);
  if (await posts.findOne({ _id: week.id })) return { posted: false, reason: "done" };
  const chart = await weeklyChart(db, { now, cacheMs: 0 });
  if (!chart.entries.length) return { posted: false, reason: "empty" };
  const channel = await runtime.client.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    log("WARN", `[Charts] Kanal ${settings.channelId} nicht erreichbar; die Charts von ${week.id} warten.`);
    return { posted: false, reason: "channel" };
  }
  // Claim the week first, so a second commander never posts it twice.
  try {
    await posts.insertOne({ _id: week.id, channelId: settings.channelId, claimedAt: new Date(now) });
  } catch (err) {
    if (err?.code === 11000) return { posted: false, reason: "done" };
    throw err;
  }
  try {
    const sent = await channel.send(buildChartsMessage(chart, { language: settings.language }));
    await posts.updateOne({ _id: week.id }, { $set: { postedAt: new Date(), messageId: sent?.id || null } });
    log("INFO", `[Charts] ${week.id} in ${settings.channelId} gepostet (${chart.entries.length} Songs).`);
    return { posted: true };
  } catch (err) {
    await posts.deleteOne({ _id: week.id }).catch(() => null);
    throw err;
  }
}

let postTimer = null;

export function startChartsPostService(runtime, { intervalMs = POST_CHECK_MS } = {}) {
  if (postTimer) return;
  const tick = () => postWeeklyChartIfDue(runtime).catch((err) => log("WARN", `[Charts] Post fehlgeschlagen: ${err?.message || err}`));
  postTimer = setInterval(tick, Math.max(60_000, intervalMs));
  postTimer.unref?.();
  setTimeout(tick, 60_000).unref?.();
}

export function stopChartsPostService() {
  if (postTimer) clearInterval(postTimer);
  postTimer = null;
}
