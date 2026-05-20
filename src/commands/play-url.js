// ============================================================
// OmniFM: /play url: Direkt-Stream für Ultimate-Nutzer
// Feature 12: Ultimate-Nutzer können direkt eine Stream-URL
//             abspielen ohne vorherige /addstation-Registrierung.
//
// Nutzung: /play url:https://stream.example.com/radio
// Voraussetzung: Ultimate-Plan auf dem Server
// ============================================================

import { MessageFlags } from "discord.js";
import { getTier, requireFeature } from "../core/entitlements.js";
import { validateCustomStationUrl } from "../custom-stations.js";
import { clipText, sanitizeUrlForLog } from "../lib/helpers.js";
import { BRAND } from "../config/plans.js";

/**
 * Maximale URL-Länge für Direkt-Streams
 */
const PLAY_URL_MAX_LENGTH = 512;

/**
 * Erlaubte URL-Protokolle für Direkt-Streams
 */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * Validiert eine Direkt-Stream-URL für /play url:
 * @param {string} rawUrl
 * @returns {{ ok: boolean, url?: string, error?: string }}
 */
function validateDirectStreamUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) {
    return { ok: false, error: "Keine URL angegeben." };
  }
  if (url.length > PLAY_URL_MAX_LENGTH) {
    return { ok: false, error: `URL zu lang (max. ${PLAY_URL_MAX_LENGTH} Zeichen).` };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Ungültige URL. Bitte eine vollständige URL mit http:// oder https:// angeben." };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return {
      ok: false,
      error: `Protokoll "${parsed.protocol}" nicht erlaubt. Nur http:// und https:// sind zulässig.`,
    };
  }

  // Keine lokalen/privaten Adressen erlauben
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  if (blockedHosts.includes(hostname)) {
    return { ok: false, error: "Lokale Adressen sind nicht erlaubt." };
  }

  // RFC 1918 private Ranges blockieren
  const privateRangePatterns = [
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
  ];
  if (privateRangePatterns.some((re) => re.test(hostname))) {
    return { ok: false, error: "Private IP-Adressen sind nicht erlaubt." };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Baut einen temporären Stations-Eintrag für einen Direkt-Stream.
 * Dieser wird NICHT gespeichert – nur für die aktuelle Session genutzt.
 * @param {string} url
 * @param {string} [label]
 * @returns {{ key: string, station: object, stationsData: object }}
 */
function buildDirectStreamStation(url, label = null) {
  // Generiere einen eindeutigen temporären Key
  const key = `direct-${Date.now().toString(36)}`;
  const name = label
    ? clipText(label, 80)
    : clipText(sanitizeUrlForLog(url), 80) || "Direkt-Stream";

  const station = {
    name,
    url,
    isDirectStream: true,
    addedAt: new Date().toISOString(),
  };

  // Minimales stationsData-Objekt für playStation()
  const stationsData = {
    stations: { [key]: station },
    qualityPreset: "custom",
  };

  return { key, station, stationsData };
}

/**
 * Verarbeitet den /play url: Subcommand.
 * Wird von runtime-interactions.js aufgerufen wenn options.url gesetzt ist.
 *
 * @param {import('../bot/runtime.js').BotRuntime} runtime
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>} true wenn verarbeitet, false wenn nicht zuständig
 */
async function handlePlayUrlCommand(runtime, interaction) {
  const rawUrl = interaction.options?.getString?.("url");
  if (!rawUrl) return false; // Kein url-Parameter → nicht zuständig

  const guildId = interaction.guildId;
  const { t, language } = runtime.createInteractionTranslator(interaction);

  // Feature-Check: Nur Ultimate
  const feature = requireFeature(guildId, "directStreamPlay");
  if (!feature.ok) {
    const upgradeUrl = BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R";
    await interaction.reply({
      content: t(
        `🔒 **Direkt-Stream** ist ein **Ultimate**-Feature.\n` +
        `Mit Ultimate kannst du jede Stream-URL direkt abspielen ohne sie vorher zu registrieren.\n` +
        `Upgrade: ${upgradeUrl}`,
        `🔒 **Direct stream** is an **Ultimate** feature.\n` +
        `With Ultimate you can play any stream URL directly without registering it first.\n` +
        `Upgrade: ${upgradeUrl}`
      ),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // URL validieren
  const urlValidation = validateDirectStreamUrl(rawUrl);
  if (!urlValidation.ok) {
    await interaction.reply({
      content: t(
        `❌ Ungültige URL: ${urlValidation.error}`,
        `❌ Invalid URL: ${urlValidation.error}`
      ),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Zusätzliche DNS/Erreichbarkeits-Prüfung
  const deepValidation = await validateCustomStationUrl(urlValidation.url);
  if (!deepValidation.ok) {
    await interaction.reply({
      content: t(
        `❌ Stream nicht erreichbar: ${deepValidation.error || "Unbekannter Fehler"}`,
        `❌ Stream not reachable: ${deepValidation.error || "Unknown error"}`
      ),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Voice-Channel prüfen
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: t(
        "❌ Du musst in einem Voice-Channel sein um einen Stream zu starten.",
        "❌ You need to be in a voice channel to start a stream."
      ),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Temporäre Station bauen
  const label = interaction.options?.getString?.("label") || null;
  const { key, stationsData } = buildDirectStreamStation(urlValidation.url, label);

  // Worker auflösen
  const { runtime: streamRuntime, state, reason } = await runtime.resolveStreamingRuntimeForInteraction(interaction);

  let targetRuntime = streamRuntime;
  let targetState = state;

  // Wenn kein Worker läuft, Commander selbst oder ersten Worker nutzen
  if (!targetRuntime) {
    if (runtime.role === "commander" && runtime.workerManager) {
      const guildTier = getTier(guildId);
      targetRuntime = await runtime.workerManager.findConnectedWorkerByChannel?.(guildId, voiceChannel.id, guildTier)
        || runtime.workerManager.findFreeWorker(guildId, guildTier);
      if (!targetRuntime) {
        await interaction.editReply({
          content: t(
            "❌ Kein freier Worker ist auf diesem Server verfuegbar. Lade einen Worker ein oder stoppe zuerst einen laufenden Stream.",
            "❌ No free worker is available on this server. Invite a worker or stop an existing stream first."
          ),
        });
        return true;
      }
    } else {
      targetRuntime = runtime;
    }
    targetState = targetRuntime.getState(guildId);
  }

  try {
    const result = await targetRuntime.playInGuild(
      guildId,
      voiceChannel.id,
      key,
      stationsData,
      targetState?.volume,
      { countAsStart: true }
    );

    if (!result.ok) {
      await interaction.editReply({
        content: t(
          `❌ Stream konnte nicht gestartet werden: ${result.error || "Unbekannter Fehler"}`,
          `❌ Could not start stream: ${result.error || "Unknown error"}`
        ),
      });
      return true;
    }

    const safeUrl = sanitizeUrlForLog(urlValidation.url);
    await interaction.editReply({
      content: t(
        `▶️ Direkt-Stream gestartet!\n**URL:** \`${safeUrl}\`\n**Channel:** <#${voiceChannel.id}>\n\n_Dieser Stream ist temporär und wird nicht gespeichert. Nutze \`/addstation\` um ihn dauerhaft hinzuzufügen._`,
        `▶️ Direct stream started!\n**URL:** \`${safeUrl}\`\n**Channel:** <#${voiceChannel.id}>\n\n_This stream is temporary and will not be saved. Use \`/addstation\` to add it permanently._`
      ),
    });
  } catch (err) {
    await interaction.editReply({
      content: t(
        `❌ Fehler beim Starten: ${clipText(err?.message || String(err), 200)}`,
        `❌ Error starting stream: ${clipText(err?.message || String(err), 200)}`
      ),
    });
  }

  return true;
}

export {
  handlePlayUrlCommand,
  validateDirectStreamUrl,
  buildDirectStreamStation,
  PLAY_URL_MAX_LENGTH,
};
