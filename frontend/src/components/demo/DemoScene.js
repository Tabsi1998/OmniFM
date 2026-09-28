// OmniFM: the live demos of the first steps in Discord (#431). Four short
// scenes drawn in the page (no video): add the commander, invite a worker
// with /invite, start the radio with /play lofi, use the panel. What the bot
// says is the bot's real output (demoMessages.json, built by the bot's own
// code); Discord's own words come in the visitor's language. A scene plays
// while it is in view, has a pause button, and with "less motion" shows its
// last picture with every step written out.
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useI18n } from '../../i18n.js';
import DiscordMessagePreview from '../DiscordMessagePreview.js';
import demo from './demoMessages.json';
import { Avatar, Components, DISCORD, DiscordWindow, Embed, MessageHeader, Pointer } from './DiscordBits.js';
import { CAPTION_HEIGHT, sceneHeight } from './LiveDemo.js';
import { TIMELINES, useSceneClock, useTargetPoint, useTyped } from './timelines.js';

const css = `
@keyframes demo-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes demo-pop { 0% { opacity: 0; transform: scale(0.6); } 70% { transform: scale(1.08); } 100% { opacity: 1; transform: none; } }
@keyframes demo-click { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
@keyframes demo-caret { 50% { opacity: 0; } }
.demo-steps { display: flex; flex-wrap: wrap; gap: 6px 14px; list-style: none; margin: 0; padding: 0; }
.demo-steps li { font-size: 12.5px; color: #8A8A93; display: flex; align-items: center; gap: 6px; }
.demo-steps li[data-active="true"] { color: #F4F4F5; font-weight: 700; }
.demo-steps b { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #26272B; font-size: 10.5px; color: #A1A1AA; }
.demo-steps li[data-active="true"] b { background: #ff6b00; color: #08090d; }
`;

// The site's own pictures carry the live address in the bot's JSON; here they come from this site.
const local = (payload) => JSON.parse(JSON.stringify(payload).replaceAll('https://omnifm.xyz/', '/'));
const botLanguage = (locale) => (locale === 'de' ? 'de' : 'en');

function Popup({ children }) {
  return (
    <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(100% - 4px)', background: DISCORD.side, border: `1px solid ${DISCORD.rail}`, borderRadius: 8, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', animation: 'demo-in 0.2s ease-out', zIndex: 5 }}>
      {children}
    </div>
  );
}

function PopupRow({ title, detail, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, background: active ? 'rgba(78,80,88,0.6)' : 'transparent' }}>
      <img src="/brand/omnifm-discord-avatar-192.png" alt="" width={18} height={18} style={{ borderRadius: '50%' }} />
      <span style={{ color: DISCORD.bright, fontWeight: 600, fontSize: 13 }}>{title}</span>
      {detail ? <span style={{ color: DISCORD.muted, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span> : null}
    </div>
  );
}

function UsedLine({ labels, command }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: DISCORD.muted, fontSize: 11.5, margin: '0 0 2px 44px' }}>
      <Avatar name={labels.user} size={14} /> {labels.used({ user: labels.user, command })}
    </div>
  );
}

// ---------------------------------------------------------------- scene 1

function CommanderScene({ step, labels, height }) {
  const ref = useRef(null);
  const page = step <= 5 ? 1 : (step <= 8 ? 2 : 3);
  const target = { 1: '[data-demo-target="select"]', 3: '[data-demo-target="server-0"]', 4: '[data-demo-target="continue"]', 5: '[data-demo-target="continue"]', 7: '[data-demo-target="authorize"]', 8: '[data-demo-target="authorize"]' }[step] || null;
  const point = useTargetPoint(ref, target, [step]);
  const open = step === 2 || step === 3;
  const chosen = step >= 4;
  const card = { width: 'min(92%, 330px)', background: DISCORD.chat, borderRadius: 8, padding: 16, boxShadow: '0 16px 40px rgba(0,0,0,0.5)', color: DISCORD.text, fontSize: 13 };
  const button = (primary, marker, text, pressed) => (
    <span data-demo-target={marker} style={{ padding: '7px 14px', borderRadius: 4, fontWeight: 600, fontSize: 12.5, background: primary ? DISCORD.blurple : 'transparent', color: primary ? '#fff' : DISCORD.text, opacity: primary && page === 1 && !chosen ? 0.5 : 1, transform: pressed ? 'scale(0.95)' : 'none', transition: 'transform 0.12s' }}>{text}</span>
  );
  return (
    <div ref={ref} style={{ position: 'relative', height, borderRadius: 12, overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 50% 30%, #2B2D31, #111214)', border: '1px solid #1a1b1e', boxShadow: '0 24px 60px rgba(0,0,0,0.45)', fontFamily: "'gg sans', 'Noto Sans', Helvetica, Arial, sans-serif", textAlign: 'left' }}>
      {page < 3 ? (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
            <Avatar bot size={44} />
            <span style={{ color: DISCORD.muted, letterSpacing: 3 }}>···</span>
            <Avatar name={labels.user} size={44} />
          </div>
          <div style={{ textAlign: 'center', color: DISCORD.bright, fontWeight: 700, fontSize: 16, marginBottom: 12 }}>OmniFM DJ</div>
          {page === 1 ? (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: DISCORD.muted, textTransform: 'uppercase', marginBottom: 6 }}>{labels.oauth.addTo}</div>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <div data-demo-target="select" style={{ background: DISCORD.rail, borderRadius: 4, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', color: chosen ? DISCORD.bright : DISCORD.muted }}>
                  {chosen ? labels.oauth.servers[0] : labels.oauth.choose}<span aria-hidden="true" style={{ fontSize: 10 }}>▼</span>
                </div>
                {open ? (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', background: DISCORD.rail, borderRadius: 4, padding: 4, zIndex: 3, animation: 'demo-in 0.2s ease-out' }}>
                    {labels.oauth.servers.map((server, index) => (
                      <div key={server} data-demo-target={`server-${index}`} style={{ padding: '6px 8px', borderRadius: 3, background: step === 3 && index === 0 ? 'rgba(88,101,242,0.35)' : 'transparent', color: DISCORD.text }}>{server}</div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {button(false, 'cancel', labels.oauth.cancel, false)}
                {button(true, 'continue', labels.oauth.continue, step === 5)}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: DISCORD.muted, marginBottom: 8 }}>{labels.oauth.allow}</div>
              <div style={{ display: 'grid', gap: 7, marginBottom: 14 }}>
                {labels.oauth.perms.map((permission, index) => (
                  <div key={permission} style={{ display: 'flex', alignItems: 'center', gap: 8, animation: `demo-in 0.3s ease-out ${index * 0.18}s both` }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: DISCORD.green, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, flexShrink: 0 }}>✓</span>
                    {permission}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {button(false, 'back', labels.oauth.back, false)}
                {button(true, 'authorize', labels.oauth.authorize, step === 8)}
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ ...card, textAlign: 'center', animation: 'demo-in 0.3s ease-out' }}>
          <div style={{ width: 56, height: 56, margin: '4px auto 12px', borderRadius: '50%', background: DISCORD.green, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 28, animation: 'demo-pop 0.45s ease-out' }}>✓</div>
          <div style={{ color: DISCORD.bright, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{labels.oauth.done}</div>
          <div style={{ color: DISCORD.text }}>{labels.oauth.added}</div>
        </div>
      )}
      <Pointer at={point || (step === 0 ? { x: 30, y: height - 30 } : null)} clicking={step === 5 || step === 8} />
    </div>
  );
}

// ---------------------------------------------------------------- scene 2

function WorkerScene({ step, labels, height, compact, locale, still }) {
  const ref = useRef(null);
  const invite = demo.invite[botLanguage(locale)];
  const typed = useTyped('/invite', { active: step === 1, done: step === 2 || still });
  const answered = step >= 3;
  const point = useTargetPoint(ref, step >= 4 && step <= 5 ? '[data-demo-target="Invite OmniFM 1"]' : null, [step]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <DiscordWindow
        labels={labels}
        compact={compact}
        height={height}
        typed={answered ? '' : typed}
        typing={step === 1}
        popup={step === 2 ? (
          <Popup><PopupRow title="/invite" detail={demo.commands[locale]?.invite} active /></Popup>
        ) : null}
        overlay={step >= 6 ? (
          <div style={{ position: 'absolute', left: '50%', top: 48, transform: 'translateX(-50%)', background: DISCORD.green, color: '#fff', fontWeight: 600, fontSize: 12.5, borderRadius: 6, padding: '7px 12px', boxShadow: '0 8px 20px rgba(0,0,0,0.35)', animation: 'demo-pop 0.35s ease-out', whiteSpace: 'nowrap', zIndex: 6 }}>
            ✓ {labels.added({ bot: 'OmniFM 1', server: labels.server })}
          </div>
        ) : null}
      >
        <div style={{ color: DISCORD.muted, fontSize: 12 }}>→ {labels.joined({ bot: 'OmniFM DJ' })}</div>
        {answered ? (
          <div style={{ animation: 'demo-in 0.3s ease-out', transformOrigin: 'bottom left', transform: compact ? 'scale(0.88)' : 'none', width: compact ? '113%' : 'auto' }}>
            <UsedLine labels={labels} command="/invite" />
            <MessageHeader name="OmniFM DJ" bot time={labels.today}>
              {invite.embeds.map((embed, index) => <Embed key={index} embed={embed} />)}
              <Components rows={invite.components} pressed={step === 5 ? 'Invite OmniFM 1' : null} />
              <div style={{ color: DISCORD.muted, fontSize: 11, marginTop: 5 }}>👁 {labels.onlyYou} · <span style={{ color: DISCORD.mention }}>{labels.dismiss}</span></div>
            </MessageHeader>
          </div>
        ) : null}
      </DiscordWindow>
      <Pointer at={point} clicking={step === 5} />
    </div>
  );
}

// ---------------------------------------------------------------- scene 3

const SUGGESTIONS = ['Lofi Café', 'Lofi Nights', 'Chillhop'];

function PlayScene({ step, labels, height, compact, locale, still }) {
  const commands = demo.commands[locale] || demo.commands.en;
  const panel = local(demo.panels[botLanguage(locale)].lofi);
  const command = useTyped('/play', { active: step === 2, done: step >= 3 || still });
  const value = useTyped('lofi', { active: step === 4, done: still });
  const playing = step >= 5;
  const voice = [
    ...(step >= 1 ? [{ name: labels.user }] : []),
    ...(playing ? [{ name: 'OmniFM 1', bot: true, speaking: true }] : []),
  ];
  let popup = null;
  if (step === 3) popup = <Popup><PopupRow title="/play" detail={commands.play} active /></Popup>;
  if (step === 4) {
    popup = (
      <Popup>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: DISCORD.muted, textTransform: 'uppercase', padding: '2px 8px 4px' }}>station · {commands.station}</div>
        {SUGGESTIONS.map((name, index) => <PopupRow key={name} title={name} active={index === 0} />)}
      </Popup>
    );
  }
  const typed = playing ? '' : (step >= 4 ? `${command} station: ${value}` : command);
  return (
    <DiscordWindow labels={labels} compact={compact} height={height} voice={voice} typed={typed} typing={step === 2 || step === 4} popup={popup}>
      {playing ? (
        <div style={{ animation: 'demo-in 0.35s ease-out', transformOrigin: 'bottom left', transform: compact ? 'scale(0.8)' : 'scale(0.92)', width: compact ? '125%' : '109%' }}>
          <UsedLine labels={labels} command="/play" />
          <MessageHeader name="OmniFM 1" bot time={labels.today}>
            {step >= 6 ? <div style={{ animation: 'demo-in 0.4s ease-out' }}><DiscordMessagePreview payload={panel} bare /></div> : <div style={{ color: DISCORD.muted, fontSize: 12.5 }}>…</div>}
          </MessageHeader>
        </div>
      ) : null}
    </DiscordWindow>
  );
}

// ---------------------------------------------------------------- scene 4

function PanelScene({ step, labels, height, compact, locale }) {
  const ref = useRef(null);
  const panels = demo.panels[botLanguage(locale)];
  const moment = step >= 9 ? 'lounge' : (step >= 3 && step <= 5 ? 'paused' : 'lofi');
  const panel = local(panels[moment]);
  const target = { 1: 'np:toggle', 2: 'np:toggle', 4: 'np:toggle', 5: 'np:toggle', 7: 'np:fav:lounge', 8: 'np:fav:lounge' }[step] || null;
  const point = useTargetPoint(ref, target ? `[data-testid="preview-button-${target}"]` : null, [step, moment]);
  const pressed = step === 2 || step === 5 || step === 8 ? target : null;
  const voice = [{ name: labels.user }, { name: 'OmniFM 1', bot: true, speaking: moment !== 'paused' }];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <DiscordWindow labels={labels} compact={compact} height={height} voice={voice}>
        <div style={{ transformOrigin: 'bottom left', transform: compact ? 'scale(0.8)' : 'none', width: compact ? '125%' : 'auto' }}>
          <MessageHeader name="OmniFM 1" bot time={labels.today}>
            <DiscordMessagePreview payload={panel} pressed={pressed} bare />
          </MessageHeader>
        </div>
      </DiscordWindow>
      <Pointer at={point} clicking={Boolean(pressed)} />
    </div>
  );
}

const DRAW = { commander: CommanderScene, worker: WorkerScene, play: PlayScene, panel: PanelScene };

function prefersLessMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

/** One live demo: plays while in view, pauses on request, a still with every step for "less motion". */
export default function DemoScene({ scene, size = 'small' }) {
  const { copy, locale } = useI18n();
  const labels = copy.demos;
  const timeline = TIMELINES[scene];
  const ref = useRef(null);
  const [still] = useState(prefersLessMotion);
  const [inView, setInView] = useState(typeof IntersectionObserver !== 'function');
  const [paused, setPaused] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const step = useSceneClock(timeline, { playing: inView && !paused, still });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 460));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const Draw = DRAW[scene];
  const compact = size === 'small' || narrow;
  const height = sceneHeight(scene, size);
  const captions = labels.captions[scene];
  const active = timeline[step].caption;
  return (
    <figure ref={ref} data-testid={`demo-${scene}`} data-step={step} data-round-ms={timeline.reduce((sum, entry) => sum + entry.ms, 0)} data-still={still ? 'true' : undefined} aria-label={labels.a11y[scene]} style={{ margin: 0 }}>
      <style>{css}</style>
      <Draw step={step} labels={labels} height={height} compact={compact} locale={locale} still={still} />
      <figcaption style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, height: CAPTION_HEIGHT, overflow: 'hidden' }}>
        {still ? null : (
          <button
            type="button"
            data-testid={`demo-${scene}-toggle`}
            onClick={() => setPaused((value) => !value)}
            aria-label={paused ? labels.play : labels.pause}
            title={paused ? labels.play : labels.pause}
            style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #2a3450', background: 'rgba(255,255,255,0.03)', color: '#E4E4E7', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
        <ol className="demo-steps" aria-label={labels.stepsLabel}>
          {captions.map((caption, index) => (
            <li key={caption} data-active={still || index === active ? 'true' : undefined}><b>{index + 1}</b>{caption}</li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
