import React, { useEffect, useState } from 'react';
import { Hash, Play, Pause, SkipForward, Square, Heart, ListMusic, Radio } from 'lucide-react';
import { buildApiUrl } from '../lib/api.js';
import { useI18n } from '../i18n.js';
import { useShowcaseStations } from '../lib/showcase.js';
import LivePlaybackBar from './LivePlaybackBar.js';

const STR = {
  de: {
    eyebrow: 'Direkt in Discord',
    titleLead: 'Läuft im ',
    titleAccent: 'Voice-Channel',
    titleTail: ', gesteuert per Slash-Command.',
    body: 'Kein Browser-Player, kein Abspielen auf der Website. OmniFM streamt 24/7 direkt in deinen Discord-Voice-Channel – mit sauberen Now-Playing-Embeds, Buttons und Reconnect.',
    cmds: [
      ['/play synthwave', 'Startet den Stream im Voice-Channel'],
      ['/now', 'Zeigt Live-Titel, Cover & Hörer'],
      ['/stations', 'Durchsuche 120+ kuratierte Sender'],
    ],
    nowPlaying: 'Now Playing', genre: 'Genre', bitrate: 'Bitrate', listeners: 'Hörer',
    liveStream: 'Live-Radio-Stream', liveRadio: 'Live-Radio',
    time: 'heute um 21:14',
  },
  en: {
    eyebrow: 'Right in Discord',
    titleLead: 'Runs in your ',
    titleAccent: 'voice channel',
    titleTail: ', controlled by slash commands.',
    body: 'No browser player, no playback on the website. OmniFM streams 24/7 straight into your Discord voice channel — with clean now-playing embeds, buttons and reconnect.',
    cmds: [
      ['/play synthwave', 'Starts the stream in your voice channel'],
      ['/now', 'Shows the live track, cover & listeners'],
      ['/stations', 'Browse 120+ curated stations'],
    ],
    nowPlaying: 'Now Playing', genre: 'Genre', bitrate: 'Bitrate', listeners: 'Listeners',
    liveStream: 'Live radio stream', liveRadio: 'Live radio',
    time: 'today at 21:14',
  },
};

const STATIONS_FALLBACK = { name: 'OmniFM Radio Network', tier: 'free', bitrate: 'Live' };

const css = `
@keyframes ds-eq { 0%,100%{transform:scaleY(0.3);} 50%{transform:scaleY(1);} }
.ds-grid > * { min-width: 0; }
@media (max-width: 820px){ .ds-grid{ grid-template-columns:1fr !important; } }
`;

function EqMini({ color = '#ff6b00' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 14 }} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => <span key={i} style={{ width: 2.5, height: `${40 + i * 15}%`, background: color, borderRadius: 2, transformOrigin: 'bottom', animation: `ds-eq ${0.7 + i * 0.13}s ease-in-out ${i * 0.1}s infinite` }} />)}
    </span>
  );
}

function DiscordButton({ icon: Icon, label, primary }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 6,
      background: primary ? '#5865f2' : '#3a3d44', color: '#fff', fontSize: 13, fontWeight: 600,
    }}>
      <Icon size={14} /> {label}
    </span>
  );
}

export default function DiscordShowcase() {
  const { locale } = useI18n();
  const L = STR[locale] || STR.de;
  const [i, setI] = useState(0);
  const [cover, setCover] = useState(null);
  const stations = useShowcaseStations(8);
  useEffect(() => { if (stations.length < 2) return undefined; const t = setInterval(() => setI((v) => (v + 1) % stations.length), 4000); return () => clearInterval(t); }, [stations.length]);
  const s = stations.length ? stations[i % stations.length] : STATIONS_FALLBACK;
  const tierLabel = s.tier ? s.tier.charAt(0).toUpperCase() + s.tier.slice(1) : 'Live';
  useEffect(() => {
    let stop = false;
    setCover(null);
    fetch(buildApiUrl(`/api/cover?term=${encodeURIComponent(s.name)}`))
      .then((r) => r.json()).then((d) => { if (!stop && d && d.ok && d.artwork) setCover(d.artwork); })
      .catch(() => {});
    return () => { stop = true; };
  }, [s.name]);

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

          {/* Discord message mock */}
          <div data-testid="discord-embed-mock" style={{ background: '#313338', borderRadius: 14, padding: '18px 18px 20px', boxShadow: '0 30px 80px rgba(0,0,0,0.5)', border: '1px solid #23252a' }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: '#08090d' }}>
                <img src="/brand/omnifm-discord-avatar.png" alt="OmniFM" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>OmniFM</span>
                  <span style={{ background: '#5865f2', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, letterSpacing: '0.02em' }}>APP</span>
                  <span style={{ color: '#949ba4', fontSize: 12 }}>{L.time}</span>
                </div>

                {/* Embed */}
                <div style={{ display: 'flex', background: '#2b2d31', borderRadius: 6, overflow: 'hidden', maxWidth: 440 }}>
                  <div style={{ width: 4, background: '#ff6b00', flexShrink: 0 }} />
                  <div style={{ padding: '13px 15px', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#f2f3f5', fontWeight: 700, fontSize: 15 }}>
                          <EqMini /> {L.nowPlaying}
                        </div>
                        <div key={s.name} style={{ color: '#00a8fc', fontWeight: 600, fontSize: 15, marginTop: 6 }}>{s.name}</div>
                        <div style={{ color: '#dbdee1', fontSize: 13.5, marginTop: 3 }}>{L.liveStream}</div>
                        <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap' }}>
                          <div><div style={{ color: '#b5bac1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{L.genre}</div><div style={{ color: '#dbdee1', fontSize: 13, marginTop: 2 }}>{L.liveRadio}</div></div>
                          <div><div style={{ color: '#b5bac1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{L.bitrate}</div><div style={{ color: '#dbdee1', fontSize: 13, marginTop: 2 }}>{s.bitrate}</div></div>
                          <div><div style={{ color: '#b5bac1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Tier</div><div style={{ color: '#dbdee1', fontSize: 13, marginTop: 2 }}>{tierLabel}</div></div>
                        </div>
                      </div>
                      <div style={{ width: 68, height: 68, borderRadius: 8, flexShrink: 0, overflow: 'hidden', background: 'linear-gradient(135deg,#ff6b00,#7a1030)', display: 'grid', placeItems: 'center' }}>
                        {cover ? <img src={cover} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ListMusic size={26} color="rgba(255,255,255,0.9)" />}
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ color: '#949ba4', fontSize: 11, fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}># voice-radio</div>
                      <LivePlaybackBar live />
                    </div>
                  </div>
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <DiscordButton icon={Pause} label="Pause" primary />
                  <DiscordButton icon={SkipForward} label="Skip" />
                  <DiscordButton icon={Square} label="Stop" />
                  <DiscordButton icon={Heart} label="" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
