import { Info, Star } from 'lucide-react';
import { SEASONS, SEASON_PREVIEWS, normalizeOwnerSeasons } from '../../../../src/lib/seasons.js';
import { Field, SaveBar, Toggle, labelStyle } from './configFields.js';
import OwnerEggHunt from './OwnerEggHunt.js';

// The seasonal decoration (#425): what the switches and the test looks are called.
const SEASON_SWITCH_LABELS = {
  easter: 'Ostern (Palmsonntag bis Ostermontag)',
  halloween: 'Halloween (26. Oktober bis 1. November)',
  advent: 'Advent (1. Adventsonntag bis 23. Dezember)',
  christmas: 'Weihnachten (24. bis 30. Dezember)',
  newyear: 'Silvester und Neujahr (31. Dezember und 1. Januar)',
};
const SEASON_PREVIEW_LABELS = {
  'easter-soon': 'Ostern: „Bald ist Ostern“',
  'easter-greeting': 'Ostern: „Frohe Ostern“',
  'halloween-soon': 'Halloween: „Bald ist Halloween“',
  'halloween-greeting': 'Halloween: „Happy Halloween“',
  'advent-1': 'Advent: 1. Kerze',
  'advent-2': 'Advent: 2. Kerze',
  'advent-3': 'Advent: 3. Kerze',
  'advent-4': 'Advent: 4. Kerze',
  'christmas-greeting': 'Weihnachten: „Frohe Weihnachten“',
  'christmas-winter': 'Weihnachten: Winter-Deko (27. bis 30.)',
  'newyear-countdown': 'Silvester: Countdown bis Mitternacht',
  'newyear-greeting': 'Neujahr: „Frohes neues Jahr“',
};

/** Owner page "Saison-Deko" (#425): a main switch per season, the test mode and the egg hunt's top three (#429). */
export default function OwnerSeasonsConfig({ seasons, setSeasons, onSave, saving, msg, dirty, apiGet = null }) {
  if (!seasons) return <div className="oa-sub">Lade Konfiguration…</div>;
  const test = seasons.test || { preview: '', guildIds: [] };
  const setTest = (changes) => setSeasons((p) => ({ ...p, test: { ...(p.test || {}), ...changes } }));
  return (
    <div className="oa-fade" data-testid="config-seasons">
      <div className="oa-card" style={{ marginBottom: 18 }}>
        <div className="oa-section-title"><Star size={15} /> Saison-Deko: Hauptschalter</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
          Schaltet eine Saison auf allen Servern ab, falls etwas klemmt. Sonst entscheidet jeder Server im Dashboard selbst; dort ist alles an, bis jemand etwas ausschaltet.
        </div>
        {SEASONS.map((key) => (
          <Toggle
            key={key}
            label={SEASON_SWITCH_LABELS[key]}
            checked={seasons.enabled?.[key] !== false}
            onChange={(v) => setSeasons((p) => ({ ...p, enabled: { ...(p.enabled || {}), [key]: v } }))}
            testid={`cfg-season-${key}`}
          />
        ))}
      </div>

      <div className="oa-card" style={{ marginBottom: 18 }}>
        <div className="oa-section-title"><Info size={15} /> Testmodus: Saison erzwingen</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
          Die genannten Server zeigen den gewählten Look sofort, egal welches Datum ist und was die Schalter sagen. So lässt sich alles vor dem Termin im eigenen Server prüfen. „Aus“ beendet den Test.
          Mit einem Oster-Look läuft dort auch die Ostereiersuche, mit einem Ei etwa bei jedem zweiten Song; gefundene Eier zählen dort wie echte.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle} htmlFor="cfg-season-preview">Look</label>
            <select id="cfg-season-preview" className="oa-input" data-testid="cfg-season-preview" value={test.preview || ''} onChange={(e) => setTest({ preview: e.target.value })}>
              <option value="">Aus</option>
              {SEASON_PREVIEWS.map((entry) => <option key={entry.id} value={entry.id}>{SEASON_PREVIEW_LABELS[entry.id] || entry.id}</option>)}
            </select>
            {test.preview ? (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>
                Auf der Website sieht den Look nur, wer diesen Link öffnet:{' '}
                <a href={`/?season=${test.preview}`} target="_blank" rel="noopener noreferrer" data-testid="cfg-season-website" style={{ color: '#00e5ff' }}>{`/?season=${test.preview}`}</a>
              </div>
            ) : null}
          </div>
          <Field
            label="Server-IDs (eine pro Zeile)"
            textarea
            value={(test.guildIds || []).join('\n')}
            onChange={(v) => setTest({ guildIds: v.split('\n') })}
            placeholder="123456789012345678"
            hint="Höchstens 25 Server. Beim Speichern bleiben nur gültige IDs übrig."
            testid="cfg-season-guilds"
          />
        </div>
      </div>
      <SaveBar onSave={() => onSave(normalizeOwnerSeasons(seasons))} saving={saving} msg={msg} testid="cfg-seasons-save" dirty={dirty} />
      {apiGet ? <OwnerEggHunt apiGet={apiGet} /> : null}
    </div>
  );
}
