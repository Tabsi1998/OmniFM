// OmniFM: the page "Erste Schritte" (/start, #434). Step by step from the
// invitation to the first song, each step with its live demo (#431), then
// the dashboard and what helps when something does not work. The bot links
// here from its welcome message, /setup and /help; the start page's how-to,
// the menu and the FAQ do too.
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, LifeBuoy, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';
import { buildPageHref } from '../lib/pageRouting.js';
import LiveDemo from './demo/LiveDemo.js';

const DEMO_OF_STEP = { commander: 'commander', worker: 'worker', play: 'play', panel: 'panel' };

const css = `
.sg-step { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 40px; align-items: start; }
.sg-step > * { min-width: 0; }
@media (max-width: 900px) { .sg-step { grid-template-columns: 1fr; gap: 20px; } }
.sg-toc a { display: inline-block; padding: 6px 0; color: #A1A1AA; text-decoration: none; font-size: 13px; }
.sg-toc a:hover { color: #fff; }
`;

function Tips({ items }) {
  return (
    <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
      {items.map((tip) => (
        <li key={tip} style={{ display: 'flex', gap: 10, color: '#C4C4CC', fontSize: 14.5, lineHeight: 1.6 }}>
          <span aria-hidden="true" style={{ color: '#ff6b00', fontWeight: 800 }}>›</span>
          <span>{tip}</span>
        </li>
      ))}
    </ul>
  );
}

function HelpItem({ item, open, onToggle }) {
  return (
    <div data-testid={`start-help-${item.key}`} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, background: 'rgba(255,255,255,0.02)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '16px 18px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>{item.question}</span>
        {open ? <ChevronUp size={18} color="#ff6b00" /> : <ChevronDown size={18} color="#8A8A93" />}
      </button>
      {open ? <p style={{ margin: 0, padding: '0 18px 16px', color: '#C4C4CC', fontSize: 14.5, lineHeight: 1.7 }}>{item.answer}</p> : null}
    </div>
  );
}

export default function StartGuide({ bots = [] }) {
  const { copy, locale } = useI18n();
  const s = copy.startGuide;
  const inviteUrl = resolvePrimaryInviteUrl(bots);
  const external = inviteUrl.startsWith('http');
  const [open, setOpen] = useState(s.help[0]?.key || '');

  // The bot links to /start#help; this page's code arrives after the browser
  // looked for the anchor, so it scrolls there itself.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <section data-testid="start-guide" style={{ padding: '120px 0 80px', position: 'relative', zIndex: 1 }}>
      <style>{css}</style>
      <div className="section-container">
        <header style={{ maxWidth: 760, marginBottom: 36 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,107,0,0.1)', border: '1px solid rgba(255,107,0,0.3)', marginBottom: 16 }}>
            <Sparkles size={14} color="#ff6b00" />
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffb27a' }}>{s.eyebrow}</span>
          </div>
          <h1 style={{ fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 'clamp(30px, 5vw, 50px)', lineHeight: 1.08, letterSpacing: '-0.02em', margin: '0 0 14px' }}>{s.title}</h1>
          <p style={{ color: '#A1A1AA', fontSize: 17, lineHeight: 1.65, margin: 0 }}>{s.intro}</p>
        </header>

        <nav aria-label={s.toc} className="sg-toc" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 18px', marginBottom: 48, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {s.steps.map((step) => <a key={step.id} href={`#${step.id}`}>{step.title}</a>)}
          <a href="#help">{s.helpTitle}</a>
        </nav>

        <div style={{ display: 'grid', gap: 64 }}>
          {s.steps.map((step) => (
            <article key={step.id} id={step.id} data-testid={`start-step-${step.id}`} className="sg-step" style={{ scrollMarginTop: 90 }}>
              <div>
                <h2 style={{ fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 'clamp(22px, 3vw, 30px)', margin: '0 0 12px' }}>{step.title}</h2>
                <p style={{ color: '#C4C4CC', fontSize: 16, lineHeight: 1.7, margin: 0 }}>{step.body}</p>
                <Tips items={step.tips} />
                {step.id === 'commander' ? (
                  <a
                    href={inviteUrl}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                    data-testid="start-invite"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 18, padding: '11px 20px', borderRadius: 12, background: 'linear-gradient(135deg, #ff6b00, #ff2a5f)', color: '#08090d', fontWeight: 800, fontSize: 14, textDecoration: 'none' }}
                  >
                    {s.inviteLabel} <ArrowRight size={16} />
                  </a>
                ) : null}
                {step.id === 'dashboard' ? (
                  <a href={buildPageHref(locale, 'dashboard')} data-testid="start-dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 18, padding: '11px 20px', borderRadius: 12, border: '1px solid #2a3450', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                    {s.dashboardLink} <ArrowRight size={16} />
                  </a>
                ) : null}
              </div>
              {DEMO_OF_STEP[step.id] ? <LiveDemo scene={DEMO_OF_STEP[step.id]} size={step.id === 'panel' ? 'large' : 'small'} /> : null}
            </article>
          ))}
        </div>

        <section id="help" aria-labelledby="start-help-title" style={{ marginTop: 80, scrollMarginTop: 90, maxWidth: 860 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <LifeBuoy size={18} color="#ff6b00" />
            <h2 id="start-help-title" style={{ fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 'clamp(22px, 3vw, 30px)', margin: 0 }}>{s.helpTitle}</h2>
          </div>
          <p style={{ color: '#A1A1AA', fontSize: 15.5, margin: '0 0 20px' }}>{s.helpIntro}</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {s.help.map((item) => (
              <HelpItem key={item.key} item={item} open={open === item.key} onToggle={() => setOpen(open === item.key ? '' : item.key)} />
            ))}
          </div>
          <p style={{ color: '#A1A1AA', fontSize: 14.5, marginTop: 22 }}>
            {s.more}{' '}
            <a href="https://discord.gg/UeRkfGS43R" target="_blank" rel="noopener noreferrer" data-testid="start-community" style={{ color: '#8B93FF', fontWeight: 700 }}>{s.community}</a>
          </p>
        </section>
      </div>
    </section>
  );
}
