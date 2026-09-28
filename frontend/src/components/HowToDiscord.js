import { useI18n } from '../i18n.js';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';
import { buildPageHref } from '../lib/pageRouting.js';
import { ArrowRight, Sparkles } from 'lucide-react';
import LiveDemo from './demo/LiveDemo.js';

const css = `
.htd-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:26px; }
@media (max-width: 940px){ .htd-grid{ grid-template-columns:1fr; max-width:520px; margin:0 auto; } }
`;

function StepShell({ step, children }) {
  return (
    <div className="oa-fade" style={{ background: 'linear-gradient(180deg,rgba(20,22,30,0.9),rgba(12,13,18,0.9))', border: '1px solid #23252e', borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 800, color: '#ff6b00' }}>{step.n}</span>
        <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, fontWeight: 700, color: '#ffb27a', background: 'rgba(255,107,0,0.12)', border: '1px solid rgba(255,107,0,0.28)', borderRadius: 8, padding: '5px 10px' }}>{step.cmd}</code>
      </div>
      <div>
        <h3 style={{ fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 20, marginBottom: 8 }}>{step.title}</h3>
        <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{step.desc}</p>
      </div>
      <div style={{ marginTop: 'auto' }}>{children}</div>
    </div>
  );
}

export default function HowToDiscord({ bots = [] }) {
  const { copy, locale } = useI18n();
  const s = copy.howTo;
  const inviteUrl = resolvePrimaryInviteUrl(bots);

  return (
    <section id="how-to" data-testid="how-to-discord" style={{ padding: '90px 24px', position: 'relative' }}>
      <style>{css}</style>
      <div className="section-container">
        <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 52px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,107,0,0.1)', border: '1px solid rgba(255,107,0,0.3)', marginBottom: 18 }}>
            <Sparkles size={14} color="#ff6b00" />
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffb27a' }}>{s.eyebrow}</span>
          </div>
          <h2 style={{ fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 'clamp(28px,4vw,42px)', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 14 }}>{s.title}</h2>
          <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.6 }}>{s.subtitle}</p>
        </div>

        {/* Each step as a live demo of what happens in Discord (#431). */}
        <div className="htd-grid">
          <StepShell step={s.steps[0]}>
            <LiveDemo scene="commander" />
            <a
              href={inviteUrl}
              target={inviteUrl.startsWith('http') ? '_blank' : undefined}
              rel={inviteUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
              data-testid="howto-commander-invite"
              style={{ display: 'block', marginTop: 12, background: '#248046', color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '9px 0', textDecoration: 'none' }}
            >{s.addServer}</a>
          </StepShell>
          <StepShell step={s.steps[1]}>
            <LiveDemo scene="worker" />
          </StepShell>
          <StepShell step={s.steps[2]}>
            <LiveDemo scene="play" />
          </StepShell>
        </div>

        {/* Every step in detail, with the panel, the dashboard and help (#434). */}
        <div style={{ textAlign: 'center', marginTop: 34 }}>
          <a
            href={buildPageHref(locale, 'start')}
            data-testid="howto-guide-link"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderRadius: 12, border: '1px solid #2a3450', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}
          >
            {s.guideLink} <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
