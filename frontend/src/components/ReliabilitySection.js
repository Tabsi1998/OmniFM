import React from 'react';
import { Activity, RadioTower, ShieldCheck, Split } from 'lucide-react';
import { useI18n } from '../i18n.js';

const CARD_META = [
  { key: 'uptime', icon: RadioTower, color: '#00e5ff' },
  { key: 'workers', icon: Split, color: '#ff6b00' },
  { key: 'reconnect', icon: ShieldCheck, color: '#ff6b00' },
  { key: 'visibility', icon: Activity, color: '#ff2a5f' },
];

export default function ReliabilitySection() {
  const { copy } = useI18n();

  return (
    <section
      id="reliability"
      data-testid="reliability-section"
      style={{ padding: '0 0 40px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div style={{ marginBottom: 36 }}>
          <span
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#ff2a5f',
            }}
          >
            {copy.reliability.eyebrow}
          </span>
          <h2
            data-testid="reliability-title"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            {copy.reliability.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 760, lineHeight: 1.7 }}>
            {copy.reliability.subtitle}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 18 }}>
          {CARD_META.map((card) => {
            const Icon = card.icon;
            const content = copy.reliability.cards[card.key];
            return (
              <div
                key={card.key}
                data-testid={`reliability-card-${card.key}`}
                className="ui-lift"
                style={{
                  padding: 22,
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${card.color}18`,
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${card.color}12`,
                    border: `1px solid ${card.color}28`,
                    marginBottom: 14,
                  }}
                >
                  <Icon size={18} color={card.color} />
                </div>
                <h3
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 14,
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  {content.title}
                </h3>
                <p style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.65 }}>
                  {content.desc}
                </p>
              </div>
            );
          })}
        </div>

        <div
          data-testid="reliability-proof-bar"
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%)',
          }}
        >
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#71717A', marginBottom: 6 }}>
            {copy.reliability.proofLabel}
          </div>
          <p style={{ color: '#D4D4D8', fontSize: 14, lineHeight: 1.65 }}>
            {copy.reliability.proofBody}
          </p>
        </div>
      </div>
    </section>
  );
}
