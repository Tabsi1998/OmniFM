import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCors,
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
  getClientIp,
  getCommonSecurityHeaders,
  getTrustedForwardedProto,
  isTrustedProxyAddress,
  normalizeIpAddress,
  parseTrustedProxyIps,
  shouldTrustProxyHeaders,
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

test("CORS requires an explicit configured origin instead of trusting Host or WEB_DOMAIN", () => {
  const restoreEnv = setEnv({
    PUBLIC_WEB_URL: "",
    WEB_DOMAIN: "omnifm.xyz",
    CORS_ALLOWED_ORIGINS: "",
    CORS_ORIGINS: "",
  });

  try {
    const headers = new Map();
    const res = {
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), value);
      },
    };
    const req = {
      headers: {
        host: "omnifm.xyz",
        origin: "https://omnifm.xyz",
      },
      socket: { encrypted: false },
    };

    assert.equal(applyCors(req, res, ""), false);
    assert.equal(headers.get("access-control-allow-origin"), undefined);

    process.env.PUBLIC_WEB_URL = "https://app.omnifm.xyz";
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
    const configuredHeaders = new Map();
    const configuredRes = {
      setHeader(name, value) {
        configuredHeaders.set(String(name).toLowerCase(), value);
      },
    };
    const configuredReq = {
      headers: {
        host: "internal-proxy.local",
        origin: "https://app.omnifm.xyz",
      },
      socket: { encrypted: false },
    };

    assert.equal(applyCors(configuredReq, configuredRes, process.env.PUBLIC_WEB_URL), true);
    assert.equal(configuredHeaders.get("access-control-allow-origin"), "https://app.omnifm.xyz");
    assert.equal(configuredHeaders.get("access-control-allow-credentials"), "true");

    const localHeaders = new Map();
    const localRes = {
      setHeader(name, value) {
        localHeaders.set(String(name).toLowerCase(), value);
      },
    };
    assert.equal(applyCors({
      headers: { origin: "http://localhost:3000" },
      socket: { encrypted: false },
    }, localRes, process.env.PUBLIC_WEB_URL), true);
    assert.equal(localHeaders.get("access-control-allow-origin"), "http://localhost:3000");
  } finally {
    restoreEnv();
  }
});

test("proxy headers require a trusted direct peer and preserve the real client from XFF", () => {
  const trustedProxyIps = parseTrustedProxyIps("192.0.2.10, 192.0.2.11");
  const proxyOptions = { enabled: true, trustedProxyIps };

  assert.deepEqual([...trustedProxyIps].sort(), ["192.0.2.10", "192.0.2.11"]);
  assert.equal(normalizeIpAddress("::ffff:192.0.2.10"), "192.0.2.10");
  assert.equal(isTrustedProxyAddress("::ffff:192.0.2.10", trustedProxyIps), true);

  const directRequest = {
    headers: {
      "x-forwarded-for": "198.51.100.1",
      "x-forwarded-proto": "https",
    },
    socket: { remoteAddress: "203.0.113.9" },
  };
  assert.equal(shouldTrustProxyHeaders(directRequest, proxyOptions), false);
  assert.equal(getClientIp(directRequest, proxyOptions), "203.0.113.9");
  assert.equal(getTrustedForwardedProto(directRequest, proxyOptions), "");

  const proxiedRequest = {
    headers: {
      // A client-controlled value is leftmost, then the real client and an
      // upstream proxy are appended by standard reverse proxies.
      "x-forwarded-for": "203.0.113.250, 198.51.100.42, 192.0.2.11",
      "x-forwarded-proto": "https",
    },
    socket: { remoteAddress: "::ffff:192.0.2.10" },
  };
  assert.equal(shouldTrustProxyHeaders(proxiedRequest, proxyOptions), true);
  assert.equal(getClientIp(proxiedRequest, proxyOptions), "198.51.100.42");
  assert.equal(getTrustedForwardedProto(proxiedRequest, proxyOptions), "https");
});
