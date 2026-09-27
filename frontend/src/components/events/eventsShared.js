// OmniFM: server dashboard events: form rows and inputs, repeat and Discord sync labels, the preview.
// Split out of frontend/src/components/DashboardEvents.js (#296).
import { DASHBOARD_EVENT_REPEAT_OPTIONS } from '../../lib/dashboardEvents.js';

export function InputRow({ label, children, testId }) {
  return (
    <div data-testid={testId}>
      <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</label>
      {children}
    </div>
  );
}

export function SelectInput({ value, onChange, options, testId, placeholder }) {
  return (
    <select data-testid={testId} value={value} onChange={onChange} style={{
      width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
    }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

export function TextInput({ value, onChange, placeholder, testId, type = 'text' }) {
  return (
    <input data-testid={testId} type={type} value={value} onChange={onChange} placeholder={placeholder} style={{
      width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
    }} />
  );
}

export function resolveRepeatLabel(repeat, t) {
  const option = DASHBOARD_EVENT_REPEAT_OPTIONS.find((entry) => entry.value === (repeat || 'none'));
  return option ? t(option.de, option.en) : (repeat || 'none');
}

export function getDiscordSyncState(event, t) {
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

export function buildEventPreviewValues(eventLike, voiceName, formatDate, t) {
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
