import React from 'react';
import { AudioLines, Gauge, LayoutDashboard, Users } from 'lucide-react';
import { useI18n } from '../i18n.js';

const CARD_META = [
  { key: 'radio', icon: AudioLines, color: '#00e5ff' },
  { key: 'workers', icon: Users, color: '#ff6b00' },
  { key: 'control', icon: LayoutDashboard, color: '#ff6b00' },
  { key: 'growth', icon: Gauge, color: '#ff2a5f' },
];

export default function WhyOmniFM() {
  const { copy } = useI18n();

  return (
    <section
      id="why-omnifm"
      data-testid="why-omnifm-section"
      style={{ padding: '24px 0 72px', position: 'relative', zIndex: 1 }}
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
              color: '#ff6b00',
            }}
          >
            {copy.whyOmniFM.eyebrow}
          </span>
          <h2
            data-testid="why-omnifm-title"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            {copy.whyOmniFM.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 760, lineHeight: 1.75 }}>
            {copy.whyOmniFM.subtitle}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 22 }} className="why-omnifm-grid">
          {CARD_META.map((card) => {
            const Icon = card.icon;
            const item = copy.whyOmniFM.cards[card.key];
            return (
              <div
                key={card.key}
                data-testid={`why-omnifm-card-${card.key}`}
                style={{
                  paddingTop: 18,
                  borderTop: `2px solid ${card.color}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <Icon size={18} color={card.color} />
                  <span style={{ fontSize: 10, color: card.color, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800 }}>
                    {card.key}
                  </span>
                </div>
                <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                  {item.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: '#A1A1AA', lineHeight: 1.7 }}>
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .why-omnifm-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
