import React from 'react';
import { Crown, Shield, Zap } from 'lucide-react';
import { useI18n } from '../i18n.js';

const CARD_META = [
  { key: 'free', icon: Shield, color: '#A1A1AA' },
  { key: 'pro', icon: Zap, color: '#ff6b00' },
  { key: 'ultimate', icon: Crown, color: '#ff2a5f' },
];

export default function UseCasesSection() {
  const { copy } = useI18n();

  return (
    <section
      id="use-cases"
      data-testid="use-cases-section"
      style={{ padding: '0 0 72px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div style={{ marginBottom: 34 }}>
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
            {copy.useCases.eyebrow}
          </span>
          <h2
            data-testid="use-cases-title"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            {copy.useCases.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 760, lineHeight: 1.7 }}>
            {copy.useCases.subtitle}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {CARD_META.map((card) => {
            const Icon = card.icon;
            const content = copy.useCases.cards[card.key];
            return (
              <div
                key={card.key}
                data-testid={`use-case-card-${card.key}`}
                className="ui-lift"
                style={{
                  padding: 24,
                  borderRadius: 18,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${card.color}22`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `${card.color}12`,
                      border: `1px solid ${card.color}28`,
                    }}
                  >
                    <Icon size={18} color={card.color} />
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: card.color,
                    }}
                  >
                    {card.key}
                  </span>
                </div>
                <h3
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 15,
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  {content.title}
                </h3>
                <p style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.65, marginBottom: 14 }}>
                  {content.desc}
                </p>
                <div style={{ fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
                  {content.fit}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
