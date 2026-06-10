# OmniFM Google Search Console

This document is the owner workflow for Google Search Console. It is intentionally
token-free: do not commit a fake Google verification file or placeholder meta
tag. Use the exact token Google gives for the real property.

## Responsibility

- Owner: IT-Tabelander.
- Product/site: OmniFM.
- Canonical production property: `https://omnifm.xyz/`.
- Sitemap URL: `https://omnifm.xyz/sitemap.xml`.
- Robots URL: `https://omnifm.xyz/robots.txt`.

## Property Setup

Preferred setup:

1. Open Google Search Console.
2. Add a Domain property for `omnifm.xyz` if DNS access is available.
3. Add the DNS TXT verification record exactly as Google provides it.
4. Keep the TXT record active permanently.
5. Also add a URL-prefix property for `https://omnifm.xyz/` when Google asks for
   URL-level reporting or when the Domain property is not practical.

Fallback setup for URL-prefix verification:

1. Prefer DNS TXT verification when available.
2. If HTML file verification is used, download the exact
   `google-site-verification` HTML file from Google.
3. Place the file in `frontend/public/` without renaming it.
4. Build and deploy the frontend.
5. Confirm the file is reachable at `https://omnifm.xyz/<google-file>.html`.
6. Complete verification in Google Search Console.
7. Leave the file deployed as long as Search Console needs it.

Do not create a generic `google-site-verification.html` placeholder. Google
verification only works with the exact tokenized filename or exact meta tag.

## Sitemap Submission

After the property is verified:

1. Open `Indexing -> Sitemaps`.
2. Submit `https://omnifm.xyz/sitemap.xml`.
3. Confirm Search Console accepts the sitemap without fetch or parse errors.
4. Re-submit after large route changes, legal URL changes, or SEO landing page
   changes.

The repository currently ships:

- `frontend/public/robots.txt`
- `frontend/public/sitemap.xml`
- route-specific SEO metadata in `frontend/src/lib/seo.js`
- canonical route helpers in `frontend/src/lib/pageRouting.js`

## Deploy Checklist

Run this after production deploys that touch website, routing, metadata, robots,
sitemap, or legal pages:

1. Open `https://omnifm.xyz/robots.txt` and confirm it points to
   `https://omnifm.xyz/sitemap.xml`.
2. Open `https://omnifm.xyz/sitemap.xml` and confirm it contains the expected
   canonical URLs, especially `/`, `/stations`, `/premium`, `/faq`,
   `/dashboard`, `/impressum`, `/datenschutz`, and `/nutzungsbedingungen`.
3. In Search Console, check `Indexing -> Pages` for newly introduced errors.
4. In Search Console, inspect the key URLs:
   - `https://omnifm.xyz/`
   - `https://omnifm.xyz/stations`
   - `https://omnifm.xyz/premium`
   - `https://omnifm.xyz/faq`
   - `https://omnifm.xyz/impressum`
   - `https://omnifm.xyz/datenschutz`
   - `https://omnifm.xyz/nutzungsbedingungen`
5. Check `Experience -> Core Web Vitals` for mobile and desktop warnings.
6. Check mobile usability through URL inspection for the key landing pages.
7. Review search performance queries after indexing settles.

## Local Readiness Check

Before release, run:

```bash
npm run seo:search-console
```

This repository check validates that the documented Search Console process,
robots file, sitemap, and documentation links are present. It cannot verify the
external Google account, DNS record, or submitted sitemap state.

## Official References

- Google Search Console: Add a website property:
  `https://support.google.com/webmasters/answer/34592`
- Google Search Console: Verify site ownership:
  `https://support.google.com/webmasters/answer/9008080`
- Google Search Console: Sitemaps report:
  `https://support.google.com/webmasters/answer/7451001`
- Google Search Console: URL Inspection tool:
  `https://support.google.com/webmasters/answer/9012289`
- Google Search Console: Core Web Vitals report:
  `https://support.google.com/webmasters/answer/9205520`
