// ============================================================
// OmniFM: the OmniFM charts (#300), counted and posted
// ============================================================
// Two lists per week, each from one MongoDB aggregation over every server:
// the most listened stations (listening time of people from the listening
// sessions) and the most played songs (the song plays of the weekly recap).
// Only what ran on enough servers counts (src/lib/charts.js). The chart is
// posted once a week into a channel the owner chooses (owner console,
// "OmniFM-Charts"); the commander posts, a week once (charts_posts).

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { getDb, isConnected } from "../lib/db.js";
import { log } from "../lib/logging.js";
import { configSectionFrom, loadOwnerConfigRaw } from "../lib/owner-config.js";
import { coverLookup } from "../lib/owner-public.js";
import { CHART_MIN_SERVERS, CHART_SIZE, STATION_CHART_SIZE, chartWeek, rankChart, rankStations, splitDisplayTitle } from "../lib/charts.js";
import { getPublicStationEntries } from "../lib/public-stations.js";
import { SONG_PLAYS_COLLECTION } from "../song-plays-store.js";
import { loadStations } from "../stations-store.js";
import { WEBSITE_URL, withLanguageParam } from "../bot/runtime-links.js";
import * as ui from "../discord/ui/index.js";
import { botTranslator, normalizeBotLanguage, botLocale } from "../lib/bot-i18n.js";

const CACHE_MS = 10 * 60_000;
const POST_CHECK_MS = 15 * 60_000;
const POSTS_COLLECTION = "charts_posts";
const POSTED_STATIONS = 5;
const STATION_LOGOS = 3;
const POSTED_SONGS = 3;
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
 * Listening time of people per station in a week, over every server. A
 * session counts with the part of it that falls into the week; its start and
 * end are read as dates whether they are stored as text or as dates.
 */
async function stationRows(db, week) {
  const start = new Date(week.start);
  const end = new Date(week.end);
  return db.collection("listening_sessions").aggregate([
    { $match: { humanListeningMs: { $gt: 0 }, stationKey: { $type: "string" } } },
    {
      $set: {
        startsAt: { $convert: { input: "$startedAt", to: "date", onError: null, onNull: null } },
        endsAt: { $convert: { input: "$endedAt", to: "date", onError: null, onNull: null } },
      },
    },
    // A session without a readable start or end is left out, never counted as endless.
    { $match: { startsAt: { $type: "date" }, endsAt: { $type: "date" }, $expr: { $and: [{ $lt: ["$startsAt", end] }, { $gt: ["$endsAt", start] }] } } },
    {
      $set: {
        weekMs: {
          $multiply: [
            "$humanListeningMs",
            {
              $divide: [
                { $max: [0, { $subtract: [{ $min: ["$endsAt", end] }, { $max: ["$startsAt", start] }] }] },
                { $max: [1, { $subtract: ["$endsAt", "$startsAt"] }] },
              ],
            },
          ],
        },
      },
    },
    { $group: { _id: "$stationKey", listeningMs: { $sum: "$weekMs" }, guilds: { $addToSet: "$guildId" } } },
    { $project: { _id: 0, stationKey: "$_id", listeningMs: 1, servers: { $size: "$guilds" } } },
    { $match: { servers: { $gte: CHART_MIN_SERVERS } } },
    { $sort: { listeningMs: -1 } },
    { $limit: STATION_CHART_SIZE * 3 },
  ], { allowDiskUse: true }).toArray();
}

/** The public catalogue (no server's own stream, no hidden plan): key -> station. */
function publicCatalog() {
  return Object.fromEntries(getPublicStationEntries(loadStations()?.stations || {}));
}

/**
 * GET /api/charts: the last completed week, the stations first, then the
 * songs, each with the movement against the week before; a song with its
 * cover when one is found. Without MongoDB both lists are empty and the
 * answer says it measures nothing.
 */
export async function weeklyChart(db, { now = Date.now(), cacheMs = CACHE_MS, coverFor = defaultCoverFor, catalog = null } = {}) {
  const week = chartWeek(now, 1);
  if (db && cached?.week === week.id && Date.now() - cached.at < cacheMs) return cached.body;
  let stations = [];
  let songs = [];
  if (db) {
    const previous = chartWeek(now, 2);
    const [stationWeek, stationBefore, songWeek, songBefore] = await Promise.all([
      stationRows(db, week), stationRows(db, previous), weekRows(db, week), weekRows(db, previous),
    ]);
    stations = rankStations(stationWeek, stationBefore, catalog || publicCatalog());
    songs = await Promise.all(rankChart(songWeek, songBefore).map(async (entry) => ({
      ...entry,
      cover: await coverFor(entry.displayTitle).catch(() => null),
    })));
  }
  const body = {
    week,
    minServers: CHART_MIN_SERVERS,
    measuring: Boolean(db),
    stations,
    songs,
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
 * The weekly post: the top 5 stations (the first three with their logo),
 * then the top 3 songs, a button to the full charts on the website.
 */
export function buildChartsMessage(chart, { language = "de" } = {}) {
  const t = botTranslator(normalizeBotLanguage(language, "de"));
  const locale = botLocale(normalizeBotLanguage(language, "de"));
  const numbers = new Intl.NumberFormat(locale);
  const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const [firstDay, lastDay] = [new Date(chart.week.start), new Date(Date.parse(chart.week.end) - 86_400_000)];
  const dates = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const servers = (count) => t("{count} Server", "{count} servers", { count });
  const stations = (chart.stations || []).slice(0, POSTED_STATIONS).map((entry, index) => {
    const content = `**${entry.rank}. ${entry.name}**${entry.genre ? ` · ${entry.genre}` : ""}\n`
      + `${movementLabel(entry, t)} · ${hours.format(entry.hours)} ${t("Hörstunden", "listening hours")} · ${servers(entry.servers)}`;
    return index < STATION_LOGOS && entry.logo ? ui.section({ content, thumbnailUrl: entry.logo }) : ui.text(content);
  });
  const songs = (chart.songs || []).slice(0, POSTED_SONGS)
    .map((entry) => `\`${entry.rank}\` ${entry.displayTitle} · ${numbers.format(entry.plays)} ${t("Plays", "plays")} · ${movementLabel(entry, t)}`);
  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(t("Alle Charts auf omnifm.xyz", "All charts on omnifm.xyz"))
    .setURL(withLanguageParam(`${String(WEBSITE_URL).replace(/\/+$/, "")}/charts`, language));
  return ui.message(ui.panel({
    title: t("📻 OmniFM-Charts · KW {week}", "📻 OmniFM Charts · week {week}", { week: chart.week.week }),
    subtitle: t(
      "Vom {from} bis {to}, über alle Server.",
      "From {from} to {to}, across all servers.", { from: dates.format(firstDay), to: dates.format(lastDay) },
    ),
    body: [
      stations.length ? ui.text(ui.heading(t("Meistgehörte Sender", "Most listened stations"), 3)) : null,
      ...stations,
      stations.length && songs.length ? ui.separator() : null,
      songs.length ? ui.text(`${ui.heading(t("Meistgespielte Songs", "Most played songs"), 3)}\n${songs.join("\n")}`) : null,
    ].filter(Boolean),
    actions: [new ActionRowBuilder().addComponents(button)],
    footer: t("Charts", "Charts"),
  }));
}

async function defaultCoverFor(displayTitle) {
  const { artist, title } = splitDisplayTitle(displayTitle);
  const found = await coverLookup({ artist, title, term: artist ? "" : title });
  return found?.ok && found.artwork ? String(found.artwork) : null;
}

/** Posts the last week's chart once, when it is due, the post is on and the chart has entries. */
export async function postWeeklyChartIfDue(runtime, { now = Date.now(), db = isConnected() ? getDb() : null } = {}) {
  if (!db || !chartPostDue(now)) return { posted: false, reason: "not-due" };
  const settings = chartsPostSettings(await loadOwnerConfigRaw({ db }));
  if (!settings.enabled) return { posted: false, reason: "off" };
  const week = chartWeek(now, 1);
  const posts = db.collection(POSTS_COLLECTION);
  if (await posts.findOne({ _id: week.id })) return { posted: false, reason: "done" };
  const chart = await weeklyChart(db, { now, cacheMs: 0 });
  if (!chart.stations.length && !chart.songs.length) return { posted: false, reason: "empty" };
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
    log("INFO", `[Charts] ${week.id} in ${settings.channelId} gepostet (${chart.stations.length} Sender, ${chart.songs.length} Songs).`);
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
