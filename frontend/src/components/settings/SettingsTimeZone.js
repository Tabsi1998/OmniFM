// OmniFM: server dashboard settings: the server's time zone (#425). The
// seasonal decoration and its midnight follow it; the choice is the events'.
import { Clock } from 'lucide-react';
import { DASHBOARD_EVENT_TIMEZONE_OPTIONS } from '../../lib/dashboardEvents.js';

export default function SettingsTimeZone({ serverTimeZone, setServerTimeZone, t }) {
  const current = serverTimeZone?.current || serverTimeZone?.default || 'Europe/Vienna';
  const options = DASHBOARD_EVENT_TIMEZONE_OPTIONS.includes(current)
    ? DASHBOARD_EVENT_TIMEZONE_OPTIONS
    : [current, ...DASHBOARD_EVENT_TIMEZONE_OPTIONS];
  return (
    <div data-testid="settings-time-zone" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Clock size={18} color="#00E5FF" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Zeitzone des Servers', 'Server time zone')}</h3>
      </div>
      <p style={{ color: '#8e8e97', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'Danach richten sich die Saison-Deko und ihre Mitternacht, zum Beispiel der Silvester-Countdown.',
          'The seasonal decoration and its midnight follow it, for example the New Year countdown.'
        )}
      </p>
      <select
        className="oa-input"
        data-testid="settings-time-zone-select"
        aria-label={t('Zeitzone des Servers', 'Server time zone')}
        value={current}
        onChange={(e) => setServerTimeZone(e.target.value)}
        style={{ width: '100%', height: 40 }}
      >
        {options.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
      </select>
    </div>
  );
}
