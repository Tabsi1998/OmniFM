import React, { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';

const ACTION_VARIANTS = {
  primary: {
    border: '1px solid rgba(0,229,255,0.35)',
    background: 'rgba(0,229,255,0.14)',
    color: '#F4FDFF',
  },
  subtle: {
    border: '1px solid #1F2937',
    background: '#050505',
    color: '#D4D4D8',
  },
  premium: {
    border: '1px solid rgba(139,92,246,0.35)',
    background: 'rgba(91,33,182,0.16)',
    color: '#F5F3FF',
  },
};

function resolveActionStyle(variant) {
  return ACTION_VARIANTS[variant] || ACTION_VARIANTS.subtle;
}

export default function DashboardOnboardingHint({
  hint,
  t,
  dataTestId = 'dashboard-onboarding-hint',
  actions = [],
}) {
  const [copiedCommand, setCopiedCommand] = useState('');

  if (!hint) return null;

  const handleCopyCommand = async () => {
    const normalizedCommand = String(hint.command || '').trim();
    if (!normalizedCommand || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(normalizedCommand);
      setCopiedCommand(normalizedCommand);
      window.setTimeout(() => {
        setCopiedCommand((current) => (current === normalizedCommand ? '' : current));
      }, 1800);
    } catch {}
  };

  return (
    <div data-testid={dataTestId} style={{
      border: '1px solid rgba(0,229,255,0.16)',
      background: 'linear-gradient(180deg, rgba(0,229,255,0.08), rgba(5,5,5,0.94))',
      padding: '14px 16px',
      display: 'grid',
      gap: 12,
    }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 11, color: '#00e5ff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {hint.eyebrow || t('Naechste Aktion', 'Next action')}
        </div>
        <strong style={{ color: '#F4FDFF', fontSize: 16 }}>{hint.title}</strong>
        <p style={{ color: '#B6C8CC', fontSize: 13, lineHeight: 1.65, margin: 0 }}>
          {hint.body}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {hint.inviteUrl ? (
          <a
            data-testid={`${dataTestId}-invite`}
            href={hint.inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...resolveActionStyle('primary'),
              padding: '10px 12px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <ExternalLink size={14} />
            {hint.inviteLabel || t('Einladen', 'Invite')}
          </a>
        ) : null}

        {hint.command ? (
          <button
            type="button"
            data-testid={`${dataTestId}-copy-command`}
            onClick={handleCopyCommand}
            style={{
              ...resolveActionStyle('subtle'),
              padding: '10px 12px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Copy size={14} />
            {copiedCommand === hint.command
              ? t('Befehl kopiert', 'Command copied')
              : hint.commandLabel || t(`Befehl kopieren: ${hint.command}`, `Copy command: ${hint.command}`)}
          </button>
        ) : null}

        {actions.map((action, index) => {
          const style = resolveActionStyle(action.variant);
          if (action.href) {
            return (
              <a
                key={`${action.label}-${index}`}
                data-testid={action.testId}
                href={action.href}
                target={action.external ? '_blank' : undefined}
                rel={action.external ? 'noopener noreferrer' : undefined}
                style={{
                  ...style,
                  padding: '10px 12px',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {action.label}
              </a>
            );
          }
          return (
            <button
              key={`${action.label}-${index}`}
              type="button"
              data-testid={action.testId}
              onClick={action.onClick}
              style={{
                ...style,
                padding: '10px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {action.label}
            </button>
          );
        })}
      </div>

      {hint.note ? (
        <div style={{ color: '#71717A', fontSize: 12 }}>
          {hint.note}
        </div>
      ) : null}
    </div>
  );
}
