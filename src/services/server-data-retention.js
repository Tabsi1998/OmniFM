// ============================================================
// OmniFM: a server's data after OmniFM was removed (#285)
// ============================================================
// When the commander leaves a server that has data, the server owner gets
// one DM with the date, the owner console lists it, and 30 days later the
// commander deletes what OmniFM kept about the server: settings, own
// stations and logos, permissions, language, events, polls, song history,
// listening stats, telemetry, incidents and bot state. If OmniFM comes back
// before that, nothing is deleted. Premium licenses stay (billing).
import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";

import { getDb, isConnected } from "../lib/db.js";
import { log } from "../lib/logging.js";
import { languagePick } from "../lib/language.js";
import { buildInviteUrlForRuntime } from "../lib/api-helpers.js";
import { deleteGuildSettings } from "../lib/guild-settings.js";
import { recordOwnerAudit } from "../lib/owner-audit-store.js";
import * as ui from "../discord/ui/index.js";
import {
  SERVER_DATA_RETENTION_DAYS,
  clearGuildDeparture,
  listDueGuildDepartures,
  markGuildDepartureNotified,
  recordGuildDeparture,
} from "../guild-departures-store.js";
import { clearGuildStations } from "../custom-stations.js";
import { resetCommandPermissions } from "../command-permissions-store.js";
import { clearGuildLanguage, getGuildLanguage } from "../guild-language-store.js";
import { deleteScheduledEventsByFilter } from "../scheduled-events-store.js";
import { deleteActiveStationPoll } from "../station-polls-store.js";
import { clearSongHistory } from "../song-history-store.js";
import { resetGuildStats } from "../listening-stats-store.js";
import { deleteDashboardTelemetry } from "../dashboard-store.js";
import { clearRuntimeIncidentsForGuild } from "../runtime-incidents-store.js";
import { forgetGuildInBotStates } from "../bot-state.js";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 10 * 60 * 1000;
// Collections with a plain guildId field and nothing else to keep in step.
const STATS_COLLECTIONS = ["daily_stats", "listening_sessions", "listener_snapshots", "connection_events", "guild_stats", "song_plays", "year_review_months", "guild_jingles"];
// Where a server's own settings live; one of them is enough to call it "has data".
const DATA_PROBES = [
  ["guild_settings", "guildId"],
  ["custom_stations", "guildId"],
  ["command_permissions", "_guildId"],
  ["scheduled_events", "guildId"],
  ["guild_stats", "guildId"],
  ["song_history", "guildId"],
  ["guild_jingles", "guildId"],
];

function db() {
  return isConnected() ? getDb() : null;
}

/** Whether OmniFM keeps anything about the server; without data there is nothing to announce. */
export async function hasServerData(guildId) {
  const database = db();
  if (!database) return false;
  for (const [collection, field] of DATA_PROBES) {
    // eslint-disable-next-line no-await-in-loop -- stops at the first hit
    if (await database.collection(collection).findOne({ [field]: String(guildId) }, { projection: { _id: 1 } })) return true;
  }
  return false;
}

/** Deletes what OmniFM keeps about one server; returns what went, per part. */
export async function purgeServerData(guildId) {
  const gid = String(guildId || "").trim();
  const database = db();
  const counts = {};
  counts.settings = await deleteGuildSettings(gid);
  clearGuildStations(gid);
  resetCommandPermissions(gid);
  clearGuildLanguage(gid);
  counts.events = deleteScheduledEventsByFilter({ guildId: gid })?.removed ?? 0;
  await deleteActiveStationPoll(gid);
  clearSongHistory(gid);
  resetGuildStats(gid);
  deleteDashboardTelemetry(gid);
  await clearRuntimeIncidentsForGuild(gid);
  counts.botStates = await forgetGuildInBotStates(gid);
  if (database) {
    for (const collection of STATS_COLLECTIONS) {
      // eslint-disable-next-line no-await-in-loop -- one collection after the other
      counts[collection] = (await database.collection(collection).deleteMany({ guildId: gid })).deletedCount || 0;
    }
    await database.collection("guild_command_sync").deleteMany({ _id: { $regex: `:${gid}$` } });
    await database.collection("runtime_guild_directory").deleteOne({ _id: gid });
  }
  return counts;
}

function dmPayload({ language, guildName, deleteAfter, inviteUrl }) {
  const t = (de, en) => languagePick(language, de, en);
  const when = `<t:${Math.floor(new Date(deleteAfter).getTime() / 1000)}:D>`;
  const name = guildName ? `„${guildName}“` : t("deinem Server", "your server");
  const actions = inviteUrl
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(inviteUrl).setLabel(t("OmniFM wieder einladen", "Invite OmniFM again")))]
    : [];
  return ui.message(ui.notice("info", {
    title: t(`OmniFM wurde von ${name} entfernt`, `OmniFM was removed from ${guildName ? `“${guildName}”` : "your server"}`),
    body: t(
      `Die Einstellungen, eigenen Sender, Events, Statistiken und den Song-Verlauf dieses Servers löschen wir am ${when}. Lädst du OmniFM vorher wieder ein, bleibt alles, wie es war. Premium-Lizenzen bleiben in jedem Fall erhalten.`,
      `We delete this server's settings, own stations, events, statistics and song history on ${when}. If you invite OmniFM again before then, everything stays as it was. Premium licenses are kept in any case.`
    ),
    actions,
  }));
}

/**
 * The commander left a server. With data there, the removal is noted and the
 * server owner hears about it once. A server without data (for example one
 * the bot left itself right after joining) is not announced.
 */
export async function handleCommanderGuildLeft(runtime, guild, { now = new Date() } = {}) {
  const guildId = String(guild?.id || "").trim();
  if (!guildId || !(await hasServerData(guildId))) return { recorded: false };
  const { created, departure } = await recordGuildDeparture({ guildId, guildName: guild?.name, now });
  if (!created) return { recorded: true, notified: false };
  let notified = false;
  const ownerId = String(guild?.ownerId || "").trim();
  if (ownerId) {
    try {
      const owner = await runtime.client.users.fetch(ownerId);
      await owner.send(dmPayload({
        language: getGuildLanguage(guildId),
        guildName: guild?.name || "",
        deleteAfter: departure.deleteAfter,
        inviteUrl: buildInviteUrlForRuntime(runtime),
      }));
      notified = true;
      await markGuildDepartureNotified(guildId, now);
    } catch (error) {
      // 50007: the owner does not take DMs; the date is in the owner console all the same.
      if (error?.code !== 50007) log("WARN", `[retention] Hinweis an den Server-Owner fehlgeschlagen (${guildId}): ${error?.message || error}`);
    }
  }
  log("INFO", `[retention] OmniFM von Server ${guildId} entfernt; Daten werden am ${new Date(departure.deleteAfter).toISOString().slice(0, 10)} gelöscht.`);
  return { recorded: true, notified };
}

/** The commander is back on the server: nothing is deleted. */
export async function handleCommanderGuildJoined(guildId) {
  if (await clearGuildDeparture(guildId)) log("INFO", `[retention] OmniFM ist zurück auf Server ${guildId}; Löschung abgesagt.`);
}

/** Deletes the data of every server whose 30 days are over, unless the commander is back. */
export async function runServerDataRetention(runtime, { now = new Date() } = {}) {
  const done = [];
  for (const departure of await listDueGuildDepartures(now)) {
    const { guildId } = departure;
    if (runtime?.client?.guilds?.cache?.has?.(guildId)) {
      // eslint-disable-next-line no-await-in-loop -- one server after the other
      await clearGuildDeparture(guildId);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const counts = await purgeServerData(guildId);
    // eslint-disable-next-line no-await-in-loop
    await clearGuildDeparture(guildId);
    recordOwnerAudit({
      action: "guild.data.delete",
      status: "success",
      actor: "system",
      target: guildId,
      summary: `Serverdaten ${SERVER_DATA_RETENTION_DAYS} Tage nach dem Entfernen gelöscht`,
    });
    log("INFO", `[retention] Daten von Server ${guildId} gelöscht (${SERVER_DATA_RETENTION_DAYS} Tage nach dem Entfernen).`);
    done.push({ guildId, counts });
  }
  return done;
}

let timer = null;

/** The commander checks every 6 hours, the first time 10 minutes after its start. */
export function startServerDataRetention(runtime) {
  if (timer) return;
  const run = () => runServerDataRetention(runtime).catch((err) => log("ERROR", `[retention] Löschlauf fehlgeschlagen: ${err?.message || err}`));
  timer = setTimeout(function tick() {
    run();
    timer = setTimeout(tick, CHECK_EVERY_MS);
    timer.unref?.();
  }, FIRST_CHECK_MS);
  timer.unref?.();
}

export function stopServerDataRetention() {
  if (timer) clearTimeout(timer);
  timer = null;
}
