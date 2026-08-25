import React from 'react';
import { useI18n } from '../i18n.js';
import { useShowcaseStations } from '../lib/showcase.js';
import LivePlaybackBar from './LivePlaybackBar.js';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';
import { Volume2, Check, Plus, Sparkles } from 'lucide-react';

const STR = {
  de: {
    eyebrow: 'How-To · in unter 60 Sekunden',
    title: 'So startest du OmniFM in Discord',
    subtitle: 'Kein Browser-Player. Drei Schritte, dann läuft dein Radio 24/7 direkt im Voice-Channel.',
    steps: [
      { n: '01', cmd: 'App hinzufügen', title: 'Commander einladen', desc: 'Füge den OmniFM Commander zu deinem Server hinzu. Er nimmt alle Slash-Commands entgegen und verwaltet deine Worker.' },
      { n: '02', cmd: '/invite', title: 'Worker-Bot hinzufügen', desc: 'Lade mindestens einen Worker ein. Er übernimmt den eigentlichen Voice-Stream – mehr Worker = mehr parallele Channels.' },
      { n: '03', cmd: '/play lofi', title: 'Radio starten', desc: 'Wähle eine Station und OmniFM verbindet sich in deinen Voice-Channel. Now-Playing-Embed, Buttons und Reconnect inklusive.' },
    ],
    permsTitle: 'Berechtigungen',
    perms: ['Voice beitreten & sprechen', 'Nachrichten & Embeds senden', 'Slash-Commands nutzen'],
    addServer: 'Zum Server hinzufügen',
    workerHint: 'Worker bereit',
    invite: 'Einladen',
    connected: 'verbunden',
    nowPlaying: 'Now Playing',
  },
  en: {
    eyebrow: 'How-To · in under 60 seconds',
    title: 'How to start OmniFM in Discord',
    subtitle: 'No browser player. Three steps and your radio runs 24/7 straight in the voice channel.',
    steps: [
      { n: '01', cmd: 'Add App', title: 'Invite the commander', desc: 'Add the OmniFM commander to your server. It handles every slash command and manages your workers.' },
      { n: '02', cmd: '/invite', title: 'Add a worker bot', desc: 'Invite at least one worker. It carries the actual voice stream — more workers = more parallel channels.' },
      { n: '03', cmd: '/play lofi', title: 'Start the radio', desc: 'Pick a station and OmniFM joins your voice channel. Now-playing embed, buttons and reconnect included.' },
    ],
    permsTitle: 'Permissions',
    perms: ['Join voice & speak', 'Send messages & embeds', 'Use slash commands'],
    addServer: 'Add to server',
    workerHint: 'Worker ready',
    invite: 'Invite',
    connected: 'connected',
    nowPlaying: 'Now Playing',
  },
};

const css = `
.htd-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:26px; }
@media (max-width: 940px){ .htd-grid{ grid-template-columns:1fr; max-width:520px; margin:0 auto; } }
`;

function StepShell({ step, s, children }) {
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
      <div style={{ background: '#2b2d31', border: '1px solid #1e1f22', borderRadius: 12, padding: 14, marginTop: 'auto' }}>{children}</div>
    </div>
  );
}

export default function HowToDiscord({ bots = [] }) {
  const { locale } = useI18n();
  const s = STR[locale] || STR.de;
  const showcase = useShowcaseStations(4);
  const demoStation = showcase.length ? showcase[0].name : 'OmniFM Radio Network';
  const streamLabel = locale === 'en' ? 'Live radio stream' : 'Live-Radio-Stream';
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

        <div className="htd-grid">
          {/* Step 1 — invite commander */}
          <StepShell step={s.steps[0]} s={s}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', background: '#08090d', flexShrink: 0 }}>
                <img src="/brand/omnifm-discord-avatar.png" alt="OmniFM" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>OmniFM</div>
                <div style={{ color: '#949ba4', fontSize: 12 }}>{s.permsTitle}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
              {s.perms.map((p) => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dbdee1', fontSize: 12.5 }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, background: '#3ba55d', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Check size={11} color="#fff" /></span>{p}
                </div>
              ))}
            </div>
            <a
              href={inviteUrl}
              target={inviteUrl.startsWith('http') ? '_blank' : undefined}
              rel={inviteUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
              data-testid="howto-commander-invite"
              style={{ display: 'block', background: '#3ba55d', color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '9px 0', textDecoration: 'none' }}
            >{s.addServer}</a>
          </StepShell>

          {/* Step 2 — add worker */}
          <StepShell step={s.steps[1]} s={s}>
            <div style={{ color: '#949ba4', fontSize: 11, fontFamily: "'JetBrains Mono',monospace", marginBottom: 10 }}>/invite → {s.workerHint}</div>
            {[['OmniFM Worker 1', '#ff6b00'], ['OmniFM Worker 2', '#00e5ff'], ['OmniFM Worker 3', '#bd00ff']].map(([nm, c]) => (
              <div key={nm} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #1e1f22' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: c, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Volume2 size={13} color="#08090d" /></span>
                <span style={{ color: '#dbdee1', fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#5865f2', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '4px 9px', flexShrink: 0 }}><Plus size={11} /> {s.invite}</span>
              </div>
            ))}
          </StepShell>

          {/* Step 3 — /play */}
          <StepShell step={s.steps[2]} s={s}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#949ba4', fontSize: 12, marginBottom: 10 }}>
              <Volume2 size={14} color="#3ba55d" /> <span style={{ color: '#dbdee1', fontWeight: 600 }}>voice-radio</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', background: '#08090d', flexShrink: 0 }}>
                <img src="/brand/omnifm-discord-avatar.png" alt="OmniFM" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#00a8fc', fontSize: 13, fontWeight: 600 }}>OmniFM · {s.connected}</div>
                <div style={{ color: '#dbdee1', fontSize: 12.5 }}>{demoStation} — {streamLabel}</div>
              </div>
            </div>
            <div style={{ color: '#b5bac1', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>{s.nowPlaying}</div>
            <LivePlaybackBar live resetKey="howto" />
          </StepShell>
        </div>
      </div>
    </section>
  );
}
