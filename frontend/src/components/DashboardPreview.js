// OmniFM: the start page's look at the dashboard (#432), where "Dashboard und
// Betrieb" was until #421: a tour through the real dashboard with example
// data, and the way to try it yourself without signing in.
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildPageHref } from '../lib/pageRouting.js';
import DashboardTour from './DashboardTour.js';

export default function DashboardPreview() {
  const { copy, locale } = useI18n();
  const s = copy.dashboardPreview;
  const labels = { ...s, pause: copy.demos.pause, play: copy.demos.play };

  return (
    <section id="dashboard-demo" data-testid="dashboard-preview" style={{ padding: '90px 24px', position: 'relative' }}>
      <div className="section-container">
        <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,107,0,0.1)', border: '1px solid rgba(255,107,0,0.3)', marginBottom: 18 }}>
            <LayoutDashboard size={14} color="#ff6b00" />
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffb27a' }}>{s.eyebrow}</span>
          </div>
          <h2 style={{ fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 'clamp(28px,4vw,42px)', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 14 }}>{s.title}</h2>
          <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.6 }}>{s.subtitle}</p>
        </div>
        <DashboardTour locale={locale} labels={labels} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginTop: 28 }}>
          <a
            href={buildPageHref(locale, 'dashboard', { demo: '1' })}
            data-testid="dashboard-preview-try"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 12, background: 'linear-gradient(135deg, #ff6b00, #ff2a5f)', color: '#08090d', fontWeight: 800, fontSize: 14.5, textDecoration: 'none' }}
          >
            {s.tryIt} <ArrowRight size={16} />
          </a>
          <span style={{ color: '#8A8A93', fontSize: 13.5 }}>{s.tryNote}</span>
        </div>
      </div>
    </section>
  );
}
