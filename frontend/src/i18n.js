import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { NOT_FOUND_PAGE, buildPageHref, resolvePageFromUrl } from './lib/pageRouting.js';
import { applySeoMetadata } from './lib/seo.js';
import {
  LANGUAGE_CODES,
  WEBSITE_LANGUAGES,
  copyFor,
  isLanguageLoaded,
  loadLanguage,
  normalizeLanguage,
  translatorFor,
  uiTableFor,
} from './i18n/languages.js';

const STORAGE_KEY = 'omnifm.web.locale';
const DEFAULT_LOCALE = 'en';
// Nine languages (#306): German and English in full, the others from
// ./i18n/<code>-*.js and ./i18n/ui/<code>.js, English where one is missing.
const SUPPORTED_LOCALES = LANGUAGE_CODES;

const LOCALE_META = Object.fromEntries(WEBSITE_LANGUAGES.map((language) => [language.code, {
  label: language.code.toUpperCase(),
  name: language.name,
  intl: language.intl,
}]));

// The two languages written in full, for the completeness test (#294); the
// others are checked against English (#306).
export const LOCALE_MESSAGES = { de: copyFor('de'), en: copyFor('en') };

const I18nContext = createContext(null);

function normalizeLocale(rawLocale) {
  return normalizeLanguage(rawLocale, DEFAULT_LOCALE);
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
    // An unknown address stays as it is (#487); only the language changes.
    if (page === NOT_FOUND_PAGE) {
      url.searchParams.set('lang', locale);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    const params = new URLSearchParams(url.search);
    const nextHref = buildPageHref(locale, page, params);
    window.history.replaceState({}, '', `${nextHref}${url.hash}`);
  } catch {
    // ignore URL update failures
  }
}

function resolveInitialLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  // Language follows the browser automatically, no manual switch. A ?lang=
  // in the link wins: the site writes it into its own links, and search
  // engines find each language that way (#306).
  try {
    const requested = new URL(window.location.href).searchParams.get('lang');
    if (requested && SUPPORTED_LOCALES.includes(normalizeLanguage(requested, ''))) return normalizeLanguage(requested);
  } catch {
    // no usable URL: the browser decides
  }
  const nav = (window.navigator?.languages && window.navigator.languages[0])
    || window.navigator?.language
    || DEFAULT_LOCALE;
  return normalizeLocale(nav);
}

/**
 * Loads the visitor's language before the first render (index.js), so a
 * French page never flashes up in English first. Never fails: without the
 * download the page shows English.
 */
export function preloadLanguage() {
  if (typeof window === 'undefined') return Promise.resolve();
  return loadLanguage(resolveInitialLocale()).catch(() => null);
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(resolveInitialLocale);
  const ready = isLanguageLoaded(locale);
  const [, setLoadedCount] = useState(0);
  const copy = copyFor(locale);
  const uiTable = uiTableFor(locale);
  const intlLocale = LOCALE_META[locale]?.intl || LOCALE_META[DEFAULT_LOCALE].intl;

  const setLocale = useCallback((nextLocale) => {
    const normalized = normalizeLocale(nextLocale);
    writeStoredLocale(normalized);
    syncLocaleToUrl(normalized);
    setLocaleState(normalized);
  }, []);

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

  // A language that is not there yet comes now; until then the page is English.
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    loadLanguage(locale)
      .then(() => { if (alive) setLoadedCount((count) => count + 1); })
      .catch(() => {});
    return () => { alive = false; };
  }, [locale, ready]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    applySeoMetadata({ locale, url: window.location.href });
  }, [copy, locale]);

  // The dashboard's t('Deutsch', 'English', params) in the current language.
  const t = useMemo(() => translatorFor(locale, uiTable), [locale, uiTable]);

  const contextValue = useMemo(() => ({
    locale,
    localeMeta: LOCALE_META[locale] || LOCALE_META[DEFAULT_LOCALE],
    languages: WEBSITE_LANGUAGES,
    copy,
    t,
    setLocale,
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
    t,
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
