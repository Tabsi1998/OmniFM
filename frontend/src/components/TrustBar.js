import { Bot, Headphones, Radio, Server } from 'lucide-react';
import { useI18n } from '../i18n.js';

// The network's numbers, the only place on the start page that shows them
// (#435). Live: App.js reloads /api/stats every 15 seconds.
const ITEMS = [
  { key: 'servers', icon: Server, color: '#ff6b00' },
  { key: 'stations', icon: Radio, color: '#00e5ff' },
  { key: 'bots', icon: Bot, color: '#10b981' },
  { key: 'listeners', icon: Headphones, color: '#ff4d7a' },
];

export default function TrustBar({ stats }) {
  const { copy, formatNumber } = useI18n();
  // Until the first answer a dash, not a misleading 0.
  const loaded = Boolean(stats) && Object.keys(stats).length > 0;

  return (
    <section
      data-testid="trust-bar"
      aria-label={copy.trustBar.live}
      style={{ position: 'relative', zIndex: 2, padding: '0 0 48px' }}
    >
      <div className="section-container">
        <div
          className="trust-bar-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const text = copy.trustBar.items[item.key];
            const value = Number(stats?.[item.key] ?? 0);
            return (
              <div key={item.key} data-testid={`trust-bar-${item.key}`} className="trust-bar-cell" style={{ padding: '20px 18px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Icon size={15} color={item.color} aria-hidden="true" />
                  <span style={{ fontSize: 11, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800 }}>
                    {text.label}
                  </span>
                </div>
                <div
                  data-testid={`trust-bar-value-${item.key}`}
                  style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 800, color: item.color, lineHeight: 1.1 }}
                >
                  {loaded && Number.isFinite(value) ? formatNumber(value) : '–'}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: '#8A8A93', lineHeight: 1.5 }}>
                  {text.detail}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#8A8A93', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2a5f' }} />
          {copy.trustBar.live}
        </div>
      </div>

      <style>{`
        .trust-bar-cell + .trust-bar-cell { border-left: 1px solid rgba(255,255,255,0.08); }
        @media (max-width: 720px) {
          .trust-bar-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .trust-bar-cell { padding: 14px 12px !important; }
          .trust-bar-cell:nth-child(3) { border-left: none; }
          .trust-bar-cell:nth-child(n+3) { border-top: 1px solid rgba(255,255,255,0.08); }
        }
      `}</style>
    </section>
  );
}
