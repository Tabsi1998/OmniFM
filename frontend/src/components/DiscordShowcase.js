import { useI18n } from '../i18n.js';
import LiveDemo from './demo/LiveDemo.js';

const css = `
.ds-grid > * { min-width: 0; }
@media (max-width: 820px){ .ds-grid{ grid-template-columns:1fr !important; } }
`;

// Next to the commands: the live demo of the panel (#431), the bot's real
// panel clicked through (pause, play on, a favourite).
export default function DiscordShowcase() {
  const { copy } = useI18n();
  const L = copy.discordShowcase;

  return (
    <section id="in-discord" data-testid="discord-showcase" style={{ position: 'relative', padding: '90px 24px' }}>
      <style>{css}</style>
      <div className="section-container">
        <div className="ds-grid" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 56, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(88,101,242,0.12)', border: '1px solid rgba(88,101,242,0.35)', marginBottom: 22 }}>
              <svg width="15" height="12" viewBox="0 0 71 55" fill="#5865f2"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.3 0l1 .9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.5 58.5 0 0070 45.2a.3.3 0 00.1-.2c1.6-16.4-2.6-30.6-11-43.2zM23.7 37c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7zm25.2 0c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7z" /></svg>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#aab2ff' }}>{L.eyebrow}</span>
            </div>
            <h2 style={{ fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 'clamp(28px,4vw,44px)', lineHeight: 1.08, letterSpacing: '-0.02em', marginBottom: 18 }}>
              {L.titleLead}<span style={{ background: 'linear-gradient(120deg,#ff6b00,#00e5ff)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{L.titleAccent}</span>{L.titleTail}
            </h2>
            <p style={{ color: '#94a3b8', fontSize: 17, lineHeight: 1.65, marginBottom: 26, maxWidth: 460 }}>
              {L.body}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {L.cmds.map(([cmd, desc]) => (
                <div key={cmd} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: '#ffb27a', background: 'rgba(255,107,0,0.12)', border: '1px solid rgba(255,107,0,0.28)', borderRadius: 8, padding: '6px 11px', whiteSpace: 'nowrap' }}>{cmd}</code>
                  <span style={{ color: '#94a3b8', fontSize: 14 }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <LiveDemo scene="panel" size="large" />
        </div>
      </div>
    </section>
  );
}
