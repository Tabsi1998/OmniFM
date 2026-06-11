import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_CONFIRMATION_VALUE,
  getOwnerMailStatus,
  sendOwnerTestMail,
} from "../src/lib/owner-mail-test.js";

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("owner mail status exposes SMTP state without password value", () => {
  const restore = setEnv({
    SMTP_HOST: "mail.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "smtp@example.com",
    SMTP_PASS: "smtp-secret",
    SMTP_FROM: "noreply@example.com",
    ADMIN_EMAIL: "owner@example.com",
    SMTP_TLS_MODE: "starttls",
    SMTP_TLS_REJECT_UNAUTHORIZED: "1",
  });
  try {
    const status = getOwnerMailStatus();
    assert.equal(status.configured, true);
    assert.equal(status.passwordConfigured, true);
    assert.equal(status.defaultRecipient, "owner@example.com");
    assert.equal(status.defaultRecipientMasked, "ow***@example.com");
    assert.equal(status.confirmationValue, TEST_CONFIRMATION_VALUE);
    assert.equal(JSON.stringify(status).includes("smtp-secret"), false);
  } finally {
    restore();
  }
});

test("owner test mail validates config, recipient, and send result", async () => {
  const restore = setEnv({
    SMTP_HOST: "mail.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "smtp@example.com",
    SMTP_PASS: "smtp-secret",
    SMTP_FROM: "noreply@example.com",
    ADMIN_EMAIL: "owner@example.com",
  });
  try {
    await assert.rejects(
      () => sendOwnerTestMail({ to: "owner@example.com" }, { isConfiguredImpl: () => false }),
      /SMTP ist nicht konfiguriert/
    );

    await assert.rejects(
      () => sendOwnerTestMail({ to: "not-an-email" }, { isConfiguredImpl: () => true }),
      /gueltige Empfaenger-E-Mail/
    );

    const sent = [];
    const result = await sendOwnerTestMail(
      { to: "owner@example.com" },
      {
        isConfiguredImpl: () => true,
        sendMailImpl: async (to, subject, html) => {
          sent.push({ to, subject, html });
          return { success: true };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.to, "owner@example.com");
    assert.equal(result.toMasked, "ow***@example.com");
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /SMTP Test/);
  } finally {
    restore();
  }
});
