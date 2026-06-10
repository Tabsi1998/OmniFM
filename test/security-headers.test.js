import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
  getCommonSecurityHeaders,
  shouldSendStrictTransportSecurity,
} from "../src/lib/api-helpers.js";

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("security headers include CSP and Permissions-Policy without forcing HSTS on local HTTP", () => {
  const restoreEnv = setEnv({
    PUBLIC_WEB_URL: "http://127.0.0.1",
    WEB_DOMAIN: "",
    SECURITY_HSTS_ENABLED: undefined,
    HSTS_ENABLED: undefined,
  });

  try {
    const headers = getCommonSecurityHeaders();
    const csp = headers["Content-Security-Policy"];
    const permissions = headers["Permissions-Policy"];

    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Referrer-Policy"], "no-referrer");
    assert.equal(headers["X-Permitted-Cross-Domain-Policies"], "none");
    assert.equal(headers["Strict-Transport-Security"], undefined);

    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /https:\/\/www\.googletagmanager\.com/);
    assert.match(csp, /https:\/\/www\.google-analytics\.com/);
    assert.match(csp, /https:\/\/fonts\.googleapis\.com/);
    assert.match(csp, /https:\/\/fonts\.gstatic\.com/);
    assert.match(csp, /https:\/\/checkout\.stripe\.com/);

    assert.match(permissions, /camera=\(\)/);
    assert.match(permissions, /microphone=\(\)/);
    assert.match(permissions, /clipboard-write=\(self\)/);
  } finally {
    restoreEnv();
  }
});

test("HSTS is enabled for HTTPS production origins and can be overridden", () => {
  let restoreEnv = setEnv({
    PUBLIC_WEB_URL: "https://omnifm.xyz",
    WEB_DOMAIN: "",
    SECURITY_HSTS_ENABLED: undefined,
    HSTS_ENABLED: undefined,
  });

  try {
    assert.equal(shouldSendStrictTransportSecurity(), true);
    assert.match(getCommonSecurityHeaders()["Strict-Transport-Security"], /max-age=31536000/);
  } finally {
    restoreEnv();
  }

  restoreEnv = setEnv({
    PUBLIC_WEB_URL: "https://omnifm.xyz",
    SECURITY_HSTS_ENABLED: "0",
  });

  try {
    assert.equal(shouldSendStrictTransportSecurity(), false);
    assert.equal(getCommonSecurityHeaders()["Strict-Transport-Security"], undefined);
  } finally {
    restoreEnv();
  }
});

test("policy builders return compact header strings", () => {
  assert.match(buildContentSecurityPolicy(), /default-src 'self'; base-uri 'self'/);
  assert.doesNotMatch(buildContentSecurityPolicy(), /\n/);
  assert.match(buildPermissionsPolicy(), /geolocation=\(\), gyroscope=\(\)/);
  assert.doesNotMatch(buildPermissionsPolicy(), /\n/);
});
