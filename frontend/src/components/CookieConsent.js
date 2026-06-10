import React, { useEffect, useState } from 'react';
import { Cookie, Settings, ShieldCheck, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import {
  applyConsent,
  readStoredConsent,
  writeStoredConsent,
} from '../lib/analyticsConsent.js';

function ConsentButton({ children, onClick, variant = 'secondary', testId }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        minHeight: 40,
        border: isPrimary ? '1px solid rgba(0,240,255,0.5)' : '1px solid rgba(255,255,255,0.14)',
        background: isPrimary ? 'rgba(0,240,255,0.16)' : 'rgba(255,255,255,0.04)',
        color: '#F4F4F5',
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: 800,
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
        padding: '14px 0',
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
        style={{ width: 20, height: 20, accentColor: '#00F0FF', marginTop: 2 }}
      />
    </label>
  );
}

export default function CookieConsent() {
  const { copy } = useI18n();
  const [visible, setVisible] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const consentCopy = copy.cookieConsent;

  useEffect(() => {
    const stored = readStoredConsent();
    if (stored) {
      setAnalytics(stored.analytics);
      applyConsent(stored);
      setVisible(false);
    } else {
      applyConsent({ analytics: false });
      setVisible(true);
    }
    setInitialized(true);
  }, []);

  const persist = (nextAnalytics) => {
    const stored = writeStoredConsent({ analytics: nextAnalytics });
    setAnalytics(stored.analytics);
    applyConsent(stored);
    setVisible(false);
  };

  if (!initialized) return null;

  return (
    <>
      {visible && (
        <div
          data-testid="cookie-consent-banner"
          role="dialog"
          aria-modal="false"
          aria-label={consentCopy.title}
          style={{
            position: 'fixed',
            zIndex: 90,
            left: 18,
            right: 18,
            bottom: 18,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 'min(980px, 100%)',
              maxHeight: 'calc(100vh - 36px)',
              overflow: 'auto',
              pointerEvents: 'auto',
              background: 'rgba(5,5,5,0.96)',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
              padding: 20,
            }}
          >
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(0,240,255,0.1)',
                      border: '1px solid rgba(0,240,255,0.18)',
                      flexShrink: 0,
                    }}
                  >
                    <ShieldCheck size={18} color="#00F0FF" />
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.25 }}>{consentCopy.title}</h2>
                    <p style={{ margin: '7px 0 0', color: '#A1A1AA', fontSize: 14, lineHeight: 1.65 }}>
                      {consentCopy.body}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="cookie-consent-close"
                  onClick={() => persist(false)}
                  title={consentCopy.reject}
                  style={{
                    width: 34,
                    height: 34,
                    display: 'grid',
                    placeItems: 'center',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.04)',
                    color: '#F4F4F5',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              <div>
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
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
                <ConsentButton testId="cookie-consent-reject" onClick={() => persist(false)}>
                  {consentCopy.reject}
                </ConsentButton>
                <ConsentButton testId="cookie-consent-save" onClick={() => persist(analytics)}>
                  {consentCopy.save}
                </ConsentButton>
                <ConsentButton testId="cookie-consent-accept" variant="primary" onClick={() => persist(true)}>
                  {consentCopy.acceptAll}
                </ConsentButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {!visible && (
        <button
          type="button"
          data-testid="cookie-consent-manage"
          onClick={() => setVisible(true)}
          title={consentCopy.manage}
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
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
    </>
  );
}
