export const GA_MEASUREMENT_ID = 'G-J5X0ZZ5E3Z';
export const GOOGLE_TAG_SCRIPT_ID = 'omnifm-google-tag';
export const CONSENT_STORAGE_KEY = 'omnifm.cookieConsent.v1';

const ANALYTICS_COOKIE_NAMES = ['_ga', `_ga_${GA_MEASUREMENT_ID.replace(/^G-/, '')}`];

function getSafeWindow() {
  return typeof window === 'undefined' ? null : window;
}

function getSafeDocument() {
  return typeof document === 'undefined' ? null : document;
}

export function normalizeConsent(rawConsent) {
  const source = rawConsent && typeof rawConsent === 'object' ? rawConsent : {};
  return {
    necessary: true,
    analytics: source.analytics === true,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
  };
}

export function readStoredConsent(storage = getSafeWindow()?.localStorage) {
  if (!storage) return null;
  try {
    const rawValue = storage.getItem(CONSENT_STORAGE_KEY);
    if (!rawValue) return null;
    return normalizeConsent(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function writeStoredConsent(consent, storage = getSafeWindow()?.localStorage) {
  const normalized = normalizeConsent({
    ...consent,
    updatedAt: new Date().toISOString(),
  });
  if (!storage) return normalized;
  storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function createGtag(win) {
  win.dataLayer = win.dataLayer || [];
  win.gtag = win.gtag || function gtag() {
    win.dataLayer.push(arguments);
  };
  return win.gtag;
}

export function setGoogleConsentState(granted) {
  const win = getSafeWindow();
  if (!win) return;
  const gtag = createGtag(win);
  gtag('consent', 'update', {
    analytics_storage: granted ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
}

function removeAnalyticsCookies() {
  const doc = getSafeDocument();
  if (!doc) return;
  const hostname = String(getSafeWindow()?.location?.hostname || '').trim();
  const domains = ['', hostname, hostname ? `.${hostname}` : ''].filter(Boolean);
  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
  for (const cookieName of ANALYTICS_COOKIE_NAMES) {
    doc.cookie = `${cookieName}=; Path=/; Expires=${expires}; SameSite=Lax`;
    for (const domain of domains) {
      doc.cookie = `${cookieName}=; Path=/; Domain=${domain}; Expires=${expires}; SameSite=Lax`;
    }
  }
}

export function loadGoogleAnalytics() {
  const win = getSafeWindow();
  const doc = getSafeDocument();
  if (!win || !doc) return false;

  win[`ga-disable-${GA_MEASUREMENT_ID}`] = false;
  const gtag = createGtag(win);
  gtag('js', new Date());
  setGoogleConsentState(true);

  if (!doc.getElementById(GOOGLE_TAG_SCRIPT_ID)) {
    const script = doc.createElement('script');
    script.id = GOOGLE_TAG_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    doc.head.appendChild(script);
  }

  gtag('config', GA_MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: true,
  });
  return true;
}

export function disableGoogleAnalytics() {
  const win = getSafeWindow();
  const doc = getSafeDocument();
  if (!win || !doc) return;
  win[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
  setGoogleConsentState(false);
  const script = doc.getElementById(GOOGLE_TAG_SCRIPT_ID);
  if (script) script.remove();
  removeAnalyticsCookies();
}

export function applyConsent(consent) {
  const normalized = normalizeConsent(consent);
  if (normalized.analytics) {
    loadGoogleAnalytics();
  } else {
    disableGoogleAnalytics();
  }
  return normalized;
}
