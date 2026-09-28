// OmniFM: owner console: the station catalogue with test and health check.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import {
  Radio,
  ListMusic,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Music2,
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  Save,
  SignalHigh,
  X as CloseIcon,
} from 'lucide-react';
import { Equalizer, StatTile, writeBrowserCache } from './ownerUi.js';

export default function OwnerStations({
  checkStationHealth,
  closeStationForm,
  deleteStation,
  openEditStation,
  openNewStation,
  saveStation,
  setStForm,
  setStMsg,
  setStTest,
  stBusy,
  stForm,
  stHealth,
  stHealthBusy,
  stHealthProg,
  stHealthSummary,
  stMsg,
  stTest,
  stationList,
  stations,
  suggestColorFromLogo,
  testStationUrl,
}) {
  return (
    <>
      <div className="oa-grid cols-3">
        <StatTile testid="station-stat-total" label="Stationen gesamt" value={stations.total} icon={ListMusic} accent="#ff6b00" />
        <StatTile testid="station-stat-free" label="Free Stationen" value={stations.free} icon={Radio} accent="#64748b" />
        <StatTile testid="station-stat-pro" label="Pro Stationen" value={stations.pro} icon={Music2} accent="#00e5ff" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '28px 0 14px' }}>
        <div className="oa-section-title" style={{ margin: 0 }}><ListMusic size={15} /> Katalog verwalten ({stationList.length})</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="oa-btn ghost" style={{ height: 40 }} disabled={stHealthBusy || !stationList.length} onClick={() => checkStationHealth()} data-testid="station-check-all-button"><SignalHigh size={16} /> {stHealthBusy ? `Prüfe… ${stHealthProg ? `${stHealthProg.done}/${stHealthProg.total}` : ''}` : 'Live-Status prüfen'}</button>
          <button className="oa-btn ghost" style={{ height: 40 }} disabled={stHealthBusy} title="Browser-Playability-Cache leeren (erzwingt neue Prüfung)" onClick={() => { writeBrowserCache({}); setStMsg({ ok: true, text: 'Browser-Cache geleert – nächste Prüfung testet alle Sender neu.' }); }} data-testid="station-cache-clear-button"><RefreshCw size={15} /></button>
          <button className="oa-btn primary" style={{ height: 40 }} onClick={openNewStation} data-testid="station-add-button"><Plus size={16} /> Station hinzufügen</button>
        </div>
      </div>

      <div data-testid="station-status-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 6px', fontSize: 12, color: '#94a3b8' }}>
        <span style={{ marginRight: 4 }}>Status:</span>
        <span className="oa-pill green" style={{ padding: '2px 8px' }}>Discord = Bot kann streamen</span>
        <span className="oa-pill cyan" style={{ padding: '2px 8px' }}>Browser = Website-Player spielbar</span>
        <span className="oa-pill amber" style={{ padding: '2px 8px' }}>Nur Discord = Browser blockiert</span>
        <span className="oa-pill red" style={{ padding: '2px 8px' }}>Offline = nicht erreichbar</span>
      </div>

      <div className="oa-card" style={{ margin: '12px 0 16px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} data-testid="station-auto-health">
        <span className={`oa-pill ${stHealthSummary?.automatic === false ? 'amber' : 'green'}`}><span className="oa-dot" /> Automatische Prüfung {stHealthSummary?.automatic === false ? 'deaktiviert' : 'aktiv'}</span>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>{stHealthSummary?.automatic === false ? 'Unter System-Konfiguration aktivierbar' : `Ressourcenschonend gestaffelt · ${stHealthSummary?.batchSize || 2} Sender alle ${Math.round((stHealthSummary?.intervalMs || 5000) / 1000)}s · Alarm nach zwei Fehlern · Recovery im Live-Log`}</span>
        {stHealthSummary && <span className="oa-mono" style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>{stHealthSummary.up || 0} UP · {stHealthSummary.down || 0} DOWN · {stHealthSummary.pending || 0} AUSSTEHEND</span>}
      </div>

      {stMsg && (
        <div className={`oa-pill ${stMsg.ok ? 'green' : 'red'}`} style={{ marginBottom: 14 }} data-testid="station-message">
          {stMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {stMsg.text}
        </div>
      )}

      {stForm && (
        <div className="oa-card oa-fade" style={{ marginBottom: 18, borderColor: 'rgba(255,107,0,0.35)' }} data-testid="station-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontFamily: "'Syne','Outfit',sans-serif", fontSize: 17 }}>{stForm._isNew ? 'Neue Station' : `Station bearbeiten: ${stForm.key}`}</div>
            <button className="oa-btn ghost" style={{ height: 34, padding: '0 12px' }} onClick={closeStationForm} data-testid="station-form-close"><CloseIcon size={15} /></button>
          </div>
          <div className="oa-grid cols-2" style={{ gap: 14 }}>
            <div>
              <label className="oa-stat-label">Key</label>
              <input className="oa-input" style={{ marginTop: 6 }} value={stForm.key} disabled={!stForm._isNew} placeholder="z.B. synthwave" onChange={(e) => setStForm({ ...stForm, key: e.target.value })} data-testid="station-input-key" />
            </div>
            <div>
              <label className="oa-stat-label">Name</label>
              <input className="oa-input" style={{ marginTop: 6, fontFamily: 'DM Sans' }} value={stForm.name} placeholder="Anzeigename" onChange={(e) => setStForm({ ...stForm, name: e.target.value })} data-testid="station-input-name" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="oa-stat-label">Stream-URL</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input className="oa-input" value={stForm.url} placeholder="https://…/stream.mp3" onChange={(e) => { setStForm({ ...stForm, url: e.target.value }); setStTest(null); }} data-testid="station-input-url" />
                <button className="oa-btn ghost" style={{ height: 46, whiteSpace: 'nowrap' }} disabled={stBusy || !stForm.url} onClick={() => testStationUrl(stForm.url)} data-testid="station-test-button"><SignalHigh size={15} /> Test</button>
              </div>
              {stTest && (
                <div className={`oa-pill ${stTest.loading ? 'slate' : stTest.ok ? 'green' : 'amber'}`} style={{ marginTop: 10 }} data-testid="station-test-result">
                  {stTest.loading ? <><Equalizer /> Teste Stream…</> : (
                    <>{stTest.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {stTest.message}{stTest.bitrate ? ` · ${stTest.bitrate} kbps` : ''}{typeof stTest.latencyMs === 'number' ? ` · ${stTest.latencyMs}ms` : ''}</>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="oa-stat-label">Tier</label>
              <select className="oa-input" style={{ marginTop: 6 }} value={stForm.tier} onChange={(e) => setStForm({ ...stForm, tier: e.target.value })} data-testid="station-input-tier">
                <option value="free">Free</option><option value="pro">Pro</option><option value="ultimate">Ultimate</option>
              </select>
            </div>
            <div>
              <label className="oa-stat-label">Genre</label>
              <input className="oa-input" style={{ marginTop: 6, fontFamily: 'DM Sans' }} value={stForm.genre} placeholder="z.B. Techno" onChange={(e) => setStForm({ ...stForm, genre: e.target.value })} data-testid="station-input-genre" />
            </div>
            <div>
              {/* #430: in the season these stations get their own rubric at the top of the browser. */}
              <span className="oa-stat-label">Saison-Rubrik</span>
              <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
                {[['halloween', '🎃 Halloween'], ['christmas', '🎄 Weihnachten'], ['easter', '🐣 Ostern']].map(([season, label]) => (
                  <label key={season} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      data-testid={`station-input-season-${season}`}
                      checked={(stForm.seasons || []).includes(season)}
                      onChange={(e) => setStForm({ ...stForm, seasons: e.target.checked ? [...new Set([...(stForm.seasons || []), season])] : (stForm.seasons || []).filter((entry) => entry !== season) })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="oa-stat-label">Land</label>
              <input className="oa-input" style={{ marginTop: 6 }} value={stForm.country} placeholder="z.B. DE" onChange={(e) => setStForm({ ...stForm, country: e.target.value })} data-testid="station-input-country" />
            </div>
            <div>
              <label className="oa-stat-label">Sprache</label>
              <input className="oa-input" style={{ marginTop: 6 }} value={stForm.language} placeholder="z.B. de" onChange={(e) => setStForm({ ...stForm, language: e.target.value })} data-testid="station-input-language" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="oa-stat-label">Logo (https-Link)</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                {stForm.logo && <img src={stForm.logo} alt="" width={40} height={40} style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
                <input className="oa-input" value={stForm.logo} placeholder="https://…/logo.png" onChange={(e) => setStForm({ ...stForm, logo: e.target.value })} data-testid="station-input-logo" />
              </div>
            </div>
            <div>
              <label className="oa-stat-label">Farbe (Akzent im Now-Playing-Panel)</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(stForm.color) ? stForm.color : '#FF6B00'} onChange={(e) => setStForm({ ...stForm, color: e.target.value.toUpperCase() })} style={{ width: 46, height: 46, border: 'none', background: 'none' }} data-testid="station-input-color-picker" />
                <input className="oa-input oa-mono" value={stForm.color} placeholder="#7C3AED" onChange={(e) => setStForm({ ...stForm, color: e.target.value })} data-testid="station-input-color" />
                <button type="button" className="oa-btn ghost" style={{ height: 46, whiteSpace: 'nowrap' }} disabled={!stForm.logo} onClick={suggestColorFromLogo} data-testid="station-color-from-logo">Aus Logo</button>
              </div>
            </div>
            <div>
              <label className="oa-stat-label">Homepage (https-Link)</label>
              <input className="oa-input" style={{ marginTop: 6 }} value={stForm.homepage} placeholder="https://…" onChange={(e) => setStForm({ ...stForm, homepage: e.target.value })} data-testid="station-input-homepage" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="oa-btn primary" disabled={stBusy} onClick={saveStation} data-testid="station-save-button"><Save size={16} /> {stForm._isNew ? 'Anlegen' : 'Speichern'}</button>
            <button className="oa-btn ghost" onClick={closeStationForm}>Abbrechen</button>
          </div>
        </div>
      )}

      <div className="oa-table-wrap oa-fade" data-testid="stations-table">
        <table className="oa-table">
          <thead><tr><th>Key</th><th>Name</th><th>Genre</th><th>Tier</th><th>Live-Status</th><th style={{ textAlign: 'right' }}>Aktionen</th></tr></thead>
          <tbody>
            {stationList.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#64748b', padding: 24 }}>Lade Katalog…</td></tr>}
            {stationList.map((s, i) => {
              const h = stHealth[s.key];
              return (
              <tr key={s.key || i} data-testid={`station-row-${s.key}`}>
                <td className="oa-mono" style={{ fontSize: 12, color: '#94a3b8' }}>{s.key}{s.isDefault && <span className="oa-pill orange" style={{ marginLeft: 8, padding: '2px 7px' }}>default</span>}</td>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {s.logo
                      ? <img src={s.logo} alt="" width={22} height={22} loading="lazy" style={{ borderRadius: 5, objectFit: 'cover' }} />
                      : <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color || '#475569', display: 'inline-block' }} />}
                    {s.name}
                    {(s.seasons || []).includes('christmas') && <span title="Weihnachts-Rubrik" data-testid={`station-season-${s.key}-christmas`}>🎄</span>}
                    {(s.seasons || []).includes('easter') && <span title="Oster-Rubrik" data-testid={`station-season-${s.key}-easter`}>🐣</span>}
                    {(s.seasons || []).includes('halloween') && <span title="Halloween-Rubrik" data-testid={`station-season-${s.key}-halloween`}>🎃</span>}
                  </span>
                </td>
                <td style={{ color: '#94a3b8' }}>{s.genre || '—'}</td>
                <td><span className={`oa-pill ${s.tier === 'ultimate' ? 'orange' : s.tier === 'pro' ? 'cyan' : 'slate'}`}>{String(s.tier || 'free').toUpperCase()}</span></td>
                <td data-testid={`station-status-${s.key}`}>
                  {!h && <span className="oa-pill slate" style={{ padding: '2px 8px' }}>—</span>}
                  {h && h.checking && <span className="oa-pill slate" style={{ padding: '2px 8px' }}>Prüfe…</span>}
                  {h && !h.checking && !h.reachable && <span className="oa-pill red" style={{ padding: '2px 8px' }}><XCircle size={11} /> Offline</span>}
                  {h && !h.checking && h.reachable && !h.discordOk && !h.ok && <span className="oa-pill amber" style={{ padding: '2px 8px' }}><AlertTriangle size={11} /> Kein Audio</span>}
                  {h && !h.checking && (h.discordOk || h.ok) && (
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="oa-pill green" style={{ padding: '2px 8px' }} title="Server-seitig streambar – Discord-Bot kann diesen Sender abspielen"><CheckCircle2 size={11} /> Discord{typeof (h.latencyMs ?? h.responseTimeMs) === 'number' ? ` · ${h.latencyMs ?? h.responseTimeMs}ms` : ''}</span>
                      {h.browserOk === true
                        ? <span className="oa-pill cyan" style={{ padding: '2px 8px' }} title="Direkt im Website-Player abspielbar"><CheckCircle2 size={11} /> Browser</span>
                        : h.browserOk === false
                          ? <span className="oa-pill amber" style={{ padding: '2px 8px' }} title="Browser-Direktzugriff blockiert (z. B. 403/Hotlink). Im Discord-Bot funktioniert der Sender."><AlertTriangle size={11} /> Nur Discord</span>
                          : <span className="oa-pill slate" style={{ padding: '2px 8px' }} title="Der automatische Server-Check prüft Discord-Tauglichkeit. Die Browser-Probe läuft beim manuellen Test.">Browser ungeprüft</span>}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button title="Einzeln prüfen" className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6 }} disabled={stHealthBusy} onClick={() => checkStationHealth([s.key])} data-testid={`station-row-test-${s.key}`}><SignalHigh size={14} /></button>
                  <button title="Bearbeiten" className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6 }} onClick={() => openEditStation(s)} data-testid={`station-row-edit-${s.key}`}><Pencil size={14} /></button>
                  <button title={s.isDefault ? 'Standard-Station' : 'Löschen'} className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6, color: '#ff8fab', opacity: s.isDefault ? 0.4 : 1 }} disabled={stBusy || s.isDefault} onClick={() => deleteStation(s.key)} data-testid={`station-row-delete-${s.key}`}><Trash2 size={14} /></button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
