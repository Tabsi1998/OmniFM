import React from 'react';
import { Layers3, LayoutDashboard, Radio, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n.js';

const ITEMS = [
  { key: 'stations', icon: Radio, color: '#00e5ff' },
  { key: 'network', icon: Layers3, color: '#ff6b00' },
  { key: 'dashboard', icon: LayoutDashboard, color: '#ff6b00' },
  { key: 'reliability', icon: ShieldCheck, color: '#ff2a5f' },
];

function resolveValue(itemKey, stats, copy, formatNumber) {
  if (itemKey === 'stations') return formatNumber(stats?.stations || 0);
  if (itemKey === 'network') return formatNumber(stats?.connections || 0);
  if (itemKey === 'dashboard') return copy.trustBar.values.dashboard;
  if (itemKey === 'reliability') return copy.trustBar.values.reliability;
  return '-';
}

function resolveSupport(itemKey, stats, copy, formatNumber) {
  if (itemKey === 'stations') {
    return copy.trustBar.support.stations({
      free: formatNumber(stats?.freeStations || 0),
      pro: formatNumber(stats?.proStations || 0),
    });
  }
  if (itemKey === 'network') {
    const configuredBots = Number(stats?.configuredBots ?? stats?.bots ?? 0) || 0;
    const readyBots = Number(stats?.readyBots ?? stats?.bots ?? 0) || 0;
    if (configuredBots > 0 && readyBots === 0) {
      return `${formatNumber(configuredBots)} ${copy.hero.stats.bots} · ${copy.trustBar.networkOffline}`;
    }
    return copy.trustBar.support.network({
      bots: formatNumber(readyBots),
      servers: formatNumber(stats?.servers || 0),
    });
  }
  if (itemKey === 'dashboard') return copy.trustBar.support.dashboard;
  if (itemKey === 'reliability') return copy.trustBar.support.reliability;
  return '';
}

export default function TrustBar({ stats }) {
  const { copy, formatNumber } = useI18n();

  return (
    <section
      data-testid="trust-bar"
      style={{
        position: 'relative',
        zIndex: 2,
        padding: '0 0 48px',
      }}
    >
      <div className="section-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 0,
            padding: '18px 0',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
          className="trust-bar-grid"
        >
          {ITEMS.map((item, index) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                data-testid={`trust-bar-card-${item.key}`}
                style={{
                  padding: '18px 18px 16px',
                  borderRight: index < ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <Icon size={16} color={item.color} />
                  <span
                    style={{
                      fontSize: 10,
                      color: item.color,
                      textTransform: 'uppercase',
                      letterSpacing: '0.14em',
                      fontWeight: 800,
                    }}
                  >
                    {copy.trustBar.items[item.key].label}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 24,
                    fontWeight: 800,
                    color: '#fff',
                    marginBottom: 6,
                  }}
                >
                  {resolveValue(item.key, stats, copy, formatNumber)}
                </div>
                <div style={{ fontSize: 11, color: '#71717A', fontWeight: 700, marginBottom: 8 }}>
                  {resolveSupport(item.key, stats, copy, formatNumber)}
                </div>
                <p style={{ margin: 0, fontSize: 13, color: '#A1A1AA', lineHeight: 1.6 }}>
                  {item.key === 'network' && Number(stats?.configuredBots ?? stats?.bots ?? 0) > 0 && Number(stats?.readyBots ?? stats?.bots ?? 0) === 0
                    ? copy.trustBar.networkOfflineDetail
                    : copy.trustBar.items[item.key].detail}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .trust-bar-grid {
            grid-template-columns: 1fr !important;
          }

          .trust-bar-grid > div {
            border-right: none !important;
          }
        }
      `}</style>
    </section>
  );
}
