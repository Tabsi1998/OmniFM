// OmniFM: server dashboard settings: the seasonal decoration (#425), every
// plan. Each season and each part can be switched off; everything is on
// until the server says otherwise. A season the owner switched off for every
// server shows as such.
import { Sparkles } from 'lucide-react';
import { SEASONS, SEASON_PARTS, nextSeasonStart } from '../../../../src/lib/seasons.js';

// Every text as { de, en }, so the language tables find it (scripts/extract-ui-strings.mjs).
const SEASON_TEXT = {
  easter: { name: { de: 'Ostern', en: 'Easter' }, when: { de: 'Palmsonntag bis Ostermontag', en: 'Palm Sunday to Easter Monday' } },
  advent: { name: { de: 'Advent', en: 'Advent' }, when: { de: '1. Adventsonntag bis 23. Dezember, jeden Sonntag eine Kerze mehr', en: 'First Sunday of Advent to 23 December, one more candle every Sunday' } },
  christmas: { name: { de: 'Weihnachten', en: 'Christmas' }, when: { de: '24. bis 30. Dezember', en: '24 to 30 December' } },
  newyear: { name: { de: 'Silvester und Neujahr', en: 'New Year' }, when: { de: '31. Dezember und 1. Januar', en: '31 December and 1 January' } },
};

const PART_TEXT = {
  panel: { name: { de: 'Panel-Deko', en: 'Panel decoration' }, when: { de: 'Das Panel „Läuft gerade“ in der Saisonfarbe, mit einer Saison-Zeile.', en: 'The “Now playing” panel in the season’s colour, with a season line.' } },
  voiceStatus: { name: { de: 'Sprachkanal-Status', en: 'Voice channel status' }, when: { de: 'Ein Saison-Emoji vor dem Status des Sprachkanals.', en: 'A season emoji in front of the voice channel status.' } },
  adventCalendar: { name: { de: 'Adventskalender', en: 'Advent calendar' }, when: { de: 'Vom 1. bis 24. Dezember jeden Tag ein Türchen im Panel.', en: 'A door in the panel every day from 1 to 24 December.' } },
  eggHunt: { name: { de: 'Ostereiersuche', en: 'Easter egg hunt' }, when: { de: 'Versteckte Ostereier im Panel, mit Bestenliste.', en: 'Hidden Easter eggs in the panel, with a leaderboard.' } },
  countdown: { name: { de: 'Silvester-Countdown', en: 'New Year countdown' }, when: { de: 'Am 31. Dezember zeigt das Panel die Zeit bis Mitternacht.', en: 'On 31 December the panel shows the time until midnight.' } },
  newYearGreeting: { name: { de: 'Neujahrsgruß', en: 'New Year greeting' }, when: { de: 'Um Mitternacht eine Nachricht mit Feuerwerk im Panel-Kanal, nur wenn OmniFM dort gerade spielt.', en: 'At midnight a message with fireworks in the panel’s channel, only while OmniFM plays there.' } },
  seasonStations: { name: { de: 'Saison-Sender', en: 'Seasonal stations' }, when: { de: 'Eine Weihnachts- und eine Oster-Rubrik im Sender-Browser.', en: 'A Christmas and an Easter section in the station browser.' } },
};

const say = (t, text) => t(text.de, text.en);

function currentLabel(current, t) {
  if (!current) return '';
  const name = say(t, SEASON_TEXT[current.season].name);
  if (current.season === 'advent') return t('{name}, {count}. Kerze', '{name}, candle {count}', { name, count: current.candles });
  if (current.season === 'easter' && current.phase === 'soon') return t('Bald ist Ostern', 'Easter is coming');
  if (current.season === 'christmas' && current.phase === 'winter') return t('Winter-Deko nach Weihnachten', 'Winter look after Christmas');
  if (current.season === 'newyear' && current.phase === 'countdown') return t('Countdown bis {year}', 'Countdown to {year}', { year: current.year });
  return name;
}

function Switch({ testId, checked, disabled, onChange, title, description, note }) {
  return (
    <label data-testid={testId} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: 10, padding: '10px 12px', border: '1px solid #1A1A2E', background: '#050505', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ display: 'block', color: '#fff', fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span style={{ display: 'block', color: '#A1A1AA', fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{description}</span>
        {note ? <span style={{ display: 'block', color: '#FBBF24', fontSize: 12, marginTop: 4 }}>{note}</span> : null}
      </span>
    </label>
  );
}

export default function SettingsSeasons({ seasonDecor, timeZone, setSeasonDecor, t, formatDate }) {
  const seasons = seasonDecor?.seasons || {};
  const parts = seasonDecor?.parts || {};
  const ownerEnabled = seasonDecor?.ownerEnabled || {};
  const current = seasonDecor?.current || null;
  const next = nextSeasonStart(new Date(), timeZone);
  const nextIso = `${next.year}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`;
  const nextDate = typeof formatDate === 'function'
    ? formatDate(`${nextIso}T12:00:00Z`, { day: 'numeric', month: 'long', year: 'numeric' })
    : nextIso;
  const setSeason = (key, value) => setSeasonDecor({ seasons: { ...seasons, [key]: value }, parts });
  const setPart = (key, value) => setSeasonDecor({ seasons, parts: { ...parts, [key]: value } });

  return (
    <div data-testid="settings-seasons" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Sparkles size={18} color="#F472B6" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Saison-Deko', 'Seasonal decoration')}</h3>
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
        {t(
          'Zu Ostern, im Advent, zu Weihnachten und zu Silvester schmückt sich OmniFM von selbst, in jedem Plan. Schalte ab, was du nicht möchtest.',
          'At Easter, in Advent, at Christmas and on New Year’s Eve OmniFM decorates itself, in every plan. Switch off what you do not want.'
        )}
      </p>
      <div data-testid="settings-seasons-now" style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '10px 12px', marginBottom: 14, fontSize: 13, color: '#D4D4D8' }}>
        {current
          ? t('Gerade: {season}', 'Right now: {season}', { season: currentLabel(current, t) })
          : t('Gerade keine Saison. Als Nächstes: {season} ab {date}.', 'No season right now. Next: {season} from {date}.', {
            season: say(t, SEASON_TEXT[next.season].name),
            date: nextDate,
          })}
      </div>

      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A', marginBottom: 8 }}>{t('Saisons', 'Seasons')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 14 }}>
        {SEASONS.map((key) => (
          <Switch
            key={key}
            testId={`settings-season-${key}`}
            checked={seasons[key] !== false}
            disabled={ownerEnabled[key] === false}
            onChange={(value) => setSeason(key, value)}
            title={say(t, SEASON_TEXT[key].name)}
            description={say(t, SEASON_TEXT[key].when)}
            note={ownerEnabled[key] === false ? t('Vom Betreiber gerade für alle Server abgeschaltet.', 'Switched off for every server by the operator right now.') : ''}
          />
        ))}
      </div>

      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A', marginBottom: 8 }}>{t('Teile', 'Parts')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {SEASON_PARTS.map((key) => (
          <Switch
            key={key}
            testId={`settings-season-part-${key}`}
            checked={parts[key] !== false}
            onChange={(value) => setPart(key, value)}
            title={say(t, PART_TEXT[key].name)}
            description={say(t, PART_TEXT[key].when)}
          />
        ))}
      </div>
    </div>
  );
}
