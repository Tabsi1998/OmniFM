// OmniFM: scheduled events: running, stopping and the scheduler tick.
// Split out of src/bot/runtime-events.js (#295).
import { log } from "../lib/logging.js";
import {
  EVENT_SCHEDULER_ENABLED,
  EVENT_SCHEDULER_POLL_MS,
  EVENT_SCHEDULER_RETRY_MS,
  clipText,
} from "../lib/helpers.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  computeNextEventRunAtMs,
  formatDateTime,
  normalizeEventTimeZone,
  renderStageTopic,
} from "../lib/event-time.js";
import { getTier, requireFeature } from "../core/entitlements.js";
import {
  listScheduledEvents,
  deleteScheduledEvent,
  patchScheduledEvent,
} from "../scheduled-events-store.js";
import { pickScheduledEventWorker } from "./runtime-event-discord.js";

export async function executeScheduledEvent(runtime, event) {
  if (runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }
  const now = Date.now();
  if (!runtime.client.guilds.cache.has(event.guildId)) {
    deleteScheduledEvent(event.id, { guildId: event.guildId, botId: runtime.config.id });
    return;
  }

  const feature = requireFeature(event.guildId, "scheduledEvents");
  if (!feature.ok) {
    patchScheduledEvent(event.id, { enabled: false, lastRunAtMs: now });
    log(
      "INFO",
      `[${runtime.config.name}] Event deaktiviert (Plan zu niedrig): guild=${event.guildId} id=${event.id}`
    );
    return;
  }

  // Makes sure the server has its playback state before the event plays.
  runtime.getState(event.guildId);
  const eventGuild = runtime.client.guilds.cache.get(event.guildId) || null;
  const eventLanguage = runtime.resolveGuildLanguage(event.guildId);
  const stationResult = runtime.resolveStationForGuild(event.guildId, event.stationKey, eventLanguage);
  if (!stationResult.ok) {
    patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
    log(
      "ERROR",
      `[${runtime.config.name}] Event ${event.id} konnte nicht starten: ${stationResult.message}`
    );
    return;
  }

  try {
    const scheduledStopAtMs = runtime.getScheduledEventEndAtMs(event, event.runAtMs);
    const activeOccurrenceEvent = scheduledStopAtMs > 0
      ? { ...event, activeUntilMs: scheduledStopAtMs }
      : event;
    const eventEndLabel = scheduledStopAtMs > 0
      ? formatDateTime(scheduledStopAtMs, eventLanguage, event.timeZone)
      : "-";
    const eventTimeZone = normalizeEventTimeZone(event.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
    let startedBy = runtime.config.name;
    if (runtime.role === "commander" && runtime.workerManager) {
      const guildTier = getTier(event.guildId);
      const worker = await pickScheduledEventWorker(runtime, eventGuild, event, guildTier);
      if (!worker) {
        patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
        log(
          "WARN",
          `[${runtime.config.name}] Event ${event.id} wartet auf freien Worker (guild=${event.guildId}, tier=${guildTier}).`
        );
        return;
      }

      const rawStageTopic = renderStageTopic(event.stageTopic, {
        event: event.name,
        station: stationResult.station?.name || event.stationKey,
        time: formatDateTime(event.runAtMs, eventLanguage, event.timeZone),
        end: eventEndLabel,
        timeZone: eventTimeZone,
      });
      const stageTopic = clipText(await runtime.resolveGuildEmojiAliases(rawStageTopic, eventGuild), 120);
      const delegatedResult = await worker.playInGuild(
        event.guildId,
        event.voiceChannelId,
        stationResult.key,
        stationResult.stations,
        undefined,
        {
          stageTopic,
          guildScheduledEventId: event.discordScheduledEventId || null,
          createStageInstance: true,
          scheduledEventId: event.id,
          scheduledEventStopAtMs: scheduledStopAtMs,
        }
      );
      if (!delegatedResult.ok) {
        throw new Error(delegatedResult.error || "Worker konnte Event nicht starten.");
      }
      startedBy = delegatedResult.workerName || worker.config.name;
    } else {
      const rawStageTopic = renderStageTopic(event.stageTopic, {
        event: event.name,
        station: stationResult.station?.name || event.stationKey,
        time: formatDateTime(event.runAtMs, eventLanguage, event.timeZone),
        end: eventEndLabel,
        timeZone: eventTimeZone,
      });
      const stageTopic = clipText(await runtime.resolveGuildEmojiAliases(rawStageTopic, eventGuild), 120);
      const localResult = await runtime.playInGuild(
        event.guildId,
        event.voiceChannelId,
        stationResult.key,
        stationResult.stations,
        undefined,
        {
          stageTopic,
          guildScheduledEventId: event.discordScheduledEventId || null,
          createStageInstance: true,
          scheduledEventId: event.id,
          scheduledEventStopAtMs: scheduledStopAtMs,
        }
      );
      if (!localResult.ok) {
        throw new Error(localResult.error || "Event konnte lokal nicht gestartet werden.");
      }
      runtime.persistState();
    }

    await runtime.postScheduledEventAnnouncement(activeOccurrenceEvent, stationResult.station, eventLanguage);

    const nextRunAtMs = computeNextEventRunAtMs(event.runAtMs, event.repeat, now, event.timeZone);
    if (nextRunAtMs) {
      let nextDiscordScheduledEventId = event.discordScheduledEventId || null;
      if (event.createDiscordEvent) {
        try {
          const nextDiscordEvent = await runtime.syncDiscordScheduledEvent(event, stationResult.station, {
            runAtMs: nextRunAtMs,
            forceCreate: false,
          });
          nextDiscordScheduledEventId = nextDiscordEvent?.id || nextDiscordScheduledEventId;
        } catch (syncErr) {
          log(
            "WARN",
            `[${runtime.config.name}] Discord-Server-Event konnte nicht auf Folgetermin gesetzt werden (guild=${event.guildId}, id=${event.id}): ${syncErr?.message || syncErr}`
          );
        }
      }

      patchScheduledEvent(event.id, {
        runAtMs: nextRunAtMs,
        lastRunAtMs: now,
        enabled: true,
        activeUntilMs: scheduledStopAtMs > 0 ? scheduledStopAtMs : 0,
        deleteAfterStop: false,
        discordScheduledEventId: nextDiscordScheduledEventId,
      });
    } else if (scheduledStopAtMs > 0) {
      patchScheduledEvent(event.id, {
        lastRunAtMs: now,
        activeUntilMs: scheduledStopAtMs,
        enabled: true,
        deleteAfterStop: true,
      });
    } else {
      deleteScheduledEvent(event.id, { guildId: event.guildId, botId: runtime.config.id });
    }

    log(
      "INFO",
      `[${runtime.config.name}] Event gestartet: guild=${event.guildId} id=${event.id} station=${stationResult.key} via=${startedBy}`
    );
  } catch (err) {
    patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
    log(
      "ERROR",
      `[${runtime.config.name}] Event ${event.id} Startfehler: ${err?.message || err}`
    );
  }
}

export async function executeScheduledEventStop(runtime, event) {
  if (runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }
  const stopAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10);
  if (!Number.isFinite(stopAtMs) || stopAtMs <= 0) return;

  let stoppedBy = null;
  let stopped = false;

  const localState = runtime.guildState.get(event.guildId);
  if (localState?.activeScheduledEventId === event.id) {
    const result = await runtime.stopInGuild(event.guildId);
    stopped = Boolean(result?.ok);
    stoppedBy = runtime.config.name;
  }

  if (!stopped && runtime.workerManager) {
    const worker = runtime.workerManager.findWorkerByScheduledEvent(event.guildId, event.id);
    if (worker) {
      const result = await worker.stopInGuild(event.guildId);
      stopped = Boolean(result?.ok);
      stoppedBy = worker.config?.name || "Worker";
    }
  }

  if (event.deleteAfterStop) {
    deleteScheduledEvent(event.id, { guildId: event.guildId, botId: runtime.config.id });
  } else {
    patchScheduledEvent(event.id, {
      activeUntilMs: 0,
      lastStopAtMs: Date.now(),
      deleteAfterStop: false,
    });
  }

  log(
    "INFO",
    `[${runtime.config.name}] Event beendet: guild=${event.guildId} id=${event.id} stopped=${stopped ? "yes" : "no"} via=${stoppedBy || "state-cleanup"}`
  );
}

export async function tickScheduledEvents(runtime, ) {
  if (!EVENT_SCHEDULER_ENABLED) return;
  if (!runtime.client.isReady()) return;

  if (runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }

  const now = Date.now();
  const scheduled = listScheduledEvents({
    botId: runtime.config.id,
    includeDisabled: true,
  });
  const events = Array.isArray(scheduled) ? scheduled : [];

  for (const event of events) {
    const stopAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10);
    const alreadyStoppedAt = Number.parseInt(String(event?.lastStopAtMs || 0), 10);
    if (!Number.isFinite(stopAtMs) || stopAtMs <= 0) continue;
    if (alreadyStoppedAt >= stopAtMs) continue;
    if (stopAtMs > now + 1000) continue;
    if (runtime.scheduledEventInFlight.has(`${event.id}:stop`)) continue;

    runtime.scheduledEventInFlight.add(`${event.id}:stop`);
    try {
      // eslint-disable-next-line no-await-in-loop
      await runtime.executeScheduledEventStop(event);
    } finally {
      runtime.scheduledEventInFlight.delete(`${event.id}:stop`);
    }
  }

  for (const event of events) {
    if (!event.enabled) continue;
    if (event.runAtMs > now + 1000) continue;
    if (event.lastRunAtMs && event.lastRunAtMs >= event.runAtMs) continue;
    if (runtime.scheduledEventInFlight.has(event.id)) continue;

    runtime.scheduledEventInFlight.add(event.id);
    try {
      // eslint-disable-next-line no-await-in-loop
      await runtime.executeScheduledEvent(event);
    } finally {
      runtime.scheduledEventInFlight.delete(event.id);
    }
  }
}

export function startEventScheduler(runtime, ) {
  if (!EVENT_SCHEDULER_ENABLED) return;
  if (runtime.eventSchedulerTimer) return;

  const run = () => {
    runtime.tickScheduledEvents().catch((err) => {
      log("ERROR", `[${runtime.config.name}] Event-Scheduler Fehler: ${err?.message || err}`);
    });
  };

  run();
  runtime.eventSchedulerTimer = setInterval(run, EVENT_SCHEDULER_POLL_MS);
}

export function stopEventScheduler(runtime, ) {
  if (runtime.eventSchedulerTimer) {
    clearInterval(runtime.eventSchedulerTimer);
    runtime.eventSchedulerTimer = null;
  }
  runtime.scheduledEventInFlight.clear();
}
