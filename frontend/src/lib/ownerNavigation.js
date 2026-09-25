// The owner console's menu (#356): six areas instead of fifteen tabs, every
// topic on exactly one page. A page id is what OwnerAdmin renders; "cfg-*"
// pages show one part of the system settings (OwnerConfig part=...).
// Keywords feed the search over all settings.

export const OWNER_AREAS = Object.freeze([
  {
    id: 'cockpit',
    label: 'Cockpit',
    pages: [{ id: 'cockpit', label: 'Cockpit', keywords: ['status', 'live', 'prüfen', 'fehler', 'version', 'update'] }],
  },
  {
    id: 'server',
    label: 'Server & Lizenzen',
    pages: [
      { id: 'overview', label: 'Übersicht', keywords: ['umsatz', 'mrr', 'arr', 'server', 'guilds', 'hörer'] },
      { id: 'licenses', label: 'Lizenzen', keywords: ['lizenz', 'seats', 'testphase', 'trial', 'kunde', 'e-mail', 'verlängern'] },
    ],
  },
  {
    id: 'stations',
    label: 'Sender',
    pages: [
      { id: 'stations', label: 'Katalog', keywords: ['sender', 'stream', 'station', 'genre', 'logo', 'farbe', 'katalog'] },
      { id: 'cfg-streams', label: 'Prüfung & Recovery', keywords: ['sender-überwachung', 'health', 'recovery', 'reconnect', 'failover', 'stabilität'] },
    ],
  },
  {
    id: 'bots',
    label: 'Bots & Discord',
    pages: [
      { id: 'monitoring', label: 'Live-Status', keywords: ['worker', 'nodes', 'cpu', 'ram', 'ping', 'logs', 'vorfälle'] },
      { id: 'discord', label: 'Bots & Tokens', keywords: ['commander', 'worker', 'token', 'client id', 'bot-logs'] },
      { id: 'cfg-directories', label: 'Bot-Listen', keywords: ['top.gg', 'discord bot list', 'bots.gg', 'votes', 'webhook secret'] },
    ],
  },
  {
    id: 'settings',
    label: 'Einstellungen',
    pages: [
      { id: 'cfg-login', label: 'Discord-Login', keywords: ['oauth', 'client secret', 'redirect', 'scopes', 'anmeldung', 'dashboard login'] },
      { id: 'cfg-email', label: 'E-Mail', keywords: ['smtp', 'mail', 'absender', 'passwort', 'tls'] },
      { id: 'cfg-recognition', label: 'Song-Erkennung & Verlauf', keywords: ['acoustid', 'erkennung', 'song-verlauf', 'history'] },
      { id: 'cfg-alerts', label: 'Alarme', keywords: ['betreiber', 'alarm', 'operator', 'webhook', 'erwähnung'] },
      { id: 'payments', label: 'Zahlungen', keywords: ['stripe', 'paypal', 'zahlung', 'webhook', 'checkout'] },
      { id: 'plans', label: 'Pläne & Preise', keywords: ['preis', 'plan', 'pro', 'ultimate', 'features', 'laufzeit'] },
      { id: 'company', label: 'Firma & Recht', keywords: ['impressum', 'datenschutz', 'firma', 'uid', 'hosting', 'recht'] },
      { id: 'marketing', label: 'Listings & Partner', keywords: ['profilseite', 'listing', 'sponsor', 'partner', 'marketing'] },
      { id: 'brand', label: 'Brand Kit', keywords: ['logo', 'farben', 'marke', 'brand'] },
    ],
  },
  {
    id: 'logs',
    label: 'Protokolle',
    pages: [
      { id: 'activity', label: 'Aktivität', keywords: ['aktivität', 'ereignisse'] },
      { id: 'audit', label: 'Audit', keywords: ['audit', 'wer', 'änderung'] },
      { id: 'archive', label: 'Archiv', keywords: ['archiv', 'wiederherstellen', 'gelöscht'] },
    ],
  },
]);

export const OWNER_PAGES = Object.freeze(OWNER_AREAS.flatMap((area) => area.pages.map((page) => ({ ...page, area: area.id, areaLabel: area.label }))));

export function areaOfPage(pageId) {
  return OWNER_PAGES.find((page) => page.id === pageId)?.area || 'cockpit';
}

export function pagesOfArea(areaId) {
  return OWNER_AREAS.find((area) => area.id === areaId)?.pages || [];
}

/** Settings pages whose name or keywords contain the query, e.g. "smtp" → E-Mail. */
export function searchOwnerPages(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return [];
  return OWNER_PAGES.filter((page) => [page.label, page.areaLabel, ...(page.keywords || [])].some((text) => text.toLowerCase().includes(needle)));
}

/** The system settings part a "cfg-*" page shows, or null. */
export function systemPartOf(pageId) {
  return String(pageId || '').startsWith('cfg-') ? pageId.slice(4) : null;
}
