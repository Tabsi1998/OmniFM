// ============================================================
// OmniFM: what OmniFM keeps about one person, and deleting it (#285)
// ============================================================
// /mydata shows it, sends it as a file and deletes it. A person here is a
// Discord account; everything is found by its ID:
//   saved songs (/saved)                  -> deleted
//   votes on top.gg and discordbotlist    -> deleted (the totals stay)
//   dashboard logins                      -> deleted, so signed out everywhere
//   owner console logins                  -> deleted (the access in the settings stays)
//   running polls the person started      -> the poll runs on, the person is forgotten
//   events the person created             -> the event stays with the server, the person is forgotten
//   dashboard changes in the audit log    -> the entry stays, the person is replaced by "gelöscht"
//   Easter eggs found (#429)              -> deleted
//   listening hours, if switched on (#302)  -> deleted, counting off
//   the linked roles connection (#302)    -> deleted; Discord gets empty values first
//   the premium role in the support server -> forgotten (given again while premium)
// Not part of it: premium purchases and invoices (kept by law for tax), the
// server settings (they belong to the server) and what the owner team did
// in the owner console (their audit trail).
import { getDb, isConnected } from "./db.js";
import { log } from "./logging.js";
import { rememberPersonalDataErasure } from "./personal-data-erasures.js";
import { clearSavedSongs, listSavedSongs } from "../saved-songs-store.js";
import { forgetVoteEventsOfUser, listVoteEventsOfUser } from "../vote-events-store.js";
import { forgetDiscordBotListVoter } from "../discordbotlist-store.js";
import { deleteDashboardSessionsOfUser, listDashboardSessionsOfUser } from "../dashboard-store.js";
import { deleteOwnerSessionsOfUser } from "./owner-access.js";
import { forgetStationPollCreator, listStationPollsOfCreator } from "../station-polls-store.js";
import { listScheduledEvents, patchScheduledEvent } from "../scheduled-events-store.js";
import { forgetStationSuggestionSubmitter, listStationSuggestionsOfUser } from "../station-suggestions-store.js";
import { forgetReporter, listReportsOfReporter } from "../problem-reports-store.js";
import { forgetEggFinder, listEggsOfFinder } from "../easter-eggs-store.js";
import { forgetListeningHours, getListeningHours } from "../listening-hours-store.js";
import { countSupportRolesOf, forgetLinkedRoles, forgetSupportRolesOf, getLinkedRoleInfo } from "../linked-roles-store.js";

export const ERASED_ACTOR = "dashboard:gelöscht";
// Another process may hold the vote list or a login in its cache for a few seconds.
const SECOND_PASS_MS = 15_000;

function cleanUserId(userId) {
  const id = String(userId || "").trim();
  return /^\d{17,22}$/.test(id) ? id : "";
}

export function personalDataAvailable() {
  return isConnected() && Boolean(getDb());
}

function eventsCreatedBy(id) {
  return listScheduledEvents({}).filter((event) => event.createdByUserId === id);
}

async function dashboardChangesOf(id) {
  return getDb().collection("owner_audit")
    .find({ actor: `dashboard:${id}` }, { projection: { _id: 0, at: 1, action: 1, target: 1, summary: 1 } })
    .sort({ at: -1 })
    .toArray();
}

/** Everything OmniFM keeps about one Discord account, as plain data for the file. */
export async function collectPersonalData(userId, { now = new Date() } = {}) {
  const id = cleanUserId(userId);
  if (!id) return { ok: false, error: "invalid_user" };
  if (!personalDataAvailable()) return { ok: false, error: "db_unavailable" };
  const [savedSongs, votes, logins, ownerLogins, polls, changes, suggestions, reports, easterEggs, hours, linked, supportRoles] = await Promise.all([
    listSavedSongs(id),
    listVoteEventsOfUser(id),
    listDashboardSessionsOfUser(id),
    getDb().collection("owner_sessions").countDocuments({ discordId: id }),
    listStationPollsOfCreator(id),
    dashboardChangesOf(id),
    listStationSuggestionsOfUser(id),
    listReportsOfReporter(id),
    listEggsOfFinder(id),
    getListeningHours(id),
    getLinkedRoleInfo(id),
    countSupportRolesOf(id),
  ]);
  return {
    ok: true,
    data: {
      userId: id,
      createdAt: now.toISOString(),
      savedSongs: savedSongs.map(({ userId: _user, ...song }) => song),
      votes: votes.map((vote) => ({
        provider: vote.provider,
        votedAt: vote.votedAt,
        username: vote.username,
        avatarUrl: vote.avatarUrl,
        source: vote.source,
      })),
      dashboardLogins: logins.map((session) => ({
        user: session.user,
        servers: session.guilds,
        createdAt: new Date(session.createdAt * 1000).toISOString(),
        expiresAt: new Date(session.expiresAt * 1000).toISOString(),
      })),
      ownerConsoleLogins: ownerLogins,
      pollsStarted: polls.map((poll) => ({ serverId: poll.guildId, channelId: poll.channelId, endsAt: new Date(poll.endsAt).toISOString() })),
      eventsCreated: eventsCreatedBy(id).map((event) => ({
        serverId: event.guildId,
        name: event.name,
        createdAt: event.createdAt,
        runAt: event.runAtMs ? new Date(event.runAtMs).toISOString() : null,
      })),
      dashboardChanges: changes,
      // Station suggestions (#303): the Discord ID is kept only to answer.
      stationSuggestions: suggestions.map((suggestion) => ({
        name: suggestion.name,
        url: suggestion.url,
        status: suggestion.status,
        createdAt: suggestion.createdAt instanceof Date ? suggestion.createdAt.toISOString() : suggestion.createdAt,
      })),
      // Reports (#436, #437): the Discord ID is kept only for the promised message.
      reports: reports.map((report) => ({
        kind: report.kind,
        text: report.text,
        status: report.status,
        public: report.consent?.public === true,
        createdAt: report.createdAt instanceof Date ? report.createdAt.toISOString() : report.createdAt,
      })),
      // The Easter egg hunt (#429): per server and year, gone 30 days after Easter Monday.
      easterEggs: easterEggs.map((entry) => ({
        serverId: entry.guildId,
        serverName: entry.guildName || null,
        year: entry.year,
        eggs: entry.count,
        lastFoundAt: entry.lastFoundAt instanceof Date ? entry.lastFoundAt.toISOString() : entry.lastFoundAt || null,
        lastSongKey: entry.lastSong || null,
      })),
      // Listening hours (#302): only while counting is switched on in /mydata.
      listeningHours: hours.counting
        ? { counting: true, hours: Math.floor(hours.listenedMs / 3_600_000), since: hours.consentAt ? hours.consentAt.toISOString() : null }
        : null,
      // The linked roles (#302): that the connection exists and what Discord got last; the keys stay out.
      linkedRoles: linked
        ? {
          connectedAt: linked.linkedAt instanceof Date ? linked.linkedAt.toISOString() : linked.linkedAt,
          lastSentAt: linked.pushedAt instanceof Date ? linked.pushedAt.toISOString() : linked.pushedAt,
          lastSent: linked.metadata,
        }
        : null,
      supportServerPremiumRole: supportRoles > 0,
      notIncluded: [
        "Premium-Käufe und Rechnungen: Die müssen wir aus steuerlichen Gründen aufbewahren.",
        "Server-Einstellungen, eigene Sender und Events gehören dem Server, nicht einer Person.",
      ],
    },
  };
}

/** How many entries each part holds, for the panel. */
export function countPersonalData(data = {}) {
  return {
    savedSongs: data.savedSongs?.length || 0,
    votes: data.votes?.length || 0,
    dashboardLogins: data.dashboardLogins?.length || 0,
    ownerConsoleLogins: Number(data.ownerConsoleLogins) || 0,
    pollsStarted: data.pollsStarted?.length || 0,
    eventsCreated: data.eventsCreated?.length || 0,
    dashboardChanges: data.dashboardChanges?.length || 0,
    stationSuggestions: data.stationSuggestions?.length || 0,
    reports: data.reports?.length || 0,
    easterEggs: data.easterEggs?.length || 0,
    listeningHours: data.listeningHours ? 1 : 0,
    linkedRoles: data.linkedRoles ? 1 : 0,
    supportRoles: data.supportServerPremiumRole ? 1 : 0,
  };
}

async function eraseOnce(id) {
  const saved = await clearSavedSongs(id);
  let eventsCreated = 0;
  for (const event of eventsCreatedBy(id)) {
    if (patchScheduledEvent(event.id, { createdByUserId: null })?.ok) eventsCreated += 1;
  }
  const audit = await getDb().collection("owner_audit").updateMany({ actor: `dashboard:${id}` }, { $set: { actor: ERASED_ACTOR } });
  // discordbotlist keeps its own copy of the recent votes.
  forgetDiscordBotListVoter(id);
  return {
    savedSongs: saved.deleted || 0,
    votes: await forgetVoteEventsOfUser(id),
    dashboardLogins: await deleteDashboardSessionsOfUser(id),
    ownerConsoleLogins: await deleteOwnerSessionsOfUser(id),
    pollsStarted: await forgetStationPollCreator(id),
    eventsCreated,
    dashboardChanges: audit.modifiedCount || 0,
    // The suggestions stay in the queue, without the person.
    stationSuggestions: await forgetStationSuggestionSubmitter(id),
    // The reports stay with the team, without the person and without the message.
    reports: await forgetReporter(id),
    easterEggs: await forgetEggFinder(id),
    listeningHours: await forgetListeningHours(id),
    linkedRoles: await forgetLinkedRoles(id),
    supportRoles: await forgetSupportRolesOf(id),
  };
}

/**
 * Deletes what OmniFM keeps about one Discord account. Old votes a vote sync
 * reads again afterwards are skipped (personal-data-erasures.js).
 */
export async function erasePersonalData(userId, { now = new Date(), secondPassMs = SECOND_PASS_MS } = {}) {
  const id = cleanUserId(userId);
  if (!id) return { ok: false, error: "invalid_user" };
  if (!personalDataAvailable()) return { ok: false, error: "db_unavailable" };
  await rememberPersonalDataErasure(id, { now });
  const counts = await eraseOnce(id);
  if (secondPassMs > 0) {
    const timer = setTimeout(() => {
      forgetDiscordBotListVoter(id);
      deleteDashboardSessionsOfUser(id).catch((err) => log("WARN", `[personal-data] Zweiter Durchgang fehlgeschlagen: ${err?.message || err}`));
    }, secondPassMs);
    timer.unref?.();
  }
  return { ok: true, counts };
}
