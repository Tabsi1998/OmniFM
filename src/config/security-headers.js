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
    "https://js.stripe.com",
  ],
  "script-src-elem": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://js.stripe.com",
  ],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "style-src-elem": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "data:", "blob:", "https:"],
  "connect-src": [
    "'self'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://api.stripe.com",
  ],
  "frame-src": [
    "'self'",
    "https://checkout.stripe.com",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://discord.com",
  ],
  "worker-src": ["'self'", "blob:"],
  "child-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "form-action": ["'self'", "https://checkout.stripe.com", "https://discord.com"],
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

export function buildContentSecurityPolicy() {
  return Object.entries(CSP_DIRECTIVES)
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
