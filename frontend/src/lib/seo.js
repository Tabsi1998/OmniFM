import { NOT_FOUND_PAGE, getCanonicalPagePath, normalizePageId, resolvePageFromUrl } from './pageRouting.js';
import { LANGUAGE_CODES, WEBSITE_LANGUAGES, copyFor, normalizeLanguage } from '../i18n/languages.js';

const SITE_ORIGIN = 'https://omnifm.xyz';
// The same picture as the static og:image in index.html, so a link preview
// looks the same whether or not the crawler runs JavaScript.
const DEFAULT_IMAGE = `${SITE_ORIGIN}/brand/omnifm-banner.png`;

// What kind of page each one is; the texts live in the language files
// (i18n/<code>-pages.js, key seo), one place per language (#306).
const PAGE_TYPES = {
  home: 'website',
  dashboard: 'website',
  stations: 'website',
  premium: 'website',
  faq: 'article',
  start: 'article',
  imprint: 'article',
  privacy: 'article',
  terms: 'article',
  charts: 'website',
  status: 'website',
};

function absoluteUrl(pathname = '/') {
  const path = String(pathname || '/').startsWith('/') ? pathname : `/${pathname}`;
  return `${SITE_ORIGIN}${path}`;
}

function upsertMeta(selector, attrs) {
  if (typeof document === 'undefined') return;
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    document.head.appendChild(tag);
  }
  Object.entries(attrs).forEach(([key, value]) => {
    tag.setAttribute(key, value);
  });
}

function upsertLink(rel, href) {
  if (typeof document === 'undefined') return;
  let tag = document.head.querySelector(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

function upsertJsonLd(id, payload) {
  if (typeof document === 'undefined') return;
  let tag = document.head.querySelector(`script[type="application/ld+json"][data-seo-id="${id}"]`);
  if (!tag) {
    tag = document.createElement('script');
    tag.setAttribute('type', 'application/ld+json');
    tag.setAttribute('data-seo-id', id);
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify(payload);
}

/** The address of a page in a language: German and English keep theirs, every other language adds ?lang=. */
function canonicalUrlFor(pageId, language) {
  const path = getCanonicalPagePath(pageId, language);
  return absoluteUrl(language === 'de' || language === 'en' ? path : `${path}?lang=${language}`);
}

export function getPageSeo(page, locale = 'en') {
  const pageId = normalizePageId(page, 'home');
  const language = normalizeLanguage(locale);
  const texts = copyFor(language).seo.pages;
  const localized = texts[pageId] || texts.home;
  const canonicalPath = getCanonicalPagePath(pageId, language);
  const canonicalUrl = canonicalUrlFor(pageId, language);
  return {
    pageId,
    language,
    title: localized.title,
    description: localized.description,
    canonicalPath,
    canonicalUrl,
    image: DEFAULT_IMAGE,
    type: PAGE_TYPES[pageId] || 'website',
    robots: 'index,follow',
  };
}

/** hreflang -> address of the same page in every language, plus x-default (English). */
export function getLanguageAlternates(page) {
  const pageId = normalizePageId(page, 'home');
  return [
    ...WEBSITE_LANGUAGES.map((entry) => ({ hreflang: entry.hreflang, href: canonicalUrlFor(pageId, entry.code) })),
    { hreflang: 'x-default', href: canonicalUrlFor(pageId, 'en') },
  ];
}

function replaceAlternates(alternates) {
  if (typeof document === 'undefined') return;
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((tag) => tag.remove());
  for (const { hreflang, href } of alternates) {
    const tag = document.createElement('link');
    tag.setAttribute('rel', 'alternate');
    tag.setAttribute('hreflang', hreflang);
    tag.setAttribute('href', href);
    document.head.appendChild(tag);
  }
}

export function getFaqEntries(locale = 'en') {
  return copyFor(normalizeLanguage(locale)).seo.faq;
}

export function buildStructuredData(seo) {
  const websiteId = `${SITE_ORIGIN}/#website`;
  const organizationId = `${SITE_ORIGIN}/#organization`;
  const appId = `${SITE_ORIGIN}/#software`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: 'IT-Tabelander',
        url: SITE_ORIGIN,
        brand: {
          '@type': 'Brand',
          name: 'OmniFM',
        },
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: 'OmniFM',
        url: SITE_ORIGIN,
        inLanguage: [...LANGUAGE_CODES],
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': appId,
        name: 'OmniFM',
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Discord',
        url: SITE_ORIGIN,
        description: copyFor('en').seo.pages.home.description,
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'EUR',
          lowPrice: '0',
          availability: 'https://schema.org/InStock',
        },
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_ORIGIN}/#faq`,
        mainEntity: getFaqEntries(seo.language).map((entry) => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: entry.answer,
          },
        })),
      },
      {
        '@type': 'WebPage',
        '@id': `${seo.canonicalUrl}#webpage`,
        url: seo.canonicalUrl,
        name: seo.title,
        description: seo.description,
        isPartOf: { '@id': websiteId },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: seo.image,
        },
        inLanguage: seo.language,
      },
    ],
  };
}

export function applySeoMetadata({ locale = 'en', url = null } = {}) {
  if (typeof document === 'undefined') return null;
  const page = resolvePageFromUrl(url || window.location.href);
  // An address the site does not have: no search engine shall keep it (#487).
  const seo = page === NOT_FOUND_PAGE ? { ...getPageSeo('home', locale), robots: 'noindex,follow' } : getPageSeo(page, locale);
  document.documentElement.lang = seo.language;
  document.title = seo.title;

  upsertLink('canonical', seo.canonicalUrl);
  // Every language of this page, so search engines find each one (#306).
  replaceAlternates(getLanguageAlternates(page));
  upsertLink('manifest', '/manifest.json');
  upsertMeta('meta[name="description"]', { name: 'description', content: seo.description });
  upsertMeta('meta[name="robots"]', { name: 'robots', content: seo.robots });
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'OmniFM' });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: seo.type });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: seo.title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: seo.description });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: seo.canonicalUrl });
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: seo.image });
  upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: WEBSITE_LANGUAGES.find((entry) => entry.code === seo.language).og });
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: seo.title });
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: seo.description });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: seo.image });
  upsertJsonLd('omnifm-page', buildStructuredData(seo));
  return seo;
}

export { SITE_ORIGIN };
