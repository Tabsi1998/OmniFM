import React, { useEffect, useState } from 'react';
import { ExternalLink, Star, Heart } from 'lucide-react';
import { buildApiUrl } from '../lib/api.js';
import { useI18n } from '../i18n.js';

export default function CommunitySection() {
  const { locale } = useI18n();
  const en = String(locale || 'de').startsWith('en');
  const [data, setData] = useState({ sponsors: [], botListings: [] });

  useEffect(() => {
    let alive = true;
    fetch(buildApiUrl('/api/marketing'), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive) setData({ sponsors: d.sponsors || [], botListings: d.botListings || [] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const { sponsors, botListings } = data;
  if (!sponsors.length && !botListings.length) return null;

  return (
    <section id="community" data-testid="community-section" style={{ padding: '80px 24px' }}>
      <div className="section-container" style={{ display: 'flex', flexDirection: 'column', gap: 56 }}>
        {botListings.length > 0 && (
          <div data-testid="bot-listings" style={{ textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.28)', marginBottom: 18 }}>
              <Star size={14} color="#00e5ff" />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8be9ff' }}>{en ? 'Vote & Review' : 'Voten & Bewerten'}</span>
            </div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 'clamp(24px,3.5vw,36px)', marginBottom: 12 }}>{en ? 'Find OmniFM on' : 'OmniFM findest du auf'}</h2>
            <p style={{ color: '#94a3b8', fontSize: 15, maxWidth: 520, margin: '0 auto 28px' }}>{en ? 'Support us with a vote or a review on the big Discord bot lists.' : 'Unterstütze uns mit einem Vote oder einer Bewertung auf den großen Discord-Bot-Listen.'}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14 }}>
              {botListings.map((b, i) => (
                <a
                  key={i} href={b.url} target="_blank" rel="noopener noreferrer" data-testid={`bot-listing-${i}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderRadius: 12, background: 'rgba(20,22,30,0.8)', border: '1px solid #23252e', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', transition: 'border-color 0.2s, transform 0.2s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,107,0,0.6)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#23252e'; e.currentTarget.style.transform = 'none'; }}
                >
                  {b.name} <ExternalLink size={15} color="#ff6b00" />
                </a>
              ))}
            </div>
          </div>
        )}

        {sponsors.length > 0 && (
          <div data-testid="sponsor-wall" style={{ textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,42,95,0.08)', border: '1px solid rgba(255,42,95,0.28)', marginBottom: 18 }}>
              <Heart size={14} color="#ff2a5f" />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ff8fab' }}>{en ? 'Partners' : 'Partner'}</span>
            </div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 'clamp(24px,3.5vw,36px)', marginBottom: 28 }}>{en ? 'Supported by' : 'Unterstützt von'}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 24 }}>
              {sponsors.map((s, i) => {
                const inner = s.logoUrl
                  ? <img src={s.logoUrl} alt={s.name} style={{ maxHeight: 44, maxWidth: 160, objectFit: 'contain', opacity: 0.85 }} />
                  : <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: '#cbd5e1' }}>{s.name}</span>;
                return s.url ? (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" data-testid={`sponsor-${i}`} style={{ display: 'inline-flex', alignItems: 'center', padding: '14px 22px', borderRadius: 12, background: 'rgba(20,22,30,0.6)', border: '1px solid #1b2133' }}>{inner}</a>
                ) : (
                  <div key={i} data-testid={`sponsor-${i}`} style={{ display: 'inline-flex', alignItems: 'center', padding: '14px 22px', borderRadius: 12, background: 'rgba(20,22,30,0.6)', border: '1px solid #1b2133' }}>{inner}</div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
