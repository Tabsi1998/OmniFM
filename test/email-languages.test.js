import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The customer's e-mails in the bot's nine languages (#482): every mail and
// subject builds in every language with no {placeholder} left, French reads
// French, the operator's note stays in the installation's language.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-email-languages-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const {
  buildAdminNotification, buildExpiryEmail, buildExpirySubject, buildExpiryWarningEmail, buildExpiryWarningSubject,
  buildPurchaseEmail, buildPurchaseSubject, formatMoney, resolveEmailLanguage,
} = await import("../src/email.js");
const { BOT_LANGUAGES } = await import("../src/lib/bot-i18n.js");
const { getDefaultLanguage } = await import("../src/i18n.js");
const { translateOfferReason } = await import("../src/lib/helpers.js");

const OPEN_PLACEHOLDER = /\{[a-z][A-Za-z]*\}/;
const purchase = (language, patch = {}) => buildPurchaseEmail({
  tier: "pro", tierName: "Pro", months: 3, licenseKey: "OMNI-TEST-1", seats: 2, expiresAt: "2026-12-24T12:00:00Z",
  inviteOverview: { proBots: [{ name: "OmniFM 2", index: 2, url: "https://discord.com/oauth2/authorize?client_id=2" }], ultimateBots: [] },
  dashboardUrl: "https://omnifm.xyz", pricePaid: 0, baseAmountCents: 897, discountCents: 897, appliedOfferCode: "free3", appliedOfferKind: "coupon",
  currency: "eur", language, ...patch,
});

test("every mail and subject builds in all nine languages, every placeholder filled", () => {
  for (const language of BOT_LANGUAGES) {
    const mails = {
      new: purchase(language),
      renewal: purchase(language, { isRenewal: true, months: 1, seats: 1 }),
      upgrade: purchase(language, { tier: "ultimate", tierName: "Ultimate", isUpgrade: true }),
      warning1: buildExpiryWarningEmail({ tierName: "Pro", serverId: "123456789012345678", expiresAt: "2026-12-24T12:00:00Z", daysLeft: 1, language }),
      warning7: buildExpiryWarningEmail({ tierName: "Pro", serverId: "123456789012345678", expiresAt: "2026-12-24T12:00:00Z", daysLeft: 7, language }),
      expired: buildExpiryEmail({ tierName: "Pro", serverId: "123456789012345678", language }),
    };
    for (const [name, html] of Object.entries(mails)) {
      assert.doesNotMatch(html, OPEN_PLACEHOLDER, `${language} ${name}`);
      assert.match(html, new RegExp(`lang="${language}"`), `${language} ${name}: the mail says its language`);
    }
    const subjects = [
      buildPurchaseSubject({ planName: "Pro", language }),
      buildPurchaseSubject({ planName: "Pro", language, trial: true }),
      buildExpiryWarningSubject({ planName: "Pro", daysLeft: 1, language }),
      buildExpiryWarningSubject({ planName: "Pro", daysLeft: 7, language }),
      buildExpirySubject({ planName: "Pro", language }),
    ];
    for (const subject of subjects) assert.doesNotMatch(subject, OPEN_PLACEHOLDER, `${language}: ${subject}`);
  }
});

test("a French customer reads French: texts, plan lines, money and date", () => {
  const html = purchase("fr");
  assert.match(html, /OmniFM Pro – ta clé de licence/);
  assert.match(html, /Étapes suivantes : activer ta licence/);
  assert.match(html, /salons vocaux en même temps/, "the plan lines come from the website's source, in French");
  assert.match(html, /24\/12\/2026/, "the date as the French write it");
  assert.match(formatMoney(897, "eur", "fr"), /8,97\s€/);
  assert.equal(buildExpiryWarningSubject({ planName: "Pro", daysLeft: 3, language: "fr" }), "Premium Pro expire dans 3 jours !");
  assert.equal(translateOfferReason("coupon_expired", "fr"), "Le code promo a expiré.");
  assert.equal(resolveEmailLanguage("fr-FR"), "fr");
  assert.equal(resolveEmailLanguage("ja"), getDefaultLanguage(), "a language the bot does not speak: the installation's");
});

test("German and English keep their wording; one day is singular", () => {
  assert.equal(buildExpiryWarningSubject({ planName: "Pro", daysLeft: 1, language: "de" }), "Premium Pro läuft in 1 Tag ab!");
  assert.equal(buildExpiryWarningSubject({ planName: "Pro", daysLeft: 5, language: "en" }), "Premium Pro expires in 5 days!");
  assert.match(buildExpiryWarningEmail({ tierName: "Pro", serverId: "1", expiresAt: "2026-12-24T12:00:00Z", daysLeft: 1, language: "de" }), /in <strong>1 Tag<\/strong> ab/);
  assert.match(purchase("de", { seats: 1, months: 1 }), /1 Server[\s\S]*1 Monat/);
  assert.equal(translateOfferReason("referral_self", "de"), "Eigenen Empfehlungscode kann man nicht nutzen.");
  assert.equal(translateOfferReason("unknown_reason", "de"), "unknown_reason");
});

test("the operator's note is in the installation's language, whatever the customer speaks", () => {
  const html = buildAdminNotification({ tier: "pro", tierName: "Pro", months: 1, serverId: "-", expiresAt: "2026-12-24T12:00:00Z", pricePaid: 0, language: "fr" });
  assert.match(html, getDefaultLanguage() === "de" ? /Neue Premium-Lizenz/ : /New premium license/);
});

test("values from outside are escaped in the mail", () => {
  const html = purchase("en", { licenseKey: "<b>KEY</b>", appliedOfferCode: "<x>", inviteOverview: { proBots: [{ name: "<img src=x>", index: 1, url: "https://x\"onclick=\"y" }] } });
  assert.doesNotMatch(html, /<b>KEY<\/b>|<img src=x>|"onclick="/);
  assert.match(html, /&lt;B&gt;KEY&lt;\/B&gt;|&lt;b&gt;KEY&lt;\/b&gt;/);
});
