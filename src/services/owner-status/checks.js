// ============================================================
// OmniFM: the owner cockpit's checks (#355)
// ============================================================
// Each check answers "does it work?", not "is something entered?":
//   ok   green  – checked and working
//   off  yellow – not set up (the summary says what is missing then)
//   warn yellow – set up, but could not be confirmed or only partly works
//   fail red    – set up and broken
// Every check gets everything from outside (config, env, fetch, runtimes),
// so the tests can feed valid, invalid and missing answers.
import { resolveDiscordRedirectUri, publicWebsiteOrigin } from "../../lib/discord-oauth-settings.js";
import { isPublicOrigin, originOf } from "../../lib/public-origin.js";

const REQUEST_TIMEOUT_MS = 10_000;

function result(key, state, summary, detail = null) {
  return { key, state, summary, detail };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function request(fetchImpl, url, options = {}) {
  return fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/** A version like "3.2.0" or "v3.10.1" as numbers, for comparing. */
export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || "").trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

export function isOlderVersion(running, latest) {
  const a = parseVersion(running);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index];
  }
  return false;
}

// ---- the checks ----

export async function checkMongo({ db }) {
  if (!db) return result("mongo", "fail", "MongoDB ist nicht verbunden – Einstellungen, Lizenzen und Verlauf fehlen.");
  try {
    await db.command({ ping: 1 });
    return result("mongo", "ok", "MongoDB antwortet.");
  } catch (err) {
    return result("mongo", "fail", "MongoDB antwortet nicht.", String(err?.message || err));
  }
}

/** Commander and workers: logged in or not, servers, streams. */
export async function checkBots({ runtimes = [] }) {
  const commander = runtimes.find((runtime) => runtime?.role === "commander") || runtimes[0] || null;
  const bots = [];
  if (commander) {
    bots.push({
      name: commander.config?.name || "Commander",
      online: Boolean(commander.client?.isReady?.()),
      guilds: commander.client?.guilds?.cache?.size || 0,
      streams: 0,
      pingMs: Number.isFinite(commander.client?.ws?.ping) && commander.client.ws.ping >= 0 ? commander.client.ws.ping : null,
    });
  }
  for (const worker of commander?.workerManager?.getAllStatuses?.() || []) {
    bots.push({ name: worker.name, online: worker.online, guilds: worker.totalGuilds || 0, streams: worker.activeStreams || 0, pingMs: null });
  }
  if (!bots.length) return result("bots", "fail", "Kein Bot läuft.");
  const offline = bots.filter((bot) => !bot.online);
  const streams = bots.reduce((sum, bot) => sum + bot.streams, 0);
  const detail = bots.map((bot) => `${bot.online ? "●" : "○"} ${bot.name}: ${bot.online ? `${bot.guilds} Server, ${bot.streams} Streams${bot.pingMs !== null ? `, ${bot.pingMs} ms` : ""}` : "offline"}`).join("\n");
  if (offline.length) {
    return result("bots", "fail", `${offline.length} von ${bots.length} Bots offline: ${offline.map((bot) => bot.name).join(", ")}.`, detail);
  }
  return result("bots", "ok", `Alle ${bots.length} Bots online · ${streams} Streams.`, detail);
}

/**
 * The dashboard login: client ID and secret are tried at Discord itself
 * (client credentials, gives only the developer's own token), and the
 * redirect URI has to be the public website.
 */
export async function checkDiscordLogin({ env, fetchImpl, storedRedirectUri = "" }) {
  const clientId = text(env.DISCORD_CLIENT_ID);
  const secret = text(env.DISCORD_CLIENT_SECRET);
  if (!clientId || !secret) {
    return result("discordLogin", "off", "Client-ID oder Secret fehlt – niemand kann sich im Dashboard anmelden.");
  }
  const redirectUri = resolveDiscordRedirectUri(env, { stored: storedRedirectUri });
  const website = publicWebsiteOrigin(env, { stored: storedRedirectUri });
  if (!isPublicOrigin(originOf(redirectUri)) || originOf(redirectUri) !== website) {
    return result("discordLogin", "fail", `Die Redirect-URI zeigt auf ${redirectUri}, nicht auf ${website}.`);
  }
  let response;
  try {
    response = await request(fetchImpl, "https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=identify",
    });
  } catch (err) {
    return result("discordLogin", "warn", "Discord war für die Prüfung nicht erreichbar.", String(err?.message || err));
  }
  if (response.status === 401 || response.status === 400) {
    return result("discordLogin", "fail", "Discord lehnt Client-ID oder Secret ab – das Secret wurde vermutlich neu erzeugt. Neues Secret in den Einstellungen eintragen.");
  }
  if (!response.ok) return result("discordLogin", "warn", `Discord antwortet mit HTTP ${response.status}.`);
  return result("discordLogin", "ok", `Secret gültig · Weiterleitung ${redirectUri}`);
}

/** Payments: the key works, the webhook that unlocks paid plans is set up. */
export async function checkStripe({ ownerConfig, env, fetchImpl }) {
  const stripe = ownerConfig?.payments?.stripe || {};
  if (stripe.enabled === false) return result("stripe", "off", "Stripe ist ausgeschaltet – Premium kann nicht gekauft werden.");
  const key = text(stripe.secretKey) || text(env.STRIPE_SECRET_KEY) || text(env.STRIPE_API_KEY);
  if (!key) return result("stripe", "off", "Kein Stripe-Schlüssel – Premium kann nicht gekauft werden.");
  let response;
  try {
    response = await request(fetchImpl, "https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` } });
  } catch (err) {
    return result("stripe", "warn", "Stripe war für die Prüfung nicht erreichbar.", String(err?.message || err));
  }
  if (response.status === 401 || response.status === 403) {
    return result("stripe", "fail", "Stripe lehnt den Schlüssel ab – Käufe schlagen fehl.");
  }
  if (!response.ok) return result("stripe", "warn", `Stripe antwortet mit HTTP ${response.status}.`);
  const webhookSecret = text(stripe.webhookSecret) || text(env.STRIPE_WEBHOOK_SECRET);
  if (!webhookSecret) {
    return result("stripe", "warn", "Schlüssel gültig, aber das Webhook-Secret fehlt – bezahlte Käufe werden nicht automatisch freigeschaltet.");
  }
  return result("stripe", key.startsWith("sk_test_") ? "warn" : "ok", key.startsWith("sk_test_") ? "Stripe läuft im Testmodus – echte Zahlungen gehen nicht." : "Schlüssel gültig, Webhook eingerichtet.");
}

/** E-mail: connect and log in, no mail is sent. */
export async function checkSmtp({ ownerConfig, env, createTransport }) {
  const smtp = ownerConfig?.system?.smtp || {};
  const host = text(smtp.host) || text(env.SMTP_HOST);
  if (!host) return result("smtp", "off", "Kein Mailserver – OmniFM verschickt keine E-Mails (z. B. Lizenzschlüssel).");
  const port = Number(smtp.port || env.SMTP_PORT || 587) || 587;
  const secure = smtp.secure === true || String(env.SMTP_SECURE || "") === "1" || port === 465;
  const user = text(smtp.user) || text(env.SMTP_USER);
  const pass = text(smtp.password) || text(env.SMTP_PASS);
  try {
    const transport = createTransport({
      host, port, secure,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: REQUEST_TIMEOUT_MS,
      greetingTimeout: REQUEST_TIMEOUT_MS,
    });
    await transport.verify();
    transport.close?.();
    return result("smtp", "ok", `Anmeldung bei ${host}:${port} klappt.`);
  } catch (err) {
    return result("smtp", "fail", `Der Mailserver ${host}:${port} lehnt ab oder antwortet nicht.`, String(err?.message || err));
  }
}

/** Song recognition for stations without titles (AcoustID). */
export async function checkRecognition({ ownerConfig, env, fetchImpl }) {
  const recognition = ownerConfig?.system?.audioRecognition || {};
  const enabled = recognition.enabled === true || String(env.NOW_PLAYING_RECOGNITION_ENABLED || "") === "1";
  const apiKey = text(recognition.apiKey) || text(env.ACOUSTID_API_KEY);
  if (!enabled) return result("recognition", "off", "Song-Erkennung ist aus – Sender ohne Titel zeigen keinen Song.");
  if (!apiKey) return result("recognition", "off", "Song-Erkennung ist an, aber der AcoustID-Schlüssel fehlt.");
  let payload;
  try {
    const response = await request(fetchImpl, `https://api.acoustid.org/v2/lookup?format=json&client=${encodeURIComponent(apiKey)}&trackid=9ff43b6a-4f16-427c-93c2-92307ca505e0`);
    payload = await response.json();
  } catch (err) {
    return result("recognition", "warn", "AcoustID war für die Prüfung nicht erreichbar.", String(err?.message || err));
  }
  if (payload?.status === "ok") return result("recognition", "ok", "AcoustID-Schlüssel gültig.");
  if (payload?.error?.code === 4) return result("recognition", "fail", "AcoustID lehnt den Schlüssel ab.");
  return result("recognition", "warn", `AcoustID antwortet unerwartet: ${payload?.error?.message || "ohne Status"}.`);
}

/** Top.gg, Discord Bot List, Bots.gg: did the last server count arrive? */
export async function checkBotLists({ lists = [], now = Date.now() }) {
  const enabled = lists.filter((list) => list.enabled);
  if (!enabled.length) return result("botLists", "off", "Keine Bot-Liste eingerichtet.");
  const lines = [];
  let state = "ok";
  for (const list of enabled) {
    const sync = list.lastStatsSync;
    const at = sync?.at ? Date.parse(sync.at) : Number.NaN;
    if (!sync || !Number.isFinite(at)) {
      lines.push(`${list.name}: noch nichts gemeldet`);
      if (state === "ok") state = "warn";
    } else if (sync.ok === false) {
      lines.push(`${list.name}: Fehler – ${sync.error || "unbekannt"}`);
      state = "fail";
    } else if (now - at > 3 * 60 * 60_000) {
      lines.push(`${list.name}: letzte Meldung vor ${Math.round((now - at) / 3_600_000)} Std.`);
      if (state === "ok") state = "warn";
    } else {
      lines.push(`${list.name}: ok`);
    }
  }
  const summary = state === "ok"
    ? `${enabled.map((list) => list.name).join(", ")} bekommen die Server-Zahlen.`
    : lines.filter((line) => !line.endsWith(": ok")).join(" · ");
  return result("botLists", state, summary, lines.join("\n"));
}

/** The operator's alarm channel: the webhook still exists (nothing is posted). */
export async function checkOperatorWebhook({ env, fetchImpl }) {
  const url = text(env.OPERATOR_WEBHOOK_URL);
  if (!url) return result("operatorWebhook", "off", "Kein Alarm-Kanal – rote Kacheln melden sich nirgends.");
  let response;
  try {
    response = await request(fetchImpl, url);
  } catch (err) {
    return result("operatorWebhook", "warn", "Discord war für die Prüfung nicht erreichbar.", String(err?.message || err));
  }
  if (response.status === 404 || response.status === 401) {
    return result("operatorWebhook", "fail", "Den Alarm-Webhook gibt es nicht mehr – in Discord neu anlegen und eintragen.");
  }
  if (!response.ok) return result("operatorWebhook", "warn", `Discord antwortet mit HTTP ${response.status}.`);
  return result("operatorWebhook", "ok", "Alarm-Kanal erreichbar.");
}

/**
 * The website from outside: the login link lands at Discord with the right
 * redirect URI, share links point at the website.
 */
export async function checkWebsite({ env, fetchImpl, storedRedirectUri = "" }) {
  const origin = publicWebsiteOrigin(env, { stored: storedRedirectUri });
  const problems = [];
  let loginResponse;
  try {
    loginResponse = await request(fetchImpl, `${origin}/api/auth/discord/login?redirect=1&nextPage=dashboard`, { redirect: "manual" });
  } catch (err) {
    return result("website", "warn", `Der Server erreicht ${origin} nicht selbst (z. B. im Heimnetz ohne Hairpin-NAT).`, String(err?.message || err));
  }
  const location = loginResponse.headers.get("location") || "";
  if (loginResponse.status !== 302 || !location.startsWith("https://discord.com/")) {
    problems.push(`Login-Link: HTTP ${loginResponse.status} statt Weiterleitung zu Discord`);
  } else {
    const redirect = new URL(location).searchParams.get("redirect_uri") || "";
    if (originOf(redirect) !== origin) problems.push(`Login schickt Discord zu ${redirect}`);
  }
  try {
    const share = await request(fetchImpl, `${origin}/api/share/page/premium`);
    const html = await share.text();
    const ogUrl = /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1] || "";
    if (share.status === 200 && ogUrl && !ogUrl.startsWith(`${origin}/`)) problems.push(`Share-Links zeigen auf ${originOf(ogUrl)}`);
  } catch {
    // The login answered, so a failing share page is its own problem.
    problems.push("Share-Seite antwortet nicht");
  }
  if (problems.length) return result("website", "fail", problems.join(" · "));
  return result("website", "ok", `${origin}: Login und Share-Links in Ordnung.`);
}

/** The running version against the newest release on GitHub. */
export async function checkVersion({ runningVersion, fetchImpl, repo = "Tabsi1998/OmniFM" }) {
  let latest = "";
  try {
    const response = await request(fetchImpl, `https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (response.ok) latest = text((await response.json())?.tag_name);
  } catch {
    latest = "";
  }
  if (!latest) return result("version", "warn", `Läuft: ${runningVersion || "?"} · GitHub war nicht erreichbar.`);
  if (isOlderVersion(runningVersion, latest)) {
    return result("version", "warn", `Läuft: ${runningVersion} · Update auf ${latest.replace(/^v/, "")} verfügbar.`);
  }
  return result("version", "ok", `Läuft: ${runningVersion} – aktuell.`);
}

/** The station catalogue: streams the station check finds down or suddenly named otherwise. */
export async function checkStations({ report = [] }) {
  if (!report.length) return result("stations", "off", "Die Stream-Prüfung läuft nicht oder hat noch nichts geprüft.");
  const down = report.filter((entry) => entry?.status === "down" && Number(entry.consecutiveFailures) >= 2);
  // #325: a stream that suddenly sends another name may play something else now.
  const renamed = report.filter((entry) => entry?.streamNameChange?.to);
  if (!down.length && !renamed.length) return result("stations", "ok", `Alle ${report.length} geprüften Sender erreichbar.`);
  const label = (entry) => entry.name || entry.key;
  const listed = (entries) => `${entries.slice(0, 3).map(label).join(", ")}${entries.length > 3 ? " …" : ""}`;
  const parts = [];
  if (down.length) parts.push(`${down.length} von ${report.length} Sendern ausgefallen: ${listed(down)}.`);
  if (renamed.length) {
    parts.push(`${renamed.length} ${renamed.length === 1 ? "Stream heißt" : "Streams heißen"} jetzt anders: ${listed(renamed)} – prüfen, ob noch das Richtige läuft.`);
  }
  const detail = [
    ...down.map((entry) => `${label(entry)}: ${entry.error || "keine Antwort"}`),
    ...renamed.map((entry) => `${label(entry)}: "${entry.streamNameChange.from}" → "${entry.streamNameChange.to}"`),
  ].join("\n");
  return result("stations", "warn", parts.join(" "), detail);
}

/** What the cockpit shows, in order, with the one page to fix it (frontend/src/lib/ownerNavigation.js). */
export const OWNER_STATUS_CHECKS = Object.freeze([
  { key: "bots", label: "Bots", area: "monitoring" },
  { key: "discordLogin", label: "Discord-Login", area: "cfg-login" },
  { key: "website", label: "Website", area: "cfg-login" },
  { key: "mongo", label: "Datenbank", area: null },
  { key: "stripe", label: "Zahlungen (Stripe)", area: "payments" },
  { key: "smtp", label: "E-Mail (SMTP)", area: "cfg-email" },
  { key: "recognition", label: "Song-Erkennung", area: "cfg-recognition" },
  { key: "operatorWebhook", label: "Alarm-Kanal", area: "cfg-alerts" },
  { key: "botLists", label: "Bot-Listen", area: "cfg-directories" },
  { key: "stations", label: "Sender", area: "stations" },
  { key: "version", label: "Version", area: null },
]);
