/* eslint-disable no-await-in-loop -- an interactive CLI asks one question after the other */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";
import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";
import { PLANS } from "./config/plans.js";
import { getDefaultLanguage, getLocaleForLanguage, normalizeLanguage } from "./i18n.js";
import {
  getServerLicense,
  listLicenses,
  addLicenseForServer,
  removeLicense,
  extendLicense,
  unlinkServerFromLicense,
  upgradeLicenseForServer,
} from "./premium-store.js";
import { isConfigured as isEmailConfigured, sendMail } from "./email.js";
import { loadBotConfigs, buildInviteUrl } from "./bot-config.js";
import {
  getSeatPricePerMonthCents as getSeatPricePerMonthCentsShared,
  calculatePrice as calculatePriceShared,
  calculateUpgradePrice as calculateUpgradePriceShared,
} from "./lib/helpers.js";
import { manageOffersMenu } from "./premium-cli/offers.js";

dotenv.config();

// The CLI works on the server's data (#292): backend/.env, and MongoDB when
// it is configured, instead of a JSON copy next to it.
const { loadBackendEnv } = await import("./entrypoints/owner-env.mjs");
loadBackendEnv();
if (String(process.env.MONGO_URL || "").trim()) {
  const { connect } = await import("./lib/db.js");
  const { initPremiumStore } = await import("./premium-store.js");
  const { initCouponStore } = await import("./coupon-store.js");
  await connect();
  await initPremiumStore();
  await initCouponStore();
}

function getSeatPricePerMonthCents(tier, seats = 1) {
  return getSeatPricePerMonthCentsShared(tier, seats);
}

function calculatePrice(tier, months, seats = 1) {
  return calculatePriceShared(tier, months, seats);
}

function calculateUpgradePrice(serverId, targetTier) {
  const lic = getServerLicense(serverId);
  if (!lic || lic.expired || !lic.active) return null;
  return calculateUpgradePriceShared(lic, targetTier);
}

const rl = createInterface({ input: stdin, output: stdout });
export const ask = (q) => rl.question(`  \x1b[36m?\x1b[0m ${q}: `);
export const ok = (m) => console.log(`  \x1b[32m[OK]\x1b[0m ${m}`);
export const info = (m) => console.log(`  \x1b[36m[INFO]\x1b[0m ${m}`);
export const fail = (m) => console.log(`  \x1b[31m[FAIL]\x1b[0m ${m}`);
export const warn = (m) => console.log(`  \x1b[33m[WARN]\x1b[0m ${m}`);
export const centsToEur = (c) => (c / 100).toFixed(2).replace(".", ",") + " EUR";
const SUPPORT_URL = "https://discord.gg/UeRkfGS43R";

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLicense(license, fallbackId = null) {
  if (!license) return null;
  const expiresAt = license.expiresAt || null;
  const expired = expiresAt ? new Date(expiresAt) <= new Date() : false;
  const remainingDays = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / 86400000)) : null;
  return {
    ...license,
    id: license.id || fallbackId || null,
    expired: typeof license.expired === "boolean" ? license.expired : expired,
    remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : remainingDays,
    linkedServerIds: Array.isArray(license.linkedServerIds) ? [...license.linkedServerIds] : [],
  };
}

function resolvePublicWebsiteUrl() {
  const raw = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (!raw) return SUPPORT_URL;
  try {
    return new URL(raw).toString();
  } catch {
    return SUPPORT_URL;
  }
}

function getLicenseByInput(input) {
  const query = String(input || "").trim();
  if (!query) return null;

  if (/^\d{17,22}$/.test(query)) {
    return normalizeLicense(getServerLicense(query));
  }

  const all = listLicenses();
  if (all[query]) return normalizeLicense(all[query], query);

  const lower = query.toLowerCase();
  for (const [id, license] of Object.entries(all)) {
    if (id.toLowerCase() === lower) return normalizeLicense(license, id);
  }

  return null;
}

function buildInviteOverviewForTier(botConfigs, tier) {
  const normalizedTier = String(tier || "free").toLowerCase();
  const hasPro = normalizedTier === "pro" || normalizedTier === "ultimate";
  const hasUltimate = normalizedTier === "ultimate";
  const overview = {
    freeWebsiteUrl: resolvePublicWebsiteUrl(),
    proBots: [],
    ultimateBots: [],
  };

  const sorted = [...botConfigs].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  const seenPro = new Set();
  const seenUltimate = new Set();

  for (const botConfig of sorted) {
    const index = Number(botConfig.index || 0);
    const bucket = String(botConfig.requiredTier || "free").toLowerCase();
    if (bucket !== "pro" && bucket !== "ultimate") continue;
    if ((bucket === "pro" && !hasPro) || (bucket === "ultimate" && !hasUltimate)) continue;
    const seen = bucket === "ultimate" ? seenUltimate : seenPro;
    if (seen.has(index)) continue;
    seen.add(index);
    if (bucket === "pro") {
      overview.proBots.push({ index, name: botConfig.name, url: buildInviteUrl(botConfig) });
    } else {
      overview.ultimateBots.push({ index, name: botConfig.name, url: buildInviteUrl(botConfig) });
    }
  }

  overview.proBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  overview.ultimateBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  return overview;
}

async function resolveRuntimeClientId(botConfig) {
  try {
    const rest = new REST({ version: "10" }).setToken(botConfig.token);
    const me = await rest.get(Routes.user("@me"));
    const runtimeId = String(me?.id || "").trim();
    if (runtimeId && runtimeId !== String(botConfig.clientId || "").trim()) {
      info(`CLIENT_ID mismatch bei ${botConfig.name}: env=${botConfig.clientId}, runtime=${runtimeId}`);
    }
    return runtimeId || String(botConfig.clientId || "").trim();
  } catch {
    return String(botConfig.clientId || "").trim();
  }
}

async function getInviteOverviewForTier(tier) {
  try {
    const botConfigs = loadBotConfigs(process.env);
    const resolved = [];
    for (const botConfig of botConfigs) {
      const runtimeClientId = await resolveRuntimeClientId(botConfig);
      resolved.push({ ...botConfig, clientId: runtimeClientId });
    }
    return buildInviteOverviewForTier(resolved, tier);
  } catch {
    return { freeWebsiteUrl: resolvePublicWebsiteUrl(), proBots: [], ultimateBots: [] };
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function renderInviteList(title, bots, language = "de") {
  const lang = normalizeLanguage(language, getDefaultLanguage());
  const isDe = lang === "de";
  if (!bots.length) {
    return `
      <h3 style="margin:18px 0 8px;font-size:15px;color:#A1A1AA">${escapeHtml(title)}</h3>
      <p style="margin:0;color:#52525B;font-size:12px">${isDe ? "Keine direkten Bot-Links verfügbar." : "No direct bot links available."}</p>`;
  }

  const rows = bots
    .map((bot) => `<li style="margin:6px 0"><a href="${escapeHtml(bot.url)}" style="color:#00F0FF;text-decoration:none">${isDe ? "Bot" : "Bot"} #${escapeHtml(bot.index)} - ${escapeHtml(bot.name || "Bot")}</a></li>`)
    .join("");

  return `
    <h3 style="margin:18px 0 8px;font-size:15px;color:#A1A1AA">${escapeHtml(title)}</h3>
    <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.6">${rows}</ul>`;
}

function buildResendEmailHtml({ license, tierName, inviteOverview, language }) {
  const lang = normalizeLanguage(language || license?.preferredLanguage || license?.language, getDefaultLanguage());
  const isDe = lang === "de";
  const locale = getLocaleForLanguage(lang);
  const expDate = license.expiresAt
    ? new Date(license.expiresAt).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" })
    : (isDe ? "Unbegrenzt" : "Unlimited");
  const tier = String(license.plan || "pro").toLowerCase();
  const tierColor = tier === "ultimate" ? "#BD00FF" : "#FFB800";
  const seats = Number(license.seats || 1);
  const linkedServerIds = Array.isArray(license.linkedServerIds) ? license.linkedServerIds : [];

  const proList = renderInviteList(isDe ? "Pro Bots" : "Pro bots", inviteOverview.proBots || [], lang);
  const ultimateList = tier === "ultimate"
    ? renderInviteList(isDe ? "Ultimate Bots" : "Ultimate bots", inviteOverview.ultimateBots || [], lang)
    : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:680px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${tierColor}22,transparent);padding:32px;text-align:center">
        <h1 style="font-size:24px;margin:0;color:${tierColor}">OmniFM ${escapeHtml(tierName)} - ${isDe ? "Lizenzdaten (Resend)" : "License details (resend)"}</h1>
      </div>
      <div style="padding:24px 32px">
        <div style="margin:0 0 18px;padding:18px;background:#111;border-radius:12px;border:1px solid ${tierColor}40;text-align:center">
          <p style="margin:0 0 6px;color:#A1A1AA;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700">${isDe ? "Lizenz-Key" : "License key"}</p>
          <p style="margin:0;font-size:24px;font-weight:800;font-family:'Courier New',monospace;color:${tierColor}">${escapeHtml(license.id || "-")}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;margin:10px 0 18px">
          <tr><td style="color:#888;padding:7px 0">Plan</td><td style="text-align:right;padding:7px 0;color:${tierColor};font-weight:700">${escapeHtml(tierName)}</td></tr>
          <tr><td style="color:#888;padding:7px 0">${isDe ? "Server-Slots" : "Server seats"}</td><td style="text-align:right;padding:7px 0">${escapeHtml(linkedServerIds.length)}/${escapeHtml(seats)}</td></tr>
          <tr><td style="color:#888;padding:7px 0">${isDe ? "Gueltig bis" : "Valid until"}</td><td style="text-align:right;padding:7px 0">${escapeHtml(expDate)}</td></tr>
          <tr><td style="color:#888;padding:7px 0">${isDe ? "Kontakt-E-Mail" : "Contact email"}</td><td style="text-align:right;padding:7px 0">${escapeHtml(license.contactEmail || "-")}</td></tr>
        </table>

        <div style="padding:14px;background:#1a1a1a;border-radius:12px;border:1px solid rgba(255,255,255,0.08)">
          <p style="margin:0 0 8px;color:#A1A1AA">${isDe ? "Server zuweisen:" : "Assign server:"}</p>
          <ol style="margin:0;padding-left:20px;color:#A1A1AA;line-height:1.8">
            <li>${isDe ? "Im Zielserver" : "In the target server"}: <code>/license activate ${escapeHtml(license.id || "")}</code></li>
            <li>${isDe ? "Status prüfen" : "Check status"}: <code>/license info</code></li>
            <li>${isDe ? "Invite-Links unten verwenden." : "Use the invite links below."}</li>
          </ol>
        </div>

        ${proList}
        ${ultimateList}

        <p style="margin:18px 0 0;color:#A1A1AA;font-size:12px">
          ${isDe ? "Weitere Links" : "More links"}: <a href="${escapeHtml(inviteOverview.freeWebsiteUrl || resolvePublicWebsiteUrl())}" style="color:#00F0FF;text-decoration:none">${escapeHtml(inviteOverview.freeWebsiteUrl || resolvePublicWebsiteUrl())}</a><br/>
          Support: <a href="${escapeHtml(SUPPORT_URL)}" style="color:#00F0FF;text-decoration:none">${escapeHtml(SUPPORT_URL)}</a>
        </p>
      </div>
    </div>`;
}

function printInviteOverviewToConsole(overview, tier) {
  const isUltimate = String(tier || "").toLowerCase() === "ultimate";
  const proBots = Array.isArray(overview.proBots) ? overview.proBots : [];
  const ultimateBots = Array.isArray(overview.ultimateBots) ? overview.ultimateBots : [];

  info("Invite-Links (Copy/Paste):");
  for (const bot of proBots) {
    console.log(`    PRO #${bot.index} - ${bot.name}: ${bot.url}`);
  }
  if (isUltimate) {
    for (const bot of ultimateBots) {
      console.log(`    ULTIMATE #${bot.index} - ${bot.name}: ${bot.url}`);
    }
  }
  console.log(`    Website: ${overview.freeWebsiteUrl || resolvePublicWebsiteUrl()}`);
  console.log(`    Support: ${SUPPORT_URL}`);
}

function printHeader() {
  console.log("");
  console.log("  \x1b[36m\x1b[1m╔═══════════════════════════════════════╗");
  console.log("  ║   OmniFM - Premium CLI                ║");
  console.log("  ╚═══════════════════════════════════════╝\x1b[0m");
  console.log("");
}

export function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

async function wizardMenu() {
  console.log("  Verfuegbare Aktionen:");
  console.log("    \x1b[32m1\x1b[0m) Premium aktivieren (mit Laufzeit)");
  console.log("    \x1b[33m2\x1b[0m) Premium verlaengern");
  console.log("    \x1b[35m3\x1b[0m) Upgrade (Pro -> Ultimate)");
  console.log("    \x1b[31m4\x1b[0m) Premium entfernen");
  console.log("    \x1b[36m5\x1b[0m) Alle Lizenzen anzeigen");
  console.log("    6) Server prüfen");
  console.log("    7) Preisrechner");
  console.log("    8) Tier-Infos");
  console.log("    9) Lizenz-Mail + Invite-Links erneut senden");
  console.log("    10) Coupon/Referral Codes verwalten (inkl. Pro/Ultimate Schnellsetup)");
  console.log("    11) Beenden");
  console.log("");
  return ask("Aktion waehlen");
}

async function run() {
  printHeader();

  while (true) {
    const choice = await wizardMenu();

    switch (choice.trim()) {
      // --- Aktivieren ---
      case "1": {
        const serverId = await ask("Server ID");
        if (!/^\d{17,22}$/.test(serverId)) { fail("Ungueltige Server ID."); break; }

        const existing = getServerLicense(serverId);
        if (existing && !existing.expired) {
          info(`Server hat bereits ${(existing.plan || "free").toUpperCase()} (${existing.remainingDays} Tage uebrig).`);
          info("Nutze Option 2 (Verlaengern) oder 3 (Upgrade).");
          break;
        }

        const tier = (await ask("Tier (pro/ultimate)")).toLowerCase();
        if (tier !== "pro" && tier !== "ultimate") { fail("Muss 'pro' oder 'ultimate' sein."); break; }

        const months = parseInt(await ask("Laufzeit in Monaten")) || 1;
        const price = calculatePrice(tier, months);
        info(`Preis: ${centsToEur(price)} (${months} Monat${months > 1 ? "e" : ""})`);
        if (months >= 12) info("Jahresrabatt: 12 Monate zum Preis von 10!");

        const note = await ask("Notiz (optional)") || "";
        const lic = addLicenseForServer(serverId, tier, months, "admin-cli", note);
        ok(`Server ${serverId} auf ${tier.toUpperCase()} aktiviert bis ${formatDate(lic.expiresAt)}.`);
        break;
      }

      // --- Verlaengern ---
      case "2": {
        const serverId = await ask("Server ID");
        if (!/^\d{17,22}$/.test(serverId)) { fail("Ungueltige Server ID."); break; }

        const lic = getServerLicense(serverId);
        if (!lic || lic.expired) { fail("Keine aktive Lizenz. Nutze Option 1 zum Aktivieren."); break; }

        info(`Aktiv: ${(lic.plan || "free").toUpperCase()} (${lic.remainingDays} Tage uebrig, bis ${formatDate(lic.expiresAt)})`);

        const months = parseInt(await ask("Zusaetzliche Monate")) || 1;
        const price = calculatePrice(lic.plan, months);
        info(`Preis: ${centsToEur(price)} fuer ${months} Monat${months > 1 ? "e" : ""}`);

        const updated = extendLicense(lic.id, months);
        ok(`Laufzeit verlaengert bis ${formatDate(updated.expiresAt)}.`);
        break;
      }

      // --- Upgrade ---
      case "3": {
        const serverId = await ask("Server ID");
        if (!/^\d{17,22}$/.test(serverId)) { fail("Ungueltige Server ID."); break; }

        const lic = getServerLicense(serverId);
        if (!lic || lic.expired) { fail("Keine aktive Lizenz."); break; }
        if (lic.plan === "ultimate") { fail("Bereits Ultimate."); break; }

        const upgrade = calculateUpgradePrice(serverId, "ultimate");
        if (!upgrade) { fail("Upgrade nicht moeglich."); break; }

        info(`Aktiv: PRO (${upgrade.daysLeft} Tage uebrig)`);
        info(`Upgrade-Preis: ${centsToEur(upgrade.upgradeCost)} (Aufpreis fuer Restlaufzeit)`);

        const confirm = (await ask("Upgrade durchfuehren? (j/n)")).toLowerCase();
        if (confirm === "j" || confirm === "y") {
          upgradeLicenseForServer(serverId, "ultimate");
          ok(`Server ${serverId} auf ULTIMATE upgraded!`);
        }
        break;
      }

      // --- Entfernen ---
      case "4": {
        const serverId = await ask("Server ID");
        const lic = getServerLicense(serverId);
        if (lic && lic.id) {
          const modeRaw = (await ask("Aktion (server/lizenz, Enter=server)")).trim().toLowerCase();
          const mode = modeRaw || "server";

          if (mode === "lizenz" || mode === "license") {
            const confirmDelete = (await ask("Wirklich KOMPLETTE Lizenz loeschen? (j/n)")).trim().toLowerCase();
            if (confirmDelete === "j" || confirmDelete === "y") {
              removeLicense(lic.id);
              ok(`Komplette Lizenz ${lic.id} geloescht.`);
            } else {
              info("Abgebrochen.");
            }
            break;
          }

          const result = unlinkServerFromLicense(serverId, lic.id);
          if (result.ok) {
            ok(`Server ${serverId} von Lizenz ${lic.id} entfernt.`);
          } else {
            fail(`Fehler beim Entfernen: ${result.message}`);
          }
        } else {
          fail("Keine Lizenz gefunden.");
        }
        break;
      }

      // --- Alle Lizenzen ---
      case "5": {
        const all = listLicenses();
        const entries = Object.entries(all);
        if (entries.length === 0) {
          info("Keine Lizenzen vorhanden.");
          break;
        }
        console.log("");
        console.log("  Server ID            Tier       Ablauf               Tage   Notiz");
        console.log("  " + "-".repeat(75));
        for (const [id, lic] of entries) {
          const expired = new Date(lic.expiresAt) <= new Date();
          const daysLeft = Math.max(0, Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000));
          const status = expired ? "\x1b[31mABGELAUFEN\x1b[0m" : `${daysLeft}`;
          const tierStr = (lic.plan || "?").padEnd(10);
          const expStr = formatDate(lic.expiresAt).padEnd(20);
          const servers = (lic.linkedServerIds || []).join(", ") || "-";
          const noteStr = (lic.note || "").substring(0, 30);
          console.log(`  ${id}  ${tierStr} ${expStr} ${status.padEnd(6)} ${noteStr}`);
          console.log(`    Server: ${servers} (${(lic.linkedServerIds || []).length}/${lic.seats || 1} Seats)`);
        }
        console.log("");
        info(`${entries.length} Lizenz(en) gesamt.`);
        break;
      }

      // --- Server prüfen ---
      case "6": {
        const serverId = await ask("Server ID");
        const lic = getServerLicense(serverId);
        if (!lic) {
          info(`Server ${serverId}: FREE (keine Lizenz).`);
        } else if (lic.expired) {
          fail(`Server ${serverId}: ABGELAUFEN (war ${lic.plan}).`);
          info(`Abgelaufen am: ${formatDate(lic.expiresAt)}`);
        } else {
          ok(`Server ${serverId}: ${(lic.plan || "free").toUpperCase()}`);
          info(`Laeuft ab: ${formatDate(lic.expiresAt)} (${lic.remainingDays} Tage uebrig)`);
          info(`Lizenz-ID: ${lic.id} | Seats: ${(lic.linkedServerIds || []).length}/${lic.seats || 1}`);
        }
        break;
      }

      // --- Preisrechner ---
      case "7": {
        const tier = (await ask("Tier (pro/ultimate)")).toLowerCase();
        if (tier !== "pro" && tier !== "ultimate") { fail("Muss 'pro' oder 'ultimate' sein."); break; }
        console.log("");
        console.log(`  Preistabelle fuer ${PLANS[tier].name}:`);
        console.log("  " + "-".repeat(40));
        for (const m of [1, 3, 6, 12, 24]) {
          const price = calculatePrice(tier, m);
          const monthly = centsToEur(Math.round(price / m));
          const total = centsToEur(price);
          const label = m >= 12 ? ` (${Math.floor(m / 12) * 2} Monate gratis!)` : "";
          console.log(`  ${String(m).padStart(2)} Monat${m > 1 ? "e" : " "}: ${total.padStart(12)}  (${monthly}/Monat)${label}`);
        }
        console.log("");
        break;
      }

      // --- Tier-Infos ---
      case "8": {
        console.log("");
        for (const [key, t] of Object.entries(PLANS)) {
          const seat1Price = getSeatPricePerMonthCents(key, 1);
          const price = seat1Price > 0 ? `${centsToEur(seat1Price)}/Monat (ab 1 Seat)` : "Kostenlos";
          console.log(`  ${t.name.padEnd(10)} ${price.padEnd(16)} Bitrate: ${t.bitrate} | Max Bots: ${t.maxBots} | Reconnect: ${t.reconnectMs}ms`);
        }
        console.log("");
        break;
      }

      // --- Resend Lizenz-Mail ---
      case "9":
      case "resend": {
        if (!isEmailConfigured()) {
          fail("SMTP ist nicht konfiguriert. Nutze zuerst: ./update.sh --email");
          break;
        }

        const query = await ask("Lizenz-ID oder Server-ID");
        const license = getLicenseByInput(query);
        if (!license || !license.id) {
          fail("Lizenz nicht gefunden.");
          break;
        }

        if (!["pro", "ultimate"].includes(String(license.plan || "").toLowerCase())) {
          fail("Nur Pro/Ultimate Lizenzen koennen erneut versendet werden.");
          break;
        }

        const tier = String(license.plan || "").toLowerCase();
        const tierName = PLANS[tier]?.name || tier;
        const defaultEmail = String(license.contactEmail || "").trim().toLowerCase();
        const emailPrompt = defaultEmail
          ? `Ziel-E-Mail (Enter fuer ${defaultEmail})`
          : "Ziel-E-Mail";
        const rawEmail = (await ask(emailPrompt)).trim().toLowerCase();
        const targetEmail = rawEmail || defaultEmail;

        if (!targetEmail) {
          fail("Keine Ziel-E-Mail angegeben.");
          break;
        }
        if (!isValidEmail(targetEmail)) {
          fail("Ungueltige E-Mail-Adresse.");
          break;
        }

        if (license.expired) {
          const continueExpired = (await ask("Lizenz ist abgelaufen. Trotzdem E-Mail senden? (j/n)")).trim().toLowerCase();
          if (continueExpired !== "j" && continueExpired !== "y") {
            info("Abgebrochen.");
            break;
          }
        }

        const inviteOverview = await getInviteOverviewForTier(tier);
        const mailLanguage = normalizeLanguage(license.preferredLanguage || license.language, getDefaultLanguage());
        const html = buildResendEmailHtml({
          license,
          tierName,
          inviteOverview,
          language: mailLanguage,
        });

        const subject = mailLanguage === "de"
          ? `OmniFM ${tierName} - Lizenz-Key & Invite-Links (Resend)`
          : `OmniFM ${tierName} - License key & invite links (resend)`;
        const result = await sendMail(targetEmail, subject, html);
        if (result?.success) {
          ok(`Resend erfolgreich an ${targetEmail} gesendet.`);
          info(`Lizenz-Key: ${license.id}`);
          printInviteOverviewToConsole(inviteOverview, tier);
        } else {
          fail(`Resend fehlgeschlagen: ${result?.error || "Unbekannter Fehler"}`);
      }
        break;
      }

      // --- Coupon/Referral Verwaltung ---
      case "10": {
        await manageOffersMenu();
        break;
      }

      case "11":
      case "q":
      case "exit":
        return 0;

      default:
        fail("Ungueltige Auswahl.");
    }
    console.log("");
  }
}

const cliMode = String(process.argv[2] || "wizard").trim().toLowerCase();
let code = 0;

if (cliMode === "offers" || cliMode === "--offers") {
  printHeader();
  await manageOffersMenu();
} else {
  code = await run();
}

rl.close();
// Every change reaches MongoDB before the process ends.
const { flushPremiumStoreWrites } = await import("./premium-store.js");
const { stopCouponStore } = await import("./coupon-store.js");
await flushPremiumStoreWrites().catch(() => {});
await stopCouponStore().catch(() => {});
process.exit(code);
