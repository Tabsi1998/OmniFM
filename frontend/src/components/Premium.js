import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Crown, Shield, X, Zap } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildApiUrl } from '../lib/api.js';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';

const PLAN_ORDER = ['free', 'pro', 'ultimate'];
const PLAN_META = {
  free: { color: '#A1A1AA', icon: Shield },
  pro: { color: '#FFB800', icon: Zap },
  ultimate: { color: '#BD00FF', icon: Crown },
};

const BASE_FALLBACK_PRICING = {
  durations: [1, 3, 6, 12],
  seatOptions: [1, 2, 3, 5],
  trial: { enabled: true, tier: 'pro', months: 1, oneTimePerEmail: true },
  tiers: {
    free: { name: 'Free', pricePerMonth: 0, durationPricing: {}, seatPricing: {} },
    pro: {
      name: 'Pro',
      pricePerMonth: 299,
      startingAt: '2.99',
      durationPricing: { 1: '2.99', 3: '2.49', 6: '2.29', 12: '1.99' },
      seatPricing: { 1: '2.99', 2: '5.49', 3: '7.49', 5: '11.49' },
    },
    ultimate: {
      name: 'Ultimate',
      pricePerMonth: 499,
      startingAt: '4.99',
      durationPricing: { 1: '4.99', 3: '3.99', 6: '3.49', 12: '2.99' },
      seatPricing: { 1: '4.99', 2: '7.99', 3: '10.99', 5: '16.99' },
    },
  },
};

function parsePriceNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? '').trim();
  if (!text) return NaN;
  const normalized = text.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeTier(rawTier, fallbackTier, fallbackFeatures) {
  const tier = rawTier && typeof rawTier === 'object' ? rawTier : {};
  const fallback = fallbackTier || {};
  const pick = (field) => {
    const raw = tier[field] && typeof tier[field] === 'object' ? tier[field] : null;
    return raw || (fallback[field] && typeof fallback[field] === 'object' ? fallback[field] : {});
  };
  const localizedFeatures = Array.isArray(fallbackFeatures) ? fallbackFeatures : [];
  const apiFeatures = Array.isArray(tier.features) ? tier.features : [];

  return {
    name: String(tier.name || fallback.name || 'Plan'),
    pricePerMonth: Number.isFinite(Number(tier.pricePerMonth)) ? Number(tier.pricePerMonth) : Number(fallback.pricePerMonth || 0),
    startingAt: String(tier.startingAt || fallback.startingAt || '').trim(),
    features: apiFeatures.length > 0 ? apiFeatures : localizedFeatures,
    durationPricing: pick('durationPricing'),
    seatPricing: pick('seatPricing'),
  };
}

function normalizePricing(rawPricing, fallbackPricing) {
  const raw = rawPricing && typeof rawPricing === 'object' ? rawPricing : {};
  const rawTiers = raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : {};
  const fallbackTiers = fallbackPricing.tiers || {};
  const durations = Array.isArray(raw.durations) && raw.durations.length > 0 ? raw.durations : fallbackPricing.durations;
  const seatOptions = Array.isArray(raw.seatOptions) && raw.seatOptions.length > 0 ? raw.seatOptions : fallbackPricing.seatOptions;

  return {
    durations,
    seatOptions,
    trial: raw.trial && typeof raw.trial === 'object'
      ? {
          enabled: raw.trial.enabled !== false,
          tier: String(raw.trial.tier || 'pro').trim().toLowerCase() || 'pro',
          months: Number(raw.trial.months) > 0 ? Number(raw.trial.months) : 1,
          oneTimePerEmail: raw.trial.oneTimePerEmail !== false,
        }
      : { ...fallbackPricing.trial },
    tiers: {
      free: normalizeTier(rawTiers.free, fallbackTiers.free, fallbackTiers.free?.features),
      pro: normalizeTier(rawTiers.pro, fallbackTiers.pro, fallbackTiers.pro?.features),
      ultimate: normalizeTier(rawTiers.ultimate, fallbackTiers.ultimate, fallbackTiers.ultimate?.features),
    },
  };
}

function mapTierToColor(tier) {
  if (tier === 'ultimate') return '#BD00FF';
  if (tier === 'pro') return '#FFB800';
  return '#A1A1AA';
}

function formatEuroAmount(value, formatDecimal) {
  return `${formatDecimal(value)} EUR`;
}

function buildPriceLabel(planId, tier, copy, formatDecimal) {
  if (planId === 'free') return copy.premium.freePrice;
  const startPrice = parsePriceNumber(tier.startingAt);
  if (Number.isFinite(startPrice)) return formatEuroAmount(startPrice, formatDecimal);
  return formatEuroAmount(tier.pricePerMonth / 100, formatDecimal);
}

function CheckoutModal(props) {
  const {
    planId,
    tier,
    meta,
    durations,
    seatOptions,
    trialConfig,
    onClose,
    copy,
    formatDecimal,
    locale,
  } = props;

  const [email, setEmail] = useState('');
  const [coupon, setCoupon] = useState('');
  const [referral, setReferral] = useState('');
  const [selectedSeats, setSelectedSeats] = useState(1);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [loading, setLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeColor, setNoticeColor] = useState('#39FF14');

  const Icon = meta.icon;
  const trialEnabled = planId === 'pro' && trialConfig?.enabled !== false;
  const seatEntries = Object.entries(tier.seatPricing || {})
    .map(([seats, value]) => [Number(seats), parsePriceNumber(value)])
    .filter(([seats, value]) => seatOptions.includes(seats) && Number.isFinite(value))
    .sort((a, b) => a[0] - b[0]);
  const durationEntries = Object.entries(tier.durationPricing || {})
    .map(([months, value]) => [Number(months), parsePriceNumber(value)])
    .filter(([months, value]) => durations.includes(months) && Number.isFinite(value))
    .sort((a, b) => a[0] - b[0]);

  const baseMonthly = durationEntries.find(([months]) => months === 1)?.[1] || 0;
  const selectedDurationPrice = durationEntries.find(([months]) => months === selectedDuration)?.[1] || baseMonthly;
  const seatMonthly = seatEntries.find(([seats]) => seats === selectedSeats)?.[1] || baseMonthly;
  const discountRatio = baseMonthly > 0 ? selectedDurationPrice / baseMonthly : 1;
  const totalPrice = seatMonthly * discountRatio * selectedDuration;
  const durationLabel = copy.premium.monthLabel({ count: selectedDuration });
  const seatsLabel = copy.premium.seatsLabelInline({ count: selectedSeats });
  const summaryLabel = copy.premium.summary({
    durationLabel,
    seatsLabel: selectedSeats > 1 ? seatsLabel : '',
  });
  const payAmount = formatEuroAmount(totalPrice, formatDecimal);

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    color: '#fff',
    padding: '12px 14px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
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
    fontFamily: "'Orbitron', sans-serif",
  };

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handlePay = async () => {
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(copy.premium.invalidEmail);
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
          months: selectedDuration,
          seats: selectedSeats,
          couponCode: coupon.trim() || undefined,
          referralCode: referral.trim() || undefined,
          returnUrl: window.location.origin,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        setError(payload?.error || copy.premium.checkoutFailed);
        return;
      }
      if (payload?.activated) {
        setNoticeColor('#39FF14');
        setNotice(payload?.message || copy.premium.trialActivatedDefault);
        return;
      }
      if (payload?.url) {
        window.location.href = payload.url;
        return;
      }
      setError(copy.premium.checkoutUrlMissing);
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
      setNoticeColor('#39FF14');
      setNotice(payload?.message || copy.premium.trialActivatedDefault);
    } catch {
      setError(copy.premium.trialFailed);
    } finally {
      setTrialLoading(false);
    }
  };

  return (
    <div
      data-testid="checkout-modal-overlay"
      onClick={onClose}
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
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'none',
            border: 'none',
            color: '#52525B',
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
          <h3 style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 22, color: '#fff', margin: 0 }}>
            {copy.premium.checkoutTitle({ name: tier.name })}
          </h3>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>{copy.premium.emailLabel}</label>
          <input
            data-testid="checkout-email-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={copy.premium.emailPlaceholder}
            style={inputStyle}
            onFocus={(event) => { event.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(event) => { event.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#52525B' }}>
            {copy.premium.emailHint}
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>{copy.premium.couponLabel}</label>
          <input
            data-testid="checkout-coupon-input"
            value={coupon}
            onChange={(event) => setCoupon(event.target.value)}
            placeholder={copy.premium.couponPlaceholder}
            style={inputStyle}
            onFocus={(event) => { event.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(event) => { event.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>{copy.premium.referralLabel}</label>
          <input
            data-testid="checkout-referral-input"
            value={referral}
            onChange={(event) => setReferral(event.target.value)}
            placeholder={copy.premium.referralPlaceholder}
            style={inputStyle}
            onFocus={(event) => { event.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(event) => { event.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#52525B' }}>
            {copy.premium.referralHint}
          </p>
        </div>

        {seatEntries.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <label style={labelStyle}>{copy.premium.seatsLabel}</label>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(seatEntries.length, 4)}, 1fr)`, gap: 8 }}>
              {seatEntries.map(([seats, monthlyTotal]) => {
                const isSelected = selectedSeats === seats;
                const isBest = seats === Math.max(...seatEntries.map(([seatCount]) => seatCount));
                return (
                  <button
                    key={seats}
                    data-testid={`checkout-seats-${seats}`}
                    onClick={() => setSelectedSeats(seats)}
                    style={{
                      position: 'relative',
                      padding: '14px 8px',
                      borderRadius: 12,
                      border: `2px solid ${isSelected ? meta.color : 'rgba(255,255,255,0.1)'}`,
                      background: isSelected ? `${meta.color}18` : 'rgba(255,255,255,0.03)',
                      color: isSelected ? '#fff' : '#A1A1AA',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.2s',
                      outline: 'none',
                    }}
                  >
                    {isBest && (
                      <span style={{
                        position: 'absolute',
                        top: -8,
                        right: -4,
                        padding: '2px 6px',
                        borderRadius: 6,
                        background: '#00FF66',
                        color: '#050505',
                        fontSize: 8,
                        fontWeight: 800,
                        letterSpacing: '0.05em',
                        fontFamily: "'Orbitron', sans-serif",
                      }}>
                        {copy.premium.bestValue}
                      </span>
                    )}
                    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: isSelected ? meta.color : '#fff' }}>
                      {seats}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>{copy.premium.seatsSuffix}</div>
                    <div style={{ fontSize: 10, marginTop: 2, color: '#52525B' }}>
                      {copy.premium.seatsMonthly({ amount: formatEuroAmount(monthlyTotal, formatDecimal) })}
                    </div>
                  </button>
                );
              })}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#52525B' }}>
              {copy.premium.seatsHint}
            </p>
          </div>
        )}

        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>{copy.premium.durationLabel}</label>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(durationEntries.length, 4)}, 1fr)`, gap: 8 }}>
            {durationEntries.map(([months]) => {
              const isSelected = selectedDuration === months;
              const isYearly = months === 12;
              return (
                <button
                  key={months}
                  data-testid={`checkout-duration-${months}`}
                  onClick={() => setSelectedDuration(months)}
                  style={{
                    position: 'relative',
                    padding: '14px 8px',
                    borderRadius: 12,
                    border: `2px solid ${isSelected ? meta.color : 'rgba(255,255,255,0.1)'}`,
                    background: isSelected ? `${meta.color}18` : 'rgba(255,255,255,0.03)',
                    color: isSelected ? '#fff' : '#A1A1AA',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                    outline: 'none',
                  }}
                >
                  {isYearly && (
                    <span style={{
                      position: 'absolute',
                      top: -8,
                      right: -4,
                      padding: '2px 6px',
                      borderRadius: 6,
                      background: '#00FF66',
                      color: '#050505',
                      fontSize: 8,
                      fontWeight: 800,
                      letterSpacing: '0.05em',
                      fontFamily: "'Orbitron', sans-serif",
                    }}>
                      {copy.premium.durationBonus}
                    </span>
                  )}
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: isSelected ? meta.color : '#fff' }}>
                    {months}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    {months === 1 ? copy.premium.durationMonth : copy.premium.durationMonths}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 14, color: '#A1A1AA', fontFamily: "'DM Sans', sans-serif" }}>
            {summaryLabel}
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, color: meta.color, fontFamily: "'JetBrains Mono', monospace" }}>
            {payAmount}
          </span>
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
            <strong style={{ color: '#00F0FF' }}>{copy.premium.licenseHintCommand}</strong>{' '}
            {copy.premium.licenseHintTail}
          </p>
        </div>

        {notice && (
          <p style={{ margin: '0 0 12px', fontSize: 12, color: noticeColor, textAlign: 'center' }}>
            {notice}
          </p>
        )}
        {error && (
          <p data-testid="checkout-error-msg" style={{ margin: '0 0 12px', fontSize: 12, color: '#FF2A2A', textAlign: 'center' }}>
            {error}
          </p>
        )}

        <button
          data-testid={`checkout-pay-btn-${planId}`}
          onClick={handlePay}
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
          {loading ? copy.premium.checkoutRedirect : copy.premium.payButton({ amount: payAmount })}
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
          onClick={onClose}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 12,
            padding: '8px 0',
            background: 'none',
            border: 'none',
            color: '#52525B',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
            transition: 'color 0.2s',
          }}
          onMouseEnter={(event) => { event.currentTarget.style.color = '#A1A1AA'; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = '#52525B'; }}
        >
          {copy.premium.cancel}
        </button>
      </div>
    </div>
  );
}

function Premium({ bots = [] }) {
  const { copy, locale, formatDate, formatDecimal } = useI18n();

  const fallbackPricing = useMemo(() => ({
    ...BASE_FALLBACK_PRICING,
    tiers: {
      free: { ...BASE_FALLBACK_PRICING.tiers.free, features: copy.premium.fallbackFeatures.free },
      pro: { ...BASE_FALLBACK_PRICING.tiers.pro, features: copy.premium.fallbackFeatures.pro },
      ultimate: { ...BASE_FALLBACK_PRICING.tiers.ultimate, features: copy.premium.fallbackFeatures.ultimate },
    },
  }), [copy.premium.fallbackFeatures.free, copy.premium.fallbackFeatures.pro, copy.premium.fallbackFeatures.ultimate]);

  const [pricing, setPricing] = useState(() => normalizePricing(null, fallbackPricing));
  const [pricingError, setPricingError] = useState('');
  const [serverId, setServerId] = useState('');
  const [result, setResult] = useState('');
  const [resultColor, setResultColor] = useState('#52525B');
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const freeInviteUrl = resolvePrimaryInviteUrl(bots);
  const freeInviteIsExternal = freeInviteUrl.startsWith('http');

  useEffect(() => {
    setPricing((current) => normalizePricing(current, fallbackPricing));
  }, [fallbackPricing]);

  useEffect(() => {
    const controller = new AbortController();

    const loadPricing = async () => {
      try {
        const pricingUrl = `${buildApiUrl('/api/premium/pricing')}?lang=${encodeURIComponent(locale)}`;
        const response = await fetch(pricingUrl, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload?.error) throw new Error(payload?.error || `HTTP ${response.status}`);
        setPricing(normalizePricing(payload, fallbackPricing));
        setPricingError('');
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setPricing(normalizePricing(null, fallbackPricing));
        setPricingError(copy.premium.pricingFallback);
      }
    };

    loadPricing();
    return () => controller.abort();
  }, [copy.premium.pricingFallback, fallbackPricing, locale]);

  const checkStatus = async () => {
    const normalizedServerId = serverId.trim();
    if (!/^\d{17,22}$/.test(normalizedServerId)) {
      setResult(copy.premium.serverIdInvalid);
      setResultColor('#FF2A2A');
      return;
    }

    setCheckingStatus(true);
    try {
      const response = await fetch(`${buildApiUrl('/api/premium/check')}?serverId=${encodeURIComponent(normalizedServerId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        setResult(payload?.error || copy.premium.checkFailed);
        setResultColor('#FF2A2A');
        return;
      }

      const tier = String(payload?.tier || 'free').toLowerCase();
      const days = Number(payload?.license?.remainingDays ?? 0);
      const expiresAt = payload?.license?.expiresAt
        ? formatDate(payload.license.expiresAt, { year: 'numeric', month: 'short', day: 'numeric' })
        : '-';
      const bitrate = String(payload?.bitrate || '-');

      setResult(copy.premium.statusResult({
        tier: tier.toUpperCase(),
        bitrate,
        days,
        expires: expiresAt,
      }));
      setResultColor(mapTierToColor(tier));
    } catch {
      setResult(copy.premium.checkFailed);
      setResultColor('#FF2A2A');
    } finally {
      setCheckingStatus(false);
    }
  };

  const closeCheckout = useCallback(() => setCheckoutPlan(null), []);

  return (
    <section id="premium" data-testid="premium-section" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Crown size={16} color="#FFB800" />
            <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, letterSpacing: '0.15em', color: '#FFB800', textTransform: 'uppercase', fontWeight: 700 }}>
              {copy.premium.eyebrow}
            </span>
          </div>
          <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginBottom: 12 }}>
            {copy.premium.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 560 }}>
            {copy.premium.subtitle}
          </p>
          {pricingError && <p style={{ marginTop: 10, fontSize: 12, color: '#FFB800' }}>{pricingError}</p>}
        </div>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#71717A', marginBottom: 14 }}>
            {copy.premium.positioningTitle}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {copy.premium.positioning.map((item) => {
              const meta = PLAN_META[item.key] || PLAN_META.free;
              return (
                <div
                  key={item.key}
                  data-testid={`premium-positioning-${item.key}`}
                  style={{
                    padding: '18px 20px',
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${meta.color}20`,
                  }}
                >
                  <div style={{ color: meta.color, fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8 }}>
                    {(item.key || '').toUpperCase()}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                    {item.title}
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.65, color: '#A1A1AA' }}>
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginBottom: 40 }}>
          {PLAN_ORDER.map((planId) => {
            const tier = pricing.tiers[planId];
            const meta = PLAN_META[planId];
            const Icon = meta.icon;
            const isPro = planId === 'pro';
            const trialEnabled = isPro && pricing.trial?.enabled !== false;

            return (
              <div
                key={planId}
                data-testid={`plan-card-${planId}`}
                style={{
                  position: 'relative',
                  borderRadius: 18,
                  padding: '28px 24px',
                  background: isPro ? `${meta.color}08` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${meta.color}${isPro ? '35' : '18'}`,
                  transition: 'border-color 0.3s, box-shadow 0.3s',
                  boxShadow: isPro ? `0 0 30px ${meta.color}10` : 'none',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = `${meta.color}50`;
                  if (isPro) event.currentTarget.style.boxShadow = `0 0 40px ${meta.color}18`;
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = `${meta.color}${isPro ? '35' : '18'}`;
                  event.currentTarget.style.boxShadow = isPro ? `0 0 30px ${meta.color}10` : 'none';
                }}
              >
                {isPro && (
                  <div style={{
                    position: 'absolute',
                    top: -1,
                    right: 20,
                    padding: '4px 12px',
                    borderRadius: '0 0 8px 8px',
                    background: meta.color,
                    color: '#050505',
                    fontFamily: "'Orbitron', sans-serif",
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                  }}>
                    {copy.premium.planPopular}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: `${meta.color}12`,
                    border: `1px solid ${meta.color}30`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Icon size={18} color={meta.color} />
                  </div>
                  <strong style={{ color: meta.color, fontFamily: "'Orbitron', sans-serif", fontSize: 16 }}>
                    {tier.name}
                  </strong>
                </div>

                <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                  {planId !== 'free' && (
                    <div
                      data-testid={`premium-price-prefix-${planId}`}
                      style={{
                        fontSize: 11,
                        color: '#A1A1AA',
                        letterSpacing: '0.06em',
                        marginBottom: 6,
                        fontFamily: "'Outfit', sans-serif",
                        fontWeight: 600,
                      }}
                    >
                      {copy.premium.priceFrom}
                    </div>
                  )}
                  {buildPriceLabel(planId, tier, copy, formatDecimal)}
                  <span style={{ fontSize: 13, color: '#52525B', fontWeight: 400, fontFamily: "'DM Sans', sans-serif" }}>
                    {copy.premium.perMonth}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {tier.features.map((feature) => (
                    <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: '#A1A1AA' }}>{feature}</span>
                    </div>
                  ))}
                </div>

                {planId === 'free' ? (
                  <a
                    href={freeInviteUrl}
                    target={freeInviteIsExternal ? '_blank' : undefined}
                    rel={freeInviteIsExternal ? 'noopener noreferrer' : undefined}
                    data-testid="premium-free-start-btn"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '12px 0',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: 'rgba(255,255,255,0.04)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 14,
                      fontFamily: "'DM Sans', sans-serif",
                      textDecoration: 'none',
                      transition: 'transform 0.15s, border-color 0.2s, background 0.2s',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.transform = 'scale(1.02)';
                      event.currentTarget.style.borderColor = 'rgba(0,240,255,0.35)';
                      event.currentTarget.style.background = 'rgba(0,240,255,0.08)';
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.transform = 'scale(1)';
                      event.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                      event.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    }}
                  >
                    {copy.premium.freeCta}
                    <ArrowRight size={16} />
                  </a>
                ) : (
                  <>
                    <button
                      data-testid={`buy-btn-${planId}`}
                      onClick={() => setCheckoutPlan(planId)}
                      style={{
                        width: '100%',
                        padding: '12px 0',
                        borderRadius: 10,
                        border: 'none',
                        background: meta.color,
                        color: '#050505',
                        fontWeight: 700,
                        fontSize: 14,
                        fontFamily: "'DM Sans', sans-serif",
                        cursor: 'pointer',
                        transition: 'transform 0.15s, box-shadow 0.2s',
                        boxShadow: `0 0 20px ${meta.color}30`,
                      }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.transform = 'scale(1.02)';
                        event.currentTarget.style.boxShadow = `0 0 30px ${meta.color}50`;
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.transform = 'scale(1)';
                        event.currentTarget.style.boxShadow = `0 0 20px ${meta.color}30`;
                      }}
                    >
                      {copy.premium.buy({ name: tier.name })}
                    </button>
                    {trialEnabled && (
                      <button
                        data-testid="premium-pro-trial-open-btn"
                        onClick={() => setCheckoutPlan(planId)}
                        style={{
                          width: '100%',
                          marginTop: 10,
                          padding: '10px 0',
                          borderRadius: 10,
                          border: `1px solid ${meta.color}55`,
                          background: 'rgba(255,255,255,0.03)',
                          color: meta.color,
                          fontWeight: 700,
                          fontSize: 13,
                          fontFamily: "'DM Sans', sans-serif",
                          cursor: 'pointer',
                        }}
                      >
                        {copy.premium.trialCta({ months: pricing.trial?.months || 1 })}
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          maxWidth: 560,
          padding: '24px 28px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
        }}>
          <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A1A1AA', marginBottom: 12, fontWeight: 600 }}>
            {copy.premium.statusTitle}
          </div>
          <p data-testid="premium-status-hint" style={{ margin: '0 0 14px', fontSize: 13, color: '#71717A', lineHeight: 1.65 }}>
            {copy.premium.statusHint}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              data-testid="premium-server-id-input"
              value={serverId}
              onChange={(event) => setServerId(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') checkStatus(); }}
              placeholder={copy.premium.serverIdPlaceholder}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                color: '#fff',
                padding: '10px 14px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(event) => { event.target.style.borderColor = 'rgba(0,240,255,0.3)'; }}
              onBlur={(event) => { event.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
            />
            <button
              data-testid="premium-check-btn"
              onClick={checkStatus}
              disabled={checkingStatus}
              style={{
                background: checkingStatus ? 'rgba(0,240,255,0.5)' : '#00F0FF',
                border: 'none',
                color: '#050505',
                borderRadius: 10,
                fontWeight: 700,
                padding: '10px 18px',
                cursor: checkingStatus ? 'default' : 'pointer',
                transition: 'transform 0.15s',
                fontFamily: "'DM Sans', sans-serif",
              }}
              onMouseEnter={(event) => { if (!checkingStatus) event.currentTarget.style.transform = 'scale(1.03)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.transform = 'scale(1)'; }}
            >
              {checkingStatus ? copy.premium.checkLoading : copy.premium.checkButton}
            </button>
          </div>
          <div
            data-testid="premium-check-result"
            style={{
              marginTop: 10,
              minHeight: 18,
              color: resultColor,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {result}
          </div>
        </div>
      </div>

      {checkoutPlan && (
        <CheckoutModal
          planId={checkoutPlan}
          tier={pricing.tiers[checkoutPlan]}
          meta={PLAN_META[checkoutPlan]}
          durations={pricing.durations}
          seatOptions={pricing.seatOptions}
          trialConfig={pricing.trial}
          onClose={closeCheckout}
          copy={copy}
          formatDecimal={formatDecimal}
          locale={locale}
        />
      )}
    </section>
  );
}

export default Premium;
