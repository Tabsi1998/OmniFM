# Security Headers

OmniFM sets browser security headers centrally in `src/lib/api-helpers.js`.
They are applied to JSON API responses, static frontend assets, SPA HTML, admin
HTML, and common plain-text error responses.

## Active Headers

- `Content-Security-Policy`
- `Permissions-Policy`
- `Strict-Transport-Security` for HTTPS production origins
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `X-Permitted-Cross-Domain-Policies: none`

The CSP keeps `default-src 'self'`, blocks plugin/object content with
`object-src 'none'`, blocks embedding with `frame-ancestors 'none'`, and allows
only the external origins currently needed by the public site and dashboard:

- Google Tag Manager and Google Analytics for consent-gated analytics
- Google Fonts for the current public frontend
- Stripe checkout/frame origins for Premium checkout compatibility
- HTTPS images/media so Discord emoji/CDN assets and station media references
  can render safely

Inline scripts and styles remain allowed because the current React/public HTML
uses inline Consent Mode, JSON-LD, admin HTML, and inline style attributes. A
future CSP nonce/hash cleanup can tighten this further after the remaining
legacy/static frontend paths are removed.

## HSTS Behavior

HSTS is enabled automatically when `PUBLIC_WEB_URL` is an HTTPS non-localhost
origin or `WEB_DOMAIN` points at a non-localhost domain. It is intentionally not
emitted for local HTTP development.

Overrides:

| Variable | Purpose |
| --- | --- |
| `SECURITY_HSTS_ENABLED=1` | Force HSTS on |
| `SECURITY_HSTS_ENABLED=0` | Force HSTS off |
| `HSTS_ENABLED` | Legacy alias for the same override |
| `SECURITY_HSTS_PRELOAD=1` | Add the `preload` directive |

Only enable `SECURITY_HSTS_PRELOAD=1` after the domain and subdomains are ready
for long-term HTTPS-only operation.

## Verification

Local checks:

```bash
node --test test/security-headers.test.js test/legal-pages-routing.test.js
```

Production/live checks:

```bash
node scripts/phase6-live-check.mjs --base-url https://omnifm.xyz --admin-token "$API_ADMIN_TOKEN" --skip-logs
```

The live check verifies the important headers on the home page, a public API
response, and a static asset route.
