// OmniFM: the window on the premium page: redeem a code, start the trial.
// Split out of frontend/src/components/Premium.js (#296).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { buildApiUrl } from '../lib/api.js';

// What Tab can reach inside the window (#530).
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// Nothing is bought on the website any more (#321): Premium comes to Discord.
// Here a free code is redeemed, and Pro can be tried for a month.
export function CheckoutModal(props) {
  const {
    planId,
    tier,
    meta,
    trialConfig,
    discordShop,
    onClose,
    copy,
    locale,
    t,
  } = props;

  const [email, setEmail] = useState('');
  const [coupon, setCoupon] = useState('');
  const [loading, setLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeColor, setNoticeColor] = useState('#ff6b00');
  const dialog = useRef(null);
  const emailField = useRef(null);
  const titleId = useId();
  const emailId = useId();
  const emailHintId = useId();
  const couponId = useId();

  const Icon = meta.icon;
  const trialEnabled = planId === 'pro' && trialConfig?.enabled !== false;

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    color: '#fff',
    padding: '12px 14px',
    fontFamily: "'JetBrains Mono', monospace",
    // 16px or more: iOS Safari zooms in on a focused field below that, and
    // the window puts the focus in the e-mail field when it opens (#530).
    fontSize: 16,
    outline: 'none',
    transition: 'border-color 0.2s',
  };
  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: '#A1A1AA',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 6,
    fontFamily: "'Syne', sans-serif",
  };

  // The window takes the focus and gives it back to the button that opened
  // it, however it closes (#530).
  useEffect(() => {
    const opener = document.activeElement;
    emailField.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // While a code or the free month is being sent, the window stays open:
  // closing it would lose the answer, and a second try would then read
  // "already used" (#530).
  const busy = loading || trialLoading;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const requestClose = useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);

  // Escape closes; Tab and Shift+Tab go round inside the window (#530).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const outside = !dialog.current.contains(current);
      if (event.shiftKey && (outside || current === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [requestClose]);

  const handleRedeem = async () => {
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(copy.premium.invalidEmail);
      return;
    }
    if (!coupon.trim()) {
      setError(copy.premium.codeRequired);
      return;
    }

    setNotice('');
    setError('');
    setLoading(true);

    try {
      const response = await fetch(buildApiUrl('/api/premium/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: planId,
          email: trimmedEmail,
          months: 1,
          seats: 1,
          couponCode: coupon.trim(),
          language: locale,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error || !payload?.activated) {
        setError(payload?.error || copy.premium.checkoutFailed);
        return;
      }
      setNoticeColor('#ff6b00');
      setNotice(payload?.message || copy.premium.trialActivatedDefault);
    } catch {
      setError(copy.premium.checkoutFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleTrial = async () => {
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(copy.premium.invalidEmail);
      return;
    }

    setError('');
    setNotice('');
    setTrialLoading(true);

    try {
      const response = await fetch(buildApiUrl('/api/premium/trial'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          language: locale,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        setError(payload?.error || payload?.message || copy.premium.trialFailed);
        return;
      }
      setNoticeColor('#ff6b00');
      setNotice(payload?.message || copy.premium.trialActivatedDefault);
    } catch {
      setError(copy.premium.trialFailed);
    } finally {
      setTrialLoading(false);
    }
  };

  // On <body>: the premium section draws only near the screen (#501), and
  // its containment would hold a fixed window inside the section.
  return createPortal((
    <div
      data-testid="checkout-modal-overlay"
      role="presentation"
      onClick={requestClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 20px',
        overflowY: 'auto',
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={`checkout-modal-${planId}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 480,
          background: '#0c0c0e',
          border: `1px solid ${meta.color}30`,
          borderRadius: 20,
          padding: '36px 32px',
          boxShadow: `0 0 60px ${meta.color}15`,
        }}
      >
        <button
          data-testid="checkout-modal-close"
          onClick={requestClose}
          aria-label={t('Schließen', 'Close')}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'none',
            border: 'none',
            color: '#8e8e97',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={18} />
        </button>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            margin: '0 auto 12px',
            background: `${meta.color}15`,
            border: `2px solid ${meta.color}50`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={26} color={meta.color} />
          </div>
          <h3 id={titleId} style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: '#fff', margin: 0 }}>
            {copy.premium.redeemTitle({ name: tier.name })}
          </h3>
        </div>

        <div data-testid="checkout-discord-note" style={{
          padding: '12px 16px',
          borderRadius: 12,
          marginBottom: 20,
          background: 'rgba(88,101,242,0.08)',
          border: '1px solid rgba(88,101,242,0.25)',
        }}>
          <p style={{ margin: 0, fontSize: 12, color: '#C7CBFF', lineHeight: 1.5 }}>
            {discordShop?.enabled ? copy.premium.discordShopOpen : copy.premium.discordSoon}
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor={emailId} style={labelStyle}>{copy.premium.emailLabel}</label>
          <input
            ref={emailField}
            id={emailId}
            aria-describedby={emailHintId}
            data-testid="checkout-email-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={copy.premium.emailPlaceholder}
            style={inputStyle}
            onFocus={(event) => { event.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(event) => { event.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          />
          <p id={emailHintId} style={{ margin: '4px 0 0', fontSize: 11, color: '#8e8e97' }}>
            {copy.premium.emailHint}
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor={couponId} style={labelStyle}>{copy.premium.couponLabel}</label>
          <input
            id={couponId}
            data-testid="checkout-coupon-input"
            value={coupon}
            onChange={(event) => setCoupon(event.target.value)}
            placeholder={copy.premium.couponPlaceholder}
            style={inputStyle}
            onFocus={(event) => { event.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(event) => { event.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          />
        </div>

        <div style={{
          padding: '12px 16px',
          borderRadius: 12,
          marginBottom: 20,
          background: `${meta.color}08`,
          border: `1px solid ${meta.color}18`,
        }}>
          <p style={{ margin: 0, fontSize: 12, color: '#A1A1AA', lineHeight: 1.5 }}>
            {copy.premium.licenseHintLead}{' '}
            <strong style={{ color: meta.color }}>{copy.premium.licenseHintKey}</strong>{' '}
            {copy.premium.licenseHintMiddle}{' '}
            <strong style={{ color: '#00e5ff' }}>{copy.premium.licenseHintCommand}</strong>{' '}
            {copy.premium.licenseHintTail}
          </p>
        </div>

        {/* Read out when it appears: the code worked, or what went wrong (#530). */}
        <div role="status" data-testid="checkout-status">
          {notice && (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: noticeColor, textAlign: 'center' }}>
              {notice}
            </p>
          )}
          {error && (
            <p data-testid="checkout-error-msg" style={{ margin: '0 0 12px', fontSize: 12, color: '#ff2a5f', textAlign: 'center' }}>
              {error}
            </p>
          )}
        </div>

        <button
          data-testid={`checkout-pay-btn-${planId}`}
          onClick={handleRedeem}
          disabled={loading || trialLoading}
          style={{
            width: '100%',
            padding: '14px 0',
            borderRadius: 12,
            border: 'none',
            background: loading ? `${meta.color}80` : meta.color,
            color: '#050505',
            fontWeight: 800,
            fontSize: 16,
            fontFamily: "'DM Sans', sans-serif",
            cursor: loading ? 'default' : 'pointer',
            transition: 'transform 0.15s, box-shadow 0.2s',
            boxShadow: `0 0 25px ${meta.color}30`,
          }}
          onMouseEnter={(event) => {
            if (!loading) {
              event.currentTarget.style.transform = 'scale(1.02)';
              event.currentTarget.style.boxShadow = `0 0 35px ${meta.color}50`;
            }
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.transform = 'scale(1)';
            event.currentTarget.style.boxShadow = `0 0 25px ${meta.color}30`;
          }}
        >
          {loading ? copy.premium.redeemWorking : copy.premium.redeemButton}
        </button>

        {trialEnabled && (
          <button
            data-testid="checkout-trial-btn"
            onClick={handleTrial}
            disabled={loading || trialLoading}
            style={{
              width: '100%',
              marginTop: 10,
              padding: '12px 0',
              borderRadius: 12,
              border: `1px solid ${meta.color}55`,
              background: 'rgba(255,255,255,0.03)',
              color: meta.color,
              fontWeight: 800,
              fontSize: 14,
              fontFamily: "'DM Sans', sans-serif",
              cursor: loading || trialLoading ? 'default' : 'pointer',
            }}
          >
            {trialLoading
              ? copy.premium.trialWorking
              : copy.premium.trialCta({ months: trialConfig?.months || 1 })}
          </button>
        )}

        <button
          data-testid="checkout-cancel-btn"
          onClick={requestClose}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 12,
            padding: '8px 0',
            background: 'none',
            border: 'none',
            color: '#8e8e97',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
            transition: 'color 0.2s',
          }}
          onMouseEnter={(event) => { event.currentTarget.style.color = '#A1A1AA'; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = '#8e8e97'; }}
        >
          {copy.premium.cancel}
        </button>
      </div>
    </div>
  ), document.body);
}
