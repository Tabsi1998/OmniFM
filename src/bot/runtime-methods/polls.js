// "Which station next?" (#274): /poll (German /umfrage) posts a Discord
// poll with 2 to 10 stations; when it ends, the commander switches the
// streaming worker to the winner and says so. One poll per server; kept in
// the store, so a restart still evaluates it.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime (the commander).
import { log } from "../../lib/logging.js";
import { getTier } from "../../core/entitlements.js";
import { evaluateCommandPermission } from "../../command-permissions-store.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import { buildStationCatalog, delegatePlayToWorker } from "../runtime-panels.js";
import {
  deleteActiveStationPoll,
  getActiveStationPoll,
  listActiveStationPolls,
  saveActiveStationPoll,
} from "../../station-polls-store.js";
import {
  POLL_MIN_STATIONS,
  buildStationPollMessage,
  buildStationPollResultPayload,
  decideStationPollWinner,
  normalizePollMinutes,
  pickGenreStations,
  resolvePollStations,
} from "../station-poll.js";
import { loadStations } from "../../stations-store.js";

// Discord needs a moment after the end until the vote counts are final.
const POLL_RESULT_SETTLE_MS = 2000;

function translatorFor(runtime, guildId) {
  const language = runtime.resolveGuildLanguage?.(guildId) || "de";
  return (de, en) => (language === "de" ? de : en);
}

/** The catalog of the server's plan with genre and colour, for picking stations. */
function pollCatalog(guildId) {
  const { entries, stationsData } = buildStationCatalog(guildId);
  const official = loadStations()?.stations || {};
  return {
    stationsData,
    entries: entries.map((entry) => ({
      key: entry.key,
      name: entry.name,
      genre: official[entry.key]?.genre || stationsData?.stations?.[entry.key]?.genre || "",
      color: official[entry.key]?.color || stationsData?.stations?.[entry.key]?.color || null,
    })),
  };
}

const pollMethods = {
  /** Managers always; others only with an explicit /perm allow rule for "poll" (a DJ role). */
  canStartStationPoll(interaction) {
    if (this.hasPermissionAdminBypass?.(interaction)) return true;
    const decision = evaluateCommandPermission(interaction.guildId, "poll", this.getInteractionRoleIds?.(interaction) || []);
    return decision.configured === true && decision.allowed === true;
  },

  /** The streaming worker of the server and its voice channel, or null. */
  findStreamingTarget(guildId) {
    const worker = this.workerManager?.getStreamingWorkers?.(guildId)?.[0] || null;
    const state = worker?.guildState?.get?.(guildId) || null;
    const channelId = String(state?.connection?.joinConfig?.channelId || state?.lastChannelId || "").trim();
    if (!worker || !channelId) return null;
    return { worker, channelId, stationKey: state?.currentStationKey || null, stationName: state?.currentStationName || null };
  },

  async handleStationPollCommand(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = interaction.guildId;
    if (!this.canStartStationPoll(interaction)) {
      await this.respondInteraction(interaction, buildNoticePayload({
        t, language, tone: "warning", title: t("Nur für Verwalter oder DJs", "Managers or DJs only"),
        description: t(
          "Umfragen starten Server-Verwalter oder eine Rolle, die mit `/perm` für `/poll` freigegeben ist.",
          "Polls are started by server managers or a role allowed for `/poll` with `/perm`."
        ),
      }));
      return;
    }
    if (await getActiveStationPoll(guildId)) {
      await this.respondInteraction(interaction, buildNoticePayload({
        t, language, tone: "info", title: t("Es läuft schon eine Umfrage", "A poll is already running"),
        description: t("Pro Server geht eine Umfrage gleichzeitig. Wartet, bis sie endet.", "One poll per server at a time. Wait until it ends."),
      }));
      return;
    }
    const target = this.findStreamingTarget(guildId);
    if (!target) {
      await this.respondInteraction(interaction, buildNoticePayload({ t, language, code: "nothing-playing" }));
      return;
    }

    const { entries } = pollCatalog(guildId);
    const stationsText = interaction.options.getString("stations");
    const genre = interaction.options.getString("genre");
    const count = interaction.options.getInteger("count") || 5;
    let stations;
    if (stationsText) {
      const resolved = resolvePollStations(stationsText, entries);
      if (resolved.unknown.length) {
        await this.respondInteraction(interaction, buildNoticePayload({
          t, language, tone: "warning", title: t("Sender nicht gefunden", "Station not found"),
          description: t(`Diese Sender kenne ich (auf eurem Plan) nicht: ${resolved.unknown.join(", ")}`, `I do not know these stations (on your plan): ${resolved.unknown.join(", ")}`),
        }));
        return;
      }
      stations = resolved.stations;
    } else {
      stations = pickGenreStations(entries, genre || "", count);
    }
    if (stations.length < POLL_MIN_STATIONS) {
      await this.respondInteraction(interaction, buildNoticePayload({
        t, language, tone: "warning", title: t("Zu wenige Sender", "Too few stations"),
        description: t("Eine Umfrage braucht mindestens zwei Sender.", "A poll needs at least two stations."),
      }));
      return;
    }

    const minutes = normalizePollMinutes(interaction.options.getString("duration"));
    const endsAt = Date.now() + minutes * 60_000;
    await interaction.reply(buildStationPollMessage({ t, stations, minutes, endsAt }));
    const message = await interaction.fetchReply();
    const saved = await saveActiveStationPoll({
      guildId,
      channelId: message.channelId || interaction.channelId,
      messageId: message.id,
      voiceChannelId: target.channelId,
      stations: stations.map((station) => ({ key: station.key, name: station.name })),
      endsAt,
      createdBy: interaction.user?.id,
    });
    if (saved.ok) this.armStationPoll(saved.poll);
    log("INFO", `[${this.config?.name}] Umfrage gestartet guild=${guildId} stations=${stations.length} minutes=${minutes}`);
  },

  armStationPoll(poll) {
    if (!(this.stationPollTimers instanceof Map)) this.stationPollTimers = new Map();
    clearTimeout(this.stationPollTimers.get(poll.guildId));
    const handle = setTimeout(() => {
      this.stationPollTimers.delete(poll.guildId);
      this.finishStationPoll(poll.guildId).catch((err) => {
        log("WARN", `[${this.config?.name}] Umfrage-Auswertung fehlgeschlagen (guild=${poll.guildId}): ${err?.message || err}`);
      });
    }, Math.max(0, poll.endsAt - Date.now()));
    handle?.unref?.();
    this.stationPollTimers.set(poll.guildId, handle);
  },

  /**
   * Ends the poll, reads the votes and switches to the winner. A deleted poll
   * changes nothing. { outcome, switched, error } for the tests and the log.
   */
  async finishStationPoll(guildId, { settleMs = POLL_RESULT_SETTLE_MS, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    const poll = await getActiveStationPoll(guildId);
    if (!poll) return { outcome: null };
    await deleteActiveStationPoll(guildId);
    const t = translatorFor(this, guildId);

    const channel = this.client?.channels?.cache?.get?.(poll.channelId)
      || await this.client?.channels?.fetch?.(poll.channelId).catch(() => null);
    let message = await channel?.messages?.fetch?.(poll.messageId).catch(() => null);
    if (!message?.poll) {
      log("INFO", `[${this.config?.name}] Umfrage geloescht oder nicht mehr erreichbar (guild=${guildId}); es bleibt alles, wie es ist.`);
      return { outcome: { kind: "deleted" } };
    }
    if (!message.poll.resultsFinalized) {
      await message.poll.end().catch(() => null);
      await wait(settleMs);
      message = await channel.messages.fetch({ message: poll.messageId, force: true }).catch(() => message);
    }

    const counts = [...(message.poll?.answers?.values?.() || [])].map((answer) => answer.voteCount || 0);
    const outcome = decideStationPollWinner(counts);
    const target = this.findStreamingTarget(guildId);
    let switched = false;
    let error = "";
    if (outcome.kind !== "none") {
      const winner = poll.stations[outcome.index];
      if (winner && target?.stationKey !== winner.key) {
        const { guildTier, stationsData } = buildStationCatalog(guildId);
        if (!stationsData?.stations?.[winner.key]) {
          error = t("Der Sender ist auf eurem Plan nicht mehr verfügbar.", "The station is no longer available on your plan.");
        } else {
          const result = await delegatePlayToWorker(this, {
            guildId,
            channelId: target?.channelId || poll.voiceChannelId,
            playable: { key: winner.key, playStations: stationsData, guildTier: guildTier || getTier(guildId) },
            t,
            language: this.resolveGuildLanguage?.(guildId) || "de",
          });
          switched = result.ok === true;
          if (!result.ok) error = result.message || "";
        }
      }
    }
    await message.reply(buildStationPollResultPayload({
      t,
      outcome,
      stations: poll.stations,
      currentName: target?.stationName || target?.stationKey || "",
      switched,
      error,
    })).catch(() => null);
    log("INFO", `[${this.config?.name}] Umfrage beendet guild=${guildId} outcome=${outcome.kind} switched=${switched}`);
    return { outcome, switched, error };
  },

  /** After a restart: arm every stored poll again (overdue ones are evaluated now). */
  async restoreStationPolls() {
    const polls = await listActiveStationPolls();
    for (const poll of polls) this.armStationPoll(poll);
    if (polls.length) log("INFO", `[${this.config?.name}] ${polls.length} Umfrage(n) wieder aufgenommen.`);
  },
};

export { pollMethods };
