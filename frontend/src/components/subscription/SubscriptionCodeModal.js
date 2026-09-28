// OmniFM: server dashboard subscription: the window to redeem a code.
// Split out of frontend/src/components/DashboardSubscription.js (#296).
import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw, X } from 'lucide-react';
import { TIER_COLORS } from './subscriptionShared.js';

export function DashboardCheckoutModal({
  open,
  onClose,
  loading,
  submitError,
  initialTier,
  seats,
  t,
  onSubmit,
  onPreview,
  hasBillingEmail,
}) {
  const months = 1;
  const tier = initialTier;
  const [billingEmail, setBillingEmail] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const accent = TIER_COLORS[tier] || '#8B5CF6';
  const requiresBillingEmail = hasBillingEmail === false;
  const normalizedBillingEmail = String(billingEmail || '').trim().toLowerCase();
  const normalizedCouponCode = String(couponCode || '').trim().toUpperCase();
  const hasValidBillingEmailInput = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedBillingEmail);

  useEffect(() => {
    if (!open) return;
    setBillingEmail('');
    setCouponCode('');
    setPreviewError('');
    setPreviewData(null);
    setPreviewLoading(false);
  }, [initialTier, open]);

  useEffect(() => {
    if (!open) return;
    setPreviewError('');
    setPreviewData(null);
  }, [couponCode, months, normalizedBillingEmail, open, tier]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [loading, onClose, open]);

  if (!open) return null;

  const previewOffer = previewData?.discount?.applied || null;
  const handlePreview = async () => {
    if (!normalizedCouponCode) {
      setPreviewError(t('Bitte zuerst einen Rabattcode eingeben.', 'Please enter a coupon code first.'));
      setPreviewData(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const result = await onPreview({
        months,
        tier,
        email: normalizedBillingEmail || undefined,
        couponCode: normalizedCouponCode,
      });
      setPreviewData(result);
    } catch (err) {
      setPreviewData(null);
      setPreviewError(err.message || t('Rabattcode konnte nicht geprüft werden.', 'Could not validate coupon code.'));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div
      data-testid="dashboard-subscription-checkout-modal"
      onClick={() => { if (!loading) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: '#0A0A0A',
          border: `1px solid ${accent}55`,
          boxShadow: `0 0 60px ${accent}18`,
          padding: 24,
          display: 'grid',
          gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('Premium', 'Premium')}
            </div>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, color: '#fff', marginTop: 6 }}>
              {t('Code einlösen', 'Redeem a code')}
            </h3>
            <p style={{ color: '#A1A1AA', marginTop: 8, lineHeight: 1.6, fontSize: 14 }}>
              {t(
                'Premium kann man gerade nicht im Dashboard kaufen, es kommt bald direkt in Discord. Hast du einen Gratis-Code, löst du ihn hier für diesen Server ein.',
                'Premium cannot be bought in the dashboard right now; it is coming to Discord soon. If you have a free code, redeem it here for this server.'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            style={{ border: 'none', background: 'transparent', color: '#71717A', cursor: loading ? 'wait' : 'pointer', padding: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        {requiresBillingEmail ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('Abrechnungs-E-Mail', 'Billing email')}
            </div>
            <input
              type="email"
              value={billingEmail}
              onChange={(event) => setBillingEmail(event.target.value)}
              placeholder={t('name@beispiel.de', 'name@example.com')}
              style={{
                height: 42,
                border: `1px solid ${hasValidBillingEmailInput || !normalizedBillingEmail ? '#1A1A2E' : 'rgba(252,165,165,0.4)'}`,
                background: '#050505',
                color: '#fff',
                padding: '0 12px',
                outline: 'none',
              }}
            />
            <div style={{ fontSize: 12, color: '#A1A1AA' }}>
              {t(
                'Für diese Lizenz ist keine gültige E-Mail gespeichert. Bitte hier eingeben, die Lizenz wird darauf ausgestellt.',
                'No valid email is stored for this license. Enter one here; the license is issued to it.'
              )}
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('Code', 'Code')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10 }}>
            <input
              data-testid="dashboard-checkout-coupon-input"
              type="text"
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value)}
              placeholder={t('DEIN-CODE', 'YOUR-CODE')}
              style={{
                height: 42,
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                padding: '0 12px',
                outline: 'none',
              }}
            />
            <button
              data-testid="dashboard-checkout-coupon-preview-btn"
              onClick={handlePreview}
              disabled={previewLoading}
              style={{
                border: '1px solid #1A1A2E',
                background: 'transparent',
                color: '#D4D4D8',
                padding: '0 14px',
                cursor: previewLoading ? 'wait' : 'pointer',
                opacity: previewLoading ? 0.7 : 1,
              }}
            >
              {previewLoading ? t('Prüft...', 'Checking...') : t('Code prüfen', 'Check code')}
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
            {t(
              `Ein Code gilt für die Lizenz dieses Servers (${seats} Server).`,
              `A code applies to this server's license (${seats} servers).`
            )}
          </div>
          {previewError ? (
            <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
              {previewError}
            </div>
          ) : null}
          {previewOffer ? (
            <div
              data-testid="dashboard-checkout-coupon-preview"
              style={{
                border: '1px solid rgba(16,185,129,0.25)',
                background: 'rgba(6,78,59,0.16)',
                padding: '10px 12px',
                display: 'grid',
                gap: 4,
                color: '#D1FAE5',
                fontSize: 13,
              }}
            >
              <strong>
                {t('Code aktiv:', 'Code active:')} {previewOffer.code}
              </strong>
              {previewOffer.fulfillmentMode === 'direct_grant' ? (
                <span>
                  {t(
                    `Dieser Code aktiviert ${String(previewOffer.grantPlan || tier).toUpperCase()} direkt für ${previewOffer.grantMonths || months} Monat${Number(previewOffer.grantMonths || months) > 1 ? 'e' : ''}.`,
                    `This code activates ${String(previewOffer.grantPlan || tier).toUpperCase()} directly for ${previewOffer.grantMonths || months} month${Number(previewOffer.grantMonths || months) > 1 ? 's' : ''}.`
                  )}
                </span>
              ) : (
                <span>
                  {t(
                    'Dieser Code ist ein Rabatt für einen Kauf. Gekauft wird bald direkt in Discord, einlösen lässt er sich hier nicht.',
                    'This code is a discount for a purchase. Buying comes to Discord soon; it cannot be redeemed here.'
                  )}
                </span>
              )}
              {previewOffer.ownerLabel ? (
                <span style={{ color: '#A7F3D0' }}>
                  {t(`Partner: ${previewOffer.ownerLabel}`, `Partner: ${previewOffer.ownerLabel}`)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {submitError ? (
          <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
            {submitError}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => onSubmit({
              months,
              tier,
              email: normalizedBillingEmail || undefined,
              couponCode: normalizedCouponCode || undefined,
            })}
            disabled={loading || !normalizedCouponCode || (requiresBillingEmail && !hasValidBillingEmailInput)}
            style={{
              border: 'none',
              background: accent,
              color: '#fff',
              padding: '12px 16px',
              fontWeight: 700,
              cursor: (loading || !normalizedCouponCode || (requiresBillingEmail && !hasValidBillingEmailInput)) ? 'not-allowed' : 'pointer',
              opacity: (loading || !normalizedCouponCode || (requiresBillingEmail && !hasValidBillingEmailInput)) ? 0.65 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loading ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={15} />}
            {loading ? t('Wird eingelöst …', 'Redeeming …') : t('Code einlösen', 'Redeem code')}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              border: '1px solid #1A1A2E',
              background: 'transparent',
              color: '#A1A1AA',
              padding: '12px 16px',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {t('Abbrechen', 'Cancel')}
          </button>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
