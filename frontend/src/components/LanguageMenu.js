// OmniFM: the visitor picks the website's language (#497). Nine languages,
// each in its own name; the choice counts at once and is remembered
// (i18n.js). Every entry is a real address with ?lang=, so it also works
// without JavaScript, in a new tab and for search engines.
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { hrefForLocale, useI18n } from '../i18n.js';

// A plain click switches in place; a click for a new tab or window opens the address.
function pick(event, code, setLocale, after) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  setLocale(code);
  if (after) after();
}

/** The header's button with the list of languages. */
export function LanguageMenu() {
  const { locale, languages, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const listId = useId();
  const current = languages.find((language) => language.code === locale) || languages[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button
        ref={button}
        type="button"
        data-testid="language-menu-button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('Sprache: {language}', 'Language: {language}', { language: current.name })}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 10px', borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.12)', background: open ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
          color: '#E4E4E7', fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
        }}
      >
        <Globe size={16} aria-hidden="true" />
        {current.code.toUpperCase()}
      </button>
      {open && (
        <ul
          id={listId}
          data-testid="language-menu-list"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, minWidth: 210, margin: 0, padding: 6, listStyle: 'none',
            background: '#0b0b0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
          }}
        >
          {languages.map((language) => {
            const active = language.code === locale;
            return (
              <li key={language.code}>
                <a
                  href={hrefForLocale(language.code)}
                  hrefLang={language.hreflang}
                  lang={language.hreflang}
                  aria-current={active ? 'true' : undefined}
                  data-testid={`language-option-${language.code}`}
                  onClick={(event) => pick(event, language.code, setLocale, close)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderRadius: 8,
                    color: active ? '#fff' : '#D4D4D8', fontWeight: active ? 700 : 500, fontSize: 14, textDecoration: 'none',
                    background: active ? 'rgba(255,107,0,0.12)' : 'transparent',
                  }}
                  onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = 'transparent'; }}
                >
                  {language.name}
                  {active ? <Check size={14} color="#ff6b00" aria-hidden="true" /> : null}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The same languages as a row of links: the phone menu and the footer. */
export function LanguageLinks({ testid, onPicked, size = 13 }) {
  const { locale, languages, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t('Sprache', 'Language')} data-testid={testid} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }}>
      <Globe size={size + 1} color="#8e8e97" aria-hidden="true" />
      {languages.map((language) => {
        const active = language.code === locale;
        return (
          <a
            key={language.code}
            href={hrefForLocale(language.code)}
            hrefLang={language.hreflang}
            lang={language.hreflang}
            aria-current={active ? 'true' : undefined}
            data-testid={testid ? `${testid}-${language.code}` : undefined}
            onClick={(event) => pick(event, language.code, setLocale, onPicked)}
            style={{ color: active ? '#fff' : '#A1A1AA', fontWeight: active ? 700 : 500, fontSize: size, textDecoration: 'none' }}
          >
            {language.name}
          </a>
        );
      })}
    </div>
  );
}

/**
 * The dashboard's choice: a plain list box with a globe, so it does not read
 * as a second server list. The bot's language is a server setting of its own.
 */
export function LanguageSelect() {
  const { locale, languages, setLocale, t } = useI18n();
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }}>
      <Globe size={15} color="#8190a8" aria-hidden="true" style={{ position: 'absolute', left: 12, pointerEvents: 'none' }} />
      <select
        className="oa-input"
        data-testid="language-select"
        aria-label={t('Sprache der Seite', 'Page language')}
        title={t('Sprache der Seite', 'Page language')}
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
        style={{ height: 40, width: 'auto', maxWidth: '100%', paddingLeft: 34 }}
      >
        {languages.map((language) => <option key={language.code} value={language.code} lang={language.hreflang}>{language.name}</option>)}
      </select>
    </span>
  );
}
