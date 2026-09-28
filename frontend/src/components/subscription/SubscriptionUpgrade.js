// OmniFM: server dashboard subscription: what an upgrade to Ultimate would bring.
// Split out of components/DashboardSubscription.js (#296); its state stays there.
import { Crown } from 'lucide-react';
import { formatSubscriptionPriceCents } from '../../lib/dashboardSubscription.js';
import { FeatureRow } from './subscriptionShared.js';

export default function SubscriptionUpgrade({
  canManagePaidPlan,
  localeMeta,
  openCheckout,
  t,
  upgradeSummary,
}) {
  return (
    <div
      data-testid="subscription-upgrade-summary-card"
      style={{
        background: '#0A0A0A',
        border: '1px solid rgba(139,92,246,0.25)',
        padding: 16,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, color: '#D4D4D8' }}>
            {upgradeSummary.title}
          </h4>
          <div style={{ marginTop: 6, color: '#A1A1AA', fontSize: 13, lineHeight: 1.6 }}>
            {upgradeSummary.description}
          </div>
        </div>
        <Crown size={20} color="#C4B5FD" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('Ab', 'From')}
          </div>
          <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: '#F4F4F5' }}>
            {formatSubscriptionPriceCents(upgradeSummary.pricing.monthlyCents, localeMeta.intl)}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
            {t('pro Monat', 'per month')}
          </div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('12 Monate', '12 months')}
          </div>
          <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: '#F4F4F5' }}>
            {formatSubscriptionPriceCents(upgradeSummary.pricing.yearlyCents, localeMeta.intl)}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
            {t('bei direkter Verlaengerung', 'for direct renewal')}
          </div>
        </div>

        {upgradeSummary.upgradeCostCents > 0 ? (
          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
            <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('Upgrade heute', 'Upgrade today')}
            </div>
            <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: '#F4F4F5' }}>
              {formatSubscriptionPriceCents(upgradeSummary.upgradeCostCents, localeMeta.intl)}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
              {t(
                `bei ${upgradeSummary.daysLeft} Tagen Restlaufzeit`,
                `with ${upgradeSummary.daysLeft} days remaining`
              )}
            </div>
          </div>
        ) : null}
      </div>

      {upgradeSummary.highlights.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {upgradeSummary.highlights.map((feature) => (
            <FeatureRow key={`upgrade-${feature}`} label={feature} />
          ))}
        </div>
      ) : null}

      {canManagePaidPlan ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            data-testid="subscription-recommended-upgrade-btn"
            onClick={openCheckout}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid #8B5CF6',
              background: 'rgba(139,92,246,0.12)',
              color: '#fff',
              padding: '10px 16px',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            <Crown size={15} /> {t('Upgrade jetzt prüfen', 'Review upgrade now')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
