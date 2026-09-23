import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Hash,
  PencilLine,
  Plus,
  Power,
  PowerOff,
  Repeat,
  Trash2,
} from 'lucide-react';
import RichMessageEditor from './RichMessageEditor.js';
import {
  applyDashboardEventTemplate,
  applyDashboardSchedulePreset,
  buildDashboardEventTemplatePresets,
  buildDashboardSchedulePresets,
  buildDiscordEventDescriptionPreview,
  DASHBOARD_EVENT_REPEAT_OPTIONS,
  DASHBOARD_EVENT_TIMEZONE_OPTIONS,
  getDashboardRepeatLabel,
  renderDiscordMarkdown,
  renderEventTemplate,
} from '../lib/dashboardEvents.js';
import { buildDashboardEventsHint as buildEventsOnboardingHint } from '../lib/dashboardOnboarding.js';
import DashboardOnboardingHint from './DashboardOnboardingHint.js';

function InputRow({ label, children, testId }) {
  return (
    <div data-testid={testId}>
      <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</label>
      {children}
    </div>
  );
}

function SelectInput({ value, onChange, options, testId, placeholder }) {
  return (
    <select data-testid={testId} value={value} onChange={onChange} style={{
      width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
    }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function TextInput({ value, onChange, placeholder, testId, type = 'text' }) {
  return (
    <input data-testid={testId} type={type} value={value} onChange={onChange} placeholder={placeholder} style={{
      width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
    }} />
  );
}

function resolveRepeatLabel(repeat, t) {
  const option = DASHBOARD_EVENT_REPEAT_OPTIONS.find((entry) => entry.value === (repeat || 'none'));
  return option ? t(option.de, option.en) : (repeat || 'none');
}

function getDiscordSyncState(event, t) {
  if (!event?.createDiscordEvent) {
    return { label: t('Aus', 'Off'), color: '#71717A' };
  }
  if (event?.discordSyncError) {
    return { label: t('Fehlgeschlagen', 'Failed'), color: '#FCA5A5' };
  }
  if (event?.discordEventSynced) {
    return { label: t('Synchronisiert', 'Synced'), color: '#10B981' };
  }
  if (event?.enabled === false) {
    return { label: t('Wird beim Aktivieren erstellt', 'Will sync when enabled'), color: '#F59E0B' };
  }
  return { label: t('Ausstehend', 'Pending'), color: '#06B6D4' };
}

function buildEventPreviewValues(eventLike, voiceName, formatDate, t) {
  const fallbackStart = t('05.03.2026 20:00', 'Mar 5, 2026 8:00 PM');
  const fallbackEnd = t('05.03.2026 22:00', 'Mar 5, 2026 10:00 PM');
  const timeZone = eventLike?.timezone || 'Europe/Vienna';
  const voiceLabel = voiceName ? `#${voiceName}` : '#radio-lounge';

  let time = fallbackStart;
  let end = fallbackEnd;
  if (eventLike?.startsAt) {
    const parsed = new Date(eventLike.startsAt);
    if (!Number.isNaN(parsed.getTime())) {
      time = formatDate(parsed, {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const durationMs = Number(eventLike?.durationMs || 0) || 0;
      if (durationMs > 0) {
        end = formatDate(new Date(parsed.getTime() + durationMs), {
          timeZone,
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } else {
        end = '-';
      }
    }
  }

  return {
    event: eventLike?.title || t('OmniFM Event', 'OmniFM Event'),
    station: eventLike?.stationName || eventLike?.stationKey || t('Sendername', 'Station name'),
    voice: voiceLabel,
    time,
    end,
    timeZone,
  };
}

function EventCard({ event, onToggle, onDelete, onEdit, t, formatDate, voiceChannels, textChannels, serverEmojis }) {
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

export default function DashboardEvents({
  events,
  eventForm,
  setEventForm,
  editingEventId,
  onSaveEvent,
  onToggleEvent,
  onDeleteEvent,
  onStartEditEvent,
  onCancelEditEvent,
  t,
  formatDate,
  apiRequest,
  selectedGuildId,
  setupStatus = null,
  inviteLinks = null,
  prefetchedDependencies = null,
}) {
  const [showForm, setShowForm] = useState(false);
  const [voiceChannels, setVoiceChannels] = useState([]);
  const [textChannels, setTextChannels] = useState([]);
  const [stations, setStations] = useState({ free: [], pro: [], ultimate: [], custom: [] });
  const [serverEmojis, setServerEmojis] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadingDependencies, setLoadingDependencies] = useState(false);
  const loadTokenRef = useRef(0);
  const previewTokenRef = useRef(0);

  const loadChannelsAndStations = useCallback(async () => {
    const loadToken = ++loadTokenRef.current;
    if (!selectedGuildId) {
      setVoiceChannels([]);
      setTextChannels([]);
      setStations({ free: [], pro: [], ultimate: [], custom: [] });
      setServerEmojis([]);
      return;
    }
    setVoiceChannels([]);
    setTextChannels([]);
    setStations({ free: [], pro: [], ultimate: [], custom: [] });
    setServerEmojis([]);
    setLoadingDependencies(true);
    try {
      const prefetchedChannels = prefetchedDependencies && Array.isArray(prefetchedDependencies.voiceChannels)
        ? {
          voiceChannels: prefetchedDependencies.voiceChannels,
          textChannels: Array.isArray(prefetchedDependencies.textChannels) ? prefetchedDependencies.textChannels : [],
        }
        : null;
      const prefetchedStations = prefetchedDependencies?.stations && typeof prefetchedDependencies.stations === 'object'
        ? prefetchedDependencies.stations
        : null;
      const [channelResult, stationResult, emojiResult] = await Promise.all([
        prefetchedChannels || apiRequest(`/api/dashboard/channels?serverId=${encodeURIComponent(selectedGuildId)}`),
        prefetchedStations || apiRequest(`/api/dashboard/stations?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/emojis?serverId=${encodeURIComponent(selectedGuildId)}`),
      ]);
      if (loadToken !== loadTokenRef.current) return;
      setVoiceChannels(channelResult.voiceChannels || []);
      setTextChannels(channelResult.textChannels || []);
      setStations({
        free: stationResult.free || [],
        pro: stationResult.pro || [],
        ultimate: stationResult.ultimate || [],
        custom: stationResult.custom || [],
      });
      setServerEmojis(emojiResult.emojis || []);
    } catch {
      if (loadToken !== loadTokenRef.current) return;
      setVoiceChannels([]);
      setTextChannels([]);
      setStations({ free: [], pro: [], ultimate: [], custom: [] });
      setServerEmojis([]);
    } finally {
      if (loadToken === loadTokenRef.current) setLoadingDependencies(false);
    }
  }, [selectedGuildId, apiRequest, prefetchedDependencies]);

  useEffect(() => { loadChannelsAndStations(); }, [loadChannelsAndStations]);
  useEffect(() => { if (editingEventId) setShowForm(true); }, [editingEventId]);

  const stationOptions = useMemo(() => ([
    ...(stations.custom.length > 0 ? [{ value: '', label: `--- ${t('Custom-Stationen', 'Custom stations')} ---`, disabled: true }] : []),
    ...stations.custom.map((station) => ({ value: `custom:${station.key}`, label: `${station.name} (${t('Custom', 'Custom')})` })),
    { value: '', label: `--- ${t('Free-Stationen', 'Free stations')} ---`, disabled: true },
    ...stations.free.map((station) => ({ value: station.key, label: station.name })),
    ...(stations.pro.length > 0 ? [{ value: '', label: `--- ${t('Pro-Stationen', 'Pro stations')} ---`, disabled: true }] : []),
    ...stations.pro.map((station) => ({ value: station.key, label: `${station.name} (Pro)` })),
    ...(stations.ultimate.length > 0 ? [{ value: '', label: `--- ${t('Ultimate-Stationen', 'Ultimate stations')} ---`, disabled: true }] : []),
    ...stations.ultimate.map((station) => ({ value: station.key, label: `${station.name} (Ultimate)` })),
  ]), [stations.custom, stations.free, stations.pro, stations.ultimate, t]);

  const selectedStationLabel = useMemo(() => {
    const directMatch = [...stations.custom, ...stations.free, ...stations.pro, ...stations.ultimate].find((station) => {
      if (`custom:${station.key}` === eventForm.stationKey) return true;
      return station.key === eventForm.stationKey;
    });
    return directMatch?.name || eventForm.stationKey || t('Sendername', 'Station name');
  }, [eventForm.stationKey, stations.custom, stations.free, stations.pro, stations.ultimate, t]);

  const selectedVoiceName = useMemo(
    () => voiceChannels.find((channel) => channel.id === eventForm.channelId)?.name || '',
    [eventForm.channelId, voiceChannels]
  );

  const previewValues = useMemo(() => {
    const startInput = String(eventForm.startsAt || '').trim();
    const durationMinutes = Math.max(0, Number(eventForm.durationMinutes || 0) || 0);
    const startsAt = startInput ? `${startInput}:00` : '';
    return buildEventPreviewValues({
      title: eventForm.title || t('OmniFM Event', 'OmniFM Event'),
      stationName: selectedStationLabel,
      startsAt,
      timezone: eventForm.timezone,
      durationMs: durationMinutes > 0 ? durationMinutes * 60000 : 0,
    }, selectedVoiceName, formatDate, t);
  }, [eventForm.durationMinutes, eventForm.startsAt, eventForm.timezone, eventForm.title, formatDate, selectedStationLabel, selectedVoiceName, t]);

  const descriptionPreview = useMemo(
    () => buildDiscordEventDescriptionPreview(eventForm.description, selectedStationLabel, {
      detailsPrefix: t('OmniFM Auto-Event | Station', 'OmniFM auto event | Station'),
    }),
    [eventForm.description, selectedStationLabel, t]
  );
  const previewScheduleRows = Array.isArray(previewData?.schedule?.nextRuns) ? previewData.schedule.nextRuns : [];
  const previewConflicts = Array.isArray(previewData?.conflicts) ? previewData.conflicts : [];
  const previewRepeatLabel = previewData?.schedule
    ? t(
      previewData.schedule.repeatLabelDe || 'Einmalig',
      previewData.schedule.repeatLabelEn || 'One-time'
    )
    : '';

  useEffect(() => {
    const durationMinutes = Math.max(0, Number(eventForm.durationMinutes || 0) || 0);
    const hasRequiredFields = Boolean(
      showForm
      && selectedGuildId
      && String(eventForm.title || '').trim()
      && String(eventForm.stationKey || '').trim()
      && String(eventForm.channelId || '').trim()
      && String(eventForm.startsAt || '').trim()
    );

    if (!hasRequiredFields) {
      previewTokenRef.current += 1;
      setPreviewData(null);
      setPreviewError('');
      setPreviewLoading(false);
      return undefined;
    }

    const previewToken = ++previewTokenRef.current;
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const payload = await apiRequest(`/api/dashboard/events/preview?serverId=${encodeURIComponent(selectedGuildId)}`, {
          method: 'POST',
          body: JSON.stringify({
            eventId: editingEventId || '',
            ...eventForm,
            startsAtLocal: eventForm.startsAt,
            durationMs: durationMinutes > 0 ? durationMinutes * 60000 : 0,
          }),
        });
        if (previewToken !== previewTokenRef.current) return;
        setPreviewData(payload);
        setPreviewError('');
      } catch (err) {
        if (previewToken !== previewTokenRef.current) return;
        setPreviewData(null);
        setPreviewError(err.message || t('Vorschau konnte nicht geladen werden.', 'Preview could not be loaded.'));
      } finally {
        if (previewToken === previewTokenRef.current) {
          setPreviewLoading(false);
        }
      }
    }, 250);

    return () => {
      previewTokenRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [apiRequest, editingEventId, eventForm, selectedGuildId, showForm, t]);

  const handleSave = useCallback(async () => {
    const result = await onSaveEvent();
    if (result?.ok) {
      setShowForm(false);
    }
  }, [onSaveEvent]);

  const handleCancel = useCallback(() => {
    onCancelEditEvent();
    setShowForm(false);
  }, [onCancelEditEvent]);

  const isEditing = Boolean(editingEventId);
  const repeatOptions = useMemo(
    () => DASHBOARD_EVENT_REPEAT_OPTIONS.map((option) => ({
      value: option.value,
      label: option.value === 'none'
        ? t(option.de, option.en)
        : getDashboardRepeatLabel(option.value, t('de', 'en'), { startsAt: eventForm.startsAt }),
    })),
    [eventForm.startsAt, t]
  );
  const eventTemplatePresets = useMemo(() => buildDashboardEventTemplatePresets(t), [t]);
  const schedulePresets = useMemo(() => buildDashboardSchedulePresets(t), [t]);
  const onboardingHint = useMemo(
    () => buildEventsOnboardingHint({
      setupStatus,
      inviteLinks,
      hasEvents: events.length > 0,
      voiceChannelCount: loadingDependencies ? 1 : voiceChannels.length,
      t,
    }),
    [events.length, inviteLinks, loadingDependencies, setupStatus, t, voiceChannels.length]
  );

  return (
    <section data-testid="dashboard-events-panel" style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>
            {t('Events', 'Events')} <span style={{ color: '#52525B', fontSize: 14 }}>({events.length})</span>
          </h3>
          <button data-testid="event-toggle-form-btn" onClick={() => {
            if (showForm && !isEditing) {
              handleCancel();
              return;
            }
            setShowForm((current) => !current || isEditing);
          }} style={{
            border: '1px solid #5865F2', background: showForm ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: '#fff', height: 36, padding: '0 14px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
          }}>
            <Plus size={14} /> {showForm ? t('Formular offen', 'Form open') : t('Neues Event', 'New event')}
          </button>
        </div>

        {!showForm && onboardingHint && (
          <div style={{ marginTop: 14 }}>
            <DashboardOnboardingHint
              hint={onboardingHint}
              t={t}
              dataTestId="dashboard-events-onboarding-hint"
              actions={
                setupStatus?.workerInvited === true && voiceChannels.length > 0
                  ? [{
                    label: t('Erstes Event erstellen', 'Create first event'),
                    onClick: () => setShowForm(true),
                    testId: 'dashboard-events-create-first',
                    variant: 'primary',
                  }]
                  : []
              }
            />
          </div>
        )}

        {showForm && (
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ color: '#A1A1AA', fontSize: 13 }}>
                {isEditing ? t('Event bearbeiten', 'Edit event') : t('Neues Event anlegen', 'Create new event')}
              </div>
              <div style={{ color: '#52525B', fontSize: 12 }}>
                {t('Der Synchronisationsstatus zeigt, ob das Discord-Server-Event vom Commander bestätigt wurde.', 'The sync status shows whether the Discord server event was confirmed by the Commander.')}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div
                data-testid="event-template-presets"
                style={{
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  padding: 14,
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                      {t('Event-Templates', 'Event templates')}
                    </div>
                    <div style={{ color: '#71717A', fontSize: 12, marginTop: 4 }}>
                      {t(
                        'Fuellt Titel, Dauer, Discord-Nachricht und Beschreibung mit einer Vorlage.',
                        'Fills title, duration, Discord message and description from a template.'
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {eventTemplatePresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`event-template-${preset.id}`}
                      onClick={() => setEventForm((current) => applyDashboardEventTemplate(current, preset))}
                      style={{
                        border: '1px solid rgba(88,101,242,0.24)',
                        background: 'rgba(88,101,242,0.08)',
                        color: '#fff',
                        padding: '12px 12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{preset.label}</span>
                      <span style={{ fontSize: 12, color: '#A1A1AA', lineHeight: 1.5 }}>{preset.summary}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div
                data-testid="event-schedule-presets"
                style={{
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  padding: 14,
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                    {t('Termin-Presets', 'Schedule presets')}
                  </div>
                  <div style={{ color: '#71717A', fontSize: 12, marginTop: 4 }}>
                    {t(
                      'Setzt Startzeit und Wiederholung für häufige Event-Muster.',
                      'Sets start time and recurrence for common event patterns.'
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {schedulePresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`event-schedule-preset-${preset.id}`}
                      onClick={() => setEventForm((current) => applyDashboardSchedulePreset(current, preset))}
                      style={{
                        border: '1px solid rgba(6,182,212,0.24)',
                        background: 'rgba(8,145,178,0.08)',
                        color: '#fff',
                        padding: '12px 12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{preset.label}</span>
                      <span style={{ fontSize: 12, color: '#A1A1AA', lineHeight: 1.5 }}>{preset.summary}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <InputRow label={t('Titel', 'Title')}>
                <TextInput testId="event-title-input" value={eventForm.title} onChange={(e) => setEventForm((current) => ({ ...current, title: e.target.value }))} placeholder={t('z.B. Abend-Radio', 'e.g. Evening Radio')} />
              </InputRow>

              <InputRow label={t('Station', 'Station')}>
                <select data-testid="event-station-select" value={eventForm.stationKey} onChange={(e) => setEventForm((current) => ({ ...current, stationKey: e.target.value }))} style={{
                  width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
                }}>
                  <option value="">{t('Station wählen...', 'Select station...')}</option>
                  {stationOptions.map((option, index) => (
                    option.disabled
                      ? <option key={`${option.label}-${index}`} disabled style={{ color: '#52525B' }}>{option.label}</option>
                      : <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </InputRow>

              <InputRow label={t('Voice-Channel', 'Voice channel')}>
                <select data-testid="event-voice-select" value={eventForm.channelId} onChange={(e) => setEventForm((current) => ({ ...current, channelId: e.target.value }))} style={{
                  width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
                }}>
                  <option value="">{t('Voice-Channel wählen...', 'Select voice channel...')}</option>
                  {voiceChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>{channel.parentName ? `${channel.parentName} / ` : ''}{channel.name} {channel.type === 'stage' ? '(Stage)' : ''}</option>
                  ))}
                </select>
              </InputRow>

              <InputRow label={t('Text-Channel (Ankündigung)', 'Text channel (announcement)')}>
                <select data-testid="event-text-channel-select" value={eventForm.textChannelId || ''} onChange={(e) => setEventForm((current) => ({ ...current, textChannelId: e.target.value }))} style={{
                  width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
                }}>
                  <option value="">{t('Kein Ankündigungs-Channel', 'No announcement channel')}</option>
                  {textChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>{channel.parentName ? `${channel.parentName} / ` : ''}#{channel.name}</option>
                  ))}
                </select>
              </InputRow>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <InputRow label={t('Startzeit', 'Start time')}>
                <TextInput testId="event-starts-at-input" type="datetime-local" value={eventForm.startsAt} onChange={(e) => setEventForm((current) => ({ ...current, startsAt: e.target.value }))} />
              </InputRow>

              <InputRow label={t('Dauer (Minuten, 0 = unbegrenzt)', 'Duration (minutes, 0 = unlimited)')}>
                <TextInput testId="event-duration-input" type="number" value={eventForm.durationMinutes || ''} onChange={(e) => setEventForm((current) => ({ ...current, durationMinutes: e.target.value }))} placeholder="0" />
              </InputRow>

              <InputRow label={t('Wiederholung', 'Repeat')}>
                <SelectInput testId="event-repeat-select" value={eventForm.repeat || 'none'} onChange={(e) => setEventForm((current) => ({ ...current, repeat: e.target.value }))} options={repeatOptions} />
              </InputRow>

              <InputRow label={t('Zeitzone', 'Time zone')}>
                <SelectInput testId="event-timezone-select" value={eventForm.timezone || 'Europe/Vienna'} onChange={(e) => setEventForm((current) => ({ ...current, timezone: e.target.value }))} options={DASHBOARD_EVENT_TIMEZONE_OPTIONS.map((timeZone) => ({ value: timeZone, label: timeZone }))} />
              </InputRow>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <InputRow label={t('Stage-Thema', 'Stage topic')}>
                <TextInput testId="event-stage-topic-input" value={eventForm.stageTopic || ''} onChange={(e) => setEventForm((current) => ({ ...current, stageTopic: e.target.value }))} placeholder={t('Optional, Platzhalter wie {event} oder {station} sind erlaubt', 'Optional, placeholders like {event} or {station} are supported')} />
              </InputRow>

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, padding: '0 0 4px' }}>
                <label data-testid="event-discord-event-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={eventForm.createDiscordEvent || false} onChange={(e) => setEventForm((current) => ({ ...current, createDiscordEvent: e.target.checked }))} style={{ width: 16, height: 16, accentColor: '#5865F2' }} />
                  {t('Discord Server-Event erstellen', 'Create Discord server event')}
                </label>
              </div>
            </div>

            <RichMessageEditor
              testId="event-message-editor"
              value={eventForm.announceMessage || ''}
              onChange={(nextValue) => setEventForm((current) => ({ ...current, announceMessage: nextValue }))}
              t={t}
              apiRequest={apiRequest}
              selectedGuildId={selectedGuildId}
              serverEmojis={serverEmojis}
              previewValues={previewValues}
            />

            <RichMessageEditor
              testId="event-description-editor"
              value={eventForm.description || ''}
              onChange={(nextValue) => setEventForm((current) => ({ ...current, description: nextValue }))}
              t={t}
              apiRequest={apiRequest}
              selectedGuildId={selectedGuildId}
              serverEmojis={serverEmojis}
              label={t('Beschreibung (Discord-Event)', 'Description (Discord event)')}
              placeholderText={t('Beschreibung für das Discord-Server-Event. Die Vorschau rendert Custom-Emojis, Markdown und den automatisch angehängten Stations-Hinweis.', 'Description for the Discord server event. The preview renders custom emojis, markdown and the automatically appended station note.')}
              previewText={descriptionPreview}
              previewAsMarkdown={true}
              placeholders={[]}
              showToolbar={true}
              emptyPreviewText={t('Keine Beschreibung', 'No description')}
            />

            <div
              data-testid="event-schedule-preview"
              style={{
                border: '1px solid #1A1A2E',
                background: '#050505',
                padding: 14,
                display: 'grid',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Clock size={16} color="#A5B4FC" />
                  <div>
                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                      {t('Zeitplan-Vorschau', 'Schedule preview')}
                    </div>
                    <div style={{ color: '#71717A', fontSize: 12 }}>
                      {previewData
                        ? previewRepeatLabel
                        : t(
                          'Wird automatisch aktualisiert, sobald die Pflichtfelder gesetzt sind.',
                          'Updates automatically once the required fields are filled in.'
                        )}
                    </div>
                  </div>
                </div>
                {previewLoading && (
                  <div style={{ color: '#A5B4FC', fontSize: 12 }}>
                    {t('Aktualisiere Vorschau...', 'Updating preview...')}
                  </div>
                )}
              </div>

              {previewError && (
                <div
                  data-testid="event-preview-error"
                  style={{
                    border: '1px solid rgba(252,165,165,0.25)',
                    background: 'rgba(127,29,29,0.12)',
                    padding: '10px 12px',
                    color: '#FCA5A5',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{previewError}</span>
                </div>
              )}

              {!previewError && previewData && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    {previewScheduleRows.map((row, index) => (
                      <div
                        key={`${row.startsAt || row.runAtMs || index}-${index}`}
                        data-testid={`event-preview-run-${index}`}
                        style={{
                          border: '1px solid #1A1A2E',
                          background: '#0A0A0A',
                          padding: '10px 12px',
                          display: 'grid',
                          gap: 4,
                        }}
                      >
                        <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {index === 0 ? t('Nächster Start', 'Next start') : t('Weitere Ausführung', 'Upcoming run')}
                        </div>
                        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                          {row.startsAtLocal || row.startsAt || '-'}
                        </div>
                        <div style={{ color: '#71717A', fontSize: 12 }}>
                          {row.endsAtLocal
                            ? t(`Endet ${row.endsAtLocal}`, `Ends ${row.endsAtLocal}`)
                            : t('Ohne Endzeit', 'No end time')}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div data-testid="event-preview-conflicts" style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 14, fontWeight: 600 }}>
                      <AlertTriangle size={15} color={previewConflicts.length > 0 ? '#FCA5A5' : '#10B981'} />
                      {t('Konfliktprüfung', 'Conflict check')}
                    </div>
                    {previewConflicts.length > 0 ? previewConflicts.map((conflict, index) => (
                      <div
                        key={`${conflict.eventId || 'conflict'}-${index}`}
                        data-testid={`event-preview-conflict-${index}`}
                        style={{
                          border: `1px solid ${conflict.severity === 'error' ? 'rgba(252,165,165,0.25)' : 'rgba(245,158,11,0.25)'}`,
                          background: conflict.severity === 'error' ? 'rgba(127,29,29,0.12)' : 'rgba(120,53,15,0.12)',
                          padding: '10px 12px',
                          display: 'grid',
                          gap: 4,
                        }}
                      >
                        <div style={{ color: conflict.severity === 'error' ? '#FCA5A5' : '#FCD34D', fontWeight: 600 }}>
                          {conflict.title || t('Bestehendes Event', 'Existing event')}
                        </div>
                        <div style={{ color: '#D4D4D8', fontSize: 13 }}>
                          {conflict.message}
                        </div>
                        <div style={{ color: '#71717A', fontSize: 12 }}>
                          {conflict.startsAtLocal || conflict.startsAt || '-'}
                          {conflict.endsAtLocal ? ` -> ${conflict.endsAtLocal}` : ` -> ${t('offen', 'open')}`}
                        </div>
                      </div>
                    )) : (
                      <div
                        data-testid="event-preview-conflict-free"
                        style={{
                          border: '1px solid rgba(16,185,129,0.25)',
                          background: 'rgba(6,78,59,0.12)',
                          padding: '10px 12px',
                          color: '#6EE7B7',
                        }}
                      >
                        {t(
                          'Keine Überschneidungen im gewählten Voice-Channel gefunden.',
                          'No overlaps found in the selected voice channel.'
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button data-testid="event-create-btn" onClick={handleSave} style={{
                height: 42, border: 'none', background: '#5865F2', color: '#fff', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em', fontSize: 14, padding: '0 18px',
              }}>
                {isEditing ? t('Event aktualisieren', 'Update event') : t('Event speichern', 'Save event')}
              </button>
              <button data-testid="event-cancel-btn" onClick={handleCancel} style={{
                height: 42, border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', cursor: 'pointer', letterSpacing: '0.02em', fontSize: 14, padding: '0 18px',
              }}>
                {t('Abbrechen', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {events.length === 0 && (
          <div data-testid="events-empty" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '40px 20px', textAlign: 'center' }}>
            <CalendarDays size={32} color="#27272A" style={{ margin: '0 auto' }} />
            <p style={{ color: '#52525B', marginTop: 10 }}>{t('Noch keine Events erstellt.', 'No events created yet.')}</p>
            <p style={{ color: '#3F3F46', marginTop: 4, fontSize: 13 }}>{t('Lege oben dein erstes Radio-Event an.', 'Create your first radio event above.')}</p>
          </div>
        )}
        {events.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            onToggle={onToggleEvent}
            onDelete={onDeleteEvent}
            onEdit={onStartEditEvent}
            t={t}
            formatDate={formatDate}
            voiceChannels={voiceChannels}
            textChannels={textChannels}
            serverEmojis={serverEmojis}
          />
        ))}
      </div>
    </section>
  );
}
