import React, { useState } from 'react';
import { Download, Copy, Check, ArrowLeft, Palette, Type, Radio, ExternalLink } from 'lucide-react';
import { BRAND_ASSETS, BRAND_PALETTE, BRAND_FONTS, sponsorEmbedHtml, sponsorEmbedMarkdown, siteOrigin } from '../lib/brandAssets.js';

const bgFor = (bg) => bg === 'light' ? '#f3f4f8' : bg === 'discord' ? '#313338' : 'linear-gradient(135deg,#0e111a,#08090d)';

function CopyBtn({ text, testid }) {
  const [done, setDone] = useState(false);
  const doCopy = async () => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { ok = false; }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) { setDone(true); setTimeout(() => setDone(false), 1600); }
  };
  return (
    <button className="oa-btn ghost" style={{ height: 38 }} data-testid={testid} onClick={doCopy}>
      {done ? <Check size={15} color="#4ade80" /> : <Copy size={15} />} {done ? 'Kopiert' : 'Kopieren'}
    </button>
  );
}

export default function BrandKit({ embedded = false }) {
  const origin = siteOrigin();
  const html = sponsorEmbedHtml(origin);
  const md = sponsorEmbedMarkdown(origin);

  const Wrapper = embedded ? React.Fragment : 'div';
  const wrapperProps = embedded ? {} : { className: 'oa-root', style: { display: 'block', minHeight: '100vh' }, 'data-testid': 'brand-kit-page' };

  return (
    <Wrapper {...wrapperProps}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: embedded ? 0 : '90px 24px 80px' }} data-testid="brand-kit">
        {!embedded && (
          <>
            <div style={{ marginBottom: 18 }}>
              <a href="/" className="oa-mono" style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 6 }} data-testid="brand-back-home"><ArrowLeft size={14} /> Zurück zur Website</a>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.28)', marginBottom: 20 }}>
              <Radio size={14} color="#ff6b00" />
              <span className="oa-mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ffb27a' }}>Presse &amp; Brand Kit</span>
            </div>
            <h1 className="oa-display" style={{ fontSize: 'clamp(32px,5vw,52px)', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 14 }}>OmniFM Marken-Kit</h1>
            <p style={{ color: '#94a3b8', fontSize: 17, maxWidth: 620, lineHeight: 1.6, marginBottom: 40 }}>
              Alle Logos, Farben und der fertige Sponsor-Badge zum Herunterladen und Einbetten. Frei nutzbar zur Verlinkung von OmniFM.
            </p>
          </>
        )}

        {/* Logos */}
        <div className="oa-section-title" style={{ marginTop: embedded ? 0 : 8 }}><Download size={15} /> Logos &amp; Assets</div>
        <div className="oa-grid cols-3" data-testid="brand-catalog">
          {BRAND_ASSETS.map((a) => (
            <div className="oa-card hoverable" key={a.slug} data-testid={`brand-asset-${a.slug}`}>
              <div style={{ height: 150, borderRadius: 12, background: bgFor(a.bg), display: 'grid', placeItems: 'center', overflow: 'hidden', marginBottom: 14, border: '1px solid #1b2133' }}>
                <img src={a.file} alt={a.label} style={{ maxWidth: '82%', maxHeight: '82%', objectFit: 'contain' }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{a.label}</div>
              <div style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 6px', lineHeight: 1.45 }}>{a.desc}</div>
              <div className="oa-mono" style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>{a.use}</div>
              <a className="oa-btn primary" style={{ width: '100%', height: 40, textDecoration: 'none' }} href={a.file} download data-testid={`brand-download-${a.slug}`}>
                <Download size={15} /> Download
              </a>
            </div>
          ))}
        </div>

        {/* Sponsor badge embed */}
        <div className="oa-section-title"><Radio size={15} /> Sponsor-Badge einbetten</div>
        <div className="oa-grid cols-2">
          <div className="oa-card" data-testid="brand-badge-preview">
            <div style={{ height: 120, borderRadius: 12, background: 'linear-gradient(135deg,#0e111a,#08090d)', display: 'grid', placeItems: 'center', border: '1px solid #1b2133', marginBottom: 14 }}>
              <img src="/brand/omnifm-sponsor-badge.jpg" alt="Powered by OmniFM" style={{ maxWidth: '70%', maxHeight: '64%', objectFit: 'contain' }} />
            </div>
            <p style={{ color: '#94a3b8', fontSize: 13.5, lineHeight: 1.5 }}>So sieht der Badge aus, wenn du ihn auf deiner Seite oder in deinem Discord-Server als Sponsor einbindest.</p>
          </div>
          <div className="oa-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="oa-stat-label">HTML-Einbettung</div>
              <CopyBtn text={html} testid="brand-copy-html" />
            </div>
            <pre className="oa-mono" style={{ background: '#0a0c12', border: '1px solid #1b2133', borderRadius: 10, padding: 12, fontSize: 11.5, color: '#cbd5e1', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} data-testid="brand-html-snippet">{html}</pre>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px' }}>
              <div className="oa-stat-label">Markdown (README)</div>
              <CopyBtn text={md} testid="brand-copy-md" />
            </div>
            <pre className="oa-mono" style={{ background: '#0a0c12', border: '1px solid #1b2133', borderRadius: 10, padding: 12, fontSize: 11.5, color: '#cbd5e1', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} data-testid="brand-md-snippet">{md}</pre>
          </div>
        </div>

        {/* Palette + fonts */}
        <div className="oa-grid cols-2">
          <div>
            <div className="oa-section-title"><Palette size={15} /> Farbpalette</div>
            <div className="oa-card">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 12 }}>
                {BRAND_PALETTE.map((c) => (
                  <div key={c.hex} data-testid={`brand-color-${c.hex.replace('#','')}`}>
                    <div style={{ height: 54, borderRadius: 10, background: c.hex, border: '1px solid rgba(255,255,255,0.08)' }} />
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 7 }}>{c.name}</div>
                    <div className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{c.hex}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div>
            <div className="oa-section-title"><Type size={15} /> Typografie</div>
            <div className="oa-card">
              {BRAND_FONTS.map((f) => (
                <div key={f.name} className="oa-integration">
                  <span><span style={{ fontFamily: f.name === 'Syne' ? "'Syne'" : f.name === 'DM Sans' ? "'DM Sans'" : "'JetBrains Mono'", fontSize: 18, fontWeight: 700 }}>{f.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>{f.role}</span></span>
                  <span className="oa-pill slate">{f.weight}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {embedded && (
          <a href="/brand" target="_blank" rel="noopener" className="oa-btn ghost" style={{ marginTop: 20 }} data-testid="brand-open-public"><ExternalLink size={15} /> Öffentliche Brand-Seite öffnen</a>
        )}
      </div>
    </Wrapper>
  );
}
