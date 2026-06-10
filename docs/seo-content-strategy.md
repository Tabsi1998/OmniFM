# OmniFM SEO Content Strategy

This document is the content contract for issue #62. It keeps OmniFM as the
product and IT-Tabelander as the operator/provider.

## Brand And Operator

- `OmniFM` is the product name and should be used for the Discord radio bot,
  dashboard, station catalog, Premium plans, and support material.
- `IT-Tabelander` is the operator and service provider behind OmniFM. Legal,
  privacy, terms, structured data, and footer/provider copy must use
  IT-Tabelander for the business identity.
- Do not present "IT-Tabelander" as a second product and do not present
  "OmniFM" as the legal provider by itself.

## German Intent Map

| Intent | Primary page | Search need | Content angle |
| --- | --- | --- | --- |
| Discord Radio Bot | `/` | Understand what OmniFM is | 24/7 Discord radio with commander/worker setup |
| 24/7 Discord Musik Bot | `/` | Always-on music in Discord voice | Stable worker runtime, reconnect behavior, station catalog |
| Discord Webradio Bot | `/stations` | Browse playable radio streams | Public station catalog and plan availability |
| Radio Bot Deutsch | `/faq` | German-language setup and questions | German FAQ, clear worker requirement, plan basics |
| Discord Radio Preise | `/premium` | Compare Free, Pro, Ultimate | Plan fit, limits, audio quality, dashboard access |
| Discord Radio Dashboard | `/dashboard` | Manage server setup | Server controls, events, permissions, stats, health |
| Custom Stations Discord | `/premium` | Need custom stream URLs | Ultimate positioning and operator use cases |
| Discord Musik Bot mit Worker | `/faq` | Understand multi-bot architecture | Commander receives commands, workers run streams |

## English Intent Map

| Intent | Primary page | Search need | Content angle |
| --- | --- | --- | --- |
| Discord radio bot | `/` | Understand the product | 24/7 Discord radio with dashboard and Premium path |
| 24/7 Discord music bot | `/` | Continuous music in voice channels | Worker reliability and clean reconnect behavior |
| Discord web radio bot | `/stations` | Find playable radio stations | Catalog, plan availability, station search |
| Discord radio stations | `/stations` | Browse stations before invite | Free/Pro/Ultimate catalog summary |
| Discord radio bot pricing | `/premium` | Compare plans | Free, Pro, Ultimate, audio quality, workers, dashboard |
| Discord radio dashboard | `/dashboard` | Operate server settings | Events, role permissions, stats, health, Premium status |
| Custom stations Discord bot | `/premium` | Use custom stream URLs | Ultimate for custom stations and automation |
| Discord music bot workers | `/faq` | Understand architecture | Commander/worker explanation and first-run flow |

## Page Goals

- `/`: Product/category landing page for OmniFM as a 24/7 Discord radio bot.
  It should explain the value proposition, commander/worker start flow,
  reliability, and the upgrade path without making IT-Tabelander look like the
  product name.
- `/stations`: Station catalog landing page. It should answer whether OmniFM
  has enough usable stations, which stations are available by plan, and how a
  visitor can preview or find stations.
- `/premium`: Pricing and plan-fit landing page for Free, Pro, and Ultimate.
  It should make the plan differences understandable before checkout and link
  plan features to worker count, audio quality, dashboard controls, reconnect
  strength, and custom stations.
- `/faq`: Question landing page. It should answer high-intent questions in
  German and English, and its content must stay aligned with FAQPage JSON-LD.
- `/dashboard`: Product app/control page. Public SEO should describe what the
  dashboard manages, while authenticated behavior remains inside the dashboard.
- `/impressum`, `/datenschutz`, `/nutzungsbedingungen`, `/imprint`,
  `/privacy`, `/terms`: Legal and trust pages. These pages should clearly
  identify IT-Tabelander as operator/provider and OmniFM as product/service.

## Internal Link Structure

- Main navigation keeps anchor links for homepage explanation sections
  (`#features`, `#why-omnifm`, `#dashboard-showcase`).
- Main navigation uses page-level routes for SEO landing sections:
  `/stations`, `/premium`, and `/faq`.
- The SPA may render the same React shell for these pages, but the URL,
  canonical metadata, sitemap entries, and structured data must identify the
  route as a real content target.
- Legal links stay localized through canonical route helpers.

## FAQ Structured Data Rules

- FAQPage JSON-LD should be generated from stable, search-friendly questions.
- Questions should cover OmniFM, the commander/worker setup, Free/Pro/Ultimate,
  and the IT-Tabelander operator distinction.
- FAQ answers must not promise features beyond the current product copy.
- If visible FAQ copy changes materially, update `frontend/src/lib/seo.js`
  structured FAQ entries in the same change.

## Acceptance Guardrails

- The sitemap must list `/stations`, `/premium`, and `/faq`.
- Route helpers must resolve `/stations`, `/premium`, `/pricing`, and `/faq`.
- SEO helper tests must cover route-specific titles/canonicals and localized
  FAQPage JSON-LD.
- Server SPA fallback must serve the React entry for the content routes.
