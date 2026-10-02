// OmniFM: the pieces of a small Discord window for the live demos (#431):
// the window with its server rail, channel list and input line, a message
// header, an embed (the /invite answer is one), a select menu, buttons and
// the pointer that clicks through a scene. They only draw.
import { accentHex, BUTTON_STYLE_COLORS, parseDiscordMarkdown } from '../../lib/discordPreview.js';

export const DISCORD = {
  rail: '#1E1F22', side: '#2B2D31', chat: '#313338', input: '#383A40', line: '#26272B',
  text: '#DBDEE1', muted: '#949BA4', placeholder: '#A3A9B2', bright: '#F2F3F5', blurple: '#5865F2', green: '#23A55A', mention: '#00A8FC',
};
const FONT = "'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** The site's own images carry the live address in the bot's JSON; locally they come from this site. */
export function localAsset(url) {
  return String(url || '').replace(/^https:\/\/omnifm\.xyz\//, '/');
}

export function Avatar({ name, bot = false, size = 32, speaking = false }) {
  const ring = speaking ? `0 0 0 2px ${DISCORD.green}` : 'none';
  if (bot) {
    return <img src="/brand/omnifm-discord-avatar-192.png" alt="" width={size} height={size} style={{ borderRadius: '50%', flexShrink: 0, boxShadow: ring, transition: 'box-shadow 0.3s' }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#F472B6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: size * 0.42, boxShadow: ring, transition: 'box-shadow 0.3s' }}>
      {String(name || '?').slice(0, 1)}
    </span>
  );
}

export function MessageHeader({ name, bot, time, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Avatar name={name} bot={bot} size={34} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ color: DISCORD.bright, fontWeight: 600, fontSize: 14 }}>{name}</span>
          {bot ? <span style={{ background: DISCORD.blurple, color: '#fff', fontSize: 9.5, fontWeight: 700, padding: '1px 4px', borderRadius: 3 }}>APP</span> : null}
          {time ? <span style={{ color: DISCORD.muted, fontSize: 11 }}>{time}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

// Plain text with `code` spans, as Discord draws them.
function Plain({ text }) {
  return String(text || '').split(/(`[^`]+`)/).map((piece, index) => (/^`[^`]+`$/.test(piece)
    ? <code key={index} style={{ background: '#1E1F22', borderRadius: 3, padding: '0 3px', fontSize: '0.88em' }}>{piece.slice(1, -1)}</code>
    : <span key={index}>{piece}</span>));
}

function Markdown({ text }) {
  return parseDiscordMarkdown(text).map((line, index) => (
    <div key={index}>
      {line.parts.map((part, at) => (part.type === 'bold'
        ? <strong key={at} style={{ color: DISCORD.bright }}>{part.text}</strong>
        : <Plain key={at} text={part.text} />))}
    </div>
  ));
}

/** An embed as Discord draws it: colour bar, author, title, text, fields, footer. */
export function Embed({ embed }) {
  const inline = (embed.fields || []).filter((field) => field.inline);
  const block = (embed.fields || []).filter((field) => !field.inline);
  return (
    <div style={{ background: DISCORD.side, borderLeft: `4px solid ${accentHex(embed.color) || DISCORD.blurple}`, borderRadius: 4, padding: '8px 12px 10px', maxWidth: 420, fontSize: 13, color: DISCORD.text, display: 'grid', gap: 6 }}>
      {embed.author ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: DISCORD.bright }}>
          {embed.author.icon_url ? <img src={localAsset(embed.author.icon_url)} alt="" width={16} height={16} style={{ borderRadius: '50%' }} /> : null}
          {embed.author.name}
        </div>
      ) : null}
      {embed.title ? <div style={{ fontWeight: 700, color: DISCORD.bright, fontSize: 14 }}>{embed.title}</div> : null}
      {embed.description ? <div style={{ lineHeight: 1.45 }}><Markdown text={embed.description} /></div> : null}
      {inline.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, inline.length)}, minmax(0, 1fr))`, gap: 8 }}>
          {inline.map((field) => <Field key={field.name} field={field} />)}
        </div>
      ) : null}
      {block.map((field) => <Field key={field.name} field={field} />)}
      {embed.footer?.text ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: DISCORD.muted }}>
          {embed.footer.icon_url ? <img src={localAsset(embed.footer.icon_url)} alt="" width={14} height={14} style={{ borderRadius: '50%' }} /> : null}
          {embed.footer.text}
        </div>
      ) : null}
    </div>
  );
}

function Field({ field }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 700, color: DISCORD.bright, fontSize: 12, marginBottom: 2 }}>{field.name}</div>
      <div style={{ lineHeight: 1.45, fontSize: 12.5 }}><Markdown text={field.value} /></div>
    </div>
  );
}

/** A select menu, closed, showing the chosen option or the placeholder. */
export function Select({ menu }) {
  const chosen = (menu.options || []).find((option) => option.default);
  return (
    <div style={{ background: '#1E1F22', border: '1px solid #1E1F22', borderRadius: 4, padding: '7px 10px', fontSize: 13, color: chosen ? DISCORD.text : DISCORD.muted, display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 420 }}>
      <span>{chosen ? chosen.label : menu.placeholder}</span>
      <span aria-hidden="true" style={{ fontSize: 10 }}>▼</span>
    </div>
  );
}

export function Button({ data, pressed = false, marker }) {
  const colors = BUTTON_STYLE_COLORS[data.style] || BUTTON_STYLE_COLORS[2];
  return (
    <span
      data-demo-target={marker}
      aria-disabled={data.disabled ? 'true' : undefined}
      style={{ ...colors, opacity: data.disabled ? 0.5 : 1, borderRadius: 3, padding: '4px 11px', fontSize: 12.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 24, transform: pressed ? 'scale(0.95)' : 'none', filter: pressed ? 'brightness(0.85)' : 'none', transition: 'transform 0.12s, filter 0.12s' }}
    >
      {data.emoji?.name ? <span>{data.emoji.name}</span> : null}
      {data.label}
      {data.style === 5 ? <span aria-hidden="true" style={{ fontSize: 10 }}>↗</span> : null}
    </span>
  );
}

/** The components under a message: select menus and rows of buttons. */
export function Components({ rows, pressed }) {
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
      {(rows || []).map((row, index) => (
        <div key={index} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(row.components || []).map((part, at) => (part.type === 3
            ? <div key={at} style={{ flex: 1 }}><Select menu={part} /></div>
            : <Button key={at} data={part} pressed={pressed === (part.custom_id || part.label)} marker={part.custom_id || part.label} />))}
        </div>
      ))}
    </div>
  );
}

/** The pointer; it glides to the point given and shows a ring when it clicks. */
export function Pointer({ at, clicking }) {
  if (!at) return null;
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, zIndex: 20, pointerEvents: 'none', transform: `translate(${at.x}px, ${at.y}px)`, transition: 'transform 0.65s cubic-bezier(.4,.1,.2,1)' }}>
      {clicking ? <span style={{ position: 'absolute', left: -12, top: -12, width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.8)', animation: 'demo-click 0.35s ease-out' }} /> : null}
      <svg width="20" height="24" viewBox="0 0 20 24" style={{ position: 'absolute', left: -3, top: -2, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
        <path d="M2 1 L2 19 L6.5 14.8 L9.6 22 L12.8 20.6 L9.8 13.6 L16 13.4 Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * The window: server rail, the server's channels (with who is in the voice
 * channel), the channel's messages from the bottom up, and the input line
 * with what is being typed and the pop-up above it.
 */
export function DiscordWindow({ labels, compact, height, voice = [], typed = '', typing = false, popup = null, children, overlay = null, innerRef }) {
  return (
    <div ref={innerRef} style={{ position: 'relative', display: 'flex', height, borderRadius: 12, overflow: 'hidden', background: DISCORD.chat, border: '1px solid #1a1b1e', boxShadow: '0 24px 60px rgba(0,0,0,0.45)', fontFamily: FONT, color: DISCORD.text, textAlign: 'left' }}>
      <div style={{ width: 44, background: DISCORD.rail, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, gap: 8, flexShrink: 0 }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, background: 'linear-gradient(135deg,#ff6b00,#ff2a5f)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 800 }}>OD</span>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#313338' }} />
      </div>
      {compact ? null : (
        <div style={{ width: 136, background: DISCORD.side, flexShrink: 0, padding: '10px 8px', fontSize: 12.5 }}>
          <div style={{ color: DISCORD.bright, fontWeight: 700, fontSize: 13, padding: '0 4px 10px', borderBottom: `1px solid ${DISCORD.line}`, marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labels.server}</div>
          <div style={{ padding: '4px 6px', borderRadius: 4, background: 'rgba(78,80,88,0.45)', color: DISCORD.bright }}># {labels.textChannel}</div>
          <div style={{ padding: '6px 6px 2px', color: DISCORD.muted }}>🔊 {labels.voiceChannel}</div>
          <div style={{ display: 'grid', gap: 4, padding: '2px 0 0 16px' }}>
            {voice.map((member) => (
              <div key={member.name} style={{ display: 'flex', alignItems: 'center', gap: 6, animation: 'demo-in 0.35s ease-out' }}>
                <Avatar name={member.name} bot={member.bot} size={18} speaking={member.speaking} />
                <span style={{ fontSize: 12, color: DISCORD.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: `1px solid ${DISCORD.line}`, color: DISCORD.bright, fontWeight: 600, fontSize: 13.5 }}>
          <span style={{ color: DISCORD.muted }}>#</span> {labels.textChannel}
          {compact && voice.length ? (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: DISCORD.muted, fontWeight: 500, fontSize: 11.5 }}>
              🔊 {voice.map((member) => <Avatar key={member.name} name={member.name} bot={member.bot} size={16} speaking={member.speaking} />)}
            </span>
          ) : null}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '8px 12px', gap: 10 }}>
          {children}
        </div>
        <div style={{ position: 'relative', padding: '0 12px 12px', flexShrink: 0 }}>
          {popup}
          <div style={{ background: DISCORD.input, borderRadius: 8, padding: '9px 12px', fontSize: 13.5, color: typed ? DISCORD.text : DISCORD.placeholder, minHeight: 18, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {typed || labels.messagePlaceholder}
            {typing ? <span style={{ display: 'inline-block', width: 1, height: 15, background: DISCORD.text, marginLeft: 1, verticalAlign: '-2px', animation: 'demo-caret 0.9s steps(1) infinite' }} /> : null}
          </div>
        </div>
      </div>
      {overlay}
    </div>
  );
}
