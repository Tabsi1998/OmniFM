// OmniFM: the languages of the website and the dashboard (#306).
// German and English are written in full (de-*.js, en-*.js) and always part
// of the page. Every other language has the same files plus ui/<code>.js and
// comes as its own download, only for visitors who read it; what a language
// leaves out shows in English. The dashboard writes its texts as
// t('Deutsch', 'English', params); the other languages look the English text
// up in ui/<code>.js.
import deSite from './de-site.js';
import dePages from './de-pages.js';
import enSite from './en-site.js';
import enPages from './en-pages.js';

/**
 * The languages in the order a list shows them; `intl` formats numbers and
 * dates, `og` and `hreflang` name the language for link previews and search engines.
 */
export const WEBSITE_LANGUAGES = Object.freeze([
  { code: 'de', name: 'Deutsch', intl: 'de-DE', og: 'de_DE', hreflang: 'de' },
  { code: 'en', name: 'English', intl: 'en-US', og: 'en_US', hreflang: 'en' },
  { code: 'fr', name: 'Français', intl: 'fr-FR', og: 'fr_FR', hreflang: 'fr' },
  { code: 'es', name: 'Español', intl: 'es-ES', og: 'es_ES', hreflang: 'es' },
  { code: 'it', name: 'Italiano', intl: 'it-IT', og: 'it_IT', hreflang: 'it' },
  { code: 'pl', name: 'Polski', intl: 'pl-PL', og: 'pl_PL', hreflang: 'pl' },
  { code: 'tr', name: 'Türkçe', intl: 'tr-TR', og: 'tr_TR', hreflang: 'tr' },
  { code: 'pt', name: 'Português (Brasil)', intl: 'pt-BR', og: 'pt_BR', hreflang: 'pt-BR' },
  { code: 'nl', name: 'Nederlands', intl: 'nl-NL', og: 'nl_NL', hreflang: 'nl' },
]);

export const LANGUAGE_CODES = Object.freeze(WEBSITE_LANGUAGES.map((language) => language.code));

/** "fr-CA" -> "fr", "pt-PT" -> "pt"; anything else -> the fallback. */
export function normalizeLanguage(raw, fallback = 'en') {
  const value = String(raw || '').trim().toLowerCase().slice(0, 2);
  return LANGUAGE_CODES.includes(value) ? value : fallback;
}

/** The locale Intl formats numbers and dates with, e.g. "fr-FR". */
export function intlLocaleFor(code) {
  const language = normalizeLanguage(code);
  return WEBSITE_LANGUAGES.find((entry) => entry.code === language).intl;
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The English texts with a language's own on top: whatever is missing stays English. */
export function mergeCopy(base, own) {
  if (own === undefined || own === null) return base;
  if (Array.isArray(base)) {
    if (!Array.isArray(own)) return base;
    return base.map((entry, index) => mergeCopy(entry, own[index]));
  }
  if (isPlainObject(base)) {
    if (!isPlainObject(own)) return base;
    return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, mergeCopy(value, own[key])]));
  }
  return typeof own === typeof base ? own : base;
}

const german = { ...deSite, ...dePages };
const english = { ...enSite, ...enPages };

// Each language as its own download: the site texts, the pages and the dashboard.
const LOADERS = Object.freeze({
  fr: () => Promise.all([import('./fr-site.js'), import('./fr-pages.js'), import('./ui/fr.js')]),
  es: () => Promise.all([import('./es-site.js'), import('./es-pages.js'), import('./ui/es.js')]),
  it: () => Promise.all([import('./it-site.js'), import('./it-pages.js'), import('./ui/it.js')]),
  pl: () => Promise.all([import('./pl-site.js'), import('./pl-pages.js'), import('./ui/pl.js')]),
  tr: () => Promise.all([import('./tr-site.js'), import('./tr-pages.js'), import('./ui/tr.js')]),
  pt: () => Promise.all([import('./pt-site.js'), import('./pt-pages.js'), import('./ui/pt.js')]),
  nl: () => Promise.all([import('./nl-site.js'), import('./nl-pages.js'), import('./ui/nl.js')]),
});

/** code -> { copy, own, ui }: copy is complete (English where one is missing), own as written. */
const loaded = new Map([
  ['de', { copy: german, own: german, ui: null }],
  ['en', { copy: english, own: english, ui: null }],
]);
const pending = new Map();

export function isLanguageLoaded(code) {
  return loaded.has(normalizeLanguage(code));
}

/** Loads a language's files once; German and English are there already. */
export function loadLanguage(code) {
  const language = normalizeLanguage(code);
  if (loaded.has(language)) return Promise.resolve(loaded.get(language));
  if (!pending.has(language)) {
    const request = LOADERS[language]().then(([site, pages, ui]) => {
      const own = { ...site.default, ...pages.default };
      const pack = { copy: mergeCopy(english, own), own, ui: ui.default };
      loaded.set(language, pack);
      return pack;
    });
    // A failed download may be tried again later.
    request.catch(() => pending.delete(language));
    pending.set(language, request);
  }
  return pending.get(language);
}

/** The website texts of a language, complete; English until its files are there. */
export function copyFor(code) {
  return (loaded.get(normalizeLanguage(code)) || loaded.get('en')).copy;
}

/** The texts a language's files hold, before the English fallback (for the tests). */
export function ownCopyFor(code) {
  return loaded.get(normalizeLanguage(code))?.own || null;
}

/** The dashboard's table of a language, keyed by the English text (for the tests). */
export function uiTableFor(code) {
  return loaded.get(normalizeLanguage(code))?.ui || null;
}

function fill(text, params) {
  if (!params) return text;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match));
}

/**
 * The translator of the dashboard: t('Deutsch', 'English', { name }) gives
 * the text in the language, with {name} filled in. `table` defaults to the
 * language's loaded table.
 */
export function translatorFor(locale, table = uiTableFor(locale)) {
  const code = normalizeLanguage(locale);
  return (germanText, englishText, params) => {
    const text = code === 'de' ? germanText : (table?.[englishText] ?? englishText);
    return fill(text, params);
  };
}
