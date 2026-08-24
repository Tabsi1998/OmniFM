import React from 'react';
import { Activity, CalendarClock, LayoutDashboard, Shield, Webhook } from 'lucide-react';
import { useI18n } from '../i18n.js';

const CAPABILITY_META = [
  { key: 'events', icon: CalendarClock, color: '#00e5ff', tier: 'pro' },
  { key: 'permissions', icon: Shield, color: '#ff6b00', tier: 'pro' },
  { key: 'health', icon: Activity, color: '#ff6b00', tier: 'pro' },
  { key: 'automation', icon: Webhook, color: '#ff2a5f', tier: 'ultimate' },
];

function buildDashboardHref(locale) {
  const params = new URLSearchParams();
  if (locale) params.set('lang', locale);
  params.set('page', 'dashboard');
  return `/?${params.toString()}`;
}

export default function DashboardShowcase() {
  const { copy, locale } = useI18n();

  return (
    <section
      id="dashboard-showcase"
      data-testid="dashboard-showcase-section"
      style={{ padding: '0 0 80px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div
          style={{
            borderRadius: 18,
            overflow: 'hidden',
            border: '1px solid rgba(0,229,255,0.14)',
            background: 'linear-gradient(180deg, rgba(0,229,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
          }}
        >
          <div style={{ padding: '28px 28px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <LayoutDashboard size={18} color="#00e5ff" />
              <span
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: '#00e5ff',
                }}
              >
                {copy.dashboardShowcase.eyebrow}
              </span>
            </div>
            <h2
              data-testid="dashboard-showcase-title"
              style={{
                fontFamily: "'Syne', sans-serif",
                fontWeight: 800,
                fontSize: 'clamp(24px, 4vw, 40px)',
                marginBottom: 12,
              }}
            >
              {copy.dashboardShowcase.title}
            </h2>
            <p style={{ color: '#D4D4D8', fontSize: 16, maxWidth: 760, lineHeight: 1.7, marginBottom: 12 }}>
              {copy.dashboardShowcase.subtitle}
            </p>
            <div style={{ fontSize: 12, color: '#71717A', lineHeight: 1.7 }}>
              {copy.dashboardShowcase.ctaNote}
            </div>
          </div>

          <div style={{ padding: '0 28px 28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginBottom: 22 }} className="dashboard-showcase-cards">
              {CAPABILITY_META.map((card) => {
                const Icon = card.icon;
                const content = copy.dashboardShowcase.cards[card.key];
                return (
                  <div
                    key={card.key}
                    data-testid={`dashboard-showcase-card-${card.key}`}
                    style={{
                      padding: '18px 18px 16px',
                      background: 'rgba(5,5,5,0.34)',
                      border: `1px solid ${card.color}20`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <Icon size={17} color={card.color} />
                      <span style={{ fontSize: 10, color: card.color, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                        {card.tier}
                      </span>
                    </div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                      {content.title}
                    </div>
                    <div style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.65 }}>
                      {content.desc}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <a
                href={buildDashboardHref(locale)}
                data-testid="dashboard-showcase-primary-cta"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '13px 22px',
                  background: '#00e5ff',
                  color: '#050505',
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                {copy.dashboardShowcase.primaryCta}
              </a>
              <a
                href="#premium"
                data-testid="dashboard-showcase-secondary-cta"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '13px 22px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#fff',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                {copy.dashboardShowcase.secondaryCta}
              </a>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .dashboard-showcase-cards {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
