import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crown,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react';
import { useI18n } from '../i18n.js';

const COMMAND_TIERS = {
  free: {
    label: 'Free',
    color: '#ff6b00',
    icon: Shield,
    commands: ['help', 'play', 'pause', 'resume', 'stop', 'stations', 'list', 'setvolume', 'status', 'health', 'diag', 'premium', 'language', 'license', 'invite', 'workers', 'stats'],
  },
  pro: {
    label: 'Pro',
    color: '#ff6b00',
    icon: Zap,
    commands: ['now', 'history', 'event', 'perm'],
  },
  ultimate: {
    label: 'Ultimate',
    color: '#ff2a5f',
    icon: Crown,
    commands: ['addstation', 'removestation', 'mystations', 'voiceguard'],
  },
};

function classifyCommand(command) {
  const tierFromApi = String(command?.tier || '').toLowerCase();
  if (tierFromApi && COMMAND_TIERS[tierFromApi]) return tierFromApi;

  const name = String(command?.name || command || '').replace(/^\//, '').toLowerCase();
  for (const [tier, config] of Object.entries(COMMAND_TIERS)) {
    if (config.commands.includes(name)) return tier;
  }
  return 'free';
}

function TierColumn({ tier, config, commands, expanded, onToggle, countLabel, translateCommandDescription }) {
  const Icon = config.icon;
  const tierCommands = commands.filter((command) => classifyCommand(command) === tier);
  const isCollapsed = !expanded;

  return (
    <div
      data-testid={`commands-tier-${tier}`}
      className="ui-lift"
      style={{
        flex: 1,
        minWidth: 280,
        borderRadius: 16,
        border: `1px solid ${config.color}20`,
        background: `${config.color}04`,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: `${config.color}08`,
          borderBottom: `1px solid ${config.color}15`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: `${config.color}12`,
            border: `1px solid ${config.color}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={18} color={config.color} />
          </div>
          <div>
            <div style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 13,
              fontWeight: 700,
              color: config.color,
              letterSpacing: '0.08em',
            }}>
              {config.label}
            </div>
            <div style={{ fontSize: 11, color: '#52525B', fontWeight: 600 }}>
              {countLabel({ count: tierCommands.length })}
            </div>
          </div>
        </div>
        {isCollapsed ? <ChevronDown size={16} color="#52525B" /> : <ChevronUp size={16} color="#52525B" />}
      </div>

      {!isCollapsed && (
        <div style={{ padding: '8px 0' }}>
          {tierCommands.map((command, index) => (
            <div
              key={`${command.name}-${index}`}
              data-testid={`command-${tier}-${index}`}
              style={{
                padding: '10px 20px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = `${config.color}06`;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: config.color,
                }}>
                  {command.name}
                </span>
                {command.args && (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      color: '#52525B',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    {command.args}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.5, margin: 0 }}>
                {translateCommandDescription(command.name, command.description)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Commands({ commands, loading }) {
  const { copy, translateCommandDescription } = useI18n();
  const items = Array.isArray(commands) ? commands : [];
  const [expanded, setExpanded] = useState({ free: false, pro: false, ultimate: false });

  const tierConfigs = useMemo(() => ({
    free: { ...COMMAND_TIERS.free, label: 'Free' },
    pro: { ...COMMAND_TIERS.pro, label: 'Pro' },
    ultimate: { ...COMMAND_TIERS.ultimate, label: 'Ultimate' },
  }), []);

  const toggleTier = (tier) => {
    setExpanded((current) => ({ ...current, [tier]: !current[tier] }));
  };

  return (
    <section
      id="commands"
      data-testid="commands-section"
      style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Terminal size={16} color="#ff2a5f" />
            <span style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#ff2a5f',
            }}>
              {copy.commands.eyebrow}
            </span>
          </div>
          <h2
            data-testid="commands-title"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginBottom: 12,
            }}
          >
            {copy.commands.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 600 }}>
            {copy.commands.subtitle}
          </p>
        </div>

        {loading && (
          <div style={{ padding: 40, color: '#52525B', fontSize: 14, textAlign: 'center' }}>
            {copy.commands.loading}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div style={{ padding: 40, color: '#52525B', fontSize: 14, textAlign: 'center' }}>
            {copy.commands.empty}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(tierConfigs).map(([tier, config]) => (
              <TierColumn
                key={tier}
                tier={tier}
                config={config}
                commands={items}
                expanded={expanded[tier]}
                onToggle={() => toggleTier(tier)}
                countLabel={copy.commands.countLabel}
                translateCommandDescription={translateCommandDescription}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default Commands;
