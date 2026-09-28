// OmniFM: the buttons under the now-playing message.
// BotRuntime methods, split out of src/bot/now-playing/now-playing-methods.js (#295) and mixed in with it.
import { MessageFlags } from "discord.js";
import { runRuntimeFailbackProbe, keepRuntimeFailoverStation } from "../runtime-streams.js";
import { NP_PREFIX } from "../runtime-shared.js";
import { ADVENT_LABELS } from "../../config/advent-doors.js";
import { adventDoorFor, adventLanguage, adventStationTip, buildAdventDoor } from "../advent-calendar.js";
import { buildStationCatalog } from "../runtime-panels.js";
import { ownerSettings } from "../../lib/owner-settings-cache.js";

const nowPlayingControlMethods = {
  // #428: the door opens for everyone, the answer is private; "Play now" only with the /play right.
  async handleAdventDoor(interaction) {
    const guildId = interaction.guildId;
    const settings = await this.loadGuildSettingsCached?.(guildId).catch(() => null);
    const day = adventDoorFor({ guildId, settings: settings || {}, owner: ownerSettings()?.seasons });
    const language = adventLanguage(interaction.locale);
    if (!day) {
      await interaction.reply({ content: (ADVENT_LABELS[language] || ADVENT_LABELS.en).closed, flags: MessageFlags.Ephemeral });
      return true;
    }
    const { stationsData } = buildStationCatalog(guildId);
    const permission = this.checkCommandRolePermission?.(interaction, "play");
    await interaction.reply(buildAdventDoor({
      day,
      language,
      tip: adventStationTip(stationsData?.stations || {}, day),
      canPlay: !permission || permission.ok === true,
    }));
    return true;
  },

  // Live-Steuerung direkt aus der Now-Playing-Nachricht (Buttons).
  async handleNowPlayingControl(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: t("Nur in Servern verfuegbar.", "Only available in servers."), flags: MessageFlags.Ephemeral });
      return true;
    }
    const action = String(interaction.customId || "").slice(NP_PREFIX.length);
    // "Share" (#282): the now-playing card, posted in the channel.
    if (action === "share") return this.handleShareCardControl(interaction);
    // #428: today's door of the Advent calendar, only for whoever opens it.
    if (action === "advent") return this.handleAdventDoor(interaction);
    // "Report a problem" (#273): the form, then the report for the owner.
    if (action === "report") return this.showProblemReportForm(interaction);
    if (action === "reportform" && interaction.isModalSubmit?.()) return this.handleProblemReportSubmit(interaction);
    // A favourite button (#276) switches the station, under the /play rule.
    if (action.startsWith("fav:")) return this.handleFavoriteControl(interaction, action.slice(4));
    // "💾 Save" (#272) is personal: no role rule, its own answer.
    if (action === "save") return this.handleSaveSongControl(interaction);
    // The sleep warning's buttons (#275) change that message in place.
    if (action === "sleepextend" || action === "sleepoff") return this.handleSleepControl(interaction, action);
    // Discord requires an acknowledgement within three seconds. Voice/player
    // operations and the embed refresh can take longer, so acknowledge first.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = this.guildState.get(guildId);

    // A button does what its slash command does, so it follows the same /perm
    // role rules; before, anyone who saw the message could stop the stream (#232).
    const statusBefore = state?.player?.state?.status;
    const buttonCommand = {
      toggle: statusBefore === "paused" || statusBefore === "autopaused" ? "resume" : "pause",
      stop: "stop",
      volup: "setvolume",
      voldown: "setvolume",
      failback: "play",
      keepstation: "play",
    }[action];
    if (buttonCommand && typeof this.checkCommandRolePermission === "function") {
      const permission = this.checkCommandRolePermission(interaction, buttonCommand);
      if (!permission?.ok) {
        await interaction.editReply({ content: permission?.message || t("Dafür fehlen dir die Rechte.", "You are not allowed to do that.") });
        return true;
      }
    }

    // Every branch below sets it or returns.
    let result;
    let msg = "";

    if (action === "toggle") {
      const status = state?.player?.state?.status;
      const paused = status === "paused" || status === "autopaused";
      result = paused ? await this.resumeInGuild(guildId) : await this.pauseInGuild(guildId);
      msg = paused ? t("\u25b6 Wiedergabe fortgesetzt.", "\u25b6 Resumed.") : t("\u23f8 Pausiert.", "\u23f8 Paused.");
    } else if (action === "stop") {
      result = await this.stopInGuild(guildId);
      msg = t("\u23f9 Wiedergabe gestoppt.", "\u23f9 Playback stopped.");
    } else if (action === "volup" || action === "voldown") {
      const cur = Number(state?.volume ?? 100);
      const next = Math.max(0, Math.min(100, cur + (action === "volup" ? 10 : -10)));
      result = await this.setVolumeInGuild(guildId, next);
      msg = `\u{1f50a} ${t("Lautstaerke", "Volume")}: ${next}%`;
    } else if (action === "failback") {
      const desiredName = state?.desiredStationName || state?.desiredStationKey || "-";
      if (!state || state.failoverActive !== true) {
        result = { ok: false, error: t("Es ist gerade kein Ersatzsender aktiv.", "No backup station is active right now.") };
      } else {
        const probe = await runRuntimeFailbackProbe(this, guildId, state, { requiredConfirmations: 1 });
        if (probe?.switched) {
          result = { ok: true };
          msg = t(`\u21a9 Zurück auf ${desiredName}.`, `\u21a9 Back on ${desiredName}.`);
        } else if (probe?.abandoned) {
          result = {
            ok: false,
            error: t(
              `${desiredName} ist auf diesem Server nicht mehr verfügbar. OmniFM bleibt beim aktuellen Sender.`,
              `${desiredName} is no longer available on this server. OmniFM stays on the current station.`
            ),
          };
        } else if (probe?.skipped === "paused") {
          result = {
            ok: false,
            error: t("Die Wiedergabe ist pausiert. Setze sie fort und versuche es erneut.", "Playback is paused. Resume it and try again."),
          };
        } else if (probe?.skipped) {
          result = {
            ok: false,
            error: t(
              "OmniFM stellt die Verbindung gerade wieder her. Versuche es in einer Minute erneut.",
              "OmniFM is restoring the connection right now. Try again in a minute."
            ),
          };
        } else {
          result = {
            ok: false,
            error: t(
              `${desiredName} ist noch nicht erreichbar. OmniFM prüft automatisch weiter und wechselt zurück, sobald der Sender wieder läuft.`,
              `${desiredName} is not reachable yet. OmniFM keeps checking and switches back once the station plays again.`
            ),
          };
        }
      }
    } else if (action === "keepstation") {
      const kept = state ? keepRuntimeFailoverStation(this, guildId, state) : { ok: false };
      result = kept.ok
        ? { ok: true }
        : { ok: false, error: t("Es ist gerade kein Ersatzsender aktiv.", "No backup station is active right now.") };
      msg = t(
        `\u2714 ${state?.currentStationName || state?.currentStationKey || "-"} bleibt der Sender für diesen Server.`,
        `\u2714 ${state?.currentStationName || state?.currentStationKey || "-"} stays the station for this server.`
      );
    } else {
      await interaction.editReply({ content: t("Unbekannte Aktion.", "Unknown action.") });
      return true;
    }

    if (!result?.ok) {
      await interaction.editReply({ content: result?.error || t("Aktion fehlgeschlagen.", "Action failed.") });
      return true;
    }

    // Now-Playing-Nachricht sofort aktualisieren (Buttons/State spiegeln).
    try {
      const fresh = this.guildState.get(guildId);
      if (fresh && typeof this.updateNowPlayingEmbed === "function" && action !== "stop") {
        await this.updateNowPlayingEmbed(guildId, fresh, { force: true }).catch(() => {});
      }
    } catch { /* noop */ }

    await interaction.editReply({ content: msg });
    return true;
  },
};

export { nowPlayingControlMethods };
