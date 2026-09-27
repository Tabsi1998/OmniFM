// OmniFM: server dashboard events: one event as a card.
// Split out of frontend/src/components/DashboardEvents.js (#296).
import { useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Hash,
  PencilLine,
  Power,
  PowerOff,
  Repeat,
  Trash2,
} from 'lucide-react';
import {
  buildDiscordEventDescriptionPreview,
  getDashboardRepeatLabel,
  renderDiscordMarkdown,
  renderEventTemplate,
} from '../../lib/dashboardEvents.js';
import {
  buildEventPreviewValues,
  getDiscordSyncState,
  resolveRepeatLabel,
} from './eventsShared.js';

export function EventCard({ event, onToggle, onDelete, onEdit, t, formatDate, voiceChannels, textChannels, serverEmojis }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = event.enabled !== false;
  const isPast = event.startsAt && new Date(event.startsAt) < new Date();
  const voiceName = voiceChannels?.find((channel) => channel.id === event.channelId)?.name || event.channelId || '-';
  const textName = textChannels?.find((channel) => channel.id === event.textChannelId)?.name || event.textChannelId || '';
  const syncState = getDiscordSyncState(event, t);
  const previewValues = buildEventPreviewValues({
    ...event,
    stationName: event.stationName || event.stationKey,
  }, voiceName, formatDate, t);
  const announcementPreview = renderEventTemplate(event.announceMessage, previewValues);
  const descriptionPreview = buildDiscordEventDescriptionPreview(event.description, previewValues.station, {
    detailsPrefix: t('OmniFM Auto-Event | Station', 'OmniFM auto event | Station'),
  });

  const repeatLabel = event?.repeatLabelDe || event?.repeatLabelEn
    ? t(event.repeatLabelDe || resolveRepeatLabel(event.repeat, t), event.repeatLabelEn || resolveRepeatLabel(event.repeat, t))
    : getDashboardRepeatLabel(event.repeat, t('de', 'en'), {
      startsAt: event.startsAtLocal || event.startsAt,
    });

  return (
    <div data-testid={`event-card-${event.id}`} style={{
      border: '1px solid', borderColor: isActive ? '#1A1A2E' : '#27272A',
      background: isActive ? '#0A0A0A' : '#080808', padding: '12px 14px', opacity: isActive ? 1 : 0.7,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <CalendarDays size={16} color={isActive ? '#5865F2' : '#52525B'} style={{ flexShrink: 0 }} />
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title || t('Unbenanntes Event', 'Untitled event')}
          </strong>
          {isPast && <span style={{ fontSize: 10, color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 6px', flexShrink: 0 }}>{t('Vergangen', 'Past')}</span>}
          {event.repeat && event.repeat !== 'none' && (
            <span style={{ fontSize: 10, color: '#06B6D4', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 6px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Repeat size={10} /> {repeatLabel}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button data-testid={`event-expand-${event.id}`} onClick={() => setExpanded((current) => !current)} style={{ border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button data-testid={`event-edit-${event.id}`} onClick={() => onEdit(event)} style={{
            border: '1px solid rgba(88,101,242,0.4)', background: 'rgba(88,101,242,0.1)', color: '#A5B4FC', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}>
            <PencilLine size={14} />
          </button>
          <button data-testid={`event-toggle-${event.id}`} onClick={() => onToggle(event.id, !isActive)} style={{
            border: '1px solid', borderColor: isActive ? 'rgba(16,185,129,0.4)' : '#27272A',
            background: isActive ? 'rgba(16,185,129,0.1)' : 'transparent', color: isActive ? '#10B981' : '#71717A', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}>
            {isActive ? <Power size={14} /> : <PowerOff size={14} />}
          </button>
          <button data-testid={`event-delete-${event.id}`} onClick={() => onDelete(event.id)} style={{
            border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#EF4444', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: '#71717A' }}>
        <span>{t('Station', 'Station')}: <span style={{ color: '#A1A1AA' }}>{event.stationKey || '-'}</span></span>
        <span><Hash size={11} style={{ verticalAlign: '-1px' }} /> <span style={{ color: '#A1A1AA' }}>{voiceName}</span></span>
        <span>
          <Clock size={11} style={{ verticalAlign: '-1px' }} />{' '}
          <span style={{ color: '#A1A1AA' }}>
            {event.startsAt ? formatDate(event.startsAt, { timeZone: event.timezone || undefined, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
          </span>
        </span>
        {event.durationMs > 0 && <span>{t('Dauer', 'Duration')}: <span style={{ color: '#A1A1AA' }}>{Math.round(event.durationMs / 60000)}min</span></span>}
      </div>

      {expanded && (
        <div style={{ marginTop: 10, padding: '10px 0 0', borderTop: '1px solid #1A1A2E', fontSize: 13, display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <div><span style={{ color: '#52525B' }}>{t('ID', 'ID')}:</span> <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#A1A1AA', fontSize: 11 }}>{event.id}</span></div>
            <div><span style={{ color: '#52525B' }}>{t('Zeitzone', 'Time zone')}:</span> <span style={{ color: '#A1A1AA' }}>{event.timezone || '-'}</span></div>
            {textName && <div><span style={{ color: '#52525B' }}>{t('Text-Channel', 'Text channel')}:</span> <span style={{ color: '#A1A1AA' }}>#{textName}</span></div>}
            <div><span style={{ color: '#52525B' }}>{t('Discord-Sync', 'Discord sync')}:</span> <span style={{ color: syncState.color }}>{syncState.label}</span></div>
            {event.discordScheduledEventId && <div><span style={{ color: '#52525B' }}>{t('Discord-Event-ID', 'Discord event ID')}:</span> <span style={{ color: '#A1A1AA', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{event.discordScheduledEventId}</span></div>}
            {event.stageTopic && <div><span style={{ color: '#52525B' }}>{t('Stage-Thema', 'Stage topic')}:</span> <span style={{ color: '#A1A1AA' }}>{event.stageTopic}</span></div>}
          </div>

          {event.discordSyncError && (
            <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{event.discordSyncError}</span>
            </div>
          )}

          {event.announceMessage && (
            <div>
              <span style={{ color: '#52525B' }}>{t('Nachrichten-Vorschau', 'Message preview')}:</span>
              <div style={{ marginTop: 4, background: '#050505', border: '1px solid #1A1A2E', padding: '10px 12px', color: '#D4D4D8' }}>
                <div dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(announcementPreview, { serverEmojis }) }} />
              </div>
            </div>
          )}

          {event.description && (
            <div>
              <span style={{ color: '#52525B' }}>{t('Discord-Event-Beschreibung', 'Discord event description')}:</span>
              <div style={{ marginTop: 4, background: '#050505', border: '1px solid #1A1A2E', padding: '10px 12px', color: '#A1A1AA' }}>
                <div dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(descriptionPreview, { serverEmojis }) }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
