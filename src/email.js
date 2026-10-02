import nodemailer from "nodemailer";
import fs from "node:fs";
import { getDefaultLanguage } from "./i18n.js";
import { botLocale, botTranslator, normalizeBotLanguage } from "./lib/bot-i18n.js";
import { planCardLinesIn } from "./config/plan-feature-texts.js";
import { catalogPlanContext } from "./bot/plan-texts.js";
import { log } from "./lib/logging.js";

function resolveTlsMode(port, rawMode) {
  const mode = String(rawMode || "auto").trim().toLowerCase();
  if (["plain", "starttls", "smtps"].includes(mode)) return mode;
  if (port === 465) return "smtps";
  return "starttls";
}

function resolveTlsRejectUnauthorized(rawValue) {
  const value = String(rawValue ?? "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const adminEmail = process.env.ADMIN_EMAIL || "";
  const tlsMode = resolveTlsMode(port, process.env.SMTP_TLS_MODE);
  const rejectUnauthorized = resolveTlsRejectUnauthorized(process.env.SMTP_TLS_REJECT_UNAUTHORIZED);
  const tlsServername = String(process.env.SMTP_TLS_SERVERNAME || "").trim() || null;
  const tlsCaPath = String(process.env.SMTP_TLS_CA_PATH || "").trim() || null;

  if (!host || !user || !pass) return null;
  return {
    host, port, user, pass, from, adminEmail,
    tlsMode, rejectUnauthorized, tlsServername, tlsCaPath,
  };
}

function createTransporter() {
  const cfg = getSmtpConfig();
  if (!cfg) return null;

  const options = {
    host: cfg.host,
    port: cfg.port,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: cfg.rejectUnauthorized },
  };

  if (cfg.tlsMode === "smtps") {
    options.secure = true;
  } else if (cfg.tlsMode === "starttls") {
    options.secure = false;
    options.requireTLS = true;
  } else {
    options.secure = false;
    options.ignoreTLS = true;
  }

  if (cfg.tlsServername) {
    options.tls.servername = cfg.tlsServername;
  }

  if (cfg.tlsCaPath) {
    try {
      options.tls.ca = fs.readFileSync(cfg.tlsCaPath, "utf8");
    } catch (err) {
      log("ERROR", `[email] CA file konnte nicht gelesen werden (${cfg.tlsCaPath}): ${err.message}`);
    }
  }

  return nodemailer.createTransport(options);
}

function isConfigured() {
  return getSmtpConfig() !== null;
}

async function sendMail(to, subject, html) {
  const cfg = getSmtpConfig();
  if (!cfg) return { error: "SMTP nicht konfiguriert." };

  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: `"OmniFM Premium" <${cfg.from}>`,
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (err) {
    log("ERROR", `[email] Send failed: ${err.message}`);
    return { error: err.message };
  }
}

// ---- The customer's e-mails in the bot's nine languages (#482) ----
// German and English in the code, the other seven from src/i18n/bot/<code>.json
// like every bot text; values go in as {placeholders}.

const SUPPORT_DISCORD_URL = "https://discord.gg/UeRkfGS43R";
const SUPPORT_EMAIL = "contact@omnifm.xyz";

/** The customer's language: one of the bot's nine, else the installation's. */
function resolveLanguage(rawLanguage) {
  return normalizeBotLanguage(rawLanguage, getDefaultLanguage());
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** "2,99 €", "€2.99", "2,99 €" … in the reader's own format. */
function formatMoney(cents, currency = "eur", rawLanguage = getDefaultLanguage()) {
  const language = resolveLanguage(rawLanguage);
  const value = Number(cents || 0) / 100;
  const cur = String(currency || "eur").toUpperCase();
  try {
    return new Intl.NumberFormat(botLocale(language), { style: "currency", currency: cur }).format(value);
  } catch {
    return `${value.toFixed(2)} ${cur}`;
  }
}

function formatDate(value, language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(botLocale(language), { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** What the plan brings, from the one source the website and the bot use (#413). */
function planBenefitLines(tier, language) {
  try {
    return planCardLinesIn(tier === "ultimate" ? "ultimate" : "pro", { language, context: catalogPlanContext(), highlightsOnly: true }).lines;
  } catch {
    return [];
  }
}

function buildPurchaseEmail(data) {
  const {
    tier,
    tierName,
    months,
    licenseKey,
    seats,
    expiresAt,
    inviteOverview,
    dashboardUrl,
    pricePaid,
    baseAmountCents,
    discountCents,
    appliedOfferCode,
    appliedOfferKind,
    referralCode,
    offerOwnerLabel,
    currency,
    language,
    isRenewal = false,
    isUpgrade = false,
  } = data;

  const lang = resolveLanguage(language);
  const t = botTranslator(lang);
  const plan = escapeHtml(tierName);
  const expDate = formatDate(expiresAt, lang);
  const tierColor = tier === "ultimate" ? "#BD00FF" : "#FFB800";
  const moneyLabel = formatMoney(pricePaid || 0, currency || "eur", lang);
  const seatCount = Number(seats || 1);
  const monthCount = Number(months || 1);
  const freeWebsiteUrl = String(inviteOverview?.freeWebsiteUrl || dashboardUrl || SUPPORT_DISCORD_URL).trim();
  const proBots = Array.isArray(inviteOverview?.proBots) ? inviteOverview.proBots : [];
  const ultimateBots = Array.isArray(inviteOverview?.ultimateBots) ? inviteOverview.ultimateBots : [];

  let heading = t("OmniFM {plan} – Dein Lizenz-Key", "OmniFM {plan} – your license key", { plan });
  if (isRenewal) heading = t("OmniFM {plan} – Verlängerung bestätigt", "OmniFM {plan} – renewal confirmed", { plan });
  if (isUpgrade) heading = t("OmniFM {plan} – Upgrade bestätigt", "OmniFM {plan} – upgrade confirmed", { plan });
  const existingKey = isRenewal || isUpgrade;
  const keyTitle = existingKey ? t("Dein bestehender Lizenz-Key", "Your existing license key") : t("Dein Lizenz-Key", "Your license key");
  const keyHint = existingKey
    ? t("Dieser Key bleibt unverändert und wurde verlängert.", "This key stays the same and was extended.")
    : t("Bewahre diesen Key sicher auf!", "Keep this key in a safe place!");
  const durationText = monthCount === 1 ? t("1 Monat", "1 month") : t("{count} Monate", "{count} months", { count: monthCount });
  const seatsText = seatCount === 1 ? t("1 Server", "1 server") : t("{count} Server", "{count} servers", { count: seatCount });
  const rawDiscountCents = Math.max(0, Number.parseInt(String(discountCents || 0), 10) || 0);
  const hasDiscount = rawDiscountCents > 0;
  const discountText = hasDiscount ? formatMoney(rawDiscountCents, currency || "eur", lang) : null;
  const baseAmountText = Number(baseAmountCents || 0) > 0 ? formatMoney(baseAmountCents, currency || "eur", lang) : null;
  const appliedCodeText = escapeHtml(String(appliedOfferCode || "").trim().toUpperCase());
  const referralCodeText = escapeHtml(String(referralCode || "").trim().toUpperCase());
  const codeText = appliedCodeText ? `${appliedCodeText}${appliedOfferKind ? ` (${escapeHtml(appliedOfferKind)})` : ""}` : null;
  const referralText = referralCodeText ? `${referralCodeText}${offerOwnerLabel ? ` (${escapeHtml(offerOwnerLabel)})` : ""}` : null;

  const benefits = planBenefitLines(tier, lang);
  const benefitsIntro = tier === "ultimate" ? `<p style="margin:0 0 6px;color:#A1A1AA;font-size:13px">${t("Alles aus Pro, dazu:", "Everything in Pro, plus:")}</p>` : "";
  const benefitsList = benefits.length
    ? `<ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.7">${benefits.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : "";

  const keyForCommand = licenseKey ? escapeHtml(licenseKey) : escapeHtml(t("<dein-key>", "<your-key>"));
  const command = `<code style="color:#fff;background:#111;padding:2px 6px;border-radius:6px">/license activate ${keyForCommand}</code>`;
  const nextStep1 = t("Lade einen OmniFM-Bot auf deinen Server ein (falls noch nicht geschehen).", "Invite an OmniFM bot to your server (if you have not yet).");
  const nextStep2 = existingKey
    ? t("Ist dein Lizenz-Key auf deinen Servern schon aktiv, musst du nichts weiter tun.", "If your license key is already active on your servers, there is nothing more to do.")
    : t("Führe auf jedem Server den Befehl {command} aus.", "Run the command {command} on each server.", { command });
  const nextStep3 = seatCount === 1
    ? t("Aktiviere den Key auf einem Server (1 Slot).", "Activate the key on one server (1 slot).")
    : t("Aktiviere den Key auf bis zu {count} Servern ({count} Slots).", "Activate the key on up to {count} servers ({count} slots).", { count: seatCount });
  const slotHint = t(
    "Klappt die Aktivierung nicht, melde dich im Discord-Support oder per E-Mail an {email}.",
    "If activation does not work, ask in the Discord support or email {email}.",
    { email: SUPPORT_EMAIL },
  );
  const websiteLabel = t("OmniFM-Website", "OmniFM website");
  const footerNote = tier === "ultimate"
    ? t("Server wechseln oder Probleme beim Aktivieren? Schreib uns jederzeit per E-Mail oder auf Discord (Priority-Support für Ultimate).", "Switching servers or trouble activating? Write to us any time by email or on Discord (priority support for Ultimate).")
    : t("Server wechseln oder Probleme beim Aktivieren? Schreib uns jederzeit per E-Mail oder auf Discord.", "Switching servers or trouble activating? Write to us any time by email or on Discord.");

  const renderInviteList = (items) => items
    .map((bot) => {
      const label = `${escapeHtml(bot.name || "OmniFM Bot")} (#${Number(bot.index || 0)})`;
      return `<li style="margin:0 0 8px"><a href="${escapeHtml(bot.url)}" style="color:${tierColor};text-decoration:none;font-weight:600">${label}</a></li>`;
    })
    .join("");

  let inviteSection = "";
  if (proBots.length || ultimateBots.length) {
    inviteSection = `
      <div style="margin:18px 0;padding:18px;background:#121212;border-radius:12px;border:1px solid ${tierColor}33">
        <h3 style="margin:0 0 6px;color:${tierColor};font-size:15px">${t("Direkte Einladungslinks für die Bots", "Direct invite links for the bots")}</h3>
        <p style="margin:0 0 12px;color:#A1A1AA;font-size:12px">${t("Diese Links funktionieren sofort für deinen freigeschalteten Plan.", "These links work right away for your unlocked plan.")}</p>
        ${proBots.length ? `
        <div style="margin:0 0 8px;color:#D4D4D8;font-size:12px;font-weight:700">${t("Pro-Bots", "Pro bots")}</div>
        <ul style="margin:0 0 10px;padding-left:18px;color:#A1A1AA">${renderInviteList(proBots)}</ul>` : ""}
        ${ultimateBots.length ? `
        <div style="margin:0 0 8px;color:#D4D4D8;font-size:12px;font-weight:700">${t("Ultimate-Bots", "Ultimate bots")}</div>
        <ul style="margin:0;padding-left:18px;color:#A1A1AA">${renderInviteList(ultimateBots)}</ul>` : ""}
        <p style="margin:12px 0 0;color:#52525B;font-size:11px">${t("Die Free-Bots findest du auf der Website.", "You find the free bots on the website.")} <a href="${escapeHtml(freeWebsiteUrl)}" style="color:#00F0FF;text-decoration:none">${websiteLabel}</a></p>
      </div>`;
  }

  const row = (label, value, style = "") => `<tr><td style="color:#888;padding:8px 0">${label}</td><td style="text-align:right;padding:8px 0;${style}">${value}</td></tr>`;

  return `
    <div lang="${lang}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${tierColor}22,transparent);padding:32px;text-align:center">
        <h1 style="font-size:24px;margin:0;color:${tierColor}">${heading}</h1>
      </div>
      <div style="padding:24px 32px">
        <div style="margin:0 0 24px;padding:20px;background:#111;border-radius:14px;border:2px solid ${tierColor}40;text-align:center">
          <p style="margin:0 0 8px;color:#A1A1AA;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700">${keyTitle}</p>
          <p style="margin:0;font-size:28px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:3px;color:${tierColor}">${escapeHtml(licenseKey || "---")}</p>
          <p style="margin:8px 0 0;color:#52525B;font-size:11px">${keyHint}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          ${row(t("Plan", "Plan"), plan, `color:${tierColor};font-weight:700`)}
          ${row(t("Server-Slots", "Server seats"), seatsText, "font-weight:600")}
          ${row(t("Laufzeit", "Duration"), durationText)}
          ${row(t("Gültig bis", "Valid until"), expDate, "font-weight:700")}
          ${hasDiscount && baseAmountText ? row(t("Originalpreis", "Base price"), baseAmountText) : ""}
          ${hasDiscount ? row(t("Rabatt", "Discount"), `-${discountText}`, "color:#39FF14") : ""}
          ${codeText ? row(t("Code", "Code"), codeText, "font-family:JetBrains Mono,monospace") : ""}
          ${referralText ? row(t("Empfehlung", "Referral"), referralText, "font-family:JetBrains Mono,monospace") : ""}
          ${row(t("Bezahlt", "Paid"), moneyLabel)}
        </table>

        ${benefitsList ? `
        <div style="margin:16px 0 8px">
          <h3 style="margin:0 0 8px;color:${tierColor};font-size:15px">${t("Was dein Plan bringt", "What your plan brings")}</h3>
          ${benefitsIntro}
          ${benefitsList}
        </div>` : ""}

        ${inviteSection}

        <div style="margin:20px 0;padding:18px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
          <h3 style="color:${tierColor};margin:0 0 12px;font-size:15px">${t("Nächste Schritte: Lizenz aktivieren", "Next steps: activate your license")}</h3>
          <ol style="margin:0;padding-left:20px;color:#A1A1AA;font-size:13px;line-height:2">
            <li>${nextStep1}</li>
            <li>${nextStep2}</li>
            <li>${nextStep3}</li>
          </ol>
          <p style="margin:12px 0 0;color:#52525B;font-size:11px">${slotHint}</p>
        </div>

        <div style="margin:16px 0;display:flex;gap:10px">
          <a href="${SUPPORT_DISCORD_URL}" style="flex:1;text-align:center;color:#fff;text-decoration:none;background:${tierColor}22;border:1px solid ${tierColor}33;padding:12px;border-radius:10px;font-weight:600;font-size:13px">${t("Discord-Support", "Discord support")}</a>
          <a href="mailto:${SUPPORT_EMAIL}" style="flex:1;text-align:center;color:#fff;text-decoration:none;background:rgba(57,255,20,0.12);border:1px solid rgba(57,255,20,0.35);padding:12px;border-radius:10px;font-weight:600;font-size:13px">${t("E-Mail-Support", "Email support")}</a>
          <a href="${escapeHtml(freeWebsiteUrl)}" style="flex:1;text-align:center;color:#fff;text-decoration:none;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:12px;border-radius:10px;font-weight:600;font-size:13px">${websiteLabel}</a>
        </div>

        <p style="color:#52525B;font-size:11px;margin-top:20px;text-align:center;line-height:1.6">
          ${footerNote}
        </p>
      </div>
    </div>`;
}

/** The subject of the license mail after a free code or the trial month. */
function buildPurchaseSubject({ planName, language, trial = false }) {
  const t = botTranslator(resolveLanguage(language));
  const plan = String(planName || "");
  return trial
    ? t("OmniFM Pro-Testmonat – dein Lizenz-Key", "OmniFM Pro trial month – your license key")
    : t("OmniFM {plan} – Gratis-Lizenz aktiviert", "OmniFM {plan} – free license activated", { plan });
}

/**
 * The note to the operator about a new license: in the installation's
 * language, whatever the customer's is.
 */
function buildAdminNotification(data) {
  const { tier, tierName, months, serverId, expiresAt, pricePaid } = data;
  const lang = resolveLanguage(getDefaultLanguage());
  const t = botTranslator(lang);
  const price = pricePaid ? formatMoney(pricePaid, "eur", lang) : t("Gratis", "Free");
  const monthCount = Number(months || 1);
  const duration = monthCount === 1 ? t("1 Monat", "1 month") : t("{count} Monate", "{count} months", { count: monthCount });

  return `
    <div style="font-family:monospace;padding:16px">
      <h2>${t("Neue Premium-Lizenz", "New premium license")}</h2>
      <ul>
        <li>${t("Server", "Server")}: ${escapeHtml(serverId)}</li>
        <li>${t("Plan", "Plan")}: ${escapeHtml(tierName)} (${escapeHtml(tier)})</li>
        <li>${t("Laufzeit", "Duration")}: ${duration}</li>
        <li>${t("Läuft ab", "Expires")}: ${formatDate(expiresAt, lang)}</li>
        <li>${t("Betrag", "Amount")}: ${price}</li>
        <li>${t("Zeit", "Time")}: ${new Date().toLocaleString(botLocale(lang))}</li>
      </ul>
    </div>`;
}

function expiryLayout({ title, paragraphs, action, lang }) {
  return `
    <div lang="${lang}" style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:#FF2A2A22;padding:32px;text-align:center">
        <h1 style="font-size:22px;margin:0;color:#FF2A2A">${title}</h1>
      </div>
      <div style="padding:24px 32px">
        ${paragraphs.map((text) => `<p>${text}</p>`).join("\n        ")}
        <p style="margin-top:20px">
          <a href="${SUPPORT_DISCORD_URL}" style="color:#FFB800;font-weight:700">${action}</a>
        </p>
      </div>
    </div>`;
}

function buildExpiryWarningEmail(data) {
  const { tierName, serverId, expiresAt, daysLeft, language } = data;
  const lang = resolveLanguage(language);
  const t = botTranslator(lang);
  const days = Math.max(1, Number(daysLeft) || 1);
  const values = { plan: escapeHtml(tierName), server: escapeHtml(serverId), days, date: formatDate(expiresAt, lang) };
  return expiryLayout({
    lang,
    title: t("Premium läuft bald ab!", "Premium is expiring soon!"),
    paragraphs: [
      days === 1
        ? t("Dein <strong>{plan}</strong>-Abo für Server <code>{server}</code> läuft in <strong>1 Tag</strong> ab ({date}).", "Your <strong>{plan}</strong> plan for server <code>{server}</code> expires in <strong>1 day</strong> ({date}).", values)
        : t("Dein <strong>{plan}</strong>-Abo für Server <code>{server}</code> läuft in <strong>{days} Tagen</strong> ab ({date}).", "Your <strong>{plan}</strong> plan for server <code>{server}</code> expires in <strong>{days} days</strong> ({date}).", values),
      t("Danach schalten sich die Premium-Bots und die eigenen Sender ab.", "After that, the premium bots and your own stations switch off."),
    ],
    action: t("Jetzt verlängern →", "Renew now →"),
  });
}

function buildExpiryEmail(data) {
  const { tierName, serverId, language } = data;
  const lang = resolveLanguage(language);
  const t = botTranslator(lang);
  const values = { plan: escapeHtml(tierName), server: escapeHtml(serverId) };
  return expiryLayout({
    lang,
    title: t("Premium abgelaufen", "Premium expired"),
    paragraphs: [
      t("Dein <strong>{plan}</strong>-Abo für Server <code>{server}</code> ist abgelaufen.", "Your <strong>{plan}</strong> plan for server <code>{server}</code> has expired.", values),
      t("Die Premium-Bots und die eigenen Sender sind jetzt abgeschaltet, die Einladungslinks gelten nicht mehr.", "The premium bots and your own stations are switched off now, and the invite links no longer work."),
    ],
    action: t("Plan erneuern →", "Renew your plan →"),
  });
}

/** The subjects of the two expiry mails. */
function buildExpiryWarningSubject({ planName, daysLeft, language }) {
  const t = botTranslator(resolveLanguage(language));
  const days = Math.max(1, Number(daysLeft) || 1);
  const plan = String(planName || "");
  return days === 1
    ? t("Premium {plan} läuft in 1 Tag ab!", "Premium {plan} expires in 1 day!", { plan })
    : t("Premium {plan} läuft in {days} Tagen ab!", "Premium {plan} expires in {days} days!", { plan, days });
}

function buildExpirySubject({ planName, language }) {
  const t = botTranslator(resolveLanguage(language));
  return t("Premium {plan} abgelaufen", "Premium {plan} expired", { plan: String(planName || "") });
}

export {
  isConfigured, sendMail, getSmtpConfig, resolveTlsRejectUnauthorized,
  buildPurchaseEmail, buildPurchaseSubject, buildAdminNotification,
  buildExpiryWarningEmail, buildExpiryEmail, buildExpiryWarningSubject, buildExpirySubject,
  formatMoney, resolveLanguage as resolveEmailLanguage,
};
