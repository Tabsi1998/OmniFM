import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronRight,
  Crown,
  Radio,
  Server,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildApiUrl } from '../lib/api.js';

const ROLE_COLORS = {
  commander: { accent: '#00e5ff', bg: 'rgba(0,229,255, 0.06)', border: 'rgba(0,229,255, 0.2)', glow: 'rgba(0,229,255, 0.12)' },
  worker: { accent: '#ff6b00', bg: 'rgba(255,107,0, 0.04)', border: 'rgba(255,107,0, 0.15)', glow: 'rgba(255,107,0, 0.08)' },
};

const TIER_COLORS = {
  free: { label: 'Free', color: '#A1A1AA', bg: 'rgba(161,161,170,0.1)' },
  pro: { label: 'Pro', color: '#ff6b00', bg: 'rgba(255,107,0,0.1)' },
  ultimate: { label: 'Ultimate', color: '#ff2a5f', bg: 'rgba(255,42,95,0.1)' },
};

function TierBadge({ tier }) {
  const tierConfig = TIER_COLORS[tier] || TIER_COLORS.free;

  return (
    <span
      data-testid={`tier-badge-${tier}`}
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
        background: tierConfig.bg,
        color: tierConfig.color,
        border: `1px solid ${tierConfig.color}30`,
      }}
    >
      <Crown size={10} />
      {tierConfig.label.toUpperCase()}
    </span>
  );
}

function WorkerNode({ bot, isCommander, copy, formatNumber }) {
  const [hovered, setHovered] = useState(false);
  const colors = isCommander ? ROLE_COLORS.commander : ROLE_COLORS.worker;
  const Icon = isCommander ? Shield : Radio;

  return (
    <div
      data-testid={`worker-node-${bot.index}`}
      className="ui-lift"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        padding: '20px 24px',
        borderRadius: 16,
        background: hovered ? colors.bg : 'rgba(255,255,255,0.015)',
        border: `1px solid ${hovered ? colors.border : 'rgba(255,255,255,0.05)'}`,
        backdropFilter: 'blur(12px)',
        transition: 'all 0.3s ease',
        boxShadow: hovered ? `0 0 24px ${colors.glow}` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${colors.accent}18, ${colors.accent}08)`,
            border: `1px solid ${colors.accent}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={20} color={colors.accent} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>
                {bot.name}
              </span>
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                padding: '2px 6px',
                borderRadius: 4,
                background: isCommander ? `${colors.accent}15` : 'rgba(255,107,0,0.1)',
                color: colors.accent,
                fontFamily: "'Syne', sans-serif",
              }}>
                {isCommander ? copy.workers.status.commander : `${copy.workers.status.workerPrefix}${bot.index}`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: bot.online ? '#ff6b00' : '#52525B',
                  boxShadow: bot.online ? '0 0 6px rgba(255,107,0,0.5)' : 'none',
                }} />
                <span style={{ fontSize: 11, color: bot.online ? '#ff6b00' : '#52525B', fontWeight: 600 }}>
                  {bot.online ? copy.workers.status.online : copy.workers.status.offline}
                </span>
              </div>
              {bot.requiredTier !== 'free' && <TierBadge tier={bot.requiredTier} />}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#52525B', fontWeight: 600, letterSpacing: '0.08em' }}>
              {copy.workers.labels.server}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#fff' }}>
              {formatNumber(bot.servers || 0)}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#52525B', fontWeight: 600, letterSpacing: '0.08em' }}>
              {copy.workers.labels.streams}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: colors.accent }}>
              {formatNumber(bot.activeStreams || 0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TierCard({ name, maxWorkers, color, icon: IconComp, label }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 160,
      padding: '20px 24px',
      borderRadius: 14,
      background: `${color}08`,
      border: `1px solid ${color}20`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <IconComp size={16} color={color} />
        <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, color, letterSpacing: '0.1em' }}>
          {name}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: '#fff' }}>
        {maxWorkers}
      </div>
      <div style={{ fontSize: 11, color: '#71717A', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function WorkerDashboard() {
  const { copy, formatNumber } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchWorkers = useCallback(async () => {
    try {
      const response = await fetch(buildApiUrl('/api/workers'), { cache: 'no-store' });
      if (response.ok) {
        const payload = await response.json();
        if (mountedRef.current) setData(payload);
      }
    } catch {
      // ignore fetch failures and keep last view
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 15000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchWorkers]);

  if (loading) {
    return (
      <section id="workers" data-testid="worker-dashboard" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
        <div className="section-container">
          <div style={{ color: '#52525B', padding: 40 }}>{copy.workers.loading}</div>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const { commander, workers, tiers } = data;
  const totalWorkers = Array.isArray(workers) ? workers.length : 0;
  const onlineWorkers = Array.isArray(workers) ? workers.filter((worker) => worker.online).length : 0;
  const activeStreams = Array.isArray(workers)
    ? workers.reduce((sum, worker) => sum + Number(worker.activeStreams || 0), 0)
    : 0;

  const summaryCards = [
    { label: copy.workers.labels.workersTotal, value: totalWorkers, color: '#A1A1AA', icon: Users },
    { label: copy.workers.labels.workersOnline, value: onlineWorkers, color: '#ff6b00', icon: Activity },
    { label: copy.workers.labels.activeStreams, value: activeStreams, color: '#00e5ff', icon: Radio },
    { label: copy.workers.labels.commanderServers, value: commander?.servers || 0, color: '#ff6b00', icon: Server },
  ];

  return (
    <section id="workers" data-testid="worker-dashboard" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00e5ff' }}>
            {copy.workers.eyebrow}
          </span>
          <h2
            data-testid="worker-dashboard-title"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            {copy.workers.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 640 }}>
            {copy.workers.subtitle}
          </p>
        </div>

        <div data-testid="tier-overview" style={{ display: 'flex', gap: 16, marginBottom: 40, flexWrap: 'wrap' }}>
          {tiers && (
            <>
              <TierCard name={copy.workers.tierCards.free.name} maxWorkers={tiers.free?.maxWorkers || 2} color="#A1A1AA" icon={Users} label={copy.workers.tierCards.free.maxWorkers} />
              <TierCard name={copy.workers.tierCards.pro.name} maxWorkers={tiers.pro?.maxWorkers || 8} color="#ff6b00" icon={Zap} label={copy.workers.tierCards.pro.maxWorkers} />
              <TierCard name={copy.workers.tierCards.ultimate.name} maxWorkers={tiers.ultimate?.maxWorkers || 16} color="#ff2a5f" icon={Crown} label={copy.workers.tierCards.ultimate.maxWorkers} />
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          {summaryCards.map((item) => (
            <div key={item.label} style={{
              padding: '14px 16px',
              borderRadius: 12,
              border: `1px solid ${item.color}25`,
              background: `${item.color}08`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#71717A', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {item.label}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 20, color: '#fff' }}>
                  {formatNumber(item.value)}
                </div>
              </div>
              <item.icon size={18} color={item.color} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {commander && <WorkerNode bot={commander} isCommander copy={copy} formatNumber={formatNumber} />}

          {workers && workers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px' }}>
              <div style={{ width: 2, height: 20, background: 'rgba(0,229,255,0.15)', marginLeft: 20 }} />
              <ChevronRight size={14} color="#52525B" />
              <span style={{ fontSize: 11, color: '#52525B', fontWeight: 600, letterSpacing: '0.08em', fontFamily: "'Syne', sans-serif" }}>
                {copy.workers.delegated} ({formatNumber(workers.length)})
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {workers && workers.map((worker) => (
              <WorkerNode key={worker.index} bot={worker} isCommander={false} copy={copy} formatNumber={formatNumber} />
            ))}
          </div>

          {workers && workers.length === 0 && (
            <div style={{
              padding: '24px 28px',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: '#52525B',
              fontSize: 14,
            }}>
              {copy.workers.empty}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default WorkerDashboard;
