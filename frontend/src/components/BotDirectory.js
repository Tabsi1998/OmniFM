import React from 'react';
import { Check, CheckCircle2, Copy, Crown, ExternalLink, Lock, RadioTower, ServerCog } from 'lucide-react';
import { useI18n } from '../i18n.js';

const BOT_COLORS = {
  cyan: { accent: '#00e5ff', bg: 'rgba(0,229,255, 0.08)', glow: 'rgba(0,229,255, 0.15)', border: 'rgba(0,229,255, 0.25)' },
  green: { accent: '#ff6b00', bg: 'rgba(255,107,0, 0.08)', glow: 'rgba(255,107,0, 0.15)', border: 'rgba(255,107,0, 0.25)' },
  pink: { accent: '#EC4899', bg: 'rgba(236, 72, 153, 0.08)', glow: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.25)' },
  amber: { accent: '#ff6b00', bg: 'rgba(255,107,0, 0.08)', glow: 'rgba(255,107,0, 0.15)', border: 'rgba(255,107,0, 0.25)' },
  purple: { accent: '#ff2a5f', bg: 'rgba(255,42,95, 0.08)', glow: 'rgba(255,42,95, 0.15)', border: 'rgba(255,42,95, 0.25)' },
  red: { accent: '#ff2a5f', bg: 'rgba(255,42,95, 0.08)', glow: 'rgba(255,42,95, 0.15)', border: 'rgba(255,42,95, 0.25)' },
};

function BotCard({ bot, index, copy, formatNumber }) {
  const [copied, setCopied] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  const colorKey = bot.color || Object.keys(BOT_COLORS)[index % Object.keys(BOT_COLORS).length];
  const colors = BOT_COLORS[colorKey] || BOT_COLORS.cyan;
  const isPremiumBot = bot.requiredTier && bot.requiredTier !== 'free';
  const inviteUrl = isPremiumBot
    ? null
    : (bot.inviteUrl || bot.invite_url || `https://discord.com/oauth2/authorize?client_id=${bot.clientId || bot.client_id || ''}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands`);
  const botImage = bot.avatarUrl || bot.avatar_url || `/img/bot-${(index % 4) + 1}.png`;
  const tierBadgeColors = { pro: '#ff6b00', ultimate: '#ff2a5f' };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failure
    }
  };

  return (
    <div
      data-testid={`bot-card-${index}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        padding: 28,
        borderRadius: 20,
        background: hovered
          ? `linear-gradient(180deg, ${colors.bg} 0%, rgba(0,0,0,0.5) 100%)`
          : 'rgba(255, 255, 255, 0.02)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${hovered ? colors.border : 'rgba(255,255,255,0.06)'}`,
        transition: 'border-color 0.4s, background 0.4s, box-shadow 0.4s',
        boxShadow: hovered ? `0 0 40px ${colors.glow}` : 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 28, right: 28, height: 2, background: colors.accent, opacity: hovered ? 1 : 0.3, transition: 'opacity 0.3s' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          overflow: 'hidden',
          flexShrink: 0,
          background: `linear-gradient(135deg, ${colors.accent}22, ${colors.accent}08)`,
          border: `1px solid ${colors.accent}33`,
        }}>
          <img
            src={botImage}
            alt={bot.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: '0.02em', margin: 0 }}>
              {bot.name}
            </h3>
            {isPremiumBot && (
              <span
                data-testid={`bot-tier-badge-${index}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: "'Syne', sans-serif",
                  letterSpacing: '0.1em',
                  background: `${tierBadgeColors[bot.requiredTier] || '#ff6b00'}15`,
                  color: tierBadgeColors[bot.requiredTier] || '#ff6b00',
                  border: `1px solid ${tierBadgeColors[bot.requiredTier] || '#ff6b00'}30`,
                }}
              >
                <Crown size={10} />
                {bot.requiredTier === 'ultimate' ? 'ULTIMATE' : 'PRO'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: bot.ready ? '#ff6b00' : '#52525B',
              boxShadow: bot.ready ? '0 0 8px rgba(255,107,0,0.5)' : 'none',
            }} />
            <span style={{ fontSize: 12, color: bot.ready ? '#ff6b00' : '#52525B', fontWeight: 600 }}>
              {bot.ready ? copy.bots.status.online : copy.bots.status.configurable}
            </span>
          </div>
        </div>
      </div>

      <div style={{
        padding: '14px 0',
        marginBottom: 16,
        borderTop: `1px solid ${colors.accent}15`,
        borderBottom: `1px solid ${colors.accent}15`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: colors.accent, marginBottom: 10, fontFamily: "'Syne', sans-serif" }}>
          {copy.bots.statsTitle}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
          {[
            { label: copy.bots.stats.servers, value: bot.servers || 0 },
            { label: copy.bots.stats.users, value: bot.users || 0 },
            { label: copy.bots.stats.connections, value: bot.connections || 0 },
            { label: copy.bots.stats.listeners, value: bot.listeners || 0 },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: 11, color: '#52525B', fontWeight: 600, letterSpacing: '0.05em' }}>
                {item.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#fff' }}>
                {formatNumber(item.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
        {isPremiumBot ? (
          <a
            href="#premium"
            data-testid={`invite-btn-${index}`}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 20px',
              borderRadius: 12,
              background: `${tierBadgeColors[bot.requiredTier] || '#ff6b00'}15`,
              border: `1px solid ${tierBadgeColors[bot.requiredTier] || '#ff6b00'}30`,
              color: tierBadgeColors[bot.requiredTier] || '#ff6b00',
              fontWeight: 700,
              fontSize: 13,
              textDecoration: 'none',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              transition: 'transform 0.15s, background 0.2s',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.transform = 'scale(1.02)';
              event.currentTarget.style.background = `${tierBadgeColors[bot.requiredTier] || '#ff6b00'}25`;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.transform = 'scale(1)';
              event.currentTarget.style.background = `${tierBadgeColors[bot.requiredTier] || '#ff6b00'}15`;
            }}
          >
            <Lock size={14} />
            {bot.requiredTier === 'ultimate' ? 'Ultimate' : 'Pro'} {copy.bots.actions.required}
          </a>
        ) : (
          <>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`invite-btn-${index}`}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 20px',
                borderRadius: 12,
                background: colors.accent,
                color: '#050505',
                fontWeight: 700,
                fontSize: 13,
                textDecoration: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                transition: 'transform 0.15s, opacity 0.15s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.opacity = '0.9';
                event.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.opacity = '1';
                event.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <ExternalLink size={14} />
              {copy.bots.actions.invite}
            </a>
            <button
              onClick={handleCopy}
              data-testid={`copy-btn-${index}`}
              title={copied ? copy.bots.actions.copied : copy.bots.actions.copy}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: copied ? '#ff6b00' : '#A1A1AA',
                cursor: 'pointer',
                transition: 'color 0.2s',
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BotDirectory({ bots, loading }) {
  const { copy, formatNumber } = useI18n();
  const commanderBot = Array.isArray(bots)
    ? bots.find((bot) => String(bot?.role || '').toLowerCase() === 'commander')
      || bots.find((bot) => String(bot?.name || '').toLowerCase().includes('dj'))
      || bots.find((bot) => (bot.index || 0) === 1 || bot.botId === 'bot-1')
      || bots[0]
    : null;
  const networkSnapshot = React.useMemo(() => {
    const list = Array.isArray(bots) ? bots : [];
    return list.reduce((summary, bot) => ({
      readyBots: summary.readyBots + (bot?.ready ? 1 : 0),
      totalServers: summary.totalServers + (Number(bot?.servers) || 0),
      totalConnections: summary.totalConnections + (Number(bot?.connections) || 0),
    }), {
      readyBots: 0,
      totalServers: 0,
      totalConnections: 0,
    });
  }, [bots]);

  return (
    <section id="bots" data-testid="bot-directory" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00e5ff' }}>
            {copy.bots.eyebrow}
          </span>
          <h2 data-testid="bot-directory-title" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8, marginBottom: 12 }}>
            {copy.bots.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 620 }}>
            {copy.bots.subtitleLead}{' '}
            <span style={{ color: '#00e5ff', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
              /invite
            </span>{' '}
            {copy.bots.subtitleTail}
          </p>
        </div>

        {loading ? (
          <div style={{ color: '#52525B', padding: 40 }}>{copy.bots.loading}</div>
        ) : !commanderBot ? (
          <div style={{ color: '#52525B', padding: 40 }}>{copy.bots.empty}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            <BotCard bot={commanderBot} index={0} copy={copy} formatNumber={formatNumber} />

            <div style={{
              borderRadius: 20,
              padding: 28,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#ff6b00', marginBottom: 16, fontFamily: "'Syne', sans-serif" }}>
                {copy.bots.workerTiersTitle}
              </div>
              {copy.bots.workerTiers.map((tier) => (
                <div key={tier.tier} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingRight: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, background: tier.tier === 'Free' ? '#ff6b00' : tier.tier === 'Pro' ? '#ff6b00' : '#ff2a5f' }} />
                    <div>
                      <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{tier.tier}</div>
                      {tier.desc && (
                        <div style={{ fontSize: 12, color: '#71717A', lineHeight: 1.5, marginTop: 4 }}>
                          {tier.desc}
                        </div>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: '#A1A1AA', fontFamily: "'JetBrains Mono', monospace" }}>
                    {tier.bots}
                  </span>
                </div>
              ))}
              <p style={{ marginTop: 16, fontSize: 12, color: '#52525B', lineHeight: 1.5 }}>
                {copy.bots.workerHintLead}{' '}
                <span style={{ color: '#00e5ff', fontFamily: "'JetBrains Mono', monospace" }}>
                  /invite {'<worker>'}
                </span>{' '}
                {copy.bots.workerHintTail}
              </p>
            </div>

            <div style={{
              borderRadius: 20,
              padding: 28,
              background: 'linear-gradient(180deg, rgba(0,229,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
              border: '1px solid rgba(0,229,255,0.14)',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <RadioTower size={15} color="#00e5ff" />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00e5ff', fontFamily: "'Syne', sans-serif" }}>
                  {copy.bots.networkTitle}
                </span>
              </div>
              <p style={{ margin: '0 0 18px', color: '#A1A1AA', fontSize: 13, lineHeight: 1.65 }}>
                {copy.bots.networkSubtitle}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
                {[
                  { key: 'ready', label: copy.bots.networkMetrics.readyBots, value: networkSnapshot.readyBots, color: '#ff6b00' },
                  { key: 'servers', label: copy.bots.networkMetrics.totalServers, value: networkSnapshot.totalServers, color: '#00e5ff' },
                  { key: 'connections', label: copy.bots.networkMetrics.totalConnections, value: networkSnapshot.totalConnections, color: '#EC4899' },
                ].map((item) => (
                  <div
                    key={item.key}
                    data-testid={`bot-network-metric-${item.key}`}
                    style={{
                      padding: '12px 10px',
                      borderRadius: 14,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700, color: item.color, textShadow: `0 0 16px ${item.color}35` }}>
                      {formatNumber(item.value)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: '#71717A', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                padding: '16px 18px',
                borderRadius: 16,
                background: 'rgba(5,5,5,0.3)',
                border: '1px solid rgba(255,255,255,0.06)',
                marginBottom: 16,
              }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <ServerCog size={15} color="#ff6b00" />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ff6b00', fontFamily: "'Syne', sans-serif" }}>
                    {copy.bots.proofListTitle}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {copy.bots.proofChecks.map((item) => (
                    <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#D4D4D8', fontSize: 13, lineHeight: 1.6 }}>
                      <CheckCircle2 size={14} color="#ff6b00" style={{ flexShrink: 0, marginTop: 3 }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <p style={{ margin: 0, fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
                {copy.bots.networkHint}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default BotDirectory;
