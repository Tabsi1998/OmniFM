import { getCanonicalPagePath, normalizePageId, resolvePageFromUrl } from './pageRouting.js';

const SITE_ORIGIN = 'https://omnifm.xyz';
const DEFAULT_IMAGE = `${SITE_ORIGIN}/img/bot-1.png`;

const PAGE_SEO = {
  home: {
    type: 'website',
    de: {
      title: 'OmniFM | 24/7 Radio für Discord',
      description: 'OmniFM bringt 24/7 Discord-Radio, Worker-Bots, Dashboard-Kontrolle und Premium-Audio auf deinen Server.',
    },
    en: {
      title: 'OmniFM | 24/7 Radio for Discord',
      description: 'OmniFM brings 24/7 Discord radio, worker bots, dashboard control, and Premium audio to your server.',
    },
  },
  dashboard: {
    type: 'website',
    de: {
      title: 'OmniFM Dashboard | Server verwalten',
      description: 'Verwalte OmniFM-Server, Events, Rollenrechte, Statistiken und Premium-Funktionen im Dashboard.',
    },
    en: {
      title: 'OmniFM Dashboard | Manage servers',
      description: 'Manage OmniFM servers, events, role permissions, statistics, and Premium features in the dashboard.',
    },
  },
  imprint: {
    type: 'article',
    de: {
      title: 'OmniFM | Impressum',
      description: 'Pflichtangaben und Anbieterinformationen für den Webauftritt von OmniFM.',
    },
    en: {
      title: 'OmniFM | Imprint',
      description: 'Required provider details and operator information for the OmniFM website.',
    },
  },
  privacy: {
    type: 'article',
    de: {
      title: 'OmniFM | Datenschutzerklärung',
      description: 'Datenschutzhinweise für Webseite, Discord-Bot-Betrieb, Dashboard, Premium, E-Mail und Support.',
    },
    en: {
      title: 'OmniFM | Privacy policy',
      description: 'Privacy notice for the website, Discord bot runtime, dashboard, Premium, email, and support.',
    },
  },
  terms: {
    type: 'article',
    de: {
      title: 'OmniFM | Nutzungsbedingungen',
      description: 'Nutzungsbedingungen für die OmniFM-Webseite, den Discord-Bot, das Dashboard und Premium-Funktionen.',
    },
    en: {
      title: 'OmniFM | Terms of service',
      description: 'Terms for the OmniFM website, Discord bot, dashboard, and optional Premium features.',
    },
  },
};

const FAQ_ENTRIES = [
  {
    question: 'What is OmniFM?',
    answer: 'OmniFM is a Discord radio bot platform for 24/7 streams, worker-based reliability, dashboard control, and Premium features.',
  },
  {
    question: 'Does OmniFM have a free plan?',
    answer: 'Yes. The Free plan starts with the commander and worker setup. Pro and Ultimate add more control, reliability, and audio options.',
  },
  {
    question: 'Who operates OmniFM?',
    answer: 'OmniFM is operated by IT-Tabelander as the product owner and service provider.',
  },
];

function normalizeLocale(locale) {
  return String(locale || 'en').trim().toLowerCase().startsWith('de') ? 'de' : 'en';
}

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

export function getPageSeo(page, locale = 'en') {
  const pageId = normalizePageId(page, 'home');
  const language = normalizeLocale(locale);
  const config = PAGE_SEO[pageId] || PAGE_SEO.home;
  const localized = config[language] || config.en;
  const canonicalPath = getCanonicalPagePath(pageId, language);
  const canonicalUrl = absoluteUrl(canonicalPath);
  return {
    pageId,
    language,
    title: localized.title,
    description: localized.description,
    canonicalPath,
    canonicalUrl,
    image: DEFAULT_IMAGE,
    type: config.type || 'website',
    robots: 'index,follow',
  };
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
        inLanguage: ['de', 'en'],
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': appId,
        name: 'OmniFM',
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Discord',
        url: SITE_ORIGIN,
        description: PAGE_SEO.home.en.description,
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
        mainEntity: FAQ_ENTRIES.map((entry) => ({
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
  const seo = getPageSeo(page, locale);
  document.documentElement.lang = seo.language;
  document.title = seo.title;

  upsertLink('canonical', seo.canonicalUrl);
  upsertLink('manifest', '/manifest.json');
  upsertMeta('meta[name="description"]', { name: 'description', content: seo.description });
  upsertMeta('meta[name="robots"]', { name: 'robots', content: seo.robots });
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'OmniFM' });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: seo.type });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: seo.title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: seo.description });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: seo.canonicalUrl });
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: seo.image });
  upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: seo.language === 'de' ? 'de_DE' : 'en_US' });
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: seo.title });
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: seo.description });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: seo.image });
  upsertJsonLd('omnifm-page', buildStructuredData(seo));
  return seo;
}

export { SITE_ORIGIN };
