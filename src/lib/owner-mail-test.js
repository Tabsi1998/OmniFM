import { getSmtpConfig, isConfigured as isEmailConfigured, sendMail } from "../email.js";

const TEST_CONFIRMATION_VALUE = "send-test-email";

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function maskEmail(value) {
  const email = cleanEmail(value);
  if (!email || !email.includes("@")) return "";
  return email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
}

function getOwnerMailStatus() {
  const cfg = getSmtpConfig();
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = String(process.env.SMTP_PORT || "587").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const from = String(process.env.SMTP_FROM || user).trim();
  const adminEmail = cleanEmail(process.env.ADMIN_EMAIL || "");
  const passConfigured = String(process.env.SMTP_PASS || "").trim().length > 0;
  const defaultRecipient = adminEmail || cleanEmail(from) || cleanEmail(user);
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!passConfigured) missing.push("SMTP_PASS");

  return {
    generatedAt: new Date().toISOString(),
    configured: Boolean(cfg),
    host,
    port,
    user,
    from,
    adminEmail,
    adminEmailMasked: maskEmail(adminEmail),
    defaultRecipient,
    defaultRecipientMasked: maskEmail(defaultRecipient),
    tlsMode: cfg?.tlsMode || String(process.env.SMTP_TLS_MODE || "auto").trim().toLowerCase() || "auto",
    rejectUnauthorized: cfg ? Boolean(cfg.rejectUnauthorized) : String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? "0") !== "0",
    passwordConfigured: passConfigured,
    missing,
    confirmationValue: TEST_CONFIRMATION_VALUE,
  };
}

async function sendOwnerTestMail(input = {}, { sendMailImpl = sendMail, isConfiguredImpl = isEmailConfigured } = {}) {
  if (!isConfiguredImpl()) {
    const err = new Error("SMTP ist nicht konfiguriert.");
    err.statusCode = 503;
    throw err;
  }

  const status = getOwnerMailStatus();
  const to = cleanEmail(input.to || status.defaultRecipient);
  if (!isValidEmail(to)) {
    const err = new Error("Bitte eine gueltige Empfaenger-E-Mail angeben.");
    err.statusCode = 400;
    throw err;
  }

  const sentAt = new Date().toISOString();
  const result = await sendMailImpl(
    to,
    "OmniFM - SMTP Test",
    "<div style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#fff;padding:24px;border-radius:14px\">" +
      "<h2 style=\"color:#00F0FF;margin:0 0 12px\">SMTP Test erfolgreich</h2>" +
      "<p style=\"color:#d4d4d8\">Diese Nachricht wurde aus dem OmniFM Owner-Portal gesendet.</p>" +
      `<p style=\"font-size:12px;color:#a1a1aa\">Zeit: ${sentAt}</p>` +
      `<p style=\"font-size:12px;color:#71717a\">Host: ${status.host || "-"}</p>` +
    "</div>"
  );

  if (!result?.success) {
    const err = new Error(result?.error || "SMTP-Testmail konnte nicht gesendet werden.");
    err.statusCode = 502;
    throw err;
  }

  return {
    ok: true,
    to,
    toMasked: maskEmail(to),
    sentAt,
  };
}

export {
  TEST_CONFIRMATION_VALUE,
  getOwnerMailStatus,
  sendOwnerTestMail,
};
