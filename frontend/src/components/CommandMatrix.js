import React from 'react';
import { useI18n } from '../i18n.js';

export default function CommandMatrix() {
  const { copy } = useI18n();
  const matrix = copy.commandMatrix;

  return (
    <section
      data-testid="command-matrix-section"
      style={{
        position: 'relative',
        zIndex: 2,
        padding: '30px 24px 90px',
      }}
    >
      <div className="section-container" style={{ maxWidth: 1200 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#A1A1AA', textTransform: 'uppercase' }}>{matrix.eyebrow}</div>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 'clamp(1.6rem, 4vw, 2.6rem)', marginTop: 8 }}>
            {matrix.title}
          </h3>
        </div>

        <div
          data-testid="command-matrix-grid"
          style={{
            border: '1px solid #27272A',
            background: '#0A0A0A',
            overflowX: 'auto',
          }}
        >
          <div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '220px repeat(3, 1fr)', borderBottom: '1px solid #27272A' }}>
              <div style={{ padding: 14, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11 }}>{matrix.commandHeader}</div>
              <div style={{ padding: 14, fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{matrix.tiers.free}</div>
              <div style={{ padding: 14, fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{matrix.tiers.pro}</div>
              <div style={{ padding: 14, fontFamily: "'Outfit', sans-serif", fontSize: 20, color: '#8B5CF6' }}>{matrix.tiers.ultimate}</div>
            </div>

            {matrix.rows.map((row) => (
              <div key={row.command} data-testid={`command-matrix-row-${row.command.replace('/', '')}`} style={{ display: 'grid', gridTemplateColumns: '220px repeat(3, 1fr)', borderBottom: '1px solid #27272A' }}>
                <div style={{ padding: 14, fontFamily: "'JetBrains Mono', monospace", color: '#00e5ff' }}>{row.command}</div>
                <div style={{ padding: 14, color: '#A1A1AA' }}>{row.free}</div>
                <div style={{ padding: 14, color: '#E4E4E7' }}>{row.pro}</div>
                <div style={{ padding: 14, color: '#DDD6FE' }}>{row.ultimate}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
