import React from 'react';
import { Heart, Radio } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildPageHref } from '../lib/pageRouting.js';

function StatsFooter({ stats, legal }) {
  const { copy, locale, formatNumber } = useI18n();
  const operatorName = String(legal?.legal?.providerName || '').trim();

  const footerStats = [
    { label: copy.footer.stats.servers, value: stats.servers || 0, color: '#00F0FF' },
    { label: copy.footer.stats.connections, value: stats.connections || 0, color: '#39FF14' },
    { label: copy.footer.stats.listeners, value: stats.listeners || 0, color: '#FFB800' },
    { label: copy.footer.stats.stations, value: stats.stations || 0, color: '#BD00FF' },
  ];

  return (
    <footer
      data-testid="stats-footer"
      style={{
        padding: '56px 0 28px',
        position: 'relative',
        zIndex: 0,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="section-container">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 32,
            flexWrap: 'wrap',
            padding: '22px 0',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            marginBottom: 18,
          }}
        >
          {footerStats.map((item) => (
            <div key={item.label} style={{ minWidth: 120 }}>
              <div
                data-testid={`stat-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 24,
                  fontWeight: 700,
                  color: item.color,
                }}
              >
                {formatNumber(item.value)}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: '#71717A', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            paddingTop: 6,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Radio size={16} color="#00F0FF" />
              <span
                style={{
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                }}
              >
                OMNI<span style={{ color: '#00F0FF' }}>FM</span>
              </span>
            </div>
            <p style={{ margin: 0, color: '#71717A', fontSize: 13, lineHeight: 1.7, maxWidth: 560 }}>
              {copy.footer.liveNote}
            </p>
            {operatorName && (
              <p data-testid="footer-operator" style={{ margin: '6px 0 0', color: '#52525B', fontSize: 12, lineHeight: 1.6 }}>
                {copy.footer.operatedBy({ operator: operatorName })}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <a href={buildPageHref(locale, 'imprint')} data-testid="footer-impressum" style={{ color: '#71717A', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {copy.footer.links.imprint}
            </a>
            <a href={buildPageHref(locale, 'privacy')} data-testid="footer-privacy" style={{ color: '#71717A', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {copy.footer.links.privacy}
            </a>
            <a href={buildPageHref(locale, 'terms')} data-testid="footer-terms" style={{ color: '#71717A', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {copy.footer.links.terms}
            </a>
            <a href="https://discord.gg/UeRkfGS43R" target="_blank" rel="noopener noreferrer" data-testid="footer-discord" style={{ color: '#5865F2', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {copy.footer.discord}
            </a>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#52525B' }}>
            {copy.footer.builtWith} <Heart size={12} color="#FF2A2A" /> {copy.footer.forDiscord}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default StatsFooter;
