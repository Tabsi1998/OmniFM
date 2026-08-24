import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '../i18n.js';

export default function FaqSection() {
  const { copy } = useI18n();
  const [openKey, setOpenKey] = useState('start');
  const items = copy.faq.items;

  return (
    <section
      id="faq"
      data-testid="faq-section"
      style={{ padding: '30px 0 90px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container" style={{ maxWidth: 980 }}>
        <div style={{ marginBottom: 28 }}>
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
            {copy.faq.eyebrow}
          </span>
          <h2
            data-testid="faq-title"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            {copy.faq.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 720, lineHeight: 1.7 }}>
            {copy.faq.subtitle}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => {
            const isOpen = openKey === item.key;
            return (
              <div
                key={item.key}
                data-testid={`faq-item-${item.key}`}
                style={{
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isOpen ? 'rgba(255,107,0,0.28)' : 'rgba(255,255,255,0.06)'}`,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpenKey(isOpen ? '' : item.key)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    background: 'transparent',
                    border: 'none',
                    color: '#fff',
                    padding: '18px 20px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{item.question}</span>
                  {isOpen ? <ChevronUp size={18} color="#ff6b00" /> : <ChevronDown size={18} color="#71717A" />}
                </button>
                {isOpen && (
                  <div style={{ padding: '0 20px 18px', color: '#A1A1AA', fontSize: 14, lineHeight: 1.7 }}>
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
