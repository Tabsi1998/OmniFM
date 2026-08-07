// ============================================================
// OmniFM: Operator-Webhook Service
// Sendet Discord-Webhook-Nachrichten bei kritischen Ereignissen:
//   - Bot-Login fehlgeschlagen
//   - MongoDB-Verbindung verloren / wiederhergestellt
//   - Unhandled Exception / Crash
//   - Bot-Shutdown (SIGTERM/SIGINT)
//   - Stream-Fehler-Häufung (>5 Fehler in 60s)
//
// Konfiguration in .env:
//   OPERATOR_WEBHOOK_URL=https://discord.com/api/webhooks/...
//   OPERATOR_WEBHOOK_ENABLED=1   (Standard: 1 wenn URL gesetzt)
//   OPERATOR_WEBHOOK_MENTION=<@123456789>  (optional: User/Rolle pingen)
// ============================================================

import { safeFetch } from "../lib/safe-outbound-http.js";

const OPERATOR_WEBHOOK_URL = String(process.env.OPERATOR_WEBHOOK_URL || "").trim();
const OPERATOR_WEBHOOK_ENABLED =
  OPERATOR_WEBHOOK_URL.length > 0 &&
  String(process.env.OPERATOR_WEBHOOK_ENABLED || "1") === "1";
const OPERATOR_WEBHOOK_MENTION = String(process.env.OPERATOR_WEBHOOK_MENTION || "").trim();
const DISCORD_WEBHOOK_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

// Farben für Discord-Embeds
const COLORS = {
  error: 0xFF2A2A,    // Rot
  warning: 0xFFB800,  // Gelb
  success: 0x39FF14,  // Grün
  info: 0x00F0FF,     // Cyan
};

// Deduplizierung: gleiche Nachricht nicht öfter als 1x pro 60s senden
const recentMessages = new Map();
const DEDUP_WINDOW_MS = 60_000;

function isAllowedOperatorWebhookUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    return url.protocol === "https:"
      && DISCORD_WEBHOOK_HOSTS.has(url.hostname.toLowerCase())
      && /^\/api\/webhooks\/[^/]+\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Sendet eine Webhook-Nachricht an Discord.
 * @param {object} payload Discord Webhook Payload
 * @returns {Promise<boolean>}
 */
async function postOperatorWebhook(url, payload, { fetchImpl = safeFetch } = {}) {
  const targetUrl = String(url || "").trim();
  if (!isAllowedOperatorWebhookUrl(targetUrl)) return false;
  try {
    const res = await fetchImpl(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      requireHttps: true,
      timeoutMs: 8_000,
    });
    try {
      await res.body?.cancel?.();
    } catch {
      // The webhook result is already known; a body-cleanup failure is harmless.
    }
    return Boolean(res.ok);
  } catch {
    // Webhook-Fehler dürfen den Bot nicht crashen
    return false;
  }
}

async function sendWebhook(payload) {
  if (!OPERATOR_WEBHOOK_ENABLED) return false;
  return postOperatorWebhook(OPERATOR_WEBHOOK_URL, payload);
}

/**
 * Sendet eine deduplizierte Operator-Nachricht.
 * @param {string} dedupKey Eindeutiger Key für Deduplizierung
 * @param {object} embedData
 */
async function notify(dedupKey, embedData) {
  if (!OPERATOR_WEBHOOK_ENABLED) return;

  const now = Date.now();
  const lastSent = recentMessages.get(dedupKey) || 0;
  if (now - lastSent < DEDUP_WINDOW_MS) return; // Deduplizierung
  recentMessages.set(dedupKey, now);

  // Alte Einträge bereinigen
  for (const [key, ts] of recentMessages.entries()) {
    if (now - ts > DEDUP_WINDOW_MS * 10) recentMessages.delete(key);
  }

  const embed = {
    color: embedData.color || COLORS.info,
    title: embedData.title || "OmniFM Operator Alert",
    description: embedData.description || "",
    fields: embedData.fields || [],
    footer: { text: `OmniFM Operator • ${new Date().toISOString()}` },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    username: "OmniFM Operator",
    avatar_url: "https://omnifm.xyz/img/bot-1.png",
    content: OPERATOR_WEBHOOK_MENTION || undefined,
    embeds: [embed],
  };

  await sendWebhook(payload);
}

// ---- Öffentliche Notify-Funktionen ----

/**
 * Bot-Login fehlgeschlagen.
 * @param {string} botName
 * @param {string} error
 */
async function notifyBotLoginFailed(botName, error) {
  await notify(`login-failed-${botName}`, {
    color: COLORS.error,
    title: "🔴 Bot-Login fehlgeschlagen",
    description: `**${botName}** konnte sich nicht bei Discord einloggen.`,
    fields: [
      { name: "Fehler", value: String(error || "Unbekannt").slice(0, 1000), inline: false },
      { name: "Aktion", value: "Token prüfen und Bot neu starten.", inline: false },
    ],
  });
}

/**
 * MongoDB-Verbindung verloren.
 * @param {string} error
 */
async function notifyMongoDisconnected(error) {
  await notify("mongo-disconnected", {
    color: COLORS.error,
    title: "🔴 MongoDB-Verbindung verloren",
    description: "Der Bot hat die Verbindung zur Datenbank verloren. Datei-basierte Stores sind aktiv.",
    fields: [
      { name: "Fehler", value: String(error || "Unbekannt").slice(0, 1000), inline: false },
    ],
  });
}

/**
 * MongoDB-Verbindung wiederhergestellt.
 */
async function notifyMongoReconnected() {
  await notify("mongo-reconnected", {
    color: COLORS.success,
    title: "🟢 MongoDB-Verbindung wiederhergestellt",
    description: "Die Datenbankverbindung wurde erfolgreich wiederhergestellt.",
  });
}

/**
 * Unhandled Exception / Crash.
 * @param {string} type 'unhandledRejection' | 'uncaughtException'
 * @param {Error|unknown} err
 */
async function notifyCrash(type, err) {
  const msg = err instanceof Error
    ? `${err.message}\n\`\`\`${(err.stack || "").slice(0, 800)}\`\`\``
    : String(err || "Unbekannt").slice(0, 1000);

  await notify(`crash-${type}-${Date.now()}`, {
    color: COLORS.error,
    title: `🔴 ${type === "uncaughtException" ? "Uncaught Exception" : "Unhandled Rejection"}`,
    description: msg,
    fields: [
      { name: "Typ", value: type, inline: true },
      { name: "Zeit", value: new Date().toISOString(), inline: true },
    ],
  });
}

/**
 * Bot-Shutdown (SIGTERM/SIGINT).
 * @param {string} signal
 */
async function notifyShutdown(signal) {
  await notify(`shutdown-${signal}`, {
    color: COLORS.warning,
    title: "🟡 Bot wird heruntergefahren",
    description: `Shutdown-Signal empfangen: **${signal}**`,
  });
}

/**
 * Stream-Fehler-Häufung.
 * @param {string} guildId
 * @param {string} stationName
 * @param {number} errorCount
 */
async function notifyStreamErrorSpike(guildId, stationName, errorCount) {
  await notify(`stream-errors-${guildId}`, {
    color: COLORS.warning,
    title: "🟡 Stream-Fehler-Häufung",
    description: `Viele Stream-Fehler in kurzer Zeit auf Server **${guildId}**.`,
    fields: [
      { name: "Station", value: stationName || "Unbekannt", inline: true },
      { name: "Fehler", value: String(errorCount), inline: true },
    ],
  });
}

/**
 * Bot erfolgreich gestartet.
 * @param {string[]} botNames
 * @param {number} totalBots
 */
async function notifyStartup(botNames, totalBots) {
  await notify("startup", {
    color: COLORS.success,
    title: "🟢 OmniFM gestartet",
    description: `**${botNames.length}/${totalBots}** Bots erfolgreich gestartet.`,
    fields: botNames.length > 0
      ? [{ name: "Bots", value: botNames.join(", "), inline: false }]
      : [],
  });
}

export {
  notifyBotLoginFailed,
  notifyMongoDisconnected,
  notifyMongoReconnected,
  notifyCrash,
  notifyShutdown,
  notifyStreamErrorSpike,
  notifyStartup,
  OPERATOR_WEBHOOK_ENABLED,
  isAllowedOperatorWebhookUrl,
  postOperatorWebhook,
};
