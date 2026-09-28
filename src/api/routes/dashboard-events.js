import { getServerLimit } from "../../core/entitlements.js";

export function createDashboardEventsRouteHandler(deps) {
  const {
    buildDashboardDiscordSyncPatch,
    buildDashboardEventConflicts,
    buildDashboardEventResponse,
    buildDashboardSchedulePreviewRows,
    createScheduledEvent,
    deleteScheduledEvent,
    getDashboardRequestTranslator,
    getDashboardSession,
    getLocalizedJsonBodyError,
    getRepeatLabel,
    getScheduledEvent,
    getTier,
    languagePick,
    listScheduledEvents,
    log,
    methodNotAllowed,
    normalizeDashboardEventInput,
    patchScheduledEvent,
    resolveDashboardGuildForSession,
    resolveRuntimeForGuild,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
    translateScheduledEventStoreMessage,
    validateDashboardEventChannels,
  } = deps;

  return async function handleDashboardEventsRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;
    const dashboardEventMatch = requestUrl.pathname.match(/^\/api\/dashboard\/events\/([^/]+)$/);

    if (
      requestUrl.pathname !== "/api/dashboard/events/preview"
      && requestUrl.pathname !== "/api/dashboard/events"
      && !dashboardEventMatch
    ) {
      return false;
    }

    if (requestUrl.pathname === "/api/dashboard/events/preview") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }

      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }
      if (!serverHasCapability(guild.id, "event_scheduler")) {
        sendLocalizedError(res, 403, language, "Events sind erst ab Pro verfügbar.", "Events are only available from Pro.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const eventId = String(body?.eventId || body?.id || "").trim();
        const existingEvent = eventId ? getScheduledEvent(eventId) : null;
        if (existingEvent && String(existingEvent.guildId || "") !== guild.id) {
          sendJson(res, 404, { error: translateScheduledEventStoreMessage("Event nicht gefunden.", language) });
          return true;
        }

        const { runtime, guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
        if (!runtime || !managedGuild) {
          sendLocalizedError(res, 400, language, "Der Bot ist auf diesem Server aktuell nicht verfügbar.", "The bot is currently unavailable on this server.");
          return true;
        }

        const normalized = await normalizeDashboardEventInput(body, {
          guildId: guild.id,
          botId: existingEvent?.botId || runtime?.config?.id || "",
          runtime,
          existingEvent,
          language,
        });
        if (!normalized.ok) {
          sendJson(res, 400, { error: normalized.message });
          return true;
        }

        const channelValidation = await validateDashboardEventChannels(runtime, managedGuild, normalized.event, language);
        if (!channelValidation.ok) {
          sendJson(res, 400, { error: channelValidation.message });
          return true;
        }

        const previewEvent = {
          ...normalized.event,
          id: existingEvent?.id || "",
          createdAt: existingEvent?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const conflicts = buildDashboardEventConflicts(
          previewEvent,
          listScheduledEvents({ guildId: guild.id }),
          { language, ignoreEventId: existingEvent?.id || "" }
        );

        sendJson(res, 200, {
          success: true,
          serverId: guild.id,
          event: {
            ...buildDashboardEventResponse(previewEvent),
            stationName: normalized.station?.station?.name || normalized.station?.key || previewEvent.stationKey,
          },
          schedule: {
            nextRuns: buildDashboardSchedulePreviewRows(previewEvent, 5),
            repeatLabelDe: getRepeatLabel(previewEvent.repeat || "none", "de", { runAtMs: previewEvent.runAtMs, timeZone: previewEvent.timeZone }),
            repeatLabelEn: getRepeatLabel(previewEvent.repeat || "none", "en", { runAtMs: previewEvent.runAtMs, timeZone: previewEvent.timeZone }),
            hasConflicts: conflicts.length > 0,
          },
          conflicts,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Event-Vorschau konnte nicht erstellt werden.", "Event preview could not be generated.");
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/events") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }
      if (!serverHasCapability(guild.id, "event_scheduler")) {
        sendLocalizedError(res, 403, language, "Events sind erst ab Pro verfügbar.", "Events are only available from Pro.");
        return true;
      }

      if (req.method === "GET") {
        const events = listScheduledEvents({ guildId: guild.id }).map((eventRow) => buildDashboardEventResponse(eventRow));
        sendJson(res, 200, { serverId: guild.id, events });
        return true;
      }

      if (req.method === "POST") {
        try {
          const body = await readJsonBody();
          const { runtime, guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
          if (!runtime || !managedGuild) {
            sendLocalizedError(res, 400, language, "Der Bot ist auf diesem Server aktuell nicht verfügbar.", "The bot is currently unavailable on this server.");
            return true;
          }

          const normalized = await normalizeDashboardEventInput(body, {
            guildId: guild.id,
            botId: runtime?.config?.id || "",
            runtime,
            language,
          });
          if (!normalized.ok) {
            sendJson(res, 400, { error: normalized.message });
            return true;
          }

          const channelValidation = await validateDashboardEventChannels(runtime, managedGuild, normalized.event, language);
          if (!channelValidation.ok) {
            sendJson(res, 400, { error: channelValidation.message });
            return true;
          }

          if (runtime.role === "commander" && runtime.workerManager && normalized.event.enabled !== false) {
            const invitedWorkers = runtime.workerManager.getInvitedWorkers(guild.id, getTier(guild.id));
            if (!invitedWorkers.length) {
              sendJson(res, 400, {
                error: languagePick(
                  language,
                  "Kein geeigneter Worker-Bot ist auf diesem Server eingeladen. Bitte zuerst einen Worker mit /invite worker:1 einladen.",
                  "No suitable worker bot is invited to this server yet. Please invite a worker first with /invite worker:1."
                ),
              });
              return true;
            }
          }

          // Free has one scheduled event, Pro and Ultimate as many as they like (#413).
          const eventLimit = getServerLimit(guild.id, "events");
          if (eventLimit !== null && listScheduledEvents({ guildId: guild.id }).length >= eventLimit) {
            sendJson(res, 403, {
              error: languagePick(
                language,
                `Mit Free geht ${eventLimit} geplantes Event. Lösch das vorhandene oder hol dir Pro für beliebig viele.`,
                `Free comes with ${eventLimit} scheduled event. Delete the one you have, or get Pro for as many as you like.`
              ),
              code: "event_limit",
              limit: eventLimit,
            });
            return true;
          }

          const result = createScheduledEvent({
            ...normalized.event,
            discordScheduledEventId: null,
            discordSyncError: null,
            activeUntilMs: 0,
            deleteAfterStop: false,
            createdByUserId: session?.user?.id || null,
          });
          if (!result?.ok || !result?.event) {
            sendJson(res, 400, {
              error: translateScheduledEventStoreMessage(
                result?.message || languagePick(language, "Event konnte nicht erstellt werden.", "Event could not be created."),
                language
              ),
            });
            return true;
          }

          let replyEvent = result.event;
          const shouldSyncDiscordEvent = replyEvent.createDiscordEvent === true && replyEvent.enabled !== false;
          if (shouldSyncDiscordEvent) {
            try {
              const scheduledEvent = await runtime.syncDiscordScheduledEvent(replyEvent, normalized.station.station, {
                runAtMs: replyEvent.runAtMs,
              });
              const synced = patchScheduledEvent(
                replyEvent.id,
                buildDashboardDiscordSyncPatch(replyEvent, {
                  discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                  discordSyncError: null,
                })
              );
              replyEvent = synced?.event || {
                ...replyEvent,
                ...buildDashboardDiscordSyncPatch(replyEvent, {
                  discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                  discordSyncError: null,
                }),
              };
            } catch (err) {
              const syncPatch = buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: replyEvent.discordScheduledEventId || null,
                discordSyncError: err?.message || err,
              });
              const patched = patchScheduledEvent(replyEvent.id, syncPatch);
              replyEvent = patched?.event || { ...replyEvent, ...syncPatch };
              log("WARN", `[dashboard] Event ${replyEvent.id}: Discord-Server-Event konnte nicht erstellt werden: ${err?.message || err}`);
            }
          }

          if (replyEvent.enabled && replyEvent.runAtMs <= Date.now() + 5_000) {
            runtime.queueImmediateScheduledEventTick(250);
          }

          sendJson(res, 200, {
            success: true,
            event: buildDashboardEventResponse(replyEvent),
          });
        } catch (err) {
          const status = Number(err?.status || 0);
          if (status === 400 || status === 413) {
            sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
            return true;
          }
          sendLocalizedError(res, 500, language, "Event konnte nicht erstellt werden.", "Event could not be created.");
        }
        return true;
      }

      methodNotAllowed(res, ["GET", "POST"]);
      return true;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    const { session } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }

    const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guild) {
      sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
      return true;
    }
    if (!serverHasCapability(guild.id, "event_scheduler")) {
      sendLocalizedError(res, 403, language, "Events sind erst ab Pro verfügbar.", "Events are only available from Pro.");
      return true;
    }

    const eventId = decodeURIComponent(dashboardEventMatch[1] || "").trim();
    if (!eventId) {
      sendLocalizedError(res, 400, language, "Event-ID fehlt.", "Event ID is missing.");
      return true;
    }

    if (req.method === "PATCH") {
      try {
        const existingEvent = getScheduledEvent(eventId);
        if (!existingEvent || String(existingEvent.guildId || "") !== guild.id) {
          sendJson(res, 404, { error: translateScheduledEventStoreMessage("Event nicht gefunden.", language) });
          return true;
        }

        const body = await readJsonBody();
        const { runtime, guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
        if (!runtime || !managedGuild) {
          sendLocalizedError(res, 400, language, "Der Bot ist auf diesem Server aktuell nicht verfügbar.", "The bot is currently unavailable on this server.");
          return true;
        }

        const normalized = await normalizeDashboardEventInput(body, {
          guildId: guild.id,
          botId: existingEvent.botId || runtime?.config?.id || "",
          runtime,
          existingEvent,
          language,
        });
        if (!normalized.ok) {
          sendJson(res, 400, { error: normalized.message });
          return true;
        }

        const channelValidation = await validateDashboardEventChannels(runtime, managedGuild, normalized.event, language);
        if (!channelValidation.ok) {
          sendJson(res, 400, { error: channelValidation.message });
          return true;
        }

        if (runtime.role === "commander" && runtime.workerManager && normalized.event.enabled !== false) {
          const invitedWorkers = runtime.workerManager.getInvitedWorkers(guild.id, getTier(guild.id));
          if (!invitedWorkers.length) {
            sendJson(res, 400, {
              error: languagePick(
                language,
                "Kein geeigneter Worker-Bot ist auf diesem Server eingeladen. Bitte zuerst einen Worker mit /invite worker:1 einladen.",
                "No suitable worker bot is invited to this server yet. Please invite a worker first with /invite worker:1."
              ),
            });
            return true;
          }
        }

        const eventIsActive = Number.parseInt(String(existingEvent.activeUntilMs || 0), 10) > Date.now()
          && Number.parseInt(String(existingEvent.lastStopAtMs || 0), 10) < Number.parseInt(String(existingEvent.activeUntilMs || 0), 10);
        const result = patchScheduledEvent(eventId, {
          ...normalized.event,
          activeUntilMs: eventIsActive ? normalized.parsedWindow.endAtMs : 0,
        });
        if (!result?.ok || !result?.event) {
          sendJson(res, result?.message === "Event nicht gefunden." ? 404 : 400, {
            error: translateScheduledEventStoreMessage(
              result?.message || languagePick(language, "Event konnte nicht aktualisiert werden.", "Event could not be updated."),
              language
            ),
          });
          return true;
        }

        let replyEvent = result.event;
        const shouldSyncDiscordEvent = replyEvent.createDiscordEvent === true && replyEvent.enabled !== false;
        if (!shouldSyncDiscordEvent && existingEvent.discordScheduledEventId) {
          await runtime.deleteDiscordScheduledEventById(guild.id, existingEvent.discordScheduledEventId).catch(() => false);
          const cleared = patchScheduledEvent(
            eventId,
            buildDashboardDiscordSyncPatch(replyEvent, {
              discordScheduledEventId: null,
              discordSyncError: null,
            })
          );
          replyEvent = cleared?.event || {
            ...replyEvent,
            ...buildDashboardDiscordSyncPatch(replyEvent, {
              discordScheduledEventId: null,
              discordSyncError: null,
            }),
          };
        } else if (shouldSyncDiscordEvent) {
          try {
            const scheduledEvent = await runtime.syncDiscordScheduledEvent(replyEvent, normalized.station.station || { name: replyEvent.stationKey }, {
              runAtMs: replyEvent.runAtMs,
            });
            const synced = patchScheduledEvent(
              eventId,
              buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                discordSyncError: null,
              })
            );
            replyEvent = synced?.event || {
              ...replyEvent,
              ...buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                discordSyncError: null,
              }),
            };
          } catch (err) {
            const syncPatch = buildDashboardDiscordSyncPatch(replyEvent, {
              discordScheduledEventId: replyEvent.discordScheduledEventId || null,
              discordSyncError: err?.message || err,
            });
            const patched = patchScheduledEvent(eventId, syncPatch);
            replyEvent = patched?.event || { ...replyEvent, ...syncPatch };
            log("WARN", `[dashboard] Event ${eventId}: Discord-Server-Event Sync fehlgeschlagen: ${err?.message || err}`);
          }
        } else if (!replyEvent.createDiscordEvent && (replyEvent.discordScheduledEventId || replyEvent.discordSyncError)) {
          const cleared = patchScheduledEvent(
            eventId,
            buildDashboardDiscordSyncPatch(replyEvent, {
              discordScheduledEventId: null,
              discordSyncError: null,
            })
          );
          replyEvent = cleared?.event || {
            ...replyEvent,
            ...buildDashboardDiscordSyncPatch(replyEvent, {
              discordScheduledEventId: null,
              discordSyncError: null,
            }),
          };
        }

        if (replyEvent.enabled && replyEvent.runAtMs <= Date.now() + 5_000) {
          runtime.queueImmediateScheduledEventTick(250);
        }

        sendJson(res, 200, { success: true, event: buildDashboardEventResponse(replyEvent) });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Event konnte nicht aktualisiert werden.", "Event could not be updated.");
      }
      return true;
    }

    if (req.method === "DELETE") {
      const existingEvent = getScheduledEvent(eventId);
      if (!existingEvent || String(existingEvent.guildId || "") !== guild.id) {
        sendJson(res, 404, { error: translateScheduledEventStoreMessage("Event nicht gefunden.", language) });
        return true;
      }

      const { runtime } = resolveRuntimeForGuild(runtimes, guild.id);
      if (
        runtime
        && Number.parseInt(String(existingEvent.activeUntilMs || 0), 10) > Date.now()
        && Number.parseInt(String(existingEvent.lastStopAtMs || 0), 10) < Number.parseInt(String(existingEvent.activeUntilMs || 0), 10)
      ) {
        await runtime.executeScheduledEventStop({ ...existingEvent, deleteAfterStop: false });
      }

      let removedDiscordEvent = false;
      if (runtime && existingEvent.discordScheduledEventId) {
        removedDiscordEvent = await runtime.deleteDiscordScheduledEventById(guild.id, existingEvent.discordScheduledEventId).catch(() => false);
      }

      const result = deleteScheduledEvent(eventId, { guildId: guild.id });
      if (!result?.ok) {
        sendJson(res, result?.message === "Event nicht gefunden." ? 404 : 400, {
          error: translateScheduledEventStoreMessage(
            result?.message || languagePick(language, "Event konnte nicht gelöscht werden.", "Event could not be deleted."),
            language
          ),
        });
        return true;
      }

      sendJson(res, 200, { success: true, eventId, removedDiscordEvent });
      return true;
    }

    methodNotAllowed(res, ["PATCH", "DELETE"]);
    return true;
  };
}
