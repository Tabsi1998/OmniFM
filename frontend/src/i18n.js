import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { buildPageHref, resolvePageFromUrl } from './lib/pageRouting.js';
import { applySeoMetadata } from './lib/seo.js';
import deSite from './i18n/de-site.js';
import dePages from './i18n/de-pages.js';
import enSite from './i18n/en-site.js';
import enPages from './i18n/en-pages.js';

const STORAGE_KEY = 'omnifm.web.locale';
const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['de', 'en'];

const LOCALE_META = {
  de: {
    label: 'DE',
    switchLabel: 'EN',
    switchTitle: 'Switch to English',
    intl: 'de-DE',
  },
  en: {
    label: 'EN',
    switchLabel: 'DE',
    switchTitle: 'Auf Deutsch umschalten',
    intl: 'en-US',
  },
};

// Exported for the completeness test (#294): every text in German and English.
// The website texts per language, from ./i18n/ (#296).
export const LOCALE_MESSAGES = {
  de: { ...deSite, ...dePages },
  en: { ...enSite, ...enPages },
};

const I18nContext = createContext(null);

function normalizeLocale(rawLocale) {
  const value = String(rawLocale || '').trim().toLowerCase();
  if (!value) return DEFAULT_LOCALE;
  if (value.startsWith('de')) return 'de';
  if (value.startsWith('en')) return 'en';
  return SUPPORTED_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

function writeStoredLocale(locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore storage failures
  }
}

function syncLocaleToUrl(locale) {
  try {
    const url = new URL(window.location.href);
    const page = resolvePageFromUrl(url);
    const params = new URLSearchParams(url.search);
    const nextHref = buildPageHref(locale, page, params);
    window.history.replaceState({}, '', `${nextHref}${url.hash}`);
  } catch {
    // ignore URL update failures
  }
}

function resolveInitialLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  // Language follows the browser automatically — no manual switch.
  const nav = (window.navigator?.languages && window.navigator.languages[0])
    || window.navigator?.language
    || DEFAULT_LOCALE;
  return normalizeLocale(nav);
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(resolveInitialLocale);
  const copy = LOCALE_MESSAGES[locale] || LOCALE_MESSAGES[DEFAULT_LOCALE];
  const intlLocale = LOCALE_META[locale]?.intl || LOCALE_META[DEFAULT_LOCALE].intl;

  const setLocale = useCallback((nextLocale) => {
    const normalized = normalizeLocale(nextLocale);
    writeStoredLocale(normalized);
    syncLocaleToUrl(normalized);
    setLocaleState(normalized);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'de' ? 'en' : 'de');
  }, [locale, setLocale]);

  const formatNumber = useCallback((value) => {
    const amount = Number(value) || 0;
    return new Intl.NumberFormat(intlLocale).format(amount);
  }, [intlLocale]);

  const formatDecimal = useCallback((value, minimumFractionDigits = 2, maximumFractionDigits = 2) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '-';
    return new Intl.NumberFormat(intlLocale, {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(amount);
  }, [intlLocale]);

  const formatDate = useCallback((value, options) => {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat(intlLocale, options).format(date);
  }, [intlLocale]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    applySeoMetadata({ locale, url: window.location.href });
  }, [copy, locale]);

  const contextValue = useMemo(() => ({
    locale,
    localeMeta: LOCALE_META[locale] || LOCALE_META[DEFAULT_LOCALE],
    copy,
    setLocale,
    toggleLocale,
    formatNumber,
    formatDecimal,
    formatDate,
  }), [
    copy,
    formatDate,
    formatDecimal,
    formatNumber,
    locale,
    setLocale,
    toggleLocale,
  ]);

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}
