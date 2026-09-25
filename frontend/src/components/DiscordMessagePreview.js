import { accentHex, BUTTON_STYLE_COLORS, emojiImageUrl, parseDiscordMarkdown } from '../lib/discordPreview.js';

// Draws Discord's Components V2 JSON the way Discord shows it (#281). The
// JSON comes from the bot's own panel builder, so this only draws.

function Inline({ parts }) {
  return parts.map((part, index) => {
    const key = `${part.type}-${index}`;
    if (part.type === 'emoji') {
      return <img key={key} src={emojiImageUrl(part.id, part.animated)} alt={`:${part.name}:`} width={18} height={18} style={{ verticalAlign: '-4px', margin: '0 1px' }} />;
    }
    if (part.type === 'bold') return <strong key={key}>{part.text}</strong>;
    if (part.type === 'link') return <a key={key} href={part.url} target="_blank" rel="noreferrer" style={{ color: '#00A8FC' }}>{part.text}</a>;
    if (part.type === 'channel') return <span key={key} style={{ background: 'rgba(88,101,242,0.3)', color: '#C9CDFB', borderRadius: 3, padding: '0 2px' }}>{part.text}</span>;
    if (part.type === 'time') {
      return <span key={key} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 3, padding: '0 2px' }}>{new Date(part.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
    }
    return <span key={key}>{part.text}</span>;
  });
}

const LINE_STYLES = {
  h1: { fontSize: 22, fontWeight: 700, margin: '2px 0' },
  h2: { fontSize: 18, fontWeight: 700, margin: '2px 0' },
  h3: { fontSize: 16, fontWeight: 700, margin: '2px 0' },
  subtext: { fontSize: 12, color: '#949BA4' },
  quote: { borderLeft: '4px solid #4E5058', paddingLeft: 8 },
  text: {},
};

function TextBlock({ content }) {
  return (
    <div style={{ lineHeight: 1.45 }}>
      {parseDiscordMarkdown(content).map((line, index) => (
        <div key={index} style={LINE_STYLES[line.kind]}>{line.parts.length ? <Inline parts={line.parts} /> : ' '}</div>
      ))}
    </div>
  );
}

function Button({ data }) {
  const colors = BUTTON_STYLE_COLORS[data.style] || BUTTON_STYLE_COLORS[2];
  const emoji = data.emoji;
  return (
    <span
      data-testid={`preview-button-${data.custom_id || data.label}`}
      style={{ ...colors, opacity: data.disabled ? 0.5 : 1, borderRadius: 4, padding: '4px 12px', fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 24 }}
    >
      {emoji?.id && <img src={emojiImageUrl(emoji.id, emoji.animated)} alt="" width={16} height={16} />}
      {emoji && !emoji.id && emoji.name && <span>{emoji.name}</span>}
      {data.label}
      {data.style === 5 && <span aria-hidden="true" style={{ fontSize: 11 }}>↗</span>}
    </span>
  );
}

function Block({ node }) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 10) return <TextBlock content={node.content} />;
  if (node.type === 14) return <hr style={{ border: 'none', borderTop: node.divider === false ? 'none' : '1px solid #3F4147', margin: '8px 0' }} />;
  if (node.type === 1) {
    return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{(node.components || []).map((child, index) => <Button key={index} data={child} />)}</div>;
  }
  if (node.type === 9) {
    const accessory = node.accessory;
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>{(node.components || []).map((child, index) => <Block key={index} node={child} />)}</div>
        {accessory?.type === 11 && accessory.media?.url && <img src={accessory.media.url} alt="" width={80} height={80} style={{ borderRadius: 8, objectFit: 'cover' }} />}
        {accessory?.type === 2 && <Button data={accessory} />}
      </div>
    );
  }
  if (node.type === 17) {
    const accent = accentHex(node.accent_color);
    return (
      <div style={{ background: '#2B2D31', borderRadius: 8, borderLeft: `4px solid ${accent || '#4E5058'}`, padding: '12px 14px', display: 'grid', gap: 8 }}>
        {(node.components || []).map((child, index) => <Block key={index} node={child} />)}
      </div>
    );
  }
  return null;
}

export default function DiscordMessagePreview({ payload }) {
  return (
    <div data-testid="discord-message-preview" style={{ background: '#313338', color: '#DBDEE1', padding: 14, fontFamily: "'gg sans', 'Noto Sans', Helvetica, Arial, sans-serif", fontSize: 15 }}>
      {(payload?.components || []).map((component, index) => <Block key={index} node={component} />)}
    </div>
  );
}
