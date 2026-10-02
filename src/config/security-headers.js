// ============================================================
// OmniFM: security headers of everything served over HTTP
// ============================================================
// One definition for the Node API (src/lib/api-helpers.js) and the static
// website, whose serve configuration (frontend/serve.json) is written from
// here by scripts/write-serve-config.mjs. A test keeps the two in step.

export const CSP_DIRECTIVES = Object.freeze({
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
  ],
  "script-src-elem": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
  ],
  // The fonts come from this site (#467), not from Google Fonts.
  "style-src": ["'self'", "'unsafe-inline'"],
  "style-src-elem": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'", "data:"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "data:", "blob:", "https:"],
  "connect-src": [
    "'self'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
  ],
  "frame-src": [
    "'self'",
    "https://discord.com",
  ],
  "worker-src": ["'self'", "blob:"],
  "child-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "form-action": ["'self'", "https://discord.com"],
});

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "camera=()",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=(self)",
  "publickey-credentials-get=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

export const HSTS_BASE = "max-age=31536000; includeSubDomains";

// The one page another site may frame: the Discord Activity (#308), which
// Discord shows inside its own client. Everything else keeps 'none'.
export const ACTIVITY_FRAME_ANCESTORS = Object.freeze([
  "https://discord.com",
  "https://*.discord.com",
  "https://*.discordsays.com",
]);

/** The policy; overrides replace single directives (only the Activity does that). */
export function buildContentSecurityPolicy(overrides = {}) {
  return Object.entries({ ...CSP_DIRECTIVES, ...overrides })
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

export function buildPermissionsPolicy() {
  return PERMISSIONS_POLICY;
}

/** The headers the static website sends with every file. */
export function buildWebsiteSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": buildContentSecurityPolicy(),
    "Permissions-Policy": buildPermissionsPolicy(),
    "X-Permitted-Cross-Domain-Policies": "none",
    // The website is only reachable over HTTPS; browsers ignore the header
    // on plain HTTP, so local runs are not affected.
    "Strict-Transport-Security": HSTS_BASE,
  };
}
