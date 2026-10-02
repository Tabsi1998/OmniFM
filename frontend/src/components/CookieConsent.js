import { useEffect, useState } from 'react';
import { Cookie, Settings } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildPageHref } from '../lib/pageRouting.js';
import {
  applyConsent,
  readStoredConsent,
  writeStoredConsent,
} from '../lib/analyticsConsent.js';

// The cookie notice as a slim bar at the bottom (#435): one short line and
// the same choices as before (reject, accept all, or pick in the settings).
// On a phone it stays under a quarter of the screen until the settings open.

function ConsentButton({ children, onClick, variant = 'secondary', testId, expanded }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-expanded={expanded}
      style={{
        minHeight: 40,
        borderRadius: 10,
        border: isPrimary ? '1px solid rgba(0,229,255,0.5)' : '1px solid rgba(255,255,255,0.14)',
        background: isPrimary ? 'rgba(0,229,255,0.16)' : 'rgba(255,255,255,0.04)',
        color: '#F4F4F5',
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 800,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ToggleRow({ title, body, checked, disabled, onChange, testId }) {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 14,
        padding: '12px 0',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontWeight: 800, color: '#F4F4F5', fontSize: 14 }}>{title}</span>
        <span style={{ color: '#A1A1AA', fontSize: 13, lineHeight: 1.55 }}>{body}</span>
      </span>
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        style={{ width: 20, height: 20, accentColor: '#00e5ff', marginTop: 2 }}
      />
    </label>
  );
}

export default function CookieConsent() {
  const { copy, locale } = useI18n();
  // The stored choice is read in the first render (#467): the bar used to
  // come one render later, and on phones it was the page's last big paint.
  const [stored] = useState(readStoredConsent);
  const [visible, setVisible] = useState(!stored);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(stored?.analytics === true);
  const consentCopy = copy.cookieConsent;

  useEffect(() => {
    applyConsent(stored || { analytics: false });
  }, [stored]);

  const persist = (nextAnalytics) => {
    const stored = writeStoredConsent({ analytics: nextAnalytics });
    setAnalytics(stored.analytics);
    applyConsent(stored);
    setVisible(false);
    setSettingsOpen(false);
  };

  return (
    <>
      {visible && (
        <div
          data-testid="cookie-consent-banner"
          role="region"
          aria-label={consentCopy.title}
          style={{
            position: 'fixed',
            zIndex: 90,
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: '85vh',
            overflowY: 'auto',
            background: 'rgba(8,9,13,0.97)',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
          }}
        >
          <div
            className="cookie-bar"
            style={{
              maxWidth: 1200,
              margin: '0 auto',
              padding: '12px 20px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '10px 18px',
            }}
          >
            <p data-testid="cookie-consent-text" style={{ flex: '1 1 340px', margin: 0, color: '#C4C4CC', fontSize: 13, lineHeight: 1.5 }}>
              {consentCopy.short}{' '}
              <a href={buildPageHref(locale, 'privacy')} style={{ color: '#00e5ff', fontWeight: 700 }}>
                {consentCopy.privacyLink}
              </a>
            </p>
            <div className="cookie-bar-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <ConsentButton testId="cookie-consent-reject" onClick={() => persist(false)}>
                {consentCopy.reject}
              </ConsentButton>
              <ConsentButton testId="cookie-consent-settings" expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
                {consentCopy.settings}
              </ConsentButton>
              <ConsentButton testId="cookie-consent-accept" variant="primary" onClick={() => persist(true)}>
                {consentCopy.acceptAll}
              </ConsentButton>
            </div>

            {settingsOpen && (
              <div data-testid="cookie-consent-settings-panel" style={{ flexBasis: '100%' }}>
                <ToggleRow
                  title={consentCopy.necessaryTitle}
                  body={consentCopy.necessaryBody}
                  checked
                  disabled
                  testId="cookie-consent-necessary"
                />
                <ToggleRow
                  title={consentCopy.analyticsTitle}
                  body={consentCopy.analyticsBody}
                  checked={analytics}
                  onChange={setAnalytics}
                  testId="cookie-consent-analytics"
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                  <ConsentButton testId="cookie-consent-save" onClick={() => persist(analytics)}>
                    {consentCopy.save}
                  </ConsentButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!visible && (
        <button
          type="button"
          data-testid="cookie-consent-manage"
          onClick={() => {
            setSettingsOpen(true);
            setVisible(true);
          }}
          title={consentCopy.manage}
          aria-label={consentCopy.manage}
          style={{
            position: 'fixed',
            right: 16,
            // Above the player bar while it is there (NowPlayingBar sets the height).
            bottom: 'calc(var(--omnifm-bottom-bar, 0px) + 16px)',
            zIndex: 80,
            width: 42,
            height: 42,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(5,5,5,0.82)',
            color: '#F4F4F5',
            cursor: 'pointer',
          }}
        >
          <span style={{ position: 'relative', width: 18, height: 18, display: 'grid', placeItems: 'center' }}>
            <Cookie size={18} />
            <Settings size={10} style={{ position: 'absolute', right: -4, bottom: -4 }} />
          </span>
        </button>
      )}

      <style>{`
        @media (max-width: 520px) {
          .cookie-bar { padding: 10px 14px !important; }
          .cookie-bar-actions { width: 100%; }
          .cookie-bar-actions > button { flex: 1 1 auto; padding: 8px 10px !important; }
        }
      `}</style>
    </>
  );
}
