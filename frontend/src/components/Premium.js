import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Crown, Shield, Zap } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildApiUrl } from '../lib/api.js';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';
import { CheckoutModal } from './PremiumCodeModal.js';
import { planCardLinesIn } from '../../../src/config/plan-feature-texts.js';

const PLAN_ORDER = ['free', 'pro', 'ultimate'];
const PLAN_META = {
  free: { color: '#A1A1AA', icon: Shield },
  pro: { color: '#ff6b00', icon: Zap },
  ultimate: { color: '#ff2a5f', icon: Crown },
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

function normalizeTier(rawTier, fallbackTier, fallbackFeatures, fallbackIntro = '') {
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
    // "Alles aus Free, dazu:" belongs to the generated lines only, not to the owner's own list.
    intro: apiFeatures.length > 0 ? '' : String(fallbackIntro || ''),
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
    // Premium is bought in Discord once the owner switched the shop on (#320).
    discordShop: raw.discordShop?.enabled === true && /^https:\/\/discord\.com\//.test(String(raw.discordShop.storeUrl || ''))
      ? { enabled: true, storeUrl: String(raw.discordShop.storeUrl) }
      : { enabled: false, storeUrl: '' },
    tiers: {
      free: normalizeTier(rawTiers.free, fallbackTiers.free, fallbackTiers.free?.features, fallbackTiers.free?.intro),
      pro: normalizeTier(rawTiers.pro, fallbackTiers.pro, fallbackTiers.pro?.features, fallbackTiers.pro?.intro),
      ultimate: normalizeTier(rawTiers.ultimate, fallbackTiers.ultimate, fallbackTiers.ultimate?.features, fallbackTiers.ultimate?.intro),
    },
  };
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

function Premium({ bots = [], planContext = {} }) {
  const { copy, locale, formatDecimal } = useI18n();
  const { freeStations, allStations } = planContext;

  // #413: what each plan brings, from the bot's plan file; the owner's own
  // list from the owner console still wins.
  const fallbackPricing = useMemo(() => {
    const context = { freeStations, allStations };
    const tierOf = (plan) => {
      const card = planCardLinesIn(plan, { language: locale, context });
      return { ...BASE_FALLBACK_PRICING.tiers[plan], features: card.lines, intro: card.intro || '' };
    };
    return { ...BASE_FALLBACK_PRICING, tiers: { free: tierOf('free'), pro: tierOf('pro'), ultimate: tierOf('ultimate') } };
  }, [locale, freeStations, allStations]);

  // The API's answer as it came; the cards are built from it and the plan
  // lines of the current language, so a language switch never mixes them up.
  const [rawPricing, setRawPricing] = useState(null);
  const pricing = useMemo(() => normalizePricing(rawPricing, fallbackPricing), [rawPricing, fallbackPricing]);
  const [pricingError, setPricingError] = useState('');
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  // Who each plan is for, on its card: the one plan explanation of the start page (#435).
  const planFit = (planId) => (copy.premium.positioning || []).find((item) => item.key === planId);
  const freeInviteUrl = resolvePrimaryInviteUrl(bots);
  const freeInviteIsExternal = freeInviteUrl.startsWith('http');

  useEffect(() => {
    const controller = new AbortController();

    const loadPricing = async () => {
      try {
        const pricingUrl = `${buildApiUrl('/api/premium/pricing')}?lang=${encodeURIComponent(locale)}`;
        const response = await fetch(pricingUrl, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload?.error) throw new Error(payload?.error || `HTTP ${response.status}`);
        setRawPricing(payload);
        setPricingError('');
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setRawPricing(null);
        setPricingError(copy.premium.pricingFallback);
      }
    };

    loadPricing();
    return () => controller.abort();
  }, [copy.premium.pricingFallback, locale]);

  const closeCheckout = useCallback(() => setCheckoutPlan(null), []);

  return (
    <section id="premium" data-testid="premium-section" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Crown size={16} color="#ff6b00" />
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, letterSpacing: '0.15em', color: '#ff6b00', textTransform: 'uppercase', fontWeight: 700 }}>
              {copy.premium.eyebrow}
            </span>
          </div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginBottom: 12 }}>
            {copy.premium.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 560 }}>
            {copy.premium.subtitle}
          </p>
          {pricingError && <p style={{ marginTop: 10, fontSize: 12, color: '#ff6b00' }}>{pricingError}</p>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {PLAN_ORDER.map((planId) => {
            const tier = pricing.tiers[planId];
            const meta = PLAN_META[planId];
            const Icon = meta.icon;
            const isPro = planId === 'pro';
            const trialEnabled = isPro && pricing.trial?.enabled !== false;
            const fit = planFit(planId);

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
                    fontFamily: "'Syne', sans-serif",
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
                  <strong style={{ color: meta.color, fontFamily: "'Syne', sans-serif", fontSize: 16 }}>
                    {tier.name}
                  </strong>
                </div>

                {fit && (
                  <div data-testid={`plan-fit-${planId}`} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{fit.title}</div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#A1A1AA' }}>{fit.desc}</p>
                  </div>
                )}

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
                  <span style={{ fontSize: 13, color: '#8A8A93', fontWeight: 400, fontFamily: "'DM Sans', sans-serif" }}>
                    {copy.premium.perMonth}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }} data-testid={`premium-features-${planId}`}>
                  {tier.intro ? <div style={{ fontSize: 13, color: '#8A8A93', fontWeight: 600 }}>{tier.intro}</div> : null}
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
                      event.currentTarget.style.borderColor = 'rgba(0,229,255,0.35)';
                      event.currentTarget.style.background = 'rgba(0,229,255,0.08)';
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
                    {pricing.discordShop?.enabled && (
                      <a
                        data-testid={`buy-discord-${planId}`}
                        href={pricing.discordShop.storeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '12px 0',
                          marginBottom: 10,
                          borderRadius: 10,
                          background: '#5865F2',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: 14,
                          fontFamily: "'DM Sans', sans-serif",
                          textDecoration: 'none',
                        }}
                      >
                        {copy.premium.buyInDiscord({ name: tier.name })}
                        <ArrowRight size={16} />
                      </a>
                    )}
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
                      {copy.premium.redeemCta}
                    </button>
                    {!pricing.discordShop?.enabled && (
                      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#8A8A93', textAlign: 'center' }}>
                        {copy.premium.discordSoonShort}
                      </p>
                    )}
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
      </div>

      {checkoutPlan && (
        <CheckoutModal
          planId={checkoutPlan}
          tier={pricing.tiers[checkoutPlan]}
          meta={PLAN_META[checkoutPlan]}
          trialConfig={pricing.trial}
          discordShop={pricing.discordShop}
          onClose={closeCheckout}
          copy={copy}
          locale={locale}
        />
      )}
    </section>
  );
}

export default Premium;
