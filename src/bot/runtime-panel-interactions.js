// OmniFM: the buttons and menus of the play wizard and the station browser.
// Split out of src/bot/runtime-panels.js (#295).
import { MessageFlags } from "discord.js";
import { getTier } from "../core/entitlements.js";
import {
  PLAY_COMPONENT_PREFIX,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_PREFIX,
  STATIONS_COMPONENT_ID_OPEN,
} from "./runtime-links.js";
import * as ui from "../discord/ui/index.js";
import { buildNoticePayload } from "./commands/command-helpers.js";
import { applyFavoritePageSelection } from "../lib/favorite-stations.js";
import { buildStationSearchModal, parsePickTarget } from "./station-browser.js";
import {
  buildBrowserNotice,
  buildPanelClosedPayload,
  buildRuntimePlayWizardPayload,
  buildRuntimeStationsBrowserPayload,
  openRuntimePlayWizard,
  openRuntimeStationsBrowser,
  parsePanelCustomId,
} from "./runtime-panels.js";
import { executeRuntimePlay, respondWithPayload } from "./runtime-play.js";

export async function handleRuntimePanelInteraction(runtime, interaction) {
  const { t } = runtime.createInteractionTranslator(interaction);
  const customId = String(interaction.customId || "");

  if (customId === PLAY_COMPONENT_ID_OPEN) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = await openRuntimePlayWizard(runtime, interaction);
    await respondWithPayload(runtime, interaction, payload);
    return true;
  }
  if (customId === STATIONS_COMPONENT_ID_OPEN) {
    // Built from memory in milliseconds: answered directly, so the Components
    // V2 browser is the reply itself (#268).
    const payload = await openRuntimeStationsBrowser(runtime, interaction);
    await interaction.reply(payload);
    return true;
  }

  const playAction = parsePanelCustomId(customId, PLAY_COMPONENT_PREFIX);
  if (playAction?.action) {
    const session = runtime.getInteractiveUiSession(playAction.sessionId, {
      type: "play",
      guildId: interaction.guildId,
      userId: interaction.user?.id,
    });
    if (!session) {
      const payload = buildPanelClosedPayload(
        runtime.resolveInteractionLanguage(interaction),
        t("Sitzung abgelaufen", "Session expired"),
        t("Diese Schnellstart-Ansicht ist nicht mehr gültig. Öffne sie bitte erneut.", "This quick-start view is no longer valid. Please open it again.")
      );
      await respondWithPayload(runtime, interaction, payload, { update: true });
      return true;
    }

    if (playAction.action === "station" && interaction.isStringSelectMenu?.()) {
      const stationKey = interaction.values?.[0] === "__none__" ? null : (interaction.values?.[0] || null);
      runtime.updateInteractiveUiSession(session.id, { data: { stationKey } });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, nextSession));
      return true;
    }

    if (playAction.action === "channel" && interaction.isStringSelectMenu?.()) {
      const channelId = interaction.values?.[0] === "__none__" ? null : (interaction.values?.[0] || null);
      runtime.updateInteractiveUiSession(session.id, { data: { channelId } });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, nextSession));
      return true;
    }

    if (playAction.action === "worker" && interaction.isStringSelectMenu?.()) {
      const raw = interaction.values?.[0] || "auto";
      const workerIndex = raw === "auto" ? null : (Number.parseInt(String(raw), 10) || null);
      runtime.updateInteractiveUiSession(session.id, { data: { workerIndex } });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, nextSession));
      return true;
    }

    if (playAction.action === "refresh") {
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, session));
      return true;
    }

    if (playAction.action === "browse") {
      const payload = await openRuntimeStationsBrowser(runtime, interaction, {
        stationKey: session.data.stationKey || null,
        hint: t("Wähle einen Sender und öffne dann wieder den Schnellstart.", "Pick a station and then reopen quick start."),
      });
      await interaction.update(payload);
      return true;
    }

    if (playAction.action === "close") {
      runtime.deleteInteractiveUiSession(session.id);
      await interaction.update(buildPanelClosedPayload(
        runtime.resolveInteractionLanguage(interaction),
        t("Schnellstart geschlossen", "Quick start closed"),
        t("Du kannst `/play` oder die Buttons aus `/help` jederzeit erneut nutzen.", "You can reopen this any time with `/play` or the buttons from `/help`.")
      ));
      return true;
    }

    if (playAction.action === "start") {
      // The quick start is reachable from buttons without /play, so it checks
      // the /perm rule of /play itself (#232).
      if (typeof runtime.checkCommandRolePermission === "function") {
        const permission = runtime.checkCommandRolePermission(interaction, "play");
        if (!permission?.ok) {
          await interaction.reply({
            content: permission?.message || t("Dafür fehlen dir die Rechte.", "You are not allowed to do that."),
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }
      }
      await interaction.deferUpdate();
      await executeRuntimePlay(runtime, interaction, {
        station: session.data.stationKey,
        requestedVoiceChannelId: session.data.channelId,
        requestedBotIndex: session.data.workerIndex,
        openWizardWhenIncomplete: true,
        wizardHint: t("Für den Start fehlen noch Angaben. Ergänze sie direkt hier.", "Some selections are still missing. Complete them right here."),
      });
      return true;
    }
  }

  const stationsAction = parsePanelCustomId(customId, STATIONS_COMPONENT_PREFIX);
  if (stationsAction?.action) {
    const pick = stationsAction.action === "pick" ? parsePickTarget(stationsAction.sessionId) : null;
    const sessionId = pick ? pick.sessionId : stationsAction.sessionId;
    const session = runtime.getInteractiveUiSession(sessionId, {
      type: "stations",
      guildId: interaction.guildId,
      userId: interaction.user?.id,
    });
    const onV2Message = ui.isComponentsV2Message(interaction.message);
    if (!session) {
      const title = t("Sitzung abgelaufen", "Session expired");
      const body = t("Dieser Sender-Browser ist nicht mehr gültig. Öffne ihn mit `/stations` neu.", "This station browser is no longer valid. Open it again with `/stations`.");
      if (onV2Message && typeof interaction.update === "function") {
        await interaction.update(buildBrowserNotice(t, "info", title, body));
      } else {
        await respondWithPayload(runtime, interaction, buildPanelClosedPayload(runtime.resolveInteractionLanguage(interaction), title, body), { update: true });
      }
      return true;
    }

    const rerender = async (patch = null) => {
      if (patch) runtime.updateInteractiveUiSession(session.id, { data: patch });
      await interaction.update(buildRuntimeStationsBrowserPayload(runtime, interaction, runtime.getInteractiveUiSession(session.id)));
    };

    if (stationsAction.action === "genre" && interaction.isStringSelectMenu?.()) {
      const value = interaction.values?.[0] || "__all__";
      await rerender({ genre: value === "__all__" ? null : value, page: 0 });
      return true;
    }
    if (stationsAction.action === "page-prev" || stationsAction.action === "page-next") {
      const delta = stationsAction.action === "page-prev" ? -1 : 1;
      await rerender({ page: Math.max(0, (Number.parseInt(String(session.data?.page ?? 0), 10) || 0) + delta) });
      return true;
    }
    if (stationsAction.action === "reset") {
      await rerender({ genre: null, query: "", page: 0 });
      return true;
    }
    if (stationsAction.action === "refresh") {
      await rerender();
      return true;
    }
    if (stationsAction.action === "search") {
      await interaction.showModal(buildStationSearchModal({
        t,
        prefix: STATIONS_COMPONENT_PREFIX,
        sessionId: session.id,
        query: session.data?.query || "",
      }));
      return true;
    }
    if (stationsAction.action === "searchform" && interaction.isModalSubmit?.()) {
      const query = String(interaction.fields?.getTextInputValue?.("query") || "").trim().slice(0, 60);
      await rerender({ query, page: 0 });
      return true;
    }
    if (stationsAction.action === "pick") {
      const stationKey = pick?.stationKey;
      const memberChannelId = interaction.member?.voice?.channelId || null;
      if (!stationKey) {
        await interaction.reply(buildBrowserNotice(t, "error", t("Sender nicht gefunden", "Station not found"), t("Öffne den Browser neu.", "Open the browser again.")));
        return true;
      }
      if (memberChannelId) {
        // In a voice channel: play right there, like /play does.
        await executeRuntimePlay(runtime, interaction, {
          station: stationKey,
          requestedVoiceChannelId: memberChannelId,
          openWizardWhenIncomplete: true,
        });
        return true;
      }
      // Not in a voice channel: the quick start with the station chosen, as
      // its own private message.
      const payload = await openRuntimePlayWizard(runtime, interaction, {
        stationKey,
        hint: t("Geh in einen Sprachkanal oder wähle unten einen aus.", "Join a voice channel or choose one below."),
      });
      await interaction.reply(payload);
      return true;
    }
    if (stationsAction.action === "fav" && interaction.isStringSelectMenu?.()) {
      if (!runtime.canEditFavorites?.(interaction)) {
        await interaction.reply(buildNoticePayload({ t, language: runtime.resolveInteractionLanguage(interaction), code: "manage-server-required" }));
        return true;
      }
      const pageKeys = (interaction.component?.options || []).map((option) => option.value);
      const change = applyFavoritePageSelection(session.data?.favorites || [], {
        pageKeys: pageKeys.length ? pageKeys : interaction.values || [],
        selectedKeys: interaction.values || [],
      }, getTier(interaction.guildId));
      const saved = await runtime.saveFavoriteStations(interaction.guildId, change.list);
      const limit = runtime.favoriteLimitForGuild?.(interaction.guildId) || 3;
      let hint;
      if (!saved?.ok) {
        hint = t("Die Favoriten konnte ich gerade nicht speichern. Versuch es gleich noch einmal.", "I could not save the favourites right now. Please try again in a moment.");
      } else if (change.refused.length) {
        hint = t(
          "Mehr als {limit} Favoriten gehen mit deinem Plan nicht. Nimm erst einen anderen heraus.",
          "Your plan allows {limit} favourites. Remove another one first.",
          { limit }
        );
      } else {
        hint = t("⭐ Gespeichert: {count} Favoriten. Sie erscheinen im Now-Playing-Panel.", "⭐ Saved: {count} favourites. They show up in the now-playing panel.", { count: change.list.length });
      }
      runtime.updateInteractiveUiSession(session.id, { data: { favorites: saved?.ok ? saved.list : session.data?.favorites || [] } });
      await interaction.update(buildRuntimeStationsBrowserPayload(runtime, interaction, runtime.getInteractiveUiSession(session.id), { hint }));
      return true;
    }
    if (stationsAction.action === "close") {
      runtime.deleteInteractiveUiSession(session.id);
      const title = t("Sender-Browser geschlossen", "Station browser closed");
      const body = t("Mit `/stations` öffnest du ihn wieder.", "Use `/stations` to open it again.");
      if (onV2Message) await interaction.update(buildBrowserNotice(t, "info", title, body));
      else await interaction.update(buildPanelClosedPayload(runtime.resolveInteractionLanguage(interaction), title, body));
      return true;
    }
  }

  return false;
}
