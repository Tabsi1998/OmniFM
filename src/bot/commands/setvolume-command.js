// OmniFM: /setvolume.
// Split out of src/bot/commands/playback-commands.js (#295).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { clipText } from "../../lib/helpers.js";
import { getTier } from "../../core/entitlements.js";
import { WORKERS_COMPONENT_ID_OPEN } from "../runtime-links.js";
import { buildNoticePayload } from "./command-helpers.js";

/** /setvolume */
export async function handleSetvolumeCommand({ runtime, interaction, t, language }) {
  const value = interaction.options.getInteger("value", true);
  if (value < 0 || value > 100) {
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: "warning",
      title: t("🎚 Lautstärke ungültig", "🎚 Invalid volume"),
      description: t("Wert muss zwischen 0 und 100 liegen.", "Value must be between 0 and 100."),
    }));
    return;
  }
  if (runtime.role === "commander" && runtime.workerManager) {
    const requestedBot = runtime.getIntegerOptionFlexible(interaction, ["bot", "worker"]);
    const guildTier = getTier(interaction.guildId);
    let targetWorkers = [];

    if (Number.isInteger(requestedBot)) {
      const check = runtime.workerManager.canUseWorker(requestedBot, interaction.guildId, guildTier, { prefer: "slot", strict: true });
      if (!check.ok) {
        const reasons = {
          tier: t("Worker {worker} erfordert ein höheres Abo (max: {max}).", "Worker {worker} requires a higher plan (max: {max}).", { worker: requestedBot, max: check.maxIndex }),
          not_configured: t("Worker {worker} ist nicht konfiguriert.", "Worker {worker} is not configured.", { worker: requestedBot }),
          offline: t("Worker {worker} ist offline.", "Worker {worker} is offline.", { worker: requestedBot }),
          not_invited: t("Worker {worker} ist nicht auf diesem Server eingeladen.", "Worker {worker} is not invited on this server.", { worker: requestedBot }),
        };
        await runtime.respondInteraction(interaction, buildNoticePayload({
          t,
          language,
          tone: "warning",
          title: t("🤖 Worker nicht verfügbar", "🤖 Worker not available"),
          description: reasons[check.reason] || t("Worker nicht verfügbar.", "Worker not available."),
        }));
        return;
      }
      targetWorkers = [check.worker];
    } else {
      const workers = runtime.workerManager.getStreamingWorkers(interaction.guildId);
      if (workers.length === 0) {
        const invitedWorkers = runtime.workerManager.getInvitedWorkers(interaction.guildId, guildTier);
        if (invitedWorkers.length === 1) {
          targetWorkers = invitedWorkers;
        } else if (invitedWorkers.length === 0) {
          await runtime.respondInteraction(interaction, buildNoticePayload({
            t,
            language,
            tone: "warning",
            title: t("🤖 Kein Worker eingeladen", "🤖 No worker invited"),
            description: t("Kein Worker ist auf diesem Server eingeladen.", "No worker is invited on this server."),
            quickActions: { includeInvite: true, includeWorkers: true },
          }));
          return;
        } else {
          await runtime.respondInteraction(interaction, buildNoticePayload({
            t,
            language,
            tone: "info",
            title: t("🎚 Worker auswählen", "🎚 Choose a worker"),
            description: t(
              "Aktuell streamt kein Worker. Nutze `/setvolume <value> bot:<nummer>`, um die Lautstärke für einen bestimmten Worker zu speichern.",
              "No worker is currently streaming. Use `/setvolume <value> bot:<number>` to save the volume for a specific worker."
            ),
            extraComponents: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                  .setStyle(ButtonStyle.Secondary)
                  .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
              ),
            ],
          }));
          return;
        }
      }

      if (workers.length > 0) {
        const guild = interaction.guild || runtime.client.guilds.cache.get(interaction.guildId);
        const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
        const userChannelId = String(member?.voice?.channelId || "").trim();
        if (userChannelId) {
          const matchingByChannel = workers.filter((worker) => {
            const info = worker.getGuildInfo(interaction.guildId);
            return String(info?.channelId || "").trim() === userChannelId;
          });
          if (matchingByChannel.length === 1) {
            targetWorkers = matchingByChannel;
          }
        }

        if (targetWorkers.length === 0 && workers.length === 1) {
          targetWorkers = workers;
        }
        if (targetWorkers.length === 0 && workers.length > 1) {
          await runtime.respondInteraction(interaction, buildNoticePayload({
            t,
            language,
            tone: "info",
            title: t("🎚 Worker auswählen", "🎚 Choose a worker"),
            description: t(
              "Mehrere Worker streamen aktuell. Nutze `/setvolume <value> bot:<nummer>` oder tritt dem Ziel-Voice-Channel bei.",
              "Multiple workers are currently streaming. Use `/setvolume <value> bot:<number>` or join the target voice channel."
            ),
            extraComponents: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                  .setStyle(ButtonStyle.Secondary)
                  .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
              ),
            ],
          }));
          return;
        }
      }
    }

    if (targetWorkers.length === 0) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🔎 Kein passender Worker", "🔎 No matching worker"),
        description: t("Kein passender Worker gefunden.", "No matching worker found."),
      }));
      return;
    }
    const failures = [];
    const appliedWorkers = [];
    const savedWorkers = [];
    const results = await Promise.all(targetWorkers.map(async (worker) => ({
      worker,
      result: await worker.setVolumeInGuild(interaction.guildId, value).catch((err) => ({ ok: false, error: err?.message || "setvolume_failed" })),
    })));
    for (const { worker, result } of results) {
      if (!result?.ok) {
        failures.push(`${worker.config?.name || "Worker"}: ${result?.error || "setvolume_failed"}`);
        continue;
      }
      if (result?.appliedLive) {
        appliedWorkers.push(worker.config?.name || "Worker");
      } else {
        savedWorkers.push(worker.config?.name || "Worker");
      }
    }
    if (failures.length === targetWorkers.length) {
      await runtime.respondInteraction(interaction, buildNoticePayload({
        t,
        language,
        tone: "danger",
        title: t("✖ Lautstärke konnte nicht gesetzt werden", "✖ Could not change volume"),
        description: clipText(failures.join("\n"), 3500),
      }));
      return;
    }
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: failures.length > 0 ? "warning" : "success",
      title: t("🎚 Lautstärke aktualisiert", "🎚 Volume updated"),
      description: t("Zielwert: **{value}**", "Target value: **{value}**", { value }),
      fields: [
        ...(appliedWorkers.length > 0 ? [{
          name: t("Direkt angewendet", "Applied live"),
          value: clipText(appliedWorkers.join(", "), 1024),
          inline: false,
        }] : []),
        ...(savedWorkers.length > 0 ? [{
          name: t("Gespeichert für später", "Saved for later"),
          value: clipText(savedWorkers.join(", "), 1024),
          inline: false,
        }] : []),
        ...(failures.length > 0 ? [{
          name: t("Fehler", "Errors"),
          value: clipText(failures.join("\n"), 1024),
          inline: false,
        }] : []),
      ],
    }));
    return;
  }
  const result = await runtime.setVolumeInGuild(interaction.guildId, value);
  if (!result?.ok) {
    await runtime.respondInteraction(interaction, buildNoticePayload({
      t,
      language,
      tone: "danger",
      title: t("✖ Lautstärke konnte nicht gesetzt werden", "✖ Could not change volume"),
      description: t("Fehler: {error}", "Error: {error}", { error: result?.error || "setvolume_failed" }),
    }));
    return;
  }
  await runtime.respondInteraction(interaction, buildNoticePayload({
    t,
    language,
    tone: "success",
    title: t("🎚 Lautstärke aktualisiert", "🎚 Volume updated"),
    description: result.appliedLive
      ? t("Lautstärke gesetzt: **{value}**", "Volume set to: **{value}**", { value })
      : t(
        "Lautstärke gespeichert: **{value}**. Wird beim nächsten Start verwendet.",
        "Volume saved: **{value}**. It will be used for the next playback.", { value }
      ),
  }));
  return;
}
