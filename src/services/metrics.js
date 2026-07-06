// ============================================================
// OmniFM: Prometheus-kompatibler /metrics Endpunkt
// Feature 10: Ermöglicht Grafana/Prometheus-Integration
//
// Aktivierung: METRICS_ENABLED=1 in .env
// Optionaler Auth-Token: METRICS_TOKEN=geheimestoken
// ============================================================

import { safeTokenEquals } from "../lib/api-helpers.js";

function envFlagEnabled(name, fallback = "0") {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || fallback).trim().toLowerCase());
}

function getMetricsConfig() {
  return {
    enabled: envFlagEnabled("METRICS_ENABLED"),
    token: String(process.env.METRICS_TOKEN || "").trim(),
    queryTokenEnabled: envFlagEnabled("METRICS_QUERY_TOKEN_ENABLED"),
  };
}

const METRICS_ENABLED = getMetricsConfig().enabled;

/**
 * Baut eine Prometheus-kompatible Textantwort aus den Runtime-Daten.
 * @param {import('../bot/runtime.js').BotRuntime} commanderRuntime
 * @param {import('../bot/runtime.js').BotRuntime[]} allRuntimes
 * @returns {string}
 */
function buildMetricsText(commanderRuntime, allRuntimes = []) {
  const lines = [];
  const now = Date.now();
  const commander = commanderRuntime || allRuntimes[0] || {};

  const push = (name, help, type, ...samples) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const { labels = {}, value } of samples) {
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`)
        .join(",");
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ""} ${value}`);
    }
  };

  // ---- Bot-Uptime ----
  const uptimeSec = Math.floor((now - (commander.startedAt || now)) / 1000);
  push(
    "omnifm_uptime_seconds",
    "Bot uptime in seconds",
    "gauge",
    { value: uptimeSec }
  );

  // ---- Pro Runtime: Guilds, Verbindungen, Zuhörer ----
  let totalGuilds = 0;
  let totalConnections = 0;
  let totalListeners = 0;
  let totalPlaying = 0;
  let totalStreamErrors = 0;
  let totalReconnects = 0;

  for (const runtime of allRuntimes) {
    const stats = runtime.collectStats?.() || {};
    const botName = String(runtime.config?.name || runtime.config?.id || "unknown");
    const botId = String(runtime.config?.id || "unknown");

    totalGuilds += Number(stats.servers || 0);
    totalConnections += Number(stats.connections || 0);
    totalListeners += Number(stats.listeners || 0);

    push(
      "omnifm_bot_guilds_total",
      "Number of guilds the bot is in",
      "gauge",
      { labels: { bot: botName, bot_id: botId }, value: Number(stats.servers || 0) }
    );
    push(
      "omnifm_bot_voice_connections",
      "Number of active voice connections",
      "gauge",
      { labels: { bot: botName, bot_id: botId }, value: Number(stats.connections || 0) }
    );
    push(
      "omnifm_bot_listeners_total",
      "Total number of human listeners across all voice channels",
      "gauge",
      { labels: { bot: botName, bot_id: botId }, value: Number(stats.listeners || 0) }
    );

    // Per-Guild Metriken
    for (const [guildId, state] of (runtime.guildState || new Map()).entries()) {
      const stationKey = String(state.currentStationKey || "none");
      const playing = runtime.getGuildInfo?.(guildId)?.playing ? 1 : 0;
      const listenerCount = runtime.getCurrentListenerCount?.(guildId, state) || 0;
      const streamErrors = Number(state.streamErrorCount || 0);
      const reconnectAttempts = Number(state.reconnectAttempts || 0);

      totalPlaying += playing;
      totalStreamErrors += streamErrors;
      totalReconnects += reconnectAttempts;

      push(
        "omnifm_guild_playing",
        "1 if the bot is currently playing in this guild, 0 otherwise",
        "gauge",
        { labels: { bot: botName, guild_id: guildId, station: stationKey }, value: playing }
      );
      push(
        "omnifm_guild_listeners",
        "Number of human listeners in the voice channel",
        "gauge",
        { labels: { bot: botName, guild_id: guildId }, value: listenerCount }
      );
      push(
        "omnifm_guild_stream_errors_total",
        "Total stream errors since last restart",
        "counter",
        { labels: { bot: botName, guild_id: guildId }, value: streamErrors }
      );
      push(
        "omnifm_guild_reconnect_attempts_total",
        "Total reconnect attempts since last restart",
        "counter",
        { labels: { bot: botName, guild_id: guildId }, value: reconnectAttempts }
      );
    }
  }

  // ---- Aggregierte Gesamt-Metriken ----
  push("omnifm_guilds_total", "Total guilds across all bots", "gauge",
    { value: totalGuilds });
  push("omnifm_voice_connections_total", "Total active voice connections", "gauge",
    { value: totalConnections });
  push("omnifm_listeners_total", "Total human listeners across all bots", "gauge",
    { value: totalListeners });
  push("omnifm_playing_total", "Total guilds currently playing", "gauge",
    { value: totalPlaying });
  push("omnifm_stream_errors_total", "Total stream errors across all bots", "counter",
    { value: totalStreamErrors });
  push("omnifm_reconnects_total", "Total reconnect attempts across all bots", "counter",
    { value: totalReconnects });

  // ---- Scrape-Timestamp ----
  push("omnifm_scrape_timestamp_ms", "Timestamp of this metrics scrape in milliseconds", "gauge",
    { value: now });

  return lines.join("\n") + "\n";
}

function getMetricsRequestToken(req, requestUrl) {
  const authHeader = String(req?.headers?.authorization || "").trim();
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerToken = String(req?.headers?.["x-metrics-token"] || "").trim();
  const config = getMetricsConfig();
  const queryToken = config.queryTokenEnabled
    ? String(requestUrl?.searchParams?.get("token") || "").trim()
    : "";
  return bearerToken || headerToken || queryToken;
}

function isMetricsAuthorized(req, requestUrl) {
  const config = getMetricsConfig();
  if (!config.token) return true;
  return safeTokenEquals(getMetricsRequestToken(req, requestUrl), config.token);
}

function writeMetricsUnauthorized(res) {
  if (typeof res.status === "function" && typeof res.set === "function" && typeof res.send === "function") {
    res
      .status(401)
      .set("Content-Type", "text/plain")
      .send("Unauthorized");
    return;
  }

  if (typeof res.writeHead === "function") {
    res.writeHead(401, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Bearer realm="OmniFM Metrics"',
    });
    res.end("Unauthorized");
  }
}

function writeMetricsText(res, status, text) {
  if (typeof res.status === "function") {
    res
      .status(status)
      .set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(text);
    return;
  }

  res.writeHead(status, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function handleMetricsRequest(req, res, commanderRuntime, allRuntimes = [], requestUrl = null) {
  const config = getMetricsConfig();
  if (!config.enabled) return false;

  if (!isMetricsAuthorized(req, requestUrl)) {
    writeMetricsUnauthorized(res);
    return true;
  }

  try {
    writeMetricsText(res, 200, buildMetricsText(commanderRuntime, allRuntimes));
  } catch (err) {
    writeMetricsText(res, 500, `# ERROR: ${err?.message || err}\n`);
  }
  return true;
}

/**
 * Registriert den /metrics Endpunkt am Express-App-Objekt.
 * @param {import('express').Application} app
 * @param {import('../bot/runtime.js').BotRuntime} commanderRuntime
 * @param {import('../bot/runtime.js').BotRuntime[]} allRuntimes
 */
function registerMetricsEndpoint(app, commanderRuntime, allRuntimes = []) {
  if (!getMetricsConfig().enabled) return;

  app.get("/metrics", (req, res) => {
    const requestUrl = new URL(req.originalUrl || req.url || "/metrics", "http://localhost");
    if (!isMetricsAuthorized(req, requestUrl)) {
      writeMetricsUnauthorized(res);
      return;
    }

    try {
      writeMetricsText(res, 200, buildMetricsText(commanderRuntime, allRuntimes));
    } catch (err) {
      res.status(500).set("Content-Type", "text/plain").send(`# ERROR: ${err?.message || err}\n`);
    }
  });
}

export { registerMetricsEndpoint, handleMetricsRequest, buildMetricsText, getMetricsConfig, METRICS_ENABLED };
